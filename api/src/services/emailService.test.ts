import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.hoisted(() => vi.fn(async (_options: Record<string, unknown>) => ({ messageId: 'smtp-1' })));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));

import { config } from '../config';
import { sendPlatformInvoiceReceiptEmail } from './emailService';

const pdf = { filename: 'recibo-lar-em-dia-2026-09.pdf', content: Buffer.from('%PDF-1.3 recibo'), contentType: 'application/pdf' };
const originalEmail = JSON.parse(JSON.stringify(config.email));
const send = (receiptPdf?: typeof pdf | null) =>
  sendPlatformInvoiceReceiptEmail('sindico@example.com', 'Maria', 'Residencial Teste', new Date('2026-09-01T00:00:00Z'), 9900, receiptPdf);

afterEach(() => {
  Object.assign(config.email, JSON.parse(JSON.stringify(originalEmail)));
  vi.unstubAllGlobals();
  sendMail.mockClear();
});

describe('recibo por e-mail — via Resend', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    Object.assign(config.email, { resendApiKey: 'test', from: 'Lar em Dia <no-reply@example.com>', smtp: { ...config.email.smtp, host: '', user: '', pass: '' } });
    fetchMock = vi.fn(async () => new Response('{"id":"r-1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it('manda o PDF anexo em base64, com nome e tipo', async () => {
    await send(pdf);
    expect(body().attachments).toEqual([{ filename: 'recibo-lar-em-dia-2026-09.pdf', content: pdf.content.toString('base64'), content_type: 'application/pdf' }]);
    expect(Buffer.from(body().attachments[0].content, 'base64').toString()).toBe('%PDF-1.3 recibo');
  });

  it('o texto avisa que o PDF está anexo', async () => {
    await send(pdf);
    expect(body().html).toContain('O recibo em PDF segue em anexo');
  });

  it('sem PDF: sem campo de anexo e o texto volta a dizer que o e-mail é o recibo', async () => {
    await send(null);
    expect(body()).not.toHaveProperty('attachments');
    expect(body().html).toContain('Este e-mail serve como recibo');
  });
});

describe('recibo por e-mail — via SMTP', () => {
  beforeEach(() => {
    Object.assign(config.email, { from: 'Lar em Dia <no-reply@example.com>', smtp: { ...config.email.smtp, host: 'smtp.example.com', user: 'u', pass: 'p' } });
  });

  it('entrega o PDF como anexo do nodemailer (Buffer, sem base64)', async () => {
    await send(pdf);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'sindico@example.com',
      attachments: [{ filename: 'recibo-lar-em-dia-2026-09.pdf', content: pdf.content, contentType: 'application/pdf' }],
    });
  });

  it('sem PDF, não manda lista de anexos vazia', async () => {
    await send(null);
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('attachments');
  });
});
