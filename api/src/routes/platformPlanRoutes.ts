import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
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
  if (planType !== 'per_active_user' && planType !== 'tiered_bracket') {
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
