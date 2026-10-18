import { Platform } from 'react-native';

// Conversões do Google Ads. A tag base (gtag.js) é carregada em
// public/index.html, que só existe no build web — no app nativo `gtag` não
// existe e estas chamadas não fazem nada.
//
// O site é uma página única: o snippet de "carregamento de página" que o
// Google Ads sugere colar no <head> contaria toda visita como conversão. Por
// isso a conversão é disparada aqui, no momento em que a ação de fato
// acontece.
const CONVERSIONS = {
  // Ação criada no Google Ads como "Visualização de página"; aqui marca o
  // envio bem-sucedido do formulário "Receber proposta personalizada".
  leadForm: 'AW-18518742796/OWYsCOrB_Z8dEIyutv5E',
} as const;

export const trackConversion = (conversion: keyof typeof CONVERSIONS) => {
  if (Platform.OS !== 'web') return;
  const gtag = (globalThis as { gtag?: (...args: unknown[]) => void }).gtag;
  gtag?.('event', 'conversion', { send_to: CONVERSIONS[conversion] });
};
