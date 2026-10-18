import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { API_BASE_URL } from '../api/client';
import { CardGrid } from '../ui/grid';
import { colors, shadow } from '../ui/theme';
import ChatAssistant from '../ui/ChatAssistant';
import CookieConsent from '../ui/CookieConsent';

// "Pílulas do Condomínio" — página pública da landing (só existe no build web,
// em /pilulas). Lista, busca e detalhe de pílulas, mais o formulário "deixe
// sua pergunta" para quando a busca não encontra nada. Todo o conteúdo vem da
// API (api/src/content/pills.ts); aqui é só apresentação.

type PillSummary = { slug: string; title: string; category: string; summary: string };
type Pill = PillSummary & { body: string[]; practices: string[]; sources: Array<{ label: string; url?: string }>; reviewedAt: string };

const DISCLAIMER = 'Conteúdo informativo, com base na legislação e em decisões citadas. Não substitui a orientação de um advogado para o seu caso concreto.';

const getJson = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'Não foi possível carregar as pílulas.');
  return data as T;
};

const formatDate = (value: string) => value.split('-').reverse().join('/');

const PillCard = ({ pill, onPress }: { pill: PillSummary; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <Text style={styles.cardCategory}>{pill.category.toUpperCase()}</Text>
    <Text style={styles.cardTitle}>{pill.title}</Text>
    <Text style={styles.cardSummary}>{pill.summary}</Text>
    <Text style={styles.cardLink}>Ler pílula →</Text>
  </Pressable>
);

const QuestionForm = ({ initialQuestion = '' }: { initialQuestion?: string }) => {
  const [question, setQuestion] = useState(initialQuestion);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setQuestion(initialQuestion), [initialQuestion]);

  const submit = async () => {
    if (sending) return;
    if (question.trim().length < 10) { setError('Escreva sua pergunta com pelo menos 10 caracteres.'); return; }
    setSending(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/pills/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), email: email.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Falha ao enviar a pergunta.');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar a pergunta. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  if (sent) return <View style={styles.questionBox}><Text style={styles.sentText}>Pergunta recebida! Ela entra na nossa pauta de novas pílulas{email.trim() ? ' e avisamos você por e-mail quando a resposta sair' : ''}.</Text></View>;
  return (
    <View style={styles.questionBox}>
      <Text style={styles.questionTitle}>Não encontrou o que procurava?</Text>
      <Text style={styles.questionText}>Deixe sua pergunta. As dúvidas mais frequentes viram novas pílulas, sempre com a base legal.</Text>
      <TextInput value={question} onChangeText={(value) => setQuestion(value.slice(0, 1000))} placeholder="Sua pergunta sobre condomínio" placeholderTextColor={colors.placeholder} multiline style={[styles.input, styles.inputMultiline]} />
      <TextInput value={email} onChangeText={(value) => setEmail(value.replace(/\s/g, '').slice(0, 160))} placeholder="Seu e-mail (opcional, para avisarmos da resposta)" placeholderTextColor={colors.placeholder} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.input} />
      <Text style={styles.privacyNote}>Não inclua nomes, documentos ou dados de outras pessoas na pergunta.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={submit} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>{sending ? 'Enviando...' : 'Enviar pergunta'}</Text>
      </Pressable>
    </View>
  );
};

