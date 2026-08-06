import { query } from '../db';

export type MonetaryCorrectionIndex = 'IGPM' | 'INPC' | 'FIXED';

// Parâmetros do artigo do regimento — sempre vêm de uma linha específica de
// regulation_articles (ou do article_snapshot congelado numa notificação já
// emitida). Nunca existe um "artigo padrão" implícito nesta função.
export interface RegulationArticleInput {
  baseFinePercent: number;
  paymentDeadlineDays: number;
  lateInterestPercentMonth: number;
  monetaryCorrectionIndex: MonetaryCorrectionIndex;
  fixedMonthlyCorrectionPercent: number | null;
  reiterationDailyPercent: number;
}

export interface FineCalculationContext {
  taxaCondominialCents: number;
  isRecurrence: boolean;
  daysLate: number;
  daysOngoing: number;
  lastFineAmountCents: number;
  // Resolvido fora da função pura, via economic_indexes, quando o índice do
  // artigo é IGPM/INPC. null = índice do mês ainda não cadastrado.
  monthlyCorrectionRatePercent: number | null;
}

export interface FineBreakdown {
  baseFineCents: number;
  recurrenceDoublingCents: number;
  lateInterestCents: number;
  monetaryCorrectionCents: number;
  reiterationCents: number;
  totalCents: number;
  correctionPending: boolean;
}

export const calculateInfractionFine = (
  article: RegulationArticleInput,
  context: FineCalculationContext,
): FineBreakdown => {
  const baseFineCents = Math.round((article.baseFinePercent / 100) * context.taxaCondominialCents);
  const recurrenceDoublingCents = context.isRecurrence ? baseFineCents : 0;
  const fineBasis = baseFineCents + recurrenceDoublingCents;

  const lateInterestCents = context.daysLate > 0
    ? Math.round(fineBasis * (article.lateInterestPercentMonth / 100 / 30) * context.daysLate)
    : 0;

  let monetaryCorrectionCents = 0;
  let correctionPending = false;
  if (context.daysLate > 0) {
    const monthlyCorrectionRate = article.monetaryCorrectionIndex === 'FIXED'
      ? article.fixedMonthlyCorrectionPercent
      : context.monthlyCorrectionRatePercent;
    if (monthlyCorrectionRate === null || monthlyCorrectionRate === undefined) {
      correctionPending = article.monetaryCorrectionIndex !== 'FIXED';
    } else {
      monetaryCorrectionCents = Math.round(fineBasis * (monthlyCorrectionRate / 100 / 30) * context.daysLate);
    }
  }

  const reiterationCents = context.daysOngoing > 0
    ? Math.round((article.reiterationDailyPercent / 100) * context.lastFineAmountCents * context.daysOngoing)
    : 0;

  const totalCents = baseFineCents + recurrenceDoublingCents + lateInterestCents + monetaryCorrectionCents + reiterationCents;

  return { baseFineCents, recurrenceDoublingCents, lateInterestCents, monetaryCorrectionCents, reiterationCents, totalCents, correctionPending };
};

// --- Wrappers com acesso a banco (não-puros, mantidos separados da matemática acima) ---

export const getMonthlyCorrectionRate = async (
  indexName: 'IGPM' | 'INPC',
  referenceMonth: string, // 'YYYY-MM-01'
): Promise<number | null> => {
  const result = await query<{ monthly_percent: string }>(
    `select monthly_percent from economic_indexes where index_name=$1 and reference_month=$2`,
    [indexName, referenceMonth],
  );
  const row = result.rows[0];
  return row ? Number(row.monthly_percent) : null;
};

export const resolveTaxaCondominialCents = async (unitId: string, condominiumId: string): Promise<number | null> => {
  const result = await query<{ fee_cents: number }>(
    `select ut.fee_cents from units u join unit_types ut on ut.id=u.unit_type_id
     where u.id=$1 and u.condominium_id=$2 and ut.active=true`,
    [unitId, condominiumId],
  );
  return result.rows[0]?.fee_cents ?? null;
};

export const wasPreviouslyConfirmed = async (
  unitId: string,
  articleId: string,
  condominiumId: string,
  excludeNoticeId?: string,
): Promise<boolean> => {
  const result = await query<{ exists: boolean }>(
    `select exists(
       select 1 from infraction_notices
       where unit_id=$1 and article_id=$2 and condominium_id=$3 and status in ('confirmada','paga')
         and ($4::uuid is null or id<>$4)
     ) "exists"`,
    [unitId, articleId, condominiumId, excludeNoticeId || null],
  );
  return result.rows[0]?.exists ?? false;
};
