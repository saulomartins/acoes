import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, Modal } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { formatBrazilianDate, formatBrazilianMonth } from '../utils/date';
import { useBreakpoint } from '../ui/responsive';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Agreement = {
  id: string;
  status: string;
  debtor_name: string;
  apartment: string;
  original_total_cents: number;
  negotiated_total_cents: number;
  installment_count: number;
  agreement_date: string;
  accepted_date: string | null;
  settled_date: string | null;
  canceled_date: string | null;
  first_reference_month: string | null;
  last_reference_month: string | null;
  cancellation_reason: string | null;
  recalculated_total_cents: number | null;
  notes: string | null;
  installments: Array<{ number: number; amountCents: number; dueDate: string; status: string | null; cancellationReason: string | null }>;
};

type ApartmentGroup = {
  apartment: string;
  debtorName: string;
  agreements: Agreement[];
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const agreementStatusLabel: Record<string, string> = {
  draft: 'Rascunho',
  sent: 'Aguardando aceite',
  accepted: 'Aceito',
  active: 'Ativo',
  at_risk: 'Sob risco',
  breached: 'Rompido',
  settled: 'Quitado',
  rejected: 'Recusado',
  expired: 'Expirado',
  canceled: 'Cancelado',
};
const statusColor: Record<string, string> = {
  draft: colors.muted,
  sent: colors.amber,
  accepted: colors.primary,
  active: colors.green,
  at_risk: colors.amber,
  breached: colors.red,
  settled: colors.green,
  rejected: colors.muted,
  expired: colors.muted,
  canceled: colors.red,
};
const statusFilters = ['all', 'draft', 'sent', 'accepted', 'active', 'at_risk', 'breached', 'settled', 'rejected', 'expired', 'canceled'] as const;
const referenceRange = (ag: Agreement) => {
  if (!ag.first_reference_month) return null;
  return ag.first_reference_month === ag.last_reference_month ? ag.first_reference_month : `${ag.first_reference_month} a ${ag.last_reference_month}`;
};

export default function AgreementHistory({ navigation }: any) {
  const { isMobile: compact } = useBreakpoint();
  const { userToken, user } = useContext(AuthContext);
  const manager = ['sindico', 'subsindico'].includes(user?.role || '');
  const {scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedApartment, setSelectedApartment] = useState<string | null>(null);
  const [selectedDebtor, setSelectedDebtor] = useState<string | null>(null);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [recalculate, setRecalculate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<typeof statusFilters[number]>('all');
  const [search, setSearch] = useState('');
  const [detailsAgreement, setDetailsAgreement] = useState<Agreement | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<{ agreements: Agreement[] }>('/agreements/history', userToken);
      setAgreements(data.agreements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleAgreements = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return agreements.filter(ag => {
      const matchesStatus = statusFilter === 'all' || ag.status === statusFilter;
      const matchesSearch = !term || ag.apartment.toLocaleLowerCase('pt-BR').includes(term) || ag.debtor_name.toLocaleLowerCase('pt-BR').includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [agreements, statusFilter, search]);

  const grouped = useMemo<ApartmentGroup[]>(() => {
    if (!manager) {
      return [{ apartment: 'Meus Acordos', debtorName: user?.username || '', agreements: visibleAgreements }];
    }
    const map = new Map<string, Agreement[]>();
    visibleAgreements.forEach(ag => {
      const key = ag.apartment;
      map.set(key, [...(map.get(key) || []), ag]);
    });
    return Array.from(map, ([apartment, ags]) => ({
      apartment,
      debtorName: ags[0]?.debtor_name || '',
      agreements: ags.sort((a, b) => new Date(b.agreement_date).getTime() - new Date(a.agreement_date).getTime()),
    }));
  }, [visibleAgreements, manager, user?.username]);

  const settledCount = agreements.filter(ag => ag.status === 'settled').length;
  const breachedCount = agreements.filter(ag => ag.status === 'breached').length;
  const negotiatedTotal = agreements.reduce((sum, ag) => sum + ag.negotiated_total_cents, 0);

  const handleCancelAll = async () => {
    if (!selectedAgreement || !cancellationReason.trim()) return;
    setSubmitting(true);
    try {
      await apiRequest(`/agreements/${selectedAgreement.id}/mark-all-canceled`, userToken, {
        method: 'POST',
        body: { cancellationReason: cancellationReason.trim(), recalculateValue: recalculate },
      });
      setCancellationReason('');
      setRecalculate(false);
      setShowCancellationModal(false);
      setSelectedAgreement(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Erro ao salvar justificativa');
    } finally {
      setSubmitting(false);
    }
  };

  const allCanceledCount = (ag: Agreement) => ag.installments.filter(i => i.status === 'canceled').length === ag.installments.length ? ag.installments.length : 0;

  const managerTourSteps:TourStep[]=[
    {key:'summary',title:'Resumo geral',description:'Total de acordos no histórico, quantos foram quitados, quantos foram rompidos (o morador não honrou as parcelas) e a soma de tudo que foi efetivamente negociado, já considerando o desconto dado em relação à dívida original.'},
    {key:'filters',title:'Buscar e filtrar',description:'Pesquise por apartamento ou pelo nome do responsável, e filtre por situação: rascunho, aguardando aceite, aceito, ativo, sob risco, rompido, quitado, recusado, expirado ou cancelado. Combine os dois pra achar um acordo específico rapidamente.'},
    {key:'agreements',title:'Acordos por apartamento',description:'Os acordos aparecem agrupados por apartamento, do mais recente pro mais antigo. Toque em "Ver detalhes" pra abrir o resumo completo: dívida original, valor negociado, cada parcela com sua situação (paga, vencida, cancelada) e, se houver, o motivo do cancelamento ou observações registradas. Se um acordo ativo tiver todas as parcelas canceladas, dá pra justificar o cancelamento total dele por ali.'},
  ];
  const residentTourSteps:TourStep[]=[
    {key:'summary',title:'Resumo geral',description:'Quantos acordos você já fez no total, quantos já foram quitados, quantos foram rompidos e o valor total que você negociou — já com o desconto obtido em relação à dívida original.'},
    {key:'filters',title:'Filtrar por situação',description:'Filtre seus acordos por situação: aguardando seu aceite, ativo, sob risco de rompimento, quitado, rompido, recusado, expirado ou cancelado.'},
    {key:'agreements',title:'Seus acordos',description:'Toque em "Ver detalhes" pra ver a dívida original, o valor negociado, todas as parcelas com data de vencimento e situação (paga, vencida, cancelada), além de observações e o motivo de um eventual cancelamento.'},
  ];
  const tourSteps=manager?managerTourSteps:residentTourSteps;

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.container, compact && styles.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={styles.headerRow}><View style={styles.grow}><Text style={styles.eyebrow}>FINANCEIRO</Text>
      <Text style={styles.title}>Histórico de Acordos</Text>
      <Text style={styles.subtitle}>{manager ? 'Acordos encerrados, quitados e rompidos' : 'Acompanhe seus acordos finalizados'}</Text></View><Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable></View>

      <View ref={registerSection('summary')} style={[styles.summaryRow, compact && styles.summaryRowMobile, isActive('summary')&&styles.tourHighlight]}>
        <View style={[styles.summary, compact && styles.summaryMobile]}><Text style={[styles.summaryValue, compact && styles.summaryValueMobile]}>{agreements.length}</Text><Text style={styles.summaryLabel}>acordos no histórico</Text></View>
        <View style={[styles.summary, compact && styles.summaryMobile]}><Text style={[styles.summaryValue, compact && styles.summaryValueMobile, { color: colors.green }]}>{settledCount}</Text><Text style={styles.summaryLabel}>quitados</Text></View>
        <View style={[styles.summary, breachedCount > 0 && styles.summaryDanger, compact && styles.summaryMobile]}><Text style={[styles.summaryValue, compact && styles.summaryValueMobile, breachedCount > 0 && styles.dangerText]}>{breachedCount}</Text><Text style={styles.summaryLabel}>rompidos</Text></View>
        <View style={[styles.summary, compact && styles.summaryMobile]}><Text style={[styles.summaryValue, compact && styles.summaryValueMobile]}>{money(negotiatedTotal)}</Text><Text style={styles.summaryLabel}>total negociado</Text></View>
      </View>

      <View ref={registerSection('filters')} style={[isActive('filters')&&styles.tourHighlight]}><Panel>
        <Text style={styles.panelTitle}>Filtros</Text>
        {manager && (
          <>
            <Text style={styles.label}>Buscar por apartamento ou responsável</Text>
            <TextInput value={search} onChangeText={setSearch} placeholder="Digite o apartamento ou nome" style={styles.input} />
          </>
        )}
        <Text style={styles.label}>Situação</Text>
        <View style={styles.filters}>
          {statusFilters.map(value => (
            <Pressable key={value} onPress={() => setStatusFilter(value)} style={[styles.chip, statusFilter === value && styles.chipOn]}>
              <Text style={[styles.chipText, statusFilter === value && styles.chipTextOn]}>{value === 'all' ? 'Todas' : agreementStatusLabel[value]}</Text>
            </Pressable>
          ))}
        </View>
      </Panel></View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View ref={registerSection('agreements')} style={[isActive('agreements')&&styles.tourHighlight]}>
      {loading && !agreements.length ? (
        <EmptyState title="Carregando..." description="" />
      ) : grouped.length && grouped.some(group => group.agreements.length) ? (
        grouped.filter(group => group.agreements.length).map(group => (
          <View key={group.apartment} style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupIdentity}>
                <Text style={styles.groupTitle}>{group.apartment}</Text>
                {manager && group.debtorName && <Text style={styles.groupMeta}>{group.debtorName}</Text>}
              </View>
              <Text style={styles.groupTotal}>{group.agreements.length} acordo(s)</Text>
            </View>

            <View style={styles.agreementList}>
              {group.agreements.map(ag => (
                <View key={ag.id} style={styles.agreementRow}>
                  <View style={styles.agreementInfo}>
                    <Text style={styles.agreementCode}>ACORDO {ag.id.slice(0, 8).toUpperCase()}</Text>
                    <Text style={styles.agreementDate}>
                      {formatBrazilianDate(ag.agreement_date)}{referenceRange(ag) ? ` · Referência: ${referenceRange(ag)}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.badge, { color: '#fff', backgroundColor: statusColor[ag.status] || colors.muted }]}>
                    {agreementStatusLabel[ag.status] || ag.status}
                  </Text>
                  <Pressable style={styles.detailsButton} onPress={() => setDetailsAgreement(ag)}>
                    <Text style={styles.detailsButtonText}>Ver detalhes</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ))
      ) : (
        <EmptyState title="Nenhum acordo encontrado" description={manager ? 'Altere os filtros ou aguarde novos acordos encerrados, quitados ou rompidos.' : 'Você não possui acordos finalizados.'} />
      )}
      </View>

      <Modal visible={!!detailsAgreement} transparent animationType="fade" onRequestClose={() => setDetailsAgreement(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModalContent}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              {detailsAgreement && (
                <>
                  <View style={styles.cardTop}>
                    <View style={styles.nameArea}>
                      <Text style={styles.modalTitle}>ACORDO {detailsAgreement.id.slice(0, 8).toUpperCase()}</Text>
                      <Text style={styles.line}>
                        {formatBrazilianDate(detailsAgreement.agreement_date)}{referenceRange(detailsAgreement) ? ` · Referência: ${referenceRange(detailsAgreement)}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.badge, { color: '#fff', backgroundColor: statusColor[detailsAgreement.status] || colors.muted }]}>
                      {agreementStatusLabel[detailsAgreement.status] || detailsAgreement.status}
                    </Text>
                  </View>

                  <View style={styles.valuesRow}>
                    <View style={styles.valueBox}>
                      <Text style={styles.valueLabel}>Dívida original</Text>
                      <Text style={styles.valueText}>{money(detailsAgreement.original_total_cents)}</Text>
                    </View>
                    <View style={styles.valueBox}>
                      <Text style={styles.valueLabel}>Valor negociado</Text>
                      <Text style={styles.valueTextStrong}>{money(detailsAgreement.negotiated_total_cents)}</Text>
                    </View>
                    {detailsAgreement.recalculated_total_cents ? (
                      <View style={styles.valueBox}>
                        <Text style={styles.valueLabel}>Valor recalculado</Text>
                        <Text style={[styles.valueText, { color: colors.red }]}>{money(detailsAgreement.recalculated_total_cents)}</Text>
                      </View>
                    ) : null}
                  </View>

                  {detailsAgreement.cancellation_reason ? (
                    <View style={styles.reasonBox}>
                      <Text style={styles.reasonLabel}>Justificativa do cancelamento:</Text>
                      <Text style={styles.reasonText}>{detailsAgreement.cancellation_reason}</Text>
                    </View>
                  ) : null}

                  {detailsAgreement.notes ? (
                    <View style={styles.notesBox}>
                      <Text style={styles.notesLabel}>Observação:</Text>
                      <Text style={styles.notesText}>{detailsAgreement.notes}</Text>
                    </View>
                  ) : null}

                  <View style={styles.installmentsList}>
                    <Text style={styles.installmentsTitle}>
                      Parcelas ({detailsAgreement.installments.filter(i => i.status === 'paid').length}/{detailsAgreement.installments.length} pagas)
                    </Text>
                    {detailsAgreement.installments.map(inst => (
                      <View key={`${detailsAgreement.id}-${inst.number}`} style={styles.installmentItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.instNumber}>Parcela {inst.number}</Text>
                          <Text style={styles.instDate}>{formatBrazilianDate(inst.dueDate)}</Text>
                        </View>
                        <Text style={styles.instAmount}>{money(inst.amountCents)}</Text>
                        <Text
                          style={[
                            styles.instStatus,
                            inst.status === 'paid' && styles.instStatusPaid,
                            inst.status === 'canceled' && styles.instStatusCanceled,
                            inst.status === 'overdue' && styles.instStatusOverdue,
                          ]}
                        >
                          {inst.status === 'paid' ? 'Pago' : inst.status === 'canceled' ? 'Cancelado' : inst.status === 'overdue' ? 'Vencido' : 'Em aberto'}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.modalActions}>
                    <AppButton title="Fechar" onPress={() => setDetailsAgreement(null)} />
                    {manager && detailsAgreement.status === 'active' && allCanceledCount(detailsAgreement) === detailsAgreement.installments.length && !detailsAgreement.cancellation_reason && (
                      <AppButton
                        title="Justificar cancelamento"
                        variant="danger"
                        onPress={() => {
                          const ag = detailsAgreement;
                          setDetailsAgreement(null);
                          setSelectedAgreement(ag);
                          setCancellationReason('');
                          setRecalculate(false);
                          setShowCancellationModal(true);
                        }}
                      />
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showCancellationModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Justificar Cancelamento</Text>
            <Text style={styles.modalSubtitle}>Acordo {selectedAgreement?.id.slice(0, 8).toUpperCase()}</Text>

            <Text style={styles.fieldLabel}>Motivo do cancelamento *</Text>
            <TextInput
              value={cancellationReason}
              onChangeText={setCancellationReason}
              placeholder="Explique o motivo do cancelamento de todos os boletos..."
              multiline
              numberOfLines={4}
              style={styles.reasonInput}
              editable={!submitting}
            />

            <Pressable
              style={styles.checkboxRow}
              onPress={() => setRecalculate(!recalculate)}
              disabled={submitting}
            >
              <View style={[styles.checkbox, recalculate && styles.checkboxChecked]}>
                {recalculate && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Recalcular valor com dias de atraso, multa e mora</Text>
            </Pressable>

            {recalculate && selectedAgreement && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Novo valor: {money(selectedAgreement.recalculated_total_cents || selectedAgreement.negotiated_total_cents)}
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <AppButton
                title="Cancelar"
                onPress={() => {
                  setShowCancellationModal(false);
                  setSelectedAgreement(null);
                }}
                disabled={submitting}
              />
              <AppButton
                title={submitting ? 'Salvando...' : 'Salvar justificativa'}
                onPress={handleCancelAll}
                disabled={submitting || !cancellationReason.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 50, gap: 14, backgroundColor: colors.background },
  containerMobile: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 34 },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 4 },
  error: { color: colors.red, fontWeight: '800' },
  headerRow:{flexDirection:'row',alignItems:'flex-start',gap:12,flexWrap:'wrap'},grow:{flex:1},
  tourButton:{borderWidth:1,borderColor:colors.primary,borderRadius:20,paddingHorizontal:14,paddingVertical:9,backgroundColor:colors.softBlue},tourButtonText:{color:colors.primaryDark,fontWeight:'900',fontSize:13},tourHighlight:{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:6,margin:-6},

  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryRowMobile: { gap: 6 },
  summary: { flex: 1, minWidth: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: '#fff', padding: 12 },
  summaryMobile: { flex: 0.5, minWidth: 70 },
  summaryValue: { fontSize: 18, fontWeight: '900', color: colors.ink },
  summaryValueMobile: { fontSize: 16 },
  summaryLabel: { fontSize: 13, color: colors.muted, marginTop: 2 },
  summaryDanger: { borderColor: '#ef9a9a', backgroundColor: '#fff5f5' },
  dangerText: { color: colors.red },

  panelTitle: { fontSize: 19, fontWeight: '900', color: colors.ink, marginBottom: 8 },
  label: { fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink, marginBottom: 12 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '800', color: colors.muted },
  chipTextOn: { color: '#fff' },

  group: { gap: 10 },
  groupHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.softBlue, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 18, marginTop: 4 },
  groupIdentity: { flex: 1, minWidth: 220 },
  groupTitle: { fontSize: 22, fontWeight: '900', color: colors.primaryDark },
  groupMeta: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 4 },
  groupTotal: { fontSize: 14, fontWeight: '900', color: '#fff', backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },

  agreementList: { gap: 0 },
  agreementRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 16, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.border },
  agreementInfo: { flex: 1, minWidth: 200 },
  agreementCode: { fontSize: 20, fontWeight: '900', color: colors.primary },
  agreementDate: { fontSize: 14, color: colors.muted, marginTop: 4 },
  detailsButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  detailsButtonText: { fontSize: 14, color: colors.primary, fontWeight: '900' },

  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  nameArea: { flex: 1 },
  line: { fontSize: 13, color: colors.muted, marginTop: 3 },
  badge: { fontSize: 13, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },

  valuesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  valueBox: { flexGrow: 1, minWidth: 130, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#f8fafc', padding: 10 },
  valueLabel: { fontSize: 13, color: colors.muted, fontWeight: '800' },
  valueText: { fontSize: 16, fontWeight: '900', color: colors.ink, marginTop: 4 },
  valueTextStrong: { fontSize: 17, fontWeight: '900', color: colors.primaryDark, marginTop: 4 },

  reasonBox: { backgroundColor: '#fff9f0', padding: 10, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: colors.red },
  reasonLabel: { fontSize: 13, fontWeight: '900', color: colors.red, marginBottom: 4 },
  reasonText: { fontSize: 14, color: colors.ink, lineHeight: 19 },
  notesBox: { backgroundColor: '#f0f3f7', padding: 10, borderRadius: 8 },
  notesLabel: { fontSize: 13, fontWeight: '900', color: colors.primary, marginBottom: 4 },
  notesText: { fontSize: 14, color: colors.ink, lineHeight: 19 },
  installmentsList: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 },
  installmentsTitle: { fontSize: 14, fontWeight: '900', color: colors.ink },
  installmentItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  instNumber: { fontSize: 13, fontWeight: '900', color: colors.ink },
  instDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
  instAmount: { fontSize: 13, fontWeight: '900', color: colors.red, minWidth: 85, textAlign: 'right' },
  instStatus: { fontSize: 12, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.softBlue, color: colors.primaryDark, minWidth: 78, textAlign: 'center', overflow: 'hidden' },
  instStatusPaid: { backgroundColor: colors.softGreen, color: colors.green },
  instStatusCanceled: { backgroundColor: colors.red, color: '#fff' },
  instStatusOverdue: { backgroundColor: colors.red, color: '#fff' },
  actionBox: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 14, maxWidth: 500, width: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '900', color: colors.ink },
  modalSubtitle: { fontSize: 14, color: colors.muted },
  fieldLabel: { fontSize: 12, fontWeight: '900', color: colors.ink, marginTop: 10 },
  reasonInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 14, color: colors.ink, minHeight: 100, textAlignVertical: 'top' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkbox: { width: 20, height: 20, borderWidth: 2, borderColor: colors.border, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: '#fff', fontWeight: '900', fontSize: 12 },
  checkboxLabel: { flex: 1, fontSize: 13, color: colors.ink, fontWeight: '600' },
  infoBox: { backgroundColor: colors.softBlue, padding: 10, borderRadius: 8 },
  infoText: { fontSize: 13, fontWeight: '900', color: colors.primaryDark },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  detailsModalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 20, maxWidth: 560, width: '100%', maxHeight: '85%' },
});
