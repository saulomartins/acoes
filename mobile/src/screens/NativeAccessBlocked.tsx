import React, { useContext } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AppButton } from '../ui/components';
import { AuthContext } from '../context/AuthContext';
import { colors, layout, shadow } from '../ui/theme';

// Este app é exclusivo para proprietários e inquilinos — síndico, subsíndico
// e administrador geral só existem na versão web (ver RESIDENT_ROLES em
// AuthContext). Quem cai aqui logou com uma conta sem nenhum perfil de
// morador para entrar.
export default function NativeAccessBlocked() {
  const { signOut } = useContext(AuthContext);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ACESSO INDISPONÍVEL NESTE APP</Text>
        <Text style={styles.title}>Este aplicativo é só para moradores</Text>
        <Text style={styles.subtitle}>
          Esta conta não tem um perfil de proprietário ou inquilino. Acesso de síndico e
          subsíndico só está disponível na versão web, em app.laremdia.com.br.
        </Text>
        <AppButton title="Sair" onPress={() => signOut()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 24, ...shadow },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 20 },
});
