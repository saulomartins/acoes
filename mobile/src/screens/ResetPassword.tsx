import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { API_BASE_URL } from '../api/client';
import { AppButton } from '../ui/components';
import { colors, layout, shadow } from '../ui/theme';

export default function ResetPassword({ navigation, route }: any) {
  const token = String(route.params?.token || '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = token.length >= 32 && password.length >= 8 && password === confirmation;

  const submit = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,password}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Não foi possível alterar a senha.');
      setMessage(data.message); setPassword(''); setConfirmation('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao alterar a senha.'); }
    finally { setLoading(false); }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS==='ios'?'padding':undefined}><View style={styles.card}>
    <Text style={styles.eyebrow}>NOVO ACESSO</Text><Text style={styles.title}>Crie uma nova senha</Text>
    <Text style={styles.subtitle}>Use pelo menos 8 caracteres. Todos os acessos anteriores serão encerrados.</Text>
    {!token ? <View style={styles.error}><Text style={styles.errorText}>O link de recuperação não possui um token válido.</Text></View> : null}
    <Text style={styles.label}>Nova senha</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input}/>
    <Text style={styles.label}>Confirmar nova senha</Text><TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry style={styles.input}/>
    {confirmation && confirmation !== password ? <Text style={styles.mismatch}>As senhas não são iguais.</Text> : null}
    {message ? <View style={styles.success}><Text style={styles.successText}>{message}</Text></View> : null}
    {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    <AppButton title={loading?'Alterando...':'Alterar senha'} onPress={submit} disabled={loading||!valid}/>
    <Pressable onPress={()=>navigation.navigate('Login')} style={styles.back}><Text style={styles.backText}>Ir para o login</Text></Pressable>
  </View></KeyboardAvoidingView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center',padding:18},card:{width:'100%',maxWidth:460,backgroundColor:'#fff',borderWidth:1,borderColor:colors.border,borderRadius:layout.radius,padding:24,...shadow},eyebrow:{color:colors.primary,fontSize:12,fontWeight:'900',letterSpacing:1.1},title:{color:colors.ink,fontSize:27,fontWeight:'900',marginTop:8},subtitle:{color:colors.muted,fontSize:15,lineHeight:22,marginTop:7,marginBottom:24},label:{color:colors.ink,fontWeight:'800',marginBottom:7},input:{minHeight:52,borderWidth:1,borderColor:'#dbe1e7',borderRadius:layout.controlRadius,paddingHorizontal:13,fontSize:16,marginBottom:15},success:{backgroundColor:colors.softGreen,padding:11,borderRadius:8,marginBottom:12},successText:{color:colors.green,fontWeight:'700'},error:{backgroundColor:'#fff0f0',padding:11,borderRadius:8,marginBottom:12},errorText:{color:colors.red,fontWeight:'700'},mismatch:{color:colors.red,marginTop:-8,marginBottom:12},back:{alignItems:'center',padding:14,marginTop:7},backText:{color:colors.primary,fontWeight:'800'}});
