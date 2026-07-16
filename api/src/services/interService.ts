import fs from 'fs';
import https from 'https';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { config } from '../config';

type BoletoInput = {
  payerName: string;
  payerDocument: string;
  amountCents: number;
  dueDate: string;
  description: string;
  payerEmail?: string | null;
  payerPhone?: string | null;
  payerStreet: string;
  payerNumber: string;
  payerComplement?: string | null;
  payerNeighborhood: string;
  payerCity: string;
  payerState: string;
  payerPostalCode: string;
  payerUnit?: string | null;
};

export type InterIntegrationConfig = {
  id: string;
  clientId: string;
  clientSecret: string;
  certPath: string;
  keyPath: string;
  certPassphrase?: string | null;
  baseUrl: string;
  tokenPath: string;
  scopes: string;
  enabled: boolean;
};

type InterTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();

const envIntegration = (): InterIntegrationConfig | null => {
  if (!config.inter.clientId || !config.inter.clientSecret || !config.inter.certPath || !config.inter.keyPath) {
    return null;
  }

  return {
    id: 'env',
    clientId: config.inter.clientId,
    clientSecret: config.inter.clientSecret,
    certPath: config.inter.certPath,
    keyPath: config.inter.keyPath,
    certPassphrase: config.inter.certPassphrase,
    baseUrl: config.inter.baseUrl,
    tokenPath: config.inter.tokenPath,
    scopes: config.inter.scopes,
    enabled: true,
  };
};

const isConfigured = (integration: InterIntegrationConfig | null | undefined) =>
  Boolean(
    integration?.enabled &&
      integration.clientId &&
      integration.clientSecret &&
      integration.certPath &&
      integration.keyPath &&
      integration.baseUrl &&
      integration.tokenPath,
  );

const getHttpsAgent = (integration: InterIntegrationConfig) =>
  new https.Agent({
    cert: fs.readFileSync(integration.certPath),
    key: fs.readFileSync(integration.keyPath),
    passphrase: integration.certPassphrase || undefined,
  });

const interRequest = <T>(
  integration: InterIntegrationConfig,
  path: string,
  options: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  },
) =>
  new Promise<T>((resolve, reject) => {
    const url = new URL(path, integration.baseUrl);
    const body = options.body || '';

    const request = https.request(
      url,
      {
        method: options.method,
        agent: getHttpsAgent(integration),
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.headers || {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const data = responseText ? JSON.parse(responseText) : null;

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            const violations = Array.isArray((data as any)?.violacoes)
              ? (data as any).violacoes.map((item: any) => item?.razao).filter(Boolean).join(' ')
              : '';
            const detail = violations || (data as any)?.detail || response.statusMessage || 'O Banco Inter rejeitou a solicitação.';
            const apiError = new Error(detail);
            (apiError as any).statusCode = response.statusCode;
            (apiError as any).provider = 'inter';
            return reject(apiError);
          }

          return resolve(data as T);
        });
      },
    );

    request.on('error', (error: any) => {
      const nestedMessage = Array.isArray(error?.errors) ? error.errors.find((item: any) => item?.message)?.message : null;
      const message = error?.message || nestedMessage || (error?.code === 'EACCES'
        ? 'O servidor não possui permissão para acessar o Banco Inter por HTTPS.'
        : 'Falha de conexão com o Banco Inter.');
      const connectionError = new Error(message);
      (connectionError as any).code = error?.code;
      reject(connectionError);
    });

    request.setTimeout(15_000, () => {
      request.destroy(new Error('Tempo limite excedido ao conectar com o Banco Inter.'));
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });

export const getInterAccessToken = async (integrationInput?: InterIntegrationConfig | null) => {
  const integration = integrationInput || envIntegration();

  if (!isConfigured(integration)) {
    return null;
  }

  const activeIntegration = integration as InterIntegrationConfig;
  const cacheKey = activeIntegration.id;
  const cachedToken = tokenCache.get(cacheKey);

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: activeIntegration.clientId,
    client_secret: activeIntegration.clientSecret,
    scope: activeIntegration.scopes,
  });

  const token = await interRequest<InterTokenResponse>(activeIntegration, activeIntegration.tokenPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const nextToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };

  tokenCache.set(cacheKey, nextToken);

  return nextToken.accessToken;
};

