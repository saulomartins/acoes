import React, { useContext, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { AppButton } from '../ui/components';
import { colors, shadow } from '../ui/theme';

export default function Register({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { signUp, isLoading, authError } = useContext(AuthContext);

  const handleSignUp = async () => {
    try {
      await signUp(username, password);
    } catch {
      // Error is exposed by authError in context.
    }
  };

  const canSubmit = username.trim().length >= 3 && password.length >= 6 && !isLoading;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.appName}>Lar em Dia</Text>
          <Text style={styles.title}>Comece pela configuracao inicial.</Text>
          <Text style={styles.subtitle}>Essa conta sera o admin geral para criar condominios e vincular sindicos.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Criar admin geral</Text>
          <Text style={styles.cardSubtitle}>Depois voce cadastra o condominio e o sindico responsavel.</Text>

          <Text style={styles.label}>Usuario</Text>
          <TextInput
            placeholder="admin"
            value={username}
            onChangeText={setUsername}
            style={styles.input}
            autoCapitalize="none"
            placeholderTextColor="#99a3b5"
          />

          <Text style={styles.label}>Senha</Text>
          <TextInput
            placeholder="Minimo 6 caracteres"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            placeholderTextColor="#99a3b5"
          />

          {authError ? <Text style={styles.error}>{authError}</Text> : null}

          <AppButton title={isLoading ? 'Criando...' : 'Criar admin geral'} onPress={handleSignUp} disabled={!canSubmit} />

          <Pressable style={styles.linkButton} onPress={() => navigation.navigate('Login')} disabled={isLoading}>
            <Text style={styles.linkText}>Ja tenho acesso</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: 20, paddingTop: 54, justifyContent: 'center' },
  hero: {
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    padding: 22,
    marginBottom: 16,
    ...shadow,
  },
  appName: { color: '#bfdbfe', fontSize: 16, fontWeight: '900', marginBottom: 10 },
  title: { color: '#fff', fontSize: 28, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: '#dbeafe', marginTop: 10, lineHeight: 21, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 18,
    ...shadow,
  },
  cardTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  cardSubtitle: { color: colors.muted, marginTop: 4, marginBottom: 18, lineHeight: 22 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '900', marginBottom: 7 },
  input: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fbfcfe',
    paddingHorizontal: 13,
    marginBottom: 12,
    color: colors.ink,
  },
  error: { color: colors.red, marginBottom: 12, fontWeight: '700' },
  linkButton: { alignItems: 'center', paddingTop: 16 },
  linkText: { color: colors.primary, fontWeight: '900' },
});
