import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { notifyUsers } from '../services/notificationService';
import { logAudit } from '../services/auditService';
import {
  calculateInfractionFine, getMonthlyCorrectionRate, resolveTaxaCondominialCents, wasPreviouslyConfirmed,
  type FineBreakdown, type RegulationArticleInput,
} from '../services/infractionFineService';

const router = Router();
router.use(authenticate);
router.use(requireFeature('regimento_ocorrencias'));

// Notificação de infração pertence ao condomínio; admin_geral não tem um
// (condominium_id nulo), então não entra como gestor deste módulo.
const manager = (role?: string) => role === 'sindico' || role === 'subsindico';

type ArticleSnapshot = RegulationArticleInput & { articleNumber: string; description: string; acknowledgmentToleranceDays: number | null };

const toSnapshot = (article: any): ArticleSnapshot => ({
  articleNumber: article.article_number,
  description: article.description,
  baseFinePercent: Number(article.base_fine_percent),
  paymentDeadlineDays: Number(article.payment_deadline_days),
  lateInterestPercentMonth: Number(article.late_interest_percent_month),
  monetaryCorrectionIndex: article.monetary_correction_index,
  fixedMonthlyCorrectionPercent: article.fixed_monthly_correction_percent != null ? Number(article.fixed_monthly_correction_percent) : null,
  reiterationDailyPercent: Number(article.reiteration_daily_percent),
  acknowledgmentToleranceDays: article.acknowledgment_tolerance_days != null ? Number(article.acknowledgment_tolerance_days) : null,
});

const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000));
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = (date: string) => `${date.slice(0, 7)}-01`;

const notifyUnit = async (condominiumId: string, senderId: string | undefined, unitId: string, title: string, body: string) => {
  const recipients = await query<{ id: string }>(`select user_id id from unit_occupancies where unit_id=$1 and ended_at is null`, [unitId]);
  await notifyUsers({ condominiumId, senderId, recipientIds: recipients.rows.map(row => row.id), title, body, screen: 'InfractionNotices' });
};

const notifyManagers = async (condominiumId: string, senderId: string | undefined, title: string, body: string) => {
  const recipients = await query<{ id: string }>(`select id from users where condominium_id=$1 and login_enabled=true and role in ('sindico','subsindico')`, [condominiumId]);
  await notifyUsers({ condominiumId, senderId, recipientIds: recipients.rows.map(row => row.id), title, body, screen: 'InfractionNotices' });
};

const resolveDaysLate = (dueDate: string | null): number => dueDate && todayIso() > dueDate ? daysBetween(dueDate, todayIso()) : 0;
const resolveDaysOngoing = (ongoingSince: string | null, ceasedAt: string | null): number => ongoingSince ? daysBetween(ongoingSince, ceasedAt || todayIso()) : 0;