export default function Pills({ route, navigation }: any) {
  const slug: string | undefined = route.params?.slug;
  const routeQuery: string = route.params?.q || '';

  const [all, setAll] = useState<PillSummary[]>([]);
  const [pill, setPill] = useState<Pill | null>(null);
  const [search, setSearch] = useState(routeQuery);
  const [results, setResults] = useState<PillSummary[] | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getJson<{ pills: PillSummary[] }>('/pills').then((data) => setAll(data.pills)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!slug) { setPill(null); return; }
    let active = true;
    setLoading(true);
    setError('');
    getJson<{ pill: Pill }>(`/pills/${encodeURIComponent(slug)}`)
      .then((data) => { if (active) setPill(data.pill); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  const runSearch = async (term: string) => {
    const q = term.trim();
    if (!q) { setResults(null); setSearchedFor(''); return; }
    setLoading(true);
    setError('');
    try {
      const data = await getJson<{ pills: PillSummary[] }>(`/pills/search?q=${encodeURIComponent(q)}`);
      setResults(data.pills);
      setSearchedFor(q);
      if (slug) navigation.setParams({ slug: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na busca.');
    } finally {
      setLoading(false);
    }
  };

  // Busca vinda da landing (/pilulas?q=...).
  useEffect(() => { if (routeQuery) { setSearch(routeQuery); runSearch(routeQuery); } }, [routeQuery]);

  const openPill = (target: string) => navigation.navigate('Pills', { slug: target });
  const goBack = () => {
    if (slug) navigation.setParams({ slug: undefined });
    else navigation.navigate('Landing');
  };

  const categories = [...new Set(all.map((item) => item.category))];
  const related = pill ? all.filter((item) => item.category === pill.category && item.slug !== pill.slug) : [];

  return (
    <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        <Pressable onPress={goBack} style={styles.back}><Text style={styles.backText}>‹ {slug ? 'Todas as pílulas' : 'Voltar ao site'}</Text></Pressable>
        <Text style={styles.brand}>LAR EM DIA</Text>
      </View>

      <View style={styles.container}>
        <Text style={styles.eyebrow}>PÍLULAS DO CONDOMÍNIO</Text>
        <Text style={styles.title}>Dúvidas de condomínio, respondidas com base na lei</Text>
        <Text style={styles.subtitle}>Boas práticas de gestão condominial em textos curtos, cada um com a referência legal de onde foi tirado.</Text>

        <View style={styles.searchRow}>
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => runSearch(search)} returnKeyType="search" placeholder="Ex.: o condomínio pode proibir cachorro?" placeholderTextColor={colors.placeholder} style={[styles.input, styles.searchInput]} />
          <Pressable onPress={() => runSearch(search)} style={({ pressed }) => [styles.button, styles.searchButton, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>Buscar</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} /> : null}

        {pill && !loading ? (
          <View style={styles.article}>
            <Text style={styles.cardCategory}>{pill.category.toUpperCase()}</Text>
            <Text style={styles.articleTitle}>{pill.title}</Text>
            <View style={styles.answerBox}><Text style={styles.answerLabel}>Resposta curta</Text><Text style={styles.answerText}>{pill.summary}</Text></View>
            {pill.body.map((paragraph) => <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>)}

            <Text style={styles.blockTitle}>Boas práticas</Text>
            {pill.practices.map((item) => <View key={item} style={styles.bulletRow}><Text style={styles.bulletMark}>✓</Text><Text style={styles.bulletText}>{item}</Text></View>)}

            <View style={styles.sourcesBox}>
              <Text style={styles.blockTitle}>📚 Base legal</Text>
              {pill.sources.map((source) => source.url ? (
                <Pressable key={source.label} onPress={() => Linking.openURL(source.url!)}><Text style={[styles.sourceText, styles.sourceLink]}>{source.label} ↗</Text></Pressable>
              ) : <Text key={source.label} style={styles.sourceText}>{source.label}</Text>)}
              <Text style={styles.reviewed}>Revisado em {formatDate(pill.reviewedAt)}</Text>
            </View>
            <Text style={styles.disclaimer}>{DISCLAIMER}</Text>

            {related.length ? <><Text style={styles.blockTitle}>Leia também</Text><CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={12}>{related.map((item) => <PillCard key={item.slug} pill={item} onPress={() => openPill(item.slug)} />)}</CardGrid></> : null}
          </View>
        ) : null}

        {!slug && results && !loading ? (
          <View style={styles.block}>
            {results.length ? (
              <>
                <Text style={styles.resultsTitle}>Pílulas sobre “{searchedFor}”</Text>
                <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={12}>{results.map((item) => <PillCard key={item.slug} pill={item} onPress={() => openPill(item.slug)} />)}</CardGrid>
              </>
            ) : (
              <Text style={styles.resultsTitle}>Ainda não temos uma pílula sobre “{searchedFor}”.</Text>
            )}
            <Pressable onPress={() => { setSearch(''); setResults(null); setSearchedFor(''); }}><Text style={styles.clearLink}>Ver todas as pílulas</Text></Pressable>
          </View>
        ) : null}

        {!slug && !results && !loading ? categories.map((category) => (
          <View key={category} style={styles.block}>
            <Text style={styles.categoryTitle}>{category}</Text>
            <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={12}>
              {all.filter((item) => item.category === category).map((item) => <PillCard key={item.slug} pill={item} onPress={() => openPill(item.slug)} />)}
            </CardGrid>
          </View>
        )) : null}

        <QuestionForm initialQuestion={!slug && results && !results.length ? searchedFor : ''} />

        <View style={styles.cta}>
          <Text style={styles.ctaTitle}>Quer colocar essas boas práticas em prática?</Text>
          <Text style={styles.ctaText}>O Lar em Dia não é uma administradora e não faz a gestão do seu condomínio. Nós oferecemos a plataforma para que o síndico e o subsíndico façam a gestão com independência: cobrança por Pix e boleto, ocorrências com direito de defesa, avisos, reservas e prestação de contas homologada pelo conselho fiscal.</Text>
          <Text style={styles.ctaStepsTitle}>Como contratar</Text>
          {['Peça uma proposta informando o número de unidades e as funcionalidades de interesse.', 'Nossa equipe envia a proposta. O valor depende das unidades e das funcionalidades.', 'Implantação simplificada: o síndico recebe o acesso e cada morador entra com o próprio login.'].map((step, index) => (
            <View key={step} style={styles.ctaStep}><Text style={styles.ctaStepNumber}>{index + 1}</Text><Text style={styles.ctaStepText}>{step}</Text></View>
          ))}
          <Pressable onPress={() => navigation.navigate('Landing', { section: 'planos' })} style={({ pressed }) => [styles.button, styles.ctaButton, pressed && styles.pressed]}><Text style={styles.ctaButtonText}>Pedir proposta</Text></Pressable>
        </View>
      </View>
    </ScrollView>
    <ChatAssistant onOpenPill={openPill} onRequestProposal={() => navigation.navigate('Landing', { section: 'planos' })} onOpenLogin={() => navigation.navigate('Login')} />
    <CookieConsent onOpenPrivacy={() => navigation.navigate('LegalDocument', { document: 'privacy' })} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  page: { backgroundColor: colors.background, padding: 16, paddingBottom: 60 },
  top: { width: '100%', maxWidth: 1100, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  back: { paddingVertical: 10, paddingRight: 16 },
  backText: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  brand: { color: colors.navy, fontWeight: '900', letterSpacing: 1 },
  container: { width: '100%', maxWidth: 1100, alignSelf: 'center' },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 7, maxWidth: 720 },
  subtitle: { color: colors.muted, fontSize: 15.5, lineHeight: 22, marginTop: 8, maxWidth: 640 },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22, marginBottom: 8 },
  input: { minHeight: 50, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.surface, color: colors.ink, fontWeight: '600', marginBottom: 10 },
  inputMultiline: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  searchInput: { flexGrow: 1, flexBasis: 260, marginBottom: 0 },
  button: { minHeight: 50, paddingHorizontal: 22, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  searchButton: { alignSelf: 'auto' },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  pressed: { opacity: 0.85 },
  error: { color: colors.red, fontWeight: '700', marginVertical: 10 },
  block: { marginTop: 26 },
  categoryTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: 12 },
  resultsTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginBottom: 12 },
  clearLink: { color: colors.primary, fontWeight: '800', marginTop: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18, minHeight: 170, ...shadow },
  cardCategory: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  cardTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '900', marginTop: 6 },
  cardSummary: { color: colors.muted, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  cardLink: { color: colors.primary, fontWeight: '800', fontSize: 13, marginTop: 'auto', paddingTop: 10 },
  article: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 24, marginTop: 20, ...shadow },
  articleTitle: { color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 6 },
  answerBox: { backgroundColor: colors.softBlue, borderRadius: 12, padding: 16, marginTop: 16, marginBottom: 6 },
  answerLabel: { color: colors.primaryDark, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 },
  answerText: { color: colors.ink, fontSize: 15.5, lineHeight: 23, fontWeight: '700', marginTop: 4 },
  paragraph: { color: '#475467', fontSize: 15, lineHeight: 23, marginTop: 12 },
  blockTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 24, marginBottom: 10 },
  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bulletMark: { color: colors.green, fontWeight: '900' },
  bulletText: { flex: 1, color: colors.ink, fontSize: 14.5, lineHeight: 21 },
  sourcesBox: { backgroundColor: colors.softGreen, borderRadius: 12, paddingHorizontal: 16, paddingBottom: 16, marginTop: 14 },
  sourceText: { color: colors.ink, fontSize: 14, lineHeight: 21, marginBottom: 6 },
  sourceLink: { color: colors.primaryDark, fontWeight: '700', textDecorationLine: 'underline' },
  reviewed: { color: colors.muted, fontSize: 12.5, marginTop: 6 },
  disclaimer: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 14, fontStyle: 'italic' },
  questionBox: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 22, marginTop: 32, ...shadow },
  questionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  questionText: { color: colors.muted, fontSize: 14.5, lineHeight: 21, marginTop: 6, marginBottom: 14 },
  privacyNote: { color: colors.muted, fontSize: 12.5, marginBottom: 12 },
  sentText: { color: colors.green, fontSize: 15, fontWeight: '800', lineHeight: 22 },
  cta: { backgroundColor: colors.navy, borderRadius: 18, padding: 26, marginTop: 32 },
  ctaTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  ctaText: { color: 'rgba(255,255,255,0.8)', fontSize: 14.5, lineHeight: 21, marginTop: 8, marginBottom: 18, maxWidth: 640 },
  ctaStepsTitle: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 10 },
  ctaStep: { flexDirection: 'row', gap: 10, marginBottom: 8, maxWidth: 640 },
  ctaStepNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff', fontWeight: '900', fontSize: 12, textAlign: 'center', lineHeight: 22 },
  ctaStepText: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 21 },
  ctaButton: { backgroundColor: '#fff', marginTop: 10 },
  ctaButtonText: { color: colors.navy, fontWeight: '900', fontSize: 15 },
});
