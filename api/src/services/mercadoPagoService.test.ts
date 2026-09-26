import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { createPixCharge, verifyWebhookSignature } from './mercadoPagoService';

describe('verifyWebhookSignature (x-signature do Mercado Pago)', () => {
  const secret = 'assinatura-secreta-de-teste';
  const sign = (manifest: string, key = secret) => createHmac('sha256', key).update(manifest).digest('hex');
  const ts = '1727380800';
  const header = (v1: string) => `ts=${ts},v1=${v1}`;

  it('aceita a assinatura do texto id;request-id;ts; com o id em minúsculas', () => {
    const v1 = sign(`id:ord01jabc;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:${ts};`);
    expect(verifyWebhookSignature({ xSignature: header(v1), xRequestId: 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e', dataId: 'ORD01JABC', secret })).toBe(true);
  });

  it('tolera espaços no cabeçalho e v1 em maiúsculas', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    expect(verifyWebhookSignature({ xSignature: ` ts=${ts} , v1=${v1.toUpperCase()} `, xRequestId: 'req-1', dataId: '123', secret })).toBe(true);
  });

  it('campo ausente sai do texto junto com o rótulo', () => {
    expect(verifyWebhookSignature({ xSignature: header(sign(`request-id:req-1;ts:${ts};`)), xRequestId: 'req-1', dataId: '', secret })).toBe(true);
    expect(verifyWebhookSignature({ xSignature: header(sign(`id:123;ts:${ts};`)), xRequestId: null, dataId: '123', secret })).toBe(true);
  });

  it('recusa quando qualquer parte assinada muda', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    expect(verifyWebhookSignature({ xSignature: header(v1), xRequestId: 'req-1', dataId: '124', secret })).toBe(false); // outra order
    expect(verifyWebhookSignature({ xSignature: header(v1), xRequestId: 'req-2', dataId: '123', secret })).toBe(false);
    expect(verifyWebhookSignature({ xSignature: `ts=1727380801,v1=${v1}`, xRequestId: 'req-1', dataId: '123', secret })).toBe(false);
    expect(verifyWebhookSignature({ xSignature: header(v1), xRequestId: 'req-1', dataId: '123', secret: 'outro-segredo' })).toBe(false);
  });

  it('recusa cabeçalho ausente, incompleto ou malformado, e segredo não configurado', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    for (const xSignature of [null, '', `ts=${ts}`, `v1=${v1}`, `ts=${ts},v1=zz`, `ts=${ts},v1=${v1.slice(0, -1)}`, 'lixo']) {
      expect(verifyWebhookSignature({ xSignature, xRequestId: 'req-1', dataId: '123', secret })).toBe(false);
    }
    expect(verifyWebhookSignature({ xSignature: header(v1), xRequestId: 'req-1', dataId: '123', secret: '' })).toBe(false);
  });
});

// Validação de CPF/CNPJ em si: documentService.test.ts. Aqui só o que vai
// pro Mercado Pago.

const orderWithPix = (id: string) => new Response(JSON.stringify({
  id,
  status: 'action_required',
  transactions: { payments: [{ payment_method: { qr_code: `pix-${id}`, qr_code_base64: 'b64' } }] },
}), { status: 201 });

const orderWithoutPix = (id: string) => new Response(JSON.stringify({
  id, status: 'failed', status_detail: 'processing_error', transactions: { payments: [{ payment_method: {} }] },
}), { status: 201 });

