import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { maskBrazilianDate, brazilianDateToIso, formatBrazilianDate, formatBrazilianMonth } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type PlatformPlan = { id: string; name: string; plan_type: 'per_active_user' | 'tiered_bracket'; active: boolean };
type PlatformStatus = 'active' | 'suspended' | 'canceled';
type PlatformInvoiceStatus = 'pending' | 'sent' | 'paid' | 'canceled';

type OverviewItem = {
  condominiumId: string;
  condominiumName: string;
  platformStatus: PlatformStatus;
  activeUsers: number;
  plan: { id: string; name: string; planType: 'per_active_user' | 'tiered_bracket' } | null;
  billingStartsAt: string | null;
  amountCents: number;
  lastInvoice: { referenceMonth: string; amountCents: number; status: PlatformInvoiceStatus; sentAt: string | null } | null;
};

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const invoiceStatusLabels: Record<PlatformInvoiceStatus, string> = { pending: 'pendente', sent: 'enviada', paid: 'paga', canceled: 'cancelada' };

const statusLabels: Record<PlatformStatus, string> = { active: 'Ativo', suspended: 'Suspenso', canceled: 'Cancelado' };
const statusOrder: PlatformStatus[] = ['active', 'suspended', 'canceled'];

export default function PlatformRevenue() {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [totalProjectedCents, setTotalProjectedCents] = useState(0);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState('');
  const [pickerCondominiumId, setPickerCondominiumId] = useState('');
  const [statusPickerCondominiumId, setStatusPickerCondominiumId] = useState('');
  const [billingDateEditingId, setBillingDateEditingId] = useState('');
  const [billingDateDraft, setBillingDateDraft] = useState('');

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const [overview, plansResponse] = await Promise.all([
        apiRequest<{ items: OverviewItem[]; totalProjectedCents: number }>('/platform-plans/overview', userToken),
        apiRequest<{ plans: PlatformPlan[] }>('/platform-plans', userToken),
      ]);
      setItems(overview.items);
      setTotalProjectedCents(overview.totalProjectedCents);
      setPlans(plansResponse.plans.filter((plan) => plan.active));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o faturamento projetado.');
    } finally {
      setIsLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
  }, [load]);

  const assignPlan = async (condominiumId: string, planId: string) => {
    if (!userToken) return;
    setAssigningId(condominiumId);
    setError(null);
    try {
      await apiRequest(`/condominiums/${condominiumId}/plan`, userToken, {
        method: 'PUT',
        body: JSON.stringify({ planId }),
      });
      setPickerCondominiumId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao vincular o plano.');
    } finally {
      setAssigningId('');
    }
  };

  const startEditBillingDate = (item: OverviewItem) => {
    setBillingDateEditingId(item.condominiumId);
    setBillingDateDraft(formatBrazilianDate(item.billingStartsAt));
  };

  const saveBillingDate = async (item: OverviewItem) => {
    if (!userToken || !item.plan) return;
    const iso = brazilianDateToIso(billingDateDraft);
    if (!iso) {
      setError('Informe uma data válida (DD/MM/AAAA) para o início da cobrança.');
      return;
    }
    setAssigningId(item.condominiumId);
    setError(null);
    try {
      await apiRequest(`/condominiums/${item.condominiumId}/plan`, userToken, {
        method: 'PUT',
        body: JSON.stringify({ planId: item.plan.id, billingStartsAt: iso }),
      });
      setBillingDateEditingId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar a data de início de cobrança.');
    } finally {
      setAssigningId('');
    }
  };

  const assignStatus = async (condominiumId: string, status: PlatformStatus) => {
    if (!userToken) return;
    setAssigningId(condominiumId);
    setError(null);
    try {
      await apiRequest(`/condominiums/${condominiumId}/platform-status`, userToken, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setStatusPickerCondominiumId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar a situação do condomínio.');
    } finally {
      setAssigningId('');
    }
  };

  const tourSteps: TourStep[] = [
    { key: 'total', title: 'Total projetado por mês', description: 'Soma o valor mensal projetado de todos os condomínios com status "Ativo" e um plano vinculado, calculado a partir da quantidade atual de usuários ativos de cada um. Condomínios "Suspenso" ou "Cancelado" continuam aparecendo na lista abaixo, mas não entram nesse total.' },
    { key: 'list', title: 'Condomínios e planos vinculados', description: 'Cada linha é um condomínio. Toque na bolinha de status (verde = Ativo, amarelo = Suspenso, vermelho = Cancelado) pra trocar a situação dele na plataforma. Toque no botão de plano à direita pra vincular ou trocar o plano (só fica habilitado quando existe ao menos um plano ativo cadastrado). Com um plano vinculado, "Cobrança a partir de..." deixa ajustar a data de início da cobrança. A última fatura emitida (mês, valor e status) aparece quando existir, e o valor no canto direito de cada linha mostra quanto esse condomínio contribui pro total projetado.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Modelo de negocio</Text>
          <Text style={styles.title}>Faturamento da plataforma</Text>
          <Text style={styles.subtitle}>Veja quanto cada condominio geraria por mes com o plano vinculado, com base nos usuários ativos cadastrados. Condomínios suspensos ou cancelados não entram na projeção.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('total')} style={[isActive('total') && styles.tourHighlight]}>
      <Panel>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL PROJETADO / MES</Text>
          <Text style={styles.totalValue}>{formatCurrency(totalProjectedCents)}</Text>
        </View>
      </Panel>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {plans.length === 0 ? (
        <Text style={styles.hint}>Cadastre ao menos um plano ativo em "Planos da plataforma" para poder vincular aos condominios.</Text>
      ) : null}

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      {items.length === 0 ? (
        <EmptyState title="Nenhum condominio cadastrado" description="Cadastre condominios para ver a projecao de receita aqui." />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <View key={item.condominiumId} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{item.condominiumName}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.activeUsers} usuário{item.activeUsers === 1 ? '' : 's'} ativo{item.activeUsers === 1 ? '' : 's'}
                </Text>

                {statusPickerCondominiumId === item.condominiumId ? (
                  <View style={styles.statusPicker}>
                    {statusOrder.map((status) => (
                      <Pressable
                        key={status}
                        onPress={() => assignStatus(item.condominiumId, status)}
                        disabled={assigningId === item.condominiumId}
                        style={[styles.statusOption, item.platformStatus === status && styles.statusOptionActive]}
                      >
                        <Text style={[styles.statusOptionText, item.platformStatus === status && styles.statusOptionTextActive]}>{statusLabels[status]}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setStatusPickerCondominiumId('')} style={styles.planOptionCancel}>
                      <Text style={styles.planOptionCancelText}>Fechar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setStatusPickerCondominiumId(item.condominiumId)} style={styles.statusBadgeButton}>
                    <View style={[styles.statusDot, item.platformStatus === 'active' && styles.statusDotActive, item.platformStatus === 'suspended' && styles.statusDotSuspended, item.platformStatus === 'canceled' && styles.statusDotCanceled]} />
                    <Text style={styles.statusBadgeText}>{statusLabels[item.platformStatus]}</Text>
                  </Pressable>
                )}

                {item.plan ? (
                  billingDateEditingId === item.condominiumId ? (
                    <View style={styles.billingDateRow}>
                      <TextInput
                        value={billingDateDraft}
                        onChangeText={(value) => setBillingDateDraft(maskBrazilianDate(value))}
                        placeholder="DD/MM/AAAA"
                        keyboardType="number-pad"
                        style={styles.billingDateInput}
                      />
                      <Pressable onPress={() => saveBillingDate(item)} disabled={assigningId === item.condominiumId} style={styles.planOptionCancel}>
                        <Text style={styles.planOptionCancelText}>Salvar</Text>
                      </Pressable>
                      <Pressable onPress={() => setBillingDateEditingId('')} style={styles.planOptionCancel}>
                        <Text style={styles.planOptionCancelText}>Cancelar</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => startEditBillingDate(item)} style={styles.billingDateButton}>
                      <Text style={styles.billingDateText}>Cobrança a partir de {formatBrazilianDate(item.billingStartsAt) || '—'}</Text>
                    </Pressable>
                  )
                ) : null}

                {item.lastInvoice ? (
                  <Text style={styles.lastInvoiceText}>
                    Última fatura: {formatBrazilianMonth(item.lastInvoice.referenceMonth)} — {formatCurrency(item.lastInvoice.amountCents)} — {invoiceStatusLabels[item.lastInvoice.status]}
                  </Text>
                ) : null}
              </View>

              <View style={styles.rowPlan}>
                {pickerCondominiumId === item.condominiumId ? (
                  <View style={styles.planPicker}>
                    {plans.map((plan) => (
                      <Pressable
                        key={plan.id}
                        onPress={() => assignPlan(item.condominiumId, plan.id)}
                        disabled={assigningId === item.condominiumId}
                        style={styles.planOption}
                      >
                        <Text style={styles.planOptionText}>{plan.name}</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setPickerCondominiumId('')} style={styles.planOptionCancel}>
                      <Text style={styles.planOptionCancelText}>Cancelar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setPickerCondominiumId(item.condominiumId)} disabled={plans.length === 0} style={styles.planButton}>
                    <Text style={styles.planButtonText}>{item.plan ? item.plan.name : 'Sem plano vinculado'}</Text>
                    <Text style={styles.planButtonAction}>{item.plan ? 'Alterar' : 'Vincular'}</Text>
                  </Pressable>
                )}
              </View>

              <Text style={styles.rowAmount}>{formatCurrency(item.amountCents)}</Text>
            </View>
          ))}
        </View>
      )}
      </View>
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { color: colors.muted, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  totalValue: { color: colors.primaryDark, fontSize: 26, fontWeight: '900' },
  hint: { color: colors.muted, marginTop: 14, marginBottom: 4, lineHeight: 20 },
  error: { color: colors.red, marginTop: 14 },
  list: { gap: 10, marginTop: 18 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
  },
  rowMain: { flexGrow: 1, minWidth: 180, gap: 6 },
  rowTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  rowSubtitle: { color: colors.muted, marginTop: 2 },
  rowPlan: { minWidth: 200 },
  rowAmount: { color: colors.primaryDark, fontSize: 18, fontWeight: '900', marginLeft: 'auto' },
  statusBadgeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  statusDotActive: { backgroundColor: colors.green },
  statusDotSuspended: { backgroundColor: colors.amber },
  statusDotCanceled: { backgroundColor: colors.red },
  statusBadgeText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  billingDateButton: { alignSelf: 'flex-start', marginTop: 4 },
  billingDateText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  billingDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  billingDateInput: { minHeight: 38, minWidth: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff', color: colors.ink },
  lastInvoiceText: { color: colors.muted, fontSize: 13, marginTop: 4 },
  statusPicker: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  statusOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' },
  statusOptionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  statusOptionText: { color: colors.ink, fontWeight: '700', fontSize: 13 },
  statusOptionTextActive: { color: colors.primaryDark },
  planButton: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff' },
  planButtonText: { color: colors.ink, fontWeight: '800' },
  planButtonAction: { color: colors.primary, fontWeight: '900', marginLeft: 'auto' },
  planPicker: { gap: 6, minWidth: 220 },
  planOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  planOptionText: { color: colors.ink, fontWeight: '700' },
  planOptionCancel: { paddingVertical: 6, alignItems: 'flex-start' },
  planOptionCancelText: { color: colors.muted, fontWeight: '800' },
});
