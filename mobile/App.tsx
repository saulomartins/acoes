import React, { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { preventScreenCaptureAsync } from 'expo-screen-capture';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';

export default function App() {
  // Bloqueio de print/gravação de tela para o app inteiro (decisão explícita,
  // 2026-08-13): já existiu uma versão disso antes que foi removida porque
  // atrapalhava o morador a mandar print pra pedir suporte, e uma tela chegou
  // a "vazar" o bloqueio pro app inteiro por chamar a função errada no
  // unmount. Reativado mesmo assim, ciente do trade-off — se o suporte via
  // print voltar a ser um problema, considerar liberar por tela (ver
  // usePreventScreenCapture do expo-screen-capture) em vez de global.
  useEffect(() => { preventScreenCaptureAsync(); }, []);

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