export const createInterBoleto = async (input: BoletoInput, integration?: InterIntegrationConfig | null) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new Error('A data de vencimento deve estar no formato AAAA-MM-DD para envio ao Banco Inter.');
  }
  const accessToken = await getInterAccessToken(integration);

  if (!accessToken) {
    return {
      provider: 'inter',
      status: 'pending_configuration',
      externalId: null,
      digitableLine: null,
      pdfUrl: null,
      payload: input,
    };
  }

  const phone = (input.payerPhone || '').replace(/\D/g, '');
  const seuNumero = randomUUID().replace(/-/g, '').slice(0, 15);
  const response = await interRequest<{ codigoSolicitacao: string }>(integration as InterIntegrationConfig, '/cobranca/v3/cobrancas', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seuNumero,
      valorNominal: Number((input.amountCents / 100).toFixed(2)),
      dataVencimento: input.dueDate,
      numDiasAgenda: 30,
      pagador: {
        ...(input.payerEmail ? { email: input.payerEmail } : {}),
        ...(phone.length >= 10 ? { ddd: phone.slice(0, 2), telefone: phone.slice(2) } : {}),
        numero: input.payerNumber,
        complemento: input.payerComplement || input.payerUnit || undefined,
        cpfCnpj: input.payerDocument.replace(/\D/g, ''),
        tipoPessoa: input.payerDocument.replace(/\D/g, '').length === 11 ? 'FISICA' : 'JURIDICA',
        nome: input.payerName,
        endereco: input.payerStreet,
        bairro: input.payerNeighborhood,
        cidade: input.payerCity,
        uf: input.payerState.toUpperCase(),
        cep: input.payerPostalCode.replace(/\D/g, ''),
      },
      mensagem: { linha1: input.description.slice(0, 78) },
      formasRecebimento: ['BOLETO', 'PIX'],
    }),
  });

  return {
    provider: 'inter',
    status: 'processing',
    externalId: response.codigoSolicitacao,
    digitableLine: null,
    pdfUrl: `/cobranca/v3/cobrancas/${response.codigoSolicitacao}/pdf`,
    payload: input,
    seuNumero,
  };
};

export const getInterBoleto = async (codigoSolicitacao: string, integration: InterIntegrationConfig) => {
  const accessToken = await getInterAccessToken(integration);
  if (!accessToken) throw new Error('Inter integration is disabled or incomplete');
  return interRequest<{
    cobranca: { situacao: string; dataSituacao?: string; dataVencimento?: string; valorNominal?: number };
    boleto?: { linhaDigitavel?: string; codigoBarras?: string };
    pix?: { pixCopiaECola?: string };
  }>(integration, `/cobranca/v3/cobrancas/${codigoSolicitacao}`, {
    method: 'GET', headers: { Authorization: `Bearer ${accessToken}` },
  });
};

export const getInterBoletoPdf = async (codigoSolicitacao: string, integration: InterIntegrationConfig) => {
  const accessToken=await getInterAccessToken(integration);
  if(!accessToken)throw new Error('Integração Banco Inter desabilitada ou incompleta.');
  return new Promise<Buffer>((resolve,reject)=>{
    const request=https.request(new URL(`/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`,integration.baseUrl),{
      method:'GET',agent:getHttpsAgent(integration),headers:{Accept:'application/json',Authorization:`Bearer ${accessToken}`},
    },response=>{const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(Buffer.from(chunk)));response.on('end',()=>{const buffer=Buffer.concat(chunks);const text=buffer.toString('utf8');if(!response.statusCode||response.statusCode<200||response.statusCode>=300){let message=text;try{const parsed=JSON.parse(text);message=parsed?.violacoes?.map((item:any)=>item.razao).join(' ')||parsed?.detail||text}catch{}return reject(new Error(message||'O Banco Inter não disponibilizou o PDF deste boleto.'))}try{const parsed=JSON.parse(text);const encoded=typeof parsed==='string'?parsed:parsed?.pdf||parsed?.arquivo||parsed?.data;if(typeof encoded!=='string')throw new Error('Resposta do Banco Inter sem o conteúdo do PDF.');const pdf=Buffer.from(encoded.replace(/^data:application\/pdf;base64,/,''),'base64');if(pdf.subarray(0,4).toString()!=='%PDF')throw new Error('O arquivo devolvido pelo Banco Inter não é um PDF válido.');resolve(pdf)}catch(error){reject(error)}})});
    request.on('error',(error:any)=>reject(new Error(error?.message||error?.errors?.[0]?.message||'Falha ao baixar o PDF no Banco Inter.')));request.end();
  });
};
