import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { cancelPlatformInvoice, correctPlatformInvoice, refundPlatformInvoice, generatePlatformInvoices, reissuePlatformInvoicePix, reconcilePlatformInvoices, settlePlatformInvoiceById, resendPlatformInvoiceReceipt, verifyPlatformInvoice } from '../services/platformInvoiceService';
import { computePlanAmountCents, type ActiveUserMetric, type PlatformPlan, type PlatformPlanTier } from '../services/platformPlanService';

const router = Router();
router.use(authenticate, authorize('admin_geral'));

const parseActiveUserMetric = (value: unknown, fallback: ActiveUserMetric): ActiveUserMetric =>
  value === 'login_enabled' || value === 'registered' ? value : fallback;

type TierInput = { minActiveUsers: number; maxActiveUsers: number | null; priceCents: number };

const validateTiers = (tiers: unknown): { sorted: TierInput[] } | { error: string } => {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { error: 'Informe ao menos uma faixa.' };
  }

  const normalized: TierInput[] = tiers.map((item: any) => ({
    minActiveUsers: Number(item?.minActiveUsers),
    maxActiveUsers: item?.maxActiveUsers === null || item?.maxActiveUsers === undefined || item?.maxActiveUsers === '' ? null : Number(item.maxActiveUsers),
    priceCents: Number(item?.priceCents),
  }));

  const sorted = [...normalized].sort((a, b) => a.minActiveUsers - b.minActiveUsers);

  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i];
    if (!Number.isInteger(tier.minActiveUsers) || tier.minActiveUsers < 0) {
      return { error: 'Quantidade mínima de usuários ativos da faixa inválida.' };
    }
    if (tier.maxActiveUsers !== null && (!Number.isInteger(tier.maxActiveUsers) || tier.maxActiveUsers < tier.minActiveUsers)) {
      return { error: 'Quantidade máxima de usuários ativos da faixa inválida.' };
    }
    if (!Number.isFinite(tier.priceCents) || tier.priceCents <= 0) {
      return { error: 'O preço de cada faixa deve ser maior que zero.' };
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.maxActiveUsers === null) {
        return { error: 'Uma faixa sem limite superior não pode ser seguida por outra faixa.' };
      }
      if (tier.minActiveUsers !== prev.maxActiveUsers + 1) {
        return { error: 'As faixas precisam ser contínuas, sem sobreposição ou lacuna entre elas.' };
      }
    }
  }

  return { sorted };
};

type IncludedOverageInput = { includedQuantity: number; basePriceCents: number; overagePriceCents: number };
const validateIncludedOverage = (body: any): IncludedOverageInput | { error: string } => {
  const includedQuantity = Number(body.includedQuantity);
  const basePriceCents = Number(body.basePriceCents);
  const overagePriceCents = Number(body.overagePriceCents);
  if (!Number.isInteger(includedQuantity) || includedQuantity < 0) {
    return { error: 'Quantidade incluída no preço base é inválida.' };
  }
  if (!Number.isFinite(basePriceCents) || basePriceCents <= 0) {
    return { error: 'Informe o preço base mensal.' };
  }
  if (!Number.isFinite(overagePriceCents) || overagePriceCents < 0) {
    return { error: 'O preço por usuário excedente é inválido.' };
  }
  return { includedQuantity, basePriceCents, overagePriceCents };
};

