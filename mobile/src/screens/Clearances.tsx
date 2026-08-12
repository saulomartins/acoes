import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { apiRequest, downloadAuthenticated } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors, layout } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { formatBrazilianDate } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type DebtItem = { source: string; label: string; referenceMonth?: string; dueDate?: string; amountCents?: number };
type Check = { eligible: boolean; blockers: DebtItem[]; pendings: DebtItem[]; checkedAt: string };
type ClearanceRequest = {
  id: string; status: 'pending' | 'issued' | 'refused';
  requester_name: string; unit_label: string | null; created_at: string;
  issued_at: string | null; issuer_name: string | null; verification_code: string | null;
  refusal_reason: string | null; debt_snapshot: Check | null; requested_by: string;
};

const money = (cents?: number) => cents === undefined ? '' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabel: Record<ClearanceRequest['status'], string> = { pending: 'Aguardando emissão', issued: 'Emitida', refused: 'Recusada' };
const statusColor: Record<ClearanceRequest['status'], string> = { pending: colors.amber, issued: colors.green, refused: colors.red };

export default function Clearances() {
  const { isMobile: compact } = useBreakpoint();
  const { user, userToken } = useContext(AuthContext);
  const manager = user?.role === 'sindico' || user?.role === 'subsindico';
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [requests, setRequests] = useState<ClearanceRequest[]>([]);
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ visible: false, title: '', message: '', tone: 'info' as 'info' | 'success' | 'error' });
  const show = (title: string, message: string, tone: 'info' | 'success' | 'error' = 'info') => setDialog({ visible: true, title, message, tone });

  const load = useCallback(async (silent = false) => {
    if (!userToken) return;
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest<{ requests: ClearanceRequest[] }>('/clearances', userToken);
      setRequests(data.requests);
      if (!manager) {
        const preview = await apiRequest<{ check: Check }>('/clearances/check', userToken);
        setCheck(preview.check);
      }
    } catch (e) {
      if (!silent) show('Não foi possível carregar', e instanceof Error ? e.message : 'Tente novamente.', 'error');
    } finally { setLoading(false); }
  }, [userToken, manager]);
  useEffect(() => { load(); }, [load]);

  const request = async () => {
    if (!userToken) return;
    setBusy('request');
    try {
      const data = await apiRequest<{ request: ClearanceRequest; check: Check }>('/clearances', userToken, { method: 'POST', body: '{}' });
      await load(true);
      if (data.request.status === 'refused') show('Pendências encontradas', data.request.refusal_reason || 'Há débitos em aberto no seu nome.', 'error');
      else show('Solicitação enviada', 'O síndico foi avisado e vai emitir sua declaração de quitação.', 'success');
    } catch (e) { show('Não foi possível solicitar', e instanceof Error ? e.message : 'Tente novamente.', 'error'); }
    finally { setBusy(null); }
  };

  const issue = async (item: ClearanceRequest) => {
    if (!userToken) return;
    setBusy(item.id);
    try {
      await apiRequest(`/clearances/${item.id}/issue`, userToken, { method: 'POST' });
      await load(true);
      show('Declaração emitida', `O documento de ${item.requester_name} já está disponível para download, com código verificador.`, 'success');
    } catch (e) { show('Não foi possível emitir', e instanceof Error ? e.message : 'Tente novamente.', 'error'); }
    finally { setBusy(null); }
  };

  const downloadDocument = async (item: ClearanceRequest) => {
    if (!userToken) return;
    setBusy(item.id);
    try { await downloadAuthenticated(`/clearances/${item.id}/document`, userToken, `nada-consta-${item.verification_code}.pdf`, { awaitCompletion: true }); }
    catch (e) { show('Não foi possível baixar', e instanceof Error ? e.message : 'Tente novamente.', 'error'); }
    finally { setBusy(null); }
  };

  const managerTourSteps: TourStep[] = [
    { key: 'list', title: 'Solicitações de nada consta', description: 'Cada pedido mostra quem solicitou, a unidade e o que o sistema encontrou de débito no momento da solicitação. Pedidos com pendência já chegam recusados automaticamente — você não precisa responder um por um.' },
    { key: 'list', title: 'Emitir a declaração', description: 'Ao tocar em "Emitir", o sistema confere os débitos de novo (pode ter surgido algo entre o pedido e agora) e só então gera o documento com o seu nome, CPF e cargo. Se apareceu qualquer valor em aberto no meio do caminho, a emissão é bloqueada na hora.' },
    { key: 'list', title: 'Código verificador', description: 'Todo documento emitido sai com um código único e um resumo (hash) do conteúdo. Qualquer pessoa — banco, imobiliária, cartório — confere a autenticidade numa página pública, sem precisar de login, informando esse código.' },
  ];
  const residentTourSteps: TourStep[] = [
    { key: 'status', title: 'Sua situação', description: 'Antes de solicitar, o app já mostra o que o sistema enxerga no seu nome. Qualquer valor em aberto impede a emissão — boleto vencido ou ainda a vencer, débito antigo, acordo rompido e cobrança adicional não paga. A declaração afirma quitação total, então só sai com tudo zerado.' },
    { key: 'status', title: 'Solicitar a declaração', description: 'Se estiver tudo em dia, o pedido vai direto pro síndico ou subsíndico emitir. Se houver pendência, o pedido é recusado na hora e o app mostra exatamente o que está em aberto.' },
    { key: 'list', title: 'Seus pedidos', description: 'Acompanhe aqui o andamento. Quando a declaração for emitida, o botão de download libera o PDF com o código verificador — é o documento que você entrega ao banco ou à imobiliária.' },
  ];
  const tourSteps = manager ? managerTourSteps : residentTourSteps;

  const renderDebtList = (items: DebtItem[], tone: 'blocker' | 'pending') => items.map((item, index) => (
    <Text key={`${item.label}-${index}`} style={tone === 'blocker' ? s.blockerItem : s.pendingItem}>
      • {item.label}{item.referenceMonth ? ` · ${item.referenceMonth}` : ''}{item.amountCents !== undefined ? ` · ${money(item.amountCents)}` : ''}
    </Text>
  ));

  return <>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />}>
      <View style={s.headerRow}>
        <View style={s.grow}>
          <Text style={s.eyebrow}>QUITAÇÃO</Text>
          <Text style={s.title}>Nada consta</Text>
          <Text style={s.subtitle}>{manager ? 'Analise os pedidos e emita a declaração de quitação condominial.' : 'Solicite a declaração de que sua unidade está em dia com o condomínio.'}</Text>
        </View>
        <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      {!manager ? (
        <View ref={registerSection('status')} style={[isActive('status') && s.tourHighlight]}>
          <Panel>
            <Text style={s.panelTitle}>Sua situação</Text>
            {!check ? <ActivityIndicator color={colors.primary} /> : (
              <>
                <View style={[s.statusBadge, check.eligible ? s.statusBadgeOk : s.statusBadgeBlocked]}>
                  <Text style={[s.statusBadgeText, { color: check.eligible ? colors.green : colors.red }]}>
                    {check.eligible ? '✓ Nada em aberto' : '! Há pendências em aberto'}
                  </Text>
                </View>
                {check.blockers.length > 0 ? <View style={s.debtBox}><Text style={s.debtTitle}>Impede a emissão</Text>{renderDebtList(check.blockers, 'blocker')}</View> : null}
                {check.pendings.length > 0 ? <View style={s.debtBox}><Text style={s.debtTitleMuted}>Informativo (não impede)</Text>{renderDebtList(check.pendings, 'pending')}</View> : null}
                <View style={s.action}>
                  <AppButton title="Solicitar nada consta" loading={busy === 'request'} disabled={!check.eligible} onPress={request} />
                </View>
              </>
            )}
          </Panel>
        </View>
      ) : null}

      <View ref={registerSection('list')} style={[isActive('list') && s.tourHighlight]}>
        <Text style={s.section}>{manager ? 'Solicitações' : 'Meus pedidos'}</Text>
        {loading ? <ActivityIndicator size="large" color={colors.primary} /> : requests.length === 0 ? (
          <EmptyState title="Nenhuma solicitação" description={manager ? 'Os pedidos dos moradores aparecerão aqui.' : 'Você ainda não solicitou uma declaração de quitação.'} />
        ) : requests.map(item => (
          <View key={item.id} style={s.card}>
            <View style={s.cardTop}>
              <View style={s.grow}>
                <Text style={s.cardName}>{item.requester_name}{item.unit_label ? ` · ${item.unit_label}` : ''}</Text>
                <Text style={s.cardMeta}>Solicitado em {formatBrazilianDate(item.created_at)}</Text>
              </View>
              <Text style={[s.badge, { color: statusColor[item.status], borderColor: statusColor[item.status] }]}>{statusLabel[item.status]}</Text>
            </View>

            {item.status === 'refused' && item.refusal_reason ? <Text style={s.refusal}>{item.refusal_reason}</Text> : null}
            {item.status === 'issued' ? (
              <Text style={s.issued}>Emitida por {item.issuer_name} em {item.issued_at ? formatBrazilianDate(item.issued_at) : '—'} · código {item.verification_code}</Text>
            ) : null}
            {manager && item.status === 'pending' && item.debt_snapshot?.pendings?.length ? (
              <View style={s.debtBox}><Text style={s.debtTitleMuted}>Informativo (não impede)</Text>{renderDebtList(item.debt_snapshot.pendings, 'pending')}</View>
            ) : null}

            <View style={s.cardActions}>
              {manager && item.status === 'pending' ? <AppButton title="Emitir declaração" loading={busy === item.id} onPress={() => issue(item)} /> : null}
              {item.status === 'issued' ? <AppButton title="Baixar PDF" variant="secondary" loading={busy === item.id} onPress={() => downloadDocument(item)} /> : null}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
    <AppDialog {...dialog} onClose={() => setDialog(d => ({ ...d, visible: false }))} />
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
  </>;
}

const s = StyleSheet.create({
  container: { width: '100%', maxWidth: 950, alignSelf: 'center', padding: 24, paddingBottom: 50, backgroundColor: colors.background, gap: 16 },
  containerMobile: { padding: 16 },
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 15.5, lineHeight: 21, marginTop: 5 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginBottom: 10 },
  statusBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusBadgeOk: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  statusBadgeBlocked: { borderColor: '#efb4b4', backgroundColor: '#fff0f0' },
  statusBadgeText: { fontWeight: '900', fontSize: 13 },
  debtBox: { marginTop: 12, gap: 3 },
  debtTitle: { color: colors.red, fontWeight: '900', fontSize: 13 },
  debtTitleMuted: { color: colors.muted, fontWeight: '900', fontSize: 12.5 },
  blockerItem: { color: colors.red, fontSize: 13, lineHeight: 19 },
  pendingItem: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  action: { alignSelf: 'flex-end', minWidth: 220, marginTop: 16 },
  section: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 16, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardName: { color: colors.ink, fontSize: 15.5, fontWeight: '900' },
  cardMeta: { color: colors.muted, fontSize: 12.5, marginTop: 3 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11.5, fontWeight: '900' },
  refusal: { color: colors.red, fontSize: 13, lineHeight: 19, marginTop: 10, backgroundColor: '#fff0f0', borderRadius: 8, padding: 10 },
  issued: { color: colors.green, fontSize: 13, fontWeight: '700', marginTop: 10 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 14 },
});
