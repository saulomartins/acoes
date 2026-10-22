import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../api/client';
import { compareVersions } from '../utils/appVersion';
import { AppDialog } from './components';

// Aviso de versão nova na Play Store / App Store (só Android/iOS). Ao abrir o
// app e ao voltar para ele, consulta GET /app-version/:plataforma e compara
// com a versão instalada:
// - abaixo da versão mínima: atualização obrigatória, o aviso não fecha;
// - abaixo da mais recente: "Nova versão disponível", com "Agora não" — o
//   mesmo aviso volta só depois de REMIND_AFTER_MS.
// Falha de rede nunca bloqueia o app: sem resposta, nenhum aviso.

type StoreVersion = { latestVersion: string | null; minVersion: string | null; storeUrl: string | null; releaseNotes: string | null };

const DISMISS_KEY = 'appUpdateDismissed';
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const ANDROID_PACKAGE = 'com.appcond.condominio';

// Com runtimeVersion = appVersion, uma atualização OTA só chega para a mesma
// versão do binário, então a versão do expoConfig é a versão instalada da loja.
const installedVersion = Constants.expoConfig?.version || null;

const openStore = async (storeUrl: string) => {
  // No Android, abre direto o app da Play Store; se não der, o link https.
  if (Platform.OS === 'android' && storeUrl.includes('play.google.com')) {
    try {
      await Linking.openURL(`market://details?id=${ANDROID_PACKAGE}`);
      return;
    } catch {
      // segue para o link https
    }
  }
  await Linking.openURL(storeUrl).catch(() => undefined);
};

export default function AppUpdateNotice() {
  const [notice, setNotice] = useState<{ kind: 'required' | 'available'; version: StoreVersion } | null>(null);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || !installedVersion) return;
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    try {
      const response = await fetch(`${API_BASE_URL}/app-version/${Platform.OS}`);
      if (!response.ok) return;
      const version = (await response.json()) as StoreVersion;
      if (!version.storeUrl || !version.latestVersion) { setNotice(null); return; }
      if (version.minVersion && compareVersions(installedVersion, version.minVersion) < 0) {
        setNotice({ kind: 'required', version });
        return;
      }
      if (compareVersions(installedVersion, version.latestVersion) >= 0) { setNotice(null); return; }
      const dismissed = await SecureStore.getItemAsync(DISMISS_KEY).catch(() => null);
      const [dismissedVersion, dismissedAt] = (dismissed || '').split('|');
      if (dismissedVersion === version.latestVersion && Date.now() - Number(dismissedAt || 0) < REMIND_AFTER_MS) return;
      setNotice({ kind: 'available', version });
    } catch {
      // sem conexão: tenta de novo na próxima vez que o app voltar ao primeiro plano
      lastCheck.current = 0;
    }
  }, []);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => subscription.remove();
  }, [check]);

  if (!notice) return null;
  const { kind, version } = notice;
  const notes = version.releaseNotes ? `\n\nNovidades: ${version.releaseNotes}` : '';

  if (kind === 'required') {
    return (
      <AppDialog
        visible
        title="Atualize o Lar em Dia"
        message={`Esta versão do aplicativo (${installedVersion}) não é mais compatível. Atualize para a versão ${version.latestVersion} na loja para continuar usando.${notes}`}
        confirmLabel="Atualizar agora"
        onConfirm={() => { void openStore(version.storeUrl!); }}
        onClose={() => undefined}
      />
    );
  }

  const later = () => {
    void SecureStore.setItemAsync(DISMISS_KEY, `${version.latestVersion}|${Date.now()}`).catch(() => undefined);
    setNotice(null);
  };

  return (
    <AppDialog
      visible
      title="Nova versão disponível"
      message={`A versão ${version.latestVersion} do Lar em Dia já está na loja. Você está usando a ${installedVersion}.${notes}`}
      confirmLabel="Atualizar"
      cancelLabel="Agora não"
      onConfirm={() => { later(); void openStore(version.storeUrl!); }}
      onClose={later}
    />
  );
}
