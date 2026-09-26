import { inflateSync } from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildPlatformReceiptPdf, platformReceiptNumber, type PlatformReceiptData } from './platformReceiptDocument';

const data: PlatformReceiptData = {
  invoiceId: '3f2a9c1e-5b7d-4e21-9a0c-7d1e2f3a4b5c',
  condominiumName: 'Residencial Teste',
  referenceMonth: '2026-09-01',
  amountCents: 12350,
  activeUsers: 45,
  planName: 'Essencial',
  paidAt: new Date('2026-09-05T02:30:00Z'), // 23h30 de 04/09 em São Paulo
  paymentMethod: 'pix_mercadopago',
};

// Extrai o texto do PDF sem biblioteca: descomprime os streams e junta as
// strings hex dos operadores TJ (fontes padrão do pdfkit usam WinAnsi, que
// bate com latin1 nos acentos do português). Não usa o pdf-parse porque o
// pdf.js antigo dele falha dentro do vitest com "bad XRef entry" em PDFs que
// ele mesmo lê sem erro fora do vitest.
const pdfText = (buffer: Buffer) => {
  const raw = buffer.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return match[1]; }
  });
  return [...streams.join('\n').matchAll(/\[(.*?)\]\s*TJ/g)]
    .map(op => [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join(''))
    .join(' ');
};

// O texto justificado vira deslocamento em vez de espaço, então compara sem espaços.
const squash = (value: string) => value.replace(/\s+/g, '');

const textOf = async (receipt: PlatformReceiptData) => {
  const buffer = await buildPlatformReceiptPdf(receipt);
  const raw = buffer.toString('latin1');
  expect(raw.startsWith('%PDF-')).toBe(true);
  expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
  // startxref tem que apontar pra tabela xref de verdade — é o que um leitor
  // de PDF usa pra achar os objetos.
  const startxref = Number(/startxref\s+(\d+)/.exec(raw)?.[1]);
  expect(raw.slice(startxref, startxref + 4)).toBe('xref');
  return squash(pdfText(buffer));
};

const expectText = (text: string, phrase: string) => expect(text).toContain(squash(phrase));

describe('buildPlatformReceiptPdf', () => {
  const originalOwner = { ...config.platformReceipt };
  afterEach(() => { Object.assign(config.platformReceipt, originalOwner); });

  it('com o dono configurado: declaração de recebimento com nome, CPF, valor e competência', async () => {
    Object.assign(config.platformReceipt, { ownerName: 'Fulano de Tal', ownerCpf: '529.982.247-25', ownerCity: 'Belo Horizonte' });
    const text = await textOf(data);

    expectText(text,'RECIBO DE PAGAMENTO');
    expectText(text,`Nº ${platformReceiptNumber(data.invoiceId)}`);
    expectText(text,'Eu, Fulano de Tal, CPF 529.982.247-25, declaro ter recebido de Residencial Teste a quantia de R$ 123,50');
    expectText(text,'competência de setembro de 2026');
    expectText(text,'Plano: Essencial');
    expectText(text,'Usuários ativos na competência: 45');
    expectText(text,'Forma de pagamento: Pix (Mercado Pago)');
    expectText(text,`Fatura ${data.invoiceId}`);
  });

  it('data do pagamento no fuso de São Paulo (não em UTC)', async () => {
    Object.assign(config.platformReceipt, { ownerName: 'Fulano de Tal', ownerCpf: '', ownerCity: 'Belo Horizonte' });
    const text = await textOf(data);
    expectText(text,'Pago em: 4 de setembro de 2026');
    expectText(text,'Belo Horizonte, 4 de setembro de 2026');
  });

  it('sem o dono configurado: sai o recibo sem identificação, em vez de nenhum', async () => {
    Object.assign(config.platformReceipt, { ownerName: '', ownerCpf: '', ownerCity: '' });
    const text = await textOf(data);
    expectText(text,'Recebemos o pagamento de R$ 123,50 referente à assinatura da plataforma Lar em Dia de Residencial Teste');
    expect(text).not.toContain('declaro');
  });

  it('pagamento confirmado manualmente aparece como tal', async () => {
    const text = await textOf({ ...data, paymentMethod: 'manual' });
    expectText(text,'Forma de pagamento: Pagamento confirmado pela administração da plataforma');
  });
});

describe('platformReceiptNumber', () => {
  it('8 primeiros caracteres do id, sem hífen, em maiúsculas', () => {
    expect(platformReceiptNumber('3f2a9c1e-5b7d-4e21-9a0c-7d1e2f3a4b5c')).toBe('3F2A9C1E');
  });
});
