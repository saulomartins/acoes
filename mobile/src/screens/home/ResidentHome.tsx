import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from '../../ui/text';
import { AuthContext } from '../../context/AuthContext';
import { apiRequest, openAuthenticatedPdf } from '../../api/client';
import { AppDialog } from '../../ui/components';
import { colors } from '../../ui/theme';
import { formatBrazilianDate } from '../../utils/date';
import { subscribeNotificationsChanged } from '../../services/notificationEvents';

// Início do morador (proprietário/inquilino): o que ele precisa resolver vem
// primeiro — o boleto da vez e as pendências —, e os atalhos ficam por último.
// Só leitura: toda ação leva à tela que já existe para ela, com as mesmas
// regras de sempre. Cada consulta respeita a funcionalidade ativa do
// condomínio (a API devolve 403 para módulo desligado).

type Invoice = {
  id: string; amount_cents: number; due_date: string; reference_month: string | null;
  status: 'pending_provider' | 'issued' | 'paid' | 'overdue' | 'canceled';
  paid_at?: string | null; external_id: string | null; provider_situation?: string | null;
  debt_excluded_at?: string | null; invoice_type?: string;
  extra_charge_items?: Array<{ description: string; amount_cents: number }>;
  consumption_items?: Array<{ utility_type: string; amount_cents: number }>;
};
type Poll = { id: string; title: string; status: string; closes_at: string | null; selected_option_id: string | null };
type Reservation = { id: string; requested_by: string; starts_at: string; status: string; space_name: string };
type Notice = { id: string; title: string; read_at: string | null; created_at: string };
type Agreement = { id: string; status: string; installment_count: number; negotiated_total_cents: number; valid_until: string | null };
type Infraction = { id: string; status: string; article_snapshot?: { articleNumber?: string } | null };

