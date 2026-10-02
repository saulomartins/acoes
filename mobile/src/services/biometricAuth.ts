import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { API_BASE_URL, apiRequest } from '../api/client';
import { storage } from '../context/AuthContext';

// Biometria (digital/rosto) do app nativo, em dois papéis:
// - desbloqueio: libera a sessão (refresh token) já guardada no SecureStore;
// - login: depois de "Sair", troca a credencial de biometria guardada no
//   aparelho (ver getBiometricLogin) por uma sessão nova.
// A senha nunca fica no aparelho. Se o servidor recusar a credencial, o
// morador volta para o login com senha como sempre.
//
// A preferência é por usuário e por aparelho (chave com o id do usuário), e
// fica fora de clearAuth() de propósito: sair da conta não deve desligar a
// biometria de quem entra de novo no mesmo celular.
const enabledKey = (userId: string) => `biometricEnabled_${userId}`;
// Marca que a pergunta "Usar biometria?" já foi feita, para não repetir a
// cada login de quem respondeu "Agora não".
const askedKey = (userId: string) => `biometricAsked_${userId}`;

export const isBiometricAvailable = async () => {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
};

export const isBiometricEnabled = async (userId: string) => (await storage.get(enabledKey(userId))) === 'true';

export const setBiometricEnabled = async (userId: string, enabled: boolean) => {
  await storage.set(askedKey(userId), 'true');
  if (enabled) await storage.set(enabledKey(userId), 'true');
  else await storage.delete(enabledKey(userId));
};

export const wasBiometricAsked = async (userId: string) => (await storage.get(askedKey(userId))) === 'true';

export const markBiometricAsked = (userId: string) => storage.set(askedKey(userId), 'true');

// Credencial de "Entrar com biometria" (api: POST /auth/biometric). É o que
// permite entrar pela digital depois de "Sair", quando já não existe sessão
// para destravar. Uma por aparelho — a do último morador que ativou — e, como
// a preferência acima, fica fora de clearAuth() de propósito.
const LOGIN_KEY = 'biometricLogin';
export type BiometricLogin = { userId: string; name: string; token: string };

export const getBiometricLogin = async (): Promise<BiometricLogin | null> => {
  try {
    const stored = await storage.get(LOGIN_KEY);
    return stored ? (JSON.parse(stored) as BiometricLogin) : null;
  } catch {
    return null;
  }
};

// Pede ao servidor uma credencial nova para este usuário e guarda no
// aparelho, revogando a anterior (mesmo que seja de outra pessoa). Falha de
// rede só deixa sem o login por biometria; o desbloqueio continua valendo e
// o BiometricGate tenta de novo na próxima abertura.
export const registerBiometricLogin = async (user: { id: string; username: string; fullName?: string | null }, accessToken: string) => {
  try {
    const previous = await getBiometricLogin();
    const data = await apiRequest<{ biometricToken: string }>('/auth/biometric', accessToken, {
      method: 'POST',
      body: JSON.stringify({ replaceToken: previous?.token }),
    });
    const name = user.fullName?.trim().split(/\s+/)[0] || user.username;
    await storage.set(LOGIN_KEY, JSON.stringify({ userId: user.id, name, token: data.biometricToken }));
    return true;
  } catch {
    return false;
  }
};

// Desliga o login por biometria deste usuário neste aparelho (e no servidor).
export const forgetBiometricLogin = async (userId: string) => {
  const current = await getBiometricLogin();
  if (!current || current.userId !== userId) return;
  await storage.delete(LOGIN_KEY);
  await fetch(`${API_BASE_URL}/auth/biometric/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ biometricToken: current.token }),
  }).catch(() => null);
};

// O servidor recusou a credencial (senha trocada, conta desativada, logout
// forçado pelo suporte): só some do aparelho, sem chamada nenhuma.
export const discardBiometricLogin = () => storage.delete(LOGIN_KEY);

// Último momento em que o app estava destravado e em uso — gravado ao ir
// para o segundo plano. Fica no aparelho (e não só em memória) porque o
// Android costuma encerrar o app em segundo plano: sem isso, reabrir 10
// segundos depois contava como "abrir do zero" e pedia a digital toda vez.
const LAST_ACTIVE_KEY = 'biometricLastActiveAt';

export const recordLastActive = () => storage.set(LAST_ACTIVE_KEY, String(Date.now()));

export const getLastActiveAt = async () => Number((await storage.get(LAST_ACTIVE_KEY)) || 0) || null;

// disableDeviceFallback: false deixa o sistema oferecer o PIN/padrão do
// aparelho quando a biometria falha várias vezes — mesmo nível de proteção
// do bloqueio de tela, e evita que um dedo machucado tranque o morador fora.
export const authenticateWithBiometrics = async (promptMessage = 'Desbloquear o Lar em Dia') => {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancelar',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
};

// Só para o texto das telas ("digital" x "rosto"). Aparelho com os dois
// cadastrados fica no genérico, porque o sistema escolhe qual usar.
export type BiometricKind = 'face' | 'fingerprint' | 'generic';

export const getBiometricKind = async (): Promise<BiometricKind> => {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (face && !finger) return 'face';
    if (finger && !face) return 'fingerprint';
  } catch {
    // cai no genérico
  }
  return 'generic';
};

// Texto do botão da tela de login.
export const biometricLoginLabel: Record<BiometricKind, string> = {
  fingerprint: 'Entrar com a digital',
  face: Platform.OS === 'ios' ? 'Entrar com Face ID' : 'Entrar com o rosto',
  generic: 'Entrar com biometria',
};
