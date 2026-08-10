import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';
import { notifyUsers } from '../services/notificationService';
import { localDateParts, localDayKey, localMinutesOfDay } from '../services/timezone';

const router = Router();
router.use(authenticate);
router.use(requireFeature('reserva_espacos'));
const manager = (role?: string) => role === 'sindico' || role === 'subsindico';

const activeResident = async (userId:string, condominiumId:string) => {
  const result=await query(`select 1 from users u where u.id=$1 and u.condominium_id=$2 and u.role in ('proprietario','inquilino') and u.login_enabled=true and u.deleted_at is null and exists(select 1 from unit_occupancies uo join units un on un.id=uo.unit_id where uo.user_id=u.id and uo.ended_at is null and un.active=true and un.condominium_id=$2)`,[userId,condominiumId]);
  return Boolean(result.rows[0]);
};
const notifyManagers=async(condominiumId:string,senderId:string,title:string,body:string)=>{const recipients=await query<{id:string}>(`select id from users where condominium_id=$1 and role in ('sindico','subsindico') and login_enabled=true and deleted_at is null and id<>$2`,[condominiumId,senderId]);await notifyUsers({condominiumId,senderId,recipientIds:recipients.rows.map(row=>row.id),title,body,screen:'SpaceReservations'});};

router.get('/',asyncHandler(async(req,res)=>{
  const condominiumId=req.user?.condominiumId;if(!condominiumId)return res.status(400).json({message:'Condomínio obrigatório.'});
  const isManager=manager(req.user?.role);
  const spaces=await query(`select id,name,description,rules,capacity,available_from,available_until,active,created_at from reservable_spaces where condominium_id=$1 and ($2 or active=true) order by active desc,name`,[condominiumId,isManager]);
  const reservations=await query(`select r.id,r.space_id,r.requested_by,r.starts_at,r.ends_at,r.purpose,r.status,r.review_note,r.created_at,s.name space_name,coalesce(u.full_name,u.username) requested_by_name,b.name || ' / ' || un.number unit_label from space_reservations r join reservable_spaces s on s.id=r.space_id join users u on u.id=r.requested_by left join units un on un.id=u.unit_id left join blocks b on b.id=un.block_id where r.condominium_id=$1 and ($2 or r.requested_by=$3) order by r.starts_at desc`,[condominiumId,isManager,req.user?.id]);
  return res.json({spaces:spaces.rows,reservations:reservations.rows});
}));

router.get('/availability',asyncHandler(async(req,res)=>{
  const condominiumId=req.user?.condominiumId;const spaceId=String(req.query.spaceId||'');
  const from=new Date(String(req.query.from||new Date().toISOString()));const to=new Date(String(req.query.to||new Date(Date.now()+30*86400000).toISOString()));
  if(!condominiumId||!spaceId||Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from)return res.status(400).json({message:'Período inválido.'});
  const space=await query(`select id from reservable_spaces where id=$1 and condominium_id=$2 and active=true`,[spaceId,condominiumId]);if(!space.rows[0])return res.status(404).json({message:'Espaço não encontrado.'});
  const occupied=await query(`select id,starts_at,ends_at,status,'reservation' kind,null::text reason from space_reservations where space_id=$1 and status in ('pending','approved') and starts_at<$3 and ends_at>$2 union all select id,starts_at,ends_at,'blocked' status,'block' kind,reason from space_schedule_blocks where space_id=$1 and starts_at<$3 and ends_at>$2 order by starts_at`,[spaceId,from,to]);
  return res.json({occupied:occupied.rows});
}));

