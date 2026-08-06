// Modelo inicial opcional oferecido no onboarding de um condomínio novo sem
// nenhum artigo cadastrado. Usado apenas pelo endpoint opt-in
// POST /regulation-articles/apply-template — nunca importado pelo motor de
// cálculo nem por nenhuma rota como fallback implícito. Depois de aplicado,
// os valores viram linhas normais de regulation_articles, editáveis livremente.
export interface RegulationArticleTemplateItem {
  articleNumber: string;
  description: string;
  baseFinePercent: number;
  paymentDeadlineDays: number;
  lateInterestPercentMonth: number;
  monetaryCorrectionIndex: 'FIXED';
  fixedMonthlyCorrectionPercent: number;
  reiterationDailyPercent: number;
  acknowledgmentToleranceDays: number | null;
}

export const STARTER_REGULATION_TEMPLATE: RegulationArticleTemplateItem[] = [
  {
    articleNumber: 'Art. 1',
    description: 'Perturbação do sossego (barulho excessivo fora do horário permitido).',
    baseFinePercent: 30,
    paymentDeadlineDays: 10,
    lateInterestPercentMonth: 2,
    monetaryCorrectionIndex: 'FIXED',
    fixedMonthlyCorrectionPercent: 0,
    reiterationDailyPercent: 10,
    acknowledgmentToleranceDays: 5,
  },
  {
    articleNumber: 'Art. 2',
    description: 'Uso indevido ou dano a áreas comuns.',
    baseFinePercent: 30,
    paymentDeadlineDays: 10,
    lateInterestPercentMonth: 2,
    monetaryCorrectionIndex: 'FIXED',
    fixedMonthlyCorrectionPercent: 0,
    reiterationDailyPercent: 10,
    acknowledgmentToleranceDays: 5,
  },
  {
    articleNumber: 'Art. 3',
    description: 'Descumprimento das normas de segurança do condomínio.',
    baseFinePercent: 30,
    paymentDeadlineDays: 10,
    lateInterestPercentMonth: 2,
    monetaryCorrectionIndex: 'FIXED',
    fixedMonthlyCorrectionPercent: 0,
    reiterationDailyPercent: 10,
    acknowledgmentToleranceDays: 5,
  },
  {
    articleNumber: 'Art. 4',
    description: 'Conduta inadequada com funcionários ou demais condôminos.',
    baseFinePercent: 30,
    paymentDeadlineDays: 10,
    lateInterestPercentMonth: 2,
    monetaryCorrectionIndex: 'FIXED',
    fixedMonthlyCorrectionPercent: 0,
    reiterationDailyPercent: 10,
    acknowledgmentToleranceDays: 5,
  },
];
