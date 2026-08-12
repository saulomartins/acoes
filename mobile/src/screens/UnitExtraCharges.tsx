import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest, downloadAuthenticated } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState } from '../ui/components';
import { colors } from '../ui/theme';
import { FormGrid, CardGrid } from '../ui/grid';
import { brazilianMonthToIso, formatBrazilianMonth, maskBrazilianMonth } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Unit = { id: string; number: string; block_name: string | null };
type PersonBillingInfo = { unit_id: string | null; billing_exempt: boolean };
// A parcela é somada ao boleto do mês, então o pagamento dela é o pagamento
// do próprio boleto — `paymentState` vem do invoice vinculado (invoice_id).
type PaymentState = 'paid' | 'open' | 'overdue' | 'awaiting_issue' | 'invoice_canceled' | 'canceled';
type Installment = {
  id: string; installment_number: number; amount_cents: number; reference_month: string;
  status: 'pending' | 'applied' | 'canceled'; paymentState: PaymentState;
  invoice_due_date: string | null; invoice_paid_at: string | null;
};
type ChargePayment = {
  paidCount: number; billableCount: number; paidCents: number; billableCents: number;
  overdueCount: number; openCount: number; awaitingIssueCount: number;
};
type UnitCharge = {
  id: string; unit_id: string; unit_label: string; status: 'active' | 'finished' | 'canceled';
  total_amount_cents: number; installment_count: number; first_reference_month: string;
  installments: Installment[]; payment: ChargePayment;
};
type Group = { description: string; lastActivityAt: string; charges: UnitCharge[] };

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const maskCurrency = (value: string) => formatCurrency(Number(value.replace(/\D/g, '') || 0));
const currencyToCents = (value: string) => {
  const amount = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; };
