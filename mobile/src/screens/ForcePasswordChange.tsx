import React, { useContext, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton } from '../ui/components';
import { colors, layout, shadow } from '../ui/theme';

export default function ForcePasswordChange() {
  const { userToken, updateUser, signOut } = useContext(AuthContext);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = password.length >= 8 && password === confirmation;

  const submit = async () => {
    if (!userToken) return;
    setLoading(true); setError(null);
    try {
      const response = await apiRequest<{ user: any }>('/auth/change-password', userToken, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await updateUser(response.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao alterar a senha.');
    } finally {
      setLoading(false);
    }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled"><View style={styles.card}>
    <Text style={styles.eyebrow}>PRIMEIRO ACESSO</Text><Text style={styles.title}>Crie uma nova senha</Text>
    <Text style={styles.subtitle}>Por segurança, você precisa trocar a senha inicial antes de continuar. Use pelo menos 8 caracteres.</Text>
    <Text style={styles.label}>Nova senha</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
    <Text style={styles.label}>Confirmar nova senha</Text><TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry style={styles.input} />
    {confirmation && confirmation !== password ? <Text style={styles.mismatch}>As senhas não são iguais.</Text> : null}
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    <AppButton title={loading ? 'Alterando...' : 'Alterar senha'} onPress={submit} disabled={loading || !valid} />
    <Pressable onPress={signOut} style={styles.back}><Text style={styles.backText}>Sair</Text></Pressable>
  </View></ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 24, ...shadow },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 24 },
  label: { color: colors.ink, fontWeight: '800', marginBottom: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#dbe1e7', borderRadius: layout.controlRadius, paddingHorizontal: 13, fontSize: 16, marginBottom: 15 },
  error: { backgroundColor: '#fff0f0', padding: 11, borderRadius: 8, marginBottom: 12 },
  errorText: { color: colors.red, fontWeight: '700' },
  mismatch: { color: colors.red, marginTop: -8, marginBottom: 12 },
  back: { alignItems: 'center', padding: 14, marginTop: 7 },
  backText: { color: colors.primary, fontWeight: '800' },
});
