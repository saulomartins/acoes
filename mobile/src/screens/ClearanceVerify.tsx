import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE_URL } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';

type VerifyResult = {
  valid: true; verificationCode: string; issuedAt: string; condominiumName: string;
  unitLabel: string | null; requesterName: string; issuerName: string; issuerRole: string; documentHash: string;
};

const roleLabel: Record<string, string> = { sindico: 'Síndico', subsindico: 'Subsíndico' };
const formatDateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
// Só maiúsculas/dígitos, agrupados de 4 em 4 — o mesmo formato impresso no PDF.
const maskCode = (value: string) => {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
};

// Página pública: quem recebeu o documento (banco, imobiliária, cartório)
// confere a autenticidade sem ter conta no sistema. Por isso ela vive na
// pilha não autenticada e fala direto com a rota pública da API.
export default function ClearanceVerify({ route, navigation }: any) {
  const { isMobile: compact } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [code, setCode] = useState(() => maskCode(String(route?.params?.code || '')));
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const verify = useCallback(async (value: string) => {
    const clean = value.replace(/[^A-Z0-9-]/g, '');
    if (clean.replace(/-/g, '').length < 12) { setError('Informe o código completo, como impresso no documento.'); setResult(null); setChecked(true); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/clearances/verify/${encodeURIComponent(clean)}`);
      const data = await response.json().catch(() => null);
      if (response.ok && data?.valid) setResult(data);
      else setError(data?.message || 'Não foi possível verificar este código.');
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.');
    } finally { setLoading(false); setChecked(true); }
  }, []);

  // Logado volta para onde estava; visitante externo vai para a Landing —
  // que só existe na web, então no app nativo o destino é o Login.
  const goBackToApp = useCallback(() => {
    if (userToken) {
      if (navigation?.canGoBack?.()) navigation.goBack();
      else navigation?.navigate('Home');
      return;
    }
    navigation?.navigate(Platform.OS === 'web' ? 'Landing' : 'Login');
  }, [navigation, userToken]);

  // Link direto do PDF (/verificar/CODIGO) já verifica sozinho ao abrir.
  useEffect(() => { const initial = String(route?.params?.code || ''); if (initial) verify(maskCode(initial)); }, [route?.params?.code, verify]);

  return (
    <ScrollView contentContainerStyle={[s.page, compact && s.pageMobile]}>
      <View style={s.card}>
        <View style={s.brand}>
          <Image source={require('../../assets/lar-em-dia-icon.png')} style={s.logo} resizeMode="contain" />
          <View>
            <Text style={s.brandName}>Lar em Dia</Text>
            <Text style={s.brandTag}>Verificação de documento</Text>
          </View>
        </View>

        <Text style={s.title}>Declaração de quitação condominial</Text>
        <Text style={s.intro}>Digite o código verificador impresso no rodapé do documento para confirmar se ele é autêntico e quem o emitiu.</Text>

        <Text style={s.label}>Código verificador</Text>
        <View style={s.inputRow}>
          <TextInput
            value={code}
            onChangeText={(value) => setCode(maskCode(value))}
            placeholder="XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            style={[s.input, s.grow]}
            onSubmitEditing={() => verify(code)}
          />
          <Pressable onPress={() => verify(code)} disabled={loading} style={[s.button, loading && s.buttonDisabled]}>
            <Text style={s.buttonText}>{loading ? 'Verificando...' : 'Verificar'}</Text>
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={colors.primary} style={s.spacer} /> : null}

        {result ? (
          <View style={s.resultOk}>
            <Text style={s.resultOkTitle}>✓ Documento autêntico</Text>
            <Text style={s.resultText}>Esta declaração foi emitida pelo sistema Lar em Dia e consta como válida.</Text>
            <View style={s.dataBox}>
              <Row label="Condomínio" value={result.condominiumName} />
              <Row label="Unidade" value={result.unitLabel || '—'} />
              <Row label="Declarado em nome de" value={result.requesterName} />
              <Row label="Emitido por" value={`${result.issuerName} (${roleLabel[result.issuerRole] || result.issuerRole})`} />
              <Row label="Data de emissão" value={formatDateTime(result.issuedAt)} />
              <Row label="Código" value={result.verificationCode} />
            </View>
            <Text style={s.hash}>Resumo de integridade (SHA-256): {result.documentHash}</Text>
            <Text style={s.hint}>Confira se o nome, a unidade e a data acima batem com os do documento em mãos. Divergência em qualquer um deles indica adulteração.</Text>
          </View>
        ) : null}

        {checked && !result && error ? (
          <View style={s.resultBad}>
            <Text style={s.resultBadTitle}>Não foi possível validar</Text>
            <Text style={s.resultText}>{error}</Text>
            <Text style={s.hint}>Um código não encontrado pode significar documento adulterado, declaração cancelada ou simplesmente erro de digitação.</Text>
          </View>
        ) : null}

        {navigation ? (
          <Pressable onPress={goBackToApp} style={s.backLink}><Text style={s.backLinkText}>← Voltar para o sistema</Text></Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={s.row}>
    <Text style={s.rowLabel}>{label}</Text>
    <Text style={s.rowValue}>{value}</Text>
  </View>
);

const s = StyleSheet.create({
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  pageMobile: { padding: 14 },
  card: { width: '100%', maxWidth: 620, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 26 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  logo: { width: 40, height: 40 },
  brandName: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  brandTag: { color: colors.muted, fontSize: 13, marginTop: 1 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  intro: { color: colors.muted, fontSize: 14.5, lineHeight: 21, marginTop: 8, marginBottom: 18 },
  label: { color: colors.ink, fontWeight: '800', marginBottom: 7 },
  inputRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grow: { flex: 1, minWidth: 180 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 14, fontSize: 17, letterSpacing: 1.5, color: colors.ink, backgroundColor: '#fff' },
  button: { minHeight: 52, paddingHorizontal: 22, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#aeb9c7' },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  spacer: { marginTop: 18 },
  resultOk: { marginTop: 22, borderWidth: 1, borderColor: '#a8ddd0', backgroundColor: colors.softGreen, borderRadius: 12, padding: 16 },
  resultOkTitle: { color: colors.green, fontSize: 17, fontWeight: '900' },
  resultBad: { marginTop: 22, borderWidth: 1, borderColor: '#efb4b4', backgroundColor: '#fff0f0', borderRadius: 12, padding: 16 },
  resultBadTitle: { color: colors.red, fontSize: 17, fontWeight: '900' },
  resultText: { color: '#445466', fontSize: 14, lineHeight: 20, marginTop: 6 },
  dataBox: { marginTop: 14, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowLabel: { color: colors.muted, fontSize: 13, fontWeight: '800', minWidth: 160 },
  rowValue: { color: colors.ink, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  hash: { color: colors.muted, fontSize: 11, marginTop: 14, lineHeight: 16 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  backLink: { marginTop: 22, alignSelf: 'center' },
  backLinkText: { color: colors.primary, fontWeight: '800' },
});
