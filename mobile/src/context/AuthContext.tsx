import React, { createContext, ReactNode, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE_URL } from '../api/client';
import { registerForPushNotifications, unregisterPushNotifications } from '../services/pushNotifications';

type UserRole = 'admin_geral' | 'sindico' | 'subsindico' | 'proprietario' | 'inquilino';

type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumName?: string | null;
  fullName?: string | null;
  mustChangePassword?: boolean;
  termsAcceptedVersion?: string | null;
  termsAcceptedAt?: string | null;
  tourCompletedVersion?: string | null;
  tourCompletedAt?: string | null;
  // null = perfil padrão. Setado = um dos perfis extras listados em `profiles`.
  activeProfileId?: string | null;
};

// Um login pode ter mais de um perfil (ex.: síndico que também é
// proprietário de uma unidade) — id null é sempre o perfil padrão.
export type Profile = {
  id: string | null;
  role: UserRole;
  condominiumId: string | null;
  condominiumName: string | null;
};

// Chaves de externals/api/src/services/featureCatalog.ts — mantidas em
// sincronia manualmente (mesmo padrão já usado para outros pequenos
// vocabulários compartilhados entre backend e mobile neste projeto).
export type FeatureKey =
  | 'pessoas' | 'tipologias' | 'blocos_unidades' | 'prestacao_contas'
  | 'gestao_cobrancas' | 'gestao_debitos' | 'historico_acordos'
  | 'config_enviar_cobrancas' | 'cobrancas_adicionais'
  | 'avisos_comunicacao' | 'relatos_solicitacoes' | 'enquetes' | 'reserva_espacos' | 'regimento_ocorrencias';

type AuthContextType = {
  user: AuthUser | null;
  userToken: string | null;
  isLoading: boolean;
  authError: string | null;
  pushStatus: 'idle' | 'registering' | 'registered' | 'permission_denied' | 'error';
  pushError: string | null;
  // null = admin_geral (sem condomínio único) ou ainda carregando — nesses
  // casos nada deve ser escondido por funcionalidade, só por papel.
  condominiumFeatures: Record<FeatureKey, boolean> | null;
  // Sempre tem ao menos o perfil padrão quando autenticado. Um seletor de
  // perfil só faz sentido exibir quando profiles.length > 1.
  profiles: Profile[];
  // true logo após um login explícito (usuário/senha) quando a pessoa tem
  // mais de um perfil — AppNavigator usa isso pra mostrar a tela "Entrar
  // como" antes do painel. Nunca fica true numa retomada silenciosa de
  // sessão (reabrir o app), só em signIn().
  needsProfileSelection: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  updateUser: (user: AuthUser) => Promise<void>;
  switchProfile: (profileId: string | null) => Promise<void>;
  selectProfile: (profileId: string | null) => Promise<void>;
};

type AuthResponse = {
  token: string;
  refreshToken?: string;
  user: AuthUser;
};

