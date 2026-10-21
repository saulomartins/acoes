import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/text';
import { AuthContext } from '../../context/AuthContext';
import { apiRequest } from '../../api/client';
import { AppDialog } from '../../ui/components';
import { colors } from '../../ui/theme';
import { formatBrazilianDate } from '../../utils/date';

// Início do síndico/subsíndico (versão web): números do mês, a fila de
// pendências e a arrecadação recente. Nenhuma regra nova — cada linha da fila
// vem de um endpoint que já existe e leva à tela onde aquilo é resolvido. A
// única ação feita aqui é aprovar uma reserva, com a mesma rota da tela de
// reservas e confirmação antes; recusar exige justificativa e abre a tela.

type Summary = {
  paid: { totalCents: number; count: number };
  open: { totalCents: number; count: number };
  overdue: { totalCents: number; count: number; byPerson: Array<{ fullName: string | null; username: string; unit: string | null }> };
  pendingBank: { totalCents: number; count: number };
};
type Pending = { key: string; kind: string; tone: 'amber' | 'blue' | 'lilac' | 'red' | 'teal'; title: string; subtitle: string; cta: string; route: string; approveId?: string };

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const compact = (cents: number) => Math.round(cents / 100).toLocaleString('pt-BR');
const monthStart = (offset: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const monthShort = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const emitted = (summary: Summary) => summary.paid.totalCents + summary.open.totalCents + summary.overdue.totalCents + summary.pendingBank.totalCents;
const occurrenceLabel: Record<string, string> = { barulho: 'Barulho', dano: 'Dano', manutencao: 'Manutenção', seguranca: 'Segurança', conduta: 'Conduta', outros: 'Outros' };

const toneStyle: Record<Pending['tone'], { bg: string; fg: string }> = {
  amber: { bg: '#fbf1dc', fg: '#7a520a' },
  blue: { bg: '#eaf1fb', fg: '#194d9d' },
  lilac: { bg: '#f1ebfc', fg: '#5b2fb0' },
  red: { bg: '#fbebeb', fg: '#a12c2c' },
  teal: { bg: '#e6f6f2', fg: '#0b6b5d' },
};

export function ManagerHome({ navigation, registerSection, isActive, desktop }: { navigation: any; registerSection: (key: string) => (node: any) => void; isActive: (key: string) => boolean; desktop: boolean }) {
  const { userToken, condominiumFeatures } = useContext(AuthContext);
  const on = (feature: string) => (condominiumFeatures as any)?.[feature] === true;
  const finance = on('painel') && on('gestao_cobrancas');
  const [months, setMonths] = useState<Array<{ month: string; summary: Summary }>>([]);
  const [allTime, setAllTime] = useState<Summary | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: 'info' | 'success' | 'error'; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!userToken || !condominiumFeatures) return;
    const safe = <T,>(promise: Promise<T>) => promise.catch(() => null);
    const monthKeys = [-3, -2, -1, 0].map(monthStart);
    const [monthSummaries, total, reservations, reports, occurrences, notices, clearances] = await Promise.all([
      finance ? Promise.all(monthKeys.map(month => safe(apiRequest<Summary>(`/invoices/dashboard/summary?referenceMonth=${month}`, userToken)).then(summary => summary ? { month, summary } : null))) : Promise.resolve([]),
      finance ? safe(apiRequest<Summary>('/invoices/dashboard/summary', userToken)) : Promise.resolve(null),
      on('reserva_espacos') ? safe(apiRequest<any>('/space-reservations', userToken)) : Promise.resolve(null),
      on('relatos_solicitacoes') ? safe(apiRequest<any>('/reports', userToken)) : Promise.resolve(null),
      on('regimento_ocorrencias') ? safe(apiRequest<any>('/occurrences', userToken)) : Promise.resolve(null),
      on('regimento_ocorrencias') ? safe(apiRequest<any>('/infraction-notices', userToken)) : Promise.resolve(null),
      on('nada_consta') ? safe(apiRequest<any>('/clearances', userToken)) : Promise.resolve(null),
    ]);
    setMonths((monthSummaries as Array<{ month: string; summary: Summary } | null>).filter(Boolean) as Array<{ month: string; summary: Summary }>);
    setAllTime(total);

    const list: Pending[] = [];
    for (const r of (reservations?.reservations || []).filter((item: any) => item.status === 'pending').sort((a: any, b: any) => a.starts_at.localeCompare(b.starts_at))) {
      list.push({ key: `res-${r.id}`, kind: 'Reserva', tone: 'amber', title: `${r.space_name} · ${formatBrazilianDate(r.starts_at)}`, subtitle: [r.requested_by_name, r.unit_label, r.purpose].filter(Boolean).join(' · '), cta: 'Recusar', route: 'SpaceReservations', approveId: r.id });
    }
    for (const r of (reports?.reports || []).filter((item: any) => item.status !== 'resolved' && (item.status === 'open' || Number(item.unread_count) > 0))) {
      list.push({ key: `rep-${r.id}`, kind: 'Relato', tone: 'blue', title: r.subject, subtitle: [r.resident_name || r.resident_username, r.unit, r.category, r.status === 'open' ? 'aberto, sem resposta' : 'nova mensagem do morador'].filter(Boolean).join(' · '), cta: r.status === 'open' ? 'Responder' : 'Abrir conversa', route: 'Reports' });
    }
    for (const n of (notices?.notices || []).filter((item: any) => item.status === 'em_defesa')) {
      list.push({ key: `inf-${n.id}`, kind: 'Infração', tone: 'lilac', title: `${n.article_snapshot?.articleNumber || 'Notificação'} · em defesa`, subtitle: [n.unit_label, n.base_fine_amount_cents ? `multa base ${money(n.base_fine_amount_cents)}` : null].filter(Boolean).join(' · ') || n.description, cta: 'Analisar', route: 'InfractionNotices' });
    }
    for (const o of (occurrences?.occurrences || []).filter((item: any) => item.status === 'aberta')) {
      list.push({ key: `occ-${o.id}`, kind: 'Ocorrência', tone: 'lilac', title: `${occurrenceLabel[o.category] || o.category}${o.unit_label ? ` · ${o.unit_label}` : ''}`, subtitle: o.description, cta: 'Ver', route: 'Occurrences' });
    }
    for (const c of (clearances?.requests || []).filter((item: any) => item.status === 'pending')) {
      list.push({ key: `clr-${c.id}`, kind: 'Nada consta', tone: 'teal', title: `Pedido de ${c.requester_name}`, subtitle: c.unit_label || '', cta: 'Emitir', route: 'Clearances' });
    }
    if (total && total.overdue.count > 0) {
      const names = total.overdue.byPerson.map(person => person.fullName || person.username);
      list.push({ key: 'overdue', kind: 'Cobrança', tone: 'red', title: `${total.overdue.count} boleto${total.overdue.count === 1 ? '' : 's'} vencido${total.overdue.count === 1 ? '' : 's'} · ${money(total.overdue.totalCents)}`, subtitle: names.length > 3 ? `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}` : names.join(', '), cta: 'Ver lista', route: 'Dashboard' });
    }
    setPending(list);
    setLoaded(true);
  }, [condominiumFeatures, finance, userToken]);

  useEffect(() => { void load(); }, [load]);

  const approve = (item: Pending) => setDialog({
    title: 'Aprovar esta reserva?',
    message: `${item.title}\n${item.subtitle}\n\nO morador recebe a confirmação na hora.`,
    tone: 'info', confirmLabel: 'Aprovar reserva', cancelLabel: 'Voltar',
    onConfirm: async () => {
      setDialog(null);
      try {
        await apiRequest(`/space-reservations/reservations/${item.approveId}/review`, userToken!, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
        setDialog({ title: 'Reserva aprovada', message: 'O morador foi avisado.', tone: 'success' });
        void load();
      } catch (e) {
        setDialog({ title: 'Não foi possível aprovar', message: e instanceof Error ? e.message : 'Tente novamente pela tela de reservas.', tone: 'error' });
      }
    },
  });

  const current = months.find(item => item.month === monthStart(0))?.summary || null;
  const currentEmitted = current ? emitted(current) : 0;
  const receivedPct = current && currentEmitted > 0 ? Math.round((current.paid.totalCents / currentEmitted) * 100) : 0;
  const chartMax = useMemo(() => Math.max(1, ...months.map(item => emitted(item.summary))), [months]);
  const currentMonthName = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <View style={styles.wrap}>
      {finance && current ? (
        <View ref={registerSection('kpis')} style={[styles.kpis, isActive('kpis') && styles.tourHighlight]}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Recebido em {currentMonthName}</Text>
            <Text style={styles.kpiValue}>{money(current.paid.totalCents)}</Text>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, receivedPct)}%` }]} /></View>
            <Text style={styles.kpiHint}>{receivedPct}% de {money(currentEmitted)} emitidos</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Vencidos (todo o histórico)</Text>
            <Text style={[styles.kpiValue, allTime && allTime.overdue.count > 0 && { color: '#b23232' }]}>{money(allTime?.overdue.totalCents || 0)}</Text>
            <Text style={styles.kpiHint}>{allTime?.overdue.count || 0} boleto(s) de {allTime?.overdue.byPerson.length || 0} pessoa(s)</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Em aberto em {currentMonthName}</Text>
            <Text style={styles.kpiValue}>{money(current.open.totalCents + current.pendingBank.totalCents)}</Text>
            <Text style={styles.kpiHint}>{current.open.count + current.pendingBank.count} boleto(s) ainda no prazo</Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.columns, !desktop && styles.columnsStacked]}>
        <View ref={registerSection('pending')} style={[styles.card, styles.pendingCard, isActive('pending') && styles.tourHighlight]}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Pendências</Text>
            <Text style={styles.cardMeta}>{loaded ? `${pending.length} item(ns)` : 'Carregando…'}</Text>
          </View>
          {pending.length === 0 ? <Text style={styles.empty}>{loaded ? 'Nenhuma pendência agora. Reservas para aprovar, relatos, defesas e boletos vencidos aparecem aqui.' : 'Carregando…'}</Text> : pending.map((item, index) => (
            <View key={item.key} style={[styles.pendingRow, index < pending.length - 1 && styles.divider]}>
              <Text style={[styles.kind, { backgroundColor: toneStyle[item.tone].bg, color: toneStyle[item.tone].fg }]}>{item.kind.toUpperCase()}</Text>
              <View style={styles.grow}>
                <Text numberOfLines={1} style={styles.pendingTitle}>{item.title}</Text>
                {item.subtitle ? <Text numberOfLines={2} style={styles.pendingSubtitle}>{item.subtitle}</Text> : null}
              </View>
              <View style={styles.actions}>
                {item.approveId ? <Pressable accessibilityRole="button" onPress={() => approve(item)} style={({ pressed }) => [styles.approve, pressed && styles.pressed]}><Text style={styles.approveText}>Aprovar</Text></Pressable> : null}
                <Pressable accessibilityRole="button" onPress={() => navigation.navigate(item.route)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionText}>{item.cta}</Text></Pressable>
              </View>
            </View>
          ))}
        </View>

        {finance && months.length ? (
          <View ref={registerSection('chart')} style={[styles.card, styles.chartCard, isActive('chart') && styles.tourHighlight]}>
            <Text style={styles.cardTitle}>Arrecadação por mês</Text>
            <Text style={styles.cardMeta}>Situação do total emitido em cada referência</Text>
            <View accessibilityLabel={`Por mês: ${months.map(item => `${monthShort(item.month)}: pago ${money(item.summary.paid.totalCents)}, em aberto ${money(item.summary.open.totalCents + item.summary.pendingBank.totalCents)}, vencido ${money(item.summary.overdue.totalCents)}`).join('; ')}`} style={styles.chart}>
              {months.map(item => {
                const total = emitted(item.summary);
                const isCurrent = item.month === monthStart(0);
                // Barra empilhada: pago embaixo, em aberto (no prazo) no meio e
                // vencido em cima. Tudo pago = barra inteira verde.
                const share = (cents: number) => `${total > 0 ? (cents / total) * 100 : 0}%` as const;
                return (
                  <View key={item.month} style={styles.barCol}>
                    <Text style={styles.barValue}>{compact(item.summary.paid.totalCents)}</Text>
                    <View style={[styles.barTrack, { height: Math.max(8, Math.round((total / chartMax) * 150)) }]}>
                      <View style={[styles.barSegment, styles.barOverdue, { height: share(item.summary.overdue.totalCents) }]} />
                      <View style={[styles.barSegment, styles.barOpen, { height: share(item.summary.open.totalCents + item.summary.pendingBank.totalCents) }]} />
                      <View style={[styles.barSegment, styles.barPaid, { height: share(item.summary.paid.totalCents) }]} />
                    </View>
                    <Text style={styles.barLabel}>{monthShort(item.month)}{isCurrent ? '*' : ''}</Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.barPaid]} /><Text style={styles.cardMeta}>Pago</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.barOpen]} /><Text style={styles.cardMeta}>Em aberto (no prazo)</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, styles.barOverdue]} /><Text style={styles.cardMeta}>Vencido</Text></View>
            </View>
            <Text style={styles.cardMeta}>Valor acima da barra = recebido. * Mês em andamento.</Text>
            <Pressable onPress={() => navigation.navigate('Dashboard')}><Text style={styles.link}>Abrir painel financeiro ›</Text></Pressable>
          </View>
        ) : null}
      </View>

      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18, width: '100%' },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 18, padding: 6, margin: -6 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  kpi: { flexGrow: 1, flexBasis: 220, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, gap: 6 },
  kpiLabel: { color: '#5b6577', fontSize: 13, fontWeight: '700' },
  kpiValue: { color: colors.navy, fontSize: 24, fontWeight: '900' },
  kpiHint: { color: '#5b6577', fontSize: 13 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#eef1f6', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.green },
  columns: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  columnsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16 },
  pendingCard: { flex: 3, minWidth: 0, alignSelf: 'stretch' },
  chartCard: { flex: 2, minWidth: 280, padding: 18, gap: 6, alignSelf: 'stretch' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  cardTitle: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  cardMeta: { color: '#5b6577', fontSize: 13 },
  empty: { color: '#5b6577', fontSize: 14, lineHeight: 20, padding: 18 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  kind: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  pendingTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  pendingSubtitle: { color: '#5b6577', fontSize: 13, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  approve: { minHeight: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  approveText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  action: { minHeight: 36, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d5dbe6', backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, height: 200, marginTop: 10 },
  barCol: { flex: 1, alignItems: 'center', gap: 6, justifyContent: 'flex-end' },
  barValue: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  barTrack: { width: '100%', maxWidth: 54, borderRadius: 8, backgroundColor: '#eef1f6', justifyContent: 'flex-end', overflow: 'hidden' },
  barSegment: { width: '100%' },
  barPaid: { backgroundColor: colors.green },
  barOpen: { backgroundColor: colors.primary },
  barOverdue: { backgroundColor: colors.red },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  barLabel: { color: '#5b6577', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  link: { color: colors.primaryDark, fontSize: 14, fontWeight: '900', marginTop: 8 },
});
