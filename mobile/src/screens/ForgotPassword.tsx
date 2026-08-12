import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { API_BASE_URL } from '../api/client';
import { AppButton } from '../ui/components';
import { colors, layout, shadow } from '../ui/theme';

export default function ForgotPassword({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Não foi possível solicitar a recuperação.');
      setMessage(data.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha na solicitação.');
    } finally { setLoading(false); }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <View style={styles.card}>
      <Text style={styles.eyebrow}>RECUPERAÇÃO DE ACESSO</Text>
      <Text style={styles.title}>Esqueceu sua senha?</Text>
      <Text style={styles.subtitle}>Informe o e-mail cadastrado. Enviaremos um link válido por 30 minutos.</Text>
      <Text style={styles.label}>E-mail</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="seu@email.com" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
      {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
      {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
      <AppButton title={loading ? 'Enviando...' : 'Enviar link de recuperação'} onPress={submit} disabled={loading || !email.includes('@')} />
      <Pressable onPress={() => navigation.navigate('Login')} style={styles.back}><Text style={styles.backText}>Voltar para o login</Text></Pressable>
    </View>
      </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
    root:{flex:1,backgroundColor:colors.background},container:{flexGrow:1,alignItems:'center',justifyContent:'center',padding:18},card:{width:'100%',maxWidth:460,backgroundColor:'#fff',borderWidth:1,borderColor:colors.border,borderRadius:layout.radius,padding:24,...shadow},eyebrow:{color:colors.primary,fontSize:12,fontWeight:'900',letterSpacing:1.1},title:{color:colors.ink,fontSize:27,fontWeight:'900',marginTop:8},subtitle:{color:colors.muted,fontSize:15,lineHeight:22,marginTop:7,marginBottom:24},label:{color:colors.ink,fontWeight:'800',marginBottom:7},input:{minHeight:52,borderWidth:1,borderColor:'#dbe1e7',borderRadius:layout.controlRadius,paddingHorizontal:13,fontSize:16,marginBottom:15},success:{backgroundColor:colors.softGreen,padding:11,borderRadius:8,marginBottom:12},successText:{color:colors.green,fontWeight:'700'},error:{backgroundColor:'#fff0f0',padding:11,borderRadius:8,marginBottom:12},errorText:{color:colors.red,fontWeight:'700'},back:{alignItems:'center',padding:14,marginTop:7},backText:{color:colors.primary,fontWeight:'800'},
});