const resolveMonthlyCorrectionRate = async (snapshot: ArticleSnapshot): Promise<number | null> => {
  if (snapshot.monetaryCorrectionIndex === 'FIXED') return snapshot.fixedMonthlyCorrectionPercent;
  return getMonthlyCorrectionRate(snapshot.monetaryCorrectionIndex, monthStartIso(todayIso()));
};

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const { unitId, articleId, description, occurrenceId } = req.body ?? {};
  if (!unitId) return res.status(400).json({ message: 'Selecione a unidade.' });
  if (!articleId) return res.status(400).json({ message: 'Selecione o artigo do regimento.' });
  if (!String(description || '').trim()) return res.status(400).json({ message: 'Descreva a infração.' });

  const article = await query<any>(`select * from regulation_articles where id=$1 and condominium_id=$2 and active=true`, [articleId, condominiumId]);
  if (!article.rows[0]) return res.status(404).json({ message: 'Artigo do regimento não encontrado ou inativo.' });

  const taxaCondominialCents = await resolveTaxaCondominialCents(unitId, condominiumId);
  if (!taxaCondominialCents) return res.status(409).json({ message: 'A unidade selecionada não tem uma tipologia ativa com valor de taxa condominial configurado.' });

  const isRecurrence = await wasPreviouslyConfirmed(unitId, articleId, condominiumId);
  const snapshot = toSnapshot(article.rows[0]);

  const breakdown = calculateInfractionFine(snapshot, {
    taxaCondominialCents, isRecurrence, daysLate: 0, daysOngoing: 0, lastFineAmountCents: 0, monthlyCorrectionRatePercent: null,
  });

  const result = await query<any>(
    `insert into infraction_notices(
       id, condominium_id, unit_id, article_id, occurrence_id, issued_by, description, is_recurrence,
       article_snapshot, taxa_condominial_cents_snapshot, base_fine_amount_cents
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [randomUUID(), condominiumId, unitId, articleId, occurrenceId || null, req.user?.id, String(description).trim(), isRecurrence,
      JSON.stringify(snapshot), taxaCondominialCents, breakdown.totalCents],
  );
  await logAudit(req, 'notificacoes_infracao', 'created', `Criou notificação de infração (${snapshot.articleNumber})`, { entityId: result.rows[0].id });
  return res.status(201).json({ notice: result.rows[0], fineBreakdown: breakdown });
}));

router.post('/:id/send', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const result = await query<any>(
    `update infraction_notices set status='enviada', sent_at=now(), updated_at=now()
     where id=$1 and condominium_id=$2 and status='rascunho' returning *`,
    [req.params.id, condominiumId],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'Esta notificação não está disponível para envio.' });
  const snapshot = result.rows[0].article_snapshot as ArticleSnapshot;
  await notifyUnit(condominiumId, req.user?.id, result.rows[0].unit_id,
    'Notificação de infração', `Você recebeu uma notificação referente ao ${snapshot.articleNumber} do regimento interno. Abra o app para dar ciência.`);
  await logAudit(req, 'notificacoes_infracao', 'sent', `Enviou notificação de infração (${snapshot.articleNumber})`, { entityId: result.rows[0].id });
  return res.json({ notice: result.rows[0] });
}));

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });

  // Preenche ciência automática por tolerância configurada no artigo (D6) —
  // recompute preguiçoso, sem cron, mesmo padrão de debt_agreements.
  await query(
    `update infraction_notices set
       acknowledged_at = sent_at + ((article_snapshot->>'acknowledgmentToleranceDays')::int || ' days')::interval,
       acknowledged_auto = true,
       due_date = (sent_at + ((article_snapshot->>'acknowledgmentToleranceDays')::int || ' days')::interval)::date
         + (article_snapshot->>'paymentDeadlineDays')::int,
       updated_at = now()
     where condominium_id=$1 and status='enviada' and acknowledged_at is null
       and (article_snapshot->>'acknowledgmentToleranceDays') is not null
       and (article_snapshot->>'acknowledgmentToleranceDays')::int > 0
       and sent_at + ((article_snapshot->>'acknowledgmentToleranceDays')::int || ' days')::interval <= now()`,
    [condominiumId],
  );

  // A defesa (em_defesa) abre automaticamente assim que há ciência — manual
  // ou por tolerância. É o único caminho para confirmada: nenhum condomínio
  // consegue pular esse passo (exigência do art. 1337 do Código Civil).
  await query(
    `update infraction_notices set status='em_defesa', updated_at=now()
     where condominium_id=$1 and status='enviada' and acknowledged_at is not null`,
    [condominiumId],
  );

  const isManager = manager(req.user?.role);
  const { status, unitId } = req.query;
  const conditions = ['n.condominium_id=$1'];
  const params: unknown[] = [condominiumId];
  if (!isManager) {
    params.push(req.user?.id);
    conditions.push(`n.unit_id in (select unit_id from unit_occupancies where user_id=$${params.length} and ended_at is null)`);
  }
  if (status) { params.push(status); conditions.push(`n.status=$${params.length}`); }
  if (unitId) { params.push(unitId); conditions.push(`n.unit_id=$${params.length}`); }

  const result = await query(
    `select n.*, b.name || ' / ' || u.number unit_label, issuer.full_name issued_by_name
     from infraction_notices n
     left join units u on u.id=n.unit_id left join blocks b on b.id=u.block_id
     left join users issuer on issuer.id=n.issued_by
     where ${conditions.join(' and ')} order by n.created_at desc`,
    params,
  );
  return res.json({ notices: result.rows });
}));

router.get('/:id/fine-detail', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);

  const notice = await query<any>(`select * from infraction_notices where id=$1 and condominium_id=$2`, [req.params.id, condominiumId]);
  if (!notice.rows[0]) return res.status(404).json({ message: 'Notificação não encontrada.' });
  if (!isManager) {
    const own = await query<{ unit_id: string }>(`select unit_id from unit_occupancies where user_id=$1 and ended_at is null`, [req.user?.id]);
    if (!own.rows.some(row => row.unit_id === notice.rows[0].unit_id)) return res.status(403).json({ message: 'Você não tem acesso a esta notificação.' });
  }

  const snapshot = notice.rows[0].article_snapshot as ArticleSnapshot;
  const monthlyCorrectionRatePercent = await resolveMonthlyCorrectionRate(snapshot);
  const previousFine = notice.rows[0].previous_notice_id
    ? await query<{ final_fine_amount_cents: number | null; base_fine_amount_cents: number }>(`select final_fine_amount_cents, base_fine_amount_cents from infraction_notices where id=$1`, [notice.rows[0].previous_notice_id])
    : null;
  const lastFineAmountCents = previousFine?.rows[0]
    ? (previousFine.rows[0].final_fine_amount_cents ?? previousFine.rows[0].base_fine_amount_cents)
    : notice.rows[0].base_fine_amount_cents;

  const breakdown: FineBreakdown = calculateInfractionFine(snapshot, {
    taxaCondominialCents: notice.rows[0].taxa_condominial_cents_snapshot,
    isRecurrence: notice.rows[0].is_recurrence,
    daysLate: resolveDaysLate(notice.rows[0].due_date),
    daysOngoing: resolveDaysOngoing(notice.rows[0].ongoing_since, notice.rows[0].ceased_at),
    lastFineAmountCents,
    monthlyCorrectionRatePercent,
  });
  return res.json({ notice: notice.rows[0], article: snapshot, fineBreakdown: breakdown });
}));

router.post('/:id/acknowledge', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const result = await query<any>(
    `update infraction_notices set
       acknowledged_at=now(),
       due_date=current_date + (article_snapshot->>'paymentDeadlineDays')::int,
       updated_at=now()
     where id=$1 and condominium_id=$2 and status='enviada' and acknowledged_at is null
       and unit_id in (select unit_id from unit_occupancies where user_id=$3 and ended_at is null)
     returning *`,
    [req.params.id, condominiumId, req.user?.id],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'Esta notificação não está disponível para dar ciência.' });
  await logAudit(req, 'notificacoes_infracao', 'acknowledged', 'Deu ciência de uma notificação de infração', { entityId: result.rows[0].id });
  return res.json({ notice: result.rows[0] });
}));

router.post('/:id/contest', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const { defenseText } = req.body ?? {};
  if (!String(defenseText || '').trim()) return res.status(400).json({ message: 'Descreva sua defesa/contestação.' });

  const result = await query<any>(
    `update infraction_notices set defense_text=$1, defense_submitted_at=now(), updated_at=now()
     where id=$2 and condominium_id=$3 and status='em_defesa'
       and (due_date is null or current_date <= due_date)
       and unit_id in (select unit_id from unit_occupancies where user_id=$4 and ended_at is null)
     returning *`,
    [String(defenseText).trim(), req.params.id, condominiumId, req.user?.id],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'Esta notificação não está mais no prazo de defesa.' });
  const snapshot = result.rows[0].article_snapshot as ArticleSnapshot;
  await logAudit(req, 'notificacoes_infracao', 'contested', `Contestou notificação de infração (${snapshot.articleNumber})`, { entityId: result.rows[0].id });
  await notifyManagers(condominiumId, req.user?.id, 'Defesa recebida', `Uma defesa foi enviada para a notificação referente ao ${snapshot.articleNumber}. Analise antes de confirmar.`);
  return res.json({ notice: result.rows[0] });
}));

router.post('/:id/confirm', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });

  // A cláusula status='em_defesa' abaixo é o que torna esse passo obrigatório
  // por construção: não há como confirmar a partir de 'rascunho'/'enviada'.
  const notice = await query<any>(`select * from infraction_notices where id=$1 and condominium_id=$2 and status='em_defesa'`, [req.params.id, condominiumId]);
  if (!notice.rows[0]) return res.status(409).json({ message: 'Esta notificação não está na fase de defesa e não pode ser confirmada.' });

  const snapshot = notice.rows[0].article_snapshot as ArticleSnapshot;
  const monthlyCorrectionRatePercent = await resolveMonthlyCorrectionRate(snapshot);
  if (snapshot.monetaryCorrectionIndex !== 'FIXED' && monthlyCorrectionRatePercent === null && resolveDaysLate(notice.rows[0].due_date) > 0) {
    return res.status(409).json({ message: `O índice ${snapshot.monetaryCorrectionIndex} ainda não foi cadastrado para o mês atual. Cadastre-o em Índices econômicos antes de confirmar.` });
  }

  const previousFine = notice.rows[0].previous_notice_id
    ? await query<{ final_fine_amount_cents: number | null; base_fine_amount_cents: number }>(`select final_fine_amount_cents, base_fine_amount_cents from infraction_notices where id=$1`, [notice.rows[0].previous_notice_id])
    : null;
  const lastFineAmountCents = previousFine?.rows[0]
    ? (previousFine.rows[0].final_fine_amount_cents ?? previousFine.rows[0].base_fine_amount_cents)
    : notice.rows[0].base_fine_amount_cents;

  const breakdown = calculateInfractionFine(snapshot, {
    taxaCondominialCents: notice.rows[0].taxa_condominial_cents_snapshot,
    isRecurrence: notice.rows[0].is_recurrence,
    daysLate: resolveDaysLate(notice.rows[0].due_date),
    daysOngoing: resolveDaysOngoing(notice.rows[0].ongoing_since, notice.rows[0].ceased_at),
    lastFineAmountCents,
    monthlyCorrectionRatePercent,
  });

  const billingUser = await query<{ user_id: string }>(
    `select user_id from unit_occupancies where unit_id=$1 and ended_at is null order by is_representative desc, started_at desc limit 1`,
    [notice.rows[0].unit_id],
  );
  if (!billingUser.rows[0]) return res.status(409).json({ message: 'A unidade não tem morador ativo vinculado para receber a cobrança da multa.' });

  const invoiceId = randomUUID();
  let updated: any;
  try {
    updated = await withTransaction(async client => {
      // Reivindica a notificação atomicamente (evita duas confirmações
      // concorrentes) antes de criar a cobrança — billing_charge_id só é
      // gravado depois que o invoice existe, pela ordem da FK.
      const claimed = await client.query<any>(
        `update infraction_notices set status='confirmada', final_fine_amount_cents=$1, updated_at=now()
         where id=$2 and status='em_defesa' returning *`,
        [breakdown.totalCents, req.params.id],
      );
      if (!claimed.rows[0]) throw Object.assign(new Error('concurrent_confirm'), { concurrentConfirm: true });
      await client.query(
        `insert into invoices(id, condominium_id, user_id, amount_cents, due_date, status, provider, invoice_type, infraction_notice_id, notes)
         values($1,$2,$3,$4,current_date,'issued','manual','infraction',$5,$6)`,
        [invoiceId, condominiumId, billingUser.rows[0].user_id, breakdown.totalCents, req.params.id, `Multa regimental – ${snapshot.articleNumber}`],
      );
      const noticeUpdate = await client.query<any>(
        `update infraction_notices set billing_charge_id=$1 where id=$2 returning *`,
        [invoiceId, req.params.id],
      );
      return noticeUpdate.rows[0];
    });
  } catch (error: any) {
    if (error?.concurrentConfirm) return res.status(409).json({ message: 'Esta notificação já foi confirmada em outra requisição.' });
    throw error;
  }

  await logAudit(req, 'notificacoes_infracao', 'confirmed', `Confirmou notificação de infração (${snapshot.articleNumber})`, { entityId: req.params.id, details: breakdown });
  await notifyUnit(condominiumId, req.user?.id, notice.rows[0].unit_id, 'Notificação de infração confirmada',
    `A notificação referente ao ${snapshot.articleNumber} foi confirmada. Uma cobrança separada de multa regimental foi gerada para a sua unidade.`);
  return res.json({ notice: updated, fineBreakdown: breakdown });
}));

router.post('/:id/cancel', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const { cancellationReason } = req.body ?? {};
  if (!String(cancellationReason || '').trim()) return res.status(400).json({ message: 'Informe o motivo do cancelamento.' });

  const result = await query<any>(
    `update infraction_notices set status='cancelada', cancellation_reason=$1, updated_at=now()
     where id=$2 and condominium_id=$3 and status<>'paga' and status<>'cancelada' returning *`,
    [String(cancellationReason).trim(), req.params.id, condominiumId],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'Esta notificação não pode ser cancelada.' });
  await logAudit(req, 'notificacoes_infracao', 'canceled', 'Cancelou uma notificação de infração', { entityId: result.rows[0].id });
  const snapshot = result.rows[0].article_snapshot as ArticleSnapshot;
  await notifyUnit(condominiumId, req.user?.id, result.rows[0].unit_id, 'Notificação de infração cancelada',
    `A notificação referente ao ${snapshot.articleNumber} foi cancelada pela administração.`);
  return res.json({ notice: result.rows[0] });
}));

export default router;