router.get('/', asyncHandler(async (_req, res) => {
  const [plans, tiers] = await Promise.all([
    query(`select * from platform_plans order by created_at desc`),
    query(`select * from platform_plan_tiers order by min_active_users asc`),
  ]);

  const items = plans.rows.map((plan: any) => ({
    ...plan,
    tiers: tiers.rows.filter((tier: any) => tier.plan_id === plan.id),
  }));

  return res.json({ plans: items });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const planType = body.planType;

  if (name.length < 2) {
    return res.status(400).json({ message: 'Informe um nome válido para o plano.' });
  }
  if (planType !== 'per_active_user' && planType !== 'tiered_bracket' && planType !== 'included_overage') {
    return res.status(400).json({ message: 'Tipo de plano inválido.' });
  }

  const activeUserMetric = parseActiveUserMetric(body.activeUserMetric, 'registered');

  if (planType === 'per_active_user') {
    const pricePerActiveUserCents = Number(body.pricePerActiveUserCents);
    const minimumPriceCents = Number(body.minimumPriceCents ?? 0);
    if (!Number.isFinite(pricePerActiveUserCents) || pricePerActiveUserCents <= 0) {
      return res.status(400).json({ message: 'Informe o preço por usuário ativo.' });
    }
    if (!Number.isFinite(minimumPriceCents) || minimumPriceCents < 0) {
      return res.status(400).json({ message: 'O valor mínimo mensal é inválido.' });
    }

    const result = await query(
      `insert into platform_plans (id, name, plan_type, price_per_active_user_cents, minimum_price_cents, active_user_metric, notes, created_by)
       values ($1,$2,'per_active_user',$3,$4,$5,$6,$7) returning *`,
      [randomUUID(), name, pricePerActiveUserCents, minimumPriceCents, activeUserMetric, body.notes || null, req.user?.id],
    );
    return res.status(201).json({ plan: { ...result.rows[0], tiers: [] } });
  }

  if (planType === 'included_overage') {
    const validation = validateIncludedOverage(body);
    if ('error' in validation) {
      return res.status(400).json({ message: validation.error });
    }

    const result = await query(
      `insert into platform_plans (id, name, plan_type, included_quantity, base_price_cents, overage_price_cents, active_user_metric, notes, created_by)
       values ($1,$2,'included_overage',$3,$4,$5,$6,$7,$8) returning *`,
      [randomUUID(), name, validation.includedQuantity, validation.basePriceCents, validation.overagePriceCents, activeUserMetric, body.notes || null, req.user?.id],
    );
    return res.status(201).json({ plan: { ...result.rows[0], tiers: [] } });
  }

  const validation = validateTiers(body.tiers);
  if ('error' in validation) {
    return res.status(400).json({ message: validation.error });
  }

  const plan = await withTransaction(async (client) => {
    const created = await client.query(
      `insert into platform_plans (id, name, plan_type, active_user_metric, notes, created_by)
       values ($1,$2,'tiered_bracket',$3,$4,$5) returning *`,
      [randomUUID(), name, activeUserMetric, body.notes || null, req.user?.id],
    );
    const planRow = created.rows[0];

    const insertedTiers = [];
    for (const tier of validation.sorted) {
      const tierResult = await client.query(
        `insert into platform_plan_tiers (id, plan_id, min_active_users, max_active_users, price_cents)
         values ($1,$2,$3,$4,$5) returning *`,
        [randomUUID(), planRow.id, tier.minActiveUsers, tier.maxActiveUsers, tier.priceCents],
      );
      insertedTiers.push(tierResult.rows[0]);
    }

    return { ...planRow, tiers: insertedTiers };
  });

  return res.status(201).json({ plan });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const existing = await query<any>(`select * from platform_plans where id=$1`, [req.params.id]);
  const current = existing.rows[0];
  if (!current) {
    return res.status(404).json({ message: 'Plano não encontrado.' });
  }

  const name = body.name === undefined ? current.name : String(body.name).trim();
  if (name.length < 2) {
    return res.status(400).json({ message: 'Informe um nome válido para o plano.' });
  }
  const active = typeof body.active === 'boolean' ? body.active : current.active;
  const activeUserMetric = parseActiveUserMetric(body.activeUserMetric, current.active_user_metric);

  if (current.plan_type === 'per_active_user') {
    const pricePerActiveUserCents = body.pricePerActiveUserCents === undefined ? current.price_per_active_user_cents : Number(body.pricePerActiveUserCents);
    const minimumPriceCents = body.minimumPriceCents === undefined ? current.minimum_price_cents : Number(body.minimumPriceCents);
    if (!Number.isFinite(pricePerActiveUserCents) || pricePerActiveUserCents <= 0) {
      return res.status(400).json({ message: 'Informe o preço por usuário ativo.' });
    }
    if (!Number.isFinite(minimumPriceCents) || minimumPriceCents < 0) {
      return res.status(400).json({ message: 'O valor mínimo mensal é inválido.' });
    }

    const result = await query(
      `update platform_plans set name=$2, price_per_active_user_cents=$3, minimum_price_cents=$4, active=$5, active_user_metric=$6, notes=$7, updated_at=now()
       where id=$1 returning *`,
      [req.params.id, name, pricePerActiveUserCents, minimumPriceCents, active, activeUserMetric, body.notes === undefined ? current.notes : body.notes],
    );
    return res.json({ plan: { ...result.rows[0], tiers: [] } });
  }

  if (current.plan_type === 'included_overage') {
    const includedQuantity = body.includedQuantity === undefined ? current.included_quantity : Number(body.includedQuantity);
    const basePriceCents = body.basePriceCents === undefined ? current.base_price_cents : Number(body.basePriceCents);
    const overagePriceCents = body.overagePriceCents === undefined ? current.overage_price_cents : Number(body.overagePriceCents);
    const validation = validateIncludedOverage({ includedQuantity, basePriceCents, overagePriceCents });
    if ('error' in validation) {
      return res.status(400).json({ message: validation.error });
    }

    const result = await query(
      `update platform_plans set name=$2, included_quantity=$3, base_price_cents=$4, overage_price_cents=$5, active=$6, active_user_metric=$7, notes=$8, updated_at=now()
       where id=$1 returning *`,
      [req.params.id, name, validation.includedQuantity, validation.basePriceCents, validation.overagePriceCents, active, activeUserMetric, body.notes === undefined ? current.notes : body.notes],
    );
    return res.json({ plan: { ...result.rows[0], tiers: [] } });
  }

  if (body.tiers === undefined) {
    const result = await query(
      `update platform_plans set name=$2, active=$3, active_user_metric=$4, notes=$5, updated_at=now() where id=$1 returning *`,
      [req.params.id, name, active, activeUserMetric, body.notes === undefined ? current.notes : body.notes],
    );
    const tiers = await query(`select * from platform_plan_tiers where plan_id=$1 order by min_active_users asc`, [req.params.id]);
    return res.json({ plan: { ...result.rows[0], tiers: tiers.rows } });
  }

  const validation = validateTiers(body.tiers);
  if ('error' in validation) {
    return res.status(400).json({ message: validation.error });
  }

  const plan = await withTransaction(async (client) => {
    const updated = await client.query(
      `update platform_plans set name=$2, active=$3, active_user_metric=$4, notes=$5, updated_at=now() where id=$1 returning *`,
      [req.params.id, name, active, activeUserMetric, body.notes === undefined ? current.notes : body.notes],
    );
    await client.query(`delete from platform_plan_tiers where plan_id=$1`, [req.params.id]);

    const insertedTiers = [];
    for (const tier of validation.sorted) {
      const tierResult = await client.query(
        `insert into platform_plan_tiers (id, plan_id, min_active_users, max_active_users, price_cents)
         values ($1,$2,$3,$4,$5) returning *`,
        [randomUUID(), req.params.id, tier.minActiveUsers, tier.maxActiveUsers, tier.priceCents],
      );
      insertedTiers.push(tierResult.rows[0]);
    }

    return { ...updated.rows[0], tiers: insertedTiers };
  });

  return res.json({ plan });
}));

