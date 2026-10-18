// Conteúdo comercial da landing, compartilhado com a Lari (ui/ChatAssistant)
// para o chat nunca prometer algo diferente do que o site mostra.

export type Feature = { title: string; icon: string; description: string; highlight?: string };

// Só o que realmente existe no sistema hoje — nada de módulo genérico de
// template (sem reserva de áreas comuns, assembleias, portaria ou
// fornecedores: isso não está implementado, então não entra aqui).
export const FEATURES: Feature[] = [
  { title: 'Gestão financeira', icon: '$', description: 'Receitas, despesas e saldo do condomínio, sempre atualizados e no automático.', highlight: 'Economia de tempo' },
  { title: 'Cobrança por Pix e boleto', icon: '▤', description: 'Boleto e Pix emitidos direto pelo Banco Inter, com multa, juros e detalhamento de taxas configurados uma vez.' },
  { title: 'Consumo de água, gás e energia', icon: '💧', description: 'Tarifa por condomínio e lançamento mensal de consumo por unidade, somado ao boleto da taxa condominial.', highlight: 'Transparência no consumo' },
  { title: 'Prestação de contas', icon: '◍', description: 'Relatório mensal com comprovantes anexados, claro e disponível para todos os moradores.', highlight: 'Transparência financeira' },
  { title: 'Conselho Fiscal e homologação', icon: '⚖', description: 'Síndico, subsíndico e os dois conselheiros fiscais homologam a prestação de contas, com registro de quem aprovou e as considerações de cada um — inclusive no PDF impresso.', highlight: 'Governança e transparência' },
  { title: 'Gestão de débitos', icon: '↓', description: 'Acordo, parcelamento e edição de débitos antigos para reduzir a inadimplência.', highlight: 'Redução da inadimplência' },
  { title: 'Avisos e comunicação', icon: '◉', description: 'Avisos com confirmação de leitura — sem se perder no grupo de WhatsApp.', highlight: 'Comunicação centralizada' },
  { title: 'Relatos e solicitações', icon: '!', description: 'Morador abre um relato, acompanha e conversa com a administração até resolver.' },
  { title: 'Unidades e moradores', icon: '▦', description: 'Blocos, unidades e moradores cadastrados uma vez, usados no sistema inteiro.' },
  { title: 'APP do Morador', icon: '📱', description: 'Cada morador entra com o próprio login e só vê o que é seu.', highlight: 'Segurança das informações' },
  { title: 'Painel com indicadores', icon: '📊', description: 'Boletos emitidos, pagos e em aberto, sempre visíveis num único painel.' },
  { title: 'Enquetes', icon: '✓', description: 'Síndico e subsíndico publicam consultas e os moradores ativos respondem pelo aplicativo.' },
  { title: 'Reserva de espaços', icon: '⌑', description: 'Agenda visual, horários disponíveis, bloqueios administrativos e aprovação das solicitações.' },
  { title: 'Regimento e ocorrências', icon: '⚑', description: 'Artigos do regimento, registro de ocorrências, respostas e acompanhamento até a resolução.' },
  { title: 'Notificações de infração', icon: '⚠', description: 'Emissão, defesa, confirmação e acompanhamento das notificações do condomínio.' },
  { title: 'Cobranças adicionais', icon: '+', description: 'Cobranças extraordinárias por unidade, com parcelas e acompanhamento integrado.' },
  { title: 'Histórico de acordos', icon: '≋', description: 'Acordos e parcelamentos organizados com situação e histórico de pagamentos.' },
];

export const FEATURE_GROUPS = [
  { title: 'Financeiro e cobranças', description: 'Controle, arrecadação e transparência financeira.', items: ['Gestão financeira','Cobrança por Pix e boleto','Consumo de água, gás e energia','Prestação de contas','Conselho Fiscal e homologação','Gestão de débitos','Cobranças adicionais','Histórico de acordos'] },
  { title: 'Comunicação e participação', description: 'Moradores informados e participando das decisões.', items: ['Avisos e comunicação','Relatos e solicitações','Enquetes','Regimento e ocorrências','Notificações de infração'] },
  { title: 'Operação e experiência', description: 'Rotina administrativa organizada para gestão e moradores.', items: ['Unidades e moradores','Reserva de espaços','APP do Morador','Painel com indicadores'] },
];

export const BENEFITS = [
  { title: 'Menos tarefas manuais. Mais tempo para administrar.', description: 'Cobrança, comunicados e relatórios no automático, liberando sua agenda.', icon: '⏱' },
  { title: 'Todas as informações do condomínio em um só lugar.', description: 'Financeiro, documentos, ocorrências e comunicação, sem sistemas espalhados.', icon: '🗂' },
  { title: 'Mais transparência para o síndico e mais confiança para os moradores.', description: 'Prestação de contas sempre visível e homologada por síndico, subsíndico e conselho fiscal — sem precisar pedir satisfação.', icon: '◎' },
  { title: 'Decisões mais rápidas com dados atualizados.', description: 'Indicadores em tempo real, sem esperar o fechamento do mês.', icon: '⚡' },
  { title: 'Uma gestão acessível de qualquer lugar.', description: 'Painel completo no computador e no aplicativo, onde você estiver.', icon: '🌐' },
];

// Os únicos dois perfis com permissões reais e distintas no sistema hoje
// (o papel "admin_geral" é uso interno da Lar em Dia, não um perfil vendido
// ao condomínio) — nada de "administradora", "conselheiro" ou "portaria",
// que não existem como papel no sistema.
export const PROFILES = [
  { key: 'sindicos', label: 'Síndicos e subsíndicos', icon: '🏢', bullets: ['Painel único com financeiro, comunicação e relatos dos moradores', 'Prestação de contas pronta todo mês, sem planilha, homologada por você, o subsíndico e o conselho fiscal', 'Edite, negocie ou quite débitos antigos direto pelo sistema'] },
  { key: 'moradores', label: 'Moradores', icon: '🏠', bullets: ['Acompanham os próprios boletos e o histórico de pagamentos', 'Recebem avisos com confirmação de leitura, sem grupo lotado', 'Abrem relatos e acompanham a resposta da administração'] },
];
