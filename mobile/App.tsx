import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';

export default function App() {
  // Print/gravação de tela liberados no app inteiro (decisão explícita,
  // 2026-08-18): o bloqueio global via preventScreenCaptureAsync (ativado em
  // 2026-08-13) atrapalhava o morador a mandar print pra pedir suporte.
  // Se algum dia for preciso bloquear de novo, fazer por tela específica com
  // usePreventScreenCapture do expo-screen-capture, nunca global.

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