type Attention = { key: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'lilac'; symbol: string; title: string; subtitle: string; cta?: string; route: string };

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dayOnly = (iso: string) => iso.slice(0, 10);
const daysUntil = (iso: string) => {
  const due = new Date(`${dayOnly(iso)}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
};
const monthName = (iso: string | null) => iso ? new Date(`${dayOnly(iso)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
const isOpen = (item: Invoice) => ['issued', 'overdue', 'pending_provider'].includes(item.status) && !item.debt_excluded_at && item.provider_situation !== 'EXPIRADO';

const toneStyle: Record<Attention['tone'], { bg: string; fg: string }> = {
  blue: { bg: '#eaf1fb', fg: '#194d9d' },
  amber: { bg: '#fbf1dc', fg: '#7a520a' },
  green: { bg: '#e6f6f2', fg: '#0b6b5d' },
  red: { bg: '#fbebeb', fg: '#a12c2c' },
  lilac: { bg: '#f1ebfc', fg: '#5b2fb0' },
};

export function ResidentHome({ navigation, registerSection, isActive }: { navigation: any; registerSection: (key: string) => (node: any) => void; isActive: (key: string) => boolean }) {
  const { user, userToken, condominiumFeatures } = useContext(AuthContext);
  const on = (feature: string) => (condominiumFeatures as any)?.[feature] === true;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [infractions, setInfractions] = useState<Infraction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: 'info' | 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    if (!userToken || !condominiumFeatures) return;
    const get = <T,>(feature: string, path: string, pick: (data: any) => T[], set: (rows: T[]) => void) =>
      on(feature) ? apiRequest<any>(path, userToken).then(data => set(pick(data))).catch(() => set([])) : Promise.resolve(set([]));
    await Promise.all([
      get<Invoice>('gestao_cobrancas', '/invoices', data => data.invoices || [], setInvoices),
      get<Poll>('enquetes', '/polls', data => data.polls || [], setPolls),
      get<Reservation>('reserva_espacos', '/space-reservations', data => data.reservations || [], setReservations),
      get<Notice>('avisos_comunicacao', '/notifications', data => data.notifications || [], setNotices),
      get<Agreement>('historico_acordos', '/agreements', data => data.agreements || [], setAgreements),
      get<Infraction>('regimento_ocorrencias', '/infraction-notices', data => data.notices || [], setInfractions),
    ]);
    setLoaded(true);
  }, [condominiumFeatures, userToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeNotificationsChanged(() => { void load(); }), [load]);

  // O boleto da vez: o em aberto de vencimento mais próximo (um vencido vem
  // antes de qualquer outro). Sem nenhum em aberto, o último pago.
  const nextInvoice = useMemo(() => invoices.filter(isOpen).sort((a, b) => a.due_date.localeCompare(b.due_date))[0] || null, [invoices]);
  const lastPaid = useMemo(() => invoices.filter(item => item.status === 'paid').sort((a, b) => (b.reference_month || b.due_date).localeCompare(a.reference_month || a.due_date))[0] || null, [invoices]);
  const openCount = invoices.filter(isOpen).length;

  const attention = useMemo<Attention[]>(() => {
    const list: Attention[] = [];
    for (const agreement of agreements.filter(item => item.status === 'sent')) {
      list.push({ key: `agreement-${agreement.id}`, tone: 'lilac', symbol: '§', title: 'Proposta de acordo para você', subtitle: `${agreement.installment_count}x · total ${money(agreement.negotiated_total_cents)}${agreement.valid_until ? ` · válida até ${formatBrazilianDate(agreement.valid_until)}` : ''}`, cta: 'Ver proposta', route: 'AgreementHistory' });
    }
    for (const notice of infractions.filter(item => item.status === 'enviada')) {
      list.push({ key: `infraction-${notice.id}`, tone: 'red', symbol: '!', title: `Notificação de infração${notice.article_snapshot?.articleNumber ? ` · ${notice.article_snapshot.articleNumber}` : ''}`, subtitle: 'Dê ciência para acompanhar o processo', cta: 'Abrir', route: 'InfractionNotices' });
    }
    for (const poll of polls.filter(item => item.status === 'open' && !item.selected_option_id)) {
      list.push({ key: `poll-${poll.id}`, tone: 'blue', symbol: '✓', title: `Enquete: ${poll.title}`, subtitle: `Você ainda não votou${poll.closes_at ? ` · encerra em ${formatBrazilianDate(poll.closes_at)}` : ''}`, cta: 'Votar', route: 'Polls' });
    }
    const upcoming = reservations
      .filter(item => item.requested_by === user?.id && ['pending', 'approved'].includes(item.status) && new Date(item.starts_at).getTime() >= Date.now() - 86400000)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (const reservation of upcoming) {
      list.push({ key: `reservation-${reservation.id}`, tone: reservation.status === 'pending' ? 'amber' : 'green', symbol: '▦', title: `${reservation.space_name} · ${formatBrazilianDate(reservation.starts_at)}`, subtitle: reservation.status === 'pending' ? 'Reserva aguardando aprovação do síndico' : 'Reserva aprovada', route: 'SpaceReservations' });
    }
    const unread = notices.filter(item => !item.read_at);
    if (unread.length) {
      list.push({ key: 'notices', tone: 'green', symbol: '◉', title: unread.length === 1 ? unread[0].title : `${unread.length} avisos novos`, subtitle: unread.length === 1 ? `Aviso novo · ${formatBrazilianDate(unread[0].created_at)}` : `O mais recente: ${unread[0].title}`, cta: 'Ler', route: 'Communications' });
    }
    return list;
  }, [agreements, infractions, notices, polls, reservations, user?.id]);

  const shortcuts = [
    { label: 'Prestação de contas', short: 'Prestação', symbol: '$', route: 'Accountability', feature: 'prestacao_contas' },
    { label: 'Relatos e solicitações', short: 'Relatos', symbol: '✉', route: 'Reports', feature: 'relatos_solicitacoes' },
    { label: 'Regimento interno', short: 'Regimento', symbol: '§', route: 'Regulation', feature: 'regimento_ocorrencias' },
    { label: 'Ocorrências', short: 'Ocorrências', symbol: '⚑', route: 'Occurrences', feature: 'regimento_ocorrencias' },
    { label: 'Nada consta', short: 'Nada consta', symbol: '✓', route: 'Clearances', feature: 'nada_consta' },
    { label: 'Gestão de débitos', short: 'Débitos', symbol: '≋', route: 'Debts', feature: 'gestao_debitos' },
  ].filter(item => on(item.feature));

  const copyPix = async (invoice: Invoice) => {
    if (!userToken) return;
    try {
      const data = await apiRequest<{ pixCopyPaste: string }>(`/invoices/${invoice.id}/pix`, userToken);
      await Clipboard.setStringAsync(data.pixCopyPaste);
      setDialog({ title: 'Código Pix copiado', message: 'Abra o aplicativo do seu banco, escolha pagar via Pix Copia e Cola e cole o código.', tone: 'success' });
    } catch (e) {
      setDialog({ title: 'Pix indisponível', message: e instanceof Error ? e.message : 'Não foi possível consultar o Pix no banco.', tone: 'error' });
    }
  };
  const openPdf = async (invoice: Invoice) => {
    if (!userToken) return;
    try { await openAuthenticatedPdf(`/invoices/${invoice.id}/pdf`, userToken); }
    catch (e) { setDialog({ title: 'Não foi possível abrir o PDF', message: e instanceof Error ? e.message : 'Falha ao buscar o boleto no banco.', tone: 'error' }); }
  };

  const hero = (() => {
    if (!on('gestao_cobrancas')) return null;
    if (nextInvoice) {
      const days = daysUntil(nextInvoice.due_date);
      const overdue = nextInvoice.status === 'overdue' || days < 0;
      const waitingBank = nextInvoice.status === 'pending_provider';
      const chip = waitingBank ? 'Aguardando o banco' : overdue ? `Vencido há ${Math.max(1, -days)} dia${-days === 1 ? '' : 's'}` : days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days === 1 ? '' : 's'}`;
      const chipStyle = overdue ? { backgroundColor: '#fbebeb', color: '#a12c2c' } : { backgroundColor: '#fbf1dc', color: '#7a520a' };
      const extras = [...(nextInvoice.extra_charge_items || []).map(item => item.description), ...(nextInvoice.consumption_items || []).length ? ['consumo'] : []];
      return (
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroEyebrow}>{openCount > 1 ? `Boleto da vez · ${openCount} em aberto` : `Próximo boleto · ${monthName(nextInvoice.reference_month || nextInvoice.due_date)}`}</Text>
            <Text style={[styles.heroChip, chipStyle]}>{chip}</Text>
          </View>
          <Text style={styles.heroAmount}>{money(nextInvoice.amount_cents)}</Text>
          <Text style={styles.heroMeta}>Vencimento {formatBrazilianDate(nextInvoice.due_date)}{nextInvoice.invoice_type === 'agreement' ? ' · parcela de acordo' : extras.length ? ` · taxa condominial + ${extras.join(', ')}` : ' · taxa condominial'}</Text>
          {waitingBank ? <Text style={styles.heroHint}>O banco ainda não confirmou este boleto. O Pix e o PDF aparecem assim que a confirmação chegar.</Text> : (
            <View style={styles.heroActions}>
              <Pressable accessibilityRole="button" onPress={() => copyPix(nextInvoice)} style={({ pressed }) => [styles.heroPrimary, pressed && styles.pressed]}><Text style={styles.heroPrimaryText}>Copiar código Pix</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => openPdf(nextInvoice)} style={({ pressed }) => [styles.heroSecondary, pressed && styles.pressed]}><Text style={styles.heroSecondaryText}>PDF</Text></Pressable>
            </View>
          )}
          <Pressable onPress={() => navigation.navigate('Invoices')}><Text style={styles.heroLink}>Ver todos os boletos ›</Text></Pressable>
        </View>
      );
    }
    return (
      <Pressable onPress={() => navigation.navigate('Invoices')} style={[styles.hero, styles.heroOk]}>
        <Text style={[styles.heroEyebrow, { color: '#0b6b5d' }]}>Boletos</Text>
        <Text style={[styles.heroAmount, { color: colors.navy, fontSize: 24 }]}>{loaded ? 'Tudo em dia' : 'Carregando…'}</Text>
        {lastPaid ? <Text style={[styles.heroMeta, { color: colors.muted }]}>Último pagamento: {monthName(lastPaid.reference_month || lastPaid.due_date)} · {money(lastPaid.amount_cents)}{lastPaid.paid_at ? ` em ${formatBrazilianDate(lastPaid.paid_at)}` : ''}</Text> : null}
        <Text style={[styles.heroLink, { color: colors.primaryDark }]}>Ver histórico de boletos ›</Text>
      </Pressable>
    );
  })();

  return (
    <View style={styles.wrap}>
      {hero ? <View ref={registerSection('next')} style={[isActive('next') && styles.tourHighlight]}>{hero}</View> : null}

      <View ref={registerSection('attention')} style={[styles.section, isActive('attention') && styles.tourHighlight]}>
        <Text style={styles.sectionTitle}>Precisa da sua atenção</Text>
        {attention.length ? (
          <View style={styles.list}>
            {attention.map((item, index) => (
              <Pressable key={item.key} onPress={() => navigation.navigate(item.route)} style={({ pressed }) => [styles.row, index < attention.length - 1 && styles.rowDivider, pressed && styles.pressed]}>
                <View style={[styles.rowIcon, { backgroundColor: toneStyle[item.tone].bg }]}><Text style={[styles.rowSymbol, { color: toneStyle[item.tone].fg }]}>{item.symbol}</Text></View>
                <View style={styles.grow}>
                  <Text numberOfLines={2} style={styles.rowTitle}>{item.title}</Text>
                  <Text numberOfLines={2} style={styles.rowSubtitle}>{item.subtitle}</Text>
                </View>
                <Text style={styles.rowCta}>{item.cta || '›'}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={[styles.list, styles.empty]}><Text style={styles.emptyText}>{loaded ? 'Nada pendente por aqui. Avisos, enquetes e reservas aparecem neste espaço.' : 'Carregando…'}</Text></View>
        )}
      </View>

      {shortcuts.length ? (
        <View ref={registerSection('shortcuts')} style={[styles.section, isActive('shortcuts') && styles.tourHighlight]}>
          <Text style={styles.sectionTitle}>Atalhos</Text>
          <View style={styles.shortcuts}>
            {shortcuts.map(item => (
              <Pressable key={item.route} accessibilityLabel={item.label} onPress={() => navigation.navigate(item.route)} style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}>
                <View style={styles.shortcutIcon}><Text style={styles.shortcutSymbol}>{item.symbol}</Text></View>
                <Text numberOfLines={1} style={styles.shortcutLabel}>{item.short}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} onClose={() => setDialog(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 22, maxWidth: 720, width: '100%' },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 22, padding: 6, margin: -6 },
  hero: { backgroundColor: colors.navy, borderRadius: 20, padding: 20, gap: 8 },
  heroOk: { backgroundColor: '#e6f6f2', borderWidth: 1, borderColor: '#bfe6dc' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  heroEyebrow: { color: '#9fc0ee', fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', flexShrink: 1 },
  heroChip: { fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  heroAmount: { color: '#ffffff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  heroMeta: { color: '#c3cede', fontSize: 14, lineHeight: 20 },
  heroHint: { color: '#f2d8a0', fontSize: 13, lineHeight: 19, marginTop: 6 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  heroPrimary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: '#3fd3b5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  heroPrimaryText: { color: '#08241f', fontSize: 15, fontWeight: '900' },
  heroSecondary: { minHeight: 48, minWidth: 76, borderRadius: 14, borderWidth: 1, borderColor: '#34425e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  heroSecondaryText: { color: '#eef2f8', fontSize: 15, fontWeight: '800' },
  heroLink: { color: '#9fc0ee', fontSize: 14, fontWeight: '800', marginTop: 6 },
  section: { gap: 10 },
  sectionTitle: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  list: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, minHeight: 64 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#eef1f6' },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowSymbol: { fontSize: 18, fontWeight: '900' },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  rowSubtitle: { color: '#5b6577', fontSize: 13, marginTop: 2, lineHeight: 18 },
  rowCta: { color: colors.primaryDark, fontSize: 13, fontWeight: '900' },
  empty: { padding: 16 },
  emptyText: { color: '#5b6577', fontSize: 14, lineHeight: 20 },
  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  shortcut: { width: 78, alignItems: 'center', gap: 6 },
  shortcutIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  shortcutSymbol: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  shortcutLabel: { color: colors.ink, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
