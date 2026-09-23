import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppDialog, EmptyState, Panel } from '../ui/components';
import { ComboBox } from '../ui/ComboBox';
import { colors } from '../ui/theme';
import { formatBrazilianMonth } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type InvoiceStatus = 'pending' | 'sent' | 'paid' | 'canceled' | 'refunded';

type PlatformInvoice = {
  id: string;
  condominium_id: string;
  condominium_name: string;
  plan_name: string;
  reference_month: string;
  active_users: number;
  amount_cents: number;
  status: InvoiceStatus;
  sent_at: string | null;
  paid_at: string | null;
  pix_payment_id: string | null;
  has_pix: boolean;
  pix_expires_at: string | null;
  receipt_sent_at: string | null;
  payment_method: 'pix_mercadopago' | 'manual' | null;
  manual_note: string | null;
  due_date: string | null;
  overdue: boolean;
  cancel_reason: string | null;
  refund_note: string | null;
  paid_after_canceled_at: string | null;
};

type Summary = { receivedCents: number; openCents: number; overdueCents: number; canceledCents: number; refundedCents: number; count: number };

type PanelMode = 'markPaid' | 'cancel' | 'correct' | 'refund';

// Ações que pedem uma observação/motivo antes de executar (painel inline no
// card + confirmação). cancel/correct enviam o motivo ao síndico por e-mail.
const PANEL_MODES: Record<PanelMode, { path: string; field: 'note' | 'reason'; min: number; placeholder: string; button: string; title: string; success: string; message: (amount: string, condo: string, month: string) => string }> = {
  markPaid: { path: 'mark-paid', field: 'note', min: 3, placeholder: 'Observação (ex.: "transferência recebida em 25/09")', button: 'Confirmar recebimento', title: 'Marcar como paga',
    success: 'Fatura marcada como paga e recibo enviado.', message: (a, c, m) => `Confirmar o recebimento de ${a} de ${c} (${m})? O recibo será enviado ao síndico e ao subsíndico.` },
  cancel: { path: 'cancel', field: 'reason', min: 5, placeholder: 'Motivo do cancelamento (enviado ao síndico)', button: 'Cancelar fatura', title: 'Cancelar fatura',
    success: 'Fatura cancelada e síndico avisado.', message: (a, c, m) => `Cancelar a fatura de ${m} de ${c} (${a})? O Pix é cancelado no Mercado Pago e o síndico/subsíndico é avisado por e-mail com o motivo.` },
  correct: { path: 'correct', field: 'reason', min: 5, placeholder: 'O que estava errado (enviado ao síndico)', button: 'Corrigir e reemitir', title: 'Corrigir e reemitir',
    success: 'Fatura cancelada e uma nova foi emitida com os dados de hoje.', message: (a, c, m) => `Cancelar a fatura de ${m} de ${c} (${a}) e emitir outra recalculada com o plano e os usuários de hoje, com novo Pix e novo vencimento? O síndico recebe os dois avisos.` },
  refund: { path: 'refund', field: 'note', min: 5, placeholder: 'Motivo do estorno (ex.: pago em duplicidade)', button: 'Registrar estorno', title: 'Estornar fatura paga',
    success: 'Estorno registrado. Lembre de reembolsar o valor no painel do Mercado Pago.', message: (a, c, m) => `Registrar o estorno da fatura de ${m} de ${c} (${a})? Isto só REGISTRA no sistema — o reembolso do dinheiro você faz no painel do Mercado Pago.` },
};

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const statusLabels: Record<InvoiceStatus, string> = { pending: 'Pendente', sent: 'Aguardando pagamento', paid: 'Paga', canceled: 'Cancelada', refunded: 'Estornada' };
const statusFilters: Array<{ value: '' | InvoiceStatus; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'sent', label: 'Aguardando' },
  { value: 'paid', label: 'Pagas' },
  { value: 'canceled', label: 'Canceladas' },
  { value: 'refunded', label: 'Estornadas' },
];

