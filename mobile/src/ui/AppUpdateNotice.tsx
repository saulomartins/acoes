import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { AppDialog } from './components';

// Aviso de versão nova nas lojas, sem nenhuma configuração manual: ao abrir o
// app e ao voltar para ele, o próprio app pergunta à loja.
// - Android: Google Play (In-App Updates, via expo-in-app-updates). O
//   "Atualizar" abre a tela oficial do Google que baixa e instala sem sair do
//   app. Só funciona em app instalado pela Play Store.
// - iPhone: consulta pública da App Store pelo bundle id
//   (itunes.apple.com/lookup); "Atualizar" abre a página do app na loja.
// "Agora não" adia o aviso da mesma versão por REMIND_AFTER_MS. Qualquer falha
// (sem internet, Expo Go, app ainda fora da loja) só significa nenhum aviso.

const BUNDLE_ID = 'com.appcond.condominio';
const DISMISS_KEY = 'appUpdateDismissed';
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const installedVersion = Constants.expoConfig?.version || '';

// "1.7.10" > "1.7.9": compara número a número, nunca como texto.
const isNewer = (store: string, installed: string) => {
  const a = store.split('.').map(Number);
  const b = installed.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
};

// O módulo nativo não existe no Expo Go nem na web: carregado sob demanda para
// a falta dele não derrubar o app.
const playUpdates = () => {
  try {
    return require('expo-in-app-updates') as typeof import('expo-in-app-updates');
  } catch {
    return null;
  }
};

type Available = { storeVersion: string; label: string; update: () => Promise<void> };

const checkAndroid = async (): Promise<Available | null> => {
  const module = playUpdates();
  if (!module) return null;
  const result = await module.checkForUpdate();
  if (!result.updateAvailable) return null;
  return {
    storeVersion: result.storeVersion,
    label: 'na Play Store',
    update: async () => {
      if (result.immediateAllowed || result.flexibleAllowed) {
        const started = await module.startUpdate(Boolean(result.immediateAllowed)).catch(() => false);
        if (started) return;
      }
      await Linking.openURL(`market://details?id=${BUNDLE_ID}`)
        .catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${BUNDLE_ID}`))
        .catch(() => undefined);
    },
  };
};

const checkIos = async (): Promise<Available | null> => {
  const response = await fetch(`https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=br&_=${Date.now()}`);
  if (!response.ok) return null;
  const app = (await response.json())?.results?.[0];
  if (!app?.version || !app.trackViewUrl || !isNewer(app.version, installedVersion)) return null;
  return {
    storeVersion: app.version,
    label: `${app.version} na App Store`,
    update: async () => { await Linking.openURL(app.trackViewUrl).catch(() => undefined); },
  };
};

export default function AppUpdateNotice() {
  const [available, setAvailable] = useState<Available | null>(null);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || !installedVersion) return;
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
    lastCheck.current = Date.now();
    try {
      const found = Platform.OS === 'android' ? await checkAndroid() : await checkIos();
      if (!found) { setAvailable(null); return; }
      const dismissed = await SecureStore.getItemAsync(DISMISS_KEY).catch(() => null);
      const [dismissedVersion, dismissedAt] = (dismissed || '').split('|');
      if (dismissedVersion === found.storeVersion && Date.now() - Number(dismissedAt || 0) < REMIND_AFTER_MS) return;
      setAvailable(found);
    } catch {
      // sem conexão ou loja indisponível: tenta de novo quando o app voltar ao primeiro plano
      lastCheck.current = 0;
    }
  }, []);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => subscription.remove();
  }, [check]);

  if (!available) return null;

  const later = () => {
    void SecureStore.setItemAsync(DISMISS_KEY, `${available.storeVersion}|${Date.now()}`).catch(() => undefined);
    setAvailable(null);
  };

  return (
    <AppDialog
      visible
      title="Nova versão disponível"
      message={`Já existe uma versão mais nova do Lar em Dia ${available.label}. Atualize para ter as últimas melhorias e correções.`}
      confirmLabel="Atualizar"
      cancelLabel="Agora não"
      onConfirm={() => { const { update } = available; later(); void update(); }}
      onClose={later}
    />
  );
}
