import React, { useContext, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';

// Guia interno de expansão bancária. É conteúdo estático de apoio ao admin
// geral — não consulta a API e não expõe credencial nenhuma. O que ele
// documenta é o resultado do levantamento feito sobre as APIs de cobrança dos
// bancos brasileiros: quanto custa, o quanto é difícil integrar e, sobretudo,
// como cada banco devolve o retorno de pagamento (que é onde eles mais
// divergem entre si).

type Difficulty = 'facil' | 'medio' | 'dificil';

// 'combinado': confirmado que cobrança e extrato saem da mesma aplicação/
// credencial no portal do banco. 'a_confirmar': ainda não testamos esse banco
// nesta plataforma — o portal precisa ser conferido durante o onboarding,
// não presumido a partir dos outros.
type ExtratoScope = 'combinado' | 'a_confirmar';

type Bank = {
  position: number;
  name: string;
  status?: string;
  difficulty: Difficulty;
  certificate: string;
  certificateFree: boolean;
  boleto: string;
  pix: string;
  returnFlow: string;
  returnRealtime: boolean;
  notes: string;
  extratoScope: ExtratoScope;
  extratoNotes: string;
};

// Ordem = recomendação de ataque. O critério combina duas coisas que pesam
// direto no bolso do condomínio e no nosso prazo: (1) se o banco exige
// certificado A1 ICP-Brasil, que é custo anual recorrente por CNPJ, e (2) se o
// onboarding é self-service ou depende de gerente/homologação demorada.
const banks: Bank[] = [
  {
    position: 0,
    name: 'Banco Inter',
    status: 'Já implantado',
    difficulty: 'facil',
    certificate: 'Certificado próprio do banco — sem ICP-Brasil',
    certificateFree: true,
    boleto: 'Tarifa negociada em contrato',
    pix: 'Tarifa negociada em contrato',
    returnFlow: 'Webhook completo de boleto e Pix, já em produção',
    returnRealtime: true,
    notes: 'É a referência da nossa arquitetura. Nada aqui deve ser alterado — os adaptadores novos se encaixam ao lado, sem tocar no que já funciona.',
    extratoScope: 'combinado',
    extratoNotes: 'Confirmado em produção: dá para pedir cobrança, Pix e extrato (conta corrente) juntos numa única aplicação no portal do Inter, desde que os três escopos sejam marcados já na criação. Um condomínio que teve a aplicação criada só com escopo de cobrança precisou de uma aplicação nova para ganhar extrato — não deu para adicionar o escopo depois na mesma aplicação.',
  },
  {
    position: 1,
    name: 'Sicoob',
    difficulty: 'facil',
    certificate: 'Certificado próprio + API key — sem ICP-Brasil',
    certificateFree: true,
    boleto: 'Aproximadamente R$ 1,00 de entrada + R$ 1,00 de baixa',
    pix: 'Sem tarifa de Pix na API',
    returnFlow: 'Webhook na API V3: Pix em tempo real e liquidação acelerada de código de barras',
    returnRealtime: true,
    notes: 'Melhor relação custo/esforço do levantamento. Ativação self-service pelo Sicoobnet e o único da lista com Pix sem tarifa. Exige usar a API V3 — o webhook não funciona nas versões anteriores.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no Sicoob ainda. O portal de desenvolvedor separa produtos por API (Cobrança, Pix, Conta Corrente) — confirmar no cadastro da aplicação se dá para marcar os três de uma vez ou se extrato exige uma aplicação à parte.',
  },
  {
    position: 2,
    name: 'Banco do Brasil',
    difficulty: 'facil',
    certificate: 'mTLS com certificado próprio — sem ICP-Brasil',
    certificateFree: true,
    boleto: 'Sem adesão nem mensalidade; tarifa por boleto liquidado negociada',
    pix: 'Tarifa baixa por liquidação, negociada em contrato',
    returnFlow: 'Webhook apenas para Pix. Boleto pago em código de barras exige consulta agendada',
    returnRealtime: false,
    notes: 'Portal Developers self-service com o sandbox mais acessível do mercado — é o melhor banco para validar a arquitetura de ponta a ponta. Atenção: o "nosso número" do BB é numérico e sequencial, não UUID (ver riscos técnicos).',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no BB ainda. O Developers BB também lista "Extratos" como API própria, separada de "Cobranças" — confirmar no cadastro da aplicação se as duas entram na mesma credencial.',
  },
  {
    position: 3,
    name: 'BTG Pactual',
    difficulty: 'facil',
    certificate: 'OAuth2 + JWT — sem ICP-Brasil',
    certificateFree: true,
    boleto: 'Negociada em contrato',
    pix: 'Negociada em contrato',
    returnFlow: 'Webhook disponível',
    returnRealtime: true,
    notes: 'Console de desenvolvedor self-service. Autenticação por JWT em vez de certificado em disco, o que simplifica a operação do servidor.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no BTG ainda — confirmar no console de desenvolvedor se o escopo de conta corrente/extrato pode ser marcado junto com o de cobrança na mesma aplicação.',
  },
  {
    position: 4,
    name: 'Sicredi',
    difficulty: 'medio',
    certificate: 'Certificado próprio + API key — sem ICP-Brasil',
    certificateFree: true,
    boleto: 'Negociada em contrato',
    pix: 'Negociada em contrato',
    returnFlow: 'Webhook de Pix padronizado',
    returnRealtime: true,
    notes: 'Sem custo de certificado, mas o token de produção só sai via abertura de chamado no suporte — o que adiciona espera ao onboarding.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no Sicredi ainda — como o token de produção depende de chamado no suporte, vale já pedir cobrança e conta corrente/extrato juntos no mesmo chamado, para não precisar reabrir depois.',
  },
  {
    position: 5,
    name: 'Bradesco',
    difficulty: 'medio',
    certificate: 'Exige A1 ICP-Brasil (e-CNPJ)',
    certificateFree: false,
    boleto: 'Em torno de R$ 6,60 na tabela cheia; negociável por volume',
    pix: 'Por liquidação, negociada em contrato',
    returnFlow: 'Webhook de Pix padronizado; boleto com retorno limitado, recomenda-se consulta agendada',
    returnRealtime: false,
    notes: 'Primeiro banco da lista que gera custo anual de certificado por condomínio. Só vale abrir mediante demanda concreta de cliente.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no Bradesco ainda — confirmar no onboarding se o escopo de conta corrente entra na mesma aplicação da cobrança ou se precisa de credencial separada.',
  },
  {
    position: 6,
    name: 'Santander',
    difficulty: 'medio',
    certificate: 'Exige A1 ICP-Brasil (e-CNPJ)',
    certificateFree: false,
    boleto: 'Tabela cheia na faixa de R$ 6 a R$ 10; negociável',
    pix: 'Por liquidação, negociada em contrato',
    returnFlow: 'Retorna status de boleto e pagamento; webhook de Pix padronizado',
    returnRealtime: true,
    notes: 'Sandbox parcial e onboarding depende de gerente de relacionamento. Custo de certificado recorrente.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no Santander ainda — como o onboarding passa por gerente, vale já registrar o pedido de cobrança e extrato juntos para não reabrir o processo depois.',
  },
  {
    position: 7,
    name: 'Itaú',
    difficulty: 'dificil',
    certificate: 'mTLS com A1 ICP-Brasil, ou private key JWT',
    certificateFree: false,
    boleto: 'Tabela cheia na faixa de R$ 6 a R$ 10; negociável',
    pix: 'Por liquidação, negociada em contrato',
    returnFlow: 'Webhook de Pix padronizado; sem webhook de boleto documentado publicamente',
    returnRealtime: false,
    notes: 'Credenciais de produção não são self-service: saem por e-mail via gerente ou API Owner. O token de acesso expira em 300 segundos, o que exige cache com renovação mais agressiva que a do Inter. Sandbox não usa OAuth2 nem mTLS, então não valida o fluxo real.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato no Itaú ainda — como a credencial de produção também depende de gerente/API Owner, vale pedir cobrança e extrato no mesmo pedido.',
  },
  {
    position: 8,
    name: 'Caixa Econômica',
    difficulty: 'dificil',
    certificate: 'Exige A1 ICP-Brasil',
    certificateFree: false,
    boleto: 'Negociada em contrato',
    pix: 'Por liquidação',
    returnFlow: 'Sem webhook de boleto — retorno por consulta ou arquivo CNAB',
    returnRealtime: false,
    notes: 'Integração SOAP/XML legada, sem API REST moderna, com o processo mais burocrático do levantamento. Deixar por último, e só se houver contrato que obrigue.',
    extratoScope: 'a_confirmar',
    extratoNotes: 'Não integramos extrato na Caixa ainda — dado o processo burocrático deste banco, mais razão para levantar cobrança e extrato juntos logo na abertura do processo.',
  },
];

const difficultyLabel: Record<Difficulty, string> = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };
const difficultyColor: Record<Difficulty, string> = { facil: colors.green, medio: colors.amber, dificil: colors.red };

