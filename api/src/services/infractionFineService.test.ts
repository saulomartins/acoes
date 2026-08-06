import { describe, expect, it } from 'vitest';
import { calculateInfractionFine, type FineCalculationContext, type RegulationArticleInput } from './infractionFineService';

const baseContext: FineCalculationContext = {
  taxaCondominialCents: 0,
  isRecurrence: false,
  daysLate: 0,
  daysOngoing: 0,
  lastFineAmountCents: 0,
  monthlyCorrectionRatePercent: null,
};

describe('calculateInfractionFine', () => {
  it('condomínio A em dia: multa total é só a multa base do artigo dele', () => {
    const articleA: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 0.5,
      reiterationDailyPercent: 10,
    };
    const result = calculateInfractionFine(articleA, { ...baseContext, taxaCondominialCents: 50000 });
    expect(result.baseFineCents).toBe(15000);
    expect(result.totalCents).toBe(result.baseFineCents);
    expect(result.lateInterestCents).toBe(0);
    expect(result.monetaryCorrectionCents).toBe(0);
    expect(result.reiterationCents).toBe(0);
  });

  it('condomínio A em atraso: juros e correção usam só as taxas desse artigo (2%/0,5% ao mês)', () => {
    const articleA: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 0.5,
      reiterationDailyPercent: 10,
    };
    const result = calculateInfractionFine(articleA, { ...baseContext, taxaCondominialCents: 50000, daysLate: 5 });
    const expectedInterest = Math.round(15000 * (2 / 100 / 30) * 5);
    const expectedCorrection = Math.round(15000 * (0.5 / 100 / 30) * 5);
    expect(result.lateInterestCents).toBe(expectedInterest);
    expect(result.monetaryCorrectionCents).toBe(expectedCorrection);
  });

  it('condomínio B (artigo totalmente diferente) não é afetado pelas taxas do condomínio A', () => {
    const articleB: RegulationArticleInput = {
      baseFinePercent: 8,
      paymentDeadlineDays: 30,
      lateInterestPercentMonth: 0.8,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 1.2,
      reiterationDailyPercent: 3,
    };
    const resultB = calculateInfractionFine(articleB, { ...baseContext, taxaCondominialCents: 120000, daysLate: 5 });

    const articleA: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 0.5,
      reiterationDailyPercent: 10,
    };
    const resultA = calculateInfractionFine(articleA, { ...baseContext, taxaCondominialCents: 50000, daysLate: 5 });

    expect(resultB.baseFineCents).toBe(Math.round(120000 * 0.08));
    expect(resultB.baseFineCents).not.toBe(resultA.baseFineCents);
    expect(resultB.lateInterestCents).not.toBe(resultA.lateInterestCents);
    expect(resultB.monetaryCorrectionCents).not.toBe(resultA.monetaryCorrectionCents);
  });

  it('reincidência dobra a base usando só o percentual do próprio artigo', () => {
    const articleA: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 0.5,
      reiterationDailyPercent: 10,
    };
    const normal = calculateInfractionFine(articleA, { ...baseContext, taxaCondominialCents: 50000 });
    const recurrence = calculateInfractionFine(articleA, { ...baseContext, taxaCondominialCents: 50000, isRecurrence: true });
    expect(recurrence.recurrenceDoublingCents).toBe(normal.baseFineCents);
    expect(recurrence.totalCents).toBe(normal.baseFineCents * 2);
  });

  it('reincidência contínua: só a multa diária de reiteração é diferente de zero', () => {
    const article: RegulationArticleInput = {
      baseFinePercent: 0,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 0,
      monetaryCorrectionIndex: 'FIXED',
      fixedMonthlyCorrectionPercent: 0,
      reiterationDailyPercent: 10,
    };
    const result = calculateInfractionFine(article, { ...baseContext, taxaCondominialCents: 50000, daysOngoing: 7, lastFineAmountCents: 15000 });
    expect(result.reiterationCents).toBe(Math.round((10 / 100) * 15000 * 7));
    expect(result.baseFineCents).toBe(0);
    expect(result.lateInterestCents).toBe(0);
    expect(result.monetaryCorrectionCents).toBe(0);
    expect(result.totalCents).toBe(result.reiterationCents);
  });

  it('IGPM sem taxa cadastrada para o mês: correção fica pendente, nunca cai pra 0% silencioso', () => {
    const article: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'IGPM',
      fixedMonthlyCorrectionPercent: null,
      reiterationDailyPercent: 10,
    };
    const result = calculateInfractionFine(article, { ...baseContext, taxaCondominialCents: 50000, daysLate: 5, monthlyCorrectionRatePercent: null });
    expect(result.monetaryCorrectionCents).toBe(0);
    expect(result.correctionPending).toBe(true);
  });

  it('IGPM com taxa resolvida externamente: usa esse valor, mesma fórmula pro-rata diária do FIXED', () => {
    const article: RegulationArticleInput = {
      baseFinePercent: 30,
      paymentDeadlineDays: 10,
      lateInterestPercentMonth: 2,
      monetaryCorrectionIndex: 'IGPM',
      fixedMonthlyCorrectionPercent: null,
      reiterationDailyPercent: 10,
    };
    const result = calculateInfractionFine(article, { ...baseContext, taxaCondominialCents: 50000, daysLate: 5, monthlyCorrectionRatePercent: 0.35 });
    expect(result.correctionPending).toBe(false);
    expect(result.monetaryCorrectionCents).toBe(Math.round(15000 * (0.35 / 100 / 30) * 5));
  });

  it('dois artigos com a mesma multa base mas prazo/juros diferentes divergem só no termo de juros', () => {
    const shared = { baseFinePercent: 20, monetaryCorrectionIndex: 'FIXED' as const, fixedMonthlyCorrectionPercent: 0, reiterationDailyPercent: 0 };
    const articleX: RegulationArticleInput = { ...shared, paymentDeadlineDays: 10, lateInterestPercentMonth: 1 };
    const articleY: RegulationArticleInput = { ...shared, paymentDeadlineDays: 20, lateInterestPercentMonth: 3 };
    const resultX = calculateInfractionFine(articleX, { ...baseContext, taxaCondominialCents: 80000, daysLate: 4 });
    const resultY = calculateInfractionFine(articleY, { ...baseContext, taxaCondominialCents: 80000, daysLate: 4 });
    expect(resultX.baseFineCents).toBe(resultY.baseFineCents);
    expect(resultX.lateInterestCents).not.toBe(resultY.lateInterestCents);
  });
});