const storage = {
  get: async (key: string) => {
    if (Platform.OS === 'web') return window.localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  set: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      window.localStorage.setItem(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value);
  },
  delete: async (key: string) => {
    if (Platform.OS === 'web') {
      window.localStorage.removeItem(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
  },
};

const saveAuth = async (response: AuthResponse) => {
  await storage.set('userToken', response.token);
  await storage.set('authUser', JSON.stringify(response.user));

  if (response.refreshToken) {
    await storage.set('refreshToken', response.refreshToken);
  }
};

const clearAuth = async () => {
  await storage.delete('userToken');
  await storage.delete('refreshToken');
  await storage.delete('authUser');
};

const PUSH_TOKEN_KEY = 'expoPushToken';

const requestAuth = async (path: '/auth/login' | '/auth/register', username: string, password: string) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = (await response.json().catch(() => null)) as AuthResponse | { message?: string } | null;
  if (!response.ok) {
    const message = data && 'message' in data && data.message ? data.message : 'Falha na autenticacao';
    throw new Error(message);
  }

  if (!data || !('token' in data) || !data.token || !('user' in data)) {
    throw new Error('Resposta invalida do servidor');
  }

  return data;
};

const refreshAuth = async (refreshToken: string) => {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  const data = (await response.json().catch(() => null)) as AuthResponse | null;
  if (!response.ok || !data?.token || !data.user) {
    throw new Error('Sessao expirada');
  }

  return data;
};

const fetchProfiles = async (token: string): Promise<Profile[]> => {
  const response = await fetch(`${API_BASE_URL}/auth/profiles`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  const data = (await response.json().catch(() => null)) as { profiles?: Profile[] } | null;
  return data?.profiles ?? [];
};

const switchProfileRequest = async (refreshToken: string, profileId: string | null) => {
  const response = await fetch(`${API_BASE_URL}/auth/switch-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, profileId }),
  });

  const data = (await response.json().catch(() => null)) as AuthResponse | { message?: string } | null;
  if (!response.ok) {
    const message = data && 'message' in data && data.message ? data.message : 'Não foi possível trocar de perfil.';
    throw new Error(message);
  }
  if (!data || !('token' in data) || !data.token || !('user' in data)) {
    throw new Error('Resposta inválida do servidor');
  }

  return data;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  userToken: null,
  isLoading: false,
  authError: null,
  pushStatus: 'idle',
  pushError: null,
  condominiumFeatures: null,
  profiles: [],
  needsProfileSelection: false,
  signIn: async () => {},
  signOut: async () => {},
  signUp: async () => {},
  updateUser: async () => {},
  switchProfile: async () => {},
  selectProfile: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<AuthContextType['pushStatus']>('idle');
  const [pushError, setPushError] = useState<string | null>(null);
  const [condominiumFeatures, setCondominiumFeatures] = useState<Record<FeatureKey, boolean> | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [needsProfileSelection, setNeedsProfileSelection] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await storage.get('userToken');
        const refreshToken = await storage.get('refreshToken');
        const storedUser = await storage.get('authUser');

        if (refreshToken) {
          try {
            const response = await refreshAuth(refreshToken);
            await saveAuth(response);
            setUserToken(response.token);
            setUser(response.user);
            return;
          } catch (error) {
            // Se estiver offline, mantém a sessão já armazenada no aparelho.
            console.warn('Could not refresh auth session', error);
          }
        }

        if (token && storedUser) {
          setUserToken(token);
          setUser(JSON.parse(storedUser) as AuthUser);
        }
      } catch (e) {
        // Falhas temporárias (por exemplo, aparelho offline) não encerram a sessão.
        console.warn('Failed to restore auth session', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userToken || !user) {
      setPushStatus('idle');
      setPushError(null);
      return;
    }

    let active = true;
    setPushStatus('registering');
    setPushError(null);
    registerForPushNotifications(userToken)
      .then(async pushToken => {
        if (!active) return;
        if (pushToken) {
          await storage.set(PUSH_TOKEN_KEY, pushToken);
          setPushStatus('registered');
        } else {
          setPushStatus('permission_denied');
          setPushError('Permita as notificacoes nas configuracoes do aparelho.');
        }
      })
      .catch(error => {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Falha ao registrar este aparelho.';
        setPushStatus('error');
        setPushError(message);
        console.warn('Failed to register push notifications', error);
      });

    return () => { active = false; };
  }, [userToken, user?.id]);

  useEffect(() => {
    if (!userToken || !user) {
      setCondominiumFeatures(null);
      return;
    }
    if (user.role === 'admin_geral') {
      setCondominiumFeatures(null);
      return;
    }
    let active = true;
    const loadFeatures = () => fetch(`${API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${userToken}` } })
      .then(response => response.ok ? response.json() : null)
      .then((data: { condominiumFeatures?: Record<FeatureKey, boolean> | null } | null) => {
        if (active) setCondominiumFeatures(data?.condominiumFeatures ?? ({} as Record<FeatureKey,boolean>));
      })
      .catch(() => { if (active) setCondominiumFeatures({} as Record<FeatureKey,boolean>); });
    setCondominiumFeatures(null);
    loadFeatures();
    const timer=setInterval(loadFeatures,60_000);
    return () => { active = false; clearInterval(timer); };
  }, [userToken, user?.id, user?.role]);

  useEffect(() => {
    if (!userToken || !user) {
      setProfiles([]);
      return;
    }
    let active = true;
    fetchProfiles(userToken)
      .then(list => { if (active) setProfiles(list); })
      .catch(() => { if (active) setProfiles([]); });
    return () => { active = false; };
  }, [userToken, user?.id]);

  const applyAuthResponse = async (response: AuthResponse) => {
    await saveAuth(response);
    setUserToken(response.token);
    setUser(response.user);
  };

  const signIn = async (username: string, password: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await requestAuth('/auth/login', username.trim(), password);
      await applyAuthResponse(response);
      // Login explícito (não retomada de sessão): se a pessoa tem mais de um
      // perfil, o AppNavigator mostra a tela "Entrar como" antes do painel.
      const list = await fetchProfiles(response.token).catch(() => []);
      setProfiles(list);
      setNeedsProfileSelection(list.length > 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao entrar';
      setAuthError(message);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (username: string, password: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await requestAuth('/auth/register', username.trim(), password);
      await applyAuthResponse(response);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha ao registrar';
      setAuthError(message);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const updateUser = async (nextUser: AuthUser) => {
    await storage.set('authUser', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const switchProfile = async (profileId: string | null) => {
    const refreshToken = await storage.get('refreshToken');
    if (!refreshToken) throw new Error('Sessão expirada. Entre novamente.');
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await switchProfileRequest(refreshToken, profileId);
      await applyAuthResponse(response);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível trocar de perfil.';
      setAuthError(message);
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  // Usada pela tela "Entrar como" logo após o login (quando há mais de um
  // perfil). Diferente de switchProfile (troca a qualquer momento dentro do
  // app), esta só resolve a seleção pendente do login atual.
  const selectProfile = async (profileId: string | null) => {
    try {
      if (profileId !== (user?.activeProfileId ?? null)) {
        await switchProfile(profileId);
      }
    } finally {
      setNeedsProfileSelection(false);
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const refreshToken = await storage.get('refreshToken');
      const pushToken = await storage.get(PUSH_TOKEN_KEY);
      if (userToken && pushToken) {
        await unregisterPushNotifications(userToken, pushToken).catch(() => null);
        await storage.delete(PUSH_TOKEN_KEY);
      }
      if (refreshToken) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => null);
      }

      await clearAuth();
      setUserToken(null);
      setUser(null);
      setNeedsProfileSelection(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, userToken, isLoading, authError, pushStatus, pushError, condominiumFeatures, profiles, needsProfileSelection, signIn, signOut, signUp, updateUser, switchProfile, selectProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
