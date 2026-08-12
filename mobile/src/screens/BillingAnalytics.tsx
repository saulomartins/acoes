import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel, summaryLabelProps, summaryValueProps } from '../ui/components';
import DateRangeCalendar from '../ui/DateRangeCalendar';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';

type ReasonBreakdown = { reason: string | null; count: number; totalCents: number };
type BillingAnalyticsSummary = {
  from: string;
  to: string;
  received: { totalCents: number; count: number };
  unpaid: { totalCents: number; count: number };
  canceled: { totalCents: number; count: number; byReason: ReasonBreakdown[] };
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = (value: Date) => value.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const toApiDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const todayDay = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const daysAgo = (days: number) => { const value = todayDay(); value.setDate(value.getDate() - days); return value; };
const monthStart = () => { const value = todayDay(); value.setDate(1); return value; };
const dayCount = (from: Date, to: Date) => Math.round((startOfDayTime(to) - startOfDayTime(from)) / 86400000) + 1;
const startOfDayTime = (value: Date) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day.getTime(); };

export default function BillingAnalytics() {
  const { isMobile: compact } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [fromDate, setFromDate] = useState(() => daysAgo(30));
  const [toDate, setToDate] = useState(() => todayDay());
  const [summary, setSummary] = useState<BillingAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();

  const tourSteps: TourStep[] = [
    { key: 'period', title: 'Período', description: 'Todos os números da tela seguem esse intervalo. Toque numa data inicial e depois numa final no calendário, ou use os atalhos (últimos 30/90 dias, mês atual). O texto acima do calendário mostra o intervalo escolhido e quantos dias ele cobre.' },
    { key: 'summary', title: 'Recebidos, não pagos e cancelados', description: 'Três totais do período: "recebidos" conta pela data do PAGAMENTO — um boleto vencido em julho e pago em agosto entra em agosto, diferente do Painel financeiro, que agrupa tudo pelo mês de vencimento. "Não pagos" junta em aberto e vencidos (tudo que não foi pago nem cancelado) e "cancelados" conta só os que nunca receberam nada — ambos pela data de vencimento.' },
    { key: 'reasons', title: 'Cancelados por motivo', description: 'Agrupa os boletos cancelados do período pelo motivo registrado, com a quantidade e o valor de cada grupo. O motivo é um texto livre preenchido manualmente pelo síndico/subsíndico depois que o banco cancela o boleto — por isso os que ninguém preencheu aparecem juntos em "Sem motivo informado".' },
  ];

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ from: toApiDate(fromDate), to: toApiDate(toDate) });
      const response = await apiRequest<BillingAnalyticsSummary>(`/invoices/analytics?${params.toString()}`, userToken);
      setSummary(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar os indicadores.');
    } finally {
      setLoading(false);
    }
  }, [userToken, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const applyRange = (from: Date, to: Date) => { setFromDate(from); setToDate(to); };
  const hasAnything = summary && (summary.received.count > 0 || summary.unpaid.count > 0 || summary.canceled.count > 0);

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={s.headerRow}>
        <View style={s.grow}>
          <Text style={s.eyebrow}>INDICADORES</Text>
          <Text style={s.title}>Indicadores de boletos</Text>
          <Text style={s.subtitle}>Visão analítica por período, separada do Painel financeiro: total recebido, não pago e cancelado (com os motivos de cancelamento).</Text>
        </View>
        <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('period')} style={[isActive('period') && s.tourHighlight]}>
      <Panel>
        <Text style={s.label}>Período</Text>
        <Text style={s.rangeValue}>De {formatDay(fromDate)} até {formatDay(toDate)} · {dayCount(fromDate, toDate)} dia{dayCount(fromDate, toDate) === 1 ? '' : 's'}</Text>
        <View style={s.shortcutRow}>
          <Pressable onPress={() => applyRange(daysAgo(30), todayDay())} style={s.chip}><Text style={s.chipText}>Últimos 30 dias</Text></Pressable>
          <Pressable onPress={() => applyRange(daysAgo(90), todayDay())} style={s.chip}><Text style={s.chipText}>Últimos 90 dias</Text></Pressable>
          <Pressable onPress={() => applyRange(monthStart(), todayDay())} style={s.chip}><Text style={s.chipText}>Mês atual</Text></Pressable>
        </View>
        <View style={s.calendarWrap}>
          <DateRangeCalendar from={fromDate} to={toDate} onChange={applyRange} maxDate={todayDay()} />
        </View>
      </Panel>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      {summary && hasAnything ? (
        <>
          <View ref={registerSection('summary')} style={[s.summaryRow, compact && s.summaryRowMobile, isActive('summary') && s.tourHighlight]}>
            <View style={[s.summary, s.summaryReceived, compact && s.summaryMobile]}>
              <Text {...summaryValueProps} style={[s.summaryValue, s.receivedText]}>{money(summary.received.totalCents)}</Text>
              <Text {...summaryLabelProps} style={s.summaryLabel}>recebidos · {summary.received.count} boleto{summary.received.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[s.summary, compact && s.summaryMobile]}>
              <Text {...summaryValueProps} style={s.summaryValue}>{money(summary.unpaid.totalCents)}</Text>
              <Text {...summaryLabelProps} style={s.summaryLabel}>não pagos · {summary.unpaid.count} boleto{summary.unpaid.count === 1 ? '' : 's'}</Text>
            </View>
            <View style={[s.summary, s.summaryMuted, compact && s.summaryMobile]}>
              <Text {...summaryValueProps} style={s.summaryValue}>{money(summary.canceled.totalCents)}</Text>
              <Text {...summaryLabelProps} style={s.summaryLabel}>cancelados · {summary.canceled.count} boleto{summary.canceled.count === 1 ? '' : 's'}</Text>
            </View>
          </View>

          <View ref={registerSection('reasons')} style={[isActive('reasons') && s.tourHighlight]}>
          <Text style={s.section}>Cancelados por motivo</Text>
          {summary.canceled.byReason.length === 0 ? (
            <EmptyState title="Nenhum boleto cancelado" description="Não há boletos cancelados no período selecionado." />
          ) : (
            <>
              <Text style={s.sectionHint}>O motivo é preenchido manualmente pelo síndico/subsíndico depois do cancelamento no banco — por isso pode haver boletos sem motivo registrado.</Text>
              {summary.canceled.byReason.map((item, index) => (
                <View key={`${item.reason || 'sem-motivo'}-${index}`} style={s.card}>
                  <View style={s.cardTop}>
                    <Text style={s.cardName}>{item.reason || 'Sem motivo informado'}</Text>
                    <Text style={s.cardValue}>{money(item.totalCents)}</Text>
                  </View>
                  <Text style={s.cardMeta}>{item.count} boleto{item.count === 1 ? '' : 's'}</Text>
                </View>
              ))}
            </>
          )}
          </View>
        </>
      ) : !loading ? (
        <EmptyState title="Nenhum boleto no período" description="Altere o período acima para consultar outras datas." />
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
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  label: { color: colors.ink, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  rangeValue: { color: colors.primaryDark, fontWeight: '900', fontSize: 15 },
  shortcutRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#fff' },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  calendarWrap: { marginTop: 14 },
  error: { color: colors.red, fontWeight: '700', marginTop: 14 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  summaryRowMobile: { flexDirection: 'column' },
  summary: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16 },
  summaryMobile: { minWidth: 0 },
  summaryReceived: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  summaryMuted: { backgroundColor: '#f2f4f7' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.ink },
  receivedText: { color: colors.green },
  summaryLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  section: { fontSize: 18, fontWeight: '900', color: colors.ink, marginTop: 26, marginBottom: 4 },
  sectionHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardName: { fontSize: 15, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  cardValue: { fontSize: 18, fontWeight: '900', color: colors.ink },
  cardMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
});
