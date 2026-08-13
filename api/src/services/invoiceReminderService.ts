import { query } from '../db';
import { notifyUsers } from './notificationService';

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// due_date pode chegar como Date (padrão do driver pg para colunas `date`)
// ou como string ISO, dependendo de qual query a originou.
const formatDateBr = (dueDate: unknown) => {
  const iso = dueDate instanceof Date ? dueDate.toISOString() : String(dueDate ?? '');
  return iso.slice(0, 10).split('-').reverse().join('/');
};

// Chamado logo após um boleto ser criado (emissão individual, lote mensal ou
// parcela de acordo) — o morador é avisado assim que a cobrança existe, sem
// depender do job diário. Nunca lança: uma falha aqui não pode desfazer/
// invalidar a emissão que já aconteceu.
export const notifyNewInvoice = async (invoice: { id: string; condominiumId: string; userId: string; amountCents: number; dueDate: unknown }) => {
  try {
    await notifyUsers({
      condominiumId: invoice.condominiumId,
      recipientIds: [invoice.userId],
      title: 'Novo boleto disponível',
      body: `Um boleto de ${money(invoice.amountCents)} foi emitido, com vencimento em ${formatDateBr(invoice.dueDate)}.`,
      screen: 'Invoices',
    });
  } catch (error) {
    console.error('notifyNewInvoice failed', { invoiceId: invoice.id, error });
  }
};

// Boletos que acabaram de virar 'overdue' — a transição de status em si é o
// marcador de dedupe (um boleto só cruza issued -> overdue uma vez), então não
// precisa de coluna extra: quem quer que rode essa função primeiro (o job
// diário ou uma tela abrindo GET /invoices) é quem dispara o aviso; a segunda
// chamada não encontra mais linhas para atualizar.
//
// Só 'issued' entra. Um boleto 'pending_provider' é um boleto que o banco ainda
// não confirmou (EM_PROCESSAMENTO no Inter, ou qualquer situação não mapeada):
// não existe linha digitável nem Pix, então o morador não teria como pagar
// mesmo querendo. Marcá-lo como vencido mostrava "Atrasado" na Gestão de
// cobranças e ainda disparava push de cobrança para quem não recebeu boleto
// nenhum. Esses ficam no card "Aguardando o banco", que é o lugar deles.
export const transitionOverdueInvoices = async (): Promise<number> => {
  const result = await query<{ id: string; condominium_id: string; user_id: string; amount_cents: number; due_date: string }>(
    `update invoices set status='overdue'::invoice_status
     where status='issued'::invoice_status
       and due_date < current_date and deleted_at is null
     returning id, condominium_id, user_id, amount_cents, due_date`,
  );
  for (const invoice of result.rows) {
    try {
      await notifyUsers({
        condominiumId: invoice.condominium_id,
        recipientIds: [invoice.user_id],
        title: 'Boleto vencido',
        body: `Seu boleto de ${money(invoice.amount_cents)}, com vencimento em ${formatDateBr(invoice.due_date)}, está em atraso. Regularize o quanto antes.`,
        screen: 'Invoices',
      });
    } catch (error) {
      console.error('transitionOverdueInvoices notify failed', { invoiceId: invoice.id, error });
    }
  }
  return result.rows.length;
};

// Boletos que vencem daqui a exatamente 3 dias — roda só pelo job diário
// (não faz sentido num lazy-recompute por GET, já que precisa avisar mesmo
// que ninguém abra o app naquele dia). due_soon_notified_at é o dedupe.
export const notifyDueSoonInvoices = async (): Promise<number> => {
  const result = await query<{ id: string; condominium_id: string; user_id: string; amount_cents: number; due_date: string }>(
    `update invoices set due_soon_notified_at=now()
     where status in ('pending_provider'::invoice_status,'issued'::invoice_status)
       and due_date = current_date + interval '3 days'
       and due_soon_notified_at is null and deleted_at is null
     returning id, condominium_id, user_id, amount_cents, due_date`,
  );
  for (const invoice of result.rows) {
    try {
      await notifyUsers({
        condominiumId: invoice.condominium_id,
        recipientIds: [invoice.user_id],
        title: 'Boleto vence em 3 dias',
        body: `Seu boleto de ${money(invoice.amount_cents)} vence em ${formatDateBr(invoice.due_date)}. Evite juros e multa pagando até a data.`,
        screen: 'Invoices',
      });
    } catch (error) {
      console.error('notifyDueSoonInvoices notify failed', { invoiceId: invoice.id, error });
    }
  }
  return result.rows.length;
};
