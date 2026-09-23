export type PlatformPlanType = 'per_active_user' | 'tiered_bracket' | 'included_overage';

import { query } from '../db';

export type ActiveUserMetric = 'login_enabled' | 'registered';

export type PlatformPlan = {
  id: string;
  plan_type: PlatformPlanType;
  price_per_active_user_cents: number | null;
  minimum_price_cents: number;
  active_user_metric: ActiveUserMetric;
  // Só usados por plan_type='included_overage' — ver comentário em
  // schema.sql perto de "included_quantity".
  included_quantity: number | null;
  base_price_cents: number | null;
  overage_price_cents: number | null;
};

export type PlatformPlanTier = {
  plan_id: string;
  min_active_users: number;
  max_active_users: number | null;
  price_cents: number;
};

export const computePlanAmountCents = (
  plan: PlatformPlan,
  tiers: PlatformPlanTier[],
  activeUsers: number,
): number => {
  if (plan.plan_type === 'per_active_user') {
    const perUser = (plan.price_per_active_user_cents || 0) * activeUsers;
    return Math.max(perUser, plan.minimum_price_cents);
  }

  if (plan.plan_type === 'included_overage') {
    const overageUsers = Math.max(0, activeUsers - (plan.included_quantity || 0));
    return (plan.base_price_cents || 0) + overageUsers * (plan.overage_price_cents || 0);
  }

  const tier = tiers.find(
    (item) => activeUsers >= item.min_active_users && (item.max_active_users === null || activeUsers <= item.max_active_users),
  );

  return tier ? tier.price_cents : 0;
};

// Detalhe do excedente pra plan_type='included_overage' — usado tanto aqui
// (compõe computePlanAmountCents) quanto nos painéis do condomínio
// (condominiumRoutes.ts), pra síndico/subsíndico verem quantos usuários
// passaram do incluído e quanto isso custa a mais, sem duplicar a conta.
export const computeIncludedOverage = (plan: Pick<PlatformPlan, 'included_quantity' | 'base_price_cents' | 'overage_price_cents'>, activeUsers: number) => {
  const includedQuantity = plan.included_quantity || 0;
  const overageUnits = Math.max(0, activeUsers - includedQuantity);
  const overageAmountCents = overageUnits * (plan.overage_price_cents || 0);
  return { overageUnits, overageAmountCents, totalAmountCents: (plan.base_price_cents || 0) + overageAmountCents };
};

export const countActiveUsers = async (condominiumId: string, metric: ActiveUserMetric): Promise<number> => {
  const loginFilter = metric === 'login_enabled' ? 'and login_enabled = true' : '';
  const result = await query<{ count: number }>(
    `select count(*)::int as count from users where condominium_id=$1 and deleted_at is null ${loginFilter}`,
    [condominiumId],
  );
  return result.rows[0]?.count || 0;
};
