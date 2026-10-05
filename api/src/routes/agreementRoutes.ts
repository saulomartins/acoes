import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { createInterBoleto } from '../services/interService';
import { getInterIntegration, syncInterInvoice } from './invoiceRoutes';
import { sendWhatsAppTemplateMessage } from '../services/whatsappService';
import { sendPushNotification } from '../services/notificationService';
import { getBillingRules, calculateLateFee } from '../services/lateFeeService';
import { notifyNewInvoice } from '../services/invoiceReminderService';
import { logAudit } from '../services/auditService';
import { getOwnedUnitIds } from '../services/unitOwnershipService';

const router = Router();
router.use(authenticate);
router.use(requireFeature('historico_acordos'));

const isoDate = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const daysBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000));
const addMonths = (date: string, months: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10); };
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// "2026-08" -> "Agosto-2026", no formato usado nos comunicados de débito.
const monthLabel = (yearMonth: string) => `${MONTH_NAMES[Number(yearMonth.slice(5, 7)) - 1]}-${yearMonth.slice(0, 4)}`;
// Primeiro nome com só a inicial maiúscula ("VITOR LEONARDO" -> "Vitor").
const firstName = (name: string) => { const first = String(name || '').trim().split(/\s+/)[0] || ''; return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR'); };
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const formatPhoneDisplay = (value: string) => {
  const local = value.replace(/^55/, '');
  return local.length > 10
    ? local.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
    : local.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
};

const notify = async (input: { condominiumId: string; senderId: string; recipients: string[]; title: string; body: string }) => {
  if (!input.recipients.length) return;

  const devices = await query<{ fcm_token: string }>(`select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`, [input.recipients]);
  const tokens = devices.rows.map(row => row.fcm_token).filter(Boolean);
  let push: { status: string; invalidTokens?: string[]; errors?: string[] };
  try {
    push = await sendPushNotification({ tokens, title: input.title, body: input.body, data: { screen: 'Debts' } });
    if (push.errors?.length) console.warn('Agreement push notification errors', push.errors);
    if (push.invalidTokens?.length) await query(`delete from device_tokens where fcm_token = any($1::text[])`, [push.invalidTokens]);
  } catch (error) {
    console.warn('Agreement push notification failed', error);
    push = { status: 'provider_error' };
  }

  await withTransaction(async client => {
    const notificationId = randomUUID();
    await client.query(`insert into notifications(id,condominium_id,title,body,created_by,provider_status,audience_type) values($1,$2,$3,$4,$5,$6,'personal')`, [notificationId, input.condominiumId, input.title, input.body, input.senderId, push.status]);
    for (const userId of input.recipients) await client.query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, userId]);
  });
};

// Acordo judicial = acordo que inclui um débito antigo registrado como
// negociação judicial (invoices.negotiation_type). As condições já foram
// definidas no processo, então a emissão das parcelas não depende do aceite
// do responsável no aplicativo (ver POST /:id/issue).
const judicialItems = `from debt_agreement_items ji join invoices jv on jv.id=ji.invoice_id where ji.agreement_id=a.id and jv.negotiation_type='judicial'`;
const judicialColumns = `exists(select 1 ${judicialItems}) judicial,(select max(jv.judicial_process_number) ${judicialItems}) judicial_process_number`;

// Acordo de débito antigo: um único débito incluído, lançado manualmente
// (invoice_type='legacy'). Só nele a dívida original é um valor digitado — nos
// demais ela é a soma calculada dos débitos incluídos.
const legacyColumn = `(select case when count(*)=1 and bool_and(lv.invoice_type='legacy') then (array_agg(lv.id))[1] end from debt_agreement_items li join invoices lv on lv.id=li.invoice_id where li.agreement_id=a.id) legacy_invoice_id`;

const recipientsFor = async (condominiumId: string, debtorUserId: string, unitId?: string | null) => {
  const result = await query<{ id: string }>(`select id from users where condominium_id=$1 and login_enabled=true and (id=$2 or ($3::uuid is not null and unit_id=$3))`, [condominiumId, debtorUserId, unitId || null]);
  return result.rows.map(row => row.id);
};

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const manager = ['sindico', 'subsindico'].includes(req.user?.role || '');
  const ownedUnitIds = manager ? [] : await getOwnedUnitIds(req.user!.id);
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

  // Sincroniza parcelas de acordo com Inter antes de retornar (status sempre frescos)
  const installmentInvoices = await query<{id:string;condominium_id:string;external_id:string}>(
    `select i.id, i.condominium_id, i.external_id from debt_agreement_installments p
     join invoices i on i.id = p.invoice_id
     join debt_agreements a on a.id = p.agreement_id
     where a.condominium_id = $1 and i.external_id is not null
       and i.status not in ('paid','canceled')`,
    [condominiumId]
  );
  if (installmentInvoices.rows.length > 0) {
    await Promise.allSettled(
      installmentInvoices.rows.map(inv => syncInterInvoice(inv).catch(() => {}))
    );
  }

  const result = await query<any>(`select a.*,coalesce(u.full_name,u.username) debtor_name,${judicialColumns},${legacyColumn},
      coalesce(nullif(concat_ws(' - ',b.name,un.number),''),u.unit,'Sem apartamento') apartment,
      coalesce(jsonb_agg(distinct jsonb_build_object('invoiceId',ai.invoice_id,'referenceMonth',coalesce(oi.reference_month,oi.due_date),'dueDate',oi.due_date,'principalCents',ai.principal_cents,'fineCents',ai.fine_cents,'interestCents',ai.interest_cents,'frozenTotalCents',ai.frozen_total_cents,'frozenAt',ai.frozen_at)) filter(where ai.invoice_id is not null),'[]') items,
      coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'number',p.installment_number,'amountCents',p.amount_cents,'dueDate',p.due_date,'invoiceId',p.invoice_id,'status',pi.status,'canceledAt',p.canceled_at,'cancellationReason',p.cancellation_reason)) filter(where p.id is not null),'[]') installments
    from debt_agreements a join users u on u.id=a.debtor_user_id left join units un on un.id=a.unit_id left join blocks b on b.id=un.block_id
    left join debt_agreement_items ai on ai.agreement_id=a.id left join invoices oi on oi.id=ai.invoice_id left join debt_agreement_installments p on p.agreement_id=a.id left join invoices pi on pi.id=p.invoice_id
    where a.condominium_id=$1 and a.status<>'canceled' and ($2::boolean or a.debtor_user_id=$3 or a.unit_id=(select unit_id from users where id=$3) or a.unit_id=any($4::uuid[]))
    group by a.id,u.full_name,u.username,u.unit,b.name,un.number order by a.created_at desc`, [condominiumId, manager, req.user?.id, ownedUnitIds]);
  return res.json({ agreements: result.rows });
}));