describe('createPixCharge — documento do pagador no payload', () => {
  const originalToken = config.mercadoPago.accessToken;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config.mercadoPago.accessToken = 'test-token';
    fetchMock = vi.fn(async () => orderWithPix('ORD123'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    config.mercadoPago.accessToken = originalToken;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);
  const sentKey = (call = 0) => fetchMock.mock.calls[call][1].headers['X-Idempotency-Key'];
  const charge = (payerDocument: string | null) => createPixCharge({
    amountCents: 12345,
    description: 'Assinatura',
    externalReference: 'invoice-1',
    payerEmail: 'sindico@example.com',
    payerDocument,
  });

  it('manda CPF rotulado como CPF', async () => {
    await charge('529.982.247-25');
    expect(sentBody().payer.identification).toEqual({ type: 'CPF', number: '52998224725' });
  });

  it('manda CNPJ numérico rotulado como CNPJ (rotular como CPF faz o MP recusar com processing_error)', async () => {
    await charge('11.222.333/0001-81');
    expect(sentBody().payer.identification).toEqual({ type: 'CNPJ', number: '11222333000181' });
  });

  it('documento inválido é omitido, mas a cobrança sai mesmo assim', async () => {
    const result = await charge('111.111.111-11');
    expect(sentBody().payer).not.toHaveProperty('identification');
    expect(result.copyPaste).toBe('pix-ORD123');
  });

  it('valor vai em reais com duas casas, não em centavos', async () => {
    await charge(null);
    expect(sentBody().total_amount).toBe('123.45');
    expect(sentBody().transactions.payments[0].amount).toBe('123.45');
  });

  it('CNPJ numérico recusado pelo MP continua sendo erro (sem nova tentativa — comportamento de sempre)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"message":"bad"}', { status: 400 }));
    await expect(charge('11.222.333/0001-81')).rejects.toThrow('Mercado Pago returned 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('CNPJ alfanumérico', () => {
    it('manda o CNPJ alfanumérico rotulado como CNPJ, numa chamada só, quando o MP aceita', async () => {
      const result = await charge('12.abc.345/01de-35');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentBody().payer.identification).toEqual({ type: 'CNPJ', number: '12ABC34501DE35' });
      expect(sentKey()).toBe('invoice-1');
      expect(result.copyPaste).toBe('pix-ORD123');
    });

    it('MP recusa com erro HTTP: gera o Pix de novo sem o documento, com outra idempotency key', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('{"message":"invalid identification"}', { status: 400 }))
        .mockResolvedValueOnce(orderWithPix('ORD-SEM-DOC'));

      const result = await charge('12.ABC.345/01DE-35');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentBody(1).payer).not.toHaveProperty('identification');
      expect(sentKey(1)).toBe('invoice-1-sem-documento');
      expect(result).toMatchObject({ id: 'ORD-SEM-DOC', copyPaste: 'pix-ORD-SEM-DOC' });
    });

    it('MP cria a order mas sem Pix (processing_error): gera de novo sem o documento', async () => {
      fetchMock
        .mockResolvedValueOnce(orderWithoutPix('ORD-FALHOU'))
        .mockResolvedValueOnce(orderWithPix('ORD-SEM-DOC'));

      const result = await charge('12ABC34501DE35');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentBody(1).payer).not.toHaveProperty('identification');
      expect(result.id).toBe('ORD-SEM-DOC');
    });

    it('se a segunda tentativa também falhar, o erro sobe (mesmo tratamento de hoje: fatura sai sem Pix)', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('{}', { status: 400 }))
        .mockResolvedValueOnce(new Response('{}', { status: 500 }));
      await expect(charge('12ABC34501DE35')).rejects.toThrow('Mercado Pago returned 500');
    });

    it('usa a idempotency key informada (reemissão de Pix) como base da nova tentativa', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('{}', { status: 400 }))
        .mockResolvedValueOnce(orderWithPix('ORD-2'));
      await createPixCharge({
        amountCents: 100, description: 'x', externalReference: 'invoice-1', payerEmail: 'a@example.com',
        payerDocument: '12ABC34501DE35', idempotencyKey: 'invoice-1-1727000000',
      });
      expect(sentKey(0)).toBe('invoice-1-1727000000');
      expect(sentKey(1)).toBe('invoice-1-1727000000-sem-documento');
    });

    it('CNPJ alfanumérico com dígito verificador errado nem é enviado', async () => {
      await charge('12ABC34501DE36');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentBody().payer).not.toHaveProperty('identification');
    });
  });
});
