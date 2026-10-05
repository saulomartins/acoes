import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest, openAuthenticatedFile } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors, layout } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { CardGrid } from '../ui/grid';

// Regimento interno em modo leitura, para proprietário e inquilino: o PDF
// enviado pela administração e os artigos ativos com suas penalidades. O
// cadastro e a manutenção ficam em RegulationArticles.tsx, tela de gestão que
// só existe na versão web.
type Article = {
  id: string; article_number: string; description: string;
  base_fine_percent: string; payment_deadline_days: number; late_interest_percent_month: string;
  monetary_correction_index: 'IGPM' | 'INPC' | 'FIXED'; fixed_monthly_correction_percent: string | null;
  reiteration_daily_percent: string;
};
type RegulationDocument = { fileName: string; fileSize: number; uploadedAt: string };

const fileSizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const percent = (value: string | null) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// "Art. 10º" depois de "Art. 9º": a API ordena como texto.
const articleOrder = (value: string) => Number((value.match(/\d+/) || ['0'])[0]);

export default function Regulation() {
  const { isMobile: mobile } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [articles, setArticles] = useState<Article[]>([]);
  const [regulationDocument, setRegulationDocument] = useState<RegulationDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [dialogMessage, setDialogMessage] = useState('');

  const load = useCallback(async () => {
    if (!userToken) return;
    setError('');
    try {
      const [data, documentData] = await Promise.all([
        apiRequest<{ articles: Article[] }>('/regulation-articles', userToken),
        apiRequest<{ document: RegulationDocument | null }>('/regulation-articles/document/info', userToken).catch(() => ({ document: null })),
      ]);
      setArticles([...data.articles].sort((a, b) => articleOrder(a.article_number) - articleOrder(b.article_number)));
      setRegulationDocument(documentData.document);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o regimento interno.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [userToken]);

  useEffect(() => { load(); }, [load]);

  const openDocument = async () => {
    if (!userToken || !regulationDocument) return;
    setOpening(true);
    try {
      await openAuthenticatedFile('/regulation-articles/document', userToken, regulationDocument.fileName, 'application/pdf');
    } catch (e) {
      setDialogMessage(e instanceof Error ? e.message : 'Falha ao abrir o PDF do regimento.');
    } finally {
      setOpening(false);
    }
  };

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    return term ? articles.filter(article => normalize(`${article.article_number} ${article.description}`).includes(term)) : articles;
  }, [articles, search]);

  return (
    <>
      <ScrollView contentContainerStyle={[s.container, mobile && s.containerMobile]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View>
          <Text style={s.eyebrow}>REGIMENTO INTERNO</Text>
          <Text style={s.title}>Regimento interno</Text>
          <Text style={s.subtitle}>Regras de convivência do condomínio e as penalidades previstas para cada artigo.</Text>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <Panel>
          <Text style={s.panelTitle}>Documento completo (PDF)</Text>
          {regulationDocument ? (
            <>
              <Text style={s.documentName}>{regulationDocument.fileName}</Text>
              <Text style={s.hint}>{fileSizeLabel(regulationDocument.fileSize)} · atualizado em {new Date(regulationDocument.uploadedAt).toLocaleDateString('pt-BR')}</Text>
              <AppButton title="Abrir / baixar o regimento" onPress={openDocument} loading={opening} />
            </>
          ) : (
            <Text style={s.hint}>{loading ? 'Carregando...' : 'A administração ainda não disponibilizou o PDF do regimento interno.'}</Text>
          )}
        </Panel>

        <View>
          <Text style={s.panelTitle}>Artigos e penalidades</Text>
          {articles.length ? (
            <TextInput value={search} onChangeText={setSearch} placeholder="Buscar por número ou assunto (ex.: silêncio, garagem)" placeholderTextColor={colors.placeholder} style={s.input} />
          ) : null}
          {!loading && !articles.length ? (
            <EmptyState title="Nenhum artigo cadastrado" description="A administração ainda não cadastrou os artigos do regimento no sistema." />
          ) : null}
          {articles.length && !visible.length ? (
            <EmptyState title="Nenhum artigo encontrado" description="Tente outro número ou outra palavra." />
          ) : null}
          <CardGrid columns={{ mobile: 1, tablet: 1, desktop: 2 }}>
            {visible.map(article => (
              <View key={article.id} style={s.card}>
                <Text style={s.cardTitle}>{article.article_number}</Text>
                <Text style={s.cardDescription}>{article.description}</Text>
                <View style={s.cardMetrics}>
                  <Text style={s.cardMetric}>Multa: {percent(article.base_fine_percent)}% da taxa condominial (em dobro na reincidência)</Text>
                  <Text style={s.cardMetric}>Prazo para pagamento: {article.payment_deadline_days} dias após a notificação</Text>
                  {Number(article.late_interest_percent_month) > 0 ? <Text style={s.cardMetric}>Juros por atraso: {percent(article.late_interest_percent_month)}% ao mês</Text> : null}
                  {Number(article.reiteration_daily_percent) > 0 ? <Text style={s.cardMetric}>Infração continuada: {percent(article.reiteration_daily_percent)}% da última multa por dia</Text> : null}
                  {article.monetary_correction_index !== 'FIXED'
                    ? <Text style={s.cardMetric}>Correção monetária: {article.monetary_correction_index}</Text>
                    : Number(article.fixed_monthly_correction_percent) > 0 ? <Text style={s.cardMetric}>Correção monetária: {percent(article.fixed_monthly_correction_percent)}% ao mês</Text> : null}
                </View>
              </View>
            ))}
          </CardGrid>
        </View>
      </ScrollView>
      <AppDialog visible={!!dialogMessage} title="Não foi possível abrir" message={dialogMessage} tone="error" onClose={() => setDialogMessage('')} />
    </>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 50, gap: 16 },
  containerMobile: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 34 },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { fontSize: 26, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  error: { color: colors.red, fontWeight: '800' },
  panelTitle: { fontSize: 18, fontWeight: '900', color: colors.ink, marginBottom: 10 },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 4, marginBottom: 12 },
  documentName: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink, marginBottom: 12 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 16 },
  cardTitle: { fontSize: 17, fontWeight: '900', color: colors.ink },
  cardDescription: { color: colors.ink, marginTop: 8, lineHeight: 21 },
  cardMetrics: { marginTop: 10, gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  cardMetric: { fontSize: 13, color: colors.muted, fontWeight: '700' },
});
