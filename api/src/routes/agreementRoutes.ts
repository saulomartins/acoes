import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { createInterBoleto } from '../services/interService';
import { getInterIntegration } from './invoiceRoutes';

const router = Router();
router.use(authenticate);

const isoDate = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000));
const addMonths = (date: string, months: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10); };
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

const notify = async (input: { condominiumId: string; senderId: string; recipients: string[]; title: string; body: string }) => {
  if (!input.recipients.length) return;
  await withTransaction(async client => {
    const notificationId = randomUUID();
    await client.query(`insert into notifications(id,condominium_id,title,body,created_by,provider_status,audience_type) values($1,$2,$3,$4,$5,'stored','personal')`, [notificationId, input.condominiumId, input.title, input.body, input.senderId]);
    for (const userId of input.recipients) await client.query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, userId]);
  });
};

const recipientsFor = async (condominiumId: string, debtorUserId: string, unitId?: string | null) => {
  const result = await query<{ id: string }>(`select id from users where condominium_id=$1 and login_enabled=true and (id=$2 or ($3::uuid is not null and unit_id=$3))`, [condominiumId, debtorUserId, unitId || null]);
  return result.rows.map(row => row.id);
};

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const manager = ['sindico', 'subsindico'].includes(req.user?.role || '');
  const breached = await query<any>(`update debt_agreements a set status='breached',breached_at=now(),breach_reason='Nova taxa condominial vencida após o aceite do acordo.',updated_at=now()
    where a.condominium_id=$1 and a.status in ('accepted','active','at_risk') and exists(
      select 1 from invoices i where i.condominium_id=a.condominium_id and i.invoice_type='regular' and i.status not in ('paid','canceled')
      and i.due_date>=(a.accepted_at at time zone 'America/Sao_Paulo')::date and i.due_date<current_date
      and (i.user_id=a.debtor_user_id or i.user_id in(select user_id from unit_occupancies where unit_id=a.unit_id and ended_at is null))
      and not exists(select 1 from debt_agreement_items ai where ai.agreement_id=a.id and ai.invoice_id=i.id)
    ) returning a.*`, [condominiumId]);
  for (const agreement of breached.rows) {
    const people = await query<{id:string}>(`select id from users where condominium_id=$1 and login_enabled=true and (role in ('sindico','subsindico') or id=$2 or ($3::uuid is not null and unit_id=$3))`, [condominiumId, agreement.debtor_user_id, agreement.unit_id]);
    const body = `O acordo ${agreement.id.slice(0,8).toUpperCase()} foi rompido porque existe uma nova taxa vencida após o aceite. Os débitos originais voltaram a ser atualizados e uma nova negociação poderá ser criada.`;
    await notify({ condominiumId: condominiumId as string, senderId: req.user?.id as string, recipients: people.rows.map(row=>row.id), title: 'Acordo de débito rompido', body });
    for (const person of people.rows) await query(`insert into debt_communications(id,condominium_id,agreement_id,user_id,channel,message,status,created_by) values($1,$2,$3,$4,'app',$5,'sent',$6)`, [randomUUID(), condominiumId, agreement.id, person.id, body, req.user?.id]);
  }
  await query(`update debt_agreements a set status='settled',settled_at=now(),updated_at=now() where a.condominium_id=$1 and a.status='active' and exists(select 1 from debt_agreement_installments p where p.agreement_id=a.id) and not exists(select 1 from debt_agreement_installments p left join invoices i on i.id=p.invoice_id where p.agreement_id=a.id and (p.invoice_id is null or i.status<>'paid'))`, [condominiumId]);
  const result = await query<any>(`select a.*,coalesce(u.full_name,u.username) debtor_name,
      coalesce(nullif(concat_ws(' - ',b.name,un.number),''),u.unit,'Sem apartamento') apartment,
      coalesce(jsonb_agg(distinct jsonb_build_object('invoiceId',ai.invoice_id,'referenceMonth',coalesce(oi.reference_month,oi.due_date),'dueDate',oi.due_date,'principalCents',ai.principal_cents,'fineCents',ai.fine_cents,'interestCents',ai.interest_cents,'frozenTotalCents',ai.frozen_total_cents,'frozenAt',ai.frozen_at)) filter(where ai.invoice_id is not null),'[]') items,
      coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'number',p.installment_number,'amountCents',p.amount_cents,'dueDate',p.due_date,'invoiceId',p.invoice_id,'status',pi.status)) filter(where p.id is not null),'[]') installments
    from debt_agreements a join users u on u.id=a.debtor_user_id left join units un on un.id=a.unit_id left join blocks b on b.id=un.block_id
    left join debt_agreement_items ai on ai.agreement_id=a.id left join invoices oi on oi.id=ai.invoice_id left join debt_agreement_installments p on p.agreement_id=a.id left join invoices pi on pi.id=p.invoice_id
    where a.condominium_id=$1 and ($2::boolean or a.debtor_user_id=$3 or a.unit_id=(select unit_id from users where id=$3))
    group by a.id,u.full_name,u.username,u.unit,b.name,un.number order by a.created_at desc`, [condominiumId, manager, req.user?.id]);
  return res.json({ agreements: result.rows });
}));

