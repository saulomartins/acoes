import { beforeEach, describe, expect, it, vi } from 'vitest';

// Banco falso em memória: só entende as consultas do fluxo de confirmação de
// pagamento/recibo e da renovação do Pix. Cada consulta cede a vez (setImmediate) antes de rodar,
// então chamadas concorrentes se intercalam de verdade — e cada UPDATE é
// aplicado de uma vez só, como uma linha travada no Postgres. SQL não
// reconhecido lança erro, pra o teste quebrar alto se o fluxo mudar.
type Invoice = {
  id: string;
  condominium_id: string;
  reference_month: string;
  amount_cents: number;
  status: 'pending' | 'sent' | 'paid' | 'canceled' | 'refunded';
  pix_payment_id: string | null;
  paid_at: Date | null;
  payment_method: string | null;
  manual_note: string | null;
  confirmed_by: string | null;
  receipt_sent_at: Date | null;
  paid_after_canceled_at: Date | null;
  plan_id: string;
  active_users: number;
  due_date: string | null;
  sent_at: Date | null;
  pix_copy_paste: string | null;
  pix_expires_at: Date | null;
};

const db = vi.hoisted(() => ({
  invoices: new Map<string, any>(),
  managers: [] as { id: string; full_name: string | null; username: string; email: string | null; cpf: string | null }[],
}));

vi.mock('../db', () => {
  const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const pick = (row: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, row[k]]));
  const run = (sql: string, params: any[] = []) => {
    const s = norm(sql);
    const inv = db.invoices.get(params[0]);
    if (s === 'select status from platform_invoices where id=$1') return inv ? [{ status: inv.status }] : [];
    if (s === 'select id from platform_invoices where pix_payment_id=$1') {
      return [...db.invoices.values()].filter(i => i.pix_payment_id === params[0]).map(i => ({ id: i.id }));
    }
    if (s.startsWith('update platform_invoices set paid_after_canceled_at=')) {
      if (inv) inv.paid_after_canceled_at ??= new Date();
      return [];
    }
    if (s.startsWith("update platform_invoices set status='paid'")) {
      if (!inv) return [];
      inv.status = 'paid';
      inv.paid_at ??= new Date();
      inv.payment_method ??= params[1];
      inv.manual_note = params[2] ?? inv.manual_note;
      inv.confirmed_by = params[3] ?? inv.confirmed_by;
      return [pick(inv, ['id', 'condominium_id', 'reference_month', 'amount_cents'])];
    }
    if (s === 'update platform_invoices set receipt_sent_at=now() where id=$1 and receipt_sent_at is null returning id') {
      if (!inv || inv.receipt_sent_at) return [];
      inv.receipt_sent_at = new Date();
      return [{ id: inv.id }];
    }
    if (s === 'update platform_invoices set receipt_sent_at=now() where id=$1') {
      if (inv) inv.receipt_sent_at = new Date();
      return [];
    }
    if (s.startsWith('select id, condominium_id, reference_month, amount_cents from platform_invoices where id=$1 and status=')) {
      return inv?.status === 'paid' ? [pick(inv, ['id', 'condominium_id', 'reference_month', 'amount_cents'])] : [];
    }
    if (s.startsWith('select pix_payment_id from platform_invoices')) {
      // Mesmo filtro da reconciliação: Pix criado, em aberto (ou cancelada sem alerta ainda).
      return [...db.invoices.values()]
        .filter(i => i.pix_payment_id && (params[0] === null || i.condominium_id === params[0]))
        .filter(i => i.status === 'pending' || i.status === 'sent' || (i.status === 'canceled' && !i.paid_after_canceled_at))
        .map(i => ({ pix_payment_id: i.pix_payment_id }));
    }
    if (s.startsWith('select id, pix_payment_id from platform_invoices')) {
      // Mesmo filtro da renovação: em aberto, com Pix, vencido há mais de 1 hora.
      const limit = Date.now() - 60 * 60 * 1000;
      return [...db.invoices.values()]
        .filter(i => (i.status === 'pending' || i.status === 'sent') && i.pix_payment_id && i.pix_expires_at && i.pix_expires_at.getTime() < limit)
        .map(i => ({ id: i.id, pix_payment_id: i.pix_payment_id }));
    }
    if (s.startsWith('select id, condominium_id, plan_id, reference_month, active_users, amount_cents, status')) {
      return inv ? [pick(inv, ['id', 'condominium_id', 'plan_id', 'reference_month', 'active_users', 'amount_cents', 'status', 'due_date'])] : [];
    }
    if (s.startsWith('update platform_invoices set pix_payment_id=$2')) {
      if (inv) Object.assign(inv, { pix_payment_id: params[1], pix_copy_paste: params[2], pix_expires_at: params[4] ? new Date(params[4]) : null });
      return [];
    }
    if (s.startsWith("update platform_invoices set status='sent', sent_at=coalesce(sent_at, now())")) {
      if (inv) { inv.status = 'sent'; inv.sent_at ??= new Date(); }
      return [];
    }
    if (s.startsWith("select i.id, to_char(i.reference_month,'YYYY-MM-DD') as reference_month, i.amount_cents, i.active_users, p.name as plan_name, i.paid_at")) {
      // Dados do recibo em PDF (getPlatformInvoiceReceipt): só fatura paga do mesmo condomínio.
      return inv && inv.condominium_id === params[1] && inv.status === 'paid'
        ? [{ ...pick(inv, ['id', 'reference_month', 'amount_cents', 'active_users', 'paid_at', 'payment_method']), plan_name: 'Essencial', condominium_name: 'Residencial Teste' }]
        : [];
    }
    if (s === 'select * from platform_plans where id=$1') {
      return [{ id: params[0], name: 'Essencial', plan_type: 'included_overage', included_quantity: 40, base_price_cents: 9900, overage_price_cents: 500, minimum_price_cents: 0, price_per_active_user_cents: null, active_user_metric: 'registered' }];
    }
    if (s.startsWith('select * from platform_plan_tiers')) return [];
    if (s === 'select name from condominiums where id=$1') return [{ name: 'Residencial Teste' }];
    if (s.startsWith('select full_name, username, email from users')) return db.managers;
    if (s.startsWith('select id, full_name, email, cpf from users')) return db.managers;
    throw new Error(`fake db: SQL não reconhecido: ${s}`);
  };
  return {
    query: async (sql: string, params?: any[]) => {
      await new Promise(resolve => setImmediate(resolve));
      return { rows: run(sql, params) };
    },
  };
});

