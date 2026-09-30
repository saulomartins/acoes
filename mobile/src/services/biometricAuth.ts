import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { storage } from '../context/AuthContext';

// Desbloqueio por biometria (digital/rosto) do app nativo. A biometria nunca
// substitui a senha no servidor: ela só libera a sessão (refresh token) que
// já está guardada no SecureStore deste aparelho. Se a sessão acabar no
// servidor, o morador volta para o login com senha como sempre.
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
