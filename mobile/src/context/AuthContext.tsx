import React, { createContext, ReactNode, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_BASE_URL, refreshSession } from '../api/client';
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
  | 'painel' | 'painel_usuarios' | 'indicadores_boletos' | 'nada_consta'
  | 'avisos_comunicacao' | 'relatos_solicitacoes' | 'enquetes' | 'reserva_espacos' | 'regimento_ocorrencias'
  | 'consumo_individualizado' | 'conselho_fiscal';

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
  // perfil só faz sentido exibir quando profiles.length > 1. No app nativo já
  // vem filtrado para só proprietário/inquilino (ver RESIDENT_ROLES) — o app
  // é exclusivo para moradores, síndico/subsíndico só existem na versão web.
  profiles: Profile[];
  // true logo após um login explícito (usuário/senha) quando a pessoa tem
  // mais de um perfil — AppNavigator usa isso pra mostrar a tela "Entrar
  // como" antes do painel. Nunca fica true numa retomada silenciosa de
  // sessão (reabrir o app), só em signIn().
  needsProfileSelection: boolean;
  // true no app nativo quando este login não tem nenhum perfil de morador
  // (proprietário/inquilino) para entrar — só síndico/subsíndico/admin, que
  // só existem na versão web. AppNavigator mostra uma tela bloqueando o
  // acesso em vez do painel.
  nativeAccessBlocked: boolean;
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

export const storage = {
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

// O app nativo (Android/iOS) é exclusivo para moradores — síndico e
// subsíndico só existem na versão web (app.laremdia.com.br). Filtrar aqui
// garante que nenhuma tela de seleção/troca de perfil no app chegue a listar
// esses papéis, mesmo que o login tenha perfis de gestão cadastrados.
const RESIDENT_ROLES: UserRole[] = ['proprietario', 'inquilino'];
const isNative = Platform.OS !== 'web';

const fetchProfiles = async (token: string): Promise<Profile[]> => {
  const response = await fetch(`${API_BASE_URL}/auth/profiles`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return [];
  const data = (await response.json().catch(() => null)) as { profiles?: Profile[] } | null;
  const list = data?.profiles ?? [];
  return isNative ? list.filter(profile => RESIDENT_ROLES.includes(profile.role)) : list;
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
  nativeAccessBlocked: false,
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
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [needsProfileSelection, setNeedsProfileSelection] = useState(false);
  const [nativeAccessBlocked, setNativeAccessBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await storage.get('userToken');
        const refreshToken = await storage.get('refreshToken');
        const storedUser = await storage.get('authUser');

        if (refreshToken) {
          try {
            // Compartilha o mutex de renovação com api/client.ts: se uma tela
            // já disparou uma renovação (401 em polling), esta chamada espera
            // o mesmo resultado em vez de reapresentar o refresh token antigo
            // em paralelo — evitar essa corrida é o que impede o backend de
            // interpretar como reuso indevido e revogar todas as sessões.
            const result = await refreshSession();
            if (result?.user) {
              setUserToken(result.token);
              setUser(result.user as AuthUser);
              return;
            }
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
      setProfilesLoaded(false);
      return;
    }
    let active = true;
    fetchProfiles(userToken)
      .then(list => { if (active) { setProfiles(list); setProfilesLoaded(true); } })
      .catch(() => { if (active) { setProfiles([]); setProfilesLoaded(true); } });
    return () => { active = false; };
  }, [userToken, user?.id]);

  // No app nativo, o perfil ativo nunca pode ficar em síndico/subsíndico/admin
  // (isso é o que fazia aparecer opções de gestão no menu — o menu já filtra
  // por user.role, então a garantia real é aqui). Cobre tanto o login quanto
  // a retomada silenciosa de sessão (reabrir o app): se há exatamente um
  // perfil de morador, troca sozinho; se há mais de um, mostra "Entrar como"
  // (só com opções de morador, já filtradas em fetchProfiles); se não há
  // nenhum, bloqueia o acesso — essa conta só existe na versão web.
  useEffect(() => {
    if (!isNative || !profilesLoaded || !user || needsProfileSelection) return;
    if (RESIDENT_ROLES.includes(user.role)) {
      setNativeAccessBlocked(false);
      return;
    }
    if (profiles.length === 0) {
      setNativeAccessBlocked(true);
      return;
    }
    setNativeAccessBlocked(false);
    if (profiles.length === 1) {
      switchProfile(profiles[0].id).catch(() => {});
    } else {
      setNeedsProfileSelection(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilesLoaded, user?.id, user?.role, profiles, needsProfileSelection]);

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
      setNativeAccessBlocked(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, userToken, isLoading, authError, pushStatus, pushError, condominiumFeatures, profiles, needsProfileSelection, nativeAccessBlocked, signIn, signOut, signUp, updateUser, switchProfile, selectProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
