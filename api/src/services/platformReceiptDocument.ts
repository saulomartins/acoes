import PDFDocument from 'pdfkit';
import { config } from '../config';

// Recibo em PDF da fatura da plataforma paga — o mesmo recibo que vai por
// e-mail (sendPlatformInvoiceReceiptEmail em emailService.ts, mesmo texto de
// declaração), baixável a qualquer momento na tela "Minhas faturas" pro
// síndico anexar na prestação de contas. Diferença proposital: aqui a data é
// a do pagamento, não a do envio — o PDF pode ser baixado meses depois.
export type PlatformReceiptData = {
  invoiceId: string;
  condominiumName: string;
  referenceMonth: string; // YYYY-MM-DD
  amountCents: number;
  activeUsers: number;
  planName: string;
  paidAt: Date;
  paymentMethod: string | null;
};

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMonthLabel = (referenceMonth: string) =>
  new Date(`${referenceMonth.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatPaidDate = (date: Date) => date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const paymentMethodLabel = (method: string | null) => method === 'manual' ? 'Pagamento confirmado pela administração da plataforma' : 'Pix (Mercado Pago)';

// Número curto e estável pra citar o recibo (prestação de contas, suporte).
export const platformReceiptNumber = (invoiceId: string) => invoiceId.replace(/-/g, '').slice(0, 8).toUpperCase();

export const buildPlatformReceiptPdf = async (data: PlatformReceiptData): Promise<Buffer> => {
  const owner = config.platformReceipt;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: `Recibo ${platformReceiptNumber(data.invoiceId)} — Lar em Dia` } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const amount = formatCurrency(data.amountCents);
  const month = formatMonthLabel(data.referenceMonth);

  doc.font('Helvetica-Bold').fontSize(16).text('RECIBO DE PAGAMENTO', { align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#444').text(`Nº ${platformReceiptNumber(data.invoiceId)}`, { align: 'center' });
  doc.fillColor('#000').moveDown(2);

  doc.font('Helvetica-Bold').fontSize(20).text(amount, { align: 'center' });
  doc.moveDown(2);

  // Mesma declaração do e-mail; sem PLATFORM_RECEIPT_OWNER_* no .env sai a
  // versão sem identificação de quem recebe (melhor que não ter recibo).
  doc.font('Helvetica').fontSize(11.5).text(
    owner.ownerName
      ? `Eu, ${owner.ownerName}${owner.ownerCpf ? `, CPF ${owner.ownerCpf}` : ''}, declaro ter recebido de ${data.condominiumName} a quantia de ` +
        `${amount} referente à assinatura da plataforma Lar em Dia, competência de ${month}.`
      : `Recebemos o pagamento de ${amount} referente à assinatura da plataforma Lar em Dia de ${data.condominiumName}, competência de ${month}.`,
    { align: 'justify', lineGap: 4 },
  );

  doc.moveDown(1.5);
  doc.fontSize(10.5);
  const detail = (label: string, value: string) => {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value);
  };
  detail('Plano', data.planName);
  detail('Usuários ativos na competência', String(data.activeUsers));
  detail('Pago em', formatPaidDate(data.paidAt));
  detail('Forma de pagamento', paymentMethodLabel(data.paymentMethod));

  doc.moveDown(3);
  doc.fontSize(11.5).text(`${owner.ownerCity ? `${owner.ownerCity}, ` : ''}${formatPaidDate(data.paidAt)}.`, { align: 'center' });

  if (owner.ownerName) {
    doc.moveDown(3);
    doc.text('_______________________________________', { align: 'center' });
    doc.font('Helvetica-Bold').text(owner.ownerName, { align: 'center' });
    if (owner.ownerCpf) doc.font('Helvetica').fontSize(10).text(`CPF ${owner.ownerCpf}`, { align: 'center' });
  }

  doc.moveDown(4);
  doc.font('Helvetica').fontSize(8.5).fillColor('#444');
  doc.text('Documento emitido eletronicamente pelo sistema Lar em Dia.', { align: 'center' });
  doc.text('Este valor se refere à assinatura da plataforma pelo condomínio, não a taxas condominiais dos moradores.', { align: 'center' });
  doc.text(`Fatura ${data.invoiceId}`, { align: 'center' });

  doc.end();
  return done;
};
