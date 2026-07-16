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
};

type AuthContextType = {
  user: AuthUser | null;
  userToken: string | null;
  isLoading: boolean;
  authError: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
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

export const AuthContext = createContext<AuthContextType>({
  user: null,
  userToken: null,
  isLoading: false,
  authError: null,
  signIn: async () => {},
  signOut: async () => {},
  signUp: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

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
    if (!userToken || !user) return;

    let active = true;
    registerForPushNotifications(userToken)
      .then(async pushToken => {
        if (active && pushToken) await storage.set(PUSH_TOKEN_KEY, pushToken);
      })
      .catch(error => console.warn('Failed to register push notifications', error));

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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, userToken, isLoading, authError, signIn, signOut, signUp }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