// Botão "Verificar pagamentos" do Faturamento da plataforma: roda a mesma
// reconciliação do job diário e do login, na hora.
router.post('/invoices/reconcile', asyncHandler(async (_req, res) => {
  return res.json(await reconcilePlatformInvoices());
}));

// Gera agora as faturas (com Pix) do mês para todos os condomínios com plano
// e cobrança já iniciada — o mesmo que o job diário faz às 9h.
router.post('/invoices/generate', asyncHandler(async (_req, res) => {
  return res.json(await generatePlatformInvoices());
}));

// Painel "Recebimentos da plataforma": lista as faturas cobradas dos
// condomínios com o estado do Pix e da confirmação, filtrável por situação,
// mês (YYYY-MM) e condomínio, mais os totais recebido/a receber.
router.get('/invoices', asyncHandler(async (req, res) => {
  const status = ['pending', 'sent', 'paid', 'canceled', 'refunded'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? `${req.query.month}-01` : null;
  const condominiumId = String(req.query.condominiumId || '') || null;
  const result = await query<any>(
    `select i.id, i.condominium_id, c.name as condominium_name, p.name as plan_name, i.reference_month, i.active_users, i.amount_cents,
            i.status, i.sent_at, i.paid_at, i.pix_payment_id, (i.pix_copy_paste is not null) as has_pix, i.pix_expires_at,
            i.receipt_sent_at, i.payment_method, i.manual_note, i.created_at,
            i.cancel_reason, i.canceled_at, i.refund_note, i.refunded_at, i.paid_after_canceled_at,
            to_char(i.due_date,'YYYY-MM-DD') as due_date, (i.status in ('pending','sent') and i.due_date < current_date) as overdue
     from platform_invoices i
     join condominiums c on c.id = i.condominium_id
     join platform_plans p on p.id = i.plan_id
     where ($1::text is null or i.status = $1) and ($2::date is null or i.reference_month = $2::date) and ($3::uuid is null or i.condominium_id = $3::uuid)
     order by i.reference_month desc, c.name asc`,
    [status, month, condominiumId],
  );
  const sum = (predicate: (row: any) => boolean) => result.rows.filter(predicate).reduce((total: number, row: any) => total + row.amount_cents, 0);
  return res.json({
    invoices: result.rows,
    summary: {
      receivedCents: sum((row) => row.status === 'paid'),
      openCents: sum((row) => row.status === 'pending' || row.status === 'sent'),
      overdueCents: sum((row) => row.overdue),
      canceledCents: sum((row) => row.status === 'canceled'),
      refundedCents: sum((row) => row.status === 'refunded'),
      count: result.rows.length,
    },
  });
}));

// Consulta essa fatura no Mercado Pago agora e confirma se já foi paga.
router.post('/invoices/:id/verify', asyncHandler(async (req, res) => {
  let outcome;
  try {
    outcome = await verifyPlatformInvoice(req.params.id);
  } catch (error) {
    return res.status(502).json({ message: 'Não foi possível consultar o Mercado Pago agora. Tente novamente.' });
  }
  if (!outcome) return res.status(400).json({ message: 'Esta fatura não tem cobrança Pix para verificar.' });
  return res.json(outcome);
}));

// Confirmação manual: pagamento que chegou por fora do Pix da plataforma
// (transferência direta, dinheiro etc.). Exige uma observação pra ficar o
// registro do porquê; dispara o recibo como qualquer confirmação.
router.post('/invoices/:id/mark-paid', asyncHandler(async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) return res.status(400).json({ message: 'Informe uma observação (ex.: "transferência recebida em 25/09").' });
  const current = await query<{ status: string }>(`select status from platform_invoices where id=$1`, [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ message: 'Fatura não encontrada.' });
  if (current.rows[0].status === 'paid') return res.status(409).json({ message: 'Esta fatura já está paga.' });
  if (current.rows[0].status === 'canceled') return res.status(409).json({ message: 'Fatura cancelada não pode ser marcada como paga.' });
  await settlePlatformInvoiceById(req.params.id, { method: 'manual', note, confirmedBy: req.user?.id || null });
  return res.json({ status: 'paid' });
}));

