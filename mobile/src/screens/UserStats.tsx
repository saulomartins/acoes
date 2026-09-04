import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import { Text } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { EmptyState, Panel, summaryLabelProps, summaryValueProps } from '../ui/components';
import { ComboBox } from '../ui/ComboBox';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type NamedUser = { id: string; fullName: string };

type CondominiumUserStats = {
  condominiumId: string;
  name: string;
  registeredUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  registeredOwners: number;
  registeredTenants: number;
  realTenantResidents: number;
  ownerResidents: number;
  ownersMonitoringElsewhere: number;
  sindico: NamedUser[];
  subsindico: NamedUser[];
  totalUnits: number;
  unitsWithResident: number;
  unitsWithoutResident: number;
};

type Bucket = 'registered' | 'active' | 'inactive' | 'registered_owners' | 'registered_tenants' | 'real_tenant_residents' | 'owner_residents' | 'owners_monitoring_elsewhere' | 'sindico' | 'subsindico';
const BUCKET_LABEL: Record<Bucket, string> = {
  registered: 'Cadastrados',
  active: 'Ativos',
  inactive: 'Inativos',
  registered_owners: 'Proprietários (cadastrados)',
  registered_tenants: 'Inquilinos (cadastrados)',
  real_tenant_residents: 'Inquilinos morando de fato',
  owner_residents: 'Proprietários morando na própria unidade',
  owners_monitoring_elsewhere: 'Proprietários que monitoram outra unidade',
  sindico: 'Síndico',
  subsindico: 'Subsíndico',
};

type Member = { id: string; fullName: string; role: string; isExtra: boolean; unit: string };
const roleLabel = (role: string) => role === 'sindico' ? 'Síndico' : role === 'subsindico' ? 'Subsíndico' : role === 'proprietario' ? 'Proprietário' : role === 'inquilino' ? 'Inquilino' : role;
const namesOrDash = (list: NamedUser[]) => list.length ? list.map(item => item.fullName).join(', ') : '—';

const REFRESH_INTERVAL_MS = 30000;