vi.mock('./emailService', () => ({
  sendPlatformInvoiceReceiptEmail: vi.fn(async () => undefined),
  sendPlatformInvoiceEmail: vi.fn(),
  sendPlatformInvoiceReminderEmail: vi.fn(),
  sendPlatformInvoiceCanceledEmail: vi.fn(),
}));

vi.mock('./notificationService', () => ({ notifyUsers: vi.fn(), sendPushNotification: vi.fn() }));

vi.mock('./platformReceiptDocument', () => ({ buildPlatformReceiptPdf: vi.fn(async () => Buffer.from('%PDF-recibo')) }));

vi.mock('./mercadoPagoService', () => ({
  isMercadoPagoConfigured: vi.fn(() => true),
  getOrder: vi.fn(),
  createPixCharge: vi.fn(),
  cancelOrder: vi.fn(),
}));

import { sendPlatformInvoiceEmail, sendPlatformInvoiceReceiptEmail } from './emailService';
import { cancelOrder, createPixCharge, getOrder, isMercadoPagoConfigured } from './mercadoPagoService';
import { buildPlatformReceiptPdf } from './platformReceiptDocument';
import {
  reconcilePlatformInvoices,
  renewExpiredPlatformInvoicePix,
  resendPlatformInvoiceReceipt,
  settlePlatformInvoiceById,
  settlePlatformInvoicePayment,
} from './platformInvoiceService';

const receiptEmail = vi.mocked(sendPlatformInvoiceReceiptEmail);
const buildPdfMock = vi.mocked(buildPlatformReceiptPdf);
const invoiceEmail = vi.mocked(sendPlatformInvoiceEmail);
const getOrderMock = vi.mocked(getOrder);
const cancelOrderMock = vi.mocked(cancelOrder);
const createPixChargeMock = vi.mocked(createPixCharge);

