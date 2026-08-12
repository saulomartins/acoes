import React, { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { allowScreenCaptureAsync } from 'expo-screen-capture';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';

export default function App() {
  // O morador precisa conseguir printar a tela para pedir suporte (foi assim que
  // o layout quebrado dos cartões de cobrança chegou até nós — por foto de outro
  // celular, porque o print estava bloqueado). Libera a captura no boot para não
  // depender de nenhuma tela específica limpar o FLAG_SECURE que ela tenha ligado.
  useEffect(() => { allowScreenCaptureAsync(); }, []);

  return (
    // A partir do Android 15 (Expo SDK 54) o modo edge-to-edge é obrigatório: o app
    // desenha por baixo da status bar e da barra de gestos, e backgroundColor/
    // translucent do StatusBar não reservam mais espaço. Sem o SafeAreaProvider os
    // títulos das telas ficavam colados no relógio do sistema. Quem consome os
    // insets é o ResponsiveShell.
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar barStyle="dark-content" />
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  buttons: {
    width: '100%',
    maxWidth: 360,
  },
  buttonWrap: {
    marginVertical: 6,
  },
});
