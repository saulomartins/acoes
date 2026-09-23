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
  loggedInUsers: number;
  neverLoggedIn: number;
  ownersNeverLoggedInTenantActive: number;
  deletedUsers: number;
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
  planName: string | null;
  planType: 'per_active_user' | 'tiered_bracket' | 'included_overage' | null;
  planActiveUserMetric: 'login_enabled' | 'registered' | null;
  planActiveUsers: number | null;
  planLimit: number | null;
  planExceeded: boolean;
  // Só preenchidos quando planType='included_overage'.
  planIncludedQuantity: number | null;
  planBasePriceCents: number | null;
  planOveragePriceCents: number | null;
  planOverageUnits: number | null;
  planOverageAmountCents: number | null;
  planEstimatedMonthlyAmountCents: number | null;
};

type Bucket = 'registered' | 'active' | 'inactive' | 'logged_in' | 'never_logged_in' | 'owners_never_logged_in_tenant_active' | 'deleted' | 'registered_owners' | 'registered_tenants' | 'real_tenant_residents' | 'owner_residents' | 'owners_monitoring_elsewhere' | 'sindico' | 'subsindico';
const BUCKET_LABEL: Record<Bucket, string> = {
  registered: 'Cadastrados',
  active: 'Ativos',
  inactive: 'Inativos',
  logged_in: 'Já logaram no sistema',
  never_logged_in: 'Nunca logaram',
  owners_never_logged_in_tenant_active: 'Proprietários que nunca logaram (inquilino ativo já logou)',
  deleted: 'Excluídos logicamente',
  registered_owners: 'Proprietários (cadastrados)',
  registered_tenants: 'Inquilinos (cadastrados)',
  real_tenant_residents: 'Inquilinos morando de fato',
  owner_residents: 'Proprietários morando na própria unidade',
  owners_monitoring_elsewhere: 'Proprietários que monitoram outra unidade',
  sindico: 'Síndico',
  subsindico: 'Subsíndico',
};