const addInvoice = (overrides: Partial<Invoice> = {}): Invoice => {
  const invoice: Invoice = {
    id: 'inv-1',
    condominium_id: 'condo-1',
    reference_month: '2026-09-01',
    amount_cents: 19900,
    status: 'sent',
    pix_payment_id: 'ORD-1',
    paid_at: null,
    payment_method: null,
    manual_note: null,
    confirmed_by: null,
    receipt_sent_at: null,
    paid_after_canceled_at: null,
    plan_id: 'plan-1',
    active_users: 45,
    due_date: '2026-09-11',
    sent_at: new Date('2026-09-01T12:00:00Z'),
    pix_copy_paste: 'PIX-ANTIGO',
    pix_expires_at: new Date(Date.now() + 20 * 86400000),
    ...overrides,
  };
  db.invoices.set(invoice.id, invoice);
  return invoice;
};

beforeEach(() => {
  db.invoices.clear();
  db.managers = [
    { id: 'u-ana', full_name: 'Ana Síndica', username: 'ana', email: 'ana@example.com', cpf: '52998224725' },
    { id: 'u-bruno', full_name: null, username: 'bruno', email: 'bruno@example.com', cpf: null },
    { id: 'u-carla', full_name: 'Sem Email', username: 'carla', email: null, cpf: null },
  ];
  vi.clearAllMocks();
  vi.mocked(isMercadoPagoConfigured).mockReturnValue(true);
  getOrderMock.mockImplementation(async (orderId: string) => ({ id: orderId, status: 'processed', statusDetail: 'accredited', externalReference: null, paid: true }));
  createPixChargeMock.mockResolvedValue({ id: 'ORD-NOVA', status: 'action_required', copyPaste: 'PIX-NOVO', qrCodeBase64: 'b64', ticketUrl: null, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
  cancelOrderMock.mockResolvedValue(undefined);
});

describe('settlePlatformInvoiceById', () => {
  it('marca a fatura como paga e manda o recibo pra cada gestor com e-mail', async () => {
    const invoice = addInvoice();
    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(true);

    expect(invoice.status).toBe('paid');
    expect(invoice.paid_at).toBeInstanceOf(Date);
    expect(invoice.payment_method).toBe('pix_mercadopago');
    expect(invoice.receipt_sent_at).toBeInstanceOf(Date);
    expect(receiptEmail).toHaveBeenCalledTimes(2);
    const pdf = { filename: 'recibo-lar-em-dia-2026-09.pdf', content: Buffer.from('%PDF-recibo'), contentType: 'application/pdf' };
    expect(receiptEmail).toHaveBeenCalledWith('ana@example.com', 'Ana Síndica', 'Residencial Teste', new Date('2026-09-01'), 19900, pdf);
    expect(receiptEmail).toHaveBeenCalledWith('bruno@example.com', 'bruno', 'Residencial Teste', new Date('2026-09-01'), 19900, pdf);
  });

  it('o recibo em PDF vai anexo, gerado uma vez só com os dados da fatura paga', async () => {
    addInvoice({ active_users: 42, amount_cents: 13400 });
    await settlePlatformInvoiceById('inv-1', { method: 'manual', note: 'transferência' });

    expect(buildPdfMock).toHaveBeenCalledTimes(1); // um PDF, mesmo com 2 gestores
    expect(buildPdfMock.mock.calls[0][0]).toMatchObject({
      invoiceId: 'inv-1', condominiumName: 'Residencial Teste', referenceMonth: '2026-09-01',
      amountCents: 13400, activeUsers: 42, planName: 'Essencial', paymentMethod: 'manual',
    });
    expect(buildPdfMock.mock.calls[0][0].paidAt).toBeInstanceOf(Date);
  });

  it('falha ao gerar o PDF não impede o recibo: o e-mail sai sem anexo', async () => {
    addInvoice();
    buildPdfMock.mockRejectedValueOnce(new Error('pdfkit quebrou'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(true);
    expect(receiptEmail).toHaveBeenCalledTimes(2);
    for (const call of receiptEmail.mock.calls) expect(call[5]).toBeNull();
    warn.mockRestore();
  });

  it('reenvio manual do recibo também leva o PDF', async () => {
    addInvoice();
    await settlePlatformInvoiceById('inv-1');
    receiptEmail.mockClear();
    await resendPlatformInvoiceReceipt('inv-1');
    expect(receiptEmail.mock.calls[0][5]).toMatchObject({ filename: 'recibo-lar-em-dia-2026-09.pdf', contentType: 'application/pdf' });
  });

  it('confirmar de novo a mesma fatura não reenvia o recibo nem mexe na data de pagamento', async () => {
    const invoice = addInvoice();
    await settlePlatformInvoiceById('inv-1');
    const firstPaidAt = invoice.paid_at;
    const firstReceiptAt = invoice.receipt_sent_at;

    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(true);
    await settlePlatformInvoiceById('inv-1');

    expect(receiptEmail).toHaveBeenCalledTimes(2); // só os 2 da primeira vez
    expect(invoice.paid_at).toBe(firstPaidAt);
    expect(invoice.receipt_sent_at).toBe(firstReceiptAt);
  });

  it('webhook, reconciliação e confirmação manual ao mesmo tempo: um único recibo', async () => {
    addInvoice();
    const results = await Promise.all([
      settlePlatformInvoicePayment('ORD-1'), // webhook
      reconcilePlatformInvoices(), // job de reconciliação
      settlePlatformInvoiceById('inv-1', { method: 'manual', note: 'pagou no balcão', confirmedBy: 'admin-1' }),
      settlePlatformInvoicePayment('ORD-1'), // webhook repetido pelo MP
    ]);

    expect(results[0]).toBe(true);
    expect(results[2]).toBe(true);
    expect(receiptEmail).toHaveBeenCalledTimes(2); // 2 gestores com e-mail, uma vez cada
    expect(new Set(receiptEmail.mock.calls.map(call => call[0]))).toEqual(new Set(['ana@example.com', 'bruno@example.com']));
  });

  it('confirmação manual registra método, nota e quem confirmou; webhook depois não sobrescreve', async () => {
    const invoice = addInvoice();
    await settlePlatformInvoiceById('inv-1', { method: 'manual', note: 'transferência', confirmedBy: 'admin-1' });
    await settlePlatformInvoicePayment('ORD-1');

    expect(invoice.payment_method).toBe('manual');
    expect(invoice.manual_note).toBe('transferência');
    expect(invoice.confirmed_by).toBe('admin-1');
    expect(receiptEmail).toHaveBeenCalledTimes(2);
  });

  it('pagamento em fatura cancelada: não reabre, não manda recibo, levanta alerta pro admin', async () => {
    const invoice = addInvoice({ status: 'canceled' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(false);

    expect(invoice.status).toBe('canceled');
    expect(invoice.paid_after_canceled_at).toBeInstanceOf(Date);
    expect(receiptEmail).not.toHaveBeenCalled();

    const firstAlert = invoice.paid_after_canceled_at;
    await settlePlatformInvoiceById('inv-1');
    expect(invoice.paid_after_canceled_at).toBe(firstAlert);
    warn.mockRestore();
  });

  it('fatura estornada não volta a ficar paga nem gera recibo', async () => {
    const invoice = addInvoice({ status: 'refunded' });
    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(false);
    expect(invoice.status).toBe('refunded');
    expect(receiptEmail).not.toHaveBeenCalled();
  });

  it('fatura inexistente devolve false', async () => {
    await expect(settlePlatformInvoiceById('nao-existe')).resolves.toBe(false);
    await expect(settlePlatformInvoicePayment('ORD-desconhecida')).resolves.toBe(false);
    expect(receiptEmail).not.toHaveBeenCalled();
  });

  it('falha no e-mail de um gestor não impede o recibo dos outros', async () => {
    addInvoice();
    receiptEmail.mockRejectedValueOnce(new Error('SMTP fora'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(settlePlatformInvoiceById('inv-1')).resolves.toBe(true);
    expect(receiptEmail).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('reconcilePlatformInvoices', () => {
  it('confirma só as orders que o Mercado Pago dá como pagas', async () => {
    const paid = addInvoice({ id: 'inv-1', pix_payment_id: 'ORD-1' });
    const waiting = addInvoice({ id: 'inv-2', pix_payment_id: 'ORD-2' });
    getOrderMock.mockImplementation(async (orderId: string) => ({
      id: orderId, status: orderId === 'ORD-1' ? 'processed' : 'action_required',
      statusDetail: orderId === 'ORD-1' ? 'accredited' : 'waiting_transfer', externalReference: null, paid: orderId === 'ORD-1',
    }));

    await expect(reconcilePlatformInvoices()).resolves.toEqual({ checked: 2, paid: 1 });
    expect(paid.status).toBe('paid');
    expect(waiting.status).toBe('sent');
    expect(receiptEmail).toHaveBeenCalledTimes(2);
  });

  it('rodar a reconciliação de novo não reenvia recibo', async () => {
    addInvoice();
    await reconcilePlatformInvoices();
    await expect(reconcilePlatformInvoices()).resolves.toEqual({ checked: 0, paid: 0 });
    expect(receiptEmail).toHaveBeenCalledTimes(2);
  });

  it('erro ao consultar uma order não impede as outras', async () => {
    addInvoice({ id: 'inv-1', pix_payment_id: 'ORD-1' });
    const ok = addInvoice({ id: 'inv-2', pix_payment_id: 'ORD-2' });
    getOrderMock.mockRejectedValueOnce(new Error('timeout'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(reconcilePlatformInvoices()).resolves.toEqual({ checked: 2, paid: 1 });
    expect(ok.status).toBe('paid');
    warn.mockRestore();
  });

  it('Pix pago depois do cancelamento: alerta uma vez e não conta como pago', async () => {
    const invoice = addInvoice({ status: 'canceled' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(reconcilePlatformInvoices()).resolves.toEqual({ checked: 1, paid: 0 });
    expect(invoice.status).toBe('canceled');
    expect(invoice.paid_after_canceled_at).toBeInstanceOf(Date);
    expect(receiptEmail).not.toHaveBeenCalled();
    await expect(reconcilePlatformInvoices()).resolves.toEqual({ checked: 0, paid: 0 });
    warn.mockRestore();
  });
});

describe('resendPlatformInvoiceReceipt', () => {
  it('reenvio manual manda o recibo de novo (intencional) só pra fatura paga', async () => {
    addInvoice();
    await settlePlatformInvoiceById('inv-1');
    await expect(resendPlatformInvoiceReceipt('inv-1')).resolves.toBe(true);
    expect(receiptEmail).toHaveBeenCalledTimes(4);
  });

  it('recusa reenviar recibo de fatura não paga', async () => {
    addInvoice({ status: 'sent' });
    await expect(resendPlatformInvoiceReceipt('inv-1')).resolves.toBe(false);
    expect(receiptEmail).not.toHaveBeenCalled();
  });
});

describe('renewExpiredPlatformInvoicePix', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000);
  const notPaid = async (orderId: string) => ({ id: orderId, status: 'expired', statusDetail: 'expired', externalReference: null, paid: false });
  const addExpired = (overrides: Partial<Invoice> = {}) => addInvoice({ pix_payment_id: 'ORD-ANTIGA', pix_expires_at: hoursAgo(2), ...overrides });
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('Pix expirado e não pago: cancela o antigo, gera outro e reenvia a fatura avisando que é código novo', async () => {
    getOrderMock.mockImplementation(notPaid);
    const invoice = addExpired();

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 1, paid: 0, failed: 0 });

    expect(cancelOrderMock).toHaveBeenCalledWith('ORD-ANTIGA');
    expect(createPixChargeMock).toHaveBeenCalledTimes(1);
    expect(createPixChargeMock.mock.calls[0][0]).toMatchObject({
      amountCents: 19900,
      externalReference: 'inv-1',
      payerEmail: 'ana@example.com',
      idempotencyKey: expect.stringMatching(/^inv-1-renova-ORD-ANTIGA-\d{4}-\d{2}-\d{2}T\d{2}$/),
    });
    expect(invoice.pix_payment_id).toBe('ORD-NOVA');
    expect(invoice.pix_copy_paste).toBe('PIX-NOVO');
    expect(invoice.pix_expires_at!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(invoice.status).toBe('sent');

    expect(invoiceEmail).toHaveBeenCalledTimes(2); // os 2 gestores com e-mail
    for (const call of invoiceEmail.mock.calls) {
      expect(call[8]).toMatchObject({ copyPaste: 'PIX-NOVO' });
      expect(call[10]).toBe(true); // e-mail no formato "novo código Pix"
    }
  });

  it('Pix antigo foi pago antes de expirar (webhook perdido): confirma o pagamento em vez de renovar', async () => {
    const invoice = addExpired(); // getOrder padrão: pago

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 0, paid: 1, failed: 0 });
    expect(invoice.status).toBe('paid');
    expect(receiptEmail).toHaveBeenCalledTimes(2);
    expect(createPixChargeMock).not.toHaveBeenCalled();
    expect(cancelOrderMock).not.toHaveBeenCalled();
  });

  it('consulta ao Mercado Pago falha: não renova às cegas, tenta na próxima rodada', async () => {
    getOrderMock.mockRejectedValue(new Error('timeout'));
    const invoice = addExpired();
    const warn = quiet();

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 0, paid: 0, failed: 1 });
    expect(createPixChargeMock).not.toHaveBeenCalled();
    expect(invoice.pix_payment_id).toBe('ORD-ANTIGA');
    warn.mockRestore();
  });

  it('Mercado Pago recusa o Pix novo: conta como falha, não manda e-mail, a fatura continua pra próxima rodada', async () => {
    getOrderMock.mockImplementation(notPaid);
    createPixChargeMock.mockRejectedValue(new Error('Mercado Pago returned 500'));
    const invoice = addExpired();
    const warn = quiet();

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 0, paid: 0, failed: 1 });
    expect(invoice.pix_payment_id).toBe('ORD-ANTIGA');
    expect(invoiceEmail).not.toHaveBeenCalled();

    createPixChargeMock.mockResolvedValue({ id: 'ORD-NOVA', status: 'action_required', copyPaste: 'PIX-NOVO', qrCodeBase64: null, ticketUrl: null, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 1, paid: 0, failed: 0 });
    expect(invoice.pix_payment_id).toBe('ORD-NOVA');
    warn.mockRestore();
  });

  it('cancelamento do Pix antigo recusado (já expirado lá) não impede a renovação', async () => {
    getOrderMock.mockImplementation(notPaid);
    cancelOrderMock.mockRejectedValue(new Error('Mercado Pago returned 409'));
    addExpired();

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 1, paid: 0, failed: 0 });
  });

  it('só mexe em fatura em aberto com Pix vencido há mais de 1 hora', async () => {
    getOrderMock.mockImplementation(notPaid);
    addExpired({ id: 'elegivel', pix_payment_id: 'ORD-A' });
    addExpired({ id: 'dentro-da-margem', pix_payment_id: 'ORD-B', pix_expires_at: new Date(Date.now() - 30 * 60000) });
    addExpired({ id: 'ainda-valido', pix_payment_id: 'ORD-C', pix_expires_at: new Date(Date.now() + 86400000) });
    addExpired({ id: 'paga', pix_payment_id: 'ORD-D', status: 'paid' });
    addExpired({ id: 'cancelada', pix_payment_id: 'ORD-E', status: 'canceled' });
    addExpired({ id: 'sem-pix', pix_payment_id: null, pix_copy_paste: null });

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 1, paid: 0, failed: 0 });
    expect(getOrderMock).toHaveBeenCalledTimes(1);
    expect(getOrderMock).toHaveBeenCalledWith('ORD-A');
  });

  it('duas rodadas ao mesmo tempo usam a mesma idempotency key (o Mercado Pago devolve a mesma cobrança)', async () => {
    getOrderMock.mockImplementation(notPaid);
    addExpired();

    await Promise.all([renewExpiredPlatformInvoicePix(), renewExpiredPlatformInvoicePix()]);
    const keys = createPixChargeMock.mock.calls.map(call => call[0].idempotencyKey);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(1);
  });

  it('sem Mercado Pago configurado não faz nada', async () => {
    vi.mocked(isMercadoPagoConfigured).mockReturnValue(false);
    addExpired();

    await expect(renewExpiredPlatformInvoicePix()).resolves.toEqual({ renewed: 0, paid: 0, failed: 0 });
    expect(getOrderMock).not.toHaveBeenCalled();
  });
});
