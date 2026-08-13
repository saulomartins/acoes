import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { brazilianMonthToIso, formatBrazilianMonth, maskBrazilianMonth } from '../utils/date';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type UtilityType = 'agua' | 'gas' | 'energia';
const UTILITY_TYPES: UtilityType[] = ['agua', 'gas', 'energia'];
const UTILITY_LABEL: Record<UtilityType, string> = { agua: 'Água', gas: 'Gás', energia: 'Energia' };
type Rate = { utilityType: UtilityType; unitLabel: string; unitPriceCents: number | null };
type ChargeCell = { id: string; quantity: number; amountCents: number; status: 'pending' | 'applied' | 'canceled' } | null;
type UnitRow = { unitId: string; unitLabel: string; charges: Record<UtilityType, ChargeCell> };
type MonthSummary = { referenceMonth: string; totalAmountCents: number; appliedCount: number; pendingCount: number; utilities: Array<{ utilityType: UtilityType; quantity: number; amountCents: number }> };
type Dialog = { title: string; message: string; tone: 'info' | 'success' | 'error'; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void };

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const currentBrazilianMonth = () => { const now = new Date(); return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; };
const cellKey = (unitId: string, utilityType: UtilityType) => `${unitId}:${utilityType}`;

export default function UnitConsumption() {
  const { isMobile: mobile } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [rates, setRates] = useState<Rate[]>(UTILITY_TYPES.map(utilityType => ({ utilityType, unitLabel: '', unitPriceCents: null })));
  const [rateInputs, setRateInputs] = useState<Record<UtilityType, string>>({ agua: '', gas: '', energia: '' });
  const [referenceMonth, setReferenceMonth] = useState(currentBrazilianMonth());
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const {scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();
  const tourSteps:TourStep[]=[
    {key:'rates',title:'Tarifas vigentes',description:'Preço por m³ de água, kg de gás e kWh de energia, cobrado igual para todas as unidades do condomínio. Atualize aqui sempre que a tarifa da concessionária mudar — o valor fica congelado em cada lançamento já salvo, então mudar a tarifa não altera lançamentos antigos, só os novos.'},
    {key:'history',title:'Histórico por mês',description:'Um card por mês já lançado, com o total por tipo de consumo e quantos itens já foram cobrados em boleto (aplicado) ou ainda estão pendentes. "Ver este mês" leva direto para o detalhe daquele mês na seção de lançamento, logo abaixo.'},
    {key:'launch',title:'Lançamento de consumo',description:'Escolha o mês de referência e informe a quantidade consumida por unidade e tipo — o valor é calculado na hora com a tarifa vigente. Salvar soma esse valor ao próximo boleto da unidade, além da taxa condominial. Uma célula "Já emitido" significa que o lançamento já está em um boleto: só dá pra editar depois de cancelar esse boleto no Banco Inter (link "Editar (boleto cancelado)").'},
  ];

  const loadHistory = useCallback(async () => {
    if (!userToken) return;
    try { const r = await apiRequest<{ months: MonthSummary[] }>('/unit-consumption/history', userToken); setHistory(r.months); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar o histórico de consumo.'); }
  }, [userToken]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const loadCharges = useCallback(async () => {
    const referenceMonthIso = brazilianMonthToIso(referenceMonth);
    if (!userToken || !referenceMonthIso) return;
    setLoading(true); setError('');
    try {
      const r = await apiRequest<{ rates: Rate[]; units: UnitRow[] }>(`/unit-consumption/charges?referenceMonth=${referenceMonthIso}`, userToken);
      setRates(r.rates);
      setRateInputs(Object.fromEntries(r.rates.map(rate => [rate.utilityType, rate.unitPriceCents != null ? String(rate.unitPriceCents / 100).replace('.', ',') : ''])) as Record<UtilityType, string>);
      setUnits(r.units);
      setQuantityInputs(Object.fromEntries(r.units.flatMap(unit => UTILITY_TYPES.map(utilityType => [cellKey(unit.unitId, utilityType), unit.charges[utilityType]?.quantity != null ? String(unit.charges[utilityType]!.quantity).replace('.', ',') : '']))));
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar consumo.'); }
    finally { setLoading(false); }
  }, [userToken, referenceMonth]);
  useEffect(() => { loadCharges(); }, [loadCharges]);
  useEffect(() => { if (notice) setDialog({ title: 'Tudo certo', message: notice, tone: 'success' }); }, [notice]);
  useEffect(() => { if (error) setDialog({ title: 'Não foi possível concluir', message: error, tone: 'error' }); }, [error]);

  const saveRates = async () => {
    if (!userToken) return;
    const parsed = UTILITY_TYPES.map(utilityType => ({ utilityType, unitPriceCents: Math.round(Number((rateInputs[utilityType] || '0').replace(',', '.')) * 100) }));
    if (parsed.some(item => !Number.isFinite(item.unitPriceCents) || item.unitPriceCents < 0)) { setError('Informe uma tarifa válida para cada tipo de consumo.'); return; }
    setLoading(true); setError('');
    try { await apiRequest('/unit-consumption/rates', userToken, { method: 'PUT', body: JSON.stringify({ rates: parsed }) }); setNotice('Tarifas atualizadas.'); await loadCharges(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar tarifas.'); }
    finally { setLoading(false); }
  };

  const saveCharges = async () => {
    const referenceMonthIso = brazilianMonthToIso(referenceMonth);
    if (!userToken || !referenceMonthIso) return;
    const items: Array<{ unitId: string; utilityType: UtilityType; quantity: number }> = [];
    for (const unit of units) for (const utilityType of UTILITY_TYPES) {
      const raw = (quantityInputs[cellKey(unit.unitId, utilityType)] || '').trim();
      if (!raw || unit.charges[utilityType]?.status === 'applied') continue;
      const quantity = Number(raw.replace(',', '.'));
      if (Number.isFinite(quantity) && quantity >= 0) items.push({ unitId: unit.unitId, utilityType, quantity });
    }
    if (!items.length) { setError('Informe ao menos uma quantidade consumida.'); return; }
    setLoading(true); setError('');
    try {
      const r = await apiRequest<{ message: string }>('/unit-consumption/charges', userToken, { method: 'POST', body: JSON.stringify({ referenceMonth: referenceMonthIso, items }) });
      setNotice(r.message); await Promise.all([loadCharges(), loadHistory()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar lançamentos.'); }
    finally { setLoading(false); }
  };

  const removeCharge = async (chargeId: string) => {
    if (!userToken) return;
    setLoading(true); setError('');
    try { await apiRequest(`/unit-consumption/charges/${chargeId}`, userToken, { method: 'DELETE' }); await Promise.all([loadCharges(), loadHistory()]); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover lançamento.'); }
    finally { setLoading(false); }
  };

  const unlockCharge = async (chargeId: string) => {
    if (!userToken) return;
    setDialog(null); setLoading(true); setError('');
    try {
      const r = await apiRequest<{ message: string }>(`/unit-consumption/charges/${chargeId}/unlock`, userToken, { method: 'POST' });
      setNotice(r.message); await Promise.all([loadCharges(), loadHistory()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao destravar o lançamento.'); }
    finally { setLoading(false); }
  };
  const confirmUnlockCharge = (chargeId: string) => setDialog({
    title: 'Editar lançamento já emitido?',
    message: 'Só destrava se o boleto que carregava este lançamento já foi cancelado no Banco Inter e a situação já foi atualizada aqui no sistema (botão "Atualizar todos os boletos" em Gestão de cobranças). Caso contrário, a unidade seria cobrada duas vezes.',
    tone: 'info', confirmLabel: 'Já cancelei o boleto, destravar', cancelLabel: 'Voltar',
    onConfirm: () => unlockCharge(chargeId),
  });

  const previewCents = (unit: UnitRow, utilityType: UtilityType) => {
    const raw = (quantityInputs[cellKey(unit.unitId, utilityType)] || '').trim();
    const rate = rates.find(item => item.utilityType === utilityType)?.unitPriceCents;
    if (!raw || rate == null) return null;
    const quantity = Number(raw.replace(',', '.'));
    return Number.isFinite(quantity) ? Math.round(quantity * rate) : null;
  };

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={[s.container, mobile && s.containerMobile]}>
        <View style={s.headerRow}>
          <View style={s.grow}>
            <Text style={s.eyebrow}>COBRANÇAS</Text>
            <Text style={s.title}>Consumo (água, gás e energia)</Text>
            <Text style={s.subtitle}>Lance a quantidade consumida por unidade a cada mês — o valor é somado ao boleto da taxa condominial, além da tipologia.</Text>
          </View>
          <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
        </View>

        <View ref={registerSection('rates')} style={[isActive('rates')&&s.tourHighlight]}><Panel>
          <Text style={s.heading}>Tarifas vigentes</Text>
          <FormGrid columns={{ mobile: 1, tablet: 3, desktop: 3 }}>
            {UTILITY_TYPES.map(utilityType => (
              <View key={utilityType}>
                <Text style={s.label}>{UTILITY_LABEL[utilityType]} (R$/{rates.find(r => r.utilityType === utilityType)?.unitLabel || ''})</Text>
                <TextInput value={rateInputs[utilityType]} onChangeText={value => setRateInputs(current => ({ ...current, [utilityType]: value }))} placeholder="0,00" keyboardType="decimal-pad" style={s.input} />
              </View>
            ))}
          </FormGrid>
          <AppButton title="Salvar tarifas" onPress={saveRates} disabled={loading} />
        </Panel></View>

        <View ref={registerSection('history')} style={[isActive('history')&&s.tourHighlight]}><Panel>
          <Text style={s.heading}>Histórico por mês</Text>
          {history.length ? history.map(month => (
            <View key={month.referenceMonth} style={s.historyRow}>
              <View style={s.historyInfo}>
                <Text style={s.historyMonth}>{formatBrazilianMonth(month.referenceMonth)}</Text>
                <Text style={s.historyMeta}>{month.utilities.map(u => `${UTILITY_LABEL[u.utilityType]} ${money(u.amountCents)}`).join(' · ')}</Text>
                <Text style={s.historyMeta}>{month.appliedCount} já cobrado(s) em boleto{month.pendingCount ? ` · ${month.pendingCount} pendente(s)` : ''}</Text>
              </View>
              <View style={s.historyRight}>
                <Text style={s.historyTotal}>{money(month.totalAmountCents)}</Text>
                <Pressable onPress={() => setReferenceMonth(formatBrazilianMonth(month.referenceMonth))}><Text style={s.link}>Ver este mês</Text></Pressable>
              </View>
            </View>
          )) : <Text style={s.subtitle}>Nenhum lançamento de consumo ainda.</Text>}
        </Panel></View>

        <View ref={registerSection('launch')} style={[isActive('launch')&&s.tourHighlight]}><Panel>
          <Text style={s.heading}>Lançamento de consumo</Text>
          <Text style={s.label}>Mês de referência</Text>
          <TextInput value={referenceMonth} onChangeText={value => setReferenceMonth(maskBrazilianMonth(value))} placeholder="MM/AAAA" keyboardType="number-pad" maxLength={7} style={s.input} />
          {units.map(unit => (
            <View key={unit.unitId} style={s.unitRow}>
              <Text style={s.unitLabel}>{unit.unitLabel}</Text>
              <View style={s.utilityRow}>
                {UTILITY_TYPES.map(utilityType => {
                  const charge = unit.charges[utilityType];
                  const applied = charge?.status === 'applied';
                  const preview = previewCents(unit, utilityType);
                  return (
                    <View key={utilityType} style={s.utilityCell}>
                      <Text style={s.utilityCellLabel}>{UTILITY_LABEL[utilityType]}</Text>
                      <TextInput
                        value={quantityInputs[cellKey(unit.unitId, utilityType)] || ''}
                        onChangeText={value => setQuantityInputs(current => ({ ...current, [cellKey(unit.unitId, utilityType)]: value }))}
                        placeholder="0" keyboardType="decimal-pad" editable={!applied}
                        style={[s.input, s.cellInput, applied && s.readonly]}
                      />
                      {applied ? <>
                        <Text style={s.appliedHint}>Já emitido: {money(charge!.amountCents)}</Text>
                        <Pressable onPress={() => confirmUnlockCharge(charge!.id)}><Text style={s.unlockLink}>Editar (boleto cancelado)</Text></Pressable>
                      </> : preview != null ? <Text style={s.previewHint}>{money(preview)}</Text> : null}
                      {charge && !applied ? <Pressable onPress={() => removeCharge(charge.id)}><Text style={s.removeLink}>Remover</Text></Pressable> : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
          <AppButton title="Salvar lançamentos" onPress={saveCharges} disabled={loading || !units.length} />
        </Panel></View>
      </ScrollView>
      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
      <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
    </>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 20, paddingBottom: 50, paddingHorizontal: 12, gap: 14 }, containerMobile: { paddingBottom: 100 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }, grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue }, tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.primary, fontWeight: '900' }, title: { color: colors.ink, fontSize: 24, fontWeight: '900' }, subtitle: { color: colors.muted, lineHeight: 21, marginBottom: 4 },
  heading: { color: colors.ink, fontSize: 17, fontWeight: '900', marginBottom: 10 }, label: { color: colors.ink, fontWeight: '800', marginBottom: 7, fontSize: 14 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, marginBottom: 10, backgroundColor: '#fff', fontSize: 14 },
  readonly: { backgroundColor: '#f2f4f7', color: colors.primaryDark },
  unitRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12 },
  unitLabel: { color: colors.ink, fontWeight: '900', fontSize: 14, marginBottom: 8 },
  utilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  utilityCell: { flexGrow: 1, minWidth: 120 }, utilityCellLabel: { color: colors.muted, fontWeight: '800', fontSize: 12, marginBottom: 4 },
  cellInput: { marginBottom: 4 },
  previewHint: { color: colors.primaryDark, fontWeight: '800', fontSize: 12, marginBottom: 4 },
  appliedHint: { color: colors.muted, fontWeight: '700', fontSize: 12, marginBottom: 4 },
  removeLink: { color: colors.red, fontWeight: '800', fontSize: 12 },
  unlockLink: { color: colors.primary, fontWeight: '800', fontSize: 12, marginBottom: 4 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10 },
  historyInfo: { flex: 1, minWidth: 0 }, historyMonth: { color: colors.ink, fontWeight: '900', fontSize: 14 }, historyMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  historyRight: { alignItems: 'flex-end' }, historyTotal: { color: colors.primaryDark, fontWeight: '900', fontSize: 14, marginBottom: 4 },
  link: { color: colors.primary, fontWeight: '900', fontSize: 12 },
});
