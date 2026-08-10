import React, { useContext, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { AppButton } from '../ui/components';
import { colors, layout, shadow } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';

export default function Login({ navigation }: any) {
  const { isDesktop: desktop } = useBreakpoint();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, isLoading, authError } = useContext(AuthContext);
  const canSubmit = username.trim().length > 0 && password.length > 0 && !isLoading;

  const handleSignIn = async () => {
    try { await signIn(username, password); } catch { /* displayed by context */ }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={[styles.shell, desktop && styles.shellDesktop]}>
          <View style={[styles.presentation, desktop && styles.presentationDesktop]}>
            <View style={styles.brand}>
              <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.brandLogo} resizeMode="contain" />
              <View><Text style={styles.brandName}>Lar em Dia</Text><Text style={styles.brandCaption}>Gestão condominial</Text></View>
            </View>

            <View style={styles.heroContent}>
              <Text style={styles.eyebrow}>GESTÃO SIMPLES E CONECTADA</Text>
              <Text style={[styles.heroTitle, desktop && styles.heroTitleDesktop]}>Seu condomínio inteiro em um só lugar.</Text>
              <Text style={styles.heroText}>Financeiro, boletos, moradores e comunicados organizados para uma administração mais tranquila.</Text>

              <View style={styles.featureList}>
                <View style={styles.feature}><View style={styles.check}><Text style={styles.checkText}>✓</Text></View><Text style={styles.featureText}>Controle financeiro em tempo real</Text></View>
                <View style={styles.feature}><View style={styles.check}><Text style={styles.checkText}>✓</Text></View><Text style={styles.featureText}>Cobranças integradas ao Banco de Gestão Financeira</Text></View>
                <View style={styles.feature}><View style={styles.check}><Text style={styles.checkText}>✓</Text></View><Text style={styles.featureText}>Acesso seguro para gestão e moradores</Text></View>
              </View>
            </View>

            {desktop ? <Text style={styles.presentationFooter}>Lar em Dia · Gestão condominial inteligente</Text> : null}
          </View>

          <View style={[styles.loginArea, desktop && styles.loginAreaDesktop]}>
            <View style={[styles.loginCard, desktop && styles.loginCardDesktop]}>
              <View style={styles.mobileBrand}><Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.mobileBrandLogo} resizeMode="contain" /><Text style={styles.mobileBrandName}>Lar em Dia</Text></View>
              <Text style={styles.cardEyebrow}>BEM-VINDO DE VOLTA</Text>
              <Text style={styles.cardTitle}>Acesse sua conta</Text>
              <Text style={styles.cardSubtitle}>Entre com seus dados para continuar.</Text>

              <Text style={styles.label}>Usuário, CPF ou e-mail</Text>
              <TextInput placeholder="Digite seu usuário, CPF ou e-mail" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#99a3b5" />
              <Text style={styles.inputHint}>Você pode entrar de três formas: usuário de acesso, CPF (com ou sem pontos) ou e-mail cadastrado.</Text>
              <View style={styles.passwordLabel}><Text style={styles.label}>Senha</Text><Pressable onPress={() => navigation.navigate('ForgotPassword')}><Text style={styles.forgot}>Esqueci minha senha</Text></Pressable></View>
              <TextInput placeholder="Digite sua senha" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholderTextColor="#99a3b5" onSubmitEditing={canSubmit ? handleSignIn : undefined} />

              {authError ? <View style={styles.errorBox}><Text style={styles.error}>{authError}</Text></View> : null}
              <AppButton title={isLoading ? 'Entrando...' : 'Entrar no sistema'} onPress={handleSignIn} disabled={!canSubmit} />

              <View style={styles.security}><Text style={styles.securityIcon}>🔒</Text><Text style={styles.securityText}>Seus dados são protegidos e usados somente para autenticação.</Text></View>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, page: { flexGrow: 1 }, shell: { flex: 1, minHeight: 700, overflow: 'hidden' }, shellDesktop: { flexDirection: 'row' },
  presentation: { alignSelf: 'stretch', minWidth: 0, overflow: 'hidden', backgroundColor: colors.navy, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 34 }, presentationDesktop: { flex: 1.05, minHeight: '100%', paddingHorizontal: 64, paddingTop: 48, paddingBottom: 40, justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 14 }, brandLogo: { width: 60, height: 60 }, brandName: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: .2 }, brandCaption: { color: '#a9bbcc', fontSize: 15, marginTop: 3, fontWeight: '600' },
  heroContent: { alignSelf: 'stretch', maxWidth: 560, minWidth: 0, marginTop: 54 }, eyebrow: { color: '#65c7b6', fontSize: 14, fontWeight: '900', letterSpacing: 1.4, marginBottom: 14 }, heroTitle: { flexShrink: 1, color: '#fff', fontSize: 30, lineHeight: 38, fontWeight: '900', letterSpacing: -.6 }, heroTitleDesktop: { fontSize: 47, lineHeight: 55 }, heroText: { flexShrink: 1, color: '#b9c6d3', fontSize: 17, lineHeight: 23, marginTop: 17 },
  featureList: { marginTop: 30, gap: 14 }, feature: { flexDirection: 'row', alignItems: 'center', gap: 11 }, check: { width: 25, height: 25, borderRadius: 8, backgroundColor: '#173e4a', alignItems: 'center', justifyContent: 'center' }, checkText: { color: '#61c9b5', fontSize: 15, fontWeight: '900' }, featureText: { flex: 1, flexShrink: 1, color: '#d7e0e8', fontSize: 15, fontWeight: '600' }, presentationFooter: { color: '#71859a', fontSize: 13 },
  loginArea: { alignSelf: 'stretch', minWidth: 0, padding: 16, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, loginAreaDesktop: { flex: .95, paddingHorizontal: 60, paddingVertical: 50 }, loginCard: { alignSelf: 'stretch', minWidth: 0, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 20, overflow: 'hidden', ...shadow }, loginCardDesktop: { width: '100%', maxWidth: 430 }, mobileBrand: { display: 'none' }, mobileBrandLogo: { width: 38, height: 38 }, mobileBrandName: { color: colors.navy, fontWeight: '900', fontSize: 17 },
  cardEyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 }, cardTitle: { color: colors.ink, fontSize: 27, fontWeight: '900' }, cardSubtitle: { color: colors.muted, fontSize: 15, marginTop: 6, marginBottom: 25 }, label: { color: colors.ink, fontSize: 14, fontWeight: '800', marginBottom: 7 }, passwordLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, forgot: { color: colors.primary, fontSize: 13, fontWeight: '800', marginBottom: 7 },
  input: { alignSelf: 'stretch', minWidth: 0, minHeight: 52, borderRadius: layout.controlRadius, borderWidth: 1, borderColor: '#dbe1e7', backgroundColor: '#fff', paddingHorizontal: 13, marginBottom: 15, color: colors.ink, fontSize: 16 },
  // O campo acima já traz marginBottom: 15; a dica sobe um pouco para ficar
  // colada no input a que se refere, sem encostar no rótulo seguinte.
  inputHint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: -9, marginBottom: 15 }, errorBox: { backgroundColor: '#fff0f0', borderRadius: 8, padding: 10, marginBottom: 12 }, error: { color: colors.red, fontSize: 14, fontWeight: '700' },
  security: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 18 }, securityIcon: { fontSize: 14 }, securityText: { color: '#8a97a4', fontSize: 12, textAlign: 'center' },
});