type Phase = {
  key: string;
  title: string;
  goal: string;
  steps: string[];
};

// O "caminho das pedras": a ordem em que as coisas precisam ser feitas. A Fase 0
// é pré-requisito de qualquer banco novo — não dá para pular, porque hoje o
// código assume que só existe um provedor.
const phases: Phase[] = [
  {
    key: 'base',
    title: 'Fase 0 — Preparar a base do código',
    goal: 'Vale para qualquer banco escolhido. Enquanto isso não estiver pronto, nenhum adaptador novo pode entrar com segurança.',
    steps: [
      'Extrair uma interface BillingAdapter com as operações getToken, createCharge, getCharge, listCharges, getPdf, mapStatus e parseWebhook, e um registry que resolve o adaptador pela coluna adapter_key da tabela banks.',
      'Registrar o serviço atual do Inter como um adaptador dentro desse registry, apenas embrulhando o código existente. A lógica do Inter não deve ser alterada em nenhuma linha — ela está em produção e funcionando.',
      'Trocar a chave de conflito da importação de cobranças de external_id para o par (provider, external_id), incluindo o índice único no banco de dados.',
      'Ampliar a restrição da coluna provider e de adapter_key para aceitar os novos bancos. Hoje elas só permitem inter, banco_do_brasil e bradesco — não é possível nem cadastrar Sicoob ou Itaú.',
      'Remover o filtro fixo por provider igual a inter na busca da integração do condomínio, para que uma configuração de outro banco não deixe o condomínio sem integração de forma silenciosa.',
      'Substituir o segredo único de webhook por um segredo por configuração bancária, com rota separada por provedor e tratamento idempotente de reenvio.',
      'Adicionar data de validade do certificado no cadastro da configuração bancária, com alerta de vencimento próximo.',
    ],
  },
  {
    key: 'primeiro',
    title: 'Fase 1 — Primeiro banco novo',
    goal: 'Provar a arquitetura contra um banco real antes de escalar. A recomendação é Sicoob pelo custo, ou Banco do Brasil pela facilidade de sandbox.',
    steps: [
      'Criar a conta no portal de desenvolvedor do banco escolhido e gerar as credenciais de homologação, solicitando de saída os escopos de cobrança e de extrato/conta corrente juntos — mesmo que o extrato não vá ser usado de imediato, evita ter que recriar a aplicação depois (ver seção "Cobrança e extrato: uma aplicação só, ou duas?").',
      'Implementar o adaptador do banco seguindo a interface da Fase 0, com o mapa de status próprio dele — cada banco usa um vocabulário diferente do A_RECEBER e RECEBIDO do Inter.',
      'Emitir uma cobrança de teste em sandbox e conferir o retorno de consulta.',
      'Cadastrar o banco na tela de Cadastro de bancos e a credencial em Configurações bancárias, e rodar o botão de testar conexão.',
      'Vincular a um condomínio de teste e validar o ciclo completo: emissão, consulta, PDF e baixa.',
    ],
  },
  {
    key: 'retorno',
    title: 'Fase 2 — Garantir o acompanhamento do pagamento',
    goal: 'Esta é a parte mais crítica. Webhook de boleto não é universal, então o retorno precisa de duas camadas para não perder pagamento.',
    steps: [
      'Implementar a reconciliação agendada como fonte de verdade: um job recorrente que varre as cobranças do período e sincroniza o status. Ela é obrigatória para todos os bancos, inclusive os que têm webhook.',
      'Implementar o webhook do banco como camada de aceleração, nunca como única fonte. Ele antecipa a baixa de horas para segundos onde existir.',
      'Emitir sempre o boleto híbrido, com código de barras e QR Code Pix no mesmo documento. Pago via Pix, o retorno vem em tempo real pela via padronizada e o banco dá baixa automática no boleto; pago em código de barras, a reconciliação agendada resolve.',
      'Expor o endpoint de webhook em HTTPS público com certificado válido. O Pix exige que a notificação trafegue em canal mTLS, e o recomendado é usar o mesmo certificado da API.',
      'Tratar reenvio de notificação de forma idempotente e registrar cada evento recebido para auditoria.',
    ],
  },
  {
    key: 'producao',
    title: 'Fase 3 — Homologação e produção',
    goal: 'Etapa de calendário, não de código. É o que costuma travar o cronograma.',
    steps: [
      'Submeter o lote de testes exigido pelo banco. Banco do Brasil, Santander, Bradesco e Sicredi exigem homologação aprovada antes de liberar produção.',
      'Reservar de duas a seis semanas de margem por banco para o onboarding completo.',
      'Trocar as credenciais e a URL base de homologação para produção na configuração bancária, sem mexer no código.',
      'Rodar uma emissão real de valor baixo e acompanhar a baixa antes de liberar para o condomínio.',
    ],
  },
  {
    key: 'escala',
    title: 'Fase 4 — Escalar para os demais bancos',
    goal: 'Com a base pronta, cada banco novo vira só um arquivo de adaptador.',
    steps: [
      'Priorizar sempre os bancos sem certificado ICP-Brasil, porque não geram custo anual para o condomínio.',
      'Abrir os bancos com certificado pago apenas mediante demanda concreta de um condomínio que já seja cliente daquela instituição.',
      'Manter o adaptador de Pix padronizado como plano B: como a especificação do Banco Central é igual para todos os provedores, um único adaptador atende dezenas de bancos mudando apenas a URL e as credenciais.',
    ],
  },
];

