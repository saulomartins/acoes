import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { logAudit } from '../services/auditService';
import { notifyUsers } from '../services/notificationService';

const router = Router();
router.use(authenticate);
router.use(requireFeature('regimento_ocorrencias'));

const manager = (role?: string) => role === 'sindico' || role === 'subsindico' || role === 'admin_geral';

const CATEGORIES = ['barulho', 'dano', 'manutencao', 'seguranca', 'conduta', 'outros'];
const STATUSES = ['aberta', 'em_analise', 'respondida', 'resolvida', 'arquivada'];
const categoryLabel: Record<string, string> = { barulho: 'Barulho', dano: 'Dano', manutencao: 'Manutenção', seguranca: 'Segurança', conduta: 'Conduta', outros: 'Outros' };
const statusLabel: Record<string, string> = { aberta: 'Aberta', em_analise: 'Em análise', respondida: 'Respondida', resolvida: 'Resolvida', arquivada: 'Arquivada' };

const ownUnitId = async (userId: string): Promise<string | null> => {
  const result = await query<{ unit_id: string }>(
    `select unit_id from unit_occupancies where user_id=$1 and ended_at is null order by started_at desc limit 1`,
    [userId],
  );
  return result.rows[0]?.unit_id ?? null;
};

const notifyManagers = async (condominiumId: string, senderId: string | undefined, title: string, body: string) => {
  const recipients = await query<{ id: string }>(`select id from users where condominium_id=$1 and login_enabled=true and role in ('sindico','subsindico') and id<>$2`, [condominiumId, senderId || null]);
  await notifyUsers({ condominiumId, senderId, recipientIds: recipients.rows.map(row => row.id), title, body, screen: 'Occurrences' });
};

