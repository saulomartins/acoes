import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { identifyDocument, isAlphanumericCnpj } from './documentService';

// Cobrança Pix da fatura da plataforma, direto na conta Mercado Pago do
// dono da plataforma (pessoa física) — sem split/marketplace, é um
// vendedor comum recebendo de um pagador. Bem mais simples que
// interService.ts (que usa mTLS com certificado): o Mercado Pago autentica
// só com um Access Token (Bearer), sem certificado.
//
// Usa a API de Orders (v1/orders), não a API de Pagamentos clássica
// (v1/payments) — é o modelo que o próprio painel de criação de aplicação
// do Mercado Pago oferece como padrão hoje pra "Checkout Transparente".
const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com';

export const isMercadoPagoConfigured = () => Boolean(config.mercadoPago.accessToken);

// Assinatura do webhook (formato oficial — mesmo do webhook.ValidateSignature
// do SDK Go do Mercado Pago): o cabeçalho x-signature traz "ts=...,v1=...";
// v1 é o HMAC-SHA256 em hex, com a "assinatura secreta" da aplicação (painel
// Suas integrações > Webhooks) como chave, do texto
//   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// data.id vem da query string e entra em minúsculas; um campo ausente sai do
// texto junto com o rótulo. Comparação em tempo constante. Sem checagem de
// idade do ts (o SDK também não faz por padrão): quem recebe o aviso sempre
// reconsulta a order no Mercado Pago, então repetir um aviso antigo não
// confirma nada que não esteja pago de verdade.
export const verifyWebhookSignature = (input: { xSignature?: string | null; xRequestId?: string | null; dataId?: string | null; secret: string }): boolean => {
  if (!input.secret || !input.xSignature) return false;
  const parts = new Map(
    input.xSignature.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim(), rest.join('=').trim()] as const;
    }),
  );
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;

  const manifest = `${input.dataId ? `id:${input.dataId.toLowerCase()};` : ''}${input.xRequestId ? `request-id:${input.xRequestId};` : ''}ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest();
  const received = Buffer.from(v1, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export type PixChargeInput = {
  amountCents: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  payerFirstName?: string;
  payerLastName?: string;
  // CPF (pessoa física, 11 dígitos) ou CNPJ (pessoa jurídica — síndico
  // profissional/administradora, 14 posições, numérico ou alfanumérico) do
  // síndico/subsíndico pagador. O mesmo campo `users.cpf` guarda os dois
  // formatos (ver documentService.ts) — o tipo é detectado pelo formato,
  // nunca fixo em CPF.
  payerDocument?: string | null;
  // Padrão: externalReference. Trocar ao gerar um NOVO Pix pra mesma fatura
  // (senão o Mercado Pago devolve a mesma order da primeira tentativa).
  idempotencyKey?: string;
  // Validade do Pix em dias (ISO 8601: P30D). Sem isso vale o padrão do
  // Mercado Pago, curto demais pra uma fatura com vencimento em dias.
  expiresInDays?: number;
};

export type PixCharge = {
  id: string;
  status: string;
  copyPaste: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
};


// A resposta de uma order traz o pagamento dentro de transactions.payments[0]
// — esse helper isola o "achar o primeiro pagamento" tanto na resposta de
// criação quanto na de consulta (GET), já que as duas têm o mesmo formato.
const firstPayment = (order: any) => order?.transactions?.payments?.[0] || null;

// Cria uma order com um único pagamento Pix pro valor da fatura.
// total_amount/amount vão em reais (string), não centavos — é o formato que
// a API de Orders espera. notification_url usa API_PUBLIC_URL + o segredo
// do webhook, mesmo truque de "segredo na própria URL" já usado em
// interWebhookRoutes.ts.
export const createPixCharge = async (input: PixChargeInput): Promise<PixCharge> => {
  if (!isMercadoPagoConfigured()) throw new Error('Mercado Pago is not configured (MERCADOPAGO_ACCESS_TOKEN missing)');

  const identification = identifyDocument(input.payerDocument);
  const idempotencyKey = input.idempotencyKey || input.externalReference;
  if (!identification || !isAlphanumericCnpj(identification.number)) {
    return toPixCharge(await postOrder(input, identification, idempotencyKey), input);
  }

  // CNPJ alfanumérico (emitido desde julho de 2026): não há confirmação
  // pública de que o Mercado Pago já aceita — e documento que ele não aceita
  // derruba a cobrança inteira. Tenta com o CNPJ; se falhar ou vier sem Pix,
  // gera outra order sem identification (outra idempotency key, senão o MP
  // devolve a order com falha), que é como a cobrança já sai hoje pra
  // documento omitido.
  try {
    const data = await postOrder(input, identification, idempotencyKey);
    if (firstPayment(data)?.payment_method?.qr_code) return toPixCharge(data, input);
    console.warn('mercadopago order with alphanumeric CNPJ came without pix, retrying without identification', JSON.stringify(data));
  } catch (error) {
    console.warn('mercadopago order with alphanumeric CNPJ failed, retrying without identification', error);
  }
  return toPixCharge(await postOrder(input, null, `${idempotencyKey}-sem-documento`), input);
};

const postOrder = async (input: PixChargeInput, identification: ReturnType<typeof identifyDocument>, idempotencyKey: string): Promise<any> => {
  const amountReais = (Math.round(input.amountCents) / 100).toFixed(2);
  const body: Record<string, unknown> = {
    type: 'online',
    total_amount: amountReais,
    external_reference: input.externalReference,
    description: input.description,
    processing_mode: 'automatic',
    transactions: {
      payments: [
        { amount: amountReais, payment_method: { id: 'pix', type: 'bank_transfer' }, ...(input.expiresInDays ? { expiration_time: `P${Math.round(input.expiresInDays)}D` } : {}) },
      ],
    },
    payer: {
      email: input.payerEmail,
      ...(input.payerFirstName ? { first_name: input.payerFirstName } : {}),
      ...(input.payerLastName ? { last_name: input.payerLastName } : {}),
      // CPF vs CNPJ detectado pelo formato (documentService.ts) — muitos
      // síndicos são profissionais/administradoras com CNPJ, não pessoa
      // física. Confirmado testando contra a API real: mandar um CNPJ
      // rotulado como `type: 'CPF'` faz o Mercado Pago recusar o pagamento
      // inteiro com "processing_error", sem detalhar o motivo — por isso o
      // tipo tem que bater. Documento inválido (dado sujo) não é enviado,
      // pra não travar a cobrança por causa disso.
      ...(identification ? { identification } : {}),
    },
  };
  // Ao contrário da API de Pagamentos clássica, a API de Orders NÃO aceita
  // notification_url no corpo da requisição (erro 400 "additionalProperties
  // não permitida" — confirmado testando contra a API real). O webhook pro
  // tópico 'order' tem que ser cadastrado no painel do Mercado Pago
  // (Sua aplicação > Webhooks), apontando pra
  // `${API_PUBLIC_URL}/webhooks/mercadopago` — a autenticidade vem da
  // assinatura x-signature (verifyWebhookSignature), não da URL.

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
      // Evita cobrança duplicada se a chamada for repetida (ex.: retry de
      // rede) — mesma referência da fatura, sempre a mesma idempotency key.
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(`Mercado Pago returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
};

