import {randomUUID} from 'crypto';
import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth';
import {requireFeature} from '../middleware/requireFeature';
import {asyncHandler} from '../middleware/asyncHandler';
import {query,withTransaction} from '../db';
import {sendPushNotification} from '../services/notificationService';

const router=Router();
router.use(authenticate);
// Sem gate de router inteiro aqui: registro de push, inbox e marcar-como-lida
// são infraestrutura usada por avisos de QUALQUER módulo (lembrete de
// boleto, ocorrência, notificação de infração), não só pela funcionalidade
// "Avisos e comunicação" em si. Só compor um aviso manual e ver o histórico
// de envios são essa funcionalidade de fato — gate por rota abaixo.

router.post('/devices',asyncHandler(async(req,res)=>{
  const {pushToken,fcmToken,platform}=req.body??{};
  const deviceToken=pushToken||fcmToken;
  if(!deviceToken||typeof deviceToken!=='string')return res.status(400).json({message:'Token do dispositivo obrigatório.'});
  const result=await query(`insert into device_tokens(id,user_id,fcm_token,platform) values($1,$2,$3,$4) on conflict(fcm_token) do update set user_id=excluded.user_id,platform=excluded.platform,updated_at=now() returning id,user_id,platform,updated_at`,[randomUUID(),req.user?.id,deviceToken,platform||null]);
  return res.status(201).json({device:result.rows[0]});
}));

router.delete('/devices',asyncHandler(async(req,res)=>{
  const pushToken=req.body?.pushToken;
  if(!pushToken||typeof pushToken!=='string')return res.status(400).json({message:'Token do dispositivo obrigatório.'});
  await query(`delete from device_tokens where user_id=$1 and fcm_token=$2`,[req.user?.id,pushToken]);
  return res.status(204).send();
}));

router.get('/unread-count',asyncHandler(async(req,res)=>{
  const result=await query<{count:number}>(`select count(*)::int count from notification_recipients where user_id=$1 and read_at is null`,[req.user?.id]);
  return res.json({count:result.rows[0]?.count||0});
}));

router.get('/',asyncHandler(async(req,res)=>{
  const result=await query(`select n.id,n.title,n.body,n.created_at,n.provider_status,n.audience_type,n.target_user_id,n.created_by,u.full_name created_by_name,u.username created_by_username,nr.delivered_at,nr.read_at
    from notification_recipients nr join notifications n on n.id=nr.notification_id left join users u on u.id=n.created_by
    where nr.user_id=$1 and n.condominium_id=$2 order by n.created_at desc`,[req.user?.id,req.user?.condominiumId]);
  return res.json({notifications:result.rows});
}));

router.get('/history/sent',authorize('sindico','subsindico'),requireFeature('avisos_comunicacao'),asyncHandler(async(req,res)=>{
  const result=await query(`select n.id,n.title,n.body,n.audience_type,n.created_at,n.provider_status,
      sender.full_name created_by_name,sender.username created_by_username,
      count(nr.user_id)::int recipient_count,
      count(nr.read_at)::int read_count,
      jsonb_agg(jsonb_build_object('user_id',recipient.id,'name',coalesce(recipient.full_name,recipient.username),'unit',coalesce(blocks.name || ' / ' || units.number,recipient.unit),'delivered_at',nr.delivered_at,'read_at',nr.read_at) order by coalesce(recipient.full_name,recipient.username)) recipients
    from notifications n
    join notification_recipients nr on nr.notification_id=n.id
    join users recipient on recipient.id=nr.user_id
    left join users sender on sender.id=n.created_by
    left join units on units.id=recipient.unit_id
    left join blocks on blocks.id=units.block_id
    where n.condominium_id=$1
    group by n.id,sender.full_name,sender.username
    order by n.created_at desc`,[req.user?.condominiumId]);
  return res.json({history:result.rows});
}));

router.patch('/:id/read',asyncHandler(async(req,res)=>{
  const result=await query(`update notification_recipients set read_at=coalesce(read_at,now()) where notification_id=$1 and user_id=$2 returning read_at`,[req.params.id,req.user?.id]);
  if(!result.rows[0])return res.status(404).json({message:'Aviso não encontrado.'});
  return res.json({readAt:result.rows[0].read_at});
}));