const notifyReporter = async (condominiumId: string, senderId: string | undefined, reporterId: string, title: string, body: string) => {
  if (reporterId === senderId) return;
  await notifyUsers({ condominiumId, senderId, recipientIds: [reporterId], title, body, screen: 'Occurrences' });
};

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);
  const { status, unitId } = req.query;

  const conditions = ['o.condominium_id=$1'];
  const params: unknown[] = [condominiumId];
  if (!isManager) {
    params.push(req.user?.id);
    conditions.push(`(o.reported_by=$${params.length} or o.unit_id in (select unit_id from unit_occupancies where user_id=$${params.length} and ended_at is null))`);
  }
  if (status && STATUSES.includes(String(status))) { params.push(status); conditions.push(`o.status=$${params.length}`); }
  if (unitId) { params.push(unitId); conditions.push(`o.unit_id=$${params.length}`); }

  const result = await query(
    `select o.id, o.condominium_id, o.unit_id, o.related_unit_id, o.reported_by, o.category, o.description, o.status,
            o.resolved_by, o.resolved_at, o.created_at, o.updated_at,
            reporter.full_name reported_by_name, reporter.username reported_by_username,
            b.name || ' / ' || u.number unit_label
     from occurrences o
     join users reporter on reporter.id=o.reported_by
     left join units u on u.id=o.unit_id
     left join blocks b on b.id=u.block_id
     where ${conditions.join(' and ')}
     order by o.created_at desc`,
    params,
  );
  return res.json({ occurrences: result.rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);

  const occurrence = await query<any>(
    `select o.*, b.name || ' / ' || u.number unit_label from occurrences o
     left join units u on u.id=o.unit_id left join blocks b on b.id=u.block_id
     where o.id=$1 and o.condominium_id=$2`,
    [req.params.id, condominiumId],
  );
  if (!occurrence.rows[0]) return res.status(404).json({ message: 'Ocorrência não encontrada.' });
  if (!isManager) {
    const own = await ownUnitId(req.user!.id);
    if (occurrence.rows[0].reported_by !== req.user?.id && occurrence.rows[0].unit_id !== own) {
      return res.status(403).json({ message: 'Você não tem acesso a esta ocorrência.' });
    }
  }

  const updates = await query(
    `select ou.id, ou.author_id, ou.message, ou.created_at, a.full_name author_name, a.username author_username
     from occurrence_updates ou join users a on a.id=ou.author_id
     where ou.occurrence_id=$1 order by ou.created_at`,
    [req.params.id],
  );
  return res.json({ occurrence: occurrence.rows[0], updates: updates.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const { category, description, unitId, relatedUnitId } = req.body ?? {};
  if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Selecione uma categoria válida.' });
  if (!String(description || '').trim()) return res.status(400).json({ message: 'Descreva a ocorrência.' });

  const resolvedUnitId = unitId || await ownUnitId(req.user!.id);

  const result = await query<any>(
    `insert into occurrences(id, condominium_id, unit_id, related_unit_id, reported_by, category, description)
     values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [randomUUID(), condominiumId, resolvedUnitId || null, relatedUnitId || null, req.user?.id, category, String(description).trim()],
  );
  await logAudit(req, 'ocorrencias', 'created', `Registrou uma ocorrência (${category})`, { entityId: result.rows[0].id });
  await notifyManagers(condominiumId, req.user?.id, 'Nova ocorrência registrada', `Uma nova ocorrência de ${categoryLabel[category] || category} foi registrada e aguarda análise.`);
  return res.status(201).json({ occurrence: result.rows[0] });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);
  const { status, message } = req.body ?? {};

  const occurrence = await query<any>(`select * from occurrences where id=$1 and condominium_id=$2`, [req.params.id, condominiumId]);
  if (!occurrence.rows[0]) return res.status(404).json({ message: 'Ocorrência não encontrada.' });

  if (status) {
    if (!isManager) return res.status(403).json({ message: 'Apenas síndico/subsíndico podem alterar o status.' });
    if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Status inválido.' });
    const resolved = status === 'resolvida';
    await query(
      `update occurrences set status=$1, resolved_by=case when $2 then $3 else resolved_by end, resolved_at=case when $2 then now() else resolved_at end, updated_at=now() where id=$4`,
      [status, resolved, req.user?.id, req.params.id],
    );
    await logAudit(req, 'ocorrencias', 'status_changed', `Alterou o status da ocorrência para ${status}`, { entityId: req.params.id });
    await notifyReporter(condominiumId, req.user?.id, occurrence.rows[0].reported_by, 'Ocorrência atualizada',
      `Sua ocorrência de ${categoryLabel[occurrence.rows[0].category] || occurrence.rows[0].category} agora está: ${statusLabel[status] || status}.`);
  }

  if (message && String(message).trim()) {
    if (!isManager) {
      const own = await ownUnitId(req.user!.id);
      if (occurrence.rows[0].reported_by !== req.user?.id && occurrence.rows[0].unit_id !== own) {
        return res.status(403).json({ message: 'Você não tem acesso a esta ocorrência.' });
      }
    }
    await query(
      `insert into occurrence_updates(id, occurrence_id, author_id, message) values($1,$2,$3,$4)`,
      [randomUUID(), req.params.id, req.user?.id, String(message).trim()],
    );
    if (isManager) {
      await logAudit(req, 'ocorrencias', 'message_added', 'Respondeu uma ocorrência', { entityId: req.params.id });
      await notifyReporter(condominiumId, req.user?.id, occurrence.rows[0].reported_by, 'Nova resposta na sua ocorrência',
        `A administração respondeu sua ocorrência de ${categoryLabel[occurrence.rows[0].category] || occurrence.rows[0].category}.`);
    } else {
      await logAudit(req, 'ocorrencias', 'message_added', 'Adicionou uma mensagem à própria ocorrência', { entityId: req.params.id });
      await notifyManagers(condominiumId, req.user?.id, 'Nova mensagem em ocorrência',
        `Há uma nova mensagem em uma ocorrência de ${categoryLabel[occurrence.rows[0].category] || occurrence.rows[0].category}.`);
    }
  }

  const updated = await query<any>(`select * from occurrences where id=$1`, [req.params.id]);
  return res.json({ occurrence: updated.rows[0] });
}));

export default router;