export default function PlatformReceipts() {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [invoices, setInvoices] = useState<PlatformInvoice[]>([]);
  const [summary, setSummary] = useState<Summary>({ receivedCents: 0, openCents: 0, overdueCents: 0, canceledCents: 0, refundedCents: 0, count: 0 });
  const [condoOptions, setCondoOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [statusFilter, setStatusFilter] = useState<'' | InvoiceStatus>('');
  const [monthFilter, setMonthFilter] = useState('');
  const [condoFilter, setCondoFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string; mode: PanelMode } | null>(null);
  const [panelNote, setPanelNote] = useState('');
  const [dialog, setDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (/^\d{4}-\d{2}$/.test(monthFilter)) params.set('month', monthFilter);
      if (condoFilter) params.set('condominiumId', condoFilter);
      const response = await apiRequest<{ invoices: PlatformInvoice[]; summary: Summary }>(`/platform-plans/invoices?${params.toString()}`, userToken);
      setInvoices(response.invoices);
      setSummary(response.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar os recebimentos.');
    } finally {
      setIsLoading(false);
    }
  }, [userToken, statusFilter, monthFilter, condoFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userToken) return;
    apiRequest<{ condominiums: Array<{ id: string; name: string }> }>('/condominiums', userToken)
      .then(data => setCondoOptions(data.condominiums.map(item => ({ id: item.id, name: item.name }))))
      .catch(() => setCondoOptions([]));
  }, [userToken]);

  const run = async (invoiceId: string, path: string, body: unknown, success: (result: any) => string) => {
    if (!userToken) return;
    setBusyId(invoiceId);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<any>(`/platform-plans/invoices/${invoiceId}/${path}`, userToken, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      setMessage(success(result));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar a ação.');
    } finally {
      setBusyId('');
    }
  };

  const verifyAll = async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ checked: number; paid: number }>('/platform-plans/invoices/reconcile', userToken, { method: 'POST' });
      setMessage(result.checked === 0 ? 'Nenhuma fatura com Pix pendente para verificar.' : `${result.checked} fatura(s) verificada(s) — ${result.paid} pagamento(s) confirmado(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao verificar pagamentos.');
      setIsLoading(false);
    }
  };

  // Gera as faturas (com Pix) do mês de todos os condomínios com plano e
  // cobrança iniciada — o mesmo que o job diário faz às 9h.
  const generateAll = async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ created: number; skipped: number; failed: number }>('/platform-plans/invoices/generate', userToken, { method: 'POST' });
      setMessage(`${result.created} fatura(s) gerada(s), ${result.skipped} já existiam ou ainda não têm cobrança iniciada${result.failed ? `, ${result.failed} com falha (veja o log da API)` : ''}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar as faturas.');
      setIsLoading(false);
    }
  };

  const verifyOne = (invoice: PlatformInvoice) => run(invoice.id, 'verify', null, (result) =>
    result.paid ? 'Pagamento confirmado no Mercado Pago — fatura marcada como paga e recibo enviado.' : `Ainda não pago (Mercado Pago: ${result.providerStatus || 'sem status'}${result.providerDetail ? ` / ${result.providerDetail}` : ''}).`);

  const openPanel = (invoice: PlatformInvoice, mode: PanelMode) => {
    setError(null);
    setPanel(panel?.id === invoice.id && panel.mode === mode ? null : { id: invoice.id, mode });
    setPanelNote('');
  };

  const confirmPanel = (invoice: PlatformInvoice, mode: PanelMode) => {
    const config = PANEL_MODES[mode];
    const text = panelNote.trim();
    if (text.length < config.min) { setError(`Preencha o campo (mínimo ${config.min} caracteres).`); return; }
    setDialog({
      title: config.title,
      message: config.message(formatCurrency(invoice.amount_cents), invoice.condominium_name, formatBrazilianMonth(invoice.reference_month)),
      confirmLabel: config.button,
      onConfirm: () => {
        setDialog(null);
        setPanel(null);
        setPanelNote('');
        run(invoice.id, config.path, { [config.field]: text }, (result) => {
          const pixWarning = result?.pixCanceled === false ? ' Atenção: não consegui cancelar o Pix no Mercado Pago — cancele-o lá pelo painel.' : '';
          const created = mode === 'correct' && result?.created === false ? ' Mas a nova fatura NÃO foi gerada (já existe fatura aberta do mês ou o condomínio está sem cobrança ativa).' : '';
          return config.success + pixWarning + created;
        });
      },
    });
  };

  const paymentInfo = (invoice: PlatformInvoice) => {
    if (invoice.status !== 'paid') {
      if (invoice.status === 'canceled') return `Cancelada${invoice.cancel_reason ? ` — ${invoice.cancel_reason}` : ''}.`;
      if (invoice.status === 'refunded') return `Estornada${invoice.refund_note ? ` — ${invoice.refund_note}` : ''} (reembolso feito no Mercado Pago).`;
      return invoice.has_pix ? `${invoice.due_date ? `Vence em ${new Date(`${invoice.due_date}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · ` : ''}Pix gerado, aguardando pagamento.` : 'Sem Pix gerado — use "Gerar Pix".';
    }
    const how = invoice.payment_method === 'manual' ? `confirmado manualmente${invoice.manual_note ? ` — ${invoice.manual_note}` : ''}` : 'Pix (Mercado Pago)';
    return `Pago em ${formatDateTime(invoice.paid_at)} · ${how}`;
  };

  const tourSteps: TourStep[] = [
    { key: 'summary', title: 'Resumo', description: 'Recebido soma as faturas pagas; A receber, as pendentes ou aguardando pagamento; Em atraso, as em aberto com vencimento já passado (o vencimento é 10 dias depois da geração); Canceladas, as anuladas — tudo respeitando os filtros abaixo.' },
    { key: 'list', title: 'Faturas e confirmações', description: 'Cada card é uma fatura da plataforma cobrada de um condomínio. "Verificar" consulta agora no Mercado Pago se o Pix foi pago e, se foi, marca como paga e envia o recibo. "Marcar como paga" serve pra pagamento recebido por fora (exige uma observação, que fica registrada). "Reenviar recibo" só existe pra fatura paga. "Cancelar" anula uma fatura em aberto (motivo obrigatório): cancela o Pix no Mercado Pago e avisa o síndico por e-mail. "Corrigir e reemitir" cancela a fatura errada e emite outra recalculada com o plano e os usuários de hoje. "Estornar" registra o estorno de uma fatura paga por engano — o reembolso do dinheiro é feito no painel do Mercado Pago. Se um pagamento chegar em fatura já cancelada, aparece um alerta vermelho no card. "Gerar Pix" / "Gerar novo Pix" cria a cobrança (ou substitui uma expirada) e reenvia a fatura por e-mail ao síndico e subsíndico. No topo, "Gerar faturas do mês" cria a fatura de todos os condomínios com plano e cobrança iniciada, e "Verificar todos" consulta o Mercado Pago pra todas as faturas com Pix pendente — o sistema também faz as duas coisas sozinho todo dia às 9h.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Modelo de negocio</Text>
          <Text style={styles.title}>Recebimentos da plataforma</Text>
          <Text style={styles.subtitle}>Acompanhe o que cada condomínio já pagou, o que está em aberto e confirme pagamentos.</Text>
        </View>
        <Pressable onPress={generateAll} disabled={isLoading} style={[styles.tourButton, isLoading && { opacity: 0.6 }]}><Text style={styles.tourButtonText}>Gerar faturas do mês</Text></Pressable>
        <Pressable onPress={verifyAll} disabled={isLoading} style={[styles.tourButton, isLoading && { opacity: 0.6 }]}><Text style={styles.tourButtonText}>Verificar todos</Text></Pressable>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('summary')} style={[styles.summaryRow, isActive('summary') && styles.tourHighlight]}>
        <View style={[styles.tile, styles.tileGreen]}><Text style={styles.tileLabel}>RECEBIDO</Text><Text style={styles.tileValue}>{formatCurrency(summary.receivedCents)}</Text></View>
        <View style={[styles.tile, styles.tileAmber]}><Text style={styles.tileLabel}>A RECEBER</Text><Text style={styles.tileValue}>{formatCurrency(summary.openCents)}</Text></View>
        <View style={[styles.tile, styles.tileRed]}><Text style={styles.tileLabel}>EM ATRASO</Text><Text style={styles.tileValue}>{formatCurrency(summary.overdueCents)}</Text></View>
        <View style={styles.tile}><Text style={styles.tileLabel}>CANCELADAS</Text><Text style={styles.tileValue}>{formatCurrency(summary.canceledCents)}</Text></View>
      </View>

      <Panel>
        <View style={styles.chipRow}>
          {statusFilters.map(filter => (
            <Pressable key={filter.value || 'all'} onPress={() => setStatusFilter(filter.value)} style={[styles.chip, statusFilter === filter.value && styles.chipActive]}>
              <Text style={[styles.chipText, statusFilter === filter.value && styles.chipTextActive]}>{filter.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.filterRow}>
          <View style={styles.grow}>
            <ComboBox
              options={[{ value: '', label: 'Todos os condomínios' }, ...condoOptions.map(item => ({ value: item.id, label: item.name }))]}
              value={condoFilter}
              onChange={setCondoFilter}
              placeholder="Todos os condomínios"
              title="Condomínio"
              searchPlaceholder="Buscar condomínio"
              emptyText="Nenhum condomínio encontrado."
            />
          </View>
          <TextInput value={monthFilter} onChangeText={(value) => setMonthFilter(value.replace(/[^\d-]/g, '').slice(0, 7))} placeholder="Mês (AAAA-MM)" style={styles.monthInput} />
        </View>
      </Panel>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
        {invoices.length === 0 && !isLoading ? (
          <EmptyState title="Nenhuma fatura encontrada" description="As faturas são geradas quando o síndico ou subsíndico entra no app depois da data de início de cobrança do condomínio." />
        ) : invoices.map(invoice => {
          const open = invoice.status === 'pending' || invoice.status === 'sent';
          const busy = busyId === invoice.id;
          return (
            <View key={invoice.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.grow}>
                  <Text style={styles.cardTitle}>{invoice.condominium_name}</Text>
                  <Text style={styles.cardMeta}>{invoice.plan_name} · {formatBrazilianMonth(invoice.reference_month)} · {invoice.active_users} usuário(s)</Text>
                </View>
                <View style={styles.amountBox}>
                  <Text style={styles.amount}>{formatCurrency(invoice.amount_cents)}</Text>
                  <Text style={[styles.badge, invoice.status === 'paid' && styles.badgePaid, invoice.status === 'canceled' && styles.badgeCanceled, open && styles.badgeOpen, invoice.overdue && styles.badgeCanceled, invoice.status === 'refunded' && styles.badgeCanceled]}>{invoice.overdue ? 'Em atraso' : statusLabels[invoice.status]}</Text>
                </View>
              </View>
              <Text style={styles.cardInfo}>{paymentInfo(invoice)}</Text>
              <Text style={styles.cardInfo}>Recibo: {invoice.receipt_sent_at ? `enviado em ${formatDateTime(invoice.receipt_sent_at)}` : 'não enviado'}</Text>

              <View style={styles.actions}>
                {open && invoice.pix_payment_id ? <Pressable disabled={busy} onPress={() => verifyOne(invoice)} style={styles.action}><Text style={styles.actionText}>{busy ? 'Verificando...' : 'Verificar'}</Text></Pressable> : null}
                {open ? <Pressable disabled={busy} onPress={() => run(invoice.id, 'reissue-pix', null, () => 'Pix gerado e fatura reenviada por e-mail ao síndico/subsíndico.')} style={styles.action}><Text style={styles.actionText}>{invoice.has_pix ? 'Gerar novo Pix' : 'Gerar Pix'}</Text></Pressable> : null}
                {open ? <Pressable disabled={busy} onPress={() => openPanel(invoice, 'markPaid')} style={styles.action}><Text style={styles.actionText}>Marcar como paga</Text></Pressable> : null}
                {invoice.status === 'paid' ? <Pressable disabled={busy} onPress={() => run(invoice.id, 'resend-receipt', null, () => 'Recibo reenviado.')} style={styles.action}><Text style={styles.actionText}>Reenviar recibo</Text></Pressable> : null}
                {open ? <Pressable disabled={busy} onPress={() => openPanel(invoice, 'correct')} style={styles.action}><Text style={styles.actionText}>Corrigir e reemitir</Text></Pressable> : null}
                {open ? <Pressable disabled={busy} onPress={() => openPanel(invoice, 'cancel')} style={styles.action}><Text style={[styles.actionText, { color: colors.red }]}>Cancelar</Text></Pressable> : null}
                {invoice.status === 'paid' ? <Pressable disabled={busy} onPress={() => openPanel(invoice, 'refund')} style={styles.action}><Text style={[styles.actionText, { color: colors.red }]}>Estornar</Text></Pressable> : null}
              </View>

              {invoice.paid_after_canceled_at ? (
                <Text style={styles.alertText}>⚠ Pagamento recebido DEPOIS do cancelamento ({formatDateTime(invoice.paid_after_canceled_at)}) — reembolse o valor no painel do Mercado Pago.</Text>
              ) : null}

              {panel?.id === invoice.id ? (
                <View style={styles.markPaidBox}>
                  <TextInput value={panelNote} onChangeText={setPanelNote} placeholder={PANEL_MODES[panel.mode].placeholder} style={styles.noteInput} />
                  <Pressable onPress={() => confirmPanel(invoice, panel.mode)} style={[styles.confirmButton, (panel.mode === 'cancel' || panel.mode === 'refund') && { backgroundColor: colors.red }]}><Text style={styles.confirmButtonText}>{PANEL_MODES[panel.mode].button}</Text></Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
    <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone="info" confirmLabel={dialog?.confirmLabel} cancelLabel="Voltar" onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, gap: 14, backgroundColor: colors.background },
  grow: { flex: 1, minWidth: 160 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 22, marginTop: 6 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16 },
  tileGreen: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  tileRed: { borderColor: colors.red, backgroundColor: '#fbeaea' },
  tileAmber: { borderColor: '#f0d9a8', backgroundColor: '#fdf7ea' },
  tileLabel: { color: colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  tileValue: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff' },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  chipTextActive: { color: colors.primaryDark },
  filterRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  monthInput: { minHeight: 48, minWidth: 150, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink },
  error: { color: colors.red, fontWeight: '700' },
  success: { color: colors.green, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16, marginBottom: 10, gap: 6 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  cardMeta: { color: colors.muted, marginTop: 2 },
  amountBox: { alignItems: 'flex-end', gap: 4 },
  amount: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  badge: { fontSize: 12, fontWeight: '900', color: colors.muted, backgroundColor: '#f2f4f7', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  badgePaid: { color: colors.green, backgroundColor: colors.softGreen },
  badgeOpen: { color: '#8a5a12', backgroundColor: '#fdf7ea' },
  badgeCanceled: { color: colors.red, backgroundColor: '#fbeaea' },
  cardInfo: { color: colors.muted, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  action: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  actionText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  alertText: { color: colors.red, fontWeight: '800', fontSize: 13, marginTop: 4 },
  markPaidBox: { gap: 8, marginTop: 8 },
  noteInput: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink },
  confirmButton: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  confirmButtonText: { color: '#fff', fontWeight: '900' },
});