type Risk = { title: string; detail: string; where: string };

// Achados concretos da leitura do código atual. Todos precisam ser resolvidos
// na Fase 0 — são coisas que hoje passam despercebidas porque só existe um
// banco ativo, e que quebram de formas difíceis de diagnosticar assim que
// entrar o segundo.
const risks: Risk[] = [
  {
    title: 'Colisão de identificador entre bancos',
    detail: 'A importação de cobranças resolve conflito só por external_id. Isso é seguro hoje porque o Inter devolve um identificador em formato UUID, mas o Banco do Brasil usa o "nosso número", que é numérico e sequencial por convênio. Com dois bancos ativos, dois condomínios podem receber o mesmo identificador e a fatura de um sobrescreve a do outro.',
    where: 'api/src/routes/invoiceRoutes.ts',
  },
  {
    title: 'Mapa de status preso ao vocabulário do Inter',
    detail: 'A tradução de situação do banco para status interno usa os termos do Inter. Cada instituição tem o seu próprio conjunto de situações, então esse mapa precisa descer para dentro de cada adaptador — mantendo o do Inter idêntico ao que já existe.',
    where: 'api/src/services/interService.ts',
  },
  {
    title: 'Tela de cobranças compara a situação crua do banco',
    detail: 'A coluna provider_situation guarda a situação exatamente como o banco devolveu, e a tela decide o rótulo comparando com a palavra "EXPIRADO", que é vocabulário do Inter. Em outro banco a mesma condição tem outro nome, e um boleto impagável voltaria a ser exibido como "Vencido" — inclusive oferecendo pagar via Pix. A tela precisa perguntar "este boleto está expirado?" a uma função por provedor, em vez de comparar a palavra direto.',
    where: 'mobile/src/screens/Invoices.tsx (isExpiredAtBank) + api/src/services/interService.ts',
  },
  {
    title: 'Segredo de webhook único e global',
    detail: 'O webhook valida um segredo vindo de variável de ambiente, o mesmo para toda a plataforma. Com vários bancos e várias configurações, o segredo precisa ser por configuração bancária, e a rota precisa identificar de qual provedor veio a notificação.',
    where: 'api/src/routes/interWebhookRoutes.ts',
  },
  {
    title: 'Certificado sem controle de validade',
    detail: 'Um certificado A1 vale 365 dias. Se vencer sem renovação, a emissão de boletos daquele condomínio para de funcionar sem erro visível. Com vários condomínios em vários bancos isso vira incidente recorrente, então o cadastro precisa guardar a validade e avisar antes do vencimento.',
    where: 'Cadastro de configurações bancárias',
  },
  {
    title: 'Cliente HTTP sem suporte a PFX e a chave em query',
    detail: 'O cliente atual lê certificado e chave em arquivos PEM separados e monta apenas cabeçalhos. Os bancos com ICP-Brasil entregam o certificado em formato PFX com senha, e o Banco do Brasil exige uma chave de aplicação passada na query string da requisição.',
    where: 'api/src/services/interService.ts',
  },
];

