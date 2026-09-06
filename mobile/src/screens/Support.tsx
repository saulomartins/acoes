import React, { useCallback, useContext, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppDialog, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Condominium = { id: string; name: string };
type Person = { id: string; full_name: string | null; username: string; cpf: string | null; role: string; unit: string | null };
type TargetStatus = {
  id: string; full_name: string | null; username: string; email: string | null; role: string;
  condominium_name: string | null; unit_number: string | null; login_enabled: boolean; deleted_at: string | null;
  terms_accepted_version: string | null; terms_accepted_at: string | null; hasActiveSession: boolean;
};
type Dialog = { title: string; message: string; tone: 'info' | 'success' | 'error'; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void };

const roleLabel: Record<string, string> = { admin_geral: 'Administrador geral', sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };

const tourSteps: TourStep[] = [
  { key: 'find', title: 'Localizar pessoa', description: 'Administrador geral escolhe primeiro o condomínio (qualquer um); síndico e subsíndico já começam direto na busca, restrita a moradores (proprietário/inquilino) do próprio condomínio. Busque por nome, usuário ou CPF — as ações abaixo só ficam disponíveis depois de selecionar alguém.' },
  { key: 'actions', title: 'Ações corretivas', description: '"Forçar logout" revoga todas as sessões (obriga novo login) — resolve o caso de sessão travada por corrida de refresh token. "Destravar login" reativa acesso desabilitado. "Resetar senha" e "Reenviar e-mail de acesso" geram uma senha temporária nova (não é possível recuperar a senha original, só o hash é guardado). "Limpar aceite dos Termos" faz a pessoa ver a tela de Termos de novo no próximo acesso. Toda ação fica registrada em Auditoria.' },
];

export default function Support() {
  const { userToken, user } = useContext(AuthContext);
  // admin_geral escolhe o condomínio (age em qualquer um); síndico/subsíndico
  // não têm esse passo — o backend já restringe automaticamente ao próprio
  // condomínio e só a moradores (proprietário/inquilino).
  const isAdmin = user?.role === 'admin_geral';
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumSearch, setCondominiumSearch] = useState('');
  const [condominiumId, setCondominiumId] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [personSearch, setPersonSearch] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [status, setStatus] = useState<TargetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [lastPassword, setLastPassword] = useState<{ label: string; value: string } | null>(null);

  const loadPeople = useCallback(async (forCondominiumId: string) => {
    if (!userToken) return;
    setSelectedPersonId(''); setStatus(null); setPersonSearch(''); setLoading(true); setError('');
    try {
      const result = await apiRequest<{ users: Person[] }>(`/support/people${forCondominiumId ? `?condominiumId=${forCondominiumId}` : ''}`, userToken);
      setPeople(result.users);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar pessoas.'); }
    finally { setLoading(false); }
  }, [userToken]);

  const loadCondominiums = useCallback(async () => {
    if (!userToken || !isAdmin) return;
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ condominiums: Condominium[] }>('/condominiums', userToken);
      setCondominiums(result.condominiums);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar condomínios.'); }
    finally { setLoading(false); }
  }, [userToken, isAdmin]);
  React.useEffect(() => { if (isAdmin) loadCondominiums(); else loadPeople(''); }, [isAdmin, loadCondominiums, loadPeople]);

  const pickCondominium = (id: string) => { setCondominiumId(id); loadPeople(id); };

  const loadStatus = useCallback(async (personId: string) => {
    if (!userToken) return;
    if (isAdmin && !condominiumId) return;
    setLoading(true); setError('');
    try {
      const result = await apiRequest<{ user: TargetStatus }>(`/support/users/${personId}${isAdmin ? `?condominiumId=${condominiumId}` : ''}`, userToken);
      setStatus(result.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar status.'); setStatus(null); }
    finally { setLoading(false); }
  }, [userToken, isAdmin, condominiumId]);

  const pickPerson = (id: string) => { setSelectedPersonId(id); loadStatus(id); };

  const runAction = async (path: string, successPrefix?: string) => {
    if (!userToken || !selectedPersonId) return;
    setLoading(true); setError(''); setNotice(''); setDialog(null);
    try {
      const result = await apiRequest<{ message: string; newPassword?: string }>(`/support/users/${selectedPersonId}/${path}`, userToken, { method: 'POST', body: JSON.stringify({ condominiumId }) });
      setNotice(result.message);
      if (result.newPassword) setLastPassword({ label: successPrefix || 'Nova senha', value: result.newPassword });
      await loadStatus(selectedPersonId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.'); }
    finally { setLoading(false); }
  };

  const confirmAction = (title: string, message: string, path: string, successPrefix?: string) =>
    setDialog({ title, message, tone: 'info', confirmLabel: 'Confirmar', cancelLabel: 'Cancelar', onConfirm: () => runAction(path, successPrefix) });

  const filteredCondominiums = condominiumSearch.trim().length >= 2
    ? condominiums.filter(c => c.name.toLocaleLowerCase('pt-BR').includes(condominiumSearch.trim().toLocaleLowerCase('pt-BR')))
    : condominiums;
  const filteredPeople = personSearch.trim().length >= 2
    ? people.filter(p => (p.full_name || '').toLocaleLowerCase('pt-BR').includes(personSearch.trim().toLocaleLowerCase('pt-BR')) || p.username.toLocaleLowerCase('pt-BR').includes(personSearch.trim().toLocaleLowerCase('pt-BR')) || (p.cpf || '').includes(personSearch.trim()))
    : people;
  const selectedCondominium = condominiums.find(c => c.id === condominiumId) || null;

  return <><ScrollView ref={scrollRef} contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => isAdmin ? loadCondominiums() : loadPeople('')} />}>
    <View style={s.headerRow}><View style={s.grow}><Text style={s.eyebrow}>ADMINISTRAÇÃO</Text><Text style={s.title}>Suporte</Text><Text style={s.subtitle}>{isAdmin ? 'Localize uma pessoa por condomínio e corrija problemas de acesso — sem precisar de SQL manual.' : 'Localize um morador do seu condomínio e corrija problemas de acesso.'}</Text></View><Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable></View>

    <View ref={registerSection('find')} style={[isActive('find') && s.tourHighlight]}>
      <Panel>
        {isAdmin ? <>
          <Text style={s.heading}>1. Condomínio</Text>
          <TextInput placeholder="Buscar condomínio por nome" value={condominiumSearch} onChangeText={setCondominiumSearch} style={s.input} />
          <View style={s.options}>{filteredCondominiums.slice(0, 12).map(c => <Pressable key={c.id} onPress={() => pickCondominium(c.id)} style={[s.option, condominiumId === c.id && s.optionOn]}><Text style={[s.optionText, condominiumId === c.id && s.optionTextOn]}>{c.name}</Text></Pressable>)}</View>
        </> : null}

        {!isAdmin || condominiumId ? <>
          <Text style={s.heading}>{isAdmin ? `2. Pessoa em ${selectedCondominium?.name}` : 'Pessoa'}</Text>
          <TextInput placeholder="Buscar por nome, usuário ou CPF" value={personSearch} onChangeText={setPersonSearch} style={s.input} />
          {!filteredPeople.length ? <EmptyState title="Nenhuma pessoa encontrada" description="Ajuste a busca ou confira o cadastro deste condomínio." /> : <View style={s.list}>{filteredPeople.slice(0, 20).map(p => <Pressable key={p.id} onPress={() => pickPerson(p.id)} style={[s.person, selectedPersonId === p.id && s.personOn]}><Text style={s.personName}>{p.full_name || p.username}</Text><Text style={s.meta}>{roleLabel[p.role] || p.role} · {p.unit || 'Sem unidade'} · {p.cpf || 'CPF não informado'}</Text></Pressable>)}</View>}
        </> : null}
      </Panel>
    </View>

    {error ? <Text style={s.error}>{error}</Text> : null}
    {notice ? <Text style={s.notice}>{notice}</Text> : null}
    {lastPassword ? <View style={s.passwordBox}><Text style={s.passwordLabel}>{lastPassword.label}</Text><Text style={s.passwordValue}>{lastPassword.value}</Text></View> : null}

    {status ? <View ref={registerSection('actions')} style={[isActive('actions') && s.tourHighlight]}>
      <Panel>
        <Text style={s.heading}>{status.full_name || status.username}</Text>
        <Text style={s.meta}>{roleLabel[status.role] || status.role} · {status.condominium_name} {status.unit_number ? `· Apto ${status.unit_number}` : ''}</Text>
        <View style={s.statusRow}><Text style={s.statusLabel}>Login habilitado:</Text><Text style={status.login_enabled ? s.statusOk : s.statusBad}>{status.login_enabled ? 'Sim' : 'Não'}</Text></View>
        <View style={s.statusRow}><Text style={s.statusLabel}>Sessão ativa:</Text><Text style={status.hasActiveSession ? s.statusOk : s.statusBad}>{status.hasActiveSession ? 'Sim' : 'Não'}</Text></View>
        <View style={s.statusRow}><Text style={s.statusLabel}>Termos de Uso:</Text><Text style={status.terms_accepted_version ? s.statusOk : s.statusBad}>{status.terms_accepted_version ? `Aceitou v. ${status.terms_accepted_version}` : 'Não aceitou'}</Text></View>
        {status.deleted_at ? <Text style={s.warning}>Conta excluída — algumas ações não se aplicam. Use "Reativar" em Pessoas primeiro.</Text> : null}

        <View style={s.actions}>
          <Pressable disabled={loading} onPress={() => confirmAction('Forçar logout', `Revogar todas as sessões de ${status.full_name || status.username}? A pessoa precisará logar de novo no próximo acesso.`, 'force-logout')} style={s.actionButton}><Text style={s.actionText}>Forçar logout</Text></Pressable>
          <Pressable disabled={loading || Boolean(status.deleted_at) || status.login_enabled} onPress={() => confirmAction('Destravar login', `Reativar o login de ${status.full_name || status.username}?`, 'unlock-login')} style={[s.actionButton, (status.deleted_at || status.login_enabled) && s.actionButtonDisabled]}><Text style={s.actionText}>Destravar login</Text></Pressable>
          <Pressable disabled={loading} onPress={() => confirmAction('Resetar senha', `Gerar uma nova senha temporária para ${status.full_name || status.username} e enviar por e-mail?`, 'reset-password', 'Senha redefinida')} style={s.actionButton}><Text style={s.actionText}>Resetar senha</Text></Pressable>
          <Pressable disabled={loading} onPress={() => confirmAction('Reenviar e-mail de acesso', `Gerar uma nova senha e reenviar o e-mail de boas-vindas/acesso para ${status.full_name || status.username}?`, 'resend-welcome-email', 'Novo acesso')} style={s.actionButton}><Text style={s.actionText}>Reenviar e-mail de acesso</Text></Pressable>
          <Pressable disabled={loading || !status.terms_accepted_version} onPress={() => confirmAction('Limpar aceite dos Termos', `Limpar o aceite dos Termos de Uso de ${status.full_name || status.username}? A pessoa verá a tela de Termos novamente.`, 'clear-terms-acceptance')} style={[s.actionButton, !status.terms_accepted_version && s.actionButtonDisabled]}><Text style={s.actionText}>Limpar aceite dos Termos</Text></Pressable>
        </View>
      </Panel>
    </View> : null}
  </ScrollView>
    <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
  </>;
}

const s = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 40, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '900', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 20, marginTop: 6 },
  heading: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 14, marginBottom: 10 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, marginBottom: 10, backgroundColor: '#fff' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  optionOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  optionTextOn: { color: '#fff' },
  list: { gap: 6 },
  person: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: '#f7f9fb' },
  personOn: { backgroundColor: colors.softBlue, borderColor: colors.primary },
  personName: { color: colors.ink, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  error: { color: colors.red, fontWeight: '700' },
  notice: { color: colors.green, fontWeight: '800' },
  passwordBox: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.softBlue, borderRadius: 8, padding: 12 },
  passwordLabel: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  passwordValue: { color: colors.ink, fontWeight: '900', fontSize: 18, marginTop: 4 },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  statusLabel: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  statusOk: { color: colors.green, fontWeight: '900', fontSize: 14 },
  statusBad: { color: colors.red, fontWeight: '900', fontSize: 14 },
  warning: { color: colors.red, fontWeight: '700', marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  actionButton: { borderWidth: 1, borderColor: '#bfd1ea', backgroundColor: colors.softBlue, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  actionButtonDisabled: { opacity: 0.5 },
  actionText: { color: colors.primary, fontWeight: '900', fontSize: 13 },
});
