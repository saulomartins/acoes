// "Pílulas do Condomínio": conteúdo curto e público da landing, sempre com a
// base legal de onde a orientação foi tirada. Fica versionado no código (e não
// no banco) de propósito: cada pílula é revisada antes de ir ao ar, e o diff
// do git é o registro dessa revisão. A busca de /pills/search roda em memória
// sobre esta lista — com algumas dezenas de textos não há custo nem latência
// que justifique outra coisa.
//
// Ao escrever ou alterar uma pílula: cite só o que dá pra conferir na fonte,
// atualize `reviewedAt` e mantenha o texto informativo (sem "você deve
// processar fulano"), já que não substitui a orientação de um advogado.

export type PillSource = { label: string; url?: string };

export type Pill = {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string[];
  practices: string[];
  sources: PillSource[];
  keywords: string[];
  reviewedAt: string;
};

const CODIGO_CIVIL = 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm';
const CPC = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm';
const LEI_8009 = 'https://www.planalto.gov.br/ccivil_03/leis/l8009.htm';
const LEI_8245 = 'https://www.planalto.gov.br/ccivil_03/leis/l8245.htm';
const LEI_14309 = 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14309.htm';
const LEI_4591 = 'https://www.planalto.gov.br/ccivil_03/leis/l4591.htm';
const LGPD ='https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm';