router.post('/',authorize('sindico','subsindico'),requireFeature('avisos_comunicacao'),asyncHandler(async(req,res)=>{
  const condominiumId=req.user?.condominiumId;
  const senderId=req.user?.id;
  const title=String(req.body?.title||'').trim();
  const body=String(req.body?.body||'').trim();
  const targetUserId=req.body?.targetUserId?String(req.body.targetUserId):null;
  if(!condominiumId)return res.status(400).json({message:'Condomínio obrigatório.'});
  if(!senderId)return res.status(401).json({message:'Usuário autenticado obrigatório.'});
  if(title.length<3||title.length>120)return res.status(400).json({message:'O título deve ter entre 3 e 120 caracteres.'});
  if(body.length<3||body.length>2000)return res.status(400).json({message:'A mensagem deve ter entre 3 e 2.000 caracteres.'});
  // Quem envia fica de fora do próprio aviso — exceto o síndico/subsíndico que
  // também é morador deste condomínio. Nesse caso ele é destinatário legítimo:
  // como proprietário/inquilino precisa do comunicado no inbox e no push igual
  // a qualquer outro morador. O par síndico+morador pode estar em qualquer
  // ordem (um lado em `users.role`, o outro em `user_profiles`), por isso as
  // duas origens são consultadas — ver authService.listProfiles.
  const residentProfile=await query(`select 1 from users u where u.id=$1 and u.condominium_id=$2 and u.role in ('proprietario','inquilino') union all select 1 from user_profiles p where p.user_id=$1 and p.condominium_id=$2 and p.role in ('proprietario','inquilino') limit 1`,[senderId,condominiumId]);
  const senderIsResident=residentProfile.rows.length>0;
  if(targetUserId&&targetUserId===senderId&&!senderIsResident)return res.status(400).json({message:'Você não pode enviar um aviso para você mesmo.'});
  const recipients=await query<{id:string;full_name:string|null;username:string}>(`select u.id,u.full_name,u.username from users u where u.condominium_id=$1 and u.login_enabled=true and ($4::boolean or u.id<>$3) and ($2::uuid is null or u.id=$2)`,[condominiumId,targetUserId,senderId,senderIsResident]);
  if(!recipients.rows.length)return res.status(404).json({message:targetUserId?'A pessoa selecionada não está ativa neste condomínio.':'Não há pessoas ativas neste condomínio.'});
  const recipientIds=recipients.rows.map(row=>row.id);
  const devices=await query<{fcm_token:string}>(`select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`,[recipientIds]);
  const tokens=devices.rows.map(row=>row.fcm_token).filter(Boolean);
  let push;try{push=await sendPushNotification({tokens,title,body,data:{screen:'Communications'}});if(push.errors?.length)console.warn('Communication push notification errors',push.errors);if(push.invalidTokens?.length)await query(`delete from device_tokens where fcm_token = any($1::text[])`,[push.invalidTokens]);}catch(error){console.warn('Communication push notification failed',error);push={provider:'expo',status:'provider_error',delivered:0,requested:tokens.length,errors:['Falha ao enviar push notification.'],invalidTokens:[]};}
  const notification=await withTransaction(async client=>{
    const created=await client.query(`insert into notifications(id,condominium_id,title,body,target_role,created_by,provider_status,audience_type,target_user_id) values($1,$2,$3,$4,null,$5,$6,$7,$8) returning *`,[randomUUID(),condominiumId,title,body,senderId,push.status,targetUserId?'personal':'general',targetUserId]);
    for(const recipient of recipients.rows)await client.query(`insert into notification_recipients(notification_id,user_id) values($1,$2)`,[created.rows[0].id,recipient.id]);
    return created.rows[0];
  });
  const recipientName=recipients.rows[0].full_name||recipients.rows[0].username;
  const personalMessage=targetUserId===senderId?'Mensagem enviada para você mesmo.':`Mensagem enviada para ${recipientName}.`;
  const generalMessage=`Aviso enviado para ${recipients.rows.length} pessoa(s) do condomínio${senderIsResident?', incluindo você':''}.`;
  return res.status(201).json({notification,recipients:recipients.rows.length,senderIncluded:senderIsResident,push,message:targetUserId?personalMessage:generalMessage});
}));

export default router;
