import * as StoreReview from 'expo-store-review';
import * as Updates from 'expo-updates';
import { Linking, Platform } from 'react-native';
import { storage } from '../context/AuthContext';

// Convite para avaliar o app na loja.
//
// Nenhuma loja informa ao app se a pessoa já avaliou — nem a Google Play nem
// a App Store expõem isso, e a API de avaliação dentro do app (In-App Review /
// SKStoreReviewController) não devolve se houve avaliação. Por isso o
// controle é local, por aparelho: tocar em "Avaliar" ou "Já avaliei" encerra
// os convites; "Agora não" adia por REPROMPT_AFTER_MS, no máximo MAX_DECLINES
// vezes.
//
// Política da Google Play: o convite não pode perguntar antes se a pessoa
// está gostando do app para só mandar à loja quem disser que sim — por isso
// ele é neutro e vai direto para a loja.

// Ligar cada loja só quando a página do app estiver PÚBLICA nela — antes
// disso o link abre "app não encontrado" para quem não é testador. Trocar
// para true e publicar por OTA (npm run update:production).
//  - Android: hoje em teste fechado na Google Play.
//  - iOS: publicação prevista para ~dez/2026; preencher appStoreId (o número
//    de apps.apple.com/.../id<NÚMERO>) quando existir.
export const STORE_LISTINGS = {
  android: { public: false, packageName: 'com.appcond.condominio' },
  ios: { public: false, appStoreId: null as string | null },
};

const DAY = 24 * 60 * 60 * 1000;
// Builds de teste (canal preview) e desenvolvimento: convite ligado mesmo com
// a loja ainda fechada. Os prazos são os mesmos da produção — nunca convidar
// no dia da instalação (decisão de 2026-09-30).
const isTestBuild = __DEV__ || Updates.channel === 'preview';
const FIRST_PROMPT_AFTER_MS = 7 * DAY;
const REPROMPT_AFTER_MS = 30 * DAY;
const MAX_DECLINES = 3;

const KEYS = {
  firstSeenAt: 'reviewFirstSeenAt',
  done: 'reviewDone',
  declines: 'reviewDeclines',
  lastPromptAt: 'reviewLastPromptAt',
};

const storeName = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
export const reviewStoreName = storeName;

export const isStoreReviewEnabled = () => {
  if (Platform.OS === 'android') return STORE_LISTINGS.android.public || isTestBuild;
  if (Platform.OS === 'ios') return STORE_LISTINGS.ios.public || isTestBuild;
  return false;
};

const readNumber = async (key: string) => Number((await storage.get(key)) || 0) || 0;

// Registra o primeiro uso (logado) neste aparelho — na prática, o dia da
// instalação — e é dele que contam os 7 dias.
export const recordFirstUse = async () => {
  if (!(await storage.get(KEYS.firstSeenAt))) await storage.set(KEYS.firstSeenAt, String(Date.now()));
};

export const shouldPromptReview = async () => {
  if (!isStoreReviewEnabled()) return false;
  if ((await storage.get(KEYS.done)) === 'true') return false;
  const declines = await readNumber(KEYS.declines);
  if (declines >= MAX_DECLINES) return false;
  const now = Date.now();
  const firstSeenAt = await readNumber(KEYS.firstSeenAt);
  if (!firstSeenAt || now - firstSeenAt < FIRST_PROMPT_AFTER_MS) return false;
  const lastPromptAt = await readNumber(KEYS.lastPromptAt);
  return !lastPromptAt || now - lastPromptAt >= REPROMPT_AFTER_MS;
};

export const markReviewDone = () => storage.set(KEYS.done, 'true');

export const markReviewDeclined = async () => {
  await storage.set(KEYS.declines, String((await readNumber(KEYS.declines)) + 1));
  await storage.set(KEYS.lastPromptAt, String(Date.now()));
};

// Android abre a página do app na Google Play, e não o In-App Review: esse
// fluxo só funciona em quem instalou pela Play (quem instalou o APK direto,
// pela tela "Instalar aplicativo", não veria nada) e não diz se abriu. No iOS
// o SKStoreReviewController é o caminho recomendado pela Apple; o link da App
// Store fica de reserva.
export const openStoreReview = async () => {
  if (Platform.OS === 'android') {
    const { packageName } = STORE_LISTINGS.android;
    try {
      await Linking.openURL(`market://details?id=${packageName}&showAllReviews=true`);
    } catch {
      await Linking.openURL(`https://play.google.com/store/apps/details?id=${packageName}&showAllReviews=true`);
    }
    return true;
  }
  if (Platform.OS === 'ios') {
    if (await StoreReview.isAvailableAsync().catch(() => false)) {
      await StoreReview.requestReview();
      return true;
    }
    const { appStoreId } = STORE_LISTINGS.ios;
    if (!appStoreId) return false;
    await Linking.openURL(`itms-apps://apps.apple.com/app/id${appStoreId}?action=write-review`);
    return true;
  }
  return false;
};
