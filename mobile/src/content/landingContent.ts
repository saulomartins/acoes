// Conteúdo comercial da landing, compartilhado com a Lari (ui/ChatAssistant)
// para o chat nunca prometer algo diferente do que o site mostra.

export type Feature = { title: string; icon: string; description: string; highlight?: string };

// Só o que realmente existe no sistema hoje — nada de módulo genérico de
// template (sem assembleias, portaria ou fornecedores: isso não está
// implementado, então não entra aqui).
export const FEATURES: Feature[] = [
  { title: 'Gestão financeira', icon: '$', description: 'Receitas, despesas e saldo do condomínio, sempre atualizados e no automático.', highlight: 'Economia de tempo' },
  { title: 'Cobrança por Pix e boleto', icon: '▤', description: 'Boleto e Pix emitidos direto pelo Banco Inter, com multa, juros e detalhamento de taxas configurados uma vez.' },
  { title: 'Consumo de água, gás e energia', icon: '💧', description: 'Tarifa por condomínio e lançamento mensal de consumo por unidade, somado ao boleto da taxa condominial.', highlight: 'Transparência no consumo' },
  { title: 'Prestação de contas', icon: '◍', description: 'Relatório mensal com comprovantes anexados, claro e disponível para todos os moradores.', highlight: 'Transparência financeira' },
  { title: 'Conselho Fiscal e homologação', icon: '⚖', description: 'Síndico, subsíndico e os dois conselheiros fiscais homologam a prestação de contas, com registro de quem aprovou e as considerações de cada um — inclusive no PDF impresso.', highlight: 'Governança e transparência' },
  { title: 'Gestão de débitos', icon: '↓', description: 'Acordo, parcelamento e edição de débitos antigos para reduzir a inadimplência.', highlight: 'Redução da inadimplência' },
  { title: 'Nada consta (quitação)', icon: '✓', description: 'O morador pede a declaração pelo app, o sistema confere os débitos e o síndico emite o PDF com código verificador público.', highlight: 'Documento verificável' },
  { title: 'Avisos e comunicação', icon: '◉', description: 'Avisos com confirmação de leitura — sem se perder no grupo de WhatsApp.', highlight: 'Comunicação centralizada' },
  { title: 'Relatos e solicitações', icon: '!', description: 'Morador abre um relato, acompanha e conversa com a administração até resolver.' },
  { title: 'Unidades e moradores', icon: '▦', description: 'Blocos, unidades e moradores cadastrados uma vez, usados no sistema inteiro.' },
  { title: 'APP do Morador', icon: '📱', description: 'Aplicativo Android na Google Play (e navegador no iPhone): cada morador entra com o próprio login e só vê o que é seu.', highlight: 'Segurança das informações' },
  { title: 'Painel com indicadores', icon: '📊', description: 'Boletos emitidos, pagos e em aberto, sempre visíveis num único painel.' },
  { title: 'Enquetes', icon: '✓', description: 'Síndico e subsíndico publicam consultas e os moradores ativos respondem pelo aplicativo.' },
  { title: 'Reserva de espaços', icon: '⌑', description: 'Agenda visual, horários disponíveis, bloqueios administrativos e aprovação das solicitações.' },
  { title: 'Regimento e ocorrências', icon: '⚑', description: 'Artigos do regimento, registro de ocorrências, respostas e acompanhamento até a resolução.' },
  { title: 'Notificações de infração', icon: '⚠', description: 'Emissão, defesa, confirmação e acompanhamento das notificações do condomínio.' },
  { title: 'Cobranças adicionais', icon: '+', description: 'Cobranças extraordinárias por unidade, com parcelas e acompanhamento integrado.' },
  { title: 'Histórico de acordos', icon: '≋', description: 'Acordos e parcelamentos organizados com situação e histórico de pagamentos.' },
];

