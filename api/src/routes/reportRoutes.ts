import {randomUUID} from 'crypto';
import {Router} from 'express';
import {authenticate,authorize} from '../middleware/auth';
import {requireFeature} from '../middleware/requireFeature';
import {asyncHandler} from '../middleware/asyncHandler';
import {query,withTransaction} from '../db';
import {sendPushNotification} from '../services/notificationService';

const router=Router();router.use(authenticate);router.use(requireFeature('relatos_solicitacoes'));
const manager=(role?:string)=>role==='sindico'||role==='subsindico';
const access=async(id:string,user:any)=>{const result=await query<any>(`select r.*,u.full_name resident_name,u.username resident_username,coalesce(b.name || ' / ' || un.number,u.unit) unit from resident_reports r join users u on u.id=r.created_by left join units un on un.id=u.unit_id left join blocks b on b.id=un.block_id where r.id=$1 and r.condominium_id=$2 and ($3::boolean=true or r.created_by=$4)`,[id,user.condominiumId,manager(user.role),user.id]);return result.rows[0];};
const trimMessage=(value:string,max=120)=>value.length>max?`${value.slice(0,max-1)}…`:value;
const pushUsers=async(condominiumId:string,userIds:string[],title:string,body:string,data:Record<string,unknown>,excludeUserId?:string)=>{
	const filteredIds=Array.from(new Set(userIds.filter(id=>id&&id!==excludeUserId)));
	if(!filteredIds.length)return;
	const devices=await query<{fcm_token:string}>(`select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`,[filteredIds]);
	const tokens=devices.rows.map(item=>item.fcm_token).filter(Boolean);
	if(!tokens.length)return;
	try{const push=await sendPushNotification({tokens,title,body,data});if(push.errors?.length)console.warn('Report push notification errors',push.errors);if(push.invalidTokens?.length)await query(`delete from device_tokens where fcm_token = any($1::text[])`,[push.invalidTokens]);}catch(error){console.warn('Failed to send report push notification',error);}
};
const managerIds=async(condominiumId:string)=>{
	const result=await query<{id:string}>(`select id from users where condominium_id=$1 and login_enabled=true and role in ('sindico','subsindico')`,[condominiumId]);
	return result.rows.map(row=>row.id);
};

router.get('/',asyncHandler(async(req,res)=>{const result=await query<any>(`select r.*,u.full_name resident_name,u.username resident_username,coalesce(b.name || ' / ' || un.number,u.unit) unit,(select count(*)::int from resident_report_messages m where m.report_id=r.id and m.sender_id<>$1 and m.read_at is null) unread_count from resident_reports r join users u on u.id=r.created_by left join units un on un.id=u.unit_id left join blocks b on b.id=un.block_id where r.condominium_id=$2 and ($3::boolean=true or r.created_by=$1) order by r.updated_at desc`,[req.user?.id,req.user?.condominiumId,manager(req.user?.role)]);return res.json({reports:result.rows})}));

router.get('/:id',asyncHandler(async(req,res)=>{const report=await access(req.params.id,req.user);if(!report)return res.status(404).json({message:'Relato não encontrado.'});await query(`update resident_report_messages set read_at=coalesce(read_at,now()) where report_id=$1 and sender_id<>$2`,[report.id,req.user?.id]);const messages=await query(`select m.id,m.body,m.created_at,m.read_at,m.sender_id,u.full_name sender_name,u.username sender_username,u.role sender_role from resident_report_messages m join users u on u.id=m.sender_id where m.report_id=$1 order by m.created_at`,[report.id]);return res.json({report,messages:messages.rows})}));

router.post('/',authorize('proprietario','inquilino'),asyncHandler(async(req,res)=>{const category=String(req.body?.category||'').trim();const subject=String(req.body?.subject||'').trim();const body=String(req.body?.body||'').trim();if(!req.user?.condominiumId)return res.status(400).json({message:'Usuário sem condomínio.'});if(category.length<2||subject.length<3||body.length<3)return res.status(400).json({message:'Preencha categoria, assunto e descrição.'});const report=await withTransaction(async client=>{const created=await client.query(`insert into resident_reports(id,condominium_id,created_by,category,subject) values($1,$2,$3,$4,$5) returning *`,[randomUUID(),req.user?.condominiumId,req.user?.id,category,subject,]);await client.query(`insert into resident_report_messages(id,report_id,sender_id,body) values($1,$2,$3,$4)`,[randomUUID(),created.rows[0].id,req.user?.id,body]);return created.rows[0]});const managers=await managerIds(req.user.condominiumId);await pushUsers(req.user.condominiumId,managers,'Novo relato recebido',`${req.user.username}: ${trimMessage(subject)}`,{screen:'Reports',reportId:report.id});return res.status(201).json({report,message:'Relato enviado para a administração.'})}));

router.post('/:id/messages',asyncHandler(async(req,res)=>{const report=await access(req.params.id,req.user);if(!report)return res.status(404).json({message:'Relato não encontrado.'});const body=String(req.body?.body||'').trim();if(body.length<2||body.length>3000)return res.status(400).json({message:'A mensagem deve ter entre 2 e 3.000 caracteres.'});const result=await withTransaction(async client=>{const message=await client.query(`insert into resident_report_messages(id,report_id,sender_id,body) values($1,$2,$3,$4) returning *`,[randomUUID(),report.id,req.user?.id,body]);await client.query(`update resident_reports set status=case when $2::boolean then 'in_progress' else status end,updated_at=now() where id=$1`,[report.id,manager(req.user?.role)]);return message.rows[0]});const recipients=manager(req.user?.role)?[report.created_by]:await managerIds(report.condominium_id);await pushUsers(report.condominium_id,recipients,manager(req.user?.role)?'Resposta da administração':'Nova mensagem em relato',trimMessage(body),{screen:'Reports',reportId:report.id},req.user?.id);return res.status(201).json({message:result})}));

router.patch('/:id/status',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{const status=String(req.body?.status||'');if(!['open','in_progress','resolved'].includes(status))return res.status(400).json({message:'Situação inválida.'});if(!req.user?.condominiumId)return res.status(400).json({message:'Condomínio obrigatório.'});const result=await query(`update resident_reports set status=$1,updated_at=now() where id=$2 and condominium_id=$3 returning *`,[status,req.params.id,req.user.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Relato não encontrado.'});const report=await access(req.params.id,req.user);if(report?.created_by)await pushUsers(req.user.condominiumId,[report.created_by],'Atualização no seu relato',`Situação alterada para ${status==='open'?'Aberto':status==='in_progress'?'Em atendimento':'Resolvido'}.`,{screen:'Reports',reportId:req.params.id});return res.json({report:result.rows[0]})}));
export default router;