const toPixCharge = (data: any, input: PixChargeInput): PixCharge => {
  const payment = firstPayment(data);
  const pixMethod = payment?.payment_method;
  if (!pixMethod?.qr_code) {
    // A order foi criada, mas sem o Pix vindo junto — melhor avisar alto no
    // log (formato de resposta pode ter mudado) do que silenciar e mandar
    // um e-mail de fatura sem jeito nenhum de pagar.
    console.warn('mercadopago order created without pix qr_code', JSON.stringify(data));
  }
  return {
    id: String(data.id),
    status: data.status,
    copyPaste: pixMethod?.qr_code || null,
    qrCodeBase64: pixMethod?.qr_code_base64 || null,
    ticketUrl: pixMethod?.ticket_url || null,
    // A resposta não devolve a data — calculamos a partir da validade pedida.
    expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString() : null,
  };
};

// Reconsulta o status oficial de uma order na API do Mercado Pago — usado
// pelo webhook, que nunca deve confiar no corpo da notificação recebida
// (ela só avisa "a order X mudou", o valor de verdade vem daqui).
// status='processed' + status_detail='accredited' é o par que confirma
// pagamento recebido — só 'processed' sozinho também cobre reembolso
// parcial (status_detail='partially_refunded'), por isso os dois juntos.
export const getOrder = async (orderId: string): Promise<{ id: string; status: string; statusDetail: string | null; externalReference: string | null; paid: boolean }> => {
  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${config.mercadoPago.accessToken}` },
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(`Mercado Pago returned ${response.status}: ${JSON.stringify(data)}`);
  return {
    id: String(data.id),
    status: data.status,
    statusDetail: data.status_detail || null,
    externalReference: data.external_reference || null,
    paid: data.status === 'processed' && data.status_detail === 'accredited',
  };
};

// Cancela a order (e com ela o Pix) no Mercado Pago — confirmado no sandbox:
// POST /v1/orders/:id/cancel devolve status 'canceled'. Só funciona enquanto
// a order não foi paga; depois de paga o certo é reembolsar.
export const cancelOrder = async (orderId: string): Promise<void> => {
  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `cancel-${orderId}`,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(`Mercado Pago returned ${response.status}: ${JSON.stringify(data)}`);
  }
};
