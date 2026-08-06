export type PlatformPlanType = 'per_active_user' | 'tiered_bracket';

import { query } from '../db';

export type ActiveUserMetric = 'login_enabled' | 'registered';

export type PlatformPlan = {
  id: string;
  plan_type: PlatformPlanType;
  price_per_active_user_cents: number | null;
  minimum_price_cents: number;
  active_user_metric: ActiveUserMetric;
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

  const tier = tiers.find(
    (item) => activeUsers >= item.min_active_users && (item.max_active_users === null || activeUsers <= item.max_active_users),
  );

  return tier ? tier.price_cents : 0;
};

export const countActiveUsers = async (condominiumId: string, metric: ActiveUserMetric): Promise<number> => {
  const loginFilter = metric === 'login_enabled' ? 'and login_enabled = true' : '';
  const result = await query<{ count: number }>(
    `select count(*)::int as count from users where condominium_id=$1 and deleted_at is null ${loginFilter}`,
    [condominiumId],
  );
  return result.rows[0]?.count || 0;
};
