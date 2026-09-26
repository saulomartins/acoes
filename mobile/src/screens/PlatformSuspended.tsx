import React, { useContext, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AppButton } from '../ui/components';
import { AuthContext } from '../context/AuthContext';
import { colors, layout, shadow } from '../ui/theme';

// Morador (proprietário/inquilino) de condomínio suspenso por inadimplência da
// assinatura da plataforma — a API bloqueia tudo pra ele (middleware/auth.ts)
// e o app mostra só este aviso no lugar das telas. A mensagem vem da API.
// "Tentar novamente" pergunta de novo: depois do pagamento libera na hora.
export default function PlatformSuspended() {
  const { platformSuspendedMessage, recheckPlatformAccess, signOut } = useContext(AuthContext);
  const [checking, setChecking] = useState(false);
  const [stillSuspended, setStillSuspended] = useState(false);

  const retry = async () => {
    setChecking(true);
    setStillSuspended(false);
    try {
      await recheckPlatformAccess();
    } finally {
      setChecking(false);
      // Se continuar suspenso, esta tela segue montada e mostra o aviso.
      setStillSuspended(true);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>ACESSO INDISPONÍVEL</Text>
        <Text style={styles.title}>Aplicativo temporariamente indisponível</Text>
        <Text style={styles.subtitle}>
          {platformSuspendedMessage || 'O acesso ao Lar em Dia está temporariamente indisponível para o seu condomínio. Para mais informações, entre em contato com a administração do condomínio.'}
        </Text>
        {stillSuspended ? <Text style={styles.hint}>O acesso continua indisponível. Tente novamente mais tarde.</Text> : null}
        <View style={styles.actions}>
          <AppButton title={checking ? 'Verificando...' : 'Tentar novamente'} loading={checking} onPress={retry} />
          <AppButton title="Sair" variant="secondary" onPress={() => signOut()} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: colors.background },
  card: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 24, ...shadow },
  eyebrow: { color: colors.red, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 8 },
  subtitle: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: 10 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 12 },
  actions: { gap: 10, marginTop: 20 },
});
