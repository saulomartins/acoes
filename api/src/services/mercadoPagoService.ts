import { config } from '../config';

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

export type PixChargeInput = {
  amountCents: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  payerFirstName?: string;
  payerLastName?: string;
  // CPF (pessoa física, 11 dígitos) ou CNPJ (pessoa jurídica — síndico
  // profissional/administradora, 14 dígitos) do síndico/subsíndico pagador.
  // O mesmo campo `users.cpf` já guarda os dois formatos hoje (ver
  // maskDocument em userRoutes.ts) — o tipo é detectado pela quantidade de
  // dígitos, nunca fixo em CPF.
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

// Valida o dígito verificador de verdade, não só a quantidade de dígitos —
// confirmado testando contra a API real: um número do tamanho certo (11 ou
// 14 dígitos) mas com dígito verificador inválido (dado de teste
// fabricado, erro de digitação etc.) também faz o Mercado Pago recusar o
// pagamento com "processing_error". Repetidos (000..., 111...) nunca são
// válidos e nem passam pelo cálculo.
const isValidCpf = (digits: string): boolean => {
  if (digits.length !== 11 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
};

const isValidCnpj = (digits: string): boolean => {
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += Number(digits[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
};

// CPF tem 11 dígitos, CNPJ tem 14 — só manda identification quando o
// documento cadastrado é um CPF ou CNPJ de verdade (dígito verificador
// bate); qualquer outra coisa é omitida em vez de travar a cobrança.
const identificationFor = (document?: string | null): { type: 'CPF' | 'CNPJ'; number: string } | null => {
  const digits = (document || '').replace(/\D/g, '');
  if (isValidCpf(digits)) return { type: 'CPF', number: digits };
  if (isValidCnpj(digits)) return { type: 'CNPJ', number: digits };
  return null;
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

  const amountReais = (Math.round(input.amountCents) / 100).toFixed(2);
  const identification = identificationFor(input.payerDocument);
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
      // Detecta CPF (11 dígitos) vs CNPJ (14) pela quantidade de dígitos —
      // muitos síndicos são profissionais/administradoras com CNPJ, não
      // pessoa física. Confirmado testando contra a API real: mandar um
      // número de 14 dígitos rotulado como `type: 'CPF'` faz o Mercado
      // Pago recusar o pagamento inteiro com "processing_error", sem
      // detalhar o motivo — por isso o tipo tem que bater com o tamanho.
      // Documento com outro tamanho (dado sujo) não é enviado, pra não
      // travar a cobrança por causa disso.
      ...(identification ? { identification } : {}),
    },
  };
  // Ao contrário da API de Pagamentos clássica, a API de Orders NÃO aceita
  // notification_url no corpo da requisição (erro 400 "additionalProperties
  // não permitida" — confirmado testando contra a API real). O webhook pro
  // tópico 'order' tem que ser cadastrado no painel do Mercado Pago
  // (Sua aplicação > Webhooks), apontando pra
  // `${API_PUBLIC_URL}/webhooks/mercadopago/${MERCADOPAGO_WEBHOOK_SECRET}`.

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
      // Evita cobrança duplicada se a chamada for repetida (ex.: retry de
      // rede) — mesma referência da fatura, sempre a mesma idempotency key.
      'X-Idempotency-Key': input.idempotencyKey || input.externalReference,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as any;
  if (!response.ok) throw new Error(`Mercado Pago returned ${response.status}: ${JSON.stringify(data)}`);

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
