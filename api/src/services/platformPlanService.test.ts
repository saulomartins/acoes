import { describe, expect, it } from 'vitest';
import { computeIncludedOverage, computePlanAmountCents, type PlatformPlan, type PlatformPlanTier } from './platformPlanService';

const basePlan: PlatformPlan = {
  id: 'plan-1',
  plan_type: 'per_active_user',
  price_per_active_user_cents: null,
  minimum_price_cents: 0,
  active_user_metric: 'registered',
  included_quantity: null,
  base_price_cents: null,
  overage_price_cents: null,
};

describe('computePlanAmountCents — per_active_user', () => {
  const plan: PlatformPlan = { ...basePlan, plan_type: 'per_active_user', price_per_active_user_cents: 500, minimum_price_cents: 3000 };

  it('cobra preço por usuário × usuários ativos quando passa do mínimo', () => {
    expect(computePlanAmountCents(plan, [], 10)).toBe(5000);
  });

  it('aplica o valor mínimo quando o por-usuário fica abaixo dele', () => {
    expect(computePlanAmountCents(plan, [], 3)).toBe(3000);
    expect(computePlanAmountCents(plan, [], 0)).toBe(3000);
  });

  it('exatamente no mínimo: cobra o mínimo (sem somar os dois)', () => {
    expect(computePlanAmountCents(plan, [], 6)).toBe(3000);
  });

  it('preço por usuário ausente cai só no mínimo', () => {
    expect(computePlanAmountCents({ ...plan, price_per_active_user_cents: null }, [], 50)).toBe(3000);
  });
});

describe('computePlanAmountCents — tiered_bracket', () => {
  const plan: PlatformPlan = { ...basePlan, plan_type: 'tiered_bracket' };
  const tiers: PlatformPlanTier[] = [
    { plan_id: 'plan-1', min_active_users: 0, max_active_users: 20, price_cents: 9900 },
    { plan_id: 'plan-1', min_active_users: 21, max_active_users: 50, price_cents: 14900 },
    { plan_id: 'plan-1', min_active_users: 51, max_active_users: null, price_cents: 19900 },
  ];

  it('escolhe a faixa que contém a quantidade de usuários', () => {
    expect(computePlanAmountCents(plan, tiers, 10)).toBe(9900);
    expect(computePlanAmountCents(plan, tiers, 35)).toBe(14900);
  });

  it('limites das faixas são inclusivos nas duas pontas', () => {
    expect(computePlanAmountCents(plan, tiers, 0)).toBe(9900);
    expect(computePlanAmountCents(plan, tiers, 20)).toBe(9900);
    expect(computePlanAmountCents(plan, tiers, 21)).toBe(14900);
    expect(computePlanAmountCents(plan, tiers, 50)).toBe(14900);
    expect(computePlanAmountCents(plan, tiers, 51)).toBe(19900);
  });

  it('última faixa sem teto (max null) cobre qualquer quantidade acima', () => {
    expect(computePlanAmountCents(plan, tiers, 10_000)).toBe(19900);
  });

  it('quantidade fora de qualquer faixa (buraco na configuração) dá 0', () => {
    const withGap: PlatformPlanTier[] = [
      { plan_id: 'plan-1', min_active_users: 10, max_active_users: 20, price_cents: 9900 },
    ];
    expect(computePlanAmountCents(plan, withGap, 5)).toBe(0);
    expect(computePlanAmountCents(plan, withGap, 21)).toBe(0);
  });

  it('não depende da ordem em que as faixas chegam', () => {
    expect(computePlanAmountCents(plan, [...tiers].reverse(), 35)).toBe(14900);
  });
});

describe('computePlanAmountCents — included_overage', () => {
  // "Essencial" da proposta comercial (schema.sql): R$99/mês, até 40 incluídos, R$5 por excedente.
  const plan: PlatformPlan = {
    ...basePlan,
    plan_type: 'included_overage',
    included_quantity: 40,
    base_price_cents: 9900,
    overage_price_cents: 500,
  };

  it('até a quantidade incluída cobra só o preço base', () => {
    expect(computePlanAmountCents(plan, [], 0)).toBe(9900);
    expect(computePlanAmountCents(plan, [], 40)).toBe(9900);
  });

  it('cada usuário além do incluído soma a tarifa de excedente', () => {
    expect(computePlanAmountCents(plan, [], 41)).toBe(10400);
    expect(computePlanAmountCents(plan, [], 55)).toBe(9900 + 15 * 500);
  });

  it('bate com computeIncludedOverage (painel do condomínio) em toda a faixa', () => {
    for (let users = 0; users <= 120; users++) {
      const overage = computeIncludedOverage(plan, users);
      expect(computePlanAmountCents(plan, [], users)).toBe(overage.totalAmountCents);
      expect(overage.overageUnits).toBe(Math.max(0, users - 40));
      expect(overage.overageAmountCents).toBe(overage.overageUnits * 500);
    }
  });

  it('campos nulos contam como zero', () => {
    const empty: PlatformPlan = { ...plan, included_quantity: null, base_price_cents: null, overage_price_cents: null };
    expect(computePlanAmountCents(empty, [], 30)).toBe(0);
    expect(computeIncludedOverage({ ...plan, included_quantity: null }, 3)).toEqual({ overageUnits: 3, overageAmountCents: 1500, totalAmountCents: 11400 });
  });
});
