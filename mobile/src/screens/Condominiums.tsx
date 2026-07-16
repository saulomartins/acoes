import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import ResponsiveShell from '../ui/ResponsiveShell';

type Condominium = {
  id: string;
  name: string;
  cnpj: string | null;
  address: string | null;
  created_at: string;
};

type CondominiumResponse = {
  condominiums: Condominium[];
};

const formatCnpj = (value: string) => value.replace(/\D/g, '').slice(0,14).replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\/\d{4})(\d)/,'$1-$2');
const formatCep = (value:string) => value.replace(/\D/g,'').slice(0,8).replace(/^(\d{5})(\d)/,'$1-$2');

export default function Condominiums({ navigation }: any) {
  const { userToken } = useContext(AuthContext);
  const [items, setItems] = useState<Condominium[]>([]);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode,setPostalCode]=useState('');
  const [isLookingUpPostalCode,setIsLookingUpPostalCode]=useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<CondominiumResponse>('/condominiums', userToken);
      setItems(response.condominiums);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar condominios');
    } finally {
      setIsLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
  }, [load]);

  const lookupPostalCode=async()=>{const digits=postalCode.replace(/\D/g,'');if(digits.length!==8){setError('Informe um CEP com 8 dígitos.');return}setIsLookingUpPostalCode(true);setError(null);try{const response=await fetch(`https://viacep.com.br/ws/${digits}/json/`);const data=await response.json();if(!response.ok||data.erro)throw new Error('CEP não encontrado.');setAddress([data.logradouro,data.bairro,data.localidade&&data.uf?`${data.localidade} - ${data.uf}`:data.localidade].filter(Boolean).join(', '))}catch(e){setError(e instanceof Error?e.message:'Não foi possível buscar o CEP.')}finally{setIsLookingUpPostalCode(false)}};

  const create = async () => {
    if (!userToken || !name.trim()) return;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest('/condominiums', userToken, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          cnpj: cnpj.replace(/\D/g, '') || null,
          address: address.trim() || null,
        }),
      });
      setName('');
      setCnpj('');
      setAddress('');
      setPostalCode('');
      setSuccess('Condominio cadastrado.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cadastrar condominio');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ResponsiveShell activeRoute="Condominiums" navigation={navigation}>
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}
    >
      <Text style={styles.eyebrow}>Gestao</Text>
      <Text style={styles.title}>Configuracao inicial</Text>
      <Text style={styles.subtitle}>Cadastre os condomínios e depois defina os gestores responsáveis.</Text>

      <Panel>
        <Text style={styles.panelTitle}>Novo condominio</Text>
        <TextInput placeholder="Nome do condominio" value={name} onChangeText={setName} style={styles.input} />
        <TextInput placeholder="CNPJ (00.000.000/0000-00)" value={cnpj} onChangeText={(value)=>setCnpj(formatCnpj(value))} style={styles.input} keyboardType="number-pad" maxLength={18} />
        <View style={styles.cepRow}><TextInput placeholder="CEP (00000-000)" value={postalCode} onChangeText={(value)=>setPostalCode(formatCep(value))} onBlur={()=>{if(postalCode.replace(/\D/g,'').length===8&&!address)lookupPostalCode()}} style={[styles.input,styles.cepInput]} keyboardType="number-pad" maxLength={9}/><Pressable onPress={lookupPostalCode} disabled={isLookingUpPostalCode} style={[styles.cepButton,isLookingUpPostalCode&&styles.cepButtonDisabled]}><Text style={styles.cepButtonText}>{isLookingUpPostalCode?'Buscando...':'Buscar CEP'}</Text></Pressable></View>
        <TextInput placeholder="Endereço (rua, número, bairro, cidade e UF)" value={address} onChangeText={setAddress} style={styles.input} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}
        <AppButton title="Cadastrar condominio" onPress={create} disabled={isLoading || !name.trim()} />
      </Panel>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Cadastrados</Text>
        <Text style={styles.counter}>{items.length}</Text>
      </View>

      {items.length === 0 ? (
        <EmptyState title="Nenhum condominio ainda" description="Quando voce cadastrar, ele aparecera nesta lista." />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardAccent} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardId}>ID: {item.id}</Text>
                <Text style={styles.cardLine}>{item.cnpj ? formatCnpj(item.cnpj) : 'CNPJ não informado'}</Text>
                <Text style={styles.cardLine}>{item.address || 'Endereco nao informado'}</Text>
              </View>
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
  eyebrow: { color: colors.teal, fontWeight: '800', letterSpacing: 0, marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: 12 },
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
  cepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cepInput: { flex: 1 },
  cepButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  cepButtonDisabled: { opacity: .6 },
  cepButtonText: { color: '#fff', fontWeight: '900' },
  error: { color: colors.red, marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  counter: { color: colors.primary, fontWeight: '900' },
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardAccent: { width: 5, backgroundColor: colors.green },
  cardBody: { flex: 1, padding: 14 },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  cardId: { color: colors.primaryDark, marginTop: 4, fontSize: 15, fontWeight: '800' },
  cardLine: { color: colors.muted, marginTop: 4, lineHeight: 21 },
  bankBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  bankTitle: { color: colors.ink, fontWeight: '900', marginBottom: 5 },
  bankLinked: { color: colors.green, fontWeight: '800', marginBottom: 9 },
  bankMissing: { color: colors.amber, fontWeight: '800', marginBottom: 9 },
  bankHelp: { color: colors.muted, lineHeight: 20 },
  bankOptions: { gap: 6, marginBottom: 10 },
  bankOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  bankOptionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  bankOptionText: { color: colors.ink, fontWeight: '700' },
  bankOptionTextActive: { color: colors.primaryDark, fontWeight: '900' },
  success: { color: colors.green, marginBottom: 10, fontWeight: '800' },
});
