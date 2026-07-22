import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const defaultApiUrlByPlatform =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

const productionApiUrlFallback = 'https://acoes-production.up.railway.app';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || ((typeof __DEV__ !== 'undefined' && __DEV__) ? defaultApiUrlByPlatform : productionApiUrlFallback);

const authStorage = {
  get: async (key: string) =>
    Platform.OS === 'web' ? window.localStorage.getItem(key) : SecureStore.getItemAsync(key),
  set: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      window.localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
};

const refreshAccessToken = async () => {
  const refreshToken = await authStorage.get('refreshToken');
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const data = (await response.json().catch(() => null)) as { token?: string; refreshToken?: string; user?: unknown } | null;
  if (!response.ok || !data?.token) return null;

  await authStorage.set('userToken', data.token);
  if (data.refreshToken) await authStorage.set('refreshToken', data.refreshToken);
  if (data.user) await authStorage.set('authUser', JSON.stringify(data.user));
  return data.token;
};

export const apiRequest = async <T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> => {
  const storedToken = await authStorage.get('userToken');
  const request = (accessToken: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });

  let response = await request(storedToken || token);
  if (response.status === 401) {
    const renewedToken = await refreshAccessToken();
    if (renewedToken) response = await request(renewedToken);
  }

  const data = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    const maybeError = data as { message?: string } | null;
    const message = maybeError?.message || 'Falha na requisicao';
    throw new Error(message);
  }

  return data as T;
};

export const apiUpload = async <T>(path:string, token:string, file:File | {uri:string;name:string;mimeType?:string}):Promise<T> => {
  const form=new FormData();
  if ('uri' in file) form.append('file',{uri:file.uri,name:file.name,type:file.mimeType||'application/pdf'} as any);
  else form.append('file',file);
  const accessToken=await authStorage.get('userToken') || token;
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),45000);
  let response:Response;
  try { response=await fetch(`${API_BASE_URL}${path}`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`},body:form,signal:controller.signal}); }
  catch(error){ if((error as Error).name==='AbortError') throw new Error('A importação excedeu 45 segundos. Verifique o arquivo e tente novamente.'); throw error; }
  finally { clearTimeout(timeout); }
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.message || 'Falha ao importar arquivo');
  return data as T;
};

export const downloadAuthenticated = async (path:string,token:string,filename:string) => {
  const accessToken=await authStorage.get('userToken') || token;
  if (Platform.OS !== 'web') {
    if (!FileSystem.cacheDirectory) throw new Error('Armazenamento temporário indisponível.');
    const localUri = `${FileSystem.cacheDirectory}${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g,'-')}`;
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}${path}`, localUri, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (result.status < 200 || result.status >= 300) { await FileSystem.deleteAsync(localUri,{idempotent:true}).catch(()=>null); throw new Error('Falha ao baixar arquivo'); }
    if (!(await Sharing.isAvailableAsync())) throw new Error('O compartilhamento de arquivos não está disponível neste aparelho.');
    try { await Sharing.shareAsync(localUri,{dialogTitle:'Exportar arquivo'}); }
    finally { await FileSystem.deleteAsync(localUri,{idempotent:true}).catch(()=>null); }
    return;
  }
  const response=await fetch(`${API_BASE_URL}${path}`,{headers:{Authorization:`Bearer ${accessToken}`}});
  if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.message||'Falha ao baixar arquivo');}
  const blob=await response.blob(); const url=URL.createObjectURL(blob); const anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;anchor.click();URL.revokeObjectURL(url);
};

export const openAuthenticatedPdf = async (path:string,token:string) => {
  const accessToken=await authStorage.get('userToken') || token;
  if (Platform.OS !== 'web') {
    if (!FileSystem.cacheDirectory) throw new Error('Não foi possível acessar o armazenamento temporário do aparelho.');
    const localUri = `${FileSystem.cacheDirectory}boleto-${Date.now()}.pdf`;
    const result = await FileSystem.downloadAsync(`${API_BASE_URL}${path}`, localUri, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => null);
      let detailedMessage = '';
      try {
        const fallback = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const payload = await fallback.json().catch(() => null) as { message?: string } | null;
        if (payload?.message) detailedMessage = payload.message;
      } catch {
        // Ignore fallback failures and keep generic message.
      }
      throw new Error(detailedMessage || 'Não foi possível baixar o boleto em PDF.');
    }
    if (!(await Sharing.isAvailableAsync())) throw new Error('Nenhum visualizador de PDF está disponível neste aparelho.');
    try { await Sharing.shareAsync(localUri, { mimeType: 'application/pdf', dialogTitle: 'Abrir ou imprimir boleto', UTI: 'com.adobe.pdf' }); }
    finally { await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => null); }
    return;
  }
  const response=await fetch(`${API_BASE_URL}${path}`,{headers:{Authorization:`Bearer ${accessToken}`}});
  if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.message||'Falha ao abrir o PDF');}
  const blob=await response.blob();const url=URL.createObjectURL(blob);const popup=window.open(url,'_blank','noopener,noreferrer');
  if(!popup){URL.revokeObjectURL(url);throw new Error('O navegador bloqueou a abertura do PDF. Permita pop-ups para esta aplicação.');}
  setTimeout(()=>URL.revokeObjectURL(url),60000);
};

export const openAuthenticatedFile = async(path:string,token:string,fileName:string,mimeType:string) => {
 const accessToken=await authStorage.get('userToken')||token;
 if(Platform.OS==='web'){const response=await fetch(`${API_BASE_URL}${path}`,{headers:{Authorization:`Bearer ${accessToken}`}});if(!response.ok)throw new Error('Falha ao abrir anexo');const url=URL.createObjectURL(await response.blob());const popup=window.open(url,'_blank','noopener,noreferrer');if(!popup)throw new Error('Permita pop-ups para visualizar o anexo.');setTimeout(()=>URL.revokeObjectURL(url),60000);return;}
 if(!FileSystem.cacheDirectory)throw new Error('Armazenamento temporário indisponível.');const extension=fileName.split('.').pop()||'bin';const local=`${FileSystem.cacheDirectory}prestacao-${Date.now()}.${extension}`;const result=await FileSystem.downloadAsync(`${API_BASE_URL}${path}`,local,{headers:{Authorization:`Bearer ${accessToken}`}});if(result.status<200||result.status>=300)throw new Error('Falha ao baixar anexo');try{await Sharing.shareAsync(local,{mimeType,dialogTitle:'Visualizar comprovante'});}finally{await FileSystem.deleteAsync(local,{idempotent:true}).catch(()=>null)}
};