// Contraparte dos riscos: o que já foi construído sem amarra a banco nenhum.
// Registrado para ninguém refazer por precaução, nem tratar como pendência de
// migração quando o segundo banco entrar.
const providerAgnostic: Risk[] = [
  {
    title: 'Retirar boleto da dívida, com justificativa',
    detail: 'O síndico pode tirar um boleto da dívida informando o motivo, e isso vale em Gestão de débitos, no painel e nos indicadores. O mecanismo vive em colunas da própria fatura e não consulta o provedor em momento nenhum, então funciona igual para qualquer banco, inclusive para lançamento manual e débito antigo, sem uma linha a mais.',
    where: 'invoices.debt_excluded_at + PATCH /invoices/:id/debt-exclusion',
  },
  {
    title: 'A decisão do síndico sobrevive à sincronização',
    detail: 'Nenhuma rotina que fala com o banco escreve nas colunas de retirada da dívida: sincronizar, importar em lote e receber webhook só leem. Isso é uma garantia estrutural, não uma coincidência — vale para qualquer adaptador futuro, desde que o novo adaptador siga a mesma regra e não tente "corrigir" esses campos a partir do que o banco devolveu.',
    where: 'api/src/routes/invoiceRoutes.ts + interWebhookRoutes.ts',
  },
  {
    title: 'Boletos do banco sem morador vinculado',
    detail: 'Cobranças encontradas no banco cujo CPF do pagador não bate com ninguém cadastrado ficam registradas como pendência fixa em Gestão de cobranças. A tabela guarda o identificador externo e o provedor não aparece na regra, então qualquer adaptador que devolva pagador e documento alimenta o mesmo aviso.',
    where: 'bank_unmatched_charges',
  },
];

type RolloutStep = { title: string; detail: string; where: string };

// Sequência real de implantação, levantada direto do código (não é um
// checklist teórico): cada item aqui corresponde a uma tela e uma rota que já
// existem hoje. Serve pra não esquecer passo nenhum ao colocar um condomínio
// novo pra rodar, e também deixa claro que os passos de vínculo bancário
// (7 e 8) hoje só emitem boleto de verdade pelo Banco Inter — os demais bancos
// do ranking acima dependem da Fase 0 do "Caminho das pedras" para funcionar.
const rolloutSteps: RolloutStep[] = [
  {
    title: '1. Cadastrar o condomínio',
    detail: 'Nome, CNPJ, endereço e contato. Ao salvar, o sistema já cria as features padrão automaticamente — não precisa de um passo separado para isso.',
    where: 'Condomínios → Cadastrar condomínio',
  },
  {
    title: '2. Revisar as features habilitadas',
    detail: 'Pessoas, tipologias, blocos/unidades, prestação de contas, avisos, gestão de cobranças, painel de usuários e indicadores de boletos já vêm ligados. Reserva de espaços, gestão de débitos, histórico de acordos, cobranças adicionais, enquetes, relatos/solicitações, regimento/ocorrências e consumo individualizado vêm desligados — ligar só o que esse condomínio específico vai usar.',
    where: 'Condomínios → painel de features do condomínio',
  },
  {
    title: '3. Vincular o plano da plataforma (se a mensalidade for cobrada pelo sistema)',
    detail: 'Só necessário se a cobrança da plataforma para esse condomínio passa por aqui. Não bloqueia nenhuma outra funcionalidade se for deixado para depois.',
    where: 'Planos da plataforma',
  },
  {
    title: '4. Cadastrar as tipologias das unidades',
    detail: 'Pré-requisito técnico: uma unidade só pode ser criada depois que a tipologia dela já existe, seja no cadastro manual seja na importação por planilha.',
    where: 'Tipologias',
  },
  {
    title: '5. Cadastrar o síndico (ou subsíndico)',
    detail: 'CPF é obrigatório — a senha inicial é gerada a partir dele, e a pessoa é obrigada a trocá-la no primeiro acesso. Cadastrar o e-mail já dispara o aviso de boas-vindas automaticamente.',
    where: 'Pessoas → Cadastrar usuário',
  },
  {
    title: '6. Cadastrar blocos e unidades',
    detail: 'Um a um, ou em lote por importação de planilha (.xlsx com colunas Bloco/Unidade/Tipologia) — mais rápido para condomínios grandes.',
    where: 'Unidades',
  },
  {
    title: '7. Cadastrar moradores e proprietários',
    detail: 'Vincular um proprietário ou inquilino a uma unidade no cadastro de usuário já cria a moradia automaticamente. Para o caso de proprietário que só acompanha a unidade sem morar nela (ex.: imóvel alugado), o vínculo certo é "Proprietário adicional" na tela de unidades, não um cadastro de morador.',
    where: 'Pessoas / Unidades → Proprietários adicionais',
  },
  {
    title: '8. Configurar a integração bancária',
    detail: 'Cadastro de bancos (se o banco do condomínio ainda não existir na lista) → Configurações bancárias (credenciais) → Vincular banco ao condomínio, marcando cobrança e/ou extrato — os dois já vêm marcados por padrão — e definindo o período de busca de boletos. Hoje só o Banco Inter emite e sincroniza de verdade; os demais bancos podem ser cadastrados, mas ficam com emissão bloqueada até a Fase 0 do "Caminho das pedras" abaixo estar pronta.',
    where: 'Gestão de bancos',
  },
  {
    title: '9. Testar a conexão e rodar a primeira sincronização',
    detail: '"Testar conexão" na configuração bancária confirma que as credenciais estão corretas antes de expor isso ao síndico. Depois, "Atualizar todos os boletos" traz o histórico (ou o período configurado) pela primeira vez.',
    where: 'Configurações bancárias / Gestão de cobranças',
  },
  {
    title: '10. Apresentar o tour de cada tela ao síndico',
    detail: 'Não existe uma tela única de checklist de implantação dentro do app — cada tela tem seu próprio "? Tour desta tela". Vale abrir esses tours junto com o síndico na primeira reunião, começando pelas telas das features que foram ligadas no passo 2.',
    where: 'Botão "? Tour desta tela", em cada tela',
  },
];