export const PILLS: Pill[] = [
  {
    slug: 'multa-e-juros-por-atraso',
    title: 'Multa por atraso na taxa condominial: até quanto pode cobrar?',
    category: 'Inadimplência',
    summary: 'A multa por atraso é limitada a 2% do débito. Os juros seguem o que a convenção prevê ou, se ela for omissa, 1% ao mês.',
    body: [
      'O Código Civil limita a multa pelo atraso da contribuição condominial a até 2% sobre o débito. Cláusula da convenção que preveja percentual maior não vale para esse fim.',
      'Os juros de mora são os previstos na convenção. Quando a convenção não trata do assunto, aplica-se 1% ao mês. Além disso, o débito pode ser atualizado monetariamente.',
      'Descontos de pontualidade disfarçados ("pague até o dia 5 e ganhe 10%") são vistos com cautela pelos tribunais quando, na prática, funcionam como multa acima do limite legal.',
    ],
    practices: [
      'Confira se a convenção prevê os juros de mora; se não prevê, use 1% ao mês.',
      'Deixe multa, juros e correção discriminados no boleto e na planilha de cobrança.',
      'Registre em ata o índice de correção adotado para evitar questionamentos.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.336, §1º', url: CODIGO_CIVIL },
    ],
    keywords: ['multa', 'juros', 'atraso', 'boleto', 'taxa', 'cota', 'condominial', 'percentual', 'dois por cento', 'mora', 'correção', 'desconto pontualidade'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'cobranca-de-inadimplentes',
    title: 'Como cobrar um condômino inadimplente',
    category: 'Inadimplência',
    summary: 'A taxa condominial aprovada é título executivo: o condomínio pode ir direto à execução. Mas não pode expor o devedor nem bloquear o uso das áreas comuns.',
    body: [
      'Desde o CPC de 2015, as contribuições previstas na convenção ou aprovadas em assembleia, quando documentalmente comprovadas, são título executivo extrajudicial. Isso permite cobrar por execução, que é mais rápida que a antiga ação de cobrança.',
      'A dívida acompanha o imóvel: quem compra a unidade responde pelos débitos condominiais do vendedor, inclusive multas e juros. A lei do bem de família também abre exceção para essas contribuições, o que permite a penhora do próprio imóvel.',
      'O STJ já decidiu que o condomínio não pode impedir o inadimplente de usar áreas comuns (piscina, salão etc.) como forma de pressionar o pagamento — a cobrança deve seguir os meios legais. Também é arriscado expor nomes de devedores em mural ou grupo, o que pode gerar dano moral.',
    ],
    practices: [
      'Tenha uma régua de cobrança escrita: lembrete, notificação amigável, proposta de acordo e, por fim, cobrança judicial.',
      'Guarde a convenção, as atas que aprovaram o orçamento e os demonstrativos de débito: são a prova do título executivo.',
      'Na prestação de contas, informe a inadimplência por unidade de forma não vexatória (ex.: número da unidade, sem expor o morador em espaços públicos).',
      'Ofereça acordo de parcelamento formalizado por escrito antes de judicializar.',
    ],
    sources: [
      { label: 'Código de Processo Civil, art. 784, X', url: CPC },
      { label: 'Código Civil, art. 1.345 (responsabilidade do adquirente)', url: CODIGO_CIVIL },
      { label: 'Lei 8.009/1990, art. 3º, IV (exceção à impenhorabilidade do bem de família)', url: LEI_8009 },
      { label: 'STJ, REsp 1.564.030/MG, 3ª Turma, 2016 (vedação de restringir uso de áreas comuns ao inadimplente)' },
    ],
    keywords: ['inadimplente', 'inadimplência', 'devedor', 'dívida', 'débito', 'cobrança', 'cobrar', 'execução', 'processo', 'penhora', 'acordo', 'parcelamento', 'área comum', 'piscina', 'salão', 'lista de devedores', 'atrasado'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'inadimplente-pode-votar',
    title: 'Condômino inadimplente pode votar em assembleia?',
    category: 'Assembleias',
    summary: 'Não. O direito de votar e participar das deliberações exige que o condômino esteja quite com o condomínio.',
    body: [
      'O Código Civil garante ao condômino o direito de votar nas deliberações da assembleia e delas participar, "estando quite". Quem está em atraso pode comparecer, mas não vota.',
      'Por isso é importante que a administração tenha, no dia da assembleia, uma lista atualizada das unidades em dia, para conferência na hora da votação.',
    ],
    practices: [
      'Leve a relação de unidades quites para a assembleia e anexe-a à ata.',
      'Unidades com acordo de parcelamento em dia costumam ser tratadas como quites — deixe essa regra clara na convenção ou no regimento.',
      'Registre na ata quem votou e quem foi impedido, e por quê.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.335, III', url: CODIGO_CIVIL },
    ],
    keywords: ['votar', 'voto', 'assembleia', 'inadimplente', 'devedor', 'quite', 'participar', 'impedido'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'convocacao-e-quorum-de-assembleia',
    title: 'Assembleia: convocação, quórum e assembleia virtual',
    category: 'Assembleias',
    summary: 'Todos os condôminos precisam ser convocados, sob pena de a assembleia não poder deliberar. A assembleia virtual é permitida se a convenção não proibir.',
    body: [
      'A assembleia não pode deliberar se todos os condôminos não forem convocados. Na prática, convocação falha é uma das causas mais comuns de anulação de assembleia.',
      'Todo ano deve haver uma assembleia ordinária para aprovar o orçamento, as contribuições e a prestação de contas. Se o síndico não a convocar, um quarto dos condôminos pode fazê-lo. Assembleias extraordinárias podem ser convocadas pelo síndico ou por um quarto dos condôminos.',
      'Em primeira convocação, as deliberações exigem maioria dos votos dos presentes que representem ao menos metade das frações ideais; em segunda convocação, basta a maioria dos presentes — salvo quando a lei ou a convenção exigir quórum especial.',
      'Desde a Lei 14.309/2022, a assembleia pode ser realizada de forma eletrônica (virtual ou híbrida), desde que a convenção não vede, garantindo-se os mesmos direitos de voz e voto da assembleia presencial.',
    ],
    practices: [
      'Envie o edital por meio que gere comprovação (e-mail, aplicativo com confirmação de leitura, protocolo) e guarde a prova.',
      'Inclua no edital a pauta completa: assunto fora da pauta não deve ser deliberado.',
      'Em assembleia virtual, informe no edital a plataforma, como votar e como pedir a palavra.',
      'Confira na convenção os quóruns especiais (alteração da convenção, obras voluptuárias, destituição do síndico).',
    ],
    sources: [
      { label: 'Código Civil, arts. 1.350, 1.352, 1.353, 1.354 e 1.355', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.354-A (assembleia eletrônica), incluído pela Lei 14.309/2022', url: LEI_14309 },
    ],
    keywords: ['assembleia', 'convocação', 'convocar', 'edital', 'quórum', 'quorum', 'votação', 'virtual', 'online', 'eletrônica', 'híbrida', 'ordinária', 'extraordinária', 'pauta', 'anulação', 'ata'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'barulho-e-condomino-antissocial',
    title: 'Barulho e condômino antissocial: o que o condomínio pode fazer',
    category: 'Convivência',
    summary: 'O condômino não pode prejudicar o sossego dos vizinhos. A multa depende de previsão na convenção, e o morador deve ter chance de se defender antes de ser punido.',
    body: [
      'Entre os deveres do condômino está o de não usar sua unidade de maneira prejudicial ao sossego, à salubridade e à segurança dos demais. Quem descumpre fica sujeito à multa prevista na convenção ou no regimento, limitada a cinco vezes o valor da contribuição mensal.',
      'Se o descumprimento for reiterado, a assembleia pode aplicar multa de até cinco vezes a contribuição mensal, pelo voto de três quartos dos condôminos restantes. Em caso de comportamento antissocial reiterado que torne a convivência insuportável, a multa pode chegar a dez vezes a contribuição, até nova deliberação da assembleia.',
      'O STJ entende que, antes de aplicar a multa por comportamento antissocial, o condomínio deve notificar o morador e dar oportunidade de defesa.',
    ],
    practices: [
      'Registre cada ocorrência com data, horário e testemunhas — sem registro não há reiteração comprovada.',
      'Notifique por escrito, descreva o fato e o artigo violado e abra prazo para defesa antes de multar.',
      'Mantenha o regimento interno com horários de silêncio e valores de multa claros.',
      'Prefira a mediação nas primeiras ocorrências; a multa é o último recurso.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.336, IV e §2º', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.337 e parágrafo único', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.277 (uso anormal da propriedade)', url: CODIGO_CIVIL },
      { label: 'STJ, REsp 1.365.279/SP, 4ª Turma, 2015 (direito de defesa antes da multa por comportamento antissocial)' },
    ],
    keywords: ['barulho', 'ruído', 'som', 'música', 'festa', 'silêncio', 'sossego', 'vizinho', 'antissocial', 'multa', 'reclamação', 'ocorrência', 'infração', 'notificação', 'advertência', 'defesa', 'briga'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'animais-no-condominio',
    title: 'O condomínio pode proibir animais de estimação?',
    category: 'Convivência',
    summary: 'Proibição genérica de animais não vale. O condomínio pode, sim, regular o uso das áreas comuns e coibir animais que tragam risco à segurança, higiene, saúde ou sossego.',
    body: [
      'O STJ decidiu que a convenção não pode proibir de forma genérica a criação de animais que não ofereçam risco à segurança, à higiene, à saúde e ao sossego dos moradores.',
      'Isso não impede regras razoáveis: uso de coleira e guia nas áreas comuns, circulação pelo elevador de serviço, recolhimento de dejetos e responsabilidade do tutor por danos.',
      'Quando um animal específico causa barulho excessivo ou risco, aplicam-se as regras gerais de sossego, segurança e uso da propriedade, com notificação e multa nos termos da convenção.',
    ],
    practices: [
      'Troque a proibição genérica por regras de convivência no regimento interno.',
      'Trate cada reclamação pelo fato concreto (latido contínuo, agressividade, sujeira), com registro de ocorrência.',
      'Exija do tutor a reparação de danos às áreas comuns.',
    ],
    sources: [
      { label: 'STJ, REsp 1.783.076/DF, 3ª Turma, 2019 (proibição genérica de animais)' },
      { label: 'Código Civil, art. 1.336, IV, e art. 1.277', url: CODIGO_CIVIL },
    ],
    keywords: ['animal', 'animais', 'pet', 'cachorro', 'cão', 'gato', 'bicho', 'estimação', 'latido', 'coleira', 'elevador', 'proibir', 'proibição'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'airbnb-e-locacao-por-temporada',
    title: 'Airbnb e locação por temporada no condomínio',
    category: 'Uso das unidades',
    summary: 'O STJ entende que, em condomínio de destinação residencial, a convenção pode impedir a locação de curta duração por plataformas como o Airbnb.',
    body: [
      'A Lei do Inquilinato permite a locação para temporada por até 90 dias. Mas o STJ distinguiu essa locação da hospedagem de curtíssima duração e alta rotatividade, intermediada por plataformas digitais, que se aproxima de atividade de hospedagem.',
      'Nesse cenário, o STJ decidiu que, sendo o condomínio de destinação residencial, a convenção pode proibir esse tipo de uso. A questão, portanto, depende muito do que a convenção diz.',
      'Se o condomínio decidir permitir, pode regulamentar: cadastro prévio dos hóspedes, limite de pessoas, entrega das regras internas e responsabilidade do proprietário por danos e multas.',
    ],
    practices: [
      'Verifique a destinação e as regras de uso previstas na convenção antes de agir.',
      'Para proibir ou regulamentar, aprove a alteração na convenção com o quórum exigido em lei.',
      'Se permitido, exija cadastro dos hóspedes na portaria e responsabilize o proprietário pelas infrações.',
    ],
    sources: [
      { label: 'STJ, REsp 1.819.075/RS, 4ª Turma, 2021 (convenção pode vedar locação via plataformas em condomínio residencial)' },
      { label: 'Lei 8.245/1991, art. 48 (locação para temporada)', url: LEI_8245 },
      { label: 'Código Civil, art. 1.351 (quórum para alterar a convenção)', url: CODIGO_CIVIL },
    ],
    keywords: ['airbnb', 'temporada', 'aluguel', 'alugar', 'locação', 'hóspede', 'hospedagem', 'booking', 'curta', 'turista', 'rotatividade'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'obras-no-condominio',
    title: 'Obras nas áreas comuns e reformas nas unidades',
    category: 'Obras e manutenção',
    summary: 'O quórum depende do tipo de obra: necessárias dispensam assembleia, úteis exigem maioria e voluptuárias exigem dois terços. Fachada não pode ser alterada pelo condômino.',
    body: [
      'Obras necessárias (que conservam o prédio ou evitam que se deteriore) podem ser feitas pelo síndico — ou, se ele se omitir, por qualquer condômino — sem autorização da assembleia. Se forem urgentes e de valor elevado, o síndico deve convocar a assembleia imediatamente para dar ciência.',
      'Obras úteis (que aumentam ou facilitam o uso) exigem a aprovação da maioria dos condôminos. Obras voluptuárias (de embelezamento ou lazer) exigem dois terços dos condôminos.',
      'Nas unidades, o condômino não pode alterar a forma e a cor da fachada, das partes e das esquadrias externas. Reformas internas devem seguir a norma técnica ABNT NBR 16.280, que prevê a apresentação de um plano de reforma ao responsável pela edificação antes do início.',
    ],
    practices: [
      'Classifique a obra (necessária, útil ou voluptuária) antes de convocar a assembleia.',
      'Faça pelo menos três orçamentos e registre a escolha em ata.',
      'Exija o plano de reforma com responsável técnico (ART/RRT) antes de liberar obras nas unidades.',
      'Divulgue na prestação de contas os gastos com obras, com notas e comprovantes.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.341', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.336, III (fachada)', url: CODIGO_CIVIL },
      { label: 'ABNT NBR 16.280 (reformas em edificações)' },
    ],
    keywords: ['obra', 'obras', 'reforma', 'manutenção', 'fachada', 'janela', 'esquadria', 'pintura', 'benfeitoria', 'necessária', 'útil', 'voluptuária', 'orçamento', 'plano de reforma', 'nbr', 'art', 'engenheiro'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'prestacao-de-contas-e-deveres-do-sindico',
    title: 'Prestação de contas e deveres do síndico',
    category: 'Gestão e síndico',
    summary: 'O síndico deve prestar contas à assembleia todo ano e sempre que exigidas. Se não prestar contas ou praticar irregularidades, pode ser destituído.',
    body: [
      'Entre as atribuições do síndico estão: representar o condomínio, cumprir e fazer cumprir a convenção e o regimento, cuidar da conservação das áreas comuns, elaborar o orçamento anual, cobrar as contribuições, prestar contas à assembleia anualmente e quando exigidas, e contratar o seguro da edificação.',
      'O conselho fiscal, se previsto na convenção, é composto por três membros, eleitos pela assembleia por prazo de até dois anos, e dá parecer sobre as contas do síndico.',
      'A assembleia pode destituir o síndico que praticar irregularidades, não prestar contas ou não administrar convenientemente o condomínio, pelo voto da maioria absoluta de seus membros.',
    ],
    practices: [
      'Publique um balancete mensal com receitas, despesas, saldo e comprovantes anexados.',
      'Submeta as contas ao conselho fiscal antes da assembleia e registre o parecer.',
      'Separe a conta bancária do condomínio de qualquer conta pessoal.',
      'Guarde notas, contratos e extratos pelo menos pelo prazo prescricional aplicável.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.348 (competências do síndico)', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.349 (destituição)', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.356 (conselho fiscal)', url: CODIGO_CIVIL },
    ],
    keywords: ['prestação de contas', 'contas', 'balancete', 'síndico', 'sindico', 'conselho fiscal', 'destituir', 'destituição', 'transparência', 'orçamento', 'deveres', 'atribuições', 'irregularidade'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'seguro-obrigatorio-do-condominio',
    title: 'Seguro do condomínio é obrigatório?',
    category: 'Gestão e síndico',
    summary: 'Sim. A lei obriga o seguro de toda a edificação contra incêndio ou destruição, total ou parcial, e cabe ao síndico contratá-lo.',
    body: [
      'O Código Civil torna obrigatório o seguro de toda a edificação contra o risco de incêndio ou destruição, total ou parcial. Contratar esse seguro é uma das atribuições do síndico.',
      'Coberturas adicionais (responsabilidade civil, danos elétricos, vendaval, responsabilidade civil do síndico) não são obrigatórias por lei, mas costumam ser recomendadas e podem ser aprovadas em assembleia.',
    ],
    practices: [
      'Defina o valor segurado com base no custo de reconstrução, não no valor de mercado.',
      'Renove antes do vencimento e mantenha a apólice disponível aos condôminos.',
      'Avalie a cobertura de responsabilidade civil do síndico, que protege o gestor em caso de erro de gestão.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.346', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.348, IX', url: CODIGO_CIVIL },
    ],
    keywords: ['seguro', 'apólice', 'incêndio', 'obrigatório', 'cobertura', 'sinistro', 'seguradora'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'lgpd-no-condominio',
    title: 'LGPD no condomínio: câmeras, cadastro e dados dos moradores',
    category: 'LGPD e segurança',
    summary: 'O condomínio trata dados pessoais (cadastros, imagens, acessos) e deve seguir a LGPD: coletar só o necessário, com finalidade clara, e protegê-los.',
    body: [
      'A LGPD se aplica ao condomínio quando ele coleta dados de moradores, visitantes e funcionários — nome, documento, telefone, placa do carro, imagens de câmeras e registros de acesso.',
      'O tratamento deve respeitar princípios como finalidade (usar o dado só para o motivo informado), necessidade (coletar o mínimo) e segurança. A base legal para segurança patrimonial costuma ser o legítimo interesse do condomínio.',
      'Os titulares têm direito de saber quais dados o condomínio guarda, corrigi-los e, em certos casos, pedir a eliminação.',
    ],
    practices: [
      'Peça na portaria só os dados necessários e defina por quanto tempo serão guardados.',
      'Sinalize as áreas monitoradas por câmeras e restrinja quem acessa as gravações.',
      'Não divulgue dados de moradores em grupos de mensagem ou murais.',
      'Formalize com a administradora e fornecedores o cuidado com os dados compartilhados.',
    ],
    sources: [
      { label: 'Lei 13.709/2018 (LGPD), arts. 6º, 7º e 18', url: LGPD },
    ],
    keywords: ['lgpd', 'dados', 'dados pessoais', 'privacidade', 'câmera', 'câmeras', 'cftv', 'imagem', 'gravação', 'portaria', 'cadastro', 'visitante', 'biometria', 'reconhecimento facial'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'rateio-das-despesas',
    title: 'Como as despesas do condomínio são divididas',
    category: 'Financeiro',
    summary: 'Em regra, cada condômino contribui na proporção da sua fração ideal. A convenção pode estabelecer outro critério.',
    body: [
      'O Código Civil determina que o condômino contribua para as despesas do condomínio na proporção das suas frações ideais, salvo disposição em contrário na convenção.',
      'Por isso, unidades maiores (como coberturas) costumam pagar mais. Mudar esse critério exige alterar a convenção, com o quórum previsto em lei.',
      'Despesas de uso individual medido, como água ou gás com medição individualizada, podem ser cobradas pelo consumo de cada unidade, conforme o que a convenção ou a assembleia estabelecer.',
    ],
    practices: [
      'Confira na convenção qual é o critério de rateio antes de montar o orçamento.',
      'Mostre no boleto a composição da cobrança (taxa ordinária, fundo de reserva, consumo, extras).',
      'Separe despesas ordinárias e extraordinárias — a diferença importa, por exemplo, na relação entre proprietário e inquilino.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.336, I', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.351 (alteração da convenção)', url: CODIGO_CIVIL },
      { label: 'Lei 8.245/1991, arts. 22, X, e 23, XII (despesas extraordinárias e ordinárias na locação)', url: LEI_8245 },
    ],
    keywords: ['rateio', 'divisão', 'dividir', 'fração ideal', 'fração', 'cobertura', 'proporção', 'despesas', 'consumo', 'água', 'gás', 'unidade maior'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'como-calcular-a-taxa-condominial',
    title: 'Como calcular o valor da taxa de condomínio',
    category: 'Financeiro',
    summary: 'Some as despesas previstas no orçamento anual aprovado em assembleia, acrescente o fundo de reserva e divida entre as unidades pela fração ideal de cada uma, salvo critério diferente na convenção.',
    body: [
      'O ponto de partida é o orçamento anual, que o síndico elabora e a assembleia ordinária aprova. Ele reúne todas as despesas previstas: folha de pagamento e encargos, contas de consumo das áreas comuns, manutenção de elevadores e bombas, limpeza, seguro, administradora, pequenos reparos e contratos em geral.',
      'Sobre esse total soma-se a contribuição para o fundo de reserva, no percentual definido na convenção ou em assembleia. Muitos condomínios também incluem uma previsão para cobrir a inadimplência esperada, para que o caixa não fique descoberto.',
      'O valor mensal é dividido pela fração ideal de cada unidade, que é o critério do Código Civil quando a convenção não prevê outro. Exemplo: despesas de R$ 30.000 por mês + 10% de fundo de reserva = R$ 33.000. Uma unidade com fração ideal de 1,25% (0,0125) paga R$ 33.000 × 0,0125 = R$ 412,50. Se a convenção dividir em partes iguais, basta dividir R$ 33.000 pelo número de unidades.',
      'Despesas com medição individual (água, gás) são cobradas à parte, pelo consumo de cada unidade, conforme o que a convenção ou a assembleia definir.',
    ],
    practices: [
      'Monte o orçamento a partir dos gastos reais dos últimos 12 meses, corrigidos pelos reajustes de contratos e salários previstos.',
      'Separe no orçamento as despesas ordinárias, o fundo de reserva e eventuais obras: isso facilita a prestação de contas e a divisão com inquilinos.',
      'Aprove o orçamento e o valor da taxa na assembleia ordinária e registre em ata. A ata é a base da cobrança.',
      'Revise o orçamento no meio do ano. Se o caixa estiver negativo, convoque assembleia para ajustar a taxa ou aprovar um rateio extra.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.336, I (contribuição pela fração ideal)', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.348, VI (síndico elabora o orçamento anual)', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.350 (assembleia aprova orçamento e contribuições)', url: CODIGO_CIVIL },
    ],
    keywords: ['calcular', 'cálculo', 'valor', 'taxa condominial', 'taxa', 'cota', 'mensalidade', 'quanto pagar', 'orçamento', 'previsão orçamentária', 'reajuste', 'aumento', 'fração ideal', 'conta', 'fórmula'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'custo-de-obras-e-rateio-extra',
    title: 'Como pagar uma obra: fundo de reserva ou rateio extra?',
    category: 'Obras e manutenção',
    summary: 'Obra de valor relevante costuma ser paga com o fundo de reserva, com uma cobrança extra aprovada em assembleia ou com as duas coisas. O custo é dividido entre todos os condôminos pela fração ideal, inclusive entre quem votou contra.',
    body: [
      'Antes de falar em custo, é preciso aprovar a obra com o quórum certo: obras necessárias podem ser feitas pelo síndico sem assembleia; úteis exigem maioria dos condôminos; voluptuárias exigem dois terços. Se a obra necessária for urgente e cara, o síndico deve convocar a assembleia imediatamente para dar ciência.',
      'Para pagar, as alternativas mais comuns são: usar o fundo de reserva, se a convenção permitir esse uso; aprovar um rateio extra (também chamado de "chamada de capital"), dividido em parcelas; ou combinar os dois. A assembleia aprova o valor total, o número de parcelas e o critério de divisão.',
      'Aprovada pela assembleia com o quórum exigido, a despesa obriga todos os condôminos, inclusive os ausentes e os que votaram contra, na proporção da fração ideal (ou do critério previsto na convenção).',
      'Na locação, obras de reforma estrutural, pintura de fachada, reposição das condições de habitabilidade e instalação de equipamentos de segurança ou lazer são despesas extraordinárias: quem paga é o proprietário, não o inquilino.',
    ],
    practices: [
      'Peça pelo menos três orçamentos com o mesmo escopo e leve os três para a assembleia.',
      'Para obras de engenharia, exija responsável técnico (ART/RRT), cronograma e contrato com etapas de pagamento vinculadas à execução.',
      'Lance a cobrança extra em boleto separado ou destacado, identificada como despesa extraordinária, para o proprietário poder conferir o que cabe a ele e ao inquilino.',
      'Preste contas da obra à parte: valor aprovado, valor gasto, notas fiscais e saldo.',
    ],
    sources: [
      { label: 'Código Civil, art. 1.341 (quórum e obras urgentes)', url: CODIGO_CIVIL },
      { label: 'Código Civil, art. 1.336, I (contribuição pela fração ideal)', url: CODIGO_CIVIL },
      { label: 'Lei 8.245/1991, art. 22, X e parágrafo único (despesas extraordinárias são do locador)', url: LEI_8245 },
    ],
    keywords: ['custo', 'custo da obra', 'pagar obra', 'rateio extra', 'chamada de capital', 'cobrança extra', 'taxa extra', 'extraordinária', 'parcelar', 'parcelas', 'orçamento', 'quem paga', 'votou contra', 'impermeabilização', 'elevador novo', 'dividir'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'melhorias-e-benfeitorias',
    title: 'Melhorias no condomínio: quem aprova e quem paga',
    category: 'Obras e manutenção',
    summary: 'O Código Civil separa as benfeitorias em necessárias, úteis e voluptuárias, e cada tipo pede um quórum diferente. Melhoria que só serve a alguns condôminos deve ser paga por eles.',
    body: [
      'O Código Civil define três tipos de benfeitoria. Necessárias conservam o bem ou evitam que ele se deteriore (ex.: trocar a tubulação condenada, refazer a impermeabilização). Úteis aumentam ou facilitam o uso (ex.: instalar portão automático, ampliar a garagem, colocar rampa de acessibilidade). Voluptuárias são de mero deleite ou recreio (ex.: reformar o hall só por estética, construir um espaço gourmet).',
      'A aprovação segue esse enquadramento: necessárias dispensam assembleia; úteis exigem maioria dos condôminos; voluptuárias exigem dois terços. Obras em partes comuns para facilitar ou aumentar seu uso dependem de dois terços dos votos e não podem prejudicar o uso das unidades nem das áreas comuns.',
      'O custo é dividido entre todos pela fração ideal. Há uma exceção importante: as despesas com partes comuns de uso exclusivo de um ou de alguns condôminos são pagas por quem as utiliza.',
      'Na locação, instalações de segurança, lazer, esporte, telefonia e intercomunicação, além de decoração e paisagismo das áreas comuns, são despesas extraordinárias e ficam com o proprietário.',
    ],
    practices: [
      'Antes da assembleia, classifique a melhoria e informe no edital o quórum que ela exige.',
      'Apresente o valor por unidade, não só o total: isso deixa a decisão mais clara para quem vota.',
      'Quando a melhoria atender só a um bloco ou a um grupo de unidades, registre em ata quem vai pagar.',
      'Na dúvida entre "útil" e "voluptuária", adote o quórum maior: isso reduz o risco de a decisão ser anulada.',
    ],
    sources: [
      { label: 'Código Civil, art. 96 (benfeitorias voluptuárias, úteis e necessárias)', url: CODIGO_CIVIL },
      { label: 'Código Civil, arts. 1.340, 1.341 e 1.342', url: CODIGO_CIVIL },
      { label: 'Lei 8.245/1991, art. 22, parágrafo único, "e" e "f"', url: LEI_8245 },
    ],
    keywords: ['melhoria', 'melhorias', 'benfeitoria', 'benfeitorias', 'útil', 'voluptuária', 'necessária', 'valor da melhoria', 'modernização', 'portão', 'academia', 'espaço gourmet', 'paisagismo', 'decoração', 'acessibilidade', 'quórum', 'uso exclusivo', 'aprovar'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'inquilino-ou-proprietario-quem-paga',
    title: 'Inquilino ou proprietário: quem paga o quê no condomínio',
    category: 'Locação',
    summary: 'Pela Lei do Inquilinato, o inquilino paga as despesas ordinárias (o dia a dia do condomínio) e o proprietário paga as extraordinárias (obras, melhorias e fundo de reserva). Para o condomínio, porém, o responsável pela dívida é o proprietário.',
    body: [
      'Ficam com o inquilino as despesas ordinárias: salários e encargos dos funcionários; água, luz e gás das áreas comuns; limpeza, conservação e pintura das áreas comuns; manutenção de equipamentos hidráulicos, elétricos, de segurança, de lazer, elevadores, interfone e antena coletiva; pequenos reparos; e a reposição do fundo de reserva quando ele tiver sido usado para pagar essas despesas ordinárias.',
      'Ficam com o proprietário as despesas extraordinárias: reformas e acréscimos na estrutura do prédio; pintura de fachada e esquadrias externas; obras para repor as condições de habitabilidade; indenizações trabalhistas por demissões anteriores à locação; instalação de equipamentos de segurança, incêndio, telefonia, interfone, esporte e lazer; decoração e paisagismo das áreas comuns; e a constituição do fundo de reserva.',
      'O inquilino só é obrigado a pagar as despesas ordinárias se elas estiverem comprovadas pela previsão orçamentária e pelo rateio mensal, e pode exigir essa comprovação.',
      'Perante o condomínio, a dívida é do imóvel e de seu proprietário. Se o inquilino não pagar, o condomínio cobra o proprietário, que depois pode cobrar do inquilino com base no contrato de locação.',
    ],
    practices: [
      'Separe no boleto o que é taxa ordinária, fundo de reserva e cobrança extraordinária. Isso evita briga entre proprietário e inquilino.',
      'Disponibilize o orçamento aprovado e o demonstrativo mensal: o inquilino tem direito de conferir.',
      'Mantenha no cadastro o proprietário como responsável, mesmo quando o boleto for enviado ao inquilino.',
      'Em caso de atraso, notifique o proprietário desde o início, não só o inquilino.',
    ],
    sources: [
      { label: 'Lei 8.245/1991, art. 22, X e parágrafo único (despesas extraordinárias, do locador)', url: LEI_8245 },
      { label: 'Lei 8.245/1991, art. 23, XII e §§ 1º a 3º (despesas ordinárias, do locatário)', url: LEI_8245 },
      { label: 'Código Civil, art. 1.345 (a dívida acompanha a unidade)', url: CODIGO_CIVIL },
    ],
    keywords: ['inquilino', 'locatário', 'proprietário', 'locador', 'dono', 'aluguel', 'alugado', 'locação', 'quem paga', 'responsável', 'ordinária', 'ordinárias', 'extraordinária', 'extraordinárias', 'despesa', 'contrato de locação', 'imobiliária'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'fundo-de-reserva',
    title: 'Fundo de reserva: para que serve e quem paga',
    category: 'Financeiro',
    summary: 'É uma poupança do condomínio para despesas imprevistas ou urgentes. Formar o fundo é encargo do proprietário. Se ele for usado para despesas do dia a dia, a reposição fica com o inquilino.',
    body: [
      'O fundo de reserva é formado com uma contribuição mensal, normalmente um percentual da taxa condominial definido na convenção ou em assembleia. Ele serve para emergências e despesas não previstas, como o conserto urgente de uma bomba ou de um elevador.',
      'As regras de uso (para quê, com que autorização e até que valor) costumam estar na convenção. Usar o fundo fora dessas regras, ou sem prestar contas, pode levar à responsabilização do síndico.',
      'Na locação, formar o fundo de reserva é despesa extraordinária, paga pelo proprietário. Se o fundo for usado para cobrir despesas ordinárias, a reposição dessa parte cabe ao inquilino, exceto quando se referir a período anterior ao início da locação.',
    ],
    practices: [
      'Mantenha o fundo em aplicação separada da conta do dia a dia e mostre o saldo em toda prestação de contas.',
      'Registre cada uso do fundo com o motivo, a autorização e o comprovante.',
      'Ao usar o fundo para obras, aprove em assembleia o plano de recomposição.',
      'Destaque a parcela do fundo no boleto, separada da taxa ordinária.',
    ],
    sources: [
      { label: 'Lei 8.245/1991, art. 22, parágrafo único, "g" (constituição do fundo, pelo locador)', url: LEI_8245 },
      { label: 'Lei 8.245/1991, art. 23, §1º, "i" (reposição do fundo, pelo locatário)', url: LEI_8245 },
      { label: 'Código Civil, art. 1.348, VIII (prestação de contas do síndico)', url: CODIGO_CIVIL },
    ],
    keywords: ['fundo de reserva', 'fundo', 'reserva', 'poupança', 'emergência', 'imprevisto', 'reposição', 'recompor', 'saldo', 'aplicação', 'percentual', 'quem paga'],
    reviewedAt: '2026-10-18',
  },
  {
    slug: 'inquilino-pode-votar',
    title: 'Inquilino pode votar na assembleia?',
    category: 'Assembleias',
    summary: 'Pode, em situações específicas: se o proprietário não comparecer, o inquilino vota nas decisões que não envolvam despesas extraordinárias. Também pode votar com procuração do proprietário.',
    body: [
      'A Lei 4.591/1964 permite que o inquilino vote nas decisões da assembleia que não envolvam despesas extraordinárias, desde que o proprietário não compareça.',
      'Em assuntos como obras, melhorias e fundo de reserva, que são pagos pelo proprietário, o inquilino só vota se tiver procuração dele, nos termos que a convenção permitir.',
    ],
    practices: [
      'Na lista de presença, identifique quem é proprietário, quem é inquilino e quem é procurador.',
      'Separe na pauta os itens que envolvem despesas extraordinárias, para saber em quais o inquilino não pode votar sem procuração.',
      'Confira na convenção as regras de procuração (forma, limite de representados etc.).',
    ],
    sources: [
      { label: 'Lei 4.591/1964, art. 24, §4º (incluído pela Lei 9.267/1996)', url: LEI_4591 },
    ],
    keywords: ['inquilino', 'locatário', 'votar', 'voto', 'assembleia', 'procuração', 'representar', 'participar'],
    reviewedAt: '2026-10-18',
  },
];