router.post('/communicate-debt', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const senderId = req.user?.id as string;
  const userId = String(req.body?.userId || '');
  const invoiceIds = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(String) : [];
  if (!userId || !invoiceIds.length) return res.status(400).json({ message: 'Selecione o responsável e ao menos um débito.' });
  const condominium = await query<any>(
    `select c.phone, w.phone_number_id, w.access_token, w.template_name, w.template_language, w.enabled as whatsapp_enabled
     from condominiums c left join whatsapp_integrations w on w.condominium_id = c.id
     where c.id=$1`,
    [condominiumId],
  );
  const condominiumPhone = digits(condominium.rows[0]?.phone);
  if (!condominiumPhone) return res.status(400).json({ message: 'Cadastre o telefone/WhatsApp do condomínio em Configuração inicial antes de enviar comunicados por WhatsApp.' });
  const whatsappIntegration = condominium.rows[0]?.whatsapp_enabled ? {
    phoneNumberId: condominium.rows[0].phone_number_id,
    accessToken: condominium.rows[0].access_token,
    templateName: condominium.rows[0].template_name,
    templateLanguage: condominium.rows[0].template_language,
    enabled: true,
  } : null;
  const person = await query<any>(`select id,full_name,username,phone,unit_id,unit from users where id=$1 and condominium_id=$2`, [userId, condominiumId]);
  if (!person.rows[0]) return res.status(404).json({ message: 'Responsável não encontrado.' });
  const debts = await query<any>(`select id,amount_cents,due_date,reference_month from invoices where id=any($1::uuid[]) and user_id=$2 and condominium_id=$3 and status not in ('paid','canceled') and deleted_at is null`, [invoiceIds, userId, condominiumId]);
  if (!debts.rows.length) return res.status(400).json({ message: 'Nenhum débito em aberto foi encontrado.' });
  const today = new Date().toISOString().slice(0, 10);
  const total = debts.rows.reduce((sum: number, row: any) => { const late = isoDate(row.due_date) < today ? daysBetween(isoDate(row.due_date), today) : 0; return sum + Number(row.amount_cents) + (late ? Math.round(Number(row.amount_cents) * .02) + Math.round(Number(row.amount_cents) * .000333 * late) : 0); }, 0);
  const months = [...new Set(debts.rows.map((row: any) => isoDate(row.reference_month || row.due_date).slice(0, 7)))].sort() as string[];
  const references = months.map(monthLabel);
  const referencesText = references.length > 1 ? `aos meses de ${references.slice(0, -1).join(', ')} e ${references[references.length - 1]}` : `ao mês de ${references[0]}`;
  const message = `${firstName(person.rows[0].full_name || person.rows[0].username)},\n\nEstou realizando a verificação dos pagamentos referentes ${referencesText} e, até o momento, não identificamos o recebimento do seu pagamento. O valor atualizado em ${today.split('-').reverse().join('/')} é de ${money(total)}.\n\nCaso já tenha efetuado o pagamento, por favor, entre em contato e envie o comprovante para que possamos atualizar o sistema corretamente.\n\nWhatsApp da administração: ${formatPhoneDisplay(condominiumPhone)}\n\nAgradeço a atenção!!`;
  const recipients = await recipientsFor(condominiumId, userId, person.rows[0].unit_id);
  await notify({ condominiumId, senderId, recipients, title: 'Comunicado de débito condominial', body: message });
  const personPhone = digits(person.rows[0].phone);

  let sentAutomatically = false;
  if (whatsappIntegration && personPhone.length >= 10) {
    try {
      const outcome = await sendWhatsAppTemplateMessage(whatsappIntegration, personPhone, message);
      sentAutomatically = outcome.sent;
    } catch (error) {
      return res.status(502).json({
        message: `Falha ao enviar pelo WhatsApp oficial do condomínio: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
      });
    }
  }

  await query(
    `insert into debt_communications(id,condominium_id,user_id,invoice_ids,channel,message,status,created_by) values($1,$2,$3,$4,'whatsapp',$5,$6,$7)`,
    [randomUUID(), condominiumId, userId, invoiceIds, message, sentAutomatically ? 'sent' : 'prepared', senderId],
  );

  await logAudit(req, 'historico_acordos', 'communicated', `Comunicou débito para ${person.rows[0].full_name || person.rows[0].username}`, { entityId: userId });
  return res.status(201).json({
    message,
    sentAutomatically,
    whatsappUrl: sentAutomatically ? null : `https://wa.me/${personPhone.length >= 10 ? `55${personPhone.replace(/^55/, '')}` : ''}?text=${encodeURIComponent(message)}`,
    recipientCount: recipients.length,
  });
}));

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const invoiceIds = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(String) : [];
  const debtorUserId = String(req.body?.debtorUserId || '');
  const installmentCount = Number(req.body?.installmentCount);
  const firstDueDate = String(req.body?.firstDueDate || '');
  const validUntil = req.body?.validUntil ? String(req.body.validUntil) : null;
  if (!debtorUserId || !invoiceIds.length || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60 || !isValidDate(firstDueDate) || (validUntil !== null && !isValidDate(validUntil))) return res.status(400).json({ message: 'Revise o responsável, débitos, parcelas e primeiro vencimento.' });
  const asOf = new Date().toISOString().slice(0, 10);
  const invoices = await query<any>(`select i.id,i.user_id,i.amount_cents,i.due_date,u.unit_id from invoices i join users u on u.id=i.user_id where i.id=any($1::uuid[]) and i.user_id=$2 and i.condominium_id=$3 and i.status not in ('paid','canceled') and i.deleted_at is null and not exists(select 1 from debt_agreement_items ai join debt_agreements a on a.id=ai.agreement_id where ai.invoice_id=i.id and a.status in ('sent','accepted','active','at_risk'))`, [invoiceIds, debtorUserId, condominiumId]);
  if (invoices.rows.length !== invoiceIds.length) return res.status(409).json({ message: 'Há débitos inválidos ou já incluídos em outro acordo.' });
  const billingRules = await getBillingRules(condominiumId);
  const snapshots = invoices.rows.map((row: any) => { const principal = Number(row.amount_cents); const late = isoDate(row.due_date) < asOf ? daysBetween(isoDate(row.due_date), asOf) : 0; const { fineCents: fine, interestCents: interest } = calculateLateFee(billingRules, principal, late); return { ...row, principal, fine, interest, total: principal + fine + interest }; });
  const originalTotal = snapshots.reduce((sum: number, row: any) => sum + row.total, 0);
  const negotiatedTotal = Number.isInteger(Number(req.body?.negotiatedTotalCents)) && Number(req.body.negotiatedTotalCents) > 0 ? Number(req.body.negotiatedTotalCents) : originalTotal;
  const agreement = await withTransaction(async client => {
    const id = randomUUID();
    await client.query(`insert into debt_agreements(id,condominium_id,debtor_user_id,unit_id,created_by,original_total_cents,negotiated_total_cents,discount_cents,installment_count,first_due_date,notes,valid_until) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, condominiumId, debtorUserId, snapshots[0].unit_id, req.user?.id, originalTotal, negotiatedTotal, Math.max(0, originalTotal - negotiatedTotal), installmentCount, firstDueDate, String(req.body?.notes || '').trim() || null, validUntil]);
    for (const row of snapshots) await client.query(`insert into debt_agreement_items(agreement_id,invoice_id,principal_cents,fine_cents,interest_cents,frozen_total_cents,frozen_at) values($1,$2,$3,$4,$5,$6,$7)`, [id, row.id, row.principal, row.fine, row.interest, row.total, asOf]);
    for (let index = 0; index < installmentCount; index++) { const base = Math.floor(negotiatedTotal / installmentCount); const amount = base + (index === installmentCount - 1 ? negotiatedTotal - base * installmentCount : 0); await client.query(`insert into debt_agreement_installments(id,agreement_id,installment_number,amount_cents,due_date) values($1,$2,$3,$4,$5)`, [randomUUID(), id, index + 1, amount, addMonths(firstDueDate, index)]); }
    return { id, originalTotal, negotiatedTotal };
  });
  await logAudit(req, 'historico_acordos', 'created', `Criou uma proposta de acordo (${money(negotiatedTotal)} em ${installmentCount}x)`, { entityId: agreement.id });
  return res.status(201).json({ agreement, message: 'Proposta criada como rascunho.' });
}));

router.post('/:id/send', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const result = await query<any>(`update debt_agreements set status='sent',sent_at=now(),updated_at=now() where id=$1 and condominium_id=$2 and status='draft' returning *`, [req.params.id, req.user?.condominiumId]);
  const agreement = result.rows[0]; if (!agreement) return res.status(409).json({ message: 'Somente propostas em rascunho podem ser enviadas.' });
  const recipients = await recipientsFor(agreement.condominium_id, agreement.debtor_user_id, agreement.unit_id);
  const body = `Proposta de acordo ${agreement.id.slice(0, 8).toUpperCase()}: ${money(agreement.negotiated_total_cents)} em ${agreement.installment_count} parcela(s). Acesse o aplicativo para consultar e aceitar.`;
  await notify({ condominiumId: agreement.condominium_id, senderId: req.user?.id as string, recipients, title: 'Proposta de acordo de débito', body });
  await logAudit(req, 'historico_acordos', 'sent', `Enviou a proposta de acordo ${agreement.id.slice(0, 8).toUpperCase()}`, { entityId: agreement.id });
  return res.json({ agreement, message: 'Proposta enviada e registrada nas comunicações.' });
}));

router.post('/:id/accept', asyncHandler(async (req, res) => {
  const result = await query<any>(`update debt_agreements set status='accepted',accepted_at=now(),accepted_by=$3,updated_at=now() where id=$1 and condominium_id=$2 and status='sent' and (debtor_user_id=$3 or unit_id=(select unit_id from users where id=$3)) and (valid_until is null or valid_until>=current_date) returning *`, [req.params.id, req.user?.condominiumId, req.user?.id]);
  if (!result.rows[0]) return res.status(409).json({ message: 'A proposta não está disponível para aceite.' });
  return res.json({ agreement: result.rows[0], message: 'Acordo aceito. Os débitos incluídos foram congelados.' });
}));

router.post('/:id/issue', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const agreementResult = await query<any>(`select a.*,u.full_name,u.username,u.cpf,u.email,u.phone,u.street,u.address_number,u.address_complement,u.neighborhood,u.city,u.state,u.postal_code,u.unit,${judicialColumns} from debt_agreements a join users u on u.id=a.debtor_user_id where a.id=$1 and a.condominium_id=$2 and (a.status in ('accepted','active') or (a.status='sent' and exists(select 1 ${judicialItems})))`, [req.params.id, req.user?.condominiumId]);
  const agreement = agreementResult.rows[0]; if (!agreement) return res.status(409).json({ message: 'O acordo precisa estar aceito para emitir parcelas.' });
  if (!agreement.full_name || !agreement.cpf || !agreement.street || !agreement.address_number || !agreement.neighborhood || !agreement.city || !agreement.state || !agreement.postal_code) return res.status(400).json({ message: 'Complete nome, CPF e endereço do responsável antes da emissão.' });
  // Acordo judicial ainda 'sent': o aceite é dispensado e registrado aqui, na
  // primeira emissão, para que as regras que partem de accepted_at (congelamento
  // dos débitos, rompimento por nova taxa vencida) valham a partir de agora.
  if (agreement.status === 'sent') {
    await query(`update debt_agreements set status='accepted',accepted_at=now(),updated_at=now() where id=$1 and status='sent'`, [agreement.id]);
    await logAudit(req, 'historico_acordos', 'updated', `Dispensou o aceite do responsável no acordo ${agreement.id.slice(0, 8).toUpperCase()} por se tratar de acordo judicial${agreement.judicial_process_number ? ` (processo ${agreement.judicial_process_number})` : ''}`, { entityId: agreement.id });
  }
  // Parcela cancelada sem boleto (canceled_at) não pode ser emitida.
  const installments = await query<any>(`select * from debt_agreement_installments where agreement_id=$1 and invoice_id is null and canceled_at is null order by installment_number`, [agreement.id]);
  const integration = await getInterIntegration(agreement.condominium_id); const issued = [];
  for (const installment of installments.rows) {
    const description = `Acordo ${agreement.id.slice(0, 8).toUpperCase()} - parcela ${installment.installment_number}/${agreement.installment_count}`;
    const boleto = await createInterBoleto({ payerName: agreement.full_name || agreement.username, payerDocument: agreement.cpf, amountCents: installment.amount_cents, dueDate: isoDate(installment.due_date), description, payerEmail: agreement.email, payerPhone: agreement.phone, payerStreet: agreement.street, payerNumber: agreement.address_number, payerComplement: agreement.address_complement, payerNeighborhood: agreement.neighborhood, payerCity: agreement.city, payerState: agreement.state, payerPostalCode: agreement.postal_code, payerUnit: agreement.unit }, integration);
    const invoiceId = randomUUID();
    await withTransaction(async client => { await client.query(`insert into invoices(id,condominium_id,user_id,amount_cents,due_date,status,provider,external_id,digitable_line,pdf_url,invoice_type,agreement_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'agreement',$11)`, [invoiceId, agreement.condominium_id, agreement.debtor_user_id, installment.amount_cents, installment.due_date, boleto.status === 'processing' ? 'issued' : 'pending_provider', boleto.provider, boleto.externalId, boleto.digitableLine, boleto.pdfUrl, agreement.id]); await client.query(`update debt_agreement_installments set invoice_id=$1 where id=$2`, [invoiceId, installment.id]); });
    await notifyNewInvoice({ id: invoiceId, condominiumId: agreement.condominium_id, userId: agreement.debtor_user_id, amountCents: installment.amount_cents, dueDate: isoDate(installment.due_date) });
    issued.push(invoiceId);
  }
  await query(`update debt_agreements set status='active',updated_at=now() where id=$1`, [agreement.id]);
  if (issued.length) await logAudit(req, 'historico_acordos', 'issued', `Emitiu ${issued.length} parcela(s) do acordo ${agreement.id.slice(0, 8).toUpperCase()}`, { entityId: agreement.id });
  return res.status(201).json({ issued: issued.length, message: `${issued.length} parcela(s) de acordo gerada(s).` });
}));

// Get history of agreements: todos os acordos do condomínio (abertos, ativos, cancelados, quitados, rompidos etc.)
router.get('/history', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const manager = ['sindico', 'subsindico'].includes(req.user?.role || '');
  const userId = req.user?.id as string;
  const ownedUnitIds = manager ? [] : await getOwnedUnitIds(userId);

  const result = await query<any>(`
    select a.*,
      coalesce(u.full_name, u.username) debtor_name,
      coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), u.unit, 'Sem apartamento') apartment,
      (a.unit_id = any($4::uuid[]) and a.debtor_user_id <> $3) owned_elsewhere,
      to_char(a.created_at, 'DD/MM/YYYY') agreement_date,
      to_char(a.accepted_at, 'DD/MM/YYYY') accepted_date,
      to_char(a.settled_at, 'DD/MM/YYYY') settled_date,
      to_char(a.canceled_all_boletos_at, 'DD/MM/YYYY') canceled_date,
      to_char(min(coalesce(oi.reference_month, oi.due_date)), 'MM/YYYY') first_reference_month,
      to_char(max(coalesce(oi.reference_month, oi.due_date)), 'MM/YYYY') last_reference_month,
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'id', p.id,
        'number', p.installment_number,
        'amountCents', p.amount_cents,
        'dueDate', p.due_date,
        'invoiceId', p.invoice_id,
        'status', pi.status,
        'cancellationReason', p.cancellation_reason,
        'canceledAt', p.canceled_at
      )) filter(where p.id is not null), '[]') installments
    from debt_agreements a
    join users u on u.id = a.debtor_user_id
    left join units un on un.id = a.unit_id
    left join blocks b on b.id = un.block_id
    left join debt_agreement_installments p on p.agreement_id = a.id
    left join invoices pi on pi.id = p.invoice_id
    left join debt_agreement_items ai on ai.agreement_id = a.id
    left join invoices oi on oi.id = ai.invoice_id
    where a.condominium_id=$1 and ($2::boolean or a.debtor_user_id=$3 or a.unit_id=(select unit_id from users where id=$3) or a.unit_id=any($4::uuid[]))
    group by a.id, u.full_name, u.username, u.unit, b.name, un.number
    order by a.updated_at desc
  `, [condominiumId, manager, userId, ownedUnitIds]);

  return res.json({ agreements: result.rows });
}));

// Get agreement with all details including justifications (role-based)
router.get('/:id/details', asyncHandler(async (req, res) => {
  const agreementId = String(req.params.id || '');
  const condominiumId = req.user?.condominiumId as string;
  const manager = ['sindico', 'subsindico'].includes(req.user?.role || '');
  const userId = req.user?.id as string;
  const ownedUnitIds = manager ? [] : await getOwnedUnitIds(userId);

  const result = await query<any>(`
    select a.*, ${judicialColumns},
      coalesce(u.full_name, u.username) debtor_name,
      coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), u.unit, 'Sem apartamento') apartment,
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'invoiceId', ai.invoice_id,
        'referenceMonth', coalesce(oi.reference_month, oi.due_date),
        'dueDate', oi.due_date,
        'principalCents', ai.principal_cents,
        'fineCents', ai.fine_cents,
        'interestCents', ai.interest_cents,
        'frozenTotalCents', ai.frozen_total_cents,
        'frozenAt', ai.frozen_at
      )) filter(where ai.invoice_id is not null), '[]') items,
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'id', p.id,
        'number', p.installment_number,
        'amountCents', p.amount_cents,
        'dueDate', p.due_date,
        'invoiceId', p.invoice_id,
        'status', pi.status,
        'cancellationReason', p.cancellation_reason,
        'canceledAt', p.canceled_at
      )) filter(where p.id is not null), '[]') installments
    from debt_agreements a
    join users u on u.id = a.debtor_user_id
    left join units un on un.id = a.unit_id
    left join blocks b on b.id = un.block_id
    left join debt_agreement_items ai on ai.agreement_id = a.id
    left join invoices oi on oi.id = ai.invoice_id
    left join debt_agreement_installments p on p.agreement_id = a.id
    left join invoices pi on pi.id = p.invoice_id
    where a.id=$1 and a.condominium_id=$2 and (${manager ? 'true' : 'a.debtor_user_id=$3 or (a.unit_id is not null and exists(select 1 from users where id=$3 and unit_id=a.unit_id and login_enabled=true)) or a.unit_id=any($4::uuid[])'})
    group by a.id, u.full_name, u.username, u.unit, b.name, un.number
  `, manager ? [agreementId, condominiumId] : [agreementId, condominiumId, userId, ownedUnitIds]);

  if (!result.rows.length) {
    return res.status(403).json({ error: 'Acesso negado ao acordo' });
  }

  return res.json(result.rows[0]);
}));

// Mark agreement with all boletos canceled and optionally recalculate value
router.post('/:id/mark-all-canceled', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const agreementId = String(req.params.id || '');
  const cancellationReason = String(req.body?.cancellationReason || '');
  const recalculateValue = req.body?.recalculateValue === true;

  // Get agreement and check if all installments are canceled (ou nunca chegaram a ser emitidas)
  const result = await query<any>(`
    select a.*,
      coalesce(jsonb_agg(distinct jsonb_build_object('status',pi.status,'amountCents',p.amount_cents,'invoiceId',p.invoice_id))
        filter(where p.id is not null),'[]') installments
    from debt_agreements a
    left join debt_agreement_installments p on p.agreement_id=a.id
    left join invoices pi on pi.id=p.invoice_id
    where a.id=$1 and a.condominium_id=$2
    group by a.id
  `, [agreementId, condominiumId]);

  if (!result.rows.length) return res.status(404).json({ error: 'Acordo não encontrado' });

  const agreement = result.rows[0];
  const installments = agreement.installments || [];
  // Uma parcela nunca emitida (sem boleto) não tem status (invoiceId nulo) — conta como
  // "resolvida" para fins de cancelamento, já que não há boleto em aberto no banco.
  const allCanceled = installments.every((inst: any) => !inst.invoiceId || inst.status === 'canceled');

  if (!allCanceled) {
    return res.status(400).json({ error: 'Nem todos os boletos estão cancelados' });
  }

  // Calculate recalculated value if requested
  let recalculatedTotalCents = agreement.negotiated_total_cents;
  let daysLate = 0;
  const billingRules = await getBillingRules(condominiumId);
  const finePercent = billingRules.fineType === 'PERCENT' ? billingRules.fineValue / 100 : 0;
  const dailyInterestPercent = billingRules.interestType === 'PERCENT_MONTH' ? billingRules.interestValue / 100 / 30 : 0;

  if (recalculateValue) {
    try {
      // Get original debt items to recalculate
      const items = await query<any>(`
        select ai.principal_cents, oi.due_date
        from debt_agreement_items ai
        join invoices oi on oi.id=ai.invoice_id
        where ai.agreement_id=$1
        order by oi.due_date desc
        limit 1
      `, [agreementId]);

      if (items.rows.length > 0) {
        const lastDueDate = items.rows[0].due_date;
        const today = isoDate(new Date());
        daysLate = daysBetween(lastDueDate, today);

        const principalCents = items.rows[0].principal_cents;
        const { fineCents, interestCents } = calculateLateFee(billingRules, principalCents, daysLate);
        recalculatedTotalCents = principalCents + fineCents + interestCents;
      } else {
        // If no items, use the negotiated total as principal
        const today = isoDate(new Date());
        daysLate = daysBetween(agreement.first_due_date, today);
        const principalCents = agreement.negotiated_total_cents;
        const { fineCents, interestCents } = calculateLateFee(billingRules, principalCents, daysLate);
        recalculatedTotalCents = principalCents + fineCents + interestCents;
      }
    } catch (error) {
      console.error('Recalculation error:', error);
      // If recalculation fails, just use negotiated total
      recalculatedTotalCents = agreement.negotiated_total_cents;
    }
  }

  // Update agreement
  await query(`
    update debt_agreements
    set status='canceled',
        canceled_all_boletos_at=now(),
        cancellation_reason=$1,
        recalculated_total_cents=$2,
        days_late_at_cancellation=$3,
        fine_percent_at_cancellation=$4,
        daily_interest_percent_at_cancellation=$5,
        deleted_at=now(),
        deleted_by=$7,
        updated_at=now()
    where id=$6
  `, [
    cancellationReason || null,
    recalculateValue ? recalculatedTotalCents : null,
    daysLate || null,
    finePercent || null,
    dailyInterestPercent || null,
    agreementId,
    req.user?.id,
  ]);

  await logAudit(req, 'historico_acordos', 'canceled', `Cancelou o acordo ${agreementId.slice(0, 8).toUpperCase()}: ${cancellationReason || 'sem motivo informado'}`, { entityId: agreementId });
  return res.json({
    message: 'Acordo marcado como cancelado',
    recalculatedTotal: recalculatedTotalCents,
    daysLate,
    finePercent,
    dailyInterestPercent
  });
}));

// Edição geral da proposta (observação, validade) — só enquanto ainda é
// rascunho. Depois de enviada o responsável já viu as condições; renegociar
// significa cancelar e criar uma nova proposta.
router.patch('/:id', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const agreementId = String(req.params.id || '');

  const result = await query<any>(`select * from debt_agreements where id=$1 and condominium_id=$2`, [agreementId, condominiumId]);
  const agreement = result.rows[0];
  if (!agreement) return res.status(404).json({ message: 'Acordo não encontrado.' });
  if (agreement.status !== 'draft') return res.status(409).json({ message: 'Só é possível editar propostas ainda em rascunho. Depois de enviada, cancele e crie uma nova proposta.' });

  const notes = req.body?.notes !== undefined ? (String(req.body.notes).trim() || null) : agreement.notes;
  const validUntil = req.body?.validUntil !== undefined ? (req.body.validUntil ? String(req.body.validUntil) : null) : agreement.valid_until;
  if (validUntil !== null && !isValidDate(validUntil)) return res.status(400).json({ message: 'Informe uma data de validade válida.' });

  const updated = await query<any>(`update debt_agreements set notes=$1,valid_until=$2,updated_at=now() where id=$3 returning *`, [notes, validUntil, agreementId]);
  await logAudit(req, 'historico_acordos', 'updated', `Editou a proposta de acordo ${agreementId.slice(0, 8).toUpperCase()}`, { entityId: agreementId });
  return res.json({ agreement: updated.rows[0], message: 'Proposta atualizada.' });
}));

// Edita a composição do acordo: dívida original − valor pago até o momento −
// redução negociada = valor em aberto (negotiated_total_cents, o que as
// parcelas somam). Existe porque a dívida muitas vezes entra no sistema depois
// da negociação, com parte já paga — e esse pagamento não é desconto.
//
// Sem boleto emitido: o valor em aberto pode mudar e as parcelas são refeitas
// (quantidade e primeiro vencimento também podem mudar). Se o responsável já
// tinha aceitado e as condições mudaram, o acordo volta a aguardar aceite —
// exceto o judicial, que dispensa aceite.
// Com boleto emitido: o valor em aberto fica travado; só dá para corrigir a
// dívida original e quanto da diferença foi pagamento e quanto foi redução.
//
// A dívida original só é editável no acordo de débito antigo (legacyColumn);
// a correção também vai para o débito lançado, com registro em
// invoice_adjustments, para ele não divergir do acordo se este for desfeito.
router.put('/:id/terms', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const agreementId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Informe o motivo da edição do acordo.' });

  const result = await query<any>(`select a.*,${judicialColumns},${legacyColumn} from debt_agreements a where a.id=$1 and a.condominium_id=$2`, [agreementId, condominiumId]);
  const agreement = result.rows[0];
  if (!agreement) return res.status(404).json({ message: 'Acordo não encontrado.' });
  if (!['draft', 'sent', 'accepted', 'active', 'at_risk'].includes(agreement.status) || agreement.cancellation_reason) {
    return res.status(409).json({ message: 'Este acordo está encerrado e não pode mais ser editado.' });
  }

  const previousOriginal = Number(agreement.original_total_cents);
  const original = Math.round(Number(req.body?.originalTotalCents ?? previousOriginal));
  if (!Number.isInteger(original) || original <= 0) return res.status(400).json({ message: 'Informe uma dívida original válida.' });
  if (original !== previousOriginal && !agreement.legacy_invoice_id) return res.status(409).json({ message: 'A dívida original deste acordo é a soma dos débitos incluídos e não pode ser alterada aqui.' });
  const paidBefore = Math.round(Number(req.body?.paidBeforeCents ?? agreement.paid_before_cents));
  const discount = Math.round(Number(req.body?.discountCents ?? agreement.discount_cents));
  if (!Number.isInteger(paidBefore) || paidBefore < 0) return res.status(400).json({ message: 'Informe um valor pago até o momento válido.' });
  if (!Number.isInteger(discount) || discount < 0) return res.status(400).json({ message: 'Informe uma redução negociada válida.' });
  const open = original - paidBefore - discount;
  if (open <= 0) return res.status(400).json({ message: `Valor pago e redução somam ${money(paidBefore + discount)}, o que não deixa valor em aberto sobre a dívida original de ${money(original)}.` });

  const previousOpen = Number(agreement.negotiated_total_cents);
  const installments = await query<any>(`select id,invoice_id from debt_agreement_installments where agreement_id=$1`, [agreementId]);
  const hasIssued = installments.rows.some((row: any) => row.invoice_id);
  const code = agreementId.slice(0, 8).toUpperCase();
  // Mantém o débito antigo igual ao acordo: principal = dívida original e
  // total congelado = valor em aberto (é o que Gestão de débitos soma).
  const syncLegacyDebt = async (client: { query: (text: string, params?: unknown[]) => Promise<unknown> }) => {
    if (!agreement.legacy_invoice_id) return;
    await client.query(`update debt_agreement_items set principal_cents=$1,frozen_total_cents=$2 where agreement_id=$3`, [original, open, agreementId]);
    if (original === previousOriginal) return;
    await client.query(
      `insert into invoice_adjustments(invoice_id,condominium_id,type,amount_cents,previous_amount_cents,previous_due_date,previous_status,reason,created_by)
       select id,condominium_id,'edit',$2::int,amount_cents,due_date,status,$3::text,$4::uuid from invoices where id=$1`,
      [agreement.legacy_invoice_id, original, `Dívida original corrigida na edição do acordo ${code}: ${reason}`, req.user?.id],
    );
    await client.query(`update invoices set amount_cents=$1 where id=$2`, [original, agreement.legacy_invoice_id]);
  };
  const summary = `original ${money(previousOriginal)} → ${money(original)}, pago ${money(Number(agreement.paid_before_cents))} → ${money(paidBefore)}, redução ${money(Number(agreement.discount_cents))} → ${money(discount)}, em aberto ${money(previousOpen)} → ${money(open)}`;

  if (hasIssued) {
    if (open !== previousOpen) return res.status(409).json({ message: `Este acordo já tem boleto emitido, então o valor em aberto (${money(previousOpen)}) não pode mudar. Ajuste os valores de forma que dívida original − valor pago − redução continue ${money(previousOpen)}.` });
    await withTransaction(async client => {
      await client.query(`update debt_agreements set original_total_cents=$1,paid_before_cents=$2,discount_cents=$3,updated_at=now() where id=$4`, [original, paidBefore, discount, agreementId]);
      await syncLegacyDebt(client);
    });
    await logAudit(req, 'historico_acordos', 'updated', `Editou o acordo ${code} (${summary}). Motivo: ${reason}`, { entityId: agreementId });
    return res.json({ message: 'Acordo atualizado.' });
  }

  const installmentCount = Number(req.body?.installmentCount ?? agreement.installment_count);
  const firstDueDate = String(req.body?.firstDueDate ?? isoDate(agreement.first_due_date));
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60) return res.status(400).json({ message: 'Informe a quantidade de parcelas (1 a 60).' });
  if (!isValidDate(firstDueDate)) return res.status(400).json({ message: 'Informe um primeiro vencimento válido.' });
  if (open < installmentCount) return res.status(400).json({ message: 'O valor em aberto é pequeno demais para essa quantidade de parcelas.' });

  const conditionsChanged = open !== previousOpen || installmentCount !== Number(agreement.installment_count) || firstDueDate !== isoDate(agreement.first_due_date);
  const needsNewAcceptance = conditionsChanged && agreement.status === 'accepted' && !agreement.judicial;

  await withTransaction(async client => {
    await client.query(
      `update debt_agreements set paid_before_cents=$1,discount_cents=$2,negotiated_total_cents=$3,installment_count=$4,first_due_date=$5,original_total_cents=$7,updated_at=now()${needsNewAcceptance ? `,status='sent',sent_at=now(),accepted_at=null,accepted_by=null` : ''} where id=$6`,
      [paidBefore, discount, open, installmentCount, firstDueDate, agreementId, original],
    );
    await syncLegacyDebt(client);
    if (!conditionsChanged) return;
    await client.query(`delete from debt_agreement_installments where agreement_id=$1`, [agreementId]);
    for (let index = 0; index < installmentCount; index++) {
      const base = Math.floor(open / installmentCount);
      const amount = base + (index === installmentCount - 1 ? open - base * installmentCount : 0);
      await client.query(`insert into debt_agreement_installments(id,agreement_id,installment_number,amount_cents,due_date) values($1,$2,$3,$4,$5)`, [randomUUID(), agreementId, index + 1, amount, addMonths(firstDueDate, index)]);
    }
  });

  if (conditionsChanged && ['sent', 'accepted'].includes(agreement.status)) {
    const recipients = await recipientsFor(condominiumId, agreement.debtor_user_id, agreement.unit_id);
    const body = `As condições do acordo ${code} foram atualizadas: ${money(open)} em aberto, em ${installmentCount} parcela(s), com primeiro vencimento em ${firstDueDate.split('-').reverse().join('/')}.${agreement.judicial ? '' : ' Acesse o aplicativo para consultar e aceitar.'}`;
    await notify({ condominiumId, senderId: req.user?.id as string, recipients, title: 'Acordo de débito atualizado', body });
  }
  await logAudit(req, 'historico_acordos', 'updated', `Editou o acordo ${code} (${summary}; ${installmentCount} parcela(s), 1º vencimento ${firstDueDate}). Motivo: ${reason}`, { entityId: agreementId });
  return res.json({ message: needsNewAcceptance ? 'Acordo atualizado. Como as condições mudaram, o responsável precisa aceitar novamente.' : 'Acordo atualizado.' });
}));

// Edita valor/vencimento de uma parcela que ainda não foi emitida no banco
// (exclusão/edição parcial do acordo, nível de 1 parcela).
router.patch('/:id/installments/:installmentId', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const agreementId = String(req.params.id || '');
  const installmentId = String(req.params.installmentId || '');

  const result = await query<any>(
    `select p.* from debt_agreement_installments p join debt_agreements a on a.id=p.agreement_id where p.id=$1 and p.agreement_id=$2 and a.condominium_id=$3`,
    [installmentId, agreementId, condominiumId],
  );
  const installment = result.rows[0];
  if (!installment) return res.status(404).json({ message: 'Parcela não encontrada.' });
  if (installment.invoice_id) return res.status(409).json({ message: 'Esta parcela já foi emitida; não é possível editar valor ou vencimento.' });
  if (installment.canceled_at) return res.status(409).json({ message: 'Esta parcela está cancelada.' });

  const nextAmountCents = req.body?.amountCents !== undefined ? Math.round(Number(req.body.amountCents)) : Number(installment.amount_cents);
  if (!Number.isInteger(nextAmountCents) || nextAmountCents <= 0) return res.status(400).json({ message: 'Informe um valor de parcela válido.' });
  const nextDueDate = req.body?.dueDate !== undefined ? String(req.body.dueDate) : isoDate(installment.due_date);
  if (!isValidDate(nextDueDate)) return res.status(400).json({ message: 'Informe uma data de vencimento válida.' });

  const updated = await query<any>(`update debt_agreement_installments set amount_cents=$1,due_date=$2 where id=$3 returning *`, [nextAmountCents, nextDueDate, installmentId]);
  await logAudit(req, 'historico_acordos', 'updated', `Editou uma parcela do acordo ${agreementId.slice(0, 8).toUpperCase()}`, { entityId: agreementId });
  return res.json({ installment: updated.rows[0], message: 'Parcela atualizada.' });
}));

// Cancela uma única parcela (exclusão parcial do acordo), sem exigir que
// todas as outras já estejam resolvidas. Só bloqueia se essa parcela
// especificamente tiver um boleto em aberto no banco.
router.delete('/:id/installments/:installmentId', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const agreementId = String(req.params.id || '');
  const installmentId = String(req.params.installmentId || '');
  const reason = String(req.body?.cancellationReason || req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Informe o motivo do cancelamento da parcela.' });

  const result = await query<any>(
    `select p.*, i.status invoice_status from debt_agreement_installments p
     join debt_agreements a on a.id=p.agreement_id
     left join invoices i on i.id=p.invoice_id
     where p.id=$1 and p.agreement_id=$2 and a.condominium_id=$3`,
    [installmentId, agreementId, condominiumId],
  );
  const installment = result.rows[0];
  if (!installment) return res.status(404).json({ message: 'Parcela não encontrada.' });
  if (installment.canceled_at) return res.status(409).json({ message: 'Esta parcela já está cancelada.' });
  if (installment.invoice_id && !['paid', 'canceled'].includes(installment.invoice_status)) {
    return res.status(409).json({ message: 'Não é possível cancelar: esta parcela tem boleto em aberto.' });
  }

  await query(
    `update debt_agreement_installments set cancellation_reason=$1,canceled_at=now(),canceled_by=$2 where id=$3`,
    [reason, req.user?.id, installmentId],
  );

  await logAudit(req, 'historico_acordos', 'deleted', `Cancelou uma parcela do acordo ${agreementId.slice(0, 8).toUpperCase()}: ${reason}`, { entityId: agreementId });
  return res.json({ message: 'Parcela cancelada.' });
}));

export default router;
