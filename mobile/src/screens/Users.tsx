import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Field, Panel, TextField } from '../ui/components';
import { ComboBox } from '../ui/ComboBox';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type UserRole = 'admin_geral' | 'sindico' | 'subsindico' | 'proprietario' | 'inquilino';

type UserItem = {
  id: string;
  username: string;
  full_name: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  condominium_id: string | null;
  unit: string | null;
  unit_id?: string | null;
  unit_type_id?: string | null;
  unit_type_name?: string | null;
  condominium_fee_cents?: number | null;
  is_unit_representative?: boolean;
  billing_exempt?: boolean;
  preferred_due_day?: 10 | 20;
  street?: string | null; address_number?: string | null; address_complement?: string | null;
  neighborhood?: string | null; city?: string | null; state?: string | null; postal_code?: string | null;
  deleted_at?: string | null;
};

type UsersResponse = {
  users: UserItem[];
};

type Condominium = {
  id: string;
  name: string;
  cnpj: string | null;
  address: string | null;
};

type CondominiumResponse = {
  condominiums: Condominium[];
};

type UnitType = { id: string; name: string; fee_cents: number; description: string | null; active: boolean };
type UnitTypesResponse = { unitTypes: UnitType[] };
type ManagedUnit = { id: string; block_name: string; number: string; unit_type_id: string | null; unit_type_name: string | null };

const roles: Array<{ value: UserRole; label: string }> = [
  { value: 'admin_geral', label: 'Admin geral' },
  { value: 'sindico', label: 'Sindico' },
  { value: 'subsindico', label: 'Subsindico' },
  { value: 'proprietario', label: 'Proprietario' },
  { value: 'inquilino', label: 'Inquilino' },
];

const roleLabel = (role: UserRole) => roles.find((item) => item.value === role)?.label || role;

const onlyDigits = (value: string) => value.replace(/\D/g, '');
const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatCpf = (value: string) => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length > 11) return digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\/\d{4})(\d)/, '$1-$2');
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
};

const formatPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  return digits
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
};

const formatPostalCode = (value: string) => {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.replace(/^(\d{5})(\d)/, '$1-$2');
};

const formatDate = (value?: string | null) => {
  if (!value) return 'data desconhecida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data desconhecida';
  return date.toLocaleDateString('pt-BR');
};

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | 'true';
};

