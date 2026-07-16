import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import ResponsiveShell from '../ui/ResponsiveShell';

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
  const { userToken, user } = useContext(AuthContext);
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

  const condominiumName = (condominiumId: string | null) =>
    condominiums.find((item) => item.id === condominiumId)?.name || 'Condomínio não identificado';

  const load = useCallback(async () => {
    if (!userToken) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<UsersResponse>('/users', userToken);
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
  }, [loadUnitTypes, user?.role, userToken]);

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
    if ((!editingId && password.length < 6) || (editingId && password.length > 0 && password.length < 6)) {
      setError(editingId ? 'A nova senha deve ter pelo menos 6 caracteres ou ficar vazia para manter a atual.' : 'A senha inicial deve ter pelo menos 6 caracteres.'); return;
    }
    if (user?.role === 'admin_geral' && !condominiumId.trim()) { setError('Selecione o condomínio.'); return; }
    if (user?.role !== 'admin_geral' && (role === 'proprietario' || role === 'inquilino')) {
      if (!unitId) { setError('Selecione a unidade ou apartamento.'); return; }
    }
    const cpfDigits = onlyDigits(cpf);

    setIsLoading(true);
    setError(null);
    try {
      await apiRequest(editingId ? `/users/${editingId}` : '/users', userToken, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          username: username.trim(),
          password,
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
      setSuccess(editingId ? 'Cadastro atualizado.' : user?.role === 'admin_geral' ? 'Gestor cadastrado.' : 'Usuário cadastrado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cadastrar usuario');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditing = (item: UserItem) => {
    setEditingId(item.id);
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
    setStreet(''); setAddressNumber(''); setAddressComplement(''); setNeighborhood(''); setCity(''); setAddressState(''); setPostalCode('');
    setRole('');
  };

  const selectRole = (nextRole: UserRole) => {
    if (nextRole !== 'proprietario') { setRole(nextRole); return; }
    Alert.alert('Confirmar perfil Proprietário','Você tem certeza? O perfil Proprietário poderá visualizar o saldo bancário mensal do condomínio.',[
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sim, selecionar', onPress: () => setRole('proprietario') },
    ]);
  };

  return (
    <ResponsiveShell activeRoute="Users" navigation={navigation}>
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}
    >
      <Text style={styles.eyebrow}>Pessoas</Text>
      <Text style={styles.title}>{user?.role === 'admin_geral' ? 'Síndicos e subsíndicos' : 'Usuários'}</Text>
      <Text style={styles.subtitle}>
        {user?.role === 'admin_geral'
          ? 'Cadastre síndicos e subsíndicos e vincule-os ao condomínio que irão gerir.'
          : 'Síndico e subsíndico possuem o mesmo acesso para cadastrar e administrar usuários do condomínio.'}
      </Text>

      <Panel>
        <View style={styles.formTitleRow}><Text style={styles.panelTitle}>{editingId ? 'Editar pessoa' : 'Novo usuário'}</Text>{editingId ? <Pressable onPress={cancelEditing} style={styles.cancelEdit}><Text style={styles.cancelEditText}>Cancelar edição</Text></Pressable> : null}</View>
        <TextInput placeholder="Usuário de acesso único" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" />
        <Text style={styles.fieldHint}>Este nome será usado no login e não pode ser igual ao de outro usuário.</Text>
        <TextInput placeholder={editingId ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial'} value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
        <TextInput placeholder="Nome completo" value={fullName} onChangeText={setFullName} style={styles.input} />
        <TextInput
          placeholder="CPF ou CNPJ"
          value={cpf}
          onChangeText={(value) => setCpf(formatCpf(value))}
          style={styles.input}
          keyboardType="number-pad"
          maxLength={18}
        />
        {user?.role === 'admin_geral' ? (
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
        ) : null}
        <Text style={styles.label}>Perfil *</Text>
        <View style={styles.roleGrid}>
          {roles.filter((item) => user?.role === 'admin_geral' ? item.value === 'sindico' || item.value === 'subsindico' : item.value === 'subsindico' || item.value === 'proprietario' || item.value === 'inquilino').map((item) => (
            <Pressable key={item.value} onPress={() => selectRole(item.value)} style={[styles.roleButton, role === item.value && styles.roleButtonActive]}>
              <Text style={[styles.roleText, role === item.value && styles.roleTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        {!role ? <Text style={styles.fieldHint}>Selecione o perfil para continuar o cadastro e informar a unidade.</Text> : null}

        {user?.role !== 'admin_geral' ? (
          <View style={styles.condominiumPicker}>
            <Text style={styles.label}>Geração de boleto</Text>
            <Pressable onPress={() => setBillingExempt((value) => !value)} style={[styles.representativeOption, billingExempt && styles.exemptOptionActive]}>
              <Text style={[styles.roleText, billingExempt && styles.roleTextActive]}>{billingExempt ? '✓ Pessoa isenta de boleto' : 'Pessoa não isenta — gerar boletos normalmente'}</Text>
            </Pressable>
            <Text style={styles.fieldHint}>{billingExempt ? 'Esta pessoa não aparecerá para geração de boletos.' : 'A pessoa poderá receber cobranças conforme a tipologia da unidade.'}</Text>
            {!billingExempt ? <><Text style={styles.label}>Dia preferido para pagamento</Text><View style={styles.roleGrid}>{([10,20] as const).map(day=><Pressable key={day} onPress={()=>setPreferredDueDay(day)} style={[styles.roleButton,preferredDueDay===day&&styles.roleButtonActive]}><Text style={[styles.roleText,preferredDueDay===day&&styles.roleTextActive]}>Dia {day}</Text></Pressable>)}</View></> : null}
          </View>
        ) : null}
        {user?.role !== 'admin_geral' ? (
          <View style={styles.condominiumPicker}>
            <Text style={styles.label}>Unidade / apartamento</Text>
            {managedUnits.length === 0 ? <View style={styles.helperBox}><Text style={styles.helperText}>Cadastre blocos e apartamentos antes de cadastrar o morador.</Text></View> : Platform.OS === 'web' ? React.createElement('select' as any, {
              value: unitId,
              onChange: (event: any) => setUnitId(event.target.value),
              style: { width: '100%', minHeight: 52, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '0 12px', marginBottom: 10, backgroundColor: '#fff', color: colors.ink },
            }, [React.createElement('option' as any, { key: '', value: '' }, 'Selecione a unidade'), ...managedUnits.map((item) => React.createElement('option' as any, { key: item.id, value: item.id }, `${item.block_name} · Apartamento ${item.number} · ${item.unit_type_name || 'Sem tipologia'}`))]) : managedUnits.map((item) => (
              <Pressable key={item.id} onPress={() => setUnitId(item.id)} style={[styles.condominiumOption, unitId === item.id && styles.condominiumOptionActive]}>
                <View style={styles.condominiumOptionTop}><Text style={[styles.condominiumName, unitId === item.id && styles.condominiumNameActive]}>{item.block_name} · Apartamento {item.number}</Text><Text style={[styles.selectBadge, unitId === item.id && styles.selectBadgeActive]}>{item.unit_type_name || 'Sem tipologia'}</Text></View>
              </Pressable>
            ))}
            {unitId ? <Pressable onPress={() => setIsRepresentative((value) => !value)} style={[styles.representativeOption, isRepresentative && styles.representativeOptionActive]}><Text style={[styles.roleText, isRepresentative && styles.roleTextActive]}>{isRepresentative ? '✓ ' : ''}Morador representante desta unidade</Text></Pressable> : null}
          </View>
        ) : null}
        {user?.role !== 'admin_geral' ? (
          <View style={styles.addressPanel}>
            <Text style={styles.label}>Endereço do pagador para emissão do boleto</Text>
            <View style={styles.postalCodeRow}>
              <TextInput
                placeholder="CEP"
                value={postalCode}
                onChangeText={(value) => setPostalCode(formatPostalCode(value))}
                onBlur={() => { if (onlyDigits(postalCode).length === 8 && !street) lookupPostalCode(); }}
                style={[styles.input, styles.postalCodeInput]}
                keyboardType="number-pad"
                maxLength={9}
              />
              <Pressable onPress={lookupPostalCode} disabled={isLookingUpPostalCode} style={[styles.postalCodeButton, isLookingUpPostalCode && styles.postalCodeButtonDisabled]}>
                <Text style={styles.postalCodeButtonText}>{isLookingUpPostalCode ? 'Buscando...' : 'Buscar CEP'}</Text>
              </Pressable>
            </View>
            <TextInput placeholder="Rua / avenida" value={street} onChangeText={setStreet} style={styles.input} />
            <View style={styles.addressRow}><TextInput placeholder="Número" value={addressNumber} onChangeText={setAddressNumber} style={[styles.input, styles.addressNumber]} /><TextInput placeholder="Complemento" value={addressComplement} onChangeText={setAddressComplement} style={[styles.input, styles.addressComplement]} /></View>
            <TextInput placeholder="Bairro" value={neighborhood} onChangeText={setNeighborhood} style={styles.input} />
            <View style={styles.addressRow}><TextInput placeholder="Cidade" value={city} onChangeText={setCity} style={[styles.input, styles.addressComplement]} /><TextInput placeholder="UF" value={addressState} onChangeText={(value) => setAddressState(value.slice(0, 2).toUpperCase())} style={[styles.input, styles.stateInput]} autoCapitalize="characters" /></View>
          </View>
        ) : null}
        <TextInput placeholder="Email" value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" />
        <TextInput
          placeholder="Telefone"
          value={phone}
          onChangeText={(value) => setPhone(formatPhone(value))}
          style={styles.input}
          keyboardType="phone-pad"
          maxLength={15}
        />

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

      <View style={styles.filterPanel}>
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

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{user?.role === 'admin_geral' ? 'Gestores cadastrados' : 'Cadastrados'}</Text>
        <Text style={styles.counter}>{filteredItems.length}/{items.length}</Text>
      </View>

      {filteredItems.length === 0 ? (
        <EmptyState title={items.length === 0 ? 'Nenhum usuário ainda' : 'Nenhum usuário encontrado'} description={items.length === 0 ? 'Os usuários cadastrados aparecerão aqui.' : 'Altere ou limpe os filtros para visualizar outros cadastros.'} />
      ) : (
        <View style={styles.list}>
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
              <Pressable onPress={() => startEditing(item)} style={styles.editButton}><Text style={styles.editButtonText}>Editar pessoa</Text></Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
    </ResponsiveShell>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  grow: { flex: 1 },
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
  addressRow: { flexDirection: 'row', gap: 10 }, addressNumber: { flex: .4 }, addressComplement: { flex: 1 }, stateInput: { width: 72 },
  postalCodeRow: { flexDirection: 'row', gap: 10 },
  postalCodeInput: { flex: 1 },
  postalCodeButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  postalCodeButtonDisabled: { opacity: .6 },
  postalCodeButtonText: { color: '#fff', fontWeight: '900' },
  label: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  condominiumPicker: { marginBottom: 10 },
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
  list: { gap: 10 },
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
