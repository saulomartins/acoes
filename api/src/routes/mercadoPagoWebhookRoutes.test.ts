import { createHmac } from 'crypto';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/mercadoPagoService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/mercadoPagoService')>();
  return { ...original, getOrder: vi.fn() };
});
vi.mock('../services/platformInvoiceService', () => ({ settlePlatformInvoicePayment: vi.fn(async () => true) }));

import { config } from '../config';
import { getOrder } from '../services/mercadoPagoService';
import { settlePlatformInvoicePayment } from '../services/platformInvoiceService';
import webhookRoutes from './mercadoPagoWebhookRoutes';

const secret = 'assinatura-secreta-de-teste';
const getOrderMock = vi.mocked(getOrder);
const settleMock = vi.mocked(settlePlatformInvoicePayment);
let server: ReturnType<ReturnType<typeof express>['listen']>;
let baseUrl = '';

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/webhooks/mercadopago', webhookRoutes);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/mercadopago`;
});
afterAll(() => server.close());

beforeEach(() => {
  config.mercadoPago.webhookSignatureSecret = secret;
  getOrderMock.mockReset();
  settleMock.mockClear();
  getOrderMock.mockResolvedValue({ id: 'ORD123', status: 'processed', statusDetail: 'accredited', externalReference: 'inv-1', paid: true });
});

// Notificação como o Mercado Pago manda: data.id e type na query, x-signature e x-request-id nos cabeçalhos.
const notify = (opts: { path?: string; dataId?: string; signedId?: string; requestId?: string; key?: string; body?: unknown } = {}) => {
  const dataId = opts.dataId ?? 'ORD123';
  const requestId = opts.requestId ?? 'req-abc';
  const ts = '1727380800';
  const v1 = createHmac('sha256', opts.key ?? secret).update(`id:${(opts.signedId ?? dataId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return fetch(`${baseUrl}${opts.path ?? ''}?data.id=${encodeURIComponent(dataId)}&type=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: JSON.stringify(opts.body ?? { type: 'order', action: 'order.processed', data: { id: dataId } }),
  });
};

describe('POST /webhooks/mercadopago', () => {
  it('assinatura válida: reconsulta a order e confirma o pagamento', async () => {
    const res = await notify();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, updated: true });
    expect(getOrderMock).toHaveBeenCalledWith('ORD123');
    expect(settleMock).toHaveBeenCalledWith('ORD123');
  });

  it('assinatura de outra order (id trocado na URL) → 401, nada é consultado', async () => {
    const res = await notify({ dataId: 'ORD999', signedId: 'ORD123' });
    expect(res.status).toBe(401);
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('assinada com outro segredo → 401', async () => {
    expect((await notify({ key: 'segredo-de-atacante' })).status).toBe(401);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('sem cabeçalho de assinatura → 401', async () => {
    const res = await fetch(`${baseUrl}?data.id=ORD123&type=order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"order"}' });
    expect(res.status).toBe(401);
  });

  it('segredo não configurado no servidor → recusa tudo (a reconciliação de 15 min segue confirmando)', async () => {
    config.mercadoPago.webhookSignatureSecret = '';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await notify()).status).toBe(401);
    warn.mockRestore();
  });

  it('endereço antigo com segredo na URL: o trecho é ignorado, vale só a assinatura', async () => {
    expect((await notify({ path: '/qualquer-coisa' })).status).toBe(200);
    expect((await notify({ path: '/qualquer-coisa', key: 'errado' })).status).toBe(401);
  });

  it('id só no corpo (não assinado) não é usado', async () => {
    const res = await fetch(`${baseUrl}?type=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature': `ts=1,v1=${createHmac('sha256', secret).update('request-id:r;ts:1;').digest('hex')}`, 'x-request-id': 'r' },
      body: JSON.stringify({ type: 'order', data: { id: 'ORD123' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('order ainda não paga: responde 200 sem confirmar nada', async () => {
    getOrderMock.mockResolvedValue({ id: 'ORD123', status: 'action_required', statusDetail: 'waiting_transfer', externalReference: 'inv-1', paid: false });
    const res = await notify();
    expect(res.status).toBe(200);
    expect(settleMock).not.toHaveBeenCalled();
  });
});
