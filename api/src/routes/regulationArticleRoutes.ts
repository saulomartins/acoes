import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { logAudit } from '../services/auditService';
import { STARTER_REGULATION_TEMPLATE } from '../db/seeds/regulationArticleTemplate';

const router = Router();
router.use(authenticate);
router.use(requireFeature('regimento_ocorrencias'));
// Regimento é de um condomínio só. admin_geral não tem condominium_id, então
// não há regimento que ele possa gerir — a gestão é sempre local.
router.use(authorize('sindico', 'subsindico'));

// Só síndico/subsíndico chegam aqui, e eles nunca escolhem o condomínio:
// é sempre o próprio, ignorando qualquer valor enviado no corpo/query.
const scopedCondominiumId = (req: any): string | null => req.user?.condominiumId || null;

const COLUMNS = `id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
  late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
  reiteration_daily_percent, acknowledgment_tolerance_days, active, created_at, updated_at`;

const validateArticleBody = (body: any): string | null => {
  const { articleNumber, description, baseFinePercent, paymentDeadlineDays, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent } = body ?? {};
  if (!String(articleNumber || '').trim()) return 'Informe o número do artigo.';
  if (!String(description || '').trim()) return 'Informe a descrição do artigo.';
  if (!Number.isFinite(Number(baseFinePercent)) || Number(baseFinePercent) < 0) return 'Informe um percentual de multa válido.';
  if (!Number.isInteger(Number(paymentDeadlineDays)) || Number(paymentDeadlineDays) <= 0) return 'Informe um prazo de pagamento válido (dias).';
  if (!['IGPM', 'INPC', 'FIXED'].includes(monetaryCorrectionIndex)) return 'Selecione um índice de correção monetária válido.';
  if (monetaryCorrectionIndex === 'FIXED' && !Number.isFinite(Number(fixedMonthlyCorrectionPercent))) {
    return 'Informe o percentual fixo de correção mensal.';
  }
  return null;
};

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const activeFilter = req.query.active === 'all' ? '' : req.query.active === 'false' ? 'and active=false' : 'and active=true';
  const result = await query(
    `select ${COLUMNS} from regulation_articles where condominium_id=$1 ${activeFilter} order by article_number`,
    [condominiumId],
  );
  return res.json({ articles: result.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const error = validateArticleBody(req.body);
  if (error) return res.status(400).json({ message: error });

  const {
    articleNumber, description, baseFinePercent, paymentDeadlineDays,
    lateInterestPercentMonth, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent,
    reiterationDailyPercent, acknowledgmentToleranceDays,
  } = req.body;

  const result = await query<any>(
    `insert into regulation_articles(
       id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
       late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
       reiteration_daily_percent, acknowledgment_tolerance_days, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning ${COLUMNS}`,
    [
      randomUUID(), condominiumId, String(articleNumber).trim(), String(description).trim(),
      Number(baseFinePercent), Number(paymentDeadlineDays), Number(lateInterestPercentMonth) || 0,
      monetaryCorrectionIndex, monetaryCorrectionIndex === 'FIXED' ? Number(fixedMonthlyCorrectionPercent) : null,
      Number(reiterationDailyPercent) || 0, acknowledgmentToleranceDays != null ? Number(acknowledgmentToleranceDays) : null,
      req.user?.id || null,
    ],
  );
  await logAudit(req, 'regimento', 'created', `Cadastrou o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
  return res.status(201).json({ article: result.rows[0] });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await query<{ condominium_id: string }>(`select condominium_id from regulation_articles where id=$1`, [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ message: 'Artigo não encontrado.' });
  if (existing.rows[0].condominium_id !== req.user?.condominiumId) {
    return res.status(403).json({ message: 'Você não tem acesso a este condomínio.' });
  }

  // Desativação isolada não passa pelas mesmas validações de um artigo completo.
  if (Object.keys(req.body ?? {}).length === 1 && typeof req.body?.active === 'boolean') {
    const result = await query<any>(
      `update regulation_articles set active=$1, updated_at=now() where id=$2 returning ${COLUMNS}`,
      [req.body.active, req.params.id],
    );
    await logAudit(req, 'regimento', req.body.active ? 'reactivated' : 'deactivated', `${req.body.active ? 'Reativou' : 'Desativou'} o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
    return res.json({ article: result.rows[0] });
  }

  const error = validateArticleBody(req.body);
  if (error) return res.status(400).json({ message: error });

  const {
    articleNumber, description, baseFinePercent, paymentDeadlineDays,
    lateInterestPercentMonth, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent,
    reiterationDailyPercent, acknowledgmentToleranceDays,
  } = req.body;

  // Importante: isto só altera a configuração viva do artigo. Notificações
  // já emitidas guardam seu próprio article_snapshot e nunca são reescritas
  // por essa atualização — só notificações futuras usam os valores novos.
  const result = await query<any>(
    `update regulation_articles set
       article_number=$1, description=$2, base_fine_percent=$3, payment_deadline_days=$4,
       late_interest_percent_month=$5, monetary_correction_index=$6, fixed_monthly_correction_percent=$7,
       reiteration_daily_percent=$8, acknowledgment_tolerance_days=$9, updated_at=now()
     where id=$10
     returning ${COLUMNS}`,
    [
      String(articleNumber).trim(), String(description).trim(), Number(baseFinePercent), Number(paymentDeadlineDays),
      Number(lateInterestPercentMonth) || 0, monetaryCorrectionIndex, monetaryCorrectionIndex === 'FIXED' ? Number(fixedMonthlyCorrectionPercent) : null,
      Number(reiterationDailyPercent) || 0, acknowledgmentToleranceDays != null ? Number(acknowledgmentToleranceDays) : null,
      req.params.id,
    ],
  );
  await logAudit(req, 'regimento', 'updated', `Editou o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
  return res.json({ article: result.rows[0] });
}));

router.post('/apply-template', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });

  const existing = await query<{ count: string }>(`select count(*)::int count from regulation_articles where condominium_id=$1`, [condominiumId]);
  if (Number(existing.rows[0]?.count) > 0) {
    return res.status(409).json({ message: 'Este condomínio já tem artigos cadastrados. Aplique o modelo apenas em condomínios sem nenhum artigo.' });
  }

  const inserted: any[] = [];
  for (const item of STARTER_REGULATION_TEMPLATE) {
    const result = await query<any>(
      `insert into regulation_articles(
         id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
         late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
         reiteration_daily_percent, acknowledgment_tolerance_days, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning ${COLUMNS}`,
      [
        randomUUID(), condominiumId, item.articleNumber, item.description, item.baseFinePercent, item.paymentDeadlineDays,
        item.lateInterestPercentMonth, item.monetaryCorrectionIndex, item.fixedMonthlyCorrectionPercent,
        item.reiterationDailyPercent, item.acknowledgmentToleranceDays, req.user?.id || null,
      ],
    );
    inserted.push(result.rows[0]);
  }
  await logAudit(req, 'regimento', 'template_applied', `Aplicou o modelo inicial do regimento (${inserted.length} artigos)`, {});
  return res.status(201).json({ articles: inserted });
}));

export default router;