export default function Users({ navigation }: any) {
  const { isMobile: mobile } = useBreakpoint();
  const { userToken, user } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [items, setItems] = useState<UserItem[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [unit, setUnit] = useState('');
  const [unitId, setUnitId] = useState('');
  const [isRepresentative, setIsRepresentative] = useState(false);
  const [billingExempt, setBillingExempt] = useState(false);
  const [preferredDueDay, setPreferredDueDay] = useState<10 | 20>(10);
  const [street, setStreet] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [isLookingUpPostalCode, setIsLookingUpPostalCode] = useState(false);
  const [role, setRole] = useState<UserRole | ''>('');
  const [condominiumId, setCondominiumId] = useState('');
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [managedUnits, setManagedUnits] = useState<ManagedUnit[]>([]);
  const [unitTypeCondominiumId, setUnitTypeCondominiumId] = useState('');
  const [unitTypeId, setUnitTypeId] = useState('');
  const [filterCondominiumId, setFilterCondominiumId] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterCpf, setFilterCpf] = useState('');
  const [filterUnitTypeId, setFilterUnitTypeId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: 'info' | 'success' | 'error'; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void; scrollable?: boolean } | null>(null);
  const [selectedForReset, setSelectedForReset] = useState<Set<string>>(new Set());
  const [viewingDeleted, setViewingDeleted] = useState(false);
  // Perfis adicionais (ex.: síndico que também é proprietário) da pessoa em
  // edição — só faz sentido consultar/conceder para alguém já cadastrado.
  const [personProfiles, setPersonProfiles] = useState<Array<{ id: string; role: UserRole; condominiumName: string | null }>>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [newProfileRole, setNewProfileRole] = useState<UserRole | ''>('');
  const [newProfileUnitId, setNewProfileUnitId] = useState('');
  const [grantingProfile, setGrantingProfile] = useState(false);
  const isResidentRole = role === 'proprietario' || role === 'inquilino';
  const isManagerRole = role === 'subsindico' || role === 'sindico';
  const manager = user?.role === 'admin_geral' || user?.role === 'sindico' || user?.role === 'subsindico';
  const canManageItem = (item: UserItem) => user?.role === 'admin_geral'
    ? item.role === 'sindico' || item.role === 'subsindico'
    : item.role === 'proprietario' || item.role === 'inquilino';

  const loadUnitTypes = useCallback(async (targetCondominiumId?: string) => {
    if (!userToken) return;
    const path = user?.role === 'admin_geral'
      ? `/unit-types?condominiumId=${encodeURIComponent(targetCondominiumId || '')}`
      : '/unit-types';
    if (user?.role === 'admin_geral' && !targetCondominiumId) { setUnitTypes([]); return; }
    const response = await apiRequest<UnitTypesResponse>(path, userToken);
    setUnitTypes(response.unitTypes);
  }, [user?.role, userToken]);

  const filteredItems = useMemo(() => {
    const cpfDigits = onlyDigits(filterCpf);
    const normalizedName = filterName.trim().toLocaleLowerCase('pt-BR');
    return items.filter((item) => {
      const matchesCondominium =
        !filterCondominiumId ||
        (filterCondominiumId === '__unlinked__' ? !item.condominium_id : item.condominium_id === filterCondominiumId);
      const matchesCpf = !cpfDigits || onlyDigits(item.cpf || '').includes(cpfDigits);
      const matchesName = !normalizedName || (item.full_name || item.username).toLocaleLowerCase('pt-BR').includes(normalizedName);
      const isResident = item.role === 'proprietario' || item.role === 'inquilino';
      const matchesUnitType = !filterUnitTypeId
        || (filterUnitTypeId === '__missing__' ? isResident && !item.unit_type_id : item.unit_type_id === filterUnitTypeId);
      return matchesCondominium && matchesName && matchesCpf && matchesUnitType;
    });
  }, [filterCondominiumId, filterCpf, filterName, filterUnitTypeId, items]);

  // Condomínio grande tem dezenas de apartamentos: a busca dentro do ComboBox
  // cobre bloco, número e tipologia (a tipologia vai em `description`).
  const unitOptions = useMemo(
    () => managedUnits.map((item) => ({
      value: item.id,
      label: `${item.block_name} · Apartamento ${item.number}`,
      description: item.unit_type_name || 'Sem tipologia',
    })),
    [managedUnits],
  );

  const condominiumName = (condominiumId: string | null) =>
    condominiums.find((item) => item.id === condominiumId)?.name || 'Condomínio não identificado';

  const load = useCallback(async () => {
    if (!userToken) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const path = viewingDeleted ? '/users?deletedOnly=true' : '/users';
      const response = await apiRequest<UsersResponse>(path, userToken);
      setItems(response.users);
      if (user?.role === 'admin_geral') {
        const condominiumResponse = await apiRequest<CondominiumResponse>('/condominiums', userToken);
        setCondominiums(condominiumResponse.condominiums);
        if (condominiumResponse.condominiums.length === 1) {
          const onlyCondominiumId = condominiumResponse.condominiums[0].id;
          setUnitTypeCondominiumId(onlyCondominiumId);
          await loadUnitTypes(onlyCondominiumId);
        }
      } else if (user?.role === 'sindico' || user?.role === 'subsindico') {
        const unitsResponse = await apiRequest<{ units: ManagedUnit[] }>('/units', userToken);
        setManagedUnits(unitsResponse.units);
        await loadUnitTypes();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar usuarios');
    } finally {
      setIsLoading(false);
    }
  }, [loadUnitTypes, user?.role, userToken, viewingDeleted]);

  useEffect(() => {
    setFilterCondominiumId('');
    setFilterName('');
    setFilterCpf('');
    setFilterUnitTypeId('');
    if (user?.role === 'admin_geral') {
      setRole('sindico');
    }
    load();
  }, [load, user?.role]);

  const lookupPostalCode = async () => {
    const digits = onlyDigits(postalCode);
    if (digits.length !== 8) {
      setError('Informe um CEP com 8 dígitos.');
      return;
    }

    setIsLookingUpPostalCode(true);
    setError(null);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!response.ok) throw new Error('Serviço de CEP indisponível. Tente novamente.');
      const address = await response.json() as ViaCepResponse;
      if (address.erro === true || address.erro === 'true') throw new Error('CEP não encontrado.');

      setPostalCode(formatPostalCode(address.cep || digits));
      setStreet(address.logradouro || '');
      setNeighborhood(address.bairro || '');
      setCity(address.localidade || '');
      setAddressState((address.uf || '').toUpperCase());
      if (!addressComplement && address.complemento) setAddressComplement(address.complemento);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível consultar o CEP.');
    } finally {
      setIsLookingUpPostalCode(false);
    }
  };

  const create = async () => {
    if (!userToken) return;
    if (!role) { setError('Selecione o perfil do usuário.'); return; }
    if (!username.trim()) { setError('Informe o usuário de acesso.'); return; }
    if (!editingId && !onlyDigits(cpf)) { setError('Informe o CPF — ele é necessário para gerar a senha inicial.'); return; }
    if (user?.role === 'admin_geral' && !condominiumId.trim()) { setError('Selecione o condomínio.'); return; }
    if (user?.role !== 'admin_geral' && (role === 'proprietario' || role === 'inquilino')) {
      if (!unitId) { setError('Selecione a unidade ou apartamento.'); return; }
    }
    const cpfDigits = onlyDigits(cpf);

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ user: any; initialPassword?: string; emailSent?: boolean }>(editingId ? `/users/${editingId}` : '/users', userToken, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          username: username.trim(),
          role,
          condominiumId: user?.role === 'admin_geral' ? condominiumId.trim() : undefined,
          fullName: fullName.trim() || null,
          cpf: cpfDigits || null,
          email: email.trim() || null,
          phone: onlyDigits(phone) || null,
          unitId: role === 'proprietario' || role === 'inquilino' ? unitId : undefined,
          isRepresentative,
          billingExempt,
          preferredDueDay,
          street: street.trim() || null, addressNumber: addressNumber.trim() || null,
          addressComplement: addressComplement.trim() || null, neighborhood: neighborhood.trim() || null,
          city: city.trim() || null, state: addressState.trim().toUpperCase() || null,
          postalCode: onlyDigits(postalCode) || null,
        }),
      });
      const createdName = fullName.trim() || username.trim();
      const createdUsername = username.trim();
      const createdEmail = email.trim();
      setUsername('');
      setPassword('');
      setFullName('');
      setCpf('');
      setEmail('');
      setPhone('');
      setUnit('');
      setUnitId('');
      setIsRepresentative(false);
      setBillingExempt(false);
      setPreferredDueDay(10);
      setUnitTypeId('');
      setStreet(''); setAddressNumber(''); setAddressComplement(''); setNeighborhood(''); setCity(''); setAddressState(''); setPostalCode('');
      setCondominiumId('');
      setRole('');
      setEditingId(null);
      if (response.initialPassword) {
        const emailNote = response.emailSent
          ? `E-mail enviado para ${createdEmail}.`
          : createdEmail
            ? 'Não foi possível enviar o e-mail — informe a senha manualmente.'
            : 'Sem e-mail cadastrado — informe a senha manualmente.';
        setDialog({
          title: 'Senha inicial gerada',
          message: `${createdName}\nUsuário: ${createdUsername}\nSenha inicial: ${response.initialPassword}\n\n${emailNote}\n\nAnote e informe ao morador — essa senha não será exibida novamente.`,
          tone: 'success',
          confirmLabel: 'Entendi',
          onConfirm: () => setDialog(null),
        });
      } else {
        setSuccess(editingId ? 'Cadastro atualizado.' : user?.role === 'admin_geral' ? 'Gestor cadastrado.' : 'Usuário cadastrado.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cadastrar usuario');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPersonProfiles = useCallback(async (personId: string) => {
    if (!userToken) return;
    setProfilesLoading(true);
    setProfilesError(null);
    try {
      const response = await apiRequest<{ profiles: Array<{ id: string | null; role: UserRole; condominiumName: string | null }> }>(`/users/${personId}/profiles`, userToken);
      // id null é o perfil padrão (a própria pessoa) — não é "removível" aqui, só os extras.
      setPersonProfiles(response.profiles.filter((item): item is { id: string; role: UserRole; condominiumName: string | null } => item.id !== null));
    } catch (e) {
      setProfilesError(e instanceof Error ? e.message : 'Falha ao carregar perfis.');
    } finally {
      setProfilesLoading(false);
    }
  }, [userToken]);

  const grantProfile = async (item: UserItem) => {
    if (!userToken || !newProfileRole) return;
    const isResident = newProfileRole === 'proprietario' || newProfileRole === 'inquilino';
    const grantUnitId = item.unit_id || newProfileUnitId;
    if (isResident && !grantUnitId) { setProfilesError('Selecione a unidade para o perfil de morador.'); return; }
    setGrantingProfile(true);
    setProfilesError(null);
    try {
      await apiRequest(`/users/${item.id}/profiles`, userToken, {
        method: 'POST',
        body: JSON.stringify({
          role: newProfileRole,
          unitId: isResident ? grantUnitId : undefined,
          condominiumId: user?.role === 'admin_geral' ? item.condominium_id : undefined,
        }),
      });
      setNewProfileRole('');
      setNewProfileUnitId('');
      setSuccess('Perfil adicional concedido.');
      await loadPersonProfiles(item.id);
    } catch (e) {
      setProfilesError(e instanceof Error ? e.message : 'Falha ao conceder perfil.');
    } finally {
      setGrantingProfile(false);
    }
  };

  const revokeProfile = async (item: UserItem, profileId: string) => {
    if (!userToken) return;
    setGrantingProfile(true);
    setProfilesError(null);
    try {
      await apiRequest(`/users/${item.id}/profiles/${profileId}`, userToken, { method: 'DELETE' });
      setSuccess('Perfil adicional removido.');
      await loadPersonProfiles(item.id);
    } catch (e) {
      setProfilesError(e instanceof Error ? e.message : 'Falha ao remover perfil.');
    } finally {
      setGrantingProfile(false);
    }
  };

  const startEditing = (item: UserItem) => {
    setEditingId(item.id);
    setPersonProfiles([]);
    setNewProfileRole('');
    setNewProfileUnitId('');
    setProfilesError(null);
    void loadPersonProfiles(item.id);
    setUsername(item.username);
    setPassword('');
    setFullName(item.full_name || '');
    setCpf(item.cpf ? formatCpf(item.cpf) : '');
    setEmail(item.email || '');
    setPhone(item.phone ? formatPhone(item.phone) : '');
    setUnit(item.unit || '');
    setUnitId(item.unit_id || '');
    setIsRepresentative(Boolean(item.is_unit_representative));
    setBillingExempt(Boolean(item.billing_exempt));
    setPreferredDueDay(item.preferred_due_day === 20 ? 20 : 10);
    setRole(item.role);
    setCondominiumId(item.condominium_id || '');
    setUnitTypeId(item.unit_type_id || '');
    setStreet(item.street || ''); setAddressNumber(item.address_number || ''); setAddressComplement(item.address_complement || '');
    setNeighborhood(item.neighborhood || ''); setCity(item.city || ''); setAddressState(item.state || ''); setPostalCode(item.postal_code ? formatPostalCode(item.postal_code) : '');
    setError(null); setSuccess(null);
  };

  const cancelEditing = () => {
    setEditingId(null); setUsername(''); setPassword(''); setFullName(''); setCpf(''); setEmail(''); setPhone(''); setUnit(''); setUnitId(''); setIsRepresentative(false); setBillingExempt(false); setPreferredDueDay(10); setCondominiumId(''); setUnitTypeId('');
    setPersonProfiles([]); setNewProfileRole(''); setNewProfileUnitId(''); setProfilesError(null);
    setStreet(''); setAddressNumber(''); setAddressComplement(''); setNeighborhood(''); setCity(''); setAddressState(''); setPostalCode('');
    setRole('');
  };

  const selectRole = (nextRole: UserRole) => {
    if (nextRole !== 'proprietario') { setRole(nextRole); return; }
    setDialog({
      title: 'Confirmar perfil Proprietário',
      message: 'Você tem certeza? O perfil Proprietário poderá visualizar o saldo bancário mensal do condomínio.',
      tone: 'info',
      confirmLabel: 'Sim, selecionar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); setRole('proprietario'); },
    });
  };

  const toggleSelectedForReset = (id: string) => setSelectedForReset((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const formatResetMessage = (results: Array<{ fullName: string | null; username: string; newPassword: string; emailSent: boolean }>, skipped: Array<{ fullName: string | null; reason: string }>) => {
    const lines = results.map((r) => `${r.fullName || r.username} (${r.username}): ${r.newPassword}${r.emailSent ? ' · e-mail enviado' : ''}`);
    const skipLines = skipped.map((s) => `${s.fullName || 'Pessoa'}: não foi possível gerar — ${s.reason}`);
    return [...lines, ...skipLines].join('\n') || 'Nenhuma senha foi alterada.';
  };

  const performReset = async (payload: ({ role: 'proprietario' | 'inquilino' | 'sindico' | 'subsindico' | 'all' } | { ids: string[] }) & { condominiumId?: string }) => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<{ results: Array<{ id: string; fullName: string | null; username: string; newPassword: string; emailSent: boolean }>; skipped: Array<{ id: string; fullName: string | null; reason: string }> }>('/users/reset-password', userToken, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSelectedForReset(new Set());
      setDialog({
        title: 'Senhas atualizadas',
        message: formatResetMessage(response.results, response.skipped),
        tone: 'success',
        confirmLabel: 'Entendi',
        scrollable: true,
        onConfirm: () => setDialog(null),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao resetar senha.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmResetAllResidents = () => {
    const count = items.filter((item) => item.role === 'proprietario' || item.role === 'inquilino').length;
    setDialog({
      title: 'Confirmar reset em massa',
      message: `Isso vai gerar uma nova senha inicial para todos os proprietários e inquilinos deste condomínio (${count}). Continuar?`,
      tone: 'error',
      confirmLabel: 'Sim, resetar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); performReset({ role: 'all' }); },
    });
  };

  const confirmResetAllManagers = () => {
    if (!filterCondominiumId || filterCondominiumId === '__unlinked__') {
      setError('Selecione um condomínio no filtro para resetar em massa.');
      return;
    }
    const count = items.filter((item) => item.condominium_id === filterCondominiumId && (item.role === 'sindico' || item.role === 'subsindico')).length;
    setDialog({
      title: 'Confirmar reset em massa',
      message: `Isso vai gerar uma nova senha inicial para todos os síndicos e subsíndicos de "${condominiumName(filterCondominiumId)}" (${count}). Continuar?`,
      tone: 'error',
      confirmLabel: 'Sim, resetar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); performReset({ role: 'all', condominiumId: filterCondominiumId }); },
    });
  };

  const confirmResetSelected = () => {
    const ids = [...selectedForReset];
    if (!ids.length) return;
    if (user?.role === 'admin_geral' && (!filterCondominiumId || filterCondominiumId === '__unlinked__')) {
      setError('Selecione um condomínio no filtro para resetar os selecionados.');
      return;
    }
    setDialog({
      title: 'Confirmar reset de senha',
      message: `Isso vai gerar uma nova senha inicial para ${ids.length} pessoa(s) selecionada(s). Continuar?`,
      tone: 'error',
      confirmLabel: 'Sim, resetar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); performReset(user?.role === 'admin_geral' ? { ids, condominiumId: filterCondominiumId } : { ids }); },
    });
  };

  const confirmResetOne = (item: UserItem) => {
    setDialog({
      title: 'Confirmar reset de senha',
      message: `Gerar uma nova senha inicial para ${item.full_name || item.username}?`,
      tone: 'error',
      confirmLabel: 'Sim, resetar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); performReset(user?.role === 'admin_geral' ? { ids: [item.id], condominiumId: item.condominium_id || undefined } : { ids: [item.id] }); },
    });
  };

  const runManagerAction = async (path: string, method: 'POST' | 'DELETE', successMessage: string) => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest(path, userToken, { method });
      setSuccess(successMessage);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao processar a solicitação.');
    } finally {
      setIsLoading(false);
    }
  };

  const confirmSoftDelete = (item: UserItem) => {
    setDialog({
      title: 'Confirmar exclusão lógica',
      message: `Excluir logicamente ${item.full_name || item.username}? A pessoa deixa de aparecer na lista de ativos e não consegue mais entrar no app, mas o cadastro fica guardado e pode ser reativado depois na aba "Excluídos".`,
      tone: 'error',
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); runManagerAction(`/users/${item.id}/soft-delete`, 'POST', 'Pessoa excluída logicamente.'); },
    });
  };

  const confirmHardDelete = (item: UserItem) => {
    const isResidentItem = item.role === 'proprietario' || item.role === 'inquilino';
    const consequence = isResidentItem
      ? 'O vínculo com o condomínio e a unidade, os débitos, o histórico de acordos e os avisos/comunicações desta pessoa também serão apagados.'
      : 'Se essa pessoa já respondeu chamados de moradores, essas respostas também serão apagadas do histórico de conversa.';
    setDialog({
      title: 'Confirmar exclusão física',
      message: `Excluir PERMANENTEMENTE ${item.full_name || item.username}? Esta ação não pode ser desfeita. ${consequence}`,
      tone: 'error',
      confirmLabel: 'Excluir para sempre',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); runManagerAction(`/users/${item.id}`, 'DELETE', 'Pessoa excluída permanentemente.'); },
    });
  };

  const confirmReactivate = (item: UserItem) => {
    setDialog({
      title: 'Reativar pessoa',
      message: `Reativar ${item.full_name || item.username}? O login volta a funcionar e a pessoa volta a aparecer na lista de ativos.`,
      tone: 'info',
      confirmLabel: 'Reativar',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); runManagerAction(`/users/${item.id}/reactivate`, 'POST', 'Pessoa reativada.'); },
    });
  };

  const isAdmin = user?.role === 'admin_geral';
  const adminTourSteps: TourStep[] = [
    { key: 'form', title: 'Cadastrar síndico ou subsíndico', description: 'Usuário de acesso é único no sistema (usado no login). CPF é obrigatório num cadastro novo — os 6 primeiros dígitos viram a senha inicial, gerada e mostrada uma única vez depois de salvar (ou enviada por e-mail, se informado). Selecione o condomínio que esse gestor vai administrar e o perfil (Síndico ou Subsíndico). Ao editar alguém, aparece o painel "Perfis desta pessoa" — um mesmo login pode acumular mais de um perfil (ex.: síndico que também é proprietário em outra unidade); conceda ou remova perfis extras ali.' },
    { key: 'filters', title: 'Filtrar cadastros', description: 'Combine condomínio (inclusive "Sem condomínio"), nome e CPF pra localizar um síndico ou subsíndico específico entre todos os condomínios.' },
    { key: 'reset', title: 'Reset de senha em massa', description: 'Selecione um condomínio no filtro acima pra habilitar "Resetar todos deste condomínio" — gera uma nova senha inicial (regra padrão: 6 primeiros dígitos do CPF) pra todos os síndicos/subsíndicos daquele condomínio de uma vez. Ou marque pessoas específicas nos cards da lista e use "Resetar selecionados".' },
    { key: 'list', title: 'Ativos e excluídos', description: 'As abas "Ativos"/"Excluídos" alternam a lista. Em cada card dá pra editar, resetar a senha individualmente, excluir logicamente (bloqueia o login mas mantém o cadastro — reversível na aba "Excluídos" com "Reativar") ou excluir fisicamente (apaga o cadastro pra sempre, sem volta). Aqui você só gerencia cadastros de síndico e subsíndico.' },
  ];
  const managerTourSteps: TourStep[] = [
    { key: 'form', title: 'Cadastrar morador ou subsíndico', description: 'Escolha o perfil (Subsíndico, Proprietário ou Inquilino), a unidade/apartamento (obrigatória para moradores) e marque se a pessoa é representante da unidade. Se não for isenta de boleto, defina o dia preferido de vencimento (10 ou 20). Preencha o endereço de cobrança do boleto — o CEP autocompleta rua, bairro, cidade e UF. A senha inicial é gerada automaticamente (apartamento + 4 primeiros dígitos do CPF) e mostrada uma única vez depois de salvar. Ao editar alguém, o painel "Perfis desta pessoa" permite conceder ou remover perfis adicionais (ex.: um subsíndico que também é proprietário).' },
    { key: 'filters', title: 'Filtrar moradores', description: 'Filtre por nome, CPF ou tipologia do apartamento — inclusive "Sem tipologia", útil pra achar quem ainda não tem uma taxa condominial configurada.' },
    { key: 'reset', title: 'Reset de senha em massa', description: 'Gera uma nova senha inicial pela regra padrão (apartamento + 4 primeiros dígitos do CPF). "Resetar todos os moradores" afeta todo mundo do condomínio de uma vez; ou marque pessoas específicas nos cards da lista e use "Resetar selecionados".' },
    { key: 'list', title: 'Ativos e excluídos', description: 'As abas "Ativos"/"Excluídos" alternam a lista. Em cada card de morador dá pra editar, resetar a senha, excluir logicamente (bloqueia o login mas mantém o cadastro — reversível na aba "Excluídos") ou excluir fisicamente (apaga o cadastro pra sempre, junto com débitos, acordos e avisos dessa pessoa). Você pode cadastrar outro subsíndico por aqui, mas as ações de editar/resetar/excluir do card só ficam disponíveis pra moradores — outro subsíndico não é gerenciável por você.' },
  ];
  const tourSteps = isAdmin ? adminTourSteps : managerTourSteps;

  return (
    <>
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}
    >
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Pessoas</Text>
          <Text style={styles.title}>{user?.role === 'admin_geral' ? 'Síndicos e subsíndicos' : 'Usuários'}</Text>
          <Text style={styles.subtitle}>
            {user?.role === 'admin_geral'
              ? 'Cadastre síndicos e subsíndicos e vincule-os ao condomínio que irão gerir.'
              : 'Síndico e subsíndico possuem o mesmo acesso para cadastrar e administrar usuários do condomínio.'}
          </Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('form')} style={[isActive('form') && styles.tourHighlight]}>
      <Panel>
        <View style={styles.formTitleRow}><Text style={styles.panelTitle}>{editingId ? 'Editar pessoa' : 'Novo usuário'}</Text>{editingId ? <Pressable onPress={cancelEditing} style={styles.cancelEdit}><Text style={styles.cancelEditText}>Cancelar edição</Text></Pressable> : null}</View>
        {editingId ? (() => {
          const editingItem = items.find((entry) => entry.id === editingId);
          if (!editingItem) return null;
          const heldRoles = new Set<UserRole>([editingItem.role, ...personProfiles.map((profile) => profile.role)]);
          const grantableRoles = roles.filter((item) => (user?.role === 'admin_geral' ? item.value === 'sindico' || item.value === 'subsindico' : item.value === 'subsindico' || item.value === 'proprietario' || item.value === 'inquilino') && !heldRoles.has(item.value));
          const needsUnitPicker = (newProfileRole === 'proprietario' || newProfileRole === 'inquilino') && !editingItem.unit_id;
          return (
            <View style={styles.profilesPanel}>
              <Text style={styles.profilesPanelTitle}>Perfis desta pessoa</Text>
              <Text style={styles.fieldHint}>Um mesmo usuário de acesso pode acumular mais de um perfil (ex.: síndico que também é proprietário). Ao entrar, a pessoa escolhe com qual perfil usar o app.</Text>

              <View style={styles.profilesList}>
                <View style={styles.profileChip}><Text style={styles.profileChipText}>{roleLabel(editingItem.role)} (padrão)</Text></View>
                {profilesLoading ? <Text style={styles.fieldHint}>Carregando perfis...</Text> : personProfiles.map((profile) => (
                  <View key={profile.id} style={styles.profileChip}>
                    <Text style={styles.profileChipText}>{roleLabel(profile.role)}</Text>
                    <Pressable onPress={() => revokeProfile(editingItem, profile.id)} disabled={grantingProfile}><Text style={styles.profileChipRemove}>Remover</Text></Pressable>
                  </View>
                ))}
              </View>

              {profilesError ? <Text style={styles.error}>{profilesError}</Text> : null}

              {grantableRoles.length ? (
                <View style={styles.profileGrantForm}>
                  <Text style={styles.label}>Conceder novo perfil</Text>
                  <View style={styles.roleGrid}>
                    {grantableRoles.map((item) => (
                      <Pressable key={item.value} onPress={() => setNewProfileRole(item.value)} style={[styles.roleButton, newProfileRole === item.value && styles.roleButtonActive]}>
                        <Text style={[styles.roleText, newProfileRole === item.value && styles.roleTextActive]}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {needsUnitPicker ? (
                    managedUnits.length === 0 ? <View style={styles.helperBox}><Text style={styles.helperText}>Cadastre blocos e apartamentos antes de conceder um perfil de morador.</Text></View> : (
                      <View style={styles.profileUnitPicker}>
                        <ComboBox
                          options={unitOptions}
                          value={newProfileUnitId}
                          onChange={setNewProfileUnitId}
                          placeholder="Selecione a unidade"
                          title="Unidade / apartamento"
                          searchPlaceholder="Buscar bloco, apartamento ou tipologia"
                          emptyText="Nenhuma unidade encontrada para esta busca."
                        />
                      </View>
                    )
                  ) : null}
                  <AppButton title={grantingProfile ? 'Concedendo...' : 'Conceder perfil'} onPress={() => grantProfile(editingItem)} disabled={grantingProfile || !newProfileRole || (needsUnitPicker && !newProfileUnitId)} variant="secondary" />
                </View>
              ) : null}
            </View>
          );
        })() : null}
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <TextField
            label="Usuário de acesso"
            required
            placeholder="Ex.: maria.silva"
            hint="Usado no login e único no sistema."
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextField label="Nome completo" placeholder="Nome e sobrenome" value={fullName} onChangeText={setFullName} />
          <TextField
            label="CPF ou CNPJ"
            required={!editingId}
            placeholder="000.000.000-00"
            value={cpf}
            onChangeText={(value) => setCpf(formatCpf(value))}
            keyboardType="number-pad"
            maxLength={18}
          />
          <Field label="Senha inicial" hint={editingId
            ? 'A senha não é alterada aqui — use "Resetar senha" no card da pessoa.'
            : isManagerRole
              ? 'Gerada automaticamente (6 primeiros números do CPF) e exibida após salvar.'
              : isResidentRole
                ? 'Gerada automaticamente (número do apartamento + 4 primeiros números do CPF) e exibida após salvar.'
                : 'Gerada automaticamente com base no CPF e exibida após salvar.'}>
            <View style={styles.readOnlyBox}><Text style={styles.readOnlyText}>Definida pelo sistema</Text></View>
          </Field>
        </FormGrid>
        {user?.role === 'admin_geral' ? (
          <FormFieldFull>
            <View style={styles.condominiumPicker}>
              <Text style={styles.label}>Condomínio que o gestor vai administrar</Text>
              {condominiums.length === 0 ? (
                <View style={styles.helperBox}>
                  <Text style={styles.helperText}>Cadastre um condomínio antes de criar o gestor.</Text>
                </View>
              ) : (
                condominiums.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setCondominiumId(item.id)}
                    style={[styles.condominiumOption, condominiumId === item.id && styles.condominiumOptionActive]}
                  >
                    <View style={styles.condominiumOptionTop}>
                      <Text style={[styles.condominiumName, condominiumId === item.id && styles.condominiumNameActive]}>{item.name}</Text>
                      <Text style={[styles.selectBadge, condominiumId === item.id && styles.selectBadgeActive]}>
                        {condominiumId === item.id ? 'Selecionado' : 'Selecionar'}
                      </Text>
                    </View>
                    <Text style={[styles.condominiumMeta, condominiumId === item.id && styles.condominiumMetaActive]}>
                      {item.address || item.cnpj || 'Dados complementares nao informados'}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          </FormFieldFull>
        ) : null}
        <Text style={styles.label}>Perfil *</Text>
        <FormFieldFull>
          <View style={styles.roleGrid}>
            {roles.filter((item) => user?.role === 'admin_geral' ? item.value === 'sindico' || item.value === 'subsindico' : item.value === 'subsindico' || item.value === 'proprietario' || item.value === 'inquilino').map((item) => (
              <Pressable key={item.value} onPress={() => selectRole(item.value)} style={[styles.roleButton, role === item.value && styles.roleButtonActive]}>
                <Text style={[styles.roleText, role === item.value && styles.roleTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </FormFieldFull>
        {!role ? <Text style={styles.fieldHint}>Selecione o perfil para continuar o cadastro e informar a unidade.</Text> : null}

        {user?.role !== 'admin_geral' ? (
          <FormFieldFull>
            <View style={styles.condominiumPicker}>
              <Text style={styles.label}>Geração de boleto</Text>
              <Pressable onPress={() => setBillingExempt((value) => !value)} style={[styles.representativeOption, billingExempt && styles.exemptOptionActive]}>
                <Text style={[styles.roleText, billingExempt && styles.roleTextActive]}>{billingExempt ? '✓ Pessoa isenta de boleto' : 'Pessoa não isenta — gerar boletos normalmente'}</Text>
              </Pressable>
              <Text style={styles.fieldHint}>{billingExempt ? 'Esta pessoa não aparecerá para geração de boletos.' : 'A pessoa poderá receber cobranças conforme a tipologia da unidade.'}</Text>
              {!billingExempt ? <><Text style={styles.label}>Dia preferido para pagamento</Text><View style={styles.roleGrid}>{([10,20] as const).map(day=><Pressable key={day} onPress={()=>setPreferredDueDay(day)} style={[styles.roleButton,preferredDueDay===day&&styles.roleButtonActive]}><Text style={[styles.roleText,preferredDueDay===day&&styles.roleTextActive]}>Dia {day}</Text></Pressable>)}</View></> : null}
            </View>
          </FormFieldFull>
        ) : null}
        {user?.role !== 'admin_geral' ? (
          <FormFieldFull>
            <View style={styles.condominiumPicker}>
              <Text style={styles.label}>Unidade / apartamento</Text>
              {managedUnits.length === 0 ? <View style={styles.helperBox}><Text style={styles.helperText}>Cadastre blocos e apartamentos antes de cadastrar o morador.</Text></View> : (
                <ComboBox
                  options={unitOptions}
                  value={unitId}
                  onChange={setUnitId}
                  placeholder="Selecione a unidade"
                  title="Unidade / apartamento"
                  searchPlaceholder="Buscar bloco, apartamento ou tipologia"
                  emptyText="Nenhuma unidade encontrada para esta busca."
                />
              )}
              {unitId ? <Pressable onPress={() => setIsRepresentative((value) => !value)} style={[styles.representativeOption, isRepresentative && styles.representativeOptionActive]}><Text style={[styles.roleText, isRepresentative && styles.roleTextActive]}>{isRepresentative ? '✓ ' : ''}Morador representante desta unidade</Text></Pressable> : null}
            </View>
          </FormFieldFull>
        ) : null}
        {user?.role !== 'admin_geral' ? (
          <FormFieldFull>
            <View style={styles.addressPanel}>
              <Text style={styles.label}>Endereço do pagador para emissão do boleto</Text>
              <Field label="CEP" hint="Preencha o CEP para completar rua, bairro, cidade e UF automaticamente.">
                <View style={[styles.postalCodeRow, mobile && styles.postalCodeRowMobile]}>
                  <TextInput
                    placeholder="00000-000"
                    placeholderTextColor={colors.placeholder}
                    value={postalCode}
                    onChangeText={(value) => setPostalCode(formatPostalCode(value))}
                    onBlur={() => { if (onlyDigits(postalCode).length === 8 && !street) lookupPostalCode(); }}
                    style={[styles.input, styles.postalCodeInput]}
                    keyboardType="number-pad"
                    maxLength={9}
                  />
                  <Pressable onPress={lookupPostalCode} disabled={isLookingUpPostalCode} style={[styles.postalCodeButton, isLookingUpPostalCode && styles.postalCodeButtonDisabled, mobile && styles.postalCodeButtonMobile]}>
                    <Text style={styles.postalCodeButtonText}>{isLookingUpPostalCode ? 'Buscando...' : 'Buscar CEP'}</Text>
                  </Pressable>
                </View>
              </Field>
              <TextField label="Rua / avenida" placeholder="Nome da rua" value={street} onChangeText={setStreet} />
              <FormGrid columns={{ mobile: 2, tablet: 2, desktop: 2 }}>
                <TextField label="Número" placeholder="123" value={addressNumber} onChangeText={setAddressNumber} keyboardType="number-pad" />
                <TextField label="Complemento" placeholder="Apto, bloco" value={addressComplement} onChangeText={setAddressComplement} />
              </FormGrid>
              <TextField label="Bairro" placeholder="Nome do bairro" value={neighborhood} onChangeText={setNeighborhood} />
              <FormGrid columns={{ mobile: 2, tablet: 2, desktop: 2 }}>
                <TextField label="Cidade" placeholder="Nome da cidade" value={city} onChangeText={setCity} />
                <TextField label="UF" placeholder="GO" value={addressState} onChangeText={(value) => setAddressState(value.slice(0, 2).toUpperCase())} autoCapitalize="characters" maxLength={2} />
              </FormGrid>
            </View>
          </FormFieldFull>
        ) : null}
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <TextField label="E-mail" placeholder="nome@email.com" hint="Se informado, a senha inicial é enviada por e-mail." value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextField
            label="Telefone"
            placeholder="(00) 00000-0000"
            value={phone}
            onChangeText={(value) => setPhone(formatPhone(value))}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </FormGrid>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}
        {editingId && user?.role !== 'admin_geral' && (role === 'proprietario' || role === 'inquilino') && !unitId ? (
          <View style={styles.requiredNotice}><Text style={styles.requiredNoticeText}>Selecione uma unidade cadastrada para salvar este cadastro antigo.</Text></View>
        ) : null}
        <AppButton
          title={editingId ? 'Salvar alterações' : user?.role === 'admin_geral' ? 'Cadastrar gestor' : 'Cadastrar usuário'}
          onPress={create}
          disabled={isLoading}
        />
      </Panel>
      </View>

      <View ref={registerSection('filters')} style={[styles.filterPanel, isActive('filters') && styles.tourHighlight]}>
          <View style={styles.filterHeader}>
            <View>
              <Text style={styles.filterTitle}>{user?.role === 'admin_geral' ? 'Filtrar síndicos e subsíndicos' : 'Filtrar usuários'}</Text>
              <Text style={styles.filterSubtitle}>{user?.role === 'admin_geral' ? 'Combine condomínio, nome e CPF para localizar um cadastro.' : 'Localize por nome ou CPF e identifique moradores sem tipologia.'}</Text>
            </View>
            {filterCondominiumId || filterName || filterCpf || filterUnitTypeId ? (
              <Pressable onPress={() => { setFilterCondominiumId(''); setFilterName(''); setFilterCpf(''); setFilterUnitTypeId(''); }} style={styles.clearFilter}>
                <Text style={styles.clearFilterText}>Limpar filtros</Text>
              </Pressable>
            ) : null}
          </View>

          {user?.role === 'admin_geral' ? <>
          <Text style={styles.label}>Condomínio</Text>
          <View style={styles.filterOptions}>
            <Pressable onPress={() => setFilterCondominiumId('')} style={[styles.filterOption, !filterCondominiumId && styles.filterOptionActive]}>
              <Text style={[styles.filterOptionText, !filterCondominiumId && styles.filterOptionTextActive]}>Todos</Text>
            </Pressable>
            {condominiums.map((item) => (
              <Pressable key={item.id} onPress={() => setFilterCondominiumId(item.id)} style={[styles.filterOption, filterCondominiumId === item.id && styles.filterOptionActive]}>
                <Text numberOfLines={1} style={[styles.filterOptionText, filterCondominiumId === item.id && styles.filterOptionTextActive]}>{item.name}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setFilterCondominiumId('__unlinked__')} style={[styles.filterOption, filterCondominiumId === '__unlinked__' && styles.filterOptionActive]}>
              <Text style={[styles.filterOptionText, filterCondominiumId === '__unlinked__' && styles.filterOptionTextActive]}>Sem condomínio</Text>
            </Pressable>
          </View>
          </> : null}

          <Text style={styles.label}>Nome</Text>
          <TextInput placeholder="Digite todo ou parte do nome" value={filterName} onChangeText={setFilterName} style={[styles.filterInput, styles.filterInputSpacing]} />

          <Text style={styles.label}>CPF</Text>
          <TextInput placeholder="Digite todo ou parte do CPF" value={filterCpf} onChangeText={(value) => setFilterCpf(formatCpf(value))} style={styles.filterInput} keyboardType="number-pad" maxLength={14} />

          {user?.role !== 'admin_geral' ? <>
            <Text style={styles.filterStatusLabel}>Tipologia do apartamento</Text>
            <View style={styles.filterOptions}>
              <Pressable onPress={() => setFilterUnitTypeId('')} style={[styles.filterOption, !filterUnitTypeId && styles.filterOptionActive]}>
                <Text style={[styles.filterOptionText, !filterUnitTypeId && styles.filterOptionTextActive]}>Todos</Text>
              </Pressable>
              {unitTypes.map((item) => (
                <Pressable key={item.id} onPress={() => setFilterUnitTypeId(item.id)} style={[styles.filterOption, filterUnitTypeId === item.id && styles.filterOptionActive]}>
                  <Text numberOfLines={1} style={[styles.filterOptionText, filterUnitTypeId === item.id && styles.filterOptionTextActive]}>{item.name}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setFilterUnitTypeId('__missing__')} style={[styles.filterOption, filterUnitTypeId === '__missing__' && styles.filterOptionActive]}>
                <Text style={[styles.filterOptionText, filterUnitTypeId === '__missing__' && styles.filterOptionTextActive]}>Sem tipologia</Text>
              </Pressable>
            </View>
          </> : null}
        </View>

      <View ref={registerSection('reset')} style={[isActive('reset') && styles.tourHighlight]}>
      {user?.role === 'admin_geral' ? (
        <View style={styles.resetPanel}>
          <Text style={styles.filterTitle}>Reset de senha em massa</Text>
          <Text style={styles.filterSubtitle}>Gera uma nova senha inicial pela regra padrão (6 primeiros números do CPF). Selecione um condomínio no filtro acima para habilitar o reset de todos.</Text>
          <View style={styles.resetActions}>
            <AppButton title="Resetar todos deste condomínio" onPress={confirmResetAllManagers} variant="secondary" disabled={!filterCondominiumId || filterCondominiumId === '__unlinked__'} />
            <AppButton title={`Resetar selecionados (${selectedForReset.size})`} onPress={confirmResetSelected} disabled={selectedForReset.size === 0} />
          </View>
        </View>
      ) : user?.role === 'sindico' || user?.role === 'subsindico' ? (
        <View style={styles.resetPanel}>
          <Text style={styles.filterTitle}>Reset de senha em massa</Text>
          <Text style={styles.filterSubtitle}>Gera uma nova senha inicial pela regra padrão (número do apartamento + 4 primeiros números do CPF).</Text>
          <View style={styles.resetActions}>
            <AppButton title="Resetar todos os moradores" onPress={confirmResetAllResidents} variant="secondary" />
            <AppButton title={`Resetar selecionados (${selectedForReset.size})`} onPress={confirmResetSelected} disabled={selectedForReset.size === 0} />
          </View>
        </View>
      ) : null}
      </View>

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      {manager ? (
        <View style={styles.tabRow}>
          <Pressable onPress={() => setViewingDeleted(false)} style={[styles.tabButton, !viewingDeleted && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, !viewingDeleted && styles.tabButtonTextActive]}>Ativos</Text>
          </Pressable>
          <Pressable onPress={() => setViewingDeleted(true)} style={[styles.tabButton, viewingDeleted && styles.tabButtonActive]}>
            <Text style={[styles.tabButtonText, viewingDeleted && styles.tabButtonTextActive]}>Excluídos</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{viewingDeleted ? 'Excluídos logicamente' : user?.role === 'admin_geral' ? 'Gestores cadastrados' : 'Cadastrados'}</Text>
        <Text style={styles.counter}>{filteredItems.length}/{items.length}</Text>
      </View>

      {filteredItems.length === 0 ? (
        <EmptyState title={items.length === 0 ? (viewingDeleted ? 'Nenhum excluído' : 'Nenhum usuário ainda') : 'Nenhum usuário encontrado'} description={items.length === 0 ? (viewingDeleted ? 'Pessoas excluídas logicamente aparecerão aqui.' : 'Os usuários cadastrados aparecerão aqui.') : 'Altere ou limpe os filtros para visualizar outros cadastros.'} />
      ) : (
        <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
          {filteredItems.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.full_name || item.username}</Text>
                <Text style={styles.badge}>{roleLabel(item.role)}</Text>
              </View>
              <Text style={styles.cardLine}>@{item.username}</Text>
              <Text style={styles.cardLine}>CPF: {item.cpf ? formatCpf(item.cpf) : 'nao informado'}</Text>
              {user?.role === 'admin_geral' ? <Text style={styles.cardCondominium}>{condominiumName(item.condominium_id)}</Text> : null}
              <Text style={styles.cardLine}>Unidade: {item.unit || 'nao informada'}</Text>
              {item.billing_exempt ? <Text style={styles.exemptBadge}>Isento de boleto</Text> : null}
              {!item.billing_exempt ? <Text style={styles.cardLine}>Vencimento preferido: dia {item.preferred_due_day || 10}</Text> : null}
              {item.unit_type_name ? <Text style={styles.cardLine}>Tipologia: {item.unit_type_name} · {formatCurrency(item.condominium_fee_cents || 0)}</Text> : null}
              <Text style={styles.cardLine}>
                {item.email || (item.phone ? formatPhone(item.phone) : 'Contato nao informado')}
              </Text>
              {viewingDeleted ? (
                <>
                  <Text style={styles.cardLine}>Excluído em: {formatDate(item.deleted_at)}</Text>
                  {canManageItem(item) ? <Pressable onPress={() => confirmReactivate(item)} style={styles.editButton}><Text style={styles.editButtonText}>Reativar</Text></Pressable> : null}
                </>
              ) : (
                <>
                  <Pressable onPress={() => startEditing(item)} style={styles.editButton}><Text style={styles.editButtonText}>Editar pessoa</Text></Pressable>
                  {canManageItem(item) ? (
                    <View style={styles.resetRow}>
                      <Pressable onPress={() => toggleSelectedForReset(item.id)} style={styles.checkboxRow}>
                        <Text style={selectedForReset.has(item.id) ? styles.checkboxChecked : styles.checkboxUnchecked}>{selectedForReset.has(item.id) ? '☑' : '☐'}</Text>
                        <Text style={styles.checkboxLabel}>Selecionar</Text>
                      </Pressable>
                      <Pressable onPress={() => confirmResetOne(item)} style={styles.resetButton}><Text style={styles.resetButtonText}>Resetar senha</Text></Pressable>
                    </View>
                  ) : null}
                  {canManageItem(item) ? (
                    <View style={styles.resetRow}>
                      <Pressable onPress={() => confirmSoftDelete(item)} style={styles.resetButton}><Text style={styles.resetButtonText}>Excluir logicamente</Text></Pressable>
                      <Pressable onPress={() => confirmHardDelete(item)} style={styles.resetButton}><Text style={styles.resetButtonText}>Excluir fisicamente</Text></Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ))}
        </CardGrid>
      )}
      </View>
      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} scrollable={dialog?.scrollable} />
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.amber, fontWeight: '800', letterSpacing: 0, marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: 12 },
  formTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cancelEdit: { borderRadius: 8, backgroundColor: '#f2f4f7', paddingHorizontal: 10, paddingVertical: 7 },
  cancelEditText: { color: colors.muted, fontSize: 14, fontWeight: '900' },
  unitTypePanel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 16 },
  unitTypeHint: { color: colors.muted, fontSize: 15, lineHeight: 20, marginTop: -6, marginBottom: 12 },
  unitTypeList: { gap: 8, marginBottom: 14 },
  unitTypeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 9, backgroundColor: colors.softBlue, padding: 12 },
  unitTypeName: { color: colors.ink, fontWeight: '900' },
  unitTypeDescription: { color: colors.muted, fontSize: 14, marginTop: 3 },
  unitTypeValue: { color: colors.primaryDark, fontWeight: '900' },
  profilesPanel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginTop: 14, marginBottom: 6 },
  profilesPanelTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginBottom: 4 },
  profilesList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, backgroundColor: colors.softBlue, paddingHorizontal: 12, paddingVertical: 8 },
  profileChipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  profileChipRemove: { color: colors.red, fontWeight: '800', fontSize: 12 },
  profileGrantForm: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
    color: colors.ink,
  },
  fieldHint: { color: colors.muted, fontSize: 14, lineHeight: 17, marginTop: -5, marginBottom: 10 },
  requiredNotice: { borderRadius: 8, borderWidth: 1, borderColor: '#f4d49b', backgroundColor: '#fff8e8', padding: 10, marginBottom: 10 },
  requiredNoticeText: { color: colors.amber, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  addressPanel: { borderRadius: 9, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  addressRow: { flexDirection: 'row', gap: 10 }, addressRowMobile: { flexDirection: 'column', gap: 0 },
  addressNumber: { flex: .4 }, addressNumberMobile: { flex: 1 },
  addressComplement: { flex: 1 }, addressComplementMobile: { flex: 1 },
  stateInput: { width: 72 }, stateInputMobile: { width: '100%' },
  postalCodeRow: { flexDirection: 'row', gap: 10 }, postalCodeRowMobile: { flexDirection: 'column', gap: 0 },
  postalCodeInput: { flex: 1 },
  postalCodeButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, postalCodeButtonMobile: { minHeight: 48 },
  postalCodeButtonDisabled: { opacity: .6 },
  postalCodeButtonText: { color: '#fff', fontWeight: '900' },
  label: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  condominiumPicker: { marginBottom: 10 },
  readOnlyBox: { minHeight: 52, borderRadius: 9, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: '#f8fafc', paddingHorizontal: 12, justifyContent: 'center' },
  readOnlyText: { color: colors.muted, fontWeight: '700' },
  profileUnitPicker: { marginTop: 10, marginBottom: 10 },
  helperBox: {
    borderRadius: 8,
    backgroundColor: colors.softBlue,
    borderWidth: 1,
    borderColor: '#c9daf8',
    padding: 12,
  },
  helperText: { color: colors.primaryDark, lineHeight: 22, fontWeight: '700' },
  condominiumOption: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  condominiumOptionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  condominiumOptionTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  condominiumName: { flex: 1, color: colors.ink, fontWeight: '900' },
  condominiumNameActive: { color: colors.primaryDark },
  condominiumMeta: { color: colors.muted, marginTop: 5, lineHeight: 21 },
  condominiumMetaActive: { color: colors.primaryDark },
  selectBadge: { color: colors.muted, fontSize: 15, fontWeight: '900' },
  selectBadgeActive: { color: colors.primary },
  roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  roleButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  roleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleText: { color: colors.muted, fontWeight: '800' },
  roleTextActive: { color: '#fff' },
  representativeOption: { minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginTop: 4 },
  representativeOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  exemptOptionActive: { backgroundColor: colors.amber, borderColor: colors.amber },
  exemptBadge: { alignSelf: 'flex-start', color: colors.amber, backgroundColor: '#fff8e8', borderRadius: 8, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, marginTop: 6, fontSize: 14, fontWeight: '900' },
  error: { color: colors.red, marginBottom: 10 },
  success: { color: colors.green, marginBottom: 10, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  counter: { color: colors.primary, fontWeight: '900' },
  filterPanel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 14 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabButton: { minHeight: 40, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tabButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabButtonText: { color: colors.muted, fontWeight: '800' },
  tabButtonTextActive: { color: '#fff' },
  resetPanel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 14, gap: 4 },
  resetActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkboxChecked: { fontSize: 17, color: colors.green },
  checkboxUnchecked: { fontSize: 17, color: colors.muted },
  checkboxLabel: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  resetButton: { borderRadius: 8, backgroundColor: '#fff1f1', paddingHorizontal: 11, paddingVertical: 8 },
  resetButtonText: { color: colors.red, fontSize: 14, fontWeight: '900' },
  filterHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  filterTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  filterSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 3 },
  clearFilter: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.softBlue },
  clearFilterText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterOption: { maxWidth: '100%', minHeight: 36, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 11 },
  filterOptionActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterOptionText: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  filterOptionTextActive: { color: '#fff' },
  filterInput: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff', color: colors.ink },
  filterInputSpacing: { marginBottom: 14 },
  filterStatusLabel: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 14, marginBottom: 8 },
  list: {},
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900' },
  badge: {
    color: colors.primaryDark,
    backgroundColor: '#e8eef9',
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 15,
    fontWeight: '900',
  },
  cardLine: { color: colors.muted, marginTop: 4, lineHeight: 21 },
  cardCondominium: { color: colors.primaryDark, marginTop: 5, fontSize: 15, fontWeight: '800' },
  editButton: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 8, backgroundColor: colors.softBlue, paddingHorizontal: 11, paddingVertical: 8 },
  editButtonText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
});
