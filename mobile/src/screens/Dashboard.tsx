import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { formatBrazilianDate, formatBrazilianMonth } from '../utils/date';

type PixSettledInvoice = {
  id: string;
  amountCents: number;
  paidAt: string;
  dueDate: string;
  cancellationReason: string | null;
  userFullName: string | null;
  userUsername: string;
};

type OverdueDebtor = {
  userId: string;
  fullName: string | null;
  username: string;
  unit: string | null;
  overdueCount: number;
  overdueCents: number;
  oldestDueDate: string;
  daysOverdue: number;
};

type DashboardSummary = {
  referenceMonth: string | null;
  availableReferenceMonths: string[];
  paid: {
    totalCents: number; count: number;
    bankCents: number; bankCount: number;
    pixSettledCents: number; pixSettledCount: number;
    pixSettledInvoices: PixSettledInvoice[];
  };
  open: { totalCents: number; count: number };
  canceled: { totalCents: number; count: number };
  overdue: { totalCents: number; count: number; byPerson: OverdueDebtor[] };
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; };

export default function Dashboard() {
  const { isMobile: compact } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [referenceFilter, setReferenceFilter] = useState<string>(currentMonth());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true);
    setError(null);
    try {
      const query = referenceFilter === 'all' ? '' : `?referenceMonth=${referenceFilter}`;
      const response = await apiRequest<DashboardSummary>(`/invoices/dashboard/summary${query}`, userToken);
      setSummary(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, [userToken, referenceFilter]);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => Array.from(new Set([currentMonth(), ...(summary?.availableReferenceMonths || [])])).sort().reverse(), [summary]);
  const hasAnything = summary && (summary.paid.count > 0 || summary.open.count > 0 || summary.canceled.count > 0 || summary.overdue.count > 0);
  const selectedLabel = referenceFilter === 'all' ? 'Todo o histórico' : `${formatBrazilianMonth(referenceFilter)}${referenceFilter === currentMonth() ? ' · atual' : ''}`;
  const selectMonth = (value: string) => { setReferenceFilter(value); setPickerOpen(false); };

  return (
    <ScrollView contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={s.eyebrow}>DASHBOARD</Text>
      <Text style={s.title}>Painel financeiro</Text>
      <Text style={s.subtitle}>Pagos, em aberto, cancelados e inadimplência por mês de referência do boleto.</Text>

      <Panel>
        <Text style={s.label}>Mês de referência</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={s.selectTrigger}>
          <Text style={s.selectValue}>{selectedLabel}</Text>
          <Text style={s.selectCaret}>▾</Text>
        </Pressable>
      </Panel>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>Mês de referência</Text>
            <ScrollView style={s.modalList}>
              <Pressable onPress={() => selectMonth('all')} style={[s.modalOption, referenceFilter === 'all' && s.modalOptionActive]}>
                <Text style={[s.modalOptionText, referenceFilter === 'all' && s.modalOptionTextActive]}>Todo o histórico</Text>
              </Pressable>
              {months.map(value => (
                <Pressable key={value} onPress={() => selectMonth(value)} style={[s.modalOption, referenceFilter === value && s.modalOptionActive]}>
                  <Text style={[s.modalOptionText, referenceFilter === value && s.modalOptionTextActive]}>{formatBrazilianMonth(value)}{value === currentMonth() ? ' · atual' : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {summary && hasAnything ? (
        <>
          <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
            <View style={[s.summary, s.summaryPaid, compact && s.summaryMobile]}>
              <Text style={[s.summaryValue, s.paidText]}>{money(summary.paid.totalCents)}</Text>
              <Text style={s.summaryLabel}>pagos · {summary.paid.count} boleto{summary.paid.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[s.summary, compact && s.summaryMobile]}>
              <Text style={s.summaryValue}>{money(summary.open.totalCents)}</Text>
              <Text style={s.summaryLabel}>em aberto · {summary.open.count} boleto{summary.open.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[s.summary, s.summaryMuted, compact && s.summaryMobile]}>
              <Text style={s.summaryValue}>{money(summary.canceled.totalCents)}</Text>
              <Text style={s.summaryLabel}>cancelados · {summary.canceled.count} boleto{summary.canceled.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[s.summary, s.summaryDanger, compact && s.summaryMobile]}>
              <Text style={[s.summaryValue, s.dangerText]}>{money(summary.overdue.totalCents)}</Text>
              <Text style={s.summaryLabel}>vencidos · {summary.overdue.count} boleto{summary.overdue.count === 1 ? '' : 's'}</Text>
            </View>
          </View>

          <View style={s.breakdownRow}>
            <Text style={s.breakdownItem}>Via banco: {money(summary.paid.bankCents)} ({summary.paid.bankCount})</Text>
            <Text style={s.breakdownItem}>Via Pix, boleto cancelado: {money(summary.paid.pixSettledCents)} ({summary.paid.pixSettledCount})</Text>
          </View>

          {summary.paid.pixSettledInvoices.length > 0 ? (
            <>
              <Text style={s.section}>Pagamentos via Pix conciliados manualmente</Text>
              <Text style={s.sectionHint}>Boletos cancelados no banco, mas com pagamento identificado e registrado por fora (Pix direto).</Text>
              {summary.paid.pixSettledInvoices.map(item => (
                <View key={item.id} style={s.card}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{item.userFullName || item.userUsername}</Text>
                    <View style={s.badge}><Text style={s.badgeText}>Pago via Pix</Text></View>
                  </View>
                  <Text style={s.cardValue}>{money(item.amountCents)}</Text>
                  <Text style={s.cardMeta}>Pago em {formatBrazilianDate(item.paidAt)} · referência {formatBrazilianDate(item.dueDate)}</Text>
                  {item.cancellationReason ? <Text style={s.cardReason}>Motivo do cancelamento: {item.cancellationReason}</Text> : null}
                </View>
              ))}
            </>
          ) : null}

          <Text style={s.section}>Inadimplência</Text>
          {summary.overdue.byPerson.length === 0 ? (
            <EmptyState title="Nenhum morador inadimplente" description="Não há boletos vencidos no período selecionado." />
          ) : (
            <>
              <Text style={s.sectionHint}>Moradores com boleto(s) vencido(s), do maior pro menor valor em atraso.</Text>
              {summary.overdue.byPerson.map(debtor => (
                <View key={debtor.userId} style={s.overdueCard}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{debtor.fullName || debtor.username}</Text>
                    <Text style={s.overdueValue}>{money(debtor.overdueCents)}</Text>
                  </View>
                  <Text style={s.cardMeta}>
                    {debtor.unit ? `${debtor.unit} · ` : ''}{debtor.overdueCount} boleto{debtor.overdueCount === 1 ? '' : 's'} vencido{debtor.overdueCount === 1 ? '' : 's'}
                  </Text>
                  <Text style={s.overdueAlert}>Vencido há {debtor.daysOverdue} dia{debtor.daysOverdue === 1 ? '' : 's'} (desde {formatBrazilianDate(debtor.oldestDueDate)})</Text>
                </View>
              ))}
            </>
          )}
        </>
      ) : !loading ? (
        <EmptyState title="Nenhum boleto no período" description="Altere o filtro de mês de referência para consultar outros períodos." />
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  containerMobile: { padding: 16 },
  eyebrow: { color: colors.green, fontWeight: '800', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 16, marginBottom: 7 },
  selectTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, backgroundColor: '#fff' },
  selectValue: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  selectCaret: { color: colors.muted, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 16, backgroundColor: '#fff', padding: 18 },
  modalTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginBottom: 10 },
  modalList: { flexGrow: 0 },
  modalOption: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8 },
  modalOptionActive: { backgroundColor: colors.softBlue },
  modalOptionText: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  modalOptionTextActive: { color: colors.primaryDark, fontWeight: '900' },
  error: { color: colors.red, fontWeight: '700', marginTop: 14 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  summaryRowMobile: { flexDirection: 'column' },
  summary: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16 },
  summaryMobile: { minWidth: 0 },
  summaryPaid: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  summaryMuted: { backgroundColor: '#f2f4f7' },
  summaryDanger: { borderColor: '#ef9a9a', backgroundColor: '#fff5f5' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.ink },
  paidText: { color: colors.green },
  dangerText: { color: colors.red },
  summaryLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  breakdownRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10, marginBottom: 4, paddingHorizontal: 4 },
  breakdownItem: { color: colors.muted, fontSize: 13 },
  section: { fontSize: 18, fontWeight: '900', color: colors.ink, marginTop: 26, marginBottom: 4 },
  sectionHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 14, marginBottom: 10 },
  overdueCard: { borderWidth: 2, borderColor: colors.red, backgroundColor: '#fff8f8', borderRadius: 10, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardName: { fontSize: 15, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  badge: { backgroundColor: '#fdf7ea', borderWidth: 1, borderColor: '#f0d9a8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: colors.amber, fontWeight: '800', fontSize: 12 },
  cardValue: { fontSize: 18, fontWeight: '900', color: colors.ink, marginTop: 6 },
  cardMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  cardReason: { color: colors.muted, fontSize: 13, marginTop: 4, fontStyle: 'italic' },
  overdueValue: { fontSize: 18, fontWeight: '900', color: colors.red },
  overdueAlert: { color: colors.red, fontWeight: '800', fontSize: 13, marginTop: 8 },
});