export default function UserStats() {
  const { isMobile: compact } = useBreakpoint();
  const { userToken, user } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const isAdmin = user?.role === 'admin_geral';
  const [condominiums, setCondominiums] = useState<CondominiumUserStats[]>([]);
  const [condoOptions, setCondoOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [condoFilter, setCondoFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ condominiumId: string; condominiumName: string; bucket: Bucket } | null>(null);
  const [detailMembers, setDetailMembers] = useState<Member[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!userToken) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const query = isAdmin && condoFilter ? `?condominiumId=${condoFilter}` : '';
      const response = await apiRequest<{ condominiums: CondominiumUserStats[] }>(`/condominiums/user-stats${query}`, userToken);
      setCondominiums(response.condominiums);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Não foi possível carregar o painel de usuários.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userToken, isAdmin, condoFilter]);

  useEffect(() => { load(); }, [load]);
  // Atualização automática — números de usuários mudam com cadastros/ativações
  // feitos em outras telas, então a tela não deve depender só do pull-to-refresh.
  useEffect(() => {
    const timer = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Opções do filtro de condomínio (admin geral): carregado uma vez, sem
  // filtro, para não depender do estado já filtrado da lista principal.
  useEffect(() => {
    if (!userToken || !isAdmin) return;
    apiRequest<{ condominiums: Array<{ id: string; name: string }> }>('/condominiums', userToken)
      .then(data => setCondoOptions(data.condominiums.map(item => ({ id: item.id, name: item.name }))))
      .catch(() => setCondoOptions([]));
  }, [userToken, isAdmin]);

  const openDetail = async (condominiumId: string, condominiumName: string, bucket: Bucket) => {
    if (!userToken) return;
    setDetail({ condominiumId, condominiumName, bucket });
    setDetailMembers([]);
    setDetailLoading(true);
    try {
      const response = await apiRequest<{ members: Member[] }>(`/condominiums/user-stats/members?condominiumId=${condominiumId}&bucket=${bucket}`, userToken);
      setDetailMembers(response.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar a lista.');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const condominiumOptions = [{ value: '', label: 'Todos os condomínios', description: `${condoOptions.length} condomínio(s)` }, ...condoOptions.map(item => ({ value: item.id, label: item.name }))];

  const tourSteps: TourStep[] = [
    { key: 'summary', title: 'Usuários por condomínio', description: 'Cadastro mostra o papel de cada pessoa (proprietário, inquilino, síndico ou subsíndico) — a soma dos quatro sempre bate com o total de cadastrados, mostrado na linha de conferência. Síndico e subsíndico têm prioridade: quem tem papel principal de proprietário mas também um perfil adicional de síndico/subsíndico é contado só como síndico/subsíndico, nunca como proprietário — a lista de nomes ao tocar no número mostra "(perfil adicional)" nesse caso. Ativos/Inativos divide o total cadastrado pelo acesso ao app estar habilitado ou não. "Unidades / apartamentos" mostra o total de unidades cadastradas no condomínio (independente de morador) e como elas se dividem entre com e sem morador ativo no momento — soma sempre bate com o total. "Proprietários que também monitoram outra unidade" mostra quem tem posse ativa (unit_ownerships) de uma unidade diferente da própria — normalmente uma unidade alugada a um inquilino; isso não é exclusivo com morar na própria unidade, então esse número não é subtraído do total de proprietários. "Quem mora de fato na unidade" é diferente de "cadastrado": proprietário e inquilino cadastrados indicam o responsável financeiro; já "inquilino morando de fato" e "proprietário morando na própria unidade" refletem quem realmente ocupa o imóvel, com base no campo opcional "Unidade alugada a terceiros" preenchido em Pessoas quando o proprietário responsável financeiro aluga a unidade a alguém não cadastrado no sistema. Toque em qualquer número para ver os nomes e apartamentos correspondentes (a contagem de unidades não é clicável). A tela atualiza sozinha a cada 30 segundos.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}>
      <View style={s.headerRow}>
        <View style={s.grow}>
          <Text style={s.eyebrow}>USUÁRIOS</Text>
          <Text style={s.title}>Painel de usuários</Text>
          <Text style={s.subtitle}>
            {isAdmin ? 'Cadastro, acesso e ocupação de cada condomínio. Toque em um número para ver quem são.' : `Cadastro, acesso e ocupação de ${user?.condominiumName || 'seu condomínio'}. Toque em um número para ver quem são.`}
          </Text>
        </View>
        <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      {isAdmin ? (
        <Panel>
          <Text style={s.label}>Filtrar por condomínio</Text>
          <ComboBox options={condominiumOptions} value={condoFilter} onChange={setCondoFilter} placeholder="Todos os condomínios" title="Condomínio" searchPlaceholder="Buscar condomínio" emptyText="Nenhum condomínio encontrado." />
        </Panel>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View ref={registerSection('summary')} style={[isActive('summary') && s.tourHighlight]}>
        {condominiums.length === 0 && !loading ? (
          <EmptyState title="Nenhum condomínio encontrado" description="Não há dados de usuários para exibir." />
        ) : condominiums.map(item => (
          <Panel key={item.condominiumId}>
            <Text style={s.condoName}>{item.name}</Text>

            <Text style={s.groupLabel}>Cadastro</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'registered')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.registeredUsers}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>cadastrado{item.registeredUsers === 1 ? '' : 's'}</Text>
              </Pressable>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'registered_owners')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.registeredOwners}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>proprietário{item.registeredOwners === 1 ? '' : 's'} (cadastrado{item.registeredOwners === 1 ? '' : 's'})</Text>
              </Pressable>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'registered_tenants')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.registeredTenants}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>inquilino{item.registeredTenants === 1 ? '' : 's'} (cadastrado{item.registeredTenants === 1 ? '' : 's'})</Text>
              </Pressable>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'sindico')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.sindico.length}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>síndico: {namesOrDash(item.sindico)}</Text>
              </Pressable>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'subsindico')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.subsindico.length}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>subsíndico: {namesOrDash(item.subsindico)}</Text>
              </Pressable>
            </View>
            <Text style={s.checksum}>{item.registeredOwners} proprietário{item.registeredOwners === 1 ? '' : 's'} + {item.registeredTenants} inquilino{item.registeredTenants === 1 ? '' : 's'} + {item.sindico.length} síndico{item.sindico.length === 1 ? '' : 's'} + {item.subsindico.length} subsíndico{item.subsindico.length === 1 ? '' : 's'} = {item.registeredOwners + item.registeredTenants + item.sindico.length + item.subsindico.length} de {item.registeredUsers} cadastrado{item.registeredUsers === 1 ? '' : 's'}</Text>

            <Text style={s.groupLabel}>Acesso ao app</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, s.summaryActive, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'active')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.activeText]}>{item.activeUsers}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>ativo{item.activeUsers === 1 ? '' : 's'}</Text>
              </Pressable>
              <Pressable style={[s.summary, s.summaryInactive, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'inactive')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.inactiveText]}>{item.inactiveUsers}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>inativo{item.inactiveUsers === 1 ? '' : 's'}</Text>
              </Pressable>
            </View>

            <Text style={s.groupLabel}>Unidades / apartamentos</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <View style={[s.summary, compact && s.summaryMobile]}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.totalUnits}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>unidade{item.totalUnits === 1 ? '' : 's'} / apartamento{item.totalUnits === 1 ? '' : 's'}</Text>
              </View>
              <View style={[s.summary, s.summaryActive, compact && s.summaryMobile]}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.activeText]}>{item.unitsWithResident}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>com morador</Text>
              </View>
              <View style={[s.summary, s.summaryInactive, compact && s.summaryMobile]}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.inactiveText]}>{item.unitsWithoutResident}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>sem morador</Text>
              </View>
            </View>

            <Text style={s.groupLabel}>Proprietários que também monitoram outra unidade</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, s.summaryMonitor, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'owners_monitoring_elsewhere')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.monitorText]}>{item.ownersMonitoringElsewhere}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>proprietário{item.ownersMonitoringElsewhere === 1 ? '' : 's'} com posse de outra unidade (ex.: alugada a um inquilino) além da própria — inclusive quem também mora no condomínio</Text>
              </Pressable>
            </View>

            <Text style={s.groupLabel}>Quem mora de fato na unidade</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'real_tenant_residents')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.realTenantResidents}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>inquilino{item.realTenantResidents === 1 ? '' : 's'} morando de fato</Text>
              </Pressable>
              <Pressable style={[s.summary, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'owner_residents')}>
                <Text {...summaryValueProps} style={s.summaryValue}>{item.ownerResidents}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>proprietário{item.ownerResidents === 1 ? '' : 's'} morando na própria unidade</Text>
              </Pressable>
            </View>
          </Panel>
        ))}
      </View>
    </ScrollView>

    <Modal visible={Boolean(detail)} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
      <Pressable style={s.modalBackdrop} onPress={() => setDetail(null)}>
        <Pressable style={s.modalCard} onPress={() => {}}>
          <Text style={s.modalTitle}>{detail ? BUCKET_LABEL[detail.bucket] : ''}</Text>
          <Text style={s.modalSubtitle}>{detail?.condominiumName}</Text>
          <ScrollView style={s.modalList}>
            {detailLoading ? <Text style={s.modalEmpty}>Carregando...</Text> : detailMembers.length === 0 ? <Text style={s.modalEmpty}>Ninguém nesta categoria.</Text> : detailMembers.map(member => (
              <View key={member.id} style={s.modalRow}>
                <Text style={s.modalName}>{member.fullName}</Text>
                <Text style={s.modalMeta}>{roleLabel(member.role)}{member.isExtra ? ' (perfil adicional)' : ''} · {member.unit}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={() => setDetail(null)} style={s.modalClose}><Text style={s.modalCloseText}>Fechar</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>

    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const s = StyleSheet.create({
  container: { width: '100%', padding: 24, paddingBottom: 50, gap: 14, backgroundColor: colors.background },
  containerMobile: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink, marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 16, marginVertical: 10 },
  label: { fontWeight: '800', color: colors.ink, marginBottom: 8 },
  error: { color: colors.red, marginVertical: 10 },
  condoName: { fontSize: 18, fontWeight: '900', color: colors.ink },
  groupLabel: { color: colors.muted, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 4 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  summaryRowMobile: { flexDirection: 'column', gap: 8 },
  summary: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16 },
  summaryMobile: { minWidth: 0 },
  summaryActive: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  summaryInactive: { borderColor: colors.border, backgroundColor: '#f2f4f7' },
  summaryMonitor: { borderColor: '#f0d9a8', backgroundColor: '#fdf7ea' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.ink },
  activeText: { color: colors.green },
  inactiveText: { color: colors.muted },
  monitorText: { color: colors.amber },
  summaryLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  checksum: { color: colors.muted, fontSize: 12, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, maxHeight: '80%', borderRadius: 16, backgroundColor: '#fff', padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  modalSubtitle: { color: colors.muted, marginTop: 2, marginBottom: 10 },
  modalList: { maxHeight: 360 },
  modalEmpty: { color: colors.muted, paddingVertical: 12 },
  modalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 },
  modalName: { fontWeight: '800', color: colors.ink },
  modalMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  modalClose: { marginTop: 14, alignSelf: 'flex-end', borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  modalCloseText: { fontWeight: '800', color: colors.ink },
});
