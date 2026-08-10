import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { formatBrazilianDate, formatBrazilianMonth } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type PixSettledInvoice = {
  id: string;
  amountCents: number;
  paidAt: string;
  dueDate: string;
  cancellationReason: string | null;
  userFullName: string | null;
  userUsername: string;
};

type PendingBankInvoice = {
  id: string;
  amountCents: number;
  dueDate: string;
  createdAt: string;
  fullName: string | null;
  username: string;
  unit: string | null;
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
  pendingBank: { totalCents: number; count: number; invoices: PendingBankInvoice[] };
  overdue: { totalCents: number; count: number; byPerson: OverdueDebtor[] };
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; };

export default function Dashboard() {
  const { isMobile: compact } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
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
  const hasAnything = summary && (summary.paid.count > 0 || summary.open.count > 0 || summary.canceled.count > 0 || summary.overdue.count > 0 || summary.pendingBank.count > 0);
  const selectedLabel = referenceFilter === 'all' ? 'Todo o histórico' : `${formatBrazilianMonth(referenceFilter)}${referenceFilter === currentMonth() ? ' · atual' : ''}`;
  const selectMonth = (value: string) => { setReferenceFilter(value); setPickerOpen(false); };

  const tourSteps: TourStep[] = [
    { key: 'filter', title: 'Mês de referência', description: 'Filtra todo o painel por mês de referência do boleto. Escolha "Todo o histórico" para ver tudo de uma vez, sem filtrar por mês.' },
    { key: 'summary', title: 'Resumo do período', description: 'Cinco totais lado a lado e sem sobreposição: pagos, em aberto, cancelados, vencidos e "aguardando o banco" (boletos já enviados ao banco, mas sem confirmação de registro ainda). Um boleto aguardando o banco não entra em "em aberto", porque ainda não existe para o morador pagar. Logo abaixo, a divisão de "pagos" entre pagamento via banco e pagamento via Pix conciliado manualmente.' },
    { key: 'pixSettled', title: 'Pagamentos via Pix conciliados manualmente', description: 'Boletos que foram cancelados no banco, mas cujo pagamento foi identificado por fora (Pix direto) e registrado manualmente como pago. Só aparece quando existe pelo menos um caso no período selecionado.' },
    { key: 'pendingBank', title: 'Aguardando o banco', description: 'Boletos já enviados ao banco para registro, mas ainda sem confirmação — não exige nenhuma ação, é só acompanhamento até o banco confirmar o registro. Só aparece quando há boletos nesse estado.' },
    { key: 'overdue', title: 'Inadimplência', description: 'Lista os moradores com boleto(s) vencido(s) no período, ordenados do maior para o menor valor em atraso, com a quantidade de boletos vencidos e há quantos dias o mais antigo está vencido.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={s.headerRow}>
        <View style={s.grow}>
          <Text style={s.eyebrow}>DASHBOARD</Text>
          <Text style={s.title}>Painel financeiro</Text>
          <Text style={s.subtitle}>Pagos, em aberto, cancelados e inadimplência por mês de referência do boleto.</Text>
        </View>
        <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('filter')} style={[isActive('filter') && s.tourHighlight]}>
      <Panel>
        <Text style={s.label}>Mês de referência</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={s.selectTrigger}>
          <Text style={s.selectValue}>{selectedLabel}</Text>
          <Text style={s.selectCaret}>▾</Text>
        </Pressable>
      </Panel>
      </View>

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
          <View ref={registerSection('summary')} style={[isActive('summary') && s.tourHighlight]}>
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
            <View style={[s.summary, s.summaryPending, compact && s.summaryMobile]}>
              <Text style={[s.summaryValue, s.pendingText]}>{money(summary.pendingBank.totalCents)}</Text>
              <Text style={s.summaryLabel}>aguardando o banco · {summary.pendingBank.count} boleto{summary.pendingBank.count === 1 ? '' : 's'}</Text>
            </View>
          </View>

          <View style={s.breakdownRow}>
            <Text style={s.breakdownItem}>Via banco: {money(summary.paid.bankCents)} ({summary.paid.bankCount})</Text>
            <Text style={s.breakdownItem}>Via Pix, boleto cancelado: {money(summary.paid.pixSettledCents)} ({summary.paid.pixSettledCount})</Text>
          </View>
          </View>

          {summary.paid.pixSettledInvoices.length > 0 ? (
            <View ref={registerSection('pixSettled')} style={[isActive('pixSettled') && s.tourHighlight]}>
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
            </View>
          ) : null}

          {summary.pendingBank.invoices.length > 0 ? (
            <View ref={registerSection('pendingBank')} style={[isActive('pendingBank') && s.tourHighlight]}>
              <Text style={s.section}>Aguardando o banco</Text>
              <Text style={s.sectionHint}>Boletos já enviados ao banco, mas ainda sem confirmação de registro — nada a fazer, só acompanhar.</Text>
              {summary.pendingBank.invoices.map(item => (
                <View key={item.id} style={s.pendingCard}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{item.fullName || item.username}</Text>
                    <Text style={s.pendingValue}>{money(item.amountCents)}</Text>
                  </View>
                  <Text style={s.cardMeta}>
                    {item.unit ? `${item.unit} · ` : ''}vencimento {formatBrazilianDate(item.dueDate)} · enviado em {formatBrazilianDate(item.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View ref={registerSection('overdue')} style={[isActive('overdue') && s.tourHighlight]}>
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
          </View>
        </>
      ) : !loading ? (
        <EmptyState title="Nenhum boleto no período" description="Altere o filtro de mês de referência para consultar outros períodos." />
      ) : null}
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  containerMobile: { padding: 16 },
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
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
  summaryPending: { borderColor: '#f0d9a8', backgroundColor: '#fdf7ea' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.ink },
  paidText: { color: colors.green },
  dangerText: { color: colors.red },
  pendingText: { color: colors.amber },
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
  pendingCard: { borderWidth: 1, borderColor: '#f0d9a8', backgroundColor: '#fffdf6', borderRadius: 10, padding: 14, marginBottom: 10 },
  pendingValue: { fontSize: 18, fontWeight: '900', color: colors.amber },
});
