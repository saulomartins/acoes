import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { ComboBox } from '../ui/ComboBox';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Occurrence = {
  id: string; unit_id: string | null; related_unit_id: string | null; reported_by: string;
  category: string; description: string; status: string;
  reported_by_name: string | null; reported_by_username: string; unit_label: string | null;
  created_at: string; updated_at: string;
};
type Update = { id: string; author_id: string; message: string; created_at: string; author_name: string | null; author_username: string };
type UnitOption = { id: string; label: string };

const categoryLabels: Record<string, string> = { barulho: 'Barulho', dano: 'Dano', manutencao: 'Manutenção', seguranca: 'Segurança', conduta: 'Conduta', outros: 'Outros' };
const categories = Object.keys(categoryLabels);
const statusLabels: Record<string, string> = { aberta: 'Aberta', em_analise: 'Em análise', respondida: 'Respondida', resolvida: 'Resolvida', arquivada: 'Arquivada' };
const statusColors: Record<string, string> = { aberta: colors.amber, em_analise: colors.primary, respondida: colors.primary, resolvida: colors.green, arquivada: colors.muted };
const dt = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function Occurrences({ navigation }: any) {
  const { isDesktop } = useBreakpoint();
  const { user, userToken } = useContext(AuthContext);
  const manager = ['sindico', 'subsindico', 'admin_geral'].includes(user?.role || '');
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [category, setCategory] = useState('barulho');
  const [description, setDescription] = useState('');
  const [unitId, setUnitId] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialog, setDialog] = useState({ visible: false, title: '', message: '', tone: 'info' as 'info' | 'success' | 'error' });
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const managerTourSteps: TourStep[] = [
    { key: 'create', title: 'Registrar ocorrência', description: 'Escolha a categoria (barulho, dano, manutenção, segurança, conduta ou outros) e a unidade envolvida entre as opções listadas, depois descreva o que aconteceu. Como síndico/subsíndico você precisa selecionar a unidade antes de conseguir enviar — sem ela o botão fica desabilitado.' },
    { key: 'filters', title: 'Filtrar por status', description: 'Veja as ocorrências por status: Aberta, Em análise, Respondida, Resolvida ou Arquivada. "Todas" mostra o livro completo do condomínio.' },
    { key: 'list', title: 'Ocorrências do condomínio', description: 'Lista todas as ocorrências, da mais recente pra mais antiga, com quem registrou e a data da última atualização. Toque numa ocorrência pra abrir o histórico completo de mensagens abaixo.' },
    { key: 'detail', title: 'Analisar, responder e notificar', description: 'Ao abrir uma ocorrência você pode mudar o status (o morador que registrou é avisado automaticamente da mudança) e adicionar mensagens no chat (cada mensagem sua também notifica esse morador). Se a ocorrência tiver uma unidade vinculada, o botão "Transformar em notificação" leva direto pra tela de emissão de notificação de infração, já com essa unidade preenchida.' },
  ];
  const residentTourSteps: TourStep[] = [
    { key: 'create', title: 'Registrar ocorrência', description: 'Escolha a categoria (barulho, dano, manutenção, segurança, conduta ou outros) e descreva o que aconteceu com pelo menos 3 caracteres. A ocorrência é automaticamente vinculada à sua unidade, e o síndico/subsíndico é notificado assim que você registra.' },
    { key: 'filters', title: 'Filtrar por status', description: 'Acompanhe suas ocorrências por status: Aberta, Em análise, Respondida, Resolvida ou Arquivada.' },
    { key: 'list', title: 'Minhas ocorrências', description: 'Suas ocorrências — as que você registrou ou que estão vinculadas à sua unidade — da mais recente pra mais antiga. Toque numa pra ver a conversa completa com a administração.' },
    { key: 'detail', title: 'Acompanhar e conversar', description: 'Veja a descrição original e troque mensagens com a administração: cada mensagem sua notifica o síndico/subsíndico, e cada resposta deles notifica você. A mudança de status é feita só pela administração — você acompanha o andamento por aqui.' },
  ];
  const tourSteps = manager ? managerTourSteps : residentTourSteps;

  const load = useCallback(async () => {
    if (!userToken) return;
    try {
      const query = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiRequest<{ occurrences: Occurrence[] }>(`/occurrences${query}`, userToken);
      setOccurrences(data.occurrences);
    } catch (e) {
      setDialog({ visible: true, title: 'Falha ao carregar', message: e instanceof Error ? e.message : 'Tente novamente.', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [userToken, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!manager || !userToken) return;
    apiRequest<{ units: Array<{ id: string; number: string; block_name: string }> }>('/units', userToken)
      .then(data => setUnits(data.units.map(u => ({ id: u.id, label: `${u.block_name} / ${u.number}` }))))
      .catch(() => setUnits([]));
  }, [manager, userToken]);

  const open = async (item: Occurrence) => {
    if (!userToken) return;
    setSelected(item);
    const data = await apiRequest<{ occurrence: Occurrence; updates: Update[] }>(`/occurrences/${item.id}`, userToken);
    setUpdates(data.updates);
  };

  const create = async () => {
    if (!userToken || description.trim().length < 3) return;
    if (manager && !unitId) return;
    setSending(true);
    try {
      await apiRequest('/occurrences', userToken, { method: 'POST', body: JSON.stringify({ category, description: description.trim(), unitId: manager ? unitId : undefined }) });
      setDescription(''); setUnitId('');
      await load();
      setDialog({ visible: true, title: 'Ocorrência registrada', message: 'A ocorrência foi registrada com sucesso.', tone: 'success' });
    } catch (e) {
      setDialog({ visible: true, title: 'Não foi possível registrar', message: e instanceof Error ? e.message : 'Revise os campos.', tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    if (!userToken || !selected || reply.trim().length < 2) return;
    setSending(true);
    try {
      await apiRequest(`/occurrences/${selected.id}`, userToken, { method: 'PATCH', body: JSON.stringify({ message: reply.trim() }) });
      setReply('');
      await open(selected);
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (!userToken || !selected) return;
    await apiRequest(`/occurrences/${selected.id}`, userToken, { method: 'PATCH', body: JSON.stringify({ status }) });
    setSelected(current => current ? { ...current, status } : current);
    await load();
  };

  const transformIntoNotice = () => {
    if (!selected) return;
    navigation.navigate('InfractionNoticeIssue', { occurrenceId: selected.id, unitId: selected.unit_id });
  };

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, isDesktop && styles.desktopCap]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>LIVRO DE OCORRÊNCIAS</Text>
            <Text style={styles.title}>Ocorrências</Text>
            <Text style={styles.subtitle}>{manager ? 'Registro formal de infrações e incidentes do condomínio.' : 'Registre incidentes e acompanhe suas ocorrências.'}</Text>
          </View>
          <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
        </View>

        <View ref={registerSection('create')} style={[isActive('create') && styles.tourHighlight]}>
        <Panel>
          <Text style={styles.panelTitle}>Nova ocorrência</Text>
          <Text style={styles.label}>Categoria</Text>
          <View style={styles.categories}>
            {categories.map(c => (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.category, category === c && styles.categoryActive]}>
                <Text style={[styles.categoryText, category === c && styles.categoryTextActive]}>{categoryLabels[c]}</Text>
              </Pressable>
            ))}
          </View>
          {manager ? (
            <>
              <Text style={styles.label}>Unidade</Text>
              {/* Em chips, um condomínio de 36 unidades virava 18 linhas e
                  empurrava descrição e botão para fora da tela no celular. */}
              <ComboBox
                options={units.map(u => ({ value: u.id, label: u.label }))}
                value={unitId}
                onChange={setUnitId}
                placeholder="Selecione a unidade"
                searchPlaceholder="Buscar por bloco ou apartamento"
                title="Unidade"
                emptyText="Nenhuma unidade encontrada."
              />
            </>
          ) : null}
          <Text style={styles.label}>Descrição</Text>
          <TextInput value={description} onChangeText={setDescription} multiline placeholder="Descreva o que aconteceu" style={[styles.input, styles.area]} />
          <View style={styles.action}>
            <AppButton title={sending ? 'Enviando...' : 'Registrar ocorrência'} onPress={create} loading={sending} disabled={description.trim().length < 3 || (manager && !unitId)} />
          </View>
        </Panel>
        </View>

        <View ref={registerSection('filters')} style={[styles.filters, isActive('filters') && styles.tourHighlight]}>
          {['all', 'aberta', 'em_analise', 'respondida', 'resolvida', 'arquivada'].map(value => (
            <Pressable key={value} onPress={() => setStatusFilter(value)} style={[styles.chip, statusFilter === value && styles.chipOn]}>
              <Text style={[styles.chipText, statusFilter === value && styles.chipTextOn]}>{value === 'all' ? 'Todas' : statusLabels[value]}</Text>
            </Pressable>
          ))}
        </View>

        <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
        <Text style={styles.sectionTitle}>{manager ? 'Ocorrências do condomínio' : 'Minhas ocorrências'}</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : occurrences.length === 0 ? (
          <EmptyState title="Nenhuma ocorrência" description={manager ? 'Nenhuma ocorrência registrada com este filtro.' : 'Registre uma ocorrência acima se precisar.'} />
        ) : (
          occurrences.map(item => (
            <Pressable key={item.id} onPress={() => open(item)} style={[styles.report, selected?.id === item.id && styles.reportSelected]}>
              <View style={styles.grow}>
                <Text style={styles.reportTitle}>{categoryLabels[item.category] || item.category}{item.unit_label ? ` · ${item.unit_label}` : ''}</Text>
                <Text style={styles.meta}>{manager ? `${item.reported_by_name || item.reported_by_username} · ` : ''}{dt(item.updated_at)}</Text>
              </View>
              <Text style={[styles.status, { color: '#fff', backgroundColor: statusColors[item.status] || colors.muted }]}>{statusLabels[item.status] || item.status}</Text>
            </Pressable>
          ))
        )}
        </View>

        {selected ? (
          <View ref={registerSection('detail')} style={[isActive('detail') && styles.tourHighlight]}>
          <Panel>
            <View style={styles.chatHead}>
              <View style={styles.grow}>
                <Text style={styles.panelTitle}>{categoryLabels[selected.category] || selected.category}</Text>
                <Text style={styles.meta}>{selected.unit_label || 'Sem unidade'} · {statusLabels[selected.status]}</Text>
              </View>
            </View>
            <Text style={styles.message}>{selected.description}</Text>
            {manager ? (
              <View style={styles.statusActions}>
                {['em_analise', 'respondida', 'resolvida', 'arquivada'].filter(s => s !== selected.status).map(s => (
                  <Pressable key={s} onPress={() => changeStatus(s)}><Text style={styles.link}>{statusLabels[s]}</Text></Pressable>
                ))}
              </View>
            ) : null}
            {manager && selected.unit_id ? (
              <View style={styles.action}>
                <AppButton title="Transformar em notificação" variant="secondary" onPress={transformIntoNotice} />
              </View>
            ) : null}
            <View style={styles.chat}>
              {updates.map(u => {
                const mine = u.author_id === user?.id;
                return (
                  <View key={u.id} style={[styles.bubble, mine && styles.bubbleMine]}>
                    <Text style={styles.sender}>{mine ? 'Você' : u.author_name || u.author_username}</Text>
                    <Text style={styles.message}>{u.message}</Text>
                    <Text style={styles.messageDate}>{dt(u.created_at)}</Text>
                  </View>
                );
              })}
            </View>
            <TextInput value={reply} onChangeText={setReply} multiline placeholder="Adicionar atualização..." style={[styles.input, styles.reply]} />
            <View style={styles.action}>
              <AppButton title={sending ? 'Enviando...' : 'Adicionar atualização'} onPress={sendMessage} disabled={sending || reply.trim().length < 2} />
            </View>
          </Panel>
          </View>
        ) : null}
      </ScrollView>
      <AppDialog {...dialog} onClose={() => setDialog(x => ({ ...x, visible: false }))} />
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', alignSelf: 'center', padding: 28, paddingBottom: 70, gap: 16 },
  desktopCap: { maxWidth: 860, alignSelf: 'center', width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 5 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  category: { borderWidth: 1, borderColor: colors.border, borderRadius: 15, paddingHorizontal: 11, paddingVertical: 7 },
  categoryActive: { backgroundColor: '#eaf1fb', borderColor: colors.primary },
  categoryText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  categoryTextActive: { color: colors.primary, fontWeight: '900' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: 12, marginBottom: 5 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink },
  area: { height: 100, paddingTop: 11, textAlignVertical: 'top' },
  action: { alignSelf: 'flex-end', minWidth: 220, marginTop: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  chipTextOn: { color: '#fff' },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  report: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14 },
  reportSelected: { borderColor: colors.primary, backgroundColor: '#fbfdff' },
  grow: { flex: 1 },
  reportTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  status: { fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  chatHead: { flexDirection: 'row', alignItems: 'center' },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  link: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  chat: { gap: 9, marginTop: 16 },
  bubble: { alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: '#f1f4f7', borderRadius: 11, padding: 11 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#eaf1fb' },
  sender: { color: colors.primaryDark, fontSize: 13, fontWeight: '900' },
  message: { color: colors.ink, fontSize: 15, lineHeight: 20, marginTop: 4 },
  messageDate: { color: colors.muted, fontSize: 12, marginTop: 6 },
  reply: { height: 75, paddingTop: 10, textAlignVertical: 'top', marginTop: 15 },
});
