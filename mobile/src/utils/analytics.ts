import { Platform } from 'react-native';

// Medição do site (Google Ads e, quando configurado, Google Analytics 4).
//
// LGPD: as tags do Google só são carregadas depois que o visitante clica em
// "Aceitar" no aviso de cookies (ui/CookieConsent). Quem recusa não carrega
// nada do Google. A escolha fica no localStorage e pode ser trocada em
// "Preferências de cookies", no rodapé.
//
// Só nas páginas públicas: quem chama initPublicTracking() são as telas
// públicas (landing, pílulas, login). A área logada nunca inicia a medição,
// e, se as tags já estiverem carregadas (o visitante aceitou e depois fez
// login), setPrivateArea(true) desliga o Analytics até sair.
//
// Tudo isso só existe no build web; no app nativo as funções não fazem nada.
const ADS_ID = 'AW-18518742796';
// ID de métricas do Google Analytics 4 (propriedade "Site Lar em Dia"). Vazio = Analytics desligado.
const GA4_ID = 'G-CJD751JJ15';

const CONVERSIONS = {
  // Ação "Enviar formulário de lead" do Google Ads: envio bem-sucedido do
  // formulário "Receber proposta personalizada". O site é uma página única,
  // então a conversão é disparada no momento da ação, e não pelo snippet de
  // "página de conversão" no <head>. (Até 18/10/2026 ia para a ação antiga
  // "Visualização de página", rótulo OWYsCOrB_Z8dEIyutv5E.)
  leadForm: 'AW-18518742796/tCYFCJzRpaEdEIyutv5E',
} as const;

export type ConsentChoice = 'granted' | 'denied';
const CONSENT_KEY = 'laremdia.cookieConsent';
const CONSENT_SIGNALS = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'] as const;

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } & Record<string, unknown>;
const isWeb = Platform.OS === 'web';
const win = () => window as unknown as GtagWindow;

export const getConsent = (): ConsentChoice | null => {
  if (!isWeb) return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
};

const consentState = (choice: ConsentChoice) => Object.fromEntries(CONSENT_SIGNALS.map((signal) => [signal, choice]));

let tagsLoaded = false;
let privateArea = false;
const loadTags = () => {
  if (!isWeb || tagsLoaded) return;
  tagsLoaded = true;
  const w = win();
  w.dataLayer = w.dataLayer || [];
  // O gtag.js exige o objeto `arguments` (não um array) em cada push.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  };
  w.gtag('consent', 'default', consentState('granted'));
  w.gtag('js', new Date());
  w.gtag('config', ADS_ID);
  if (GA4_ID) {
    w[`ga-disable-${GA4_ID}`] = privateArea;
    w.gtag('config', GA4_ID);
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
  document.head.appendChild(script);
};

const listeners = new Set<() => void>();
// Reabre o aviso de cookies (link "Preferências de cookies" no rodapé).
export const openCookiePreferences = () => listeners.forEach((listener) => listener());
export const subscribeCookiePreferences = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const setConsent = (choice: ConsentChoice) => {
  if (!isWeb) return;
  try { window.localStorage.setItem(CONSENT_KEY, choice); } catch { /* sem storage: vale só nesta visita */ }
  if (choice === 'granted') { loadTags(); return; }
  // Quem recusa depois de ter aceitado: o script já carregado não sai da
  // página, mas o Google para de usar cookies e o Analytics para de medir.
  const w = win();
  w.gtag?.('consent', 'update', consentState('denied'));
  if (GA4_ID) w[`ga-disable-${GA4_ID}`] = true;
};

export const initPublicTracking = () => {
  if (getConsent() === 'granted') loadTags();
};

export const setPrivateArea = (isPrivate: boolean) => {
  privateArea = isPrivate;
  if (isWeb && GA4_ID) win()[`ga-disable-${GA4_ID}`] = isPrivate || getConsent() !== 'granted';
};

// Eventos do Google Analytics (pedido de proposta, uso da Lari, pílulas).
// Só tipos de ação e identificadores do próprio site — nunca nome, e-mail,
// telefone ou o texto que a pessoa digitou. Sem aceite, `gtag` não existe e
// nada é enviado; logado, o Analytics está desligado (setPrivateArea).
type EventParams = Record<string, string | number>;
export const trackEvent = (name: 'generate_lead' | 'lari_open' | 'lari_question' | 'pill_view' | 'pill_search' | 'pill_question_sent', params: EventParams = {}) => {
  if (!isWeb || !GA4_ID) return;
  win().gtag?.('event', name, { ...params, send_to: GA4_ID });
};

export const trackConversion = (conversion: keyof typeof CONVERSIONS) => {
  if (!isWeb) return;
  win().gtag?.('event', 'conversion', { send_to: CONVERSIONS[conversion] });
};
