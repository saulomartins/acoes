import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { formatCents } from '../utils/money';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Notice = {
  id: string; unit_id: string; unit_label: string | null; description: string; status: string;
  is_recurrence: boolean; base_fine_amount_cents: number; final_fine_amount_cents: number | null;
  sent_at: string | null; acknowledged_at: string | null; due_date: string | null;
  defense_text: string | null; cancellation_reason: string | null; issued_by_name: string | null;
  article_snapshot: { articleNumber: string; description: string };
};
type FineBreakdown = { baseFineCents: number; recurrenceDoublingCents: number; lateInterestCents: number; monetaryCorrectionCents: number; reiterationCents: number; totalCents: number; correctionPending: boolean };

const statusLabel: Record<string, string> = { rascunho: 'Rascunho', enviada: 'Enviada', em_defesa: 'Em defesa', confirmada: 'Confirmada', paga: 'Paga', cancelada: 'Cancelada' };
const statusColor: Record<string, string> = { rascunho: colors.muted, enviada: colors.amber, em_defesa: colors.primary, confirmada: colors.green, paga: colors.green, cancelada: colors.red };
const dt = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const dateOnly = (v: string | null) => v ? new Date(v).toLocaleDateString('pt-BR') : '—';

export default function InfractionNotices({ navigation }: any) {
  const { isMobile: compact } = useBreakpoint();
  const { user, userToken } = useContext(AuthContext);
  const manager = ['sindico', 'subsindico', 'admin_geral'].includes(user?.role || '');
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detail, setDetail] = useState<{ notice: Notice; fineBreakdown: FineBreakdown } | null>(null);
  const [contestModal, setContestModal] = useState<Notice | null>(null);
  const [cancelModal, setCancelModal] = useState<Notice | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true); setError('');
    try {
      const query = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const data = await apiRequest<{ notices: Notice[] }>(`/infraction-notices${query}`, userToken);
      setNotices(data.notices);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar as notificações.');
    } finally {
      setLoading(false);
    }
  }, [userToken, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (notice: Notice) => {
    if (!userToken) return;
    try {
      const data = await apiRequest<{ notice: Notice; fineBreakdown: FineBreakdown }>(`/infraction-notices/${notice.id}/fine-detail`, userToken);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o detalhe da multa.');
    }
  };

  const acknowledge = async (notice: Notice) => {
    if (!userToken) return;
    setSubmitting(true);
    try {
      await apiRequest(`/infraction-notices/${notice.id}/acknowledge`, userToken, { method: 'POST' });
      setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível dar ciência.');
    } finally {
      setSubmitting(false);
    }
  };

  const contest = async () => {
    if (!userToken || !contestModal || reasonText.trim().length < 3) return;
    setSubmitting(true);
    try {
      await apiRequest(`/infraction-notices/${contestModal.id}/contest`, userToken, { method: 'POST', body: JSON.stringify({ defenseText: reasonText.trim() }) });
      setContestModal(null); setReasonText(''); setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível registrar a contestação.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (notice: Notice) => {
    if (!userToken) return;
    setSubmitting(true);
    try {
      await apiRequest(`/infraction-notices/${notice.id}/confirm`, userToken, { method: 'POST' });
      setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível confirmar a notificação.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!userToken || !cancelModal || reasonText.trim().length < 3) return;
    setSubmitting(true);
    try {
      await apiRequest(`/infraction-notices/${cancelModal.id}/cancel`, userToken, { method: 'POST', body: JSON.stringify({ cancellationReason: reasonText.trim() }) });
      setCancelModal(null); setReasonText(''); setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cancelar a notificação.');
    } finally {
      setSubmitting(false);
    }
  };

  const canAcknowledge = (n: Notice) => !manager && n.status === 'enviada' && !n.acknowledged_at;
  const canContest = (n: Notice) => !manager && n.status === 'em_defesa' && (!n.due_date || new Date() <= new Date(n.due_date));
  const canConfirm = (n: Notice) => manager && n.status === 'em_defesa';
  const canCancel = (n: Notice) => manager && n.status !== 'paga' && n.status !== 'cancelada';

  const tourSteps: TourStep[] = [
    { key: 'filters', title: 'Filtrar por status', description: 'Filtre a lista pelo status da notificação: rascunho (emitida mas ainda não enviada), enviada (aguardando o morador dar ciência), em defesa (o morador já deu ciência — ou o prazo de tolerância venceu e a ciência virou automática — e agora pode contestar), confirmada (multa aplicada e cobrança gerada), paga ou cancelada. "Todas" remove o filtro.' },
    { key: 'list', title: 'Notificações e ações', description: 'Cada linha mostra o artigo do regimento, a unidade, a data de envio e o valor da multa (o final, se já confirmada, senão o valor base). Em "Ver detalhes" você vê o detalhamento completo: multa base, acréscimo por reincidência (quando a mesma infração já foi confirmada antes na mesma unidade), juros de mora, correção monetária (fica "Pendente" se o índice do mês ainda não foi cadastrado) e a multa por reincidência contínua enquanto a infração seguir em aberto. Dali o morador dá ciência ou contesta com uma justificativa dentro do prazo; síndico/subsíndico/admin geral confirma a notificação — o que gera automaticamente uma cobrança separada pra unidade — ou cancela a notificação a qualquer momento antes dela ser paga.' },
  ];

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.container, compact && styles.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>REGIMENTO INTERNO</Text>
            <Text style={styles.title}>Notificações de infração</Text>
            <Text style={styles.subtitle}>{manager ? 'Acompanhe e confirme as notificações emitidas.' : 'Notificações recebidas pela sua unidade.'}</Text>
          </View>
          <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
        </View>

        <View ref={registerSection('filters')} style={[isActive('filters') && styles.tourHighlight]}>
          <Panel>
            <Text style={styles.panelTitle}>Filtros</Text>
            <View style={styles.filters}>
              {['all', 'rascunho', 'enviada', 'em_defesa', 'confirmada', 'paga', 'cancelada'].map(value => (
                <Pressable key={value} onPress={() => setStatusFilter(value)} style={[styles.chip, statusFilter === value && styles.chipOn]}>
                  <Text style={[styles.chipText, statusFilter === value && styles.chipTextOn]}>{value === 'all' ? 'Todas' : statusLabel[value]}</Text>
                </Pressable>
              ))}
            </View>
          </Panel>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
          {!loading && notices.length === 0 ? (
            <EmptyState title="Nenhuma notificação encontrada" description={manager ? 'Altere os filtros ou emita uma nova notificação.' : 'Você não tem notificações de infração.'} />
          ) : (
            notices.map(n => (
              <View key={n.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{n.article_snapshot?.articleNumber} · {n.unit_label || 'Unidade'}</Text>
                  <Text style={styles.rowMeta}>{dt(n.sent_at)} · {formatCents(n.final_fine_amount_cents ?? n.base_fine_amount_cents)}</Text>
                </View>
                <Text style={[styles.badge, { backgroundColor: statusColor[n.status] || colors.muted }]}>{statusLabel[n.status] || n.status}</Text>
                <Pressable style={styles.detailsButton} onPress={() => openDetail(n)}><Text style={styles.detailsButtonText}>Ver detalhes</Text></Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />

      <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              {detail ? (
                <>
                  <View style={styles.cardTop}>
                    <View style={styles.grow}>
                      <Text style={styles.modalTitle}>{detail.notice.article_snapshot?.articleNumber}</Text>
                      <Text style={styles.line}>{detail.notice.unit_label || 'Unidade'}</Text>
                    </View>
                    <Text style={[styles.badge, { backgroundColor: statusColor[detail.notice.status] || colors.muted }]}>{statusLabel[detail.notice.status] || detail.notice.status}</Text>
                  </View>
                  <Text style={styles.description}>{detail.notice.description}</Text>
                  <Text style={styles.line}>Enviada em {dt(detail.notice.sent_at)} · Ciência: {dt(detail.notice.acknowledged_at)} · Prazo: {dateOnly(detail.notice.due_date)}</Text>
                  {detail.notice.is_recurrence ? <Text style={styles.recurrenceNote}>Notificação por reincidência — multa base dobrada.</Text> : null}

                  <View style={styles.breakdown}>
                    <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Multa base</Text><Text style={styles.breakdownValue}>{formatCents(detail.fineBreakdown.baseFineCents)}</Text></View>
                    {detail.fineBreakdown.recurrenceDoublingCents > 0 ? <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Acréscimo por reincidência</Text><Text style={styles.breakdownValue}>{formatCents(detail.fineBreakdown.recurrenceDoublingCents)}</Text></View> : null}
                    <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Juros de mora</Text><Text style={styles.breakdownValue}>{formatCents(detail.fineBreakdown.lateInterestCents)}</Text></View>
                    <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Correção monetária</Text><Text style={styles.breakdownValue}>{detail.fineBreakdown.correctionPending ? 'Pendente' : formatCents(detail.fineBreakdown.monetaryCorrectionCents)}</Text></View>
                    <View style={styles.breakdownRow}><Text style={styles.breakdownLabel}>Multa por reincidência contínua</Text><Text style={styles.breakdownValue}>{formatCents(detail.fineBreakdown.reiterationCents)}</Text></View>
                    <View style={[styles.breakdownRow, styles.breakdownTotalRow]}><Text style={styles.breakdownTotalLabel}>Total atual</Text><Text style={styles.breakdownTotalValue}>{formatCents(detail.fineBreakdown.totalCents)}</Text></View>
                  </View>

                  {detail.notice.defense_text ? (
                    <View style={styles.reasonBox}><Text style={styles.reasonLabel}>Defesa apresentada:</Text><Text style={styles.reasonText}>{detail.notice.defense_text}</Text></View>
                  ) : null}
                  {detail.notice.cancellation_reason ? (
                    <View style={styles.reasonBox}><Text style={styles.reasonLabel}>Motivo do cancelamento:</Text><Text style={styles.reasonText}>{detail.notice.cancellation_reason}</Text></View>
                  ) : null}

                  <View style={styles.modalActions}>
                    <AppButton title="Fechar" variant="secondary" onPress={() => setDetail(null)} />
                    {canAcknowledge(detail.notice) ? <AppButton title="Dar ciência" onPress={() => acknowledge(detail.notice)} loading={submitting} /> : null}
                    {canContest(detail.notice) ? <AppButton title="Contestar" variant="secondary" onPress={() => { setContestModal(detail.notice); setReasonText(''); }} /> : null}
                    {canConfirm(detail.notice) ? <AppButton title="Confirmar" onPress={() => confirm(detail.notice)} loading={submitting} /> : null}
                    {canCancel(detail.notice) ? <AppButton title="Cancelar notificação" variant="danger" onPress={() => { setCancelModal(detail.notice); setReasonText(''); }} /> : null}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!contestModal} transparent animationType="fade" onRequestClose={() => setContestModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.smallModalContent}>
            <Text style={styles.modalTitle}>Contestar notificação</Text>
            <Text style={styles.fieldLabel}>Explique por que você contesta esta notificação *</Text>
            <TextInput value={reasonText} onChangeText={setReasonText} multiline numberOfLines={4} placeholder="Descreva sua defesa..." style={styles.reasonInput} editable={!submitting} />
            <View style={styles.modalActions}>
              <AppButton title="Voltar" variant="secondary" onPress={() => setContestModal(null)} disabled={submitting} />
              <AppButton title={submitting ? 'Enviando...' : 'Enviar contestação'} onPress={contest} disabled={submitting || reasonText.trim().length < 3} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!cancelModal} transparent animationType="fade" onRequestClose={() => setCancelModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.smallModalContent}>
            <Text style={styles.modalTitle}>Cancelar notificação</Text>
            <Text style={styles.fieldLabel}>Motivo do cancelamento *</Text>
            <TextInput value={reasonText} onChangeText={setReasonText} multiline numberOfLines={4} placeholder="Explique o motivo do cancelamento..." style={styles.reasonInput} editable={!submitting} />
            <View style={styles.modalActions}>
              <AppButton title="Voltar" variant="secondary" onPress={() => setCancelModal(null)} disabled={submitting} />
              <AppButton title={submitting ? 'Salvando...' : 'Confirmar cancelamento'} variant="danger" onPress={cancel} disabled={submitting || reasonText.trim().length < 3} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 50, gap: 14 },
  containerMobile: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 34 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { fontSize: 27, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  error: { color: colors.red, fontWeight: '800' },
  panelTitle: { fontSize: 18, fontWeight: '900', color: colors.ink, marginBottom: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  chipTextOn: { color: '#fff' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14 },
  rowInfo: { flex: 1, minWidth: 200 },
  rowTitle: { fontSize: 16, fontWeight: '900', color: colors.ink },
  rowMeta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  badge: { fontSize: 12, fontWeight: '900', color: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  detailsButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  detailsButtonText: { fontSize: 13, color: colors.primary, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxWidth: 560, width: '100%', maxHeight: '85%' },
  smallModalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 12, maxWidth: 480, width: '100%' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  grow: { flex: 1 },
  modalTitle: { fontSize: 20, fontWeight: '900', color: colors.ink },
  line: { fontSize: 13, color: colors.muted, marginTop: 3 },
  description: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  recurrenceNote: { color: colors.red, fontWeight: '800', lineHeight: 19 },
  breakdown: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  breakdownLabel: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  breakdownValue: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  breakdownTotalRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 10 },
  breakdownTotalLabel: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  breakdownTotalValue: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  reasonBox: { backgroundColor: '#fff9f0', padding: 10, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: colors.amber },
  reasonLabel: { fontSize: 13, fontWeight: '900', color: colors.ink, marginBottom: 4 },
  reasonText: { fontSize: 14, color: colors.ink, lineHeight: 19 },
  fieldLabel: { fontSize: 12, fontWeight: '900', color: colors.ink },
  reasonInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 14, color: colors.ink, minHeight: 100, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
});
