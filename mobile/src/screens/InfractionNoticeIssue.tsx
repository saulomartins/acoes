import React, { useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { formatCents } from '../utils/money';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Article = { id: string; article_number: string; description: string; base_fine_percent: string; payment_deadline_days: number };
type UnitOption = { id: string; label: string };
type FineBreakdown = {
  baseFineCents: number; recurrenceDoublingCents: number; lateInterestCents: number;
  monetaryCorrectionCents: number; reiterationCents: number; totalCents: number; correctionPending: boolean;
};
type Notice = { id: string; status: string; is_recurrence: boolean };

export default function InfractionNoticeIssue({ navigation, route }: any) {
  const { isDesktop } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const presetOccurrenceId: string | undefined = route?.params?.occurrenceId;
  const presetUnitId: string | undefined = route?.params?.unitId;

  const [articles, setArticles] = useState<Article[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [articleId, setArticleId] = useState('');
  const [unitId, setUnitId] = useState(presetUnitId || '');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [breakdown, setBreakdown] = useState<FineBreakdown | null>(null);
  const [dialog, setDialog] = useState({ visible: false, title: '', message: '', tone: 'info' as 'info' | 'success' | 'error' });
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const tourSteps: TourStep[] = [
    { key: 'form', title: 'Nova notificação de infração', description: 'Escolha o artigo do regimento (a lista mostra só artigos ativos) e a unidade infratora entre as opções listadas, depois descreva o que motivou a notificação com pelo menos 3 caracteres. Ao tocar em "Calcular multa e revisar" o sistema confere se a unidade tem uma tipologia ativa com taxa condominial configurada — sem isso não dá pra emitir. Quando a notificação vem de uma ocorrência transformada, o artigo e a unidade já chegam preenchidos.' },
    { key: 'result', title: 'Revisar o cálculo antes de enviar', description: 'O detalhamento mostra multa base, acréscimo por reincidência (se a mesma unidade já teve uma notificação confirmada para este artigo, a multa base dobra), juros de mora, correção monetária e multa diária por reincidência contínua, somando o total no momento da emissão. Juros, correção e a multa contínua ainda podem crescer até a confirmação, caso a unidade demore a dar ciência ou pagar. "Descartar" cancela sem enviar nada; "Enviar notificação" avisa a unidade, que precisa abrir o app pra dar ciência.' },
  ];

  useEffect(() => {
    if (!userToken) return;
    Promise.all([
      apiRequest<{ articles: Article[] }>('/regulation-articles?active=true', userToken),
      apiRequest<{ units: Array<{ id: string; number: string; block_name: string }> }>('/units', userToken),
    ]).then(([articlesData, unitsData]) => {
      setArticles(articlesData.articles);
      setUnits(unitsData.units.map(u => ({ id: u.id, label: `${u.block_name} / ${u.number}` })));
    }).catch(() => { setArticles([]); setUnits([]); }).finally(() => setLoadingLists(false));
  }, [userToken]);

  const reset = () => { setArticleId(''); setUnitId(''); setDescription(''); setNotice(null); setBreakdown(null); };

  const create = async () => {
    if (!userToken || !articleId || !unitId || description.trim().length < 3) return;
    setCreating(true);
    try {
      const data = await apiRequest<{ notice: Notice; fineBreakdown: FineBreakdown }>('/infraction-notices', userToken, {
        method: 'POST',
        body: JSON.stringify({ unitId, articleId, description: description.trim(), occurrenceId: presetOccurrenceId }),
      });
      setNotice(data.notice);
      setBreakdown(data.fineBreakdown);
    } catch (e) {
      setDialog({ visible: true, title: 'Não foi possível calcular a multa', message: e instanceof Error ? e.message : 'Revise os campos.', tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    if (!userToken || !notice) return;
    setSending(true);
    try {
      await apiRequest(`/infraction-notices/${notice.id}/send`, userToken, { method: 'POST' });
      setDialog({ visible: true, title: 'Notificação enviada', message: 'A unidade foi notificada e poderá dar ciência pelo aplicativo.', tone: 'success' });
      reset();
    } catch (e) {
      setDialog({ visible: true, title: 'Não foi possível enviar', message: e instanceof Error ? e.message : 'Tente novamente.', tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const selectedArticle = articles.find(a => a.id === articleId);

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, isDesktop && styles.desktopCap]}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>REGIMENTO INTERNO</Text>
            <Text style={styles.title}>Emitir notificação de infração</Text>
            <Text style={styles.subtitle}>Escolha o artigo e a unidade, revise o cálculo completo da multa e só então envie.</Text>
          </View>
          <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
        </View>

        {!loadingLists && articles.length === 0 ? (
          <EmptyState
            title="Nenhum artigo do regimento cadastrado"
            description="Este condomínio ainda não possui artigos do regimento cadastrados. Cadastre um artigo (ou aplique o modelo inicial) na tela de Regimento antes de emitir notificações."
          />
        ) : notice && breakdown ? (
          <View ref={registerSection('result')} style={[isActive('result') && styles.tourHighlight]}>
          <Panel>
            <Text style={styles.panelTitle}>Cálculo da multa · {selectedArticle?.article_number}</Text>
            {notice.is_recurrence ? <Text style={styles.recurrenceNote}>Esta unidade já teve uma notificação confirmada para este mesmo artigo — a multa base foi dobrada por reincidência.</Text> : null}
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Multa base</Text><Text style={styles.breakdownValue}>{formatCents(breakdown.baseFineCents)}</Text></View>
              {breakdown.recurrenceDoublingCents > 0 ? <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Acréscimo por reincidência</Text><Text style={styles.breakdownValue}>{formatCents(breakdown.recurrenceDoublingCents)}</Text></View> : null}
              <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Juros de mora</Text><Text style={styles.breakdownValue}>{formatCents(breakdown.lateInterestCents)}</Text></View>
              <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Correção monetária</Text><Text style={styles.breakdownValue}>{breakdown.correctionPending ? 'Pendente' : formatCents(breakdown.monetaryCorrectionCents)}</Text></View>
              <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Multa por reincidência contínua</Text><Text style={styles.breakdownValue}>{formatCents(breakdown.reiterationCents)}</Text></View>
              <View style={[styles.breakdownRow, styles.breakdownTotalRow]}><Text style={styles.breakdownTotalLabel}>Total no momento da emissão</Text><Text style={styles.breakdownTotalValue}>{formatCents(breakdown.totalCents)}</Text></View>
            </View>
            <Text style={styles.hint}>Juros, correção e multa por reincidência contínua ainda podem crescer até a confirmação, caso a unidade demore a dar ciência ou pagar.</Text>
            <View style={styles.actionsRow}>
              <View style={styles.actionButton}><AppButton title="Descartar" variant="secondary" onPress={reset} disabled={sending} /></View>
              <View style={styles.actionButton}><AppButton title="Enviar notificação" onPress={send} loading={sending} /></View>
            </View>
          </Panel>
          </View>
        ) : (
          <View ref={registerSection('form')} style={[isActive('form') && styles.tourHighlight]}>
          <Panel>
            <Text style={styles.panelTitle}>Nova notificação</Text>
            <Text style={styles.label}>Artigo do regimento</Text>
            <View style={styles.options}>
              {articles.map(a => (
                <Pressable key={a.id} onPress={() => setArticleId(a.id)} style={[styles.option, articleId === a.id && styles.optionOn]}>
                  <Text style={[styles.optionText, articleId === a.id && styles.optionTextOn]}>{a.article_number} · {a.base_fine_percent}%</Text>
                </Pressable>
              ))}
            </View>
            {selectedArticle ? <Text style={styles.hint}>{selectedArticle.description}</Text> : null}

            <Text style={styles.label}>Unidade</Text>
            <View style={styles.options}>
              {units.map(u => (
                <Pressable key={u.id} onPress={() => setUnitId(u.id)} style={[styles.option, unitId === u.id && styles.optionOn]}>
                  <Text style={[styles.optionText, unitId === u.id && styles.optionTextOn]}>{u.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Descrição da infração</Text>
            <TextInput value={description} onChangeText={setDescription} multiline placeholder="Descreva o que motivou esta notificação" style={[styles.input, styles.area]} />

            <View style={styles.action}>
              <AppButton title="Calcular multa e revisar" onPress={create} loading={creating} disabled={!articleId || !unitId || description.trim().length < 3} />
            </View>
          </Panel>
          </View>
        )}
      </ScrollView>
      <AppDialog {...dialog} onClose={() => setDialog(x => ({ ...x, visible: false }))} />
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', alignSelf: 'center', padding: 28, paddingBottom: 70, gap: 16 },
  desktopCap: { maxWidth: 780, alignSelf: 'center', width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 5 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: 14, marginBottom: 7 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  optionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  optionTextOn: { color: '#fff' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink },
  area: { height: 100, paddingTop: 11, textAlignVertical: 'top' },
  action: { alignSelf: 'flex-end', minWidth: 220, marginTop: 16 },
  recurrenceNote: { color: colors.red, fontWeight: '800', marginBottom: 10, lineHeight: 19 },
  breakdown: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  breakdownLabel: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  breakdownValue: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  breakdownTotalRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 10 },
  breakdownTotalLabel: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  breakdownTotalValue: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionButton: { flex: 1 },
});
