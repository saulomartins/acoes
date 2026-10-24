import { AppState, Platform } from 'react-native';
import { apiRequest } from '../api/client';

// Contadores de "não lidos" (avisos e relatos) do menu e da tela Início.
// Os dois consultavam os mesmos endpoints a cada 30 s, em dobro, e também
// com a aba escondida ou o app em segundo plano. Aqui vira uma consulta só,
// compartilhada (quem pedir dentro de CACHE_MS recebe o mesmo resultado).
export type AttentionCounts = { unreadNotices: number; unreadReports: number };

const CACHE_MS = 15_000;
let cached: { token: string; at: number; value: AttentionCounts } | null = null;
let inFlight: { token: string; promise: Promise<AttentionCounts> } | null = null;

// Tela visível e app em primeiro plano: fora disso, o polling pula a rodada.
export const isAppVisible = () => {
  if (Platform.OS === 'web') return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return AppState.currentState === 'active';
};

// O endpoint leve /reports/unread-count é de 24/10/2026; se a API ainda não o
// tiver (ou o recurso estiver desligado), cai na lista completa como antes.
const unreadReportsCount = async (token: string) => {
  try {
    return (await apiRequest<{ count: number }>('/reports/unread-count', token)).count || 0;
  } catch {
    const data = await apiRequest<{ reports: Array<{ unread_count: number }> }>('/reports', token);
    return data.reports.reduce((sum, report) => sum + Number(report.unread_count || 0), 0);
  }
};

export const fetchAttention = async (token: string, options: { force?: boolean } = {}): Promise<AttentionCounts> => {
  if (!options.force && cached && cached.token === token && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inFlight && inFlight.token === token) return inFlight.promise;
  const promise = (async () => {
    const [notices, reports] = await Promise.all([
      apiRequest<{ count: number }>('/notifications/unread-count', token).then(data => data.count || 0),
      unreadReportsCount(token).catch(() => 0),
    ]);
    const value = { unreadNotices: notices, unreadReports: reports };
    cached = { token, at: Date.now(), value };
    return value;
  })();
  inFlight = { token, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
};