const planMetricLabel = (metric: 'login_enabled' | 'registered' | null) => metric === 'login_enabled' ? 'login habilitado' : 'cadastrado';
const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
    { key: 'summary', title: 'Usuários por condomínio', description: 'Cadastro mostra o papel de cada pessoa (proprietário, inquilino, síndico ou subsíndico) — a soma dos quatro sempre bate com o total de cadastrados, mostrado na linha de conferência. Síndico e subsíndico têm prioridade: quem tem papel principal de proprietário mas também um perfil adicional de síndico/subsíndico é contado só como síndico/subsíndico, nunca como proprietário — a lista de nomes ao tocar no número mostra "(perfil adicional)" nesse caso. A mesma prioridade vale quando é o mesmo CPF/CNPJ cadastrado em duas contas separadas no condomínio (ex.: uma vez como síndico sem unidade, outra como proprietário de uma unidade própria) — contam como uma pessoa só, síndico/subsíndico, em vez de aparecer duas vezes. Ativos/Inativos divide o total cadastrado pelo acesso ao app estar habilitado ou não — já "Já logaram no sistema" / "Nunca logaram" mostra quem de fato chegou a entrar no app pelo menos uma vez, independente do acesso estar habilitado hoje. Um proprietário que nunca logou mas cuja unidade tem "Unidade alugada a terceiros" marcado e o inquilino cadastrado, ativo, já logou não entra em "Nunca logaram" — ele aparece à parte em "Proprietários que nunca logaram, mas o inquilino ativo já logou", porque quem de fato usa o sistema pela unidade é o inquilino, não o proprietário que só acompanha o boleto. "Excluídos logicamente" é diferente de "Inativo": inativo é login travado mas o cadastro segue contando normalmente no total acima; excluído logicamente saiu de vez da lista de cadastrados (mesmo critério da aba "Excluídos" de Pessoas), por isso esse número fica fora da soma de "Cadastro" e "Acesso ao app" — é reversível em Pessoas. "Unidades / apartamentos" mostra o total de unidades cadastradas no condomínio (independente de morador) e como elas se dividem entre com e sem morador ativo no momento — soma sempre bate com o total. "Proprietários que também monitoram outra unidade" mostra quem tem posse ativa (unit_ownerships) de uma unidade diferente da própria — normalmente uma unidade alugada a um inquilino; isso não é exclusivo com morar na própria unidade, então esse número não é subtraído do total de proprietários. "Quem mora de fato na unidade" é diferente de "cadastrado": proprietário e inquilino cadastrados indicam o responsável financeiro; já "inquilino morando de fato" e "proprietário morando na própria unidade" refletem quem realmente ocupa o imóvel, com base no campo opcional "Unidade alugada a terceiros" preenchido em Pessoas quando o proprietário responsável financeiro aluga a unidade a alguém não cadastrado no sistema. "Uso do plano da plataforma" compara o total de usuários ativos do condomínio (mesma contagem usada de verdade na fatura da plataforma — critério "cadastrado" ou "login habilitado" conforme o plano contratado, em Planos da plataforma) com o plano contratado. Em plano de faixa fechada com a última faixa tendo um "Até" definido, passar do limite mostra aviso vermelho "excedeu" (plano "por usuário ativo", ou faixa fechada com a última faixa em aberto, não tem teto, então nunca "excede"). Em plano "base + incluídos + excedente" (ex.: Essencial/Intermediário/Completo da proposta comercial), passar da quantidade incluída não é erro: aparece em âmbar, com o preço base, quantos usuários excedentes e o custo mensal estimado com o excedente — cobrado automaticamente, nada é bloqueado nos dois casos. Toque em qualquer número para ver os nomes e apartamentos correspondentes (a contagem de unidades e o uso do plano não são clicáveis). A tela atualiza sozinha a cada 30 segundos.' },
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
              <Pressable style={[s.summary, s.summaryActive, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'logged_in')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.activeText]}>{item.loggedInUsers}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>já logaram no sistema</Text>
              </Pressable>
              <Pressable style={[s.summary, s.summaryInactive, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'never_logged_in')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.inactiveText]}>{item.neverLoggedIn}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>nunca logaram</Text>
              </Pressable>
            </View>

            <Text style={s.groupLabel}>Proprietários que nunca logaram, mas o inquilino ativo já logou</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, s.summaryMonitor, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'owners_never_logged_in_tenant_active')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.monitorText]}>{item.ownersNeverLoggedInTenantActive}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>proprietário{item.ownersNeverLoggedInTenantActive === 1 ? '' : 's'} com "Unidade alugada a terceiros" marcado e nunca logou, mas o inquilino ativo da própria unidade já logou — não entra em "nunca logaram" acima</Text>
              </Pressable>
            </View>

            <Text style={s.groupLabel}>Excluídos logicamente</Text>
            <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
              <Pressable style={[s.summary, s.summaryMonitor, compact && s.summaryMobile]} onPress={() => openDetail(item.condominiumId, item.name, 'deleted')}>
                <Text {...summaryValueProps} style={[s.summaryValue, s.monitorText]}>{item.deletedUsers}</Text>
                <Text {...summaryLabelProps} style={s.summaryLabel}>excluído{item.deletedUsers === 1 ? '' : 's'} logicamente — não entra no total de cadastrados acima, cadastro fica guardado e reversível em Pessoas &gt; "Excluídos"</Text>
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

            {item.planName ? (
              <>
                <Text style={s.groupLabel}>Uso do plano da plataforma</Text>
                <Text style={s.planHeadline}>
                  Plano contratado: <Text style={s.planHeadlineName}>{item.planName}</Text>
                  {item.planType === 'included_overage'
                    ? ` — ${formatCurrency(item.planBasePriceCents || 0)}/mês inclui até ${item.planIncludedQuantity} usuário${item.planIncludedQuantity === 1 ? '' : 's'} (${planMetricLabel(item.planActiveUserMetric)}); usuário excedente: ${formatCurrency(item.planOveragePriceCents || 0)} cada`
                    : ''}
                </Text>
                {item.planEstimatedMonthlyAmountCents != null ? (
                  <Text style={[s.planHeadline, (item.planOverageUnits || 0) > 0 && s.monitorText]}>
                    Até o momento, o valor do mês está em <Text style={s.planHeadlineName}>{formatCurrency(item.planEstimatedMonthlyAmountCents)}</Text>
                    {(item.planOverageUnits || 0) > 0
                      ? ` (${formatCurrency(item.planBasePriceCents || 0)} do plano + ${item.planOverageUnits} excedente${item.planOverageUnits === 1 ? '' : 's'} × ${formatCurrency(item.planOveragePriceCents || 0)} = ${formatCurrency(item.planOverageAmountCents || 0)})`
                      : ''}
                  </Text>
                ) : null}
                <View style={[s.summaryRow, compact && s.summaryRowMobile]}>
                  {item.planType === 'included_overage' && item.planIncludedQuantity != null ? (
                    <View style={[s.summary, (item.planOverageUnits || 0) > 0 ? s.summaryMonitor : s.summaryActive, compact && s.summaryMobile]}>
                      <Text {...summaryValueProps} style={[s.summaryValue, (item.planOverageUnits || 0) > 0 ? s.monitorText : s.activeText]}>
                        {item.planActiveUsers} / {item.planIncludedQuantity}
                      </Text>
                      <Text {...summaryLabelProps} style={s.summaryLabel}>
                        usuário{item.planActiveUsers === 1 ? '' : 's'} ({planMetricLabel(item.planActiveUserMetric)}) incluídos no plano
                        {(item.planOverageUnits || 0) > 0 ? ' — passou do incluído' : ' — dentro do incluído'}
                      </Text>
                    </View>
                  ) : (
                    <View style={[s.summary, item.planExceeded ? s.summaryExceeded : item.planLimit != null ? s.summaryActive : undefined, compact && s.summaryMobile]}>
                      <Text {...summaryValueProps} style={[s.summaryValue, item.planExceeded && s.exceededText]}>
                        {item.planLimit != null ? `${item.planActiveUsers} / ${item.planLimit}` : item.planActiveUsers}
                      </Text>
                      <Text {...summaryLabelProps} style={s.summaryLabel}>
                        {item.planExceeded ? '⚠ ' : ''}usuário{item.planActiveUsers === 1 ? '' : 's'} ({planMetricLabel(item.planActiveUserMetric)}) no plano "{item.planName}"
                        {item.planLimit != null
                          ? (item.planExceeded ? ` — excedeu o total permitido em ${(item.planActiveUsers || 0) - item.planLimit}` : ' — dentro do total permitido pelo plano')
                          : ' — este plano não tem limite de usuários'}
                      </Text>
                    </View>
                  )}
                </View>
              </>
            ) : null}
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
  planHeadline: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  planHeadlineName: { fontWeight: '900', color: colors.primaryDark },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  summaryRowMobile: { flexDirection: 'column', gap: 8 },
  summary: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: 16 },
  summaryMobile: { minWidth: 0 },
  summaryActive: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  summaryInactive: { borderColor: colors.border, backgroundColor: '#f2f4f7' },
  summaryMonitor: { borderColor: '#f0d9a8', backgroundColor: '#fdf7ea' },
  summaryExceeded: { borderColor: colors.red, backgroundColor: '#fbeaea' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: colors.ink },
  activeText: { color: colors.green },
  inactiveText: { color: colors.muted },
  monitorText: { color: colors.amber },
  exceededText: { color: colors.red },
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