router.post('/communicate-debt', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const senderId = req.user?.id as string;
  const userId = String(req.body?.userId || '');
  const invoiceIds = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(String) : [];
  if (!userId || !invoiceIds.length) return res.status(400).json({ message: 'Selecione o responsável e ao menos um débito.' });
  const person = await query<any>(`select id,full_name,username,phone,unit_id,unit from users where id=$1 and condominium_id=$2`, [userId, condominiumId]);
  if (!person.rows[0]) return res.status(404).json({ message: 'Responsável não encontrado.' });
  const debts = await query<any>(`select id,amount_cents,due_date,reference_month from invoices where id=any($1::uuid[]) and user_id=$2 and condominium_id=$3 and status not in ('paid','canceled')`, [invoiceIds, userId, condominiumId]);
  if (!debts.rows.length) return res.status(400).json({ message: 'Nenhum débito em aberto foi encontrado.' });
  const today = new Date().toISOString().slice(0, 10);
  const total = debts.rows.reduce((sum: number, row: any) => { const late = isoDate(row.due_date) < today ? daysBetween(isoDate(row.due_date), today) : 0; return sum + Number(row.amount_cents) + (late ? Math.round(Number(row.amount_cents) * .02) + Math.round(Number(row.amount_cents) * .000333 * late) : 0); }, 0);
  const references = debts.rows.map((row: any) => isoDate(row.reference_month || row.due_date).slice(0, 7).split('-').reverse().join('/')).join(', ');
  const message = `Olá, ${person.rows[0].full_name || person.rows[0].username}. Identificamos débito(s) do apartamento ${person.rows[0].unit || ''}, referência(s) ${references}. Valor atualizado em ${today.split('-').reverse().join('/')}: ${money(total)}. Entre em contato com a administração para regularização ou negociação.`;
  const recipients = await recipientsFor(condominiumId, userId, person.rows[0].unit_id);
  await notify({ condominiumId, senderId, recipients, title: 'Comunicado de débito condominial', body: message });
  await query(`insert into debt_communications(id,condominium_id,user_id,invoice_ids,channel,message,status,created_by) values($1,$2,$3,$4,'whatsapp',$5,'prepared',$6)`, [randomUUID(), condominiumId, userId, invoiceIds, message, senderId]);
  const phone = digits(person.rows[0].phone);
  return res.status(201).json({ message, whatsappUrl: `https://wa.me/${phone.length >= 10 ? `55${phone.replace(/^55/, '')}` : ''}?text=${encodeURIComponent(message)}`, recipientCount: recipients.length });
}));

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const invoiceIds = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(String) : [];
  const debtorUserId = String(req.body?.debtorUserId || '');
  const installmentCount = Number(req.body?.installmentCount);
  const firstDueDate = String(req.body?.firstDueDate || '');
  const validUntil = req.body?.validUntil ? String(req.body.validUntil) : null;
  if (!debtorUserId || !invoiceIds.length || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60 || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) return res.status(400).json({ message: 'Revise o responsável, débitos, parcelas e primeiro vencimento.' });
  const asOf = new Date().toISOString().slice(0, 10);
  const invoices = await query<any>(`select i.id,i.user_id,i.amount_cents,i.due_date,u.unit_id from invoices i join users u on u.id=i.user_id where i.id=any($1::uuid[]) and i.user_id=$2 and i.condominium_id=$3 and i.status not in ('paid','canceled') and not exists(select 1 from debt_agreement_items ai join debt_agreements a on a.id=ai.agreement_id where ai.invoice_id=i.id and a.status in ('sent','accepted','active','at_risk'))`, [invoiceIds, debtorUserId, condominiumId]);
  if (invoices.rows.length !== invoiceIds.length) return res.status(409).json({ message: 'Há débitos inválidos ou já incluídos em outro acordo.' });
  const snapshots = invoices.rows.map((row: any) => { const principal = Number(row.amount_cents); const late = isoDate(row.due_date) < asOf ? daysBetween(isoDate(row.due_date), asOf) : 0; const fine = late ? Math.round(principal * .02) : 0; const interest = late ? Math.round(principal * .000333 * late) : 0; return { ...row, principal, fine, interest, total: principal + fine + interest }; });
  const originalTotal = snapshots.reduce((sum: number, row: any) => sum + row.total, 0);
  const negotiatedTotal = Number.isInteger(Number(req.body?.negotiatedTotalCents)) && Number(req.body.negotiatedTotalCents) > 0 ? Number(req.body.negotiatedTotalCents) : originalTotal;
  const agreement = await withTransaction(async client => {
    const id = randomUUID();
    await client.query(`insert into debt_agreements(id,condominium_id,debtor_user_id,unit_id,created_by,original_total_cents,negotiated_total_cents,installment_count,first_due_date,notes,valid_until) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, condominiumId, debtorUserId, snapshots[0].unit_id, req.user?.id, originalTotal, negotiatedTotal, installmentCount, firstDueDate, String(req.body?.notes || '').trim() || null, validUntil]);
    for (const row of snapshots) await client.query(`insert into debt_agreement_items(agreement_id,invoice_id,principal_cents,fine_cents,interest_cents,frozen_total_cents,frozen_at) values($1,$2,$3,$4,$5,$6,$7)`, [id, row.id, row.principal, row.fine, row.interest, row.total, asOf]);
    for (let index = 0; index < installmentCount; index++) { const base = Math.floor(negotiatedTotal / installmentCount); const amount = base + (index === installmentCount - 1 ? negotiatedTotal - base * installmentCount : 0); await client.query(`insert into debt_agreement_installments(id,agreement_id,installment_number,amount_cents,due_date) values($1,$2,$3,$4,$5)`, [randomUUID(), id, index + 1, amount, addMonths(firstDueDate, index)]); }
    return { id, originalTotal, negotiatedTotal };
  });
  return res.status(201).json({ agreement, message: 'Proposta criada como rascunho.' });
}));

router.post('/:id/send', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const result = await query<any>(`update debt_agreements set status='sent',sent_at=now(),updated_at=now() where id=$1 and condominium_id=$2 and status='draft' returning *`, [req.params.id, req.user?.condominiumId]);
  const agreement = result.rows[0]; if (!agreement) return res.status(409).json({ message: 'Somente propostas em rascunho podem ser enviadas.' });
  const recipients = await recipientsFor(agreement.condominium_id, agreement.debtor_user_id, agreement.unit_id);
  const body = `Proposta de acordo ${agreement.id.slice(0, 8).toUpperCase()}: ${money(agreement.negotiated_total_cents)} em ${agreement.installment_count} parcela(s). Acesse o aplicativo para consultar e aceitar.`;
  await notify({ condominiumId: agreement.condominium_id, senderId: req.user?.id as string, recipients, title: 'Proposta de acordo de débito', body });
  return res.json({ agreement, message: 'Proposta enviada e registrada nas comunicações.' });
}));

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const result = await query<any>(`update debt_agreements set status='accepted',accepted_at=now(),accepted_by=$3,updated_at=now() where id=$1 and condominium_id=$2 and status='sent' and (debtor_user_id=$3 or unit_id=(select unit_id from users where id=$3)) and (valid_until is null or valid_until>=current_date) returning *`, [req.params.id, req.user?.condominiumId, req.user?.id]);
  if (!result.rows[0]) return res.status(409).json({ message: 'A proposta não está disponível para aceite.' });
  return res.json({ agreement: result.rows[0], message: 'Acordo aceito. Os débitos incluídos foram congelados.' });
}));

router.post('/:id/issue', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const agreementResult = await query<any>(`select a.*,u.full_name,u.username,u.cpf,u.email,u.phone,u.street,u.address_number,u.address_complement,u.neighborhood,u.city,u.state,u.postal_code,u.unit from debt_agreements a join users u on u.id=a.debtor_user_id where a.id=$1 and a.condominium_id=$2 and a.status in ('accepted','active')`, [req.params.id, req.user?.condominiumId]);
  const agreement = agreementResult.rows[0]; if (!agreement) return res.status(409).json({ message: 'O acordo precisa estar aceito para emitir parcelas.' });
  if (!agreement.full_name || !agreement.cpf || !agreement.street || !agreement.address_number || !agreement.neighborhood || !agreement.city || !agreement.state || !agreement.postal_code) return res.status(400).json({ message: 'Complete nome, CPF e endereço do responsável antes da emissão.' });
  const installments = await query<any>(`select * from debt_agreement_installments where agreement_id=$1 and invoice_id is null order by installment_number`, [agreement.id]);
  const integration = await getInterIntegration(agreement.condominium_id); const issued = [];
  for (const installment of installments.rows) {
    const description = `Acordo ${agreement.id.slice(0, 8).toUpperCase()} - parcela ${installment.installment_number}/${agreement.installment_count}`;
    const boleto = await createInterBoleto({ payerName: agreement.full_name || agreement.username, payerDocument: agreement.cpf, amountCents: installment.amount_cents, dueDate: isoDate(installment.due_date), description, payerEmail: agreement.email, payerPhone: agreement.phone, payerStreet: agreement.street, payerNumber: agreement.address_number, payerComplement: agreement.address_complement, payerNeighborhood: agreement.neighborhood, payerCity: agreement.city, payerState: agreement.state, payerPostalCode: agreement.postal_code, payerUnit: agreement.unit }, integration);
    const invoiceId = randomUUID();
    await withTransaction(async client => { await client.query(`insert into invoices(id,condominium_id,user_id,amount_cents,due_date,status,provider,external_id,digitable_line,pdf_url,invoice_type,agreement_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'agreement',$11)`, [invoiceId, agreement.condominium_id, agreement.debtor_user_id, installment.amount_cents, installment.due_date, boleto.status === 'processing' ? 'issued' : 'pending_provider', boleto.provider, boleto.externalId, boleto.digitableLine, boleto.pdfUrl, agreement.id]); await client.query(`update debt_agreement_installments set invoice_id=$1 where id=$2`, [invoiceId, installment.id]); });
    issued.push(invoiceId);
  }
  await query(`update debt_agreements set status='active',updated_at=now() where id=$1`, [agreement.id]);
  return res.status(201).json({ issued: issued.length, message: `${issued.length} parcela(s) de acordo gerada(s).` });
}));

export default router;
