import React, { useContext, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AuthContext, type Profile } from '../context/AuthContext';
import { colors, layout, shadow } from '../ui/theme';

const roleLabels: Record<string, string> = { admin_geral: 'Administrador geral', sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };

export default function SelectProfile() {
  const { user, profiles, selectProfile, signOut } = useContext(AuthContext);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (profile: Profile) => {
    setLoadingId(profile.id ?? 'default');
    setError(null);
    try {
      await selectProfile(profile.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível entrar com esse perfil.');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>MAIS DE UM PERFIL</Text>
        <Text style={styles.title}>Como você quer entrar?</Text>
        <Text style={styles.subtitle}>Olá, {user?.fullName || user?.username}. Este usuário tem mais de um perfil neste condomínio — escolha com qual entrar agora. Você pode trocar depois pelo menu, sem precisar sair.</Text>

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

        {profiles.map(profile => {
          const key = profile.id ?? 'default';
          return (
            <Pressable
              key={key}
              onPress={() => choose(profile)}
              disabled={loadingId !== null}
              style={styles.option}
            >
              <Text style={styles.optionRole}>{roleLabels[profile.role] || profile.role}</Text>
              {profile.condominiumName ? <Text style={styles.optionMeta}>{profile.condominiumName}</Text> : null}
              <Text style={styles.optionAction}>{loadingId === key ? 'Entrando...' : 'Entrar com este perfil →'}</Text>
            </Pressable>
          );
        })}

        <Pressable onPress={signOut} style={styles.back}><Text style={styles.backText}>Sair</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 24, ...shadow },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 20 },
  error: { backgroundColor: '#fff0f0', padding: 11, borderRadius: 8, marginBottom: 12 },
  errorText: { color: colors.red, fontWeight: '700' },
  option: { borderWidth: 1, borderColor: '#dbe1e7', borderRadius: layout.controlRadius, padding: 16, marginBottom: 12 },
  optionRole: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  optionMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  optionAction: { color: colors.primary, fontWeight: '800', marginTop: 10 },
  back: { alignItems: 'center', padding: 14, marginTop: 7 },
  backText: { color: colors.primary, fontWeight: '800' },
});