router.post('/spaces',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const name=String(req.body?.name||'').trim(),description=String(req.body?.description||'').trim(),rules=String(req.body?.rules||'').trim();const capacity=req.body?.capacity?Number(req.body.capacity):null;const availableFrom=String(req.body?.availableFrom||'08:00'),availableUntil=String(req.body?.availableUntil||'23:00');
  if(name.length<2||name.length>120)return res.status(400).json({message:'O nome deve ter entre 2 e 120 caracteres.'});if(description.length>1000||rules.length>3000)return res.status(400).json({message:'Descrição ou regras excedem o limite.'});if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1))return res.status(400).json({message:'Capacidade inválida.'});if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(availableFrom)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(availableUntil)||availableUntil<=availableFrom)return res.status(400).json({message:'Informe um horário permitido válido.'});
  const result=await query<any>(`insert into reservable_spaces(id,condominium_id,name,description,rules,capacity,available_from,available_until,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[randomUUID(),req.user?.condominiumId,name,description||null,rules||null,capacity,availableFrom,availableUntil,req.user?.id]);await logAudit(req,'reserva_espacos','space_created',`Cadastrou o espaço ${name}`,{entityId:result.rows[0].id});return res.status(201).json({space:result.rows[0]});
}));

router.post('/blocks',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const condominiumId=req.user!.condominiumId!,spaceId=String(req.body?.spaceId||''),startsAt=new Date(req.body?.startsAt),endsAt=new Date(req.body?.endsAt),reason=String(req.body?.reason||'').trim();
  if(!spaceId||Number.isNaN(startsAt.getTime())||Number.isNaN(endsAt.getTime())||endsAt<=startsAt)return res.status(400).json({message:'Informe um período de bloqueio válido.'});if(reason.length<3||reason.length>500)return res.status(400).json({message:'Informe o motivo do bloqueio (3 a 500 caracteres).'});
  const block=await withTransaction(async client=>{await client.query(`select pg_advisory_xact_lock(hashtext($1))`,[spaceId]);const space=await client.query<any>(`select id,name from reservable_spaces where id=$1 and condominium_id=$2`,[spaceId,condominiumId]);if(!space.rows[0])return null;const conflict=await client.query(`select id from space_reservations where space_id=$1 and status in ('pending','approved') and starts_at<$3 and ends_at>$2 limit 1`,[spaceId,startsAt,endsAt]);if(conflict.rows[0])throw Object.assign(new Error('Há uma reserva ou solicitação nesse período. Cancele-a antes de bloquear.'),{status:409});const created=await client.query<any>(`insert into space_schedule_blocks(id,condominium_id,space_id,starts_at,ends_at,reason,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *`,[randomUUID(),condominiumId,spaceId,startsAt,endsAt,reason,req.user?.id]);return {...created.rows[0],space_name:space.rows[0].name};}).catch((error:any)=>{if(error.status)return error;throw error;});if(!block)return res.status(404).json({message:'Espaço não encontrado.'});if(block instanceof Error)return res.status((block as any).status||409).json({message:block.message});
  const blockedDay=(()=>{const p=localDateParts(startsAt);return `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}/${p.year}`;})();
  await logAudit(req,'reserva_espacos','schedule_blocked',`Bloqueou a agenda do espaço ${block.space_name} em ${blockedDay} (motivo: ${reason})`,{entityId:block.id});
  return res.status(201).json({block});
}));

router.delete('/blocks/:id',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{const result=await query(`delete from space_schedule_blocks where id=$1 and condominium_id=$2 returning id`,[req.params.id,req.user?.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Bloqueio não encontrado.'});await logAudit(req,'reserva_espacos','schedule_unblocked','Removeu um bloqueio da agenda',{entityId:req.params.id});return res.status(204).send();}));

router.patch('/spaces/:id',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const active=typeof req.body?.active==='boolean'?req.body.active:null;const name=req.body?.name===undefined?null:String(req.body.name).trim();
  if(name!==null&&(name.length<2||name.length>120))return res.status(400).json({message:'Nome inválido.'});
  const result=await query<any>(`update reservable_spaces set name=coalesce($1,name),description=case when $2::boolean then $3 else description end,rules=case when $4::boolean then $5 else rules end,capacity=case when $6::boolean then $7 else capacity end,active=coalesce($8,active),updated_at=now() where id=$9 and condominium_id=$10 returning *`,[name,req.body?.description!==undefined,req.body?.description||null,req.body?.rules!==undefined,req.body?.rules||null,req.body?.capacity!==undefined,req.body?.capacity||null,active,req.params.id,req.user?.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Espaço não encontrado.'});await logAudit(req,'reserva_espacos','space_updated',`Atualizou o espaço ${result.rows[0].name}`,{entityId:req.params.id});return res.json({space:result.rows[0]});
}));

router.patch('/spaces/:id/schedule',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const availableFrom=String(req.body?.availableFrom||''),availableUntil=String(req.body?.availableUntil||'');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(availableFrom)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(availableUntil)||availableUntil<=availableFrom)return res.status(400).json({message:'Informe um horário diário válido.'});
  const result=await query<any>(`update reservable_spaces set available_from=$1,available_until=$2,updated_at=now() where id=$3 and condominium_id=$4 returning *`,[availableFrom,availableUntil,req.params.id,req.user?.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Espaço não encontrado.'});await logAudit(req,'reserva_espacos','schedule_updated',`Definiu reservas entre ${availableFrom} e ${availableUntil}`,{entityId:req.params.id});return res.json({space:result.rows[0]});
}));

router.post('/reservations',authorize('proprietario','inquilino'),asyncHandler(async(req,res)=>{
  const condominiumId=req.user!.condominiumId!;if(!(await activeResident(req.user!.id,condominiumId)))return res.status(403).json({message:'Somente moradores ativos vinculados a uma unidade podem reservar.'});
  const spaceId=String(req.body?.spaceId||''),startsAt=new Date(req.body?.startsAt),endsAt=new Date(req.body?.endsAt),purpose=String(req.body?.purpose||'').trim();if(!spaceId||Number.isNaN(startsAt.getTime())||Number.isNaN(endsAt.getTime())||startsAt<=new Date()||endsAt<=startsAt)return res.status(400).json({message:'Informe um período futuro válido.'});if(endsAt.getTime()-startsAt.getTime()>24*60*60*1000)return res.status(400).json({message:'A reserva não pode ultrapassar 24 horas.'});if(purpose.length>500)return res.status(400).json({message:'A finalidade deve ter no máximo 500 caracteres.'});
  const schedule=await query<any>(`select available_from::text,available_until::text from reservable_spaces where id=$1 and condominium_id=$2 and active=true`,[spaceId,condominiumId]);if(!schedule.rows[0])return res.status(404).json({message:'Espaço indisponível.'});const toMinutes=(value:string)=>{const [hour,minute]=value.slice(0,5).split(':').map(Number);return hour*60+minute;};if(localDayKey(startsAt)!==localDayKey(endsAt)||localMinutesOfDay(startsAt)<toMinutes(schedule.rows[0].available_from)||localMinutesOfDay(endsAt)>toMinutes(schedule.rows[0].available_until))return res.status(400).json({message:`Este espaço pode ser reservado somente entre ${schedule.rows[0].available_from.slice(0,5)} e ${schedule.rows[0].available_until.slice(0,5)}, no mesmo dia.`});
  const reservation=await withTransaction(async client=>{await client.query(`select pg_advisory_xact_lock(hashtext($1))`,[spaceId]);const space=await client.query<any>(`select id,name from reservable_spaces where id=$1 and condominium_id=$2 and active=true`,[spaceId,condominiumId]);if(!space.rows[0])throw Object.assign(new Error('Espaço indisponível.'),{status:404});const conflict=await client.query(`select id from space_reservations where space_id=$1 and status in ('pending','approved') and starts_at<$3 and ends_at>$2 union all select id from space_schedule_blocks where space_id=$1 and starts_at<$3 and ends_at>$2 limit 1`,[spaceId,startsAt,endsAt]);if(conflict.rows[0])throw Object.assign(new Error('Este horário está ocupado, bloqueado ou aguardando aprovação.'),{status:409});const created=await client.query<any>(`insert into space_reservations(id,condominium_id,space_id,requested_by,starts_at,ends_at,purpose) values($1,$2,$3,$4,$5,$6,$7) returning *`,[randomUUID(),condominiumId,spaceId,req.user?.id,startsAt,endsAt,purpose||null]);return {...created.rows[0],space_name:space.rows[0].name};}).catch((error:any)=>{if(error.status)return null;throw error;});
  if(!reservation){const conflict=await query(`select 1 from reservable_spaces where id=$1 and condominium_id=$2 and active=true`,[spaceId,condominiumId]);return res.status(conflict.rows[0]?409:404).json({message:conflict.rows[0]?'Este horário já está ocupado ou aguardando aprovação.':'Espaço indisponível.'});}
  await notifyManagers(condominiumId,req.user!.id,'Nova solicitação de reserva',`${req.user?.fullName||req.user?.username} solicitou o espaço ${reservation.space_name}.`);await logAudit(req,'reserva_espacos','reservation_requested','Solicitou uma reserva',{entityId:reservation.id});return res.status(201).json({reservation});
}));

router.patch('/reservations/:id/review',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const status=String(req.body?.status||'');const note=String(req.body?.note||'').trim();if(!['approved','rejected'].includes(status))return res.status(400).json({message:'Decisão inválida.'});if(status==='rejected'&&(note.length<3||note.length>500))return res.status(400).json({message:'Informe a justificativa da rejeição (3 a 500 caracteres).'});
  const reservation=await withTransaction(async client=>{const current=await client.query<any>(`select r.*,s.name space_name from space_reservations r join reservable_spaces s on s.id=r.space_id where r.id=$1 and r.condominium_id=$2 and r.status='pending' for update`,[req.params.id,req.user?.condominiumId]);if(!current.rows[0])return null;if(status==='approved'){await client.query(`select pg_advisory_xact_lock(hashtext($1))`,[current.rows[0].space_id]);const conflict=await client.query(`select id from space_reservations where space_id=$1 and id<>$2 and status='approved' and starts_at<$4 and ends_at>$3 limit 1`,[current.rows[0].space_id,req.params.id,current.rows[0].starts_at,current.rows[0].ends_at]);if(conflict.rows[0])throw Object.assign(new Error('Outro horário aprovado entrou em conflito com esta solicitação.'),{status:409});}const updated=await client.query<any>(`update space_reservations set status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() where id=$4 returning *`,[status,note||null,req.user?.id,req.params.id]);return {...updated.rows[0],space_name:current.rows[0].space_name};});if(!reservation)return res.status(409).json({message:'Solicitação não encontrada ou já analisada.'});await notifyUsers({condominiumId:req.user!.condominiumId!,senderId:req.user?.id,recipientIds:[reservation.requested_by],title:status==='approved'?'Reserva aprovada':'Reserva não aprovada',body:status==='approved'?`${reservation.space_name}: sua reserva foi confirmada.`:`${reservation.space_name}: sua solicitação foi rejeitada. Justificativa: ${note}`,screen:'SpaceReservations'});await logAudit(req,'reserva_espacos',`reservation_${status}`,'Analisou uma solicitação de reserva',{entityId:req.params.id});return res.json({reservation});
}));

router.patch('/reservations/:id/cancel',asyncHandler(async(req,res)=>{
  const isManager=manager(req.user?.role);const result=await query<any>(`update space_reservations set status='canceled',updated_at=now() where id=$1 and condominium_id=$2 and status in ('pending','approved') and ($3 or requested_by=$4) returning *`,[req.params.id,req.user?.condominiumId,isManager,req.user?.id]);if(!result.rows[0])return res.status(409).json({message:'Reserva não encontrada ou não pode mais ser cancelada.'});
  const space=await query<{name:string}>(`select name from reservable_spaces where id=$1`,[result.rows[0].space_id]);const spaceName=space.rows[0]?.name||'espaço reservado';
  if(isManager)await notifyUsers({condominiumId:req.user!.condominiumId!,senderId:req.user?.id,recipientIds:[result.rows[0].requested_by],title:'Reserva cancelada',body:`A administração cancelou sua reserva de ${spaceName}.`,screen:'SpaceReservations'});else await notifyManagers(req.user!.condominiumId!,req.user!.id,'Reserva cancelada pelo morador',`${req.user?.fullName||req.user?.username} cancelou uma reserva de ${spaceName}.`);
  await logAudit(req,'reserva_espacos','reservation_canceled','Cancelou uma reserva',{entityId:req.params.id});return res.json({reservation:result.rows[0]});
}));

export default router;