router.post('/invoices/:id/reissue-pix', asyncHandler(async (req, res) => {
  const outcome = await reissuePlatformInvoicePix(req.params.id);
  if (!outcome.ok) return res.status(409).json({ message: outcome.message });
  return res.json({ ok: true });
}));

router.post('/invoices/:id/resend-receipt', asyncHandler(async (req, res) => {
  const sent = await resendPlatformInvoiceReceipt(req.params.id);
  if (!sent) return res.status(409).json({ message: 'Só é possível reenviar o recibo de uma fatura paga.' });
  return res.json({ sent: true });
}));

const requireReason = (req: any, res: any): string | null => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) { res.status(400).json({ message: 'Informe o motivo (mínimo 5 caracteres) — ele é enviado ao síndico.' }); return null; }
  return reason;
};

router.post('/invoices/:id/cancel', asyncHandler(async (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const outcome = await cancelPlatformInvoice(req.params.id, reason, req.user?.id || null);
  if (!outcome.ok) return res.status(409).json({ message: outcome.message });
  return res.json({ status: 'canceled', pixCanceled: outcome.pixCanceled });
}));

router.post('/invoices/:id/correct', asyncHandler(async (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const outcome = await correctPlatformInvoice(req.params.id, reason, req.user?.id || null);
  if (!outcome.ok) return res.status(409).json({ message: outcome.message });
  return res.json({ canceled: true, pixCanceled: outcome.pixCanceled, created: outcome.created });
}));

