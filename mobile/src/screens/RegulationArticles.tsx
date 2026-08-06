import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors, layout } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { CardGrid, FormFieldFull, FormGrid } from '../ui/grid';

type Article = {
  id: string; condominium_id: string; article_number: string; description: string;
  base_fine_percent: string; payment_deadline_days: number; late_interest_percent_month: string;
  monetary_correction_index: 'IGPM' | 'INPC' | 'FIXED'; fixed_monthly_correction_percent: string | null;
  reiteration_daily_percent: string; acknowledgment_tolerance_days: number | null; active: boolean;
};
type Condominium = { id: string; name: string };
type Dialog = { title: string; message: string; tone: 'info' | 'success' | 'error'; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void } | null;

const emptyForm = {
  articleNumber: '', description: '', baseFinePercent: '', paymentDeadlineDays: '',
  lateInterestPercentMonth: '0', monetaryCorrectionIndex: 'FIXED' as 'IGPM' | 'INPC' | 'FIXED',
  fixedMonthlyCorrectionPercent: '0', reiterationDailyPercent: '0', acknowledgmentToleranceDays: '',
};

export default function RegulationArticles({ navigation }: any) {
  const { isMobile: mobile } = useBreakpoint();
  const { user, userToken } = useContext(AuthContext);
  const isAdminGeral = user?.role === 'admin_geral';
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    if (!isAdminGeral || !userToken) return;
    apiRequest<{ condominiums: Condominium[] }>('/condominiums', userToken)
      .then(data => setCondominiums(data.condominiums))
      .catch(() => setCondominiums([]));
  }, [isAdminGeral, userToken]);

  const load = useCallback(async () => {
    if (!userToken) return;
    if (isAdminGeral && !condominiumId) { setArticles([]); return; }
    setLoading(true); setError('');
    try {
      const query = isAdminGeral ? `?active=all&condominiumId=${condominiumId}` : '?active=all';
      const data = await apiRequest<{ articles: Article[] }>(`/regulation-articles${query}`, userToken);
      setArticles(data.articles);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar os artigos do regimento.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [userToken, isAdminGeral, condominiumId]);

  useEffect(() => { load(); }, [load]);

  const buildPayload = (f: typeof emptyForm) => ({
    articleNumber: f.articleNumber.trim(),
    description: f.description.trim(),
    baseFinePercent: Number(f.baseFinePercent.replace(',', '.')),
    paymentDeadlineDays: Number(f.paymentDeadlineDays),
    lateInterestPercentMonth: Number(f.lateInterestPercentMonth.replace(',', '.')) || 0,
    monetaryCorrectionIndex: f.monetaryCorrectionIndex,
    fixedMonthlyCorrectionPercent: f.monetaryCorrectionIndex === 'FIXED' ? Number(f.fixedMonthlyCorrectionPercent.replace(',', '.')) : null,
    reiterationDailyPercent: Number(f.reiterationDailyPercent.replace(',', '.')) || 0,
    acknowledgmentToleranceDays: f.acknowledgmentToleranceDays.trim() ? Number(f.acknowledgmentToleranceDays) : null,
    condominiumId: isAdminGeral ? condominiumId : undefined,
  });

  const isFormValid = (f: typeof emptyForm) =>
    f.articleNumber.trim() && f.description.trim() && Number(f.baseFinePercent.replace(',', '.')) >= 0
    && Number(f.paymentDeadlineDays) > 0 && (f.monetaryCorrectionIndex !== 'FIXED' || f.fixedMonthlyCorrectionPercent.trim() !== '');

  const create = async () => {
    if (!userToken || !isFormValid(form)) return;
    setLoading(true); setError('');
    try {
      await apiRequest('/regulation-articles', userToken, { method: 'POST', body: JSON.stringify(buildPayload(form)) });
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cadastrar o artigo.');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (article: Article) => {
    setEditingId(article.id);
    setEditForm({
      articleNumber: article.article_number, description: article.description,
      baseFinePercent: article.base_fine_percent, paymentDeadlineDays: String(article.payment_deadline_days),
      lateInterestPercentMonth: article.late_interest_percent_month, monetaryCorrectionIndex: article.monetary_correction_index,
      fixedMonthlyCorrectionPercent: article.fixed_monthly_correction_percent || '0',
      reiterationDailyPercent: article.reiteration_daily_percent,
      acknowledgmentToleranceDays: article.acknowledgment_tolerance_days != null ? String(article.acknowledgment_tolerance_days) : '',
    });
  };

  const saveEdit = async () => {
    if (!userToken || !editingId || !isFormValid(editForm)) return;
    setLoading(true); setError('');
    try {
      await apiRequest(`/regulation-articles/${editingId}`, userToken, { method: 'PATCH', body: JSON.stringify(buildPayload(editForm)) });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o artigo.');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (article: Article) => {
    if (!userToken) return;
    setLoading(true);
    try {
      await apiRequest(`/regulation-articles/${article.id}`, userToken, { method: 'PATCH', body: JSON.stringify({ active: !article.active }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao alterar o artigo.');
    } finally {
      setLoading(false);
    }
  };

  const confirmToggle = (article: Article) => setDialog({
    title: article.active ? 'Desativar artigo' : 'Reativar artigo',
    message: article.active
      ? `Desativar "${article.article_number}"? Notificações já emitidas com este artigo não são afetadas; ele só deixa de aparecer para novas emissões.`
      : `Reativar "${article.article_number}" para novas emissões?`,
    tone: article.active ? 'error' : 'info',
    confirmLabel: article.active ? 'Desativar' : 'Reativar',
    cancelLabel: 'Voltar',
    onConfirm: () => { setDialog(null); toggleActive(article); },
  });

  const applyTemplate = async () => {
    if (!userToken) return;
    if (isAdminGeral && !condominiumId) return;
    setLoading(true); setError('');
    try {
      await apiRequest('/regulation-articles/apply-template', userToken, { method: 'POST', body: JSON.stringify({ condominiumId: isAdminGeral ? condominiumId : undefined }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao aplicar o modelo inicial.');
    } finally {
      setLoading(false);
    }
  };

  const indexOptions: Array<'IGPM' | 'INPC' | 'FIXED'> = ['FIXED', 'IGPM', 'INPC'];
  const indexLabel = (value: string) => value === 'FIXED' ? 'Fixo' : value;

  const renderIndexPicker = (value: string, onChange: (v: 'IGPM' | 'INPC' | 'FIXED') => void) => (
    <View style={s.row}>
      {indexOptions.map(option => (
        <Pressable key={option} onPress={() => onChange(option)} style={[s.option, value === option && s.optionOn]}>
          <Text style={[s.optionText, value === option && s.optionTextOn]}>{indexLabel(option)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const renderForm = (f: typeof emptyForm, setF: (updater: (current: typeof emptyForm) => typeof emptyForm) => void, onSubmit: () => void, submitLabel: string, onCancel?: () => void) => (
    <View>
      <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
        <View>
          <Text style={s.label}>Número do artigo</Text>
          <TextInput value={f.articleNumber} onChangeText={v => setF(c => ({ ...c, articleNumber: v }))} placeholder="Ex.: Art. 45" style={s.input} />
        </View>
        <View>
          <Text style={s.label}>Prazo de pagamento (dias corridos)</Text>
          <TextInput value={f.paymentDeadlineDays} onChangeText={v => setF(c => ({ ...c, paymentDeadlineDays: v.replace(/\D/g, '') }))} keyboardType="number-pad" style={s.input} />
        </View>
      </FormGrid>
      <FormFieldFull>
        <Text style={s.label}>Descrição do artigo</Text>
        <TextInput value={f.description} onChangeText={v => setF(c => ({ ...c, description: v }))} placeholder="Descreva a infração coberta por este artigo" multiline style={[s.input, s.textArea]} />
      </FormFieldFull>
      <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
        <View>
          <Text style={s.label}>Multa base (% da taxa condominial)</Text>
          <TextInput value={f.baseFinePercent} onChangeText={v => setF(c => ({ ...c, baseFinePercent: v }))} keyboardType="decimal-pad" style={s.input} />
        </View>
        <View>
          <Text style={s.label}>Juros de mora (% ao mês)</Text>
          <TextInput value={f.lateInterestPercentMonth} onChangeText={v => setF(c => ({ ...c, lateInterestPercentMonth: v }))} keyboardType="decimal-pad" style={s.input} />
        </View>
        <View>
          <Text style={s.label}>Multa diária por reincidência contínua (%)</Text>
          <TextInput value={f.reiterationDailyPercent} onChangeText={v => setF(c => ({ ...c, reiterationDailyPercent: v }))} keyboardType="decimal-pad" style={s.input} />
        </View>
      </FormGrid>
      <Text style={s.label}>Índice de correção monetária</Text>
      {renderIndexPicker(f.monetaryCorrectionIndex, v => setF(c => ({ ...c, monetaryCorrectionIndex: v })))}
      {f.monetaryCorrectionIndex === 'FIXED' ? (
        <View style={s.fixedBox}>
          <Text style={s.label}>Percentual fixo de correção (% ao mês)</Text>
          <TextInput value={f.fixedMonthlyCorrectionPercent} onChangeText={v => setF(c => ({ ...c, fixedMonthlyCorrectionPercent: v }))} keyboardType="decimal-pad" style={s.input} />
        </View>
      ) : (
        <Text style={s.hint}>O percentual mensal do índice {f.monetaryCorrectionIndex} é cadastrado pelo administrador da plataforma em Índices econômicos, mês a mês.</Text>
      )}
      <Text style={s.label}>Tolerância de ciência (dias após envio, opcional)</Text>
      <TextInput value={f.acknowledgmentToleranceDays} onChangeText={v => setF(c => ({ ...c, acknowledgmentToleranceDays: v.replace(/\D/g, '') }))} keyboardType="number-pad" placeholder="Deixe em branco para exigir ciência manual" style={s.input} />
      <View style={s.formActions}>
        {onCancel ? <View style={s.formActionButton}><AppButton title="Cancelar" variant="secondary" onPress={onCancel} /></View> : null}
        <View style={s.formActionButton}><AppButton title={submitLabel} onPress={onSubmit} disabled={loading || !isFormValid(f)} /></View>
      </View>
    </View>
  );

  const blockedByCondoSelection = isAdminGeral && !condominiumId;

  return (
    <>
      <ScrollView contentContainerStyle={[s.container, mobile && s.containerMobile]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Text style={s.eyebrow}>REGIMENTO INTERNO</Text>
        <Text style={s.title}>Artigos do regimento</Text>
        <Text style={s.subtitle}>Cada condomínio configura seus próprios artigos — percentuais de multa, prazos, juros e correção. Editar um artigo nunca altera notificações já emitidas.</Text>

        {isAdminGeral ? (
          <Panel>
            <Text style={s.label}>Condomínio</Text>
            <View style={s.row}>
              {condominiums.map(c => (
                <Pressable key={c.id} onPress={() => setCondominiumId(c.id)} style={[s.option, condominiumId === c.id && s.optionOn]}>
                  <Text style={[s.optionText, condominiumId === c.id && s.optionTextOn]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {blockedByCondoSelection ? (
          <EmptyState title="Selecione um condomínio" description="Escolha um condomínio acima para ver e cadastrar os artigos do regimento dele." />
        ) : (
          <>
            {!loading && articles.length === 0 ? (
              <Panel>
                <Text style={s.panelTitle}>Nenhum artigo do regimento cadastrado</Text>
                <Text style={s.hint}>Este condomínio ainda não possui artigos do regimento cadastrados. Não é possível emitir notificações de infração sem um artigo configurado. Cadastre o primeiro artigo abaixo ou aplique o modelo inicial (editável) como ponto de partida.</Text>
                <View style={s.formActions}>
                  <View style={s.formActionButton}><AppButton title="Aplicar modelo inicial" variant="secondary" onPress={applyTemplate} disabled={loading} /></View>
                </View>
              </Panel>
            ) : null}

            <Panel>
              <Text style={s.panelTitle}>Novo artigo</Text>
              {renderForm(form, updater => setForm(updater), create, 'Cadastrar artigo')}
            </Panel>

            <Text style={s.panelTitle}>Artigos cadastrados</Text>
            {articles.length === 0 && loading ? null : (
              <CardGrid columns={{ mobile: 1, tablet: 1, desktop: 2 }}>
                {articles.map(article => (
                  <View key={article.id} style={[s.card, !article.active && s.cardInactive]}>
                    {editingId === article.id ? (
                      renderForm(editForm, updater => setEditForm(updater), saveEdit, 'Salvar alterações', () => setEditingId(null))
                    ) : (
                      <>
                        <View style={s.cardTop}>
                          <Text style={s.cardTitle}>{article.article_number}</Text>
                          <Text style={[s.badge, article.active ? s.badgeActive : s.badgeInactive]}>{article.active ? 'Ativo' : 'Inativo'}</Text>
                        </View>
                        <Text style={s.cardDescription}>{article.description}</Text>
                        <View style={s.cardMetrics}>
                          <Text style={s.cardMetric}>Multa: {article.base_fine_percent}%</Text>
                          <Text style={s.cardMetric}>Prazo: {article.payment_deadline_days} dias</Text>
                          <Text style={s.cardMetric}>Juros: {article.late_interest_percent_month}%/mês</Text>
                          <Text style={s.cardMetric}>Correção: {indexLabel(article.monetary_correction_index)}{article.monetary_correction_index === 'FIXED' ? ` (${article.fixed_monthly_correction_percent}%/mês)` : ''}</Text>
                          <Text style={s.cardMetric}>Reincidência: {article.reiteration_daily_percent}%/dia</Text>
                          {article.acknowledgment_tolerance_days != null ? <Text style={s.cardMetric}>Tolerância de ciência: {article.acknowledgment_tolerance_days} dias</Text> : null}
                        </View>
                        <View style={s.formActions}>
                          <View style={s.formActionButton}><AppButton title="Editar" variant="secondary" onPress={() => startEdit(article)} /></View>
                          <View style={s.formActionButton}><AppButton title={article.active ? 'Desativar' : 'Reativar'} variant="danger" onPress={() => confirmToggle(article)} /></View>
                        </View>
                      </>
                    )}
                  </View>
                ))}
              </CardGrid>
            )}
          </>
        )}
      </ScrollView>
      <AppDialog visible={!!dialog} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
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
  label: { fontSize: 14, fontWeight: '800', color: colors.ink, marginBottom: 6, marginTop: 4 },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 4, marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink, marginBottom: 10 },
  textArea: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  optionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  optionTextOn: { color: '#fff' },
  fixedBox: { marginTop: 4 },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  formActionButton: { minWidth: 160, flexGrow: 1 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 16 },
  cardInactive: { backgroundColor: '#f7f7f8' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '900', color: colors.ink },
  badge: { fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  badgeActive: { backgroundColor: colors.softGreen, color: colors.green },
  badgeInactive: { backgroundColor: '#eee', color: colors.muted },
  cardDescription: { color: colors.muted, marginTop: 8, lineHeight: 20 },
  cardMetrics: { marginTop: 10, gap: 4 },
  cardMetric: { fontSize: 13, color: colors.ink, fontWeight: '700' },
});
