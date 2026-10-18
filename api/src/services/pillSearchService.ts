import { PILLS, Pill } from '../content/pills';

// Busca das "Pílulas do Condomínio" — sem IA e sem banco: as pílulas são
// poucas e estáticas, então um índice em memória por radical resolve. O
// visitante escreve em linguagem natural ("posso proibir cachorro?") e a
// busca precisa tolerar acento, plural e variação de palavra ("cobrar" x
// "cobrança", "animal" x "animais"); por isso cada palavra é reduzida aos
// seus 5 primeiros caracteres sem acento, o que funciona bem em português
// para o vocabulário daqui.

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pelo', 'pela', 'para', 'pra', 'com', 'sem', 'e', 'ou', 'que', 'se', 'ao', 'aos', 'me', 'meu', 'minha',
  'eu', 'ele', 'ela', 'eles', 'elas', 'nao', 'sim', 'mais', 'menos', 'muito', 'qual', 'quais', 'quem', 'quando',
  'onde', 'como', 'porque', 'sobre', 'isso', 'esse', 'essa', 'este', 'esta', 'tem', 'ter', 'ser', 'sao', 'foi',
  'pode', 'podem', 'posso', 'deve', 'devo', 'fazer', 'faz', 'tenho', 'meus', 'minhas', 'nosso', 'nossa', 'ja',
  'condominio', 'condominios', 'predio', 'edificio', 'gente', 'alguem', 'algum', 'alguma', 'todo', 'toda',
  // "contra" tem o mesmo radical de "contratar", "contrato" e "contribuição":
  // deixá-la de fora evita que "como contratar?" case com "votou contra".
  'contra',
]);

const STEM_LENGTH = 5;
// Peso de cada campo: palavra-chave e título indicam o assunto da pílula;
// texto corrido só reforça.
const WEIGHTS = { keywords: 4, title: 3, category: 2, summary: 2, body: 1 } as const;
// Abaixo disso a pílula só "encosta" no assunto (ex.: uma palavra solta no
// corpo do texto) e mostrá-la como resposta confundiria mais do que ajuda.
const MIN_SCORE = 3;

export const tokenize = (text: string) => text
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  .map((word) => word.slice(0, STEM_LENGTH));

type IndexedPill = { pill: Pill; stems: Map<string, number> };

const buildIndex = (pills: Pill[]): IndexedPill[] => pills.map((pill) => {
  const stems = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const stem of tokenize(text)) stems.set(stem, Math.max(stems.get(stem) || 0, weight));
  };
  add(pill.keywords.join(' '), WEIGHTS.keywords);
  add(pill.title, WEIGHTS.title);
  add(pill.category, WEIGHTS.category);
  add(pill.summary, WEIGHTS.summary);
  add([...pill.body, ...pill.practices].join(' '), WEIGHTS.body);
  return { pill, stems };
});

const INDEX = buildIndex(PILLS);

export const searchPills = (query: string, limit = 5) => {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  return INDEX
    .map(({ pill, stems }) => ({ pill, score: terms.reduce((total, term) => total + (stems.get(term) || 0), 0) }))
    .filter((result) => result.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((result) => result.pill);
};

export const findPill = (slug: string) => PILLS.find((pill) => pill.slug === slug);

export const pillSummary = ({ slug, title, category, summary }: Pill) => ({ slug, title, category, summary });