const documents = [
  'CNPJ e razão social do condomínio',
  'Dados da conta de recebimento: agência, conta e dígito',
  'Convênio de cobrança ativo, com número do convênio, carteira e variação da carteira',
  'Certificado digital, quando o banco exigir ICP-Brasil, com a senha do arquivo',
  'Credenciais geradas no portal do banco: identificador e segredo da aplicação',
  'Contato do gerente da conta, necessário nos bancos que não são self-service',
];

const Chip = ({ label, tone }: { label: string; tone: string }) => (
  <View style={[s.chip, { borderColor: tone, backgroundColor: `${tone}14` }]}>
    <Text style={[s.chipText, { color: tone }]}>{label}</Text>
  </View>
);

const Section = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <Panel>
    <Text style={s.sectionTitle}>{title}</Text>
    {description ? <Text style={s.sectionDescription}>{description}</Text> : null}
    {children}
  </Panel>
);

export default function BankIntegrationGuide() {
  const { user } = useContext(AuthContext);
  const { isDesktop } = useBreakpoint();
  const [openBank, setOpenBank] = useState<string | null>(null);
  const [openPhase, setOpenPhase] = useState<string | null>('base');

  // A tela é filtrada do menu por cargo, mas quem chegar por link direto ou
  // por histórico de navegação não pode ver o conteúdo mesmo assim.
  if (user?.role !== 'admin_geral') {
    return (
      <ScrollView contentContainerStyle={s.container}>
        <EmptyState
          title="Área restrita"
          description="Este guia é exclusivo do administrador geral da plataforma."
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Section
        title="Guia de expansão bancária"
        description="Levantamento sobre como integrar outros bancos brasileiros para emissão de boleto e Pix, e como receber deles a confirmação de pagamento. Use esta página como roteiro de execução."
      >
        <View style={s.callout}>
          <Text style={s.calloutTitle}>Antes de tudo: o banco do morador não é o problema</Text>
          <Text style={s.calloutText}>
            Boleto registrado e Pix são interoperáveis por regra do Banco Central. Um boleto emitido pelo Inter já é
            pagável em qualquer banco, aplicativo ou lotérica do país, e o Pix também. O morador cliente de outro banco
            já consegue pagar normalmente hoje.
          </Text>
          <Text style={s.calloutText}>
            O que está preso ao Inter é a conta que recebe, ou seja, a conta do condomínio. O problema real a resolver é
            atender condomínios cuja conta fica em outra instituição.
          </Text>
        </View>
      </Section>

      <Section
        title="Como implantar a plataforma num condomínio novo"
        description="Checklist operacional — a sequência real de telas e passos, hoje, para colocar um condomínio novo para rodar. Não confundir com o roteiro de banco novo abaixo: aqui o condomínio usa um banco já suportado (Inter)."
      >
        {rolloutSteps.map((step) => (
          <View key={step.title} style={s.rolloutCard}>
            <Text style={s.rolloutTitle}>{step.title}</Text>
            <Text style={s.riskDetail}>{step.detail}</Text>
            <Text style={s.riskWhere}>Onde: {step.where}</Text>
          </View>
        ))}
        <View style={s.callout}>
          <Text style={s.calloutTitle}>Sobre o "Caminho das pedras" logo abaixo</Text>
          <Text style={s.calloutText}>
            Aquela seção é o roteiro de engenharia para dar suporte a um banco novo no código — não é sobre implantar
            um condomínio. Ela só entra em jogo se o condomínio novo tiver a conta em um banco que ainda não está na
            lista de bancos operacionais (hoje só o Inter). Neste checklist, o passo 8 já avisa quando esse é o caso.
          </Text>
        </View>
      </Section>

      <Section
        title="Ranking dos bancos"
        description="Ordenado por facilidade de integração combinada com o custo que será repassado ao condomínio. Toque em um banco para ver os detalhes."
      >
        {banks.map((bank) => {
          const open = openBank === bank.name;
          return (
            <View key={bank.name} style={s.bankCard}>
              <Pressable onPress={() => setOpenBank(open ? null : bank.name)} style={s.bankHeader}>
                <View style={s.bankRank}>
                  <Text style={s.bankRankText}>{bank.position === 0 ? '★' : bank.position}</Text>
                </View>
                <View style={s.bankHeaderMain}>
                  <Text style={s.bankName}>{bank.name}</Text>
                  <View style={s.chipRow}>
                    <Chip label={difficultyLabel[bank.difficulty]} tone={difficultyColor[bank.difficulty]} />
                    <Chip
                      label={bank.certificateFree ? 'Sem custo de certificado' : 'Certificado pago'}
                      tone={bank.certificateFree ? colors.green : colors.red}
                    />
                    <Chip
                      label={bank.returnRealtime ? 'Retorno em tempo real' : 'Retorno por consulta'}
                      tone={bank.returnRealtime ? colors.teal : colors.amber}
                    />
                    {bank.status ? <Chip label={bank.status} tone={colors.primary} /> : null}
                  </View>
                </View>
                <Text style={s.chevron}>{open ? '−' : '+'}</Text>
              </Pressable>
              {open ? (
                <View style={s.bankBody}>
                  <View style={[s.detailGrid, isDesktop && s.detailGridDesktop]}>
                    <View style={s.detailItem}>
                      <Text style={s.detailLabel}>Certificado</Text>
                      <Text style={s.detailValue}>{bank.certificate}</Text>
                    </View>
                    <View style={s.detailItem}>
                      <Text style={s.detailLabel}>Custo do boleto</Text>
                      <Text style={s.detailValue}>{bank.boleto}</Text>
                    </View>
                    <View style={s.detailItem}>
                      <Text style={s.detailLabel}>Custo do Pix</Text>
                      <Text style={s.detailValue}>{bank.pix}</Text>
                    </View>
                    <View style={s.detailItem}>
                      <Text style={s.detailLabel}>Como chega o retorno</Text>
                      <Text style={s.detailValue}>{bank.returnFlow}</Text>
                    </View>
                    <View style={s.detailItem}>
                      <Text style={s.detailLabel}>Cobrança + extrato na mesma aplicação?</Text>
                      <Chip
                        label={bank.extratoScope === 'combinado' ? 'Confirmado' : 'A confirmar no onboarding'}
                        tone={bank.extratoScope === 'combinado' ? colors.green : colors.muted}
                      />
                    </View>
                  </View>
                  <Text style={s.bankNotes}>{bank.notes}</Text>
                  <Text style={s.bankNotes}>{bank.extratoNotes}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </Section>

      <Section
        title="Custo para a plataforma e para o condomínio"
        description="Separação do que sai do nosso caixa e do que é repassado ao condomínio."
      >
        <View style={s.costCard}>
          <Text style={s.costTitle}>Para a plataforma</Text>
          <Text style={s.costHighlight}>Sem custo de licença ou mensalidade</Text>
          <Text style={s.costText}>
            Nenhum banco cobra adesão ou mensalidade pelo uso da API de cobrança. Os ambientes de teste são gratuitos e
            as bibliotecas necessárias são de código aberto ou já fazem parte da plataforma. O único custo real é o
            tempo de desenvolvimento.
          </Text>
        </View>
        <View style={s.costCard}>
          <Text style={s.costTitle}>Para o condomínio</Text>
          <Text style={s.costHighlight}>Certificado, quando exigido, e tarifa por cobrança</Text>
          <Text style={s.costText}>
            O certificado A1 e-CNPJ custa aproximadamente de R$ 170 a R$ 500 por ano e só é exigido por Bradesco,
            Santander, Itaú e Caixa. Inter, Sicoob, Sicredi, Banco do Brasil e BTG usam certificado próprio, sem esse
            custo. A tarifa por boleto liquidado varia conforme o contrato e o volume, ficando em geral entre R$ 1,00 e
            R$ 3,50 quando negociada, e chegando à faixa de R$ 6,00 a R$ 10,00 na tabela cheia. O Pix é sensivelmente
            mais barato e no Sicoob é isento na API.
          </Text>
          <Text style={s.costText}>
            Vale lembrar que o condomínio que já emite boleto hoje já paga tarifa bancária. A expansão não cria um custo
            novo, ela apenas muda qual banco cobra.
          </Text>
        </View>
        <View style={s.costCard}>
          <Text style={s.costTitle}>Se optarmos por um intermediador</Text>
          <Text style={s.costHighlight}>Único caminho com custo fixo ou recorrente</Text>
          <Text style={s.costText}>
            Plataformas intermediadoras cobram por transação, na ordem de R$ 3,49 por boleto e cerca de R$ 2,00 por Pix,
            e uma delas exige assinatura mensal só para liberar o acesso à API. Em troca, uma única integração atende
            qualquer banco e o ambiente de teste é imediato. A contrapartida é que o dinheiro passa por um terceiro
            antes de chegar ao condomínio, o que precisa de avaliação jurídica antes de qualquer decisão.
          </Text>
        </View>
      </Section>

      <Section
        title="Como o retorno do pagamento realmente funciona"
        description="Ponto mais crítico do projeto e o que mais varia entre instituições."
      >
        <View style={s.callout}>
          <Text style={s.calloutTitle}>Webhook de boleto não é universal</Text>
          <Text style={s.calloutText}>
            O caso do Banco do Brasil ilustra bem: ele tem webhook, mas só processa notificação de Pix. Boleto pago em
            código de barras não dispara aviso nenhum e depende de consulta recorrente. Se a arquitetura depender apenas
            de webhook, boleto pago vai continuar aparecendo como em aberto.
          </Text>
          <Text style={s.calloutText}>
            Em compensação, o webhook de Pix é padronizado e obrigatório para todos os provedores por especificação do
            Banco Central. É o único retorno bancário do país que é realmente uniforme, e as notificações trafegam em
            canal mTLS.
          </Text>
        </View>
        <Text style={s.paragraph}>
          A conclusão prática é que o desenho correto tem duas camadas, sempre nesta ordem de confiança:
        </Text>
        {[
          'Reconciliação agendada, que é a fonte de verdade e roda para todos os bancos, inclusive os que têm webhook.',
          'Webhook, que é oportunista e serve para antecipar a baixa de horas para segundos onde estiver disponível.',
          'Consulta sob demanda, disparada quando o morador abre a fatura no aplicativo.',
        ].map((line, index) => (
          <View key={line} style={s.numberedRow}>
            <View style={s.numberBadge}><Text style={s.numberBadgeText}>{index + 1}</Text></View>
            <Text style={s.numberedText}>{line}</Text>
          </View>
        ))}
        <Text style={s.paragraph}>
          A plataforma já tem essas três peças funcionando para o Inter, junto com o agendador recorrente. O trabalho não
          é inventar um desenho novo, e sim generalizar o que já existe para funcionar por adaptador.
        </Text>
      </Section>

      <Section
        title="Cobrança e extrato: uma aplicação só, ou duas?"
        description="Cada condomínio pode vincular cobrança e extrato à mesma configuração bancária num só passo, ou a configurações diferentes quando o banco exigir. A pergunta certa é feita na hora de abrir a integração no banco, não depois."
      >
        <View style={s.callout}>
          <Text style={s.calloutTitle}>O que aconteceu com o Inter e por que isso importa</Text>
          <Text style={s.calloutText}>
            Um condomínio já integrado só para cobrança precisou de extrato depois. A aplicação original tinha sido
            criada só com o escopo de cobrança no portal do Inter, e não foi possível simplesmente adicionar o escopo de
            extrato a ela — foi preciso criar uma aplicação nova, com credenciais novas, e revincular o condomínio.
            Nenhum dado se perdeu, mas o retrabalho era evitável.
          </Text>
          <Text style={s.calloutText}>
            A tela de vínculo já reflete isso: "Cobrança (boletos)" e "Extrato bancário" vêm marcados por padrão, porque
            o caso comum é vincular os dois de uma vez. Desmarcar um deles continua disponível para quando o banco
            realmente obrigar credenciais separadas por finalidade.
          </Text>
        </View>
        <Text style={s.paragraph}>
          Ao abrir a conta de desenvolvedor de um banco novo, mesmo que o condomínio só peça cobrança no primeiro
          momento, vale já solicitar o escopo de extrato/conta corrente junto — evita descobrir a limitação só quando um
          síndico pedir prestação de contas com extrato importado.
        </Text>
        <Text style={s.paragraph}>
          Confirmação real só existe para o Inter até agora, registrada nos cartões do ranking acima ("Cobrança + extrato
          na mesma aplicação?"). Para os demais bancos da lista, os portais de desenvolvedor costumam listar cobrança,
          Pix e extrato/conta corrente como produtos de API separados — o que sugere que a mesma pergunta vale a pena,
          mas isso ainda não foi testado nesta plataforma e precisa ser conferido caso a caso durante o onboarding, não
          presumido a partir do que vale para o Inter.
        </Text>
      </Section>

      <Section
        title="Caminho das pedras"
        description="Ordem de execução. Toque em uma fase para abrir os passos."
      >
        {phases.map((phase) => {
          const open = openPhase === phase.key;
          return (
            <View key={phase.key} style={s.phaseCard}>
              <Pressable onPress={() => setOpenPhase(open ? null : phase.key)} style={s.phaseHeader}>
                <View style={s.phaseHeaderMain}>
                  <Text style={s.phaseTitle}>{phase.title}</Text>
                  <Text style={s.phaseGoal}>{phase.goal}</Text>
                </View>
                <Text style={s.chevron}>{open ? '−' : '+'}</Text>
              </Pressable>
              {open ? (
                <View style={s.phaseBody}>
                  {phase.steps.map((step, index) => (
                    <View key={step} style={s.numberedRow}>
                      <View style={s.numberBadge}><Text style={s.numberBadgeText}>{index + 1}</Text></View>
                      <Text style={s.numberedText}>{step}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Section>

      <Section
        title="Riscos técnicos a resolver antes do segundo banco"
        description="Achados da revisão do código atual. Passam despercebidos hoje porque só existe um banco ativo."
      >
        {risks.map((risk) => (
          <View key={risk.title} style={s.riskCard}>
            <Text style={s.riskTitle}>{risk.title}</Text>
            <Text style={s.riskDetail}>{risk.detail}</Text>
            <Text style={s.riskWhere}>Onde: {risk.where}</Text>
          </View>
        ))}
      </Section>

      <Section
        title="O que já é agnóstico e não precisa ser refeito"
        description="Partes construídas sem amarra a banco nenhum. Valem para o segundo banco sem alteração — não trate como pendência de migração."
      >
        {providerAgnostic.map((item) => (
          <View key={item.title} style={s.agnosticCard}>
            <Text style={s.agnosticTitle}>{item.title}</Text>
            <Text style={s.riskDetail}>{item.detail}</Text>
            <Text style={s.riskWhere}>Onde: {item.where}</Text>
          </View>
        ))}
      </Section>

      <Section
        title="O que pedir ao condomínio"
        description="Documentos e dados necessários para abrir a integração de qualquer banco."
      >
        {documents.map((document) => (
          <View key={document} style={s.bulletRow}>
            <Text style={s.bullet}>•</Text>
            <Text style={s.bulletText}>{document}</Text>
          </View>
        ))}
      </Section>

      <Section title="Recomendação final">
        <Text style={s.paragraph}>
          Priorizar os bancos de certificado próprio, que são Sicoob, Banco do Brasil, Sicredi e BTG. Nenhum deles gera
          custo anual de certificado, todos têm ativação self-service e todos entregam retorno de Pix em tempo real pela
          via padronizada. O Sicoob lidera por ter a menor tarifa e Pix isento; o Banco do Brasil é o melhor para o
          primeiro teste real, por ter o ambiente de homologação mais acessível.
        </Text>
        <Text style={s.paragraph}>
          Bradesco, Santander, Itaú e Caixa custam de R$ 170 a R$ 500 por ano ao condomínio antes de emitir o primeiro
          boleto. Deixar para atender sob demanda, quando houver um cliente que realmente precise.
        </Text>
        <Text style={s.disclaimer}>
          As tarifas citadas são de tabela pública e variam conforme contrato e volume negociado. O valor real de cada
          caso precisa ser confirmado pelo condomínio junto ao gerente da conta.
        </Text>
        <Pressable onPress={() => Linking.openURL('https://bacen.github.io/pix-api/')} style={s.link}>
          <Text style={s.linkText}>Abrir a especificação oficial da API Pix do Banco Central</Text>
        </Pressable>
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  sectionDescription: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 12, lineHeight: 19 },
  paragraph: { fontSize: 14, color: colors.ink, lineHeight: 21, marginTop: 10 },
  disclaimer: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 12, fontStyle: 'italic' },

  callout: { backgroundColor: colors.softBlue, borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: colors.primary, marginTop: 4 },
  calloutTitle: { fontSize: 14, fontWeight: '900', color: colors.primaryDark, marginBottom: 6 },
  calloutText: { fontSize: 13, color: colors.ink, lineHeight: 20, marginTop: 6 },

  bankCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: colors.surface },
  bankHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  bankRank: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.softBlue, alignItems: 'center', justifyContent: 'center' },
  bankRankText: { fontSize: 14, fontWeight: '900', color: colors.primaryDark },
  bankHeaderMain: { flex: 1, gap: 6 },
  bankName: { fontSize: 15, fontWeight: '900', color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: '800' },
  chevron: { fontSize: 20, fontWeight: '900', color: colors.muted, paddingHorizontal: 4 },
  bankBody: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 10 },
  detailGrid: { gap: 10 },
  detailGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
  detailItem: { flexGrow: 1, flexBasis: 220, gap: 2 },
  detailLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { fontSize: 13, color: colors.ink, lineHeight: 19 },
  bankNotes: { fontSize: 13, color: colors.ink, lineHeight: 20, backgroundColor: colors.background, borderRadius: 10, padding: 10 },

  costCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  costTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  costHighlight: { fontSize: 15, fontWeight: '900', color: colors.ink, marginTop: 4 },
  costText: { fontSize: 13, color: colors.ink, lineHeight: 20, marginTop: 8 },

  numberedRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'flex-start' },
  numberBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  numberBadgeText: { fontSize: 11, fontWeight: '900', color: '#fff' },
  numberedText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 20 },

  phaseCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: colors.surface },
  phaseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  phaseHeaderMain: { flex: 1, gap: 4 },
  phaseTitle: { fontSize: 15, fontWeight: '900', color: colors.ink },
  phaseGoal: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  phaseBody: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, paddingTop: 2 },

  rolloutCard: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: 12, padding: 12, marginBottom: 10 },
  rolloutTitle: { fontSize: 14, fontWeight: '900', color: colors.primaryDark },
  riskCard: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.amber, borderRadius: 12, padding: 12, marginBottom: 10 },
  riskTitle: { fontSize: 14, fontWeight: '900', color: colors.ink },
  riskDetail: { fontSize: 13, color: colors.ink, lineHeight: 20, marginTop: 6 },
  riskWhere: { fontSize: 12, color: colors.muted, marginTop: 8, fontWeight: '700' },
  // Mesma anatomia do cartão de risco, com a faixa verde para separar à
  // primeira vista o que está resolvido do que ainda precisa de trabalho.
  agnosticCard: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.green, borderRadius: 12, padding: 12, marginBottom: 10 },
  agnosticTitle: { fontSize: 14, fontWeight: '900', color: colors.green },

  bulletRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  bullet: { fontSize: 14, color: colors.primary, fontWeight: '900' },
  bulletText: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 20 },

  link: { marginTop: 14, alignSelf: 'flex-start' },
  linkText: { fontSize: 13, fontWeight: '800', color: colors.primary, textDecorationLine: 'underline' },
});
