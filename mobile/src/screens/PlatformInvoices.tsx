import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from '../ui/text';
import { apiRequest, downloadAuthenticated } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState } from '../ui/components';
import { colors } from '../ui/theme';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

// "Minhas faturas": histórico das faturas da plataforma (assinatura do Lar em
// Dia) do condomínio do síndico/subsíndico, com o recibo em PDF das pagas. O
// cartão do Início continua mostrando só a fatura da vez; aqui fica tudo.
// Tela só da versão web, como as demais de gestão (routeRoles.ts).

type InvoiceStatus = 'pending' | 'sent' | 'paid' | 'canceled' | 'refunded';

type Invoice = {
  id: string;
  reference_month: string;
  amount_cents: number;
  active_users: number;
  plan_name: string;
  status: InvoiceStatus;
  due_date: string | null;
  overdue: boolean;
  paid_at: string | null;
  payment_method: 'pix_mercadopago' | 'manual' | null;
  receipt_sent_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  refunded_at: string | null;
  pix_copy_paste: string | null;
};

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMonth = (value: string) => {
  const label = new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const formatDay = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const formatDateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const isOpen = (invoice: Invoice) => invoice.status === 'pending' || invoice.status === 'sent';
const statusLabel = (invoice: Invoice) => {
  if (isOpen(invoice)) return invoice.overdue ? 'Em atraso' : 'Aguardando pagamento';
  return { paid: 'Paga', canceled: 'Cancelada', refunded: 'Estornada' }[invoice.status as 'paid' | 'canceled' | 'refunded'];
};

const detailLine = (invoice: Invoice) => {
  if (invoice.status === 'paid' && invoice.paid_at) {
    return `Pago em ${formatDateTime(invoice.paid_at)} · ${invoice.payment_method === 'manual' ? 'confirmado pela administração' : 'Pix'}`;
  }
  if (invoice.status === 'canceled') {
    return `Cancelada${invoice.canceled_at ? ` em ${formatDateTime(invoice.canceled_at)}` : ''}${invoice.cancel_reason ? ` — ${invoice.cancel_reason}` : ''}. Não é preciso pagar.`;
  }
  if (invoice.status === 'refunded') {
    return `Estornada${invoice.refunded_at ? ` em ${formatDateTime(invoice.refunded_at)}` : ''} — o valor foi devolvido e o recibo deixou de valer.`;
  }
  return invoice.due_date ? `${invoice.overdue ? 'Venceu' : 'Vence'} em ${formatDay(invoice.due_date)}` : 'Aguardando pagamento';
};

export default function PlatformInvoices() {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [restriction, setRestriction] = useState<{ restricted: boolean; suspendsOn: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ invoices: Invoice[]; restriction?: { restricted: boolean; suspendsOn: string } | null }>('/condominiums/platform-invoices', userToken);
      setInvoices(response.invoices);
      setRestriction(response.restriction || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar as faturas.');
    } finally {
      setIsLoading(false);
      setLoaded(true);
    }
  }, [userToken]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const yearAgo = Date.now() - 365 * 86400000;
    return {
      openCents: invoices.filter(isOpen).reduce((sum, item) => sum + item.amount_cents, 0),
      overdueCount: invoices.filter(item => isOpen(item) && item.overdue).length,
      paidYearCents: invoices.filter(item => item.status === 'paid' && item.paid_at && new Date(item.paid_at).getTime() >= yearAgo).reduce((sum, item) => sum + item.amount_cents, 0),
    };
  }, [invoices]);

  const downloadReceipt = async (invoice: Invoice) => {
    if (!userToken) return;
    setBusyId(invoice.id);
    setError(null);
    try {
      await downloadAuthenticated(`/condominiums/platform-invoices/${invoice.id}/receipt`, userToken, `recibo-lar-em-dia-${invoice.reference_month.slice(0, 7)}.pdf`, { awaitCompletion: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível baixar o recibo.');
    } finally {
      setBusyId('');
    }
  };

  const copyPix = async (invoice: Invoice) => {
    if (!invoice.pix_copy_paste) return;
    try {
      await Clipboard.setStringAsync(invoice.pix_copy_paste);
      setCopiedId(invoice.id);
      setTimeout(() => setCopiedId(''), 3000);
    } catch {
      setError('Não foi possível copiar — selecione o código no cartão da fatura, na tela Início.');
    }
  };

  // Mesmo "Já paguei — verificar" do Início: consulta o Mercado Pago agora.
  const verifyPayment = async () => {
    if (!userToken) return;
    setVerifying(true);
    setError(null);
    setMessage(null);
    try {
      const response = await apiRequest<{ paid: number }>('/condominiums/platform-invoice/verify', userToken, { method: 'POST' });
      setMessage(response.paid > 0 ? 'Pagamento confirmado! O recibo já está disponível abaixo.' : 'Ainda não identificamos o pagamento. O Pix pode levar alguns instantes — tente de novo em um minuto.');
      await load();
    } catch {
      setError('Não foi possível verificar agora. Tente novamente em instantes.');
    } finally {
      setVerifying(false);
    }
  };

  const tourSteps: TourStep[] = [
    { key: 'summary', title: 'Resumo', description: 'Em aberto soma as faturas ainda não pagas (em vermelho se alguma venceu). Pago em 12 meses soma o que o condomínio pagou pela assinatura da plataforma no último ano — útil na prestação de contas. Com fatura em atraso, um aviso logo abaixo mostra a data em que a gestão fica somente leitura e os moradores perdem o acesso ao aplicativo (30 dias de atraso); se já chegou lá, o aviso fica vermelho. Pagar libera tudo automaticamente.' },
    { key: 'list', title: 'Faturas e recibos', description: 'Todas as faturas da assinatura do Lar em Dia, da mais recente para a mais antiga. Nas pagas, "Baixar recibo (PDF)" gera o recibo a qualquer momento, para anexar na prestação de contas — o mesmo que chega por e-mail quando o pagamento é confirmado. Nas em aberto, copie o Pix ou, se já pagou, use "Já paguei — verificar pagamento". Canceladas não precisam ser pagas; estornadas tiveram o valor devolvido.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Assinatura da plataforma</Text>
          <Text style={styles.title}>Minhas faturas</Text>
          <Text style={styles.subtitle}>Histórico das faturas do Lar em Dia do seu condomínio, com o recibo de cada pagamento.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('summary')} style={[styles.summaryRow, isActive('summary') && styles.tourHighlight]}>
        <View style={[styles.tile, totals.overdueCount ? styles.tileRed : styles.tileAmber]}>
          <Text style={styles.tileLabel}>EM ABERTO</Text>
          <Text style={styles.tileValue}>{formatCurrency(totals.openCents)}</Text>
          {totals.overdueCount ? <Text style={styles.tileHint}>{totals.overdueCount} fatura{totals.overdueCount === 1 ? '' : 's'} em atraso</Text> : null}
        </View>
        <View style={[styles.tile, styles.tileGreen]}>
          <Text style={styles.tileLabel}>PAGO EM 12 MESES</Text>
          <Text style={styles.tileValue}>{formatCurrency(totals.paidYearCents)}</Text>
        </View>
      </View>

      {restriction?.restricted ? (
        <View style={styles.restrictionBanner}>
          <Text style={styles.restrictionTitle}>Gestão em modo somente leitura desde {formatDay(restriction.suspendsOn)}</Text>
          <Text style={styles.restrictionText}>A fatura em aberto mais antiga passou de 30 dias de atraso. Você continua vendo tudo, mas não consegue fazer alterações, e os moradores estão sem acesso ao aplicativo até o pagamento. Tudo volta automaticamente assim que o pagamento é confirmado.</Text>
        </View>
      ) : restriction && totals.overdueCount ? (
        <View style={styles.warningBanner}>
          <Text style={styles.restrictionText}>Se a fatura em atraso não for paga, a partir de <Text style={{ fontWeight: '900' }}>{formatDay(restriction.suspendsOn)}</Text> a gestão do condomínio fica em modo somente leitura e os moradores ficam sem acesso ao aplicativo.</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
        {invoices.length === 0 && loaded && !error ? (
          <EmptyState title="Nenhuma fatura ainda" description="As faturas da plataforma aparecem aqui a partir do primeiro mês de cobrança do condomínio." />
        ) : invoices.map(invoice => {
          const open = isOpen(invoice);
          const busy = busyId === invoice.id;
          return (
            <View key={invoice.id} style={[styles.card, open && invoice.overdue && styles.cardOverdue]}>
              <View style={styles.cardTop}>
                <View style={styles.grow}>
                  <Text style={styles.cardTitle}>{formatMonth(invoice.reference_month)}</Text>
                  <Text style={styles.cardMeta}>Plano {invoice.plan_name} · {invoice.active_users} usuário{invoice.active_users === 1 ? '' : 's'} ativo{invoice.active_users === 1 ? '' : 's'}</Text>
                </View>
                <View style={styles.amountBox}>
                  <Text style={[styles.amount, (invoice.status === 'canceled' || invoice.status === 'refunded') && styles.amountStruck]}>{formatCurrency(invoice.amount_cents)}</Text>
                  <Text style={[styles.badge, invoice.status === 'paid' && styles.badgePaid, open && styles.badgeOpen, (invoice.overdue && open) && styles.badgeRed, invoice.status === 'refunded' && styles.badgeRed]}>{statusLabel(invoice)}</Text>
                </View>
              </View>
              <Text style={styles.cardInfo}>{detailLine(invoice)}</Text>

              <View style={styles.actions}>
                {invoice.status === 'paid' ? (
                  <Pressable disabled={busy} onPress={() => downloadReceipt(invoice)} style={[styles.actionPrimary, busy && { opacity: 0.6 }]}>
                    <Text style={styles.actionPrimaryText}>{busy ? 'Gerando recibo...' : 'Baixar recibo (PDF)'}</Text>
                  </Pressable>
                ) : null}
                {open && invoice.pix_copy_paste ? (
                  <Pressable onPress={() => copyPix(invoice)} style={styles.action}><Text style={styles.actionText}>{copiedId === invoice.id ? 'Código copiado ✓' : 'Copiar código Pix'}</Text></Pressable>
                ) : null}
                {open && invoice.pix_copy_paste ? (
                  <Pressable disabled={verifying} onPress={verifyPayment} style={[styles.action, verifying && { opacity: 0.6 }]}><Text style={styles.actionText}>{verifying ? 'Verificando...' : 'Já paguei — verificar pagamento'}</Text></Pressable>
                ) : null}
              </View>
              {open && !invoice.pix_copy_paste ? <Text style={styles.cardInfo}>O código Pix desta fatura ainda está sendo gerado — a administração da plataforma enviará por e-mail.</Text> : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
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
  tileHint: { color: colors.red, fontWeight: '800', fontSize: 13, marginTop: 4 },
  restrictionBanner: { borderWidth: 1, borderColor: colors.red, backgroundColor: '#fbeaea', borderRadius: 10, padding: 16, gap: 6 },
  warningBanner: { borderWidth: 1, borderColor: '#f0d9a8', backgroundColor: '#fdf7ea', borderRadius: 10, padding: 16 },
  restrictionTitle: { color: colors.red, fontWeight: '900', fontSize: 16 },
  restrictionText: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  error: { color: colors.red, fontWeight: '700' },
  success: { color: colors.green, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16, marginBottom: 10, gap: 6 },
  cardOverdue: { borderColor: colors.red },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  cardMeta: { color: colors.muted, marginTop: 2 },
  amountBox: { alignItems: 'flex-end', gap: 4 },
  amount: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  amountStruck: { color: colors.muted, textDecorationLine: 'line-through' },
  badge: { fontSize: 12, fontWeight: '900', color: colors.muted, backgroundColor: '#f2f4f7', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  badgePaid: { color: colors.green, backgroundColor: colors.softGreen },
  badgeOpen: { color: '#8a5a12', backgroundColor: '#fdf7ea' },
  badgeRed: { color: colors.red, backgroundColor: '#fbeaea' },
  cardInfo: { color: colors.muted, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  action: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  actionText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  actionPrimary: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.primary },
  actionPrimaryText: { color: '#fff', fontWeight: '900', fontSize: 13 },
});
