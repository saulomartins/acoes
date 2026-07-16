import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState } from '../ui/components';
import ResponsiveShell from '../ui/ResponsiveShell';
import { colors } from '../ui/theme';

type Condominium = { id: string; name: string; cnpj: string | null; address: string | null };
type UnitType = { id: string; name: string; fee_cents: number; description: string | null; active: boolean };

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const maskCurrency = (value: string) => formatCurrency(Number(value.replace(/\D/g, '') || 0));
const currencyToCents = (value: string) => {
  const amount = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

export default function UnitTypes({ navigation }: any) {
  const { user, userToken } = useContext(AuthContext);
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState('');
  const [items, setItems] = useState<UnitType[]>([]);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadTypes = useCallback(async (targetId?: string) => {
    if (!userToken) return;
    if (user?.role === 'admin_geral' && !targetId) { setItems([]); return; }
    const path = user?.role === 'admin_geral' ? `/unit-types?condominiumId=${encodeURIComponent(targetId || '')}` : '/unit-types';
    const response = await apiRequest<{ unitTypes: UnitType[] }>(path, userToken);
    setItems(response.unitTypes);
  }, [user?.role, userToken]);

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true); setError(null);
    try {
      if (user?.role === 'admin_geral') {
        const response = await apiRequest<{ condominiums: Condominium[] }>('/condominiums', userToken);
        setCondominiums(response.condominiums);
        const target = condominiumId || (response.condominiums.length === 1 ? response.condominiums[0].id : '');
        if (target) { setCondominiumId(target); await loadTypes(target); }
      } else {
        await loadTypes();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar tipologias'); }
    finally { setIsLoading(false); }
  }, [condominiumId, loadTypes, user?.role, userToken]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const feeCents = currencyToCents(fee);
    if (!userToken || !name.trim() || feeCents <= 0) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      await apiRequest('/unit-types', userToken, { method: 'POST', body: JSON.stringify({ condominiumId: user?.role === 'admin_geral' ? condominiumId : undefined, name: name.trim(), feeCents, description: description.trim() || null }) });
      setName(''); setFee(''); setDescription(''); setSuccess('Tipologia e valor salvos.');
      await loadTypes(condominiumId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao cadastrar tipologia'); }
    finally { setIsLoading(false); }
  };

  return <ResponsiveShell activeRoute="UnitTypes" navigation={navigation}>
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <Text style={styles.eyebrow}>Configuração de cobranças</Text>
      <Text style={styles.title}>Tipologias e valores</Text>
      <Text style={styles.subtitle}>Defina os tipos de apartamento e o valor mensal padrão cobrado de cada unidade.</Text>

      {user?.role === 'admin_geral' ? <View style={styles.panel}><Text style={styles.panelTitle}>Condomínio</Text>{condominiums.map((item) => <Pressable key={item.id} onPress={async () => { setCondominiumId(item.id); await loadTypes(item.id); }} style={[styles.option, condominiumId === item.id && styles.optionActive]}><Text style={[styles.optionText, condominiumId === item.id && styles.optionTextActive]}>{item.name}</Text></Pressable>)}</View> : null}

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Tipologias cadastradas</Text><Text style={styles.counter}>{items.length}</Text></View>
      {items.length === 0 ? <EmptyState title="Nenhuma tipologia" description="Cadastre o primeiro tipo de apartamento e seu valor mensal." /> : <View style={styles.list}>{items.map((item) => <View key={item.id} style={styles.card}><View style={styles.grow}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardDescription}>{item.description || 'Sem descrição'}</Text></View><Text style={styles.value}>{formatCurrency(item.fee_cents)}</Text></View>)}</View>}

      <View style={[styles.panel, styles.formPanel]}>
        <Text style={styles.panelTitle}>Nova tipologia</Text>
        <TextInput placeholder="Nome (ex.: Apartamento com área privativa)" value={name} onChangeText={setName} style={styles.input} />
        <TextInput placeholder="Valor mensal (ex.: R$ 685,00)" value={fee} onChangeText={(value) => setFee(maskCurrency(value))} keyboardType="number-pad" style={styles.input} />
        <TextInput placeholder="Descrição opcional" value={description} onChangeText={setDescription} style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}{success ? <Text style={styles.success}>{success}</Text> : null}
        <AppButton title="Salvar tipologia e valor" onPress={create} disabled={isLoading || (user?.role === 'admin_geral' && !condominiumId) || !name.trim() || currencyToCents(fee) <= 0} />
      </View>
    </ScrollView>
  </ResponsiveShell>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background }, grow: { flex: 1 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 16 }, panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: 12 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, marginBottom: 10, backgroundColor: '#fff', color: colors.ink },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, marginBottom: 8 }, optionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue }, optionText: { color: colors.ink, fontWeight: '800' }, optionTextActive: { color: colors.primaryDark },
  error: { color: colors.red, marginBottom: 10 }, success: { color: colors.green, marginBottom: 10, fontWeight: '800' }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, counter: { color: colors.primary, fontWeight: '900' }, list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16 }, cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, cardDescription: { color: colors.muted, fontSize: 15, marginTop: 4 }, value: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  formPanel: { marginTop: 18 },
});