router.post('/invoices/:id/refund', asyncHandler(async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 5) return res.status(400).json({ message: 'Informe o motivo do estorno (mínimo 5 caracteres).' });
  const outcome = await refundPlatformInvoice(req.params.id, note);
  if (!outcome.ok) return res.status(409).json({ message: outcome.message });
  return res.json({ status: 'refunded' });
}));


router.get('/overview', asyncHandler(async (_req, res) => {
  const [condominiums, plans, tiers, lastInvoices] = await Promise.all([
    query<any>(
      `select c.id as condominium_id, c.name as condominium_name, c.platform_status,
              coalesce((select count(*)::int from users u where u.condominium_id = c.id and u.deleted_at is null), 0) as registered_users,
              coalesce((select count(*)::int from users u where u.condominium_id = c.id and u.login_enabled = true and u.deleted_at is null), 0) as login_enabled_users,
              s.plan_id, s.started_at as plan_started_at, s.billing_starts_at
       from condominiums c
       left join condominium_plan_subscriptions s on s.condominium_id = c.id and s.ended_at is null
       order by c.name asc`,
    ),
    query<PlatformPlan & { name: string }>(`select * from platform_plans`),
    query<PlatformPlanTier>(`select * from platform_plan_tiers order by min_active_users asc`),
    query<any>(
      `select distinct on (condominium_id) condominium_id, reference_month, amount_cents, status, sent_at
       from platform_invoices
       order by condominium_id, reference_month desc`,
    ),
  ]);
  const lastInvoiceByCondominium = new Map(lastInvoices.rows.map((row) => [row.condominium_id, row]));

  const planById = new Map(plans.rows.map((plan) => [plan.id, plan]));

  let totalProjectedCents = 0;
  const items = condominiums.rows.map((row) => {
    const plan = row.plan_id ? planById.get(row.plan_id) : null;
    const planTiers = plan ? tiers.rows.filter((tier) => tier.plan_id === plan.id) : [];
    const activeUsers = plan?.active_user_metric === 'login_enabled' ? row.login_enabled_users : row.registered_users;
    const amountCents = plan && row.platform_status === 'active' ? computePlanAmountCents(plan, planTiers, activeUsers) : 0;
    totalProjectedCents += amountCents;
    const lastInvoice = lastInvoiceByCondominium.get(row.condominium_id);

    return {
      condominiumId: row.condominium_id,
      condominiumName: row.condominium_name,
      platformStatus: row.platform_status,
      activeUsers,
      plan: plan ? { id: plan.id, name: (plan as any).name, planType: plan.plan_type } : null,
      planStartedAt: row.plan_started_at,
      billingStartsAt: row.billing_starts_at,
      amountCents,
      lastInvoice: lastInvoice ? {
        referenceMonth: lastInvoice.reference_month,
        amountCents: lastInvoice.amount_cents,
        status: lastInvoice.status,
        sentAt: lastInvoice.sent_at,
      } : null,
    };
  });

  return res.json({ items, totalProjectedCents });
}));

export default router;
