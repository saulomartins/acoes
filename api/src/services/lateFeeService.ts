import { query } from '../db';

export type FineType = 'NONE' | 'PERCENT' | 'FIXED';
export type InterestType = 'NONE' | 'PERCENT_MONTH' | 'FIXED';

export interface BillingRules {
  fineType: FineType;
  fineValue: number;
  interestType: InterestType;
  interestValue: number;
}

const DEFAULT_RULES: BillingRules = { fineType: 'PERCENT', fineValue: 2, interestType: 'PERCENT_MONTH', interestValue: 1 };

export const getBillingRules = async (condominiumId: string): Promise<BillingRules> => {
  const result = await query<{ fine_type: FineType; fine_value: string; interest_type: InterestType; interest_value: string }>(
    `select fine_type, fine_value, interest_type, interest_value from billing_settings where condominium_id=$1`,
    [condominiumId],
  );
  const row = result.rows[0];
  if (!row) return DEFAULT_RULES;
  return { fineType: row.fine_type, fineValue: Number(row.fine_value), interestType: row.interest_type, interestValue: Number(row.interest_value) };
};

export const calculateLateFee = (rules: BillingRules, principalCents: number, daysLate: number): { fineCents: number; interestCents: number } => {
  if (daysLate <= 0) return { fineCents: 0, interestCents: 0 };
  const fineCents = rules.fineType === 'PERCENT' ? Math.round(principalCents * (rules.fineValue / 100))
    : rules.fineType === 'FIXED' ? Math.round(rules.fineValue * 100)
    : 0;
  const interestCents = rules.interestType === 'PERCENT_MONTH' ? Math.round(principalCents * (rules.interestValue / 100 / 30) * daysLate)
    : rules.interestType === 'FIXED' ? Math.round(rules.interestValue * 100)
    : 0;
  return { fineCents, interestCents };
};

export const dailyInterestPercent = (rules: BillingRules): number => rules.interestType === 'PERCENT_MONTH' ? rules.interestValue / 30 : 0;
