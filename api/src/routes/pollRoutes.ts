import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';
import { notifyUsers } from '../services/notificationService';

const router = Router();
router.use(authenticate);
router.use(requireFeature('enquetes'));

const isManager = (role?: string) => role === 'sindico' || role === 'subsindico';
const residentIsActive = async (userId: string, condominiumId: string) => {
  const result = await query(
    `select 1 from users u
     where u.id=$1 and u.condominium_id=$2 and u.role in ('proprietario','inquilino')
       and u.login_enabled=true and u.deleted_at is null
       and exists (select 1 from unit_occupancies uo join units un on un.id=uo.unit_id
                   where uo.user_id=u.id and uo.ended_at is null and un.active=true and un.condominium_id=$2)`,
    [userId, condominiumId],
  );
  return Boolean(result.rows[0]);
};

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const manager = isManager(req.user?.role);
  const result = await query<any>(
    `select p.id,p.title,p.description,
            case when p.status='open' and p.closes_at is not null and p.closes_at<=now() then 'closed' else p.status end status,
            p.closes_at,p.published_at,p.closed_at,p.created_at,p.created_by,
            coalesce(creator.full_name,creator.username) created_by_name,
            (select count(*)::int from poll_votes v where v.poll_id=p.id) vote_count,
            (select v.option_id from poll_votes v where v.poll_id=p.id and v.user_id=$2) selected_option_id,
            jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'position',o.position,
              'vote_count',case when $3 or p.status in ('closed','canceled') or (p.closes_at is not null and p.closes_at<=now())
                then (select count(*)::int from poll_votes v where v.option_id=o.id) else null end)
              order by o.position) options
     from polls p join poll_options o on o.poll_id=p.id join users creator on creator.id=p.created_by
     where p.condominium_id=$1 and ($3 or p.status<>'draft')
     group by p.id,creator.full_name,creator.username order by p.created_at desc`,
    [condominiumId, req.user?.id, manager],
  );
  return res.json({ polls: result.rows });
}));

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user!.condominiumId!;
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const options = Array.isArray(req.body?.options) ? req.body.options.map((value: unknown) => String(value).trim()).filter(Boolean) : [];
  const closesAt = req.body?.closesAt ? new Date(req.body.closesAt) : null;
  if (title.length < 3 || title.length > 160) return res.status(400).json({ message: 'O título deve ter entre 3 e 160 caracteres.' });
  if (description.length > 2000) return res.status(400).json({ message: 'A descrição deve ter no máximo 2.000 caracteres.' });
  if (options.length < 2 || options.length > 10) return res.status(400).json({ message: 'Informe de 2 a 10 opções.' });
  if (options.some((option: string) => option.length > 200)) return res.status(400).json({ message: 'Cada opção deve ter no máximo 200 caracteres.' });
  if (new Set(options.map((option: string) => option.toLocaleLowerCase('pt-BR'))).size !== options.length) return res.status(400).json({ message: 'As opções não podem ser repetidas.' });
  if (closesAt && (Number.isNaN(closesAt.getTime()) || closesAt <= new Date())) return res.status(400).json({ message: 'O encerramento deve estar no futuro.' });
  const poll = await withTransaction(async client => {
    const created = await client.query<any>(
      `insert into polls(id,condominium_id,title,description,closes_at,created_by) values($1,$2,$3,$4,$5,$6) returning *`,
      [randomUUID(), condominiumId, title, description || null, closesAt, req.user?.id],
    );
    for (let position = 0; position < options.length; position += 1) {
      await client.query(`insert into poll_options(id,poll_id,label,position) values($1,$2,$3,$4)`, [randomUUID(), created.rows[0].id, options[position], position]);
    }
    return created.rows[0];
  });
  await logAudit(req, 'enquetes', 'created', `Criou a enquete ${title}`, { entityId: poll.id });
  return res.status(201).json({ poll });
}));

router.patch('/:id/publish', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user!.condominiumId!;
  const result = await query<any>(
    `update polls set status='open',published_at=now(),updated_at=now()
     where id=$1 and condominium_id=$2 and status='draft' and (closes_at is null or closes_at>now()) returning *`,
    [req.params.id, condominiumId],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'A enquete não está em rascunho ou o prazo já expirou.' });
  const recipients = await query<{ id: string }>(
    `select u.id from users u where u.condominium_id=$1 and u.role in ('proprietario','inquilino') and u.login_enabled=true and u.deleted_at is null
     and exists(select 1 from unit_occupancies uo join units un on un.id=uo.unit_id where uo.user_id=u.id and uo.ended_at is null and un.active=true)`,
    [condominiumId],
  );
  await notifyUsers({ condominiumId, senderId: req.user?.id, recipientIds: recipients.rows.map(row => row.id), title: 'Nova enquete disponível', body: result.rows[0].title, screen: 'Polls' });
  await logAudit(req, 'enquetes', 'published', `Publicou a enquete ${result.rows[0].title}`, { entityId: req.params.id });
  return res.json({ poll: result.rows[0], recipients: recipients.rows.length });
}));

router.patch('/:id/close', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const result = await query<any>(
    `update polls set status='closed',closed_at=now(),updated_at=now() where id=$1 and condominium_id=$2 and status='open' returning *`,
    [req.params.id, req.user?.condominiumId],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'A enquete não está aberta.' });
  await logAudit(req, 'enquetes', 'closed', `Encerrou a enquete ${result.rows[0].title}`, { entityId: req.params.id });
  return res.json({ poll: result.rows[0] });
}));

router.post('/:id/vote', authorize('proprietario', 'inquilino'), asyncHandler(async (req, res) => {
  const condominiumId = req.user!.condominiumId!;
  if (!(await residentIsActive(req.user!.id, condominiumId))) return res.status(403).json({ message: 'Somente moradores ativos vinculados a uma unidade podem votar.' });
  const optionId = String(req.body?.optionId || '');
  const option = await query(
    `select o.id from poll_options o join polls p on p.id=o.poll_id
     where o.id=$1 and p.id=$2 and p.condominium_id=$3 and p.status='open' and (p.closes_at is null or p.closes_at>now())`,
    [optionId, req.params.id, condominiumId],
  );
  if (!option.rows[0]) return res.status(409).json({ message: 'Enquete encerrada ou opção inválida.' });
  try {
    await query(`insert into poll_votes(id,poll_id,option_id,user_id) values($1,$2,$3,$4)`, [randomUUID(), req.params.id, optionId, req.user?.id]);
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ message: 'Você já respondeu esta enquete.' });
    throw error;
  }
  await logAudit(req, 'enquetes', 'voted', 'Respondeu uma enquete', { entityId: req.params.id });
  return res.status(201).json({ message: 'Voto registrado com sucesso.' });
}));

export default router;
