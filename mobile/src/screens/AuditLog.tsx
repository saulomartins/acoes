import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Condominium = { id: string; name: string; cnpj: string | null; address: string | null };
type AuditFeature =
  | 'pessoas' | 'tipologias' | 'blocos_unidades' | 'prestacao_contas'
  | 'gestao_cobrancas' | 'gestao_debitos' | 'historico_acordos'
  | 'config_enviar_cobrancas' | 'cobrancas_adicionais' | 'consumo_individualizado'
  | 'regimento' | 'ocorrencias' | 'notificacoes_infracao';
type AuditEntry = { id: string; actor_name: string; actor_role: string; feature: AuditFeature; action: string; description: string; created_at: string };

const featureLabel: Record<AuditFeature, string> = {
  pessoas: 'Pessoas',
  tipologias: 'Tipologias',
  blocos_unidades: 'Blocos e unidades',
  prestacao_contas: 'Prestação de contas',
  gestao_cobrancas: 'Gestão de cobranças',
  gestao_debitos: 'Gestão de débitos',
  historico_acordos: 'Histórico de acordos',
  config_enviar_cobrancas: 'Config. e Enviar cobranças',
  cobrancas_adicionais: 'Cobranças adicionais',
  consumo_individualizado: 'Cobrança por consumo (água/gás/energia)',
  regimento: 'Regimento',
  ocorrencias: 'Ocorrências',
  notificacoes_infracao: 'Notificações de infração',
};
const featureOptions = Object.keys(featureLabel) as AuditFeature[];
const roleLabel: Record<string, string> = { sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };
const formatDateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const PAGE_SIZE = 50;
const formatDay = (value: Date) => `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
const parseDay = (value: string) => { const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) return null; const [, d, mo, y] = m.map(Number); const date = new Date(y, mo - 1, d, 0, 0, 0, 0); return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null; };
const todayDay = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const daysAgo = (days: number) => { const value = todayDay(); value.setDate(value.getDate() - days); return value; };

export default function AuditLog({ navigation }: any) {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState('');
  const [featureFilter, setFeatureFilter] = useState<AuditFeature | 'all'>('all');
  // Padrão: hoje + os 3 dias anteriores — mesmo intervalo que a API já usa
  // quando from/to não são enviados, só que aqui explícito pra dar pra editar.
  const [fromDay, setFromDay] = useState(() => formatDay(daysAgo(3)));
  const [toDay, setToDay] = useState(() => formatDay(todayDay()));
  const [dateError, setDateError] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCondominiums = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true); setError(null);
    try {
      const response = await apiRequest<{ condominiums: Condominium[] }>('/condominiums', userToken);
      setCondominiums(response.condominiums);
      if (!condominiumId && response.condominiums.length === 1) setCondominiumId(response.condominiums[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar condomínios'); }
    finally { setIsLoading(false); }
  }, [userToken]);

  useEffect(() => { loadCondominiums(); }, [loadCondominiums]);

  const loadEntries = useCallback(async (offset: number, append: boolean) => {
    if (!userToken || !condominiumId) return;
    const from = parseDay(fromDay), to = parseDay(toDay);
    if (!from || !to) { setDateError('Use o formato DD/MM/AAAA para as duas datas.'); return; }
    if (to < from) { setDateError('A data final não pode ser anterior à inicial.'); return; }
    setDateError(null);
    const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
    setIsLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ condominiumId, limit: String(PAGE_SIZE), offset: String(offset), from: from.toISOString(), to: toEnd.toISOString() });
      if (featureFilter !== 'all') params.set('feature', featureFilter);
      const response = await apiRequest<{ entries: AuditEntry[]; total: number }>(`/audit-log?${params.toString()}`, userToken);
      setEntries((current) => append ? [...current, ...response.entries] : response.entries);
      setTotal(response.total);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar o log de auditoria'); }
    finally { setIsLoading(false); }
  }, [userToken, condominiumId, featureFilter, fromDay, toDay]);

  useEffect(() => { if (condominiumId) loadEntries(0, false); }, [condominiumId, featureFilter, fromDay, toDay, loadEntries]);

  const tourSteps: TourStep[] = [
    { key: 'condominium', title: 'Condomínio', description: 'Escolha o condomínio cujas ações você quer auditar — a lista de eventos abaixo é sempre filtrada por um único condomínio por vez. Se você administra só um condomínio, ele já vem selecionado automaticamente.' },
    { key: 'feature', title: 'Funcionalidade', description: 'Filtre os eventos por área do sistema (Pessoas, Gestão de cobranças, Regimento, Ocorrências etc.). "Todas" mostra o histórico completo do condomínio selecionado, sem restringir por funcionalidade.' },
    { key: 'period', title: 'Período', description: 'Defina o intervalo de datas no formato DD/MM/AAAA — o padrão é hoje e os 3 dias anteriores, o mesmo intervalo que a API usa quando nenhuma data é enviada. O botão "Últimos 3 dias" volta rapidamente pra esse padrão. A data final não pode ser anterior à inicial.' },
    { key: 'list', title: 'Eventos registrados', description: 'Cada card mostra quem fez a ação, o cargo (síndico, subsíndico, proprietário ou inquilino), quando foi feita e uma descrição do que aconteceu. Em Regimento e Ocorrências, ações de proprietários e inquilinos também entram aqui, além das de síndicos e subsíndicos. Toque em "Carregar mais" para trazer os próximos eventos além dos primeiros 50.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => condominiumId && loadEntries(0, false)} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>ADMINISTRAÇÃO</Text>
          <Text style={styles.title}>Auditoria</Text>
          <Text style={styles.subtitle}>Ações de síndicos e subsíndicos em cada condomínio: quem fez o quê e quando. Em Regimento e Ocorrências, ações de proprietários e inquilinos também aparecem aqui.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <Panel>
        <View ref={registerSection('condominium')} style={[isActive('condominium') && styles.tourHighlight]}>
          <Text style={styles.panelTitle}>Condomínio</Text>
          <View style={styles.chipRow}>
            {condominiums.map((item) => <Pressable key={item.id} onPress={() => setCondominiumId(item.id)} style={[styles.chip, condominiumId === item.id && styles.chipActive]}>
              <Text style={[styles.chipText, condominiumId === item.id && styles.chipTextActive]}>{item.name}</Text>
            </Pressable>)}
          </View>
        </View>

        <View ref={registerSection('feature')} style={[isActive('feature') && styles.tourHighlight]}>
          <Text style={[styles.panelTitle, styles.panelTitleSpaced]}>Funcionalidade</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setFeatureFilter('all')} style={[styles.chip, featureFilter === 'all' && styles.chipActive]}>
              <Text style={[styles.chipText, featureFilter === 'all' && styles.chipTextActive]}>Todas</Text>
            </Pressable>
            {featureOptions.map((feature) => <Pressable key={feature} onPress={() => setFeatureFilter(feature)} style={[styles.chip, featureFilter === feature && styles.chipActive]}>
              <Text style={[styles.chipText, featureFilter === feature && styles.chipTextActive]}>{featureLabel[feature]}</Text>
            </Pressable>)}
          </View>
        </View>

        <View ref={registerSection('period')} style={[isActive('period') && styles.tourHighlight]}>
          <Text style={[styles.panelTitle, styles.panelTitleSpaced]}>Período</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={styles.dateLabel}>De</Text>
              <TextInput style={styles.dateInput} value={fromDay} onChangeText={setFromDay} placeholder="DD/MM/AAAA" />
            </View>
            <View style={styles.dateField}>
              <Text style={styles.dateLabel}>Até</Text>
              <TextInput style={styles.dateInput} value={toDay} onChangeText={setToDay} placeholder="DD/MM/AAAA" />
            </View>
            <Pressable onPress={() => { setFromDay(formatDay(daysAgo(3))); setToDay(formatDay(todayDay())); }} style={styles.chip}>
              <Text style={styles.chipText}>Últimos 3 dias</Text>
            </Pressable>
          </View>
          {dateError ? <Text style={styles.error}>{dateError}</Text> : null}
        </View>
      </Panel>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      {!condominiumId ? <EmptyState title="Selecione um condomínio" description="Escolha um condomínio acima para ver o histórico de ações." /> : entries.length === 0 && !isLoading ? <EmptyState title="Nenhum evento" description="Ainda não há ações registradas para esse condomínio/filtro." /> : (
        <View style={styles.list}>
          <Text style={styles.counter}>{total} evento(s)</Text>
          {entries.map((entry) => <View key={entry.id} style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text style={styles.entryActor}>{entry.actor_name} <Text style={styles.entryRole}>({roleLabel[entry.actor_role] || entry.actor_role})</Text></Text>
              <Text style={styles.entryDate}>{formatDateTime(entry.created_at)}</Text>
            </View>
            <View style={styles.featureBadge}><Text style={styles.featureBadgeText}>{featureLabel[entry.feature] || entry.feature}</Text></View>
            <Text style={styles.entryDescription}>{entry.description}</Text>
          </View>)}
          {entries.length < total ? <Pressable onPress={() => loadEntries(entries.length, true)} style={styles.loadMore}><Text style={styles.loadMoreText}>{isLoading ? 'Carregando...' : 'Carregar mais'}</Text></Pressable> : null}
        </View>
      )}
      </View>
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', marginLeft: 'auto', marginRight: 'auto', padding: 24, paddingBottom: 40, backgroundColor: colors.background, maxWidth: 900 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panelTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginBottom: 10 }, panelTitleSpaced: { marginTop: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fff' },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 },
  dateField: { minWidth: 140 }, dateLabel: { color: colors.muted, fontWeight: '800', fontSize: 12, marginBottom: 6 },
  dateInput: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, fontSize: 15, color: colors.ink, backgroundColor: '#fff' },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.softBlue }, chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 }, chipTextActive: { color: colors.primaryDark },
  error: { color: colors.red, marginTop: 16, fontWeight: '800' },
  list: { marginTop: 20, gap: 10 }, counter: { color: colors.primary, fontWeight: '900', marginBottom: 4 },
  entry: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 6 },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  entryActor: { color: colors.ink, fontSize: 14.5, fontWeight: '900', flex: 1 }, entryRole: { color: colors.muted, fontWeight: '700' },
  entryDate: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },
  featureBadge: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  featureBadgeText: { color: colors.primaryDark, fontSize: 11, fontWeight: '900' },
  entryDescription: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  loadMore: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20, marginTop: 10 }, loadMoreText: { color: colors.primary, fontWeight: '900' },
});