export const FEATURE_GROUPS = [
  { title: 'Financeiro e cobranças', description: 'Controle, arrecadação e transparência financeira.', items: ['Gestão financeira','Cobrança por Pix e boleto','Consumo de água, gás e energia','Prestação de contas','Conselho Fiscal e homologação','Gestão de débitos','Nada consta (quitação)','Cobranças adicionais','Histórico de acordos'] },
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
// ---------- Segurança e LGPD ----------
// Usado pela seção "Segurança" da landing e pela Lari. Cada frase corresponde
// a algo que existe no sistema (conferido em 24/10/2026) — ao mudar o sistema,
// mude aqui também. Nada de selo, certificação ou promessa sem lastro.

export const PRIVACY_EMAIL = 'laremdia.condominio@gmail.com';

export const SECURITY_PILLARS = [
  { icon: '🔐', title: 'Senha que nem nós vemos', description: 'A senha é guardada embaralhada (hash bcrypt), nunca em texto. Depois de 5 tentativas erradas, o login daquela conta fica bloqueado por 15 minutos.' },
  { icon: '⏳', title: 'Sessão com prazo', description: 'Sem uso por 14 dias, a sessão vence; mesmo usando sempre, dura no máximo 60 dias. Trocar a senha desconecta os outros aparelhos.' },
  { icon: '📱', title: 'Dispositivos conectados', description: 'Veja em quais aparelhos sua conta está aberta, com data e IP, e desconecte qualquer um — ou todos os outros — com um toque.' },
  { icon: '👥', title: 'Cada um vê só o que é seu', description: 'Morador vê os próprios boletos e ocorrências; síndico e subsíndico, o do seu condomínio. Um condomínio nunca enxerga dados de outro.' },
  { icon: '🧾', title: 'Tudo fica registrado', description: 'Cada alteração guarda quem fez, quando, de qual aparelho e IP. Ações da gestão aparecem na auditoria, e mudanças em débitos guardam o motivo.' },
  { icon: '📁', title: 'Arquivos no Drive do condomínio', description: 'Notas, comprovantes, extratos e regimento ficam no Google Drive do próprio condomínio, que é o dono deles. Abrem pelo sistema, sem conta Google.' },
  { icon: '✋', title: 'Confirmação antes de agir', description: 'Registrar ocorrência, votar, aceitar acordo ou pedir nada consta sempre pede confirmação — nada sai com um toque sem querer.' },
  { icon: '🍪', title: 'Sem rastreamento lá dentro', description: 'Cookies de medição só no site público e só se você aceitar. Depois do login, nenhuma ferramenta de anúncio ou medição.' },
];

// Papéis da LGPD (art. 5º, VI e VII).
export const LGPD_ROLES = [
  { role: 'Condomínio = controlador', text: 'Decide quem é cadastrado e quais dados dos moradores entram no sistema — como já acontece com a ficha do morador na administração.' },
  { role: 'Lar em Dia = operador', text: 'Trata os dados dos moradores só para prestar o serviço contratado pelo condomínio, seguindo as instruções dele. Nos dados do site (pedido de proposta e perguntas à Lari), o Lar em Dia é o controlador.' },
];

export const DATA_WE_PROCESS = [
  { title: 'Identificação e contato', text: 'Nome, CPF, e-mail e telefone — para o login, as cobranças e os avisos.' },
  { title: 'Vínculo com o condomínio', text: 'Unidade, bloco e perfil (proprietário, inquilino, síndico).' },
  { title: 'Financeiro', text: 'Boletos, pagamentos, acordos e débitos da unidade.' },
  { title: 'Rotina do condomínio', text: 'Avisos, relatos, ocorrências, reservas, enquetes e documentos enviados.' },
  { title: 'Registros de acesso', text: 'Data, IP e aparelho de cada login e alteração — para segurança e para provar quem fez o quê.' },
];

// Base legal (LGPD, art. 7º) por finalidade.
export const LEGAL_BASES = [
  { purpose: 'Prestar o serviço que o condomínio contratou', basis: 'Execução de contrato (art. 7º, V)' },
  { purpose: 'Emitir e cobrar boletos e guardar o histórico financeiro', basis: 'Obrigação legal e exercício regular de direitos (art. 7º, II e VI)' },
  { purpose: 'Registrar acessos e prevenir fraude', basis: 'Legítimo interesse e Marco Civil da Internet (art. 7º, IX; Lei 12.965, art. 15)' },
  { purpose: 'Medir visitas ao site público', basis: 'Consentimento, pelo aviso de cookies (art. 7º, I)' },
];

// Quem processa dados em nome do Lar em Dia (operadores/suboperadores).
export const PROCESSORS = [
  { name: 'Railway', role: 'Servidores e banco de dados da plataforma' },
  { name: 'Cloudflare', role: 'Hospedagem do site' },
  { name: 'Google Drive', role: 'Arquivos do condomínio, na pasta do próprio condomínio' },
  { name: 'Banco Inter', role: 'Emissão de boletos e Pix das cobranças' },
  { name: 'Mercado Pago', role: 'Pix da assinatura da plataforma' },
  { name: 'Resend', role: 'Envio de e-mails' },
  { name: 'Expo', role: 'Notificações no celular' },
  { name: 'Google Analytics e Ads', role: 'Medição do site público, só com o seu aceite' },
];

export const RETENTION = [
  'Enquanto o condomínio usa o Lar em Dia, os dados ficam disponíveis para ele.',
  'Registros de acesso (data, IP e aparelho): 6 meses, como pede o Marco Civil da Internet.',
  'Dados financeiros podem ser guardados pelo prazo que a lei exige, mesmo depois de uma exclusão.',
];

// Direitos do titular (LGPD, art. 18).
export const DATA_RIGHTS = ['Confirmar se tratamos seus dados', 'Acessar seus dados', 'Corrigir dados errados ou desatualizados', 'Anonimizar, bloquear ou eliminar o que for desnecessário', 'Saber com quem compartilhamos', 'Levar seus dados (portabilidade)', 'Revogar um consentimento'];

export const PRIVACY_FAQ = [
  { question: 'Quem consegue ver meus dados?', answer: 'Você vê os seus. O síndico e o subsíndico do seu condomínio veem os dados dos moradores, porque administram o condomínio. Outros moradores não veem seus boletos, débitos nem ocorrências. A equipe do Lar em Dia só acessa para dar suporte, e nunca vê sua senha.' },
  { question: 'Vocês vendem ou usam meus dados para propaganda?', answer: 'Não. Os dados dos moradores são usados só para o serviço do condomínio. Nada é vendido, e dentro da plataforma não existe ferramenta de anúncio nem de medição.' },
  { question: 'Minha senha está segura?', answer: 'Sim. Ela é guardada embaralhada (hash bcrypt) — ninguém, nem a nossa equipe, consegue ler. Depois de 5 tentativas erradas, o login fica bloqueado por 15 minutos. Na primeira entrada, o sistema pede para você criar a sua própria senha.' },
  { question: 'E se alguém entrar na minha conta?', answer: 'Abra "Dispositivos conectados" no menu: lá aparecem todos os aparelhos com a sua conta aberta, com data e IP. Toque em "Sair dos outros aparelhos" e troque a senha — isso desconecta todo mundo, menos você. Cada alteração fica registrada com o aparelho que fez, e a equipe pode investigar com você.' },
  { question: 'Onde ficam os documentos e comprovantes?', answer: 'No Google Drive do próprio condomínio, que é o dono dos arquivos. O sistema abre os arquivos para quem tem permissão, sem precisar de conta Google. Nada fica guardado dentro do nosso banco de dados.' },
  { question: 'Como corrijo ou apago meus dados?', answer: `Dados do cadastro (nome, unidade, telefone) são corrigidos pelo síndico ou subsíndico. Para os demais direitos da LGPD — acesso, cópia, eliminação —, escreva para ${PRIVACY_EMAIL}. Dados financeiros podem ter guarda obrigatória por lei.` },
  { question: 'Com quem vocês compartilham meus dados?', answer: 'Só com os serviços que fazem o sistema funcionar: Railway (servidores), Cloudflare (site), Google Drive (arquivos do condomínio), Banco Inter (boletos e Pix), Resend (e-mails) e Expo (notificações). Cada um recebe apenas o necessário para a sua tarefa.' },
  { question: 'E se o condomínio deixar de usar o Lar em Dia?', answer: 'Os dados são do condomínio. Ele pode pedir uma cópia e, depois, a exclusão — respeitando os prazos de guarda que a lei exige para registros financeiros e de acesso. Os arquivos continuam no Google Drive do condomínio.' },
  { question: 'E se acontecer um incidente de segurança?', answer: 'A LGPD (art. 48) obriga a avisar o condomínio e, quando houver risco relevante, a Autoridade Nacional de Proteção de Dados (ANPD) e as pessoas afetadas. É o que fazemos: identificar, conter, registrar e avisar quem precisa saber.' },
];

export const PROFILES = [
  { key: 'sindicos', label: 'Síndicos e subsíndicos', icon: '🏢', bullets: ['Painel único com financeiro, comunicação e relatos dos moradores', 'Prestação de contas pronta todo mês, sem planilha, homologada por você, o subsíndico e o conselho fiscal', 'Edite, negocie ou quite débitos antigos direto pelo sistema'] },
  { key: 'moradores', label: 'Moradores', icon: '🏠', bullets: ['Acompanham os próprios boletos e o histórico de pagamentos', 'Recebem avisos com confirmação de leitura, sem grupo lotado', 'Abrem relatos e acompanham a resposta da administração'] },
];
