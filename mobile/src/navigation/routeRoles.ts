import type { FeatureKey } from '../context/AuthContext';

// Fonte única de rota -> papéis/feature/descrição, usada pelo tour guiado, pelo
// guard de role (RequireRole) e para decidir quais rotas são "de gestão" (não
// existem no bundle nativo — ver MANAGEMENT_ROUTES abaixo e
// navigation/ManagementStack.web.tsx / .native.tsx).
export type TourStep = { route: string; title: string; description: string; roles: string[]; feature?: FeatureKey };

export const TOUR_STEPS: TourStep[] = [
  { route: 'Home', title: 'Início', description: 'Resumo das informações mais importantes e atalhos para as rotinas do condomínio.', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { route: 'Dashboard', title: 'Painel administrativo', description: 'Indicadores financeiros e operacionais para acompanhar a situação do condomínio.', roles: ['sindico', 'subsindico'] },
  { route: 'UserStats', title: 'Painel de usuários', description: 'Cadastro, acesso e ocupação de cada condomínio — toque em um número para ver quem são.', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'painel_usuarios' },
  { route: 'BillingAnalytics', title: 'Indicadores de boletos', description: 'Recebidos, não pagos e cancelados por período, com os motivos de cancelamento.', roles: ['sindico', 'subsindico'], feature: 'indicadores_boletos' },
  { route: 'Condominiums', title: 'Condomínios', description: 'Cadastro e gestão de todos os condomínios atendidos pela plataforma.', roles: ['admin_geral'] },
  { route: 'Users', title: 'Pessoas', description: 'Cadastro e gestão de síndicos, subsíndicos, proprietários e inquilinos.', roles: ['sindico', 'subsindico'], feature: 'pessoas' },
  { route: 'Banks', title: 'Cadastro de bancos', description: 'Catálogo de bancos disponíveis para integração de cobranças.', roles: ['admin_geral'] },
  { route: 'BankConfigurations', title: 'Configurações bancárias', description: 'Credenciais e parâmetros de cada integração bancária.', roles: ['admin_geral'] },
  { route: 'BankLink', title: 'Vincular banco ao condomínio', description: 'Associação de uma integração bancária a um condomínio específico.', roles: ['admin_geral'] },
  { route: 'BankIntegrationGuide', title: 'Guia de expansão bancária', description: 'Referência para adicionar suporte a um novo banco na plataforma.', roles: ['admin_geral'] },
  { route: 'PlatformPlans', title: 'Planos da plataforma', description: 'Planos comerciais oferecidos aos condomínios clientes.', roles: ['admin_geral'] },
  { route: 'PlatformRevenue', title: 'Faturamento da plataforma', description: 'Receita da plataforma por condomínio e período.', roles: ['admin_geral'] },
  { route: 'PlatformReceipts', title: 'Recebimentos da plataforma', description: 'Faturas cobradas dos condomínios, pagamentos via Pix e confirmações.', roles: ['admin_geral'] },
  { route: 'AuditLog', title: 'Auditoria', description: 'Histórico de ações realizadas por administradores e síndicos no sistema.', roles: ['admin_geral'] },
  { route: 'GoogleDriveIntegrationGuide', title: 'Integração com Google Drive', description: 'Passo a passo para ativar, num condomínio, o envio de comprovantes e anexos para uma pasta do Google Drive.', roles: ['admin_geral'] },
  { route: 'Support', title: 'Suporte', description: 'Localize uma pessoa (síndico/subsíndico só no próprio condomínio; admin_geral em qualquer um) e resolva problemas de acesso: sessão travada, login bloqueado, senha e aceite de termos.', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
  { route: 'UnitTypes', title: 'Tipologias', description: 'Configuração dos tipos de unidade e valores usados nas cobranças.', roles: ['sindico', 'subsindico'], feature: 'tipologias' },
  { route: 'Units', title: 'Blocos e unidades', description: 'Organização dos blocos, apartamentos e moradores vinculados.', roles: ['sindico', 'subsindico'], feature: 'blocos_unidades' },
  { route: 'Clearances', title: 'Nada consta', description: 'Emissão e verificação de certidão negativa de débitos da unidade.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'nada_consta' },
  { route: 'Invoices', title: 'Gestão de cobranças', description: 'Emissão e acompanhamento de boletos, Pix, pagamentos e valores em aberto.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_cobrancas' },
  { route: 'BillingSettings', title: 'Configurar e enviar cobranças', description: 'Regras de vencimento, multa, juros e emissão das cobranças mensais.', roles: ['sindico', 'subsindico'], feature: 'config_enviar_cobrancas' },
  { route: 'UnitExtraCharges', title: 'Cobranças adicionais', description: 'Valores extraordinários por unidade, com parcelas e acompanhamento.', roles: ['sindico', 'subsindico'], feature: 'cobrancas_adicionais' },
  { route: 'UnitConsumption', title: 'Consumo (água/gás/energia)', description: 'Tarifas e lançamento mensal de consumo por unidade, somado ao boleto da taxa condominial.', roles: ['sindico', 'subsindico'], feature: 'consumo_individualizado' },
  { route: 'Debts', title: 'Gestão de débitos', description: 'Consulta, negociação e acompanhamento dos débitos do condomínio.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_debitos' },
  { route: 'AgreementHistory', title: 'Histórico de acordos', description: 'Acordos, parcelas e pagamentos organizados em um único histórico.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'historico_acordos' },
  { route: 'Accountability', title: 'Prestação de contas', description: 'Receitas, despesas, relatórios mensais e comprovantes disponíveis com transparência.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'prestacao_contas' },
  { route: 'Communications', title: 'Avisos e comunicação', description: 'Comunicados da administração, notificações e confirmação de leitura.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'avisos_comunicacao' },
  { route: 'Reports', title: 'Relatos e solicitações', description: 'Canal para registrar pedidos, acompanhar respostas e resolver demandas.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'relatos_solicitacoes' },
  { route: 'Occurrences', title: 'Regimento e ocorrências', description: 'Registro e acompanhamento de ocorrências relacionadas às regras do condomínio.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { route: 'RegulationArticles', title: 'Artigos do regimento', description: 'Consulta e manutenção das regras usadas na gestão de ocorrências.', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  { route: 'InfractionNoticeIssue', title: 'Emitir notificação', description: 'Abertura de notificação de infração a partir de uma ocorrência.', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  { route: 'InfractionNotices', title: 'Notificações de infração', description: 'Acompanhamento de notificações, ciência, defesa e situação de cada processo.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { route: 'Polls', title: 'Enquetes', description: 'Consultas criadas pela gestão para participação dos moradores ativos.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'enquetes' },
  { route: 'SpaceReservations', title: 'Reserva de espaços', description: 'Calendário de disponibilidade e solicitações de reserva das áreas comuns.', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'reserva_espacos' },
  { route: 'MobileReleases', title: 'Instalar aplicativo', description: 'Central com a versão mais recente do app para Android e iOS.', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
];

// Papéis permitidos por rota, para o guard de role (RequireRole). Rota
// ausente aqui (ex.: ClearanceVerify) fica sem restrição.
export const ROLES_BY_ROUTE: Record<string, string[]> = {
  ...TOUR_STEPS.reduce<Record<string, string[]>>((acc, step) => {
    acc[step.route] = step.roles;
    return acc;
  }, {}),
  // BankLink/BankConfigurations/Banks (acima) e BankIntegration compartilham o
  // mesmo componente, apenas com initialParams.section diferente — mesmo
  // acesso restrito.
  BankIntegration: ['admin_geral'],
};

// Rotas que só existem na versão web (fora do binário nativo Android/iOS) —
// qualquer rota cujo papel não inclua morador (proprietario/inquilino) é, por
// definição, uma tela de gestão. Derivado de TOUR_STEPS para não criar mais
// uma lista manual — só BankIntegration precisa de entrada própria, por não
// ter linha no tour (só as variantes Banks/BankConfigurations/BankLink têm).
export const MANAGEMENT_ROUTES: Set<string> = new Set([
  ...TOUR_STEPS.filter(step => !step.roles.includes('proprietario') && !step.roles.includes('inquilino')).map(step => step.route),
  'BankIntegration',
]);
