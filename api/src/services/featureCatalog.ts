// Catálogo de módulos "por condomínio" que o admin_geral pode ligar/
// desligar, e suas dependências. É uma regra de produto fixa em código —
// não é editável pelo admin_geral, só os valores boolean em
// condominium_features são. Módulos de plataforma (Condomínios, Bancos,
// Planos, Auditoria, etc.) nunca entram aqui: não são "por condomínio".
export type FeatureKey =
  | 'pessoas'
  | 'tipologias'
  | 'blocos_unidades'
  | 'prestacao_contas'
  | 'gestao_cobrancas'
  | 'gestao_debitos'
  | 'historico_acordos'
  | 'config_enviar_cobrancas'
  | 'cobrancas_adicionais'
  | 'painel'
  | 'indicadores_boletos'
  | 'nada_consta'
  | 'avisos_comunicacao'
  | 'relatos_solicitacoes'
  | 'enquetes'
  | 'reserva_espacos'
  | 'regimento_ocorrencias'
  | 'consumo_individualizado';

export const FEATURE_CATALOG: Record<FeatureKey, { label: string; dependsOn: FeatureKey[] }> = {
  pessoas: { label: 'Pessoas', dependsOn: [] },
  tipologias: { label: 'Tipologias', dependsOn: [] },
  blocos_unidades: { label: 'Blocos e unidades', dependsOn: [] },
  prestacao_contas: { label: 'Prestação de contas', dependsOn: [] },
  gestao_cobrancas: { label: 'Gestão de cobranças', dependsOn: ['tipologias', 'blocos_unidades'] },
  gestao_debitos: { label: 'Gestão de débitos', dependsOn: ['gestao_cobrancas'] },
  historico_acordos: { label: 'Histórico de acordos', dependsOn: ['gestao_debitos'] },
  config_enviar_cobrancas: { label: 'Config. e enviar cobranças', dependsOn: ['gestao_cobrancas'] },
  cobrancas_adicionais: { label: 'Cobranças adicionais', dependsOn: ['config_enviar_cobrancas'] },
  // Desligada por padrão mesmo para condomínios novos: cobrança fixa por
  // tipologia continua sendo o padrão, e este módulo só soma consumo em cima
  // dela quando o admin_geral ligar explicitamente para aquele condomínio.
  consumo_individualizado: { label: 'Cobrança por consumo (água/gás/energia)', dependsOn: ['config_enviar_cobrancas'] },
  // Painéis de leitura: só somam os boletos já existentes, então não fazem
  // sentido sem Gestão de cobranças ligada.
  painel: { label: 'Painel financeiro', dependsOn: ['gestao_cobrancas'] },
  indicadores_boletos: { label: 'Indicadores de boletos', dependsOn: ['gestao_cobrancas'] },
  // Depende da cobrança porque a declaração afirma quitação de débitos —
  // sem boletos no sistema não há o que declarar.
  nada_consta: { label: 'Nada consta (quitação)', dependsOn: ['gestao_cobrancas'] },
  avisos_comunicacao: { label: 'Avisos e comunicação', dependsOn: [] },
  relatos_solicitacoes: { label: 'Relatos e solicitações', dependsOn: [] },
  enquetes: { label: 'Enquetes', dependsOn: ['pessoas', 'blocos_unidades'] },
  reserva_espacos: { label: 'Reserva de espaços', dependsOn: ['pessoas', 'blocos_unidades'] },
  regimento_ocorrencias: { label: 'Regimento e Ocorrências', dependsOn: ['gestao_cobrancas', 'tipologias', 'blocos_unidades'] },
};

export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as FeatureKey[];

// Ponto de partida de um condomínio recém-cadastrado — só se aplica a
// condomínios novos (a linha é criada explicitamente no POST /condominiums).
// Condomínios que já existiam antes desta feature não têm linha em
// condominium_features e continuam resolvendo tudo como ativo (ver
// requireFeature e GET /condominiums/:id/features) — essa constante nunca
// afeta esse comportamento.
export const NEW_CONDOMINIUM_FEATURE_DEFAULTS: Record<FeatureKey, boolean> = {
  pessoas: true,
  tipologias: true,
  blocos_unidades: true,
  prestacao_contas: true,
  avisos_comunicacao: true,
  relatos_solicitacoes: false,
  enquetes: false,
  reserva_espacos: false,
  gestao_cobrancas: true,
  config_enviar_cobrancas: true,
  painel: true,
  indicadores_boletos: true,
  nada_consta: true,
  gestao_debitos: false,
  historico_acordos: false,
  cobrancas_adicionais: false,
  regimento_ocorrencias: false,
  consumo_individualizado: false,
};

export const isFeatureKey = (value: unknown): value is FeatureKey =>
  typeof value === 'string' && FEATURE_KEYS.includes(value as FeatureKey);

// Todos os módulos que declaram `feature` como dependência direta.
export const dependentsOf = (feature: FeatureKey): FeatureKey[] =>
  FEATURE_KEYS.filter(key => FEATURE_CATALOG[key].dependsOn.includes(feature));