const addMonthsToIsoMonth = (isoMonth: string, months: number) => {
  const [year, month] = isoMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
const unitLabel = (unit: Unit) => (unit.block_name ? `${unit.block_name} - ${unit.number}` : unit.number);
const chargePeriod = (charge: { total_amount_cents: number; installment_count: number; first_reference_month: string }) => {
  const firstMonth = charge.first_reference_month.slice(0, 7);
  const lastMonth = formatBrazilianMonth(addMonthsToIsoMonth(firstMonth, charge.installment_count - 1));
  return `${formatCurrency(charge.total_amount_cents)} em ${charge.installment_count}x${charge.installment_count > 1 ? `, ${formatBrazilianMonth(firstMonth)} até ${lastMonth}` : `, ${formatBrazilianMonth(firstMonth)}`}`;
};

const chargeStatusLabel: Record<UnitCharge['status'], string> = { active: 'Em andamento', finished: 'Concluída', canceled: 'Cancelada' };
const chargeStatusColor: Record<UnitCharge['status'], string> = { active: colors.primary, finished: colors.green, canceled: colors.muted };
const paymentLabel: Record<PaymentState, string> = {
  paid: 'Paga', open: 'Em aberto', overdue: 'Vencida',
  awaiting_issue: 'Aguardando emissão', invoice_canceled: 'Boleto cancelado', canceled: 'Cancelada',
};
const paymentColor: Record<PaymentState, string> = {
  paid: colors.green, open: colors.primary, overdue: colors.red,
  awaiting_issue: colors.amber, invoice_canceled: colors.muted, canceled: colors.muted,
};
// Total recebido x total a receber do grupo inteiro (todas as unidades),
// ignorando parcelas canceladas.
const groupPayment = (group: Group) => group.charges.reduce((totals, charge) => ({
  paidCount: totals.paidCount + charge.payment.paidCount,
  billableCount: totals.billableCount + charge.payment.billableCount,
  paidCents: totals.paidCents + charge.payment.paidCents,
  billableCents: totals.billableCents + charge.payment.billableCents,
  overdueCount: totals.overdueCount + charge.payment.overdueCount,
}), { paidCount: 0, billableCount: 0, paidCents: 0, billableCents: 0, overdueCount: 0 });
const groupStatus = (group: Group): UnitCharge['status'] => {
  if (group.charges.every((charge) => charge.status === 'finished')) return 'finished';
  if (group.charges.every((charge) => charge.status === 'canceled')) return 'canceled';
  return 'active';
};
// Se todas as unidades do grupo têm o mesmo valor/parcelas/mês, mostra um
// resumo único no card; senão, cada unidade tem seu próprio resumo no popup.
const groupIsUniform = (group: Group) => {
  const [first, ...rest] = group.charges;
  if (!first) return true;
  return rest.every((charge) => charge.total_amount_cents === first.total_amount_cents && charge.installment_count === first.installment_count && charge.first_reference_month === first.first_reference_month);
};

export default function UnitExtraCharges({ navigation }: any) {
  const { userToken } = useContext(AuthContext);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [installmentCount, setInstallmentCount] = useState('1');
  const [firstMonth, setFirstMonth] = useState(formatBrazilianMonth(currentMonth()));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void } | null>(null);
  const [managingDescription, setManagingDescription] = useState<string | null>(null);
  const [addUnitIds, setAddUnitIds] = useState<string[]>([]);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const tourSteps: TourStep[] = [
    { key: 'list', title: 'Cobranças cadastradas', description: 'Cada card agrupa todas as cobranças que têm a mesma descrição — por exemplo, todas as unidades com "Tag de portaria" aparecem juntas em um card só. O status (Em andamento, Concluída ou Cancelada) reflete o conjunto: se todas as unidades do grupo já terminaram as parcelas, o card fica "Concluída". Toque no card pra abrir o detalhe por unidade, adicionar mais unidades ao mesmo grupo ou remover uma unidade específica.' },
    { key: 'form', title: 'Nova cobrança adicional', description: 'Escolha uma ou mais unidades (ou "Todas as unidades" pra lançar em todo o condomínio) — unidades com morador isento de boleto não aparecem na lista. Informe a descrição (ela some à observação do boleto e agrupa cobranças iguais no mesmo card), o valor total, quantas parcelas mensais (1 a 60, dividindo o valor entre elas) e o mês da 1ª parcela. A cobrança entra somada à taxa condominial nos boletos das unidades escolhidas, a partir do mês informado até o fim das parcelas.' },
  ];

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true); setError(null);
    try {
      const [unitsResponse, usersResponse, groupsResponse] = await Promise.all([
        apiRequest<{ units: Unit[] }>('/units', userToken),
        apiRequest<{ users: PersonBillingInfo[] }>('/users', userToken),
        apiRequest<{ groups: Group[] }>('/unit-extra-charges', userToken),
      ]);
      const exemptUnitIds = new Set(usersResponse.users.filter((person) => person.billing_exempt && person.unit_id).map((person) => person.unit_id as string));
      setUnits(unitsResponse.units.filter((unit) => !exemptUnitIds.has(unit.id)));
      setGroups(groupsResponse.groups);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar cobranças adicionais'); }
    finally { setIsLoading(false); }
  }, [userToken]);

  useEffect(() => { load(); }, [load]);

  const managingGroup = useMemo(() => groups.find((group) => group.description === managingDescription) || null, [groups, managingDescription]);

  const allUnitsSelected = units.length > 0 && selectedUnitIds.length === units.length;
  const toggleAllUnits = () => setSelectedUnitIds(allUnitsSelected ? [] : units.map((unit) => unit.id));
  const toggleUnit = (unitId: string) => setSelectedUnitIds((current) => current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId]);

  const firstReferenceMonthIso = brazilianMonthToIso(firstMonth);
  const installmentCountNumber = Number(installmentCount) || 0;
  const lastReferenceMonthLabel = firstReferenceMonthIso && installmentCountNumber >= 1
    ? formatBrazilianMonth(addMonthsToIsoMonth(firstReferenceMonthIso, installmentCountNumber - 1))
    : null;

  const create = async () => {
    const totalAmountCents = currencyToCents(totalAmount);
    const count = Number(installmentCount);
    const firstReferenceMonth = brazilianMonthToIso(firstMonth);
    if (!userToken || !selectedUnitIds.length || !description.trim() || totalAmountCents <= 0 || !Number.isInteger(count) || count < 1 || count > 60 || !firstReferenceMonth) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      await apiRequest('/unit-extra-charges', userToken, { method: 'POST', body: JSON.stringify({ unitIds: selectedUnitIds, description: description.trim(), totalAmountCents, installmentCount: count, firstReferenceMonth }) });
      setDescription(''); setTotalAmount(''); setInstallmentCount('1'); setSuccess(`Cobrança adicional cadastrada para ${selectedUnitIds.length} unidade(s).`); setSelectedUnitIds([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao cadastrar cobrança adicional'); }
    finally { setIsLoading(false); }
  };

  const removeUnitCharge = async (charge: UnitCharge) => {
    if (!userToken) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      const response = await apiRequest<{ message: string }>(`/unit-extra-charges/${charge.id}`, userToken, { method: 'DELETE' });
      setSuccess(response.message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover unidade da cobrança'); }
    finally { setIsLoading(false); }
  };

  const confirmRemoveUnitCharge = (charge: UnitCharge) => {
    setDialog({
      title: 'Remover unidade da cobrança',
      message: `Remover ${charge.unit_label} desta cobrança? Se ainda não houve nenhuma parcela cobrada em boleto, o registro é apagado; se já houve, as parcelas pendentes são canceladas e o histórico é mantido.`,
      confirmLabel: 'Remover',
      cancelLabel: 'Voltar',
      onConfirm: () => { setDialog(null); removeUnitCharge(charge); },
    });
  };

  const addUnitsToGroup = async () => {
    if (!userToken || !managingGroup || !addUnitIds.length) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      const response = await apiRequest<{ message: string }>('/unit-extra-charges/add-units', userToken, { method: 'POST', body: JSON.stringify({ description: managingGroup.description, unitIds: addUnitIds }) });
      setSuccess(response.message); setAddUnitIds([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao adicionar unidades'); }
    finally { setIsLoading(false); }
  };

  const openManageGroup = (group: Group) => { setManagingDescription(group.description); setAddUnitIds([]); setError(null); setSuccess(null); };
  const [exporting, setExporting] = useState(false);
  const exportPayments = async (description?: string) => {
    if (!userToken) return;
    setExporting(true); setError(null);
    try {
      const path = description ? `/unit-extra-charges/export?description=${encodeURIComponent(description)}` : '/unit-extra-charges/export';
      await downloadAuthenticated(path, userToken, `cobrancas-adicionais-${description ? 'grupo' : 'todas'}.xlsx`, { awaitCompletion: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível exportar a planilha.');
    } finally { setExporting(false); }
  };
  const availableUnitsForGroup = useMemo(() => {
    if (!managingGroup) return [];
    const includedIds = new Set(managingGroup.charges.map((charge) => charge.unit_id));
    return units.filter((unit) => !includedIds.has(unit.id));
  }, [managingGroup, units]);

  return <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Configuração de cobranças</Text>
          <Text style={styles.title}>Cobranças adicionais</Text>
          <Text style={styles.subtitle}>Lance valores extras por unidade (ex.: tag de portaria) que são somados à taxa condominial nos boletos, avulsos ou parcelados, até o fim da cobrança.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Cobranças cadastradas</Text>
        <View style={styles.sectionHeaderRight}>
          {groups.length > 0 ? <Pressable onPress={() => exportPayments()} disabled={exporting} style={styles.exportButton}><Text style={styles.exportButtonText}>{exporting ? 'Gerando...' : '↓ Exportar pagamentos'}</Text></Pressable> : null}
          <Text style={styles.counter}>{groups.length}</Text>
        </View>
      </View>
      {groups.length === 0 ? <EmptyState title="Nenhuma cobrança adicional" description="Cadastre a primeira cobrança extra para uma ou mais unidades." /> : <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>{groups.map((group) => {
        const status = groupStatus(group);
        const uniform = groupIsUniform(group);
        return <Pressable key={group.description} onPress={() => openManageGroup(group)} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.grow}><Text style={styles.cardTitle}>{group.description}</Text><Text style={styles.cardDescription}>{group.charges.length} unidade(s)</Text></View>
            <View style={[styles.statusPill, { borderColor: chargeStatusColor[status] }]}><Text style={[styles.statusPillText, { color: chargeStatusColor[status] }]}>{chargeStatusLabel[status]}</Text></View>
          </View>
          <Text style={styles.value}>{uniform ? chargePeriod(group.charges[0]) : 'Valores variam por unidade'}</Text>
          {(() => {
            const totals = groupPayment(group);
            if (!totals.billableCount) return null;
            const pct = Math.round((totals.paidCents / Math.max(totals.billableCents, 1)) * 100);
            return <View style={styles.paymentBox}>
              <View style={styles.paymentBar}><View style={[styles.paymentBarFill, { width: `${pct}%` as any }]} /></View>
              <Text style={styles.paymentSummary}>
                {formatCurrency(totals.paidCents)} recebidos de {formatCurrency(totals.billableCents)} · {totals.paidCount} de {totals.billableCount} parcela(s) paga(s)
              </Text>
              {totals.overdueCount > 0 ? <Text style={styles.paymentOverdue}>{totals.overdueCount} parcela(s) vencida(s)</Text> : null}
            </View>;
          })()}
          <Text style={styles.manageHint}>Toque para ver o pagamento por unidade, adicionar ou remover unidades</Text>
        </Pressable>;
      })}</CardGrid>}
      </View>

      <View ref={registerSection('form')} style={[styles.panel, styles.formPanel, isActive('form') && styles.tourHighlight]}>
        <Text style={styles.panelTitle}>Nova cobrança adicional</Text>
        <Text style={styles.fieldLabel}>Unidades</Text>
        <Text style={styles.fieldHint}>Escolha uma unidade, várias, ou marque "Todas as unidades" para lançar a mesma cobrança em todo o condomínio. Se já existir uma cobrança com a mesma descrição, essas unidades entram no mesmo grupo. Unidades com morador isento de boleto não aparecem aqui.</Text>
        <View style={styles.unitList}>
          <Pressable onPress={toggleAllUnits} style={[styles.option, styles.optionAll, allUnitsSelected && styles.optionActive]}>
            <Text style={[styles.optionText, allUnitsSelected && styles.optionTextActive]}>Todas as unidades</Text>
          </Pressable>
          {units.map((unit) => <Pressable key={unit.id} onPress={() => toggleUnit(unit.id)} style={[styles.option, selectedUnitIds.includes(unit.id) && styles.optionActive]}>
            <Text style={[styles.optionText, selectedUnitIds.includes(unit.id) && styles.optionTextActive]}>{unitLabel(unit)}</Text>
          </Pressable>)}
        </View>
        {selectedUnitIds.length ? <Text style={styles.selectionSummary}>{selectedUnitIds.length} unidade(s) selecionada(s).</Text> : null}
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <View>
            <TextInput placeholder="Descrição (ex.: Tag de portaria)" value={description} onChangeText={setDescription} style={styles.input} />
            <Text style={styles.fieldHint}>Texto que identifica a cobrança e aparece somado à descrição do boleto. Cobranças com a mesma descrição aparecem agrupadas na lista.</Text>
          </View>
          <View>
            <TextInput placeholder="Valor total (ex.: R$ 120,00)" value={totalAmount} onChangeText={(value) => setTotalAmount(maskCurrency(value))} keyboardType="number-pad" style={styles.input} />
            <Text style={styles.fieldHint}>Valor total da cobrança para cada unidade selecionada. Se houver mais de uma parcela, o sistema divide esse valor entre elas.</Text>
          </View>
          <View>
            <TextInput placeholder="Número de parcelas (1 a 60)" value={installmentCount} onChangeText={(value) => setInstallmentCount(value.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" style={styles.input} />
            <Text style={styles.fieldHint}>Em quantos boletos mensais essa cobrança será somada. Use 1 para cobrar tudo de uma vez, no próximo boleto.</Text>
          </View>
          <View>
            <TextInput placeholder="Mês da 1ª parcela (MM/AAAA)" value={firstMonth} onChangeText={(value) => setFirstMonth(maskBrazilianMonth(value))} keyboardType="number-pad" maxLength={7} style={styles.input} />
            <Text style={styles.fieldHint}>
              Mês em que a cobrança começa a ser somada à taxa condominial.
              {lastReferenceMonthLabel ? (installmentCountNumber > 1 ? ` Vai até o boleto de ${lastReferenceMonthLabel}.` : ` Somada só no boleto de ${lastReferenceMonthLabel}.`) : ''}
            </Text>
          </View>
        </FormGrid>
        {error && !managingGroup ? <Text style={styles.error}>{error}</Text> : null}{success && !managingGroup ? <Text style={styles.success}>{success}</Text> : null}
        <AppButton title="Salvar cobrança adicional" onPress={create} disabled={isLoading || !selectedUnitIds.length || !description.trim() || currencyToCents(totalAmount) <= 0 || !brazilianMonthToIso(firstMonth)} />
      </View>

      <Modal visible={Boolean(managingGroup)} transparent animationType="fade" onRequestClose={() => setManagingDescription(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Pressable onPress={() => setManagingDescription(null)} style={styles.modalCloseButton}><Text style={styles.modalCloseButtonText}>×</Text></Pressable>
            <ScrollView contentContainerStyle={{ gap: 14 }}>
              {managingGroup ? <>
                <Text style={styles.modalTitle}>{managingGroup.description}</Text>
                <View style={styles.modalSubtitleRow}>
                  <Text style={[styles.cardDescription, styles.grow]}>{managingGroup.charges.length} unidade(s) nesta cobrança</Text>
                  <Pressable onPress={() => exportPayments(managingGroup.description)} disabled={exporting} style={styles.exportButton}><Text style={styles.exportButtonText}>{exporting ? 'Gerando...' : '↓ Exportar'}</Text></Pressable>
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Unidades</Text>
                  <View style={styles.unitChargeList}>
                    {managingGroup.charges.map((charge) => {
                      const hasPending = charge.installments.some((item) => item.status === 'pending');
                      return <View key={charge.id} style={styles.unitChargeRow}>
                        <View style={styles.grow}>
                          <Text style={styles.unitChargeLabel}>{charge.unit_label}</Text>
                          <Text style={styles.installmentSummary}>{chargePeriod(charge)}</Text>
                          <Text style={styles.installmentPaid}>
                            {charge.payment.paidCount} de {charge.payment.billableCount} paga(s) · {formatCurrency(charge.payment.paidCents)} de {formatCurrency(charge.payment.billableCents)}
                          </Text>
                          <View style={styles.installmentChips}>
                            {charge.installments.map((item) => (
                              <View key={item.id} style={[styles.installmentChip, { borderColor: paymentColor[item.paymentState] }]}>
                                <Text style={[styles.installmentChipText, { color: paymentColor[item.paymentState] }]}>
                                  {charge.installment_count > 1 ? `${item.installment_number}/${charge.installment_count} · ` : ''}{formatBrazilianMonth(item.reference_month.slice(0, 7))} · {paymentLabel[item.paymentState]}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                        <View style={[styles.statusPill, { borderColor: chargeStatusColor[charge.status] }]}><Text style={[styles.statusPillText, { color: chargeStatusColor[charge.status] }]}>{chargeStatusLabel[charge.status]}</Text></View>
                        {hasPending || charge.status === 'active' ? <Pressable onPress={() => confirmRemoveUnitCharge(charge)} style={styles.linkButton}><Text style={styles.linkButtonTextDanger}>Excluir</Text></Pressable> : null}
                      </View>;
                    })}
                  </View>
                </View>

                {availableUnitsForGroup.length > 0 ? <View>
                  <Text style={styles.fieldLabel}>Adicionar unidades</Text>
                  <Text style={styles.fieldHint}>A unidade adicionada entra com a mesma descrição e valor da cobrança mais recente deste grupo, a partir da próxima parcela ainda não vencida.</Text>
                  <View style={styles.unitList}>
                    {availableUnitsForGroup.map((unit) => <Pressable key={unit.id} onPress={() => setAddUnitIds((current) => current.includes(unit.id) ? current.filter((id) => id !== unit.id) : [...current, unit.id])} style={[styles.option, addUnitIds.includes(unit.id) && styles.optionActive]}>
                      <Text style={[styles.optionText, addUnitIds.includes(unit.id) && styles.optionTextActive]}>{unitLabel(unit)}</Text>
                    </Pressable>)}
                  </View>
                  <AppButton title={`Adicionar ${addUnitIds.length || ''} unidade(s)`.trim()} onPress={addUnitsToGroup} disabled={isLoading || !addUnitIds.length} />
                </View> : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}{success ? <Text style={styles.success}>{success}</Text> : null}
              </> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone="error" confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
  </>;
}

const styles = StyleSheet.create({
  container: { width: '100%', marginLeft: 'auto', marginRight: 'auto', padding: 24, paddingBottom: 40, backgroundColor: colors.background }, grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 16 }, panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: 12 },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  fieldHint: { color: colors.muted, fontSize: 12.5, lineHeight: 16, marginBottom: 10 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, marginBottom: 6, backgroundColor: '#fff', color: colors.ink },
  unitList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10 }, optionAll: { borderStyle: 'dashed' }, optionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue }, optionText: { color: colors.ink, fontWeight: '800' }, optionTextActive: { color: colors.primaryDark },
  selectionSummary: { color: colors.primaryDark, fontSize: 13, fontWeight: '800', marginBottom: 14 },
  error: { color: colors.red, marginBottom: 10 }, success: { color: colors.green, marginBottom: 10, fontWeight: '800' }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, counter: { color: colors.primary, fontWeight: '900' },
  card: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, cardDescription: { color: colors.muted, fontSize: 14, marginTop: 4 }, value: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  manageHint: { color: colors.primary, fontSize: 12.5, fontWeight: '800' },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }, statusPillText: { fontSize: 11.5, fontWeight: '900' },
  linkButton: { paddingVertical: 6, paddingHorizontal: 4 }, linkButtonTextDanger: { color: colors.red, fontWeight: '800' },
  formPanel: { marginTop: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, paddingTop: 30, maxWidth: 560, width: '100%', maxHeight: '85%' },
  modalCloseButton: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  modalCloseButtonText: { color: colors.muted, fontSize: 22, fontWeight: '900', lineHeight: 24 },
  modalTitle: { fontSize: 20, fontWeight: '900', color: colors.ink },
  unitChargeList: { gap: 8, marginTop: 8 },
  unitChargeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 10 },
  unitChargeLabel: { color: colors.ink, fontSize: 14.5, fontWeight: '800' }, installmentSummary: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  installmentPaid: { color: colors.green, fontSize: 12.5, fontWeight: '800', marginTop: 3 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalSubtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exportButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.softBlue },
  exportButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 12.5 },
  installmentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  installmentChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  installmentChipText: { fontSize: 11, fontWeight: '800' },
  paymentBox: { marginTop: 10, gap: 5 },
  paymentBar: { height: 6, borderRadius: 3, backgroundColor: '#e7ebf1', overflow: 'hidden' },
  paymentBarFill: { height: 6, backgroundColor: colors.green },
  paymentSummary: { color: colors.ink, fontSize: 12.5, fontWeight: '800' },
  paymentOverdue: { color: colors.red, fontSize: 12, fontWeight: '800' },
});
