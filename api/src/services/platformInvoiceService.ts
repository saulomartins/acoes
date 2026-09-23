import { randomUUID } from 'crypto';
import { query } from '../db';
import { computePlanAmountCents, computeIncludedOverage, countActiveUsers, type PlatformPlan, type PlatformPlanTier } from './platformPlanService';
import { notifyUsers } from './notificationService';
import { sendPlatformInvoiceEmail, sendPlatformInvoiceReceiptEmail, sendPlatformInvoiceReminderEmail, sendPlatformInvoiceCanceledEmail, type PlatformInvoicePlanDetail, type PlatformInvoicePix } from './emailService';
import { sendPushNotification } from './notificationService';
import { isMercadoPagoConfigured, createPixCharge, getOrder, cancelOrder } from './mercadoPagoService';

// Prazo de pagamento contado a partir da geração da fatura — assim nenhuma
// fatura já nasce atrasada, mesmo gerada no meio do mês. O Pix vale mais
// que o vencimento pra quem atrasar ainda conseguir pagar pelo mesmo código.
export const PLATFORM_INVOICE_DUE_DAYS = 10;
const PLATFORM_PIX_VALID_DAYS = 30;

type SettleOptions = { method?: 'pix_mercadopago' | 'manual'; note?: string | null; confirmedBy?: string | null };
type InvoiceRow = { id: string; condominium_id: string; reference_month: string; amount_cents: number };

// Manda o recibo pra síndicos/subsíndicos do condomínio da fatura.
const sendReceiptEmails = async (row: InvoiceRow) => {
  const condo = await query<{ name: string }>(`select name from condominiums where id=$1`, [row.condominium_id]);
  const managers = await query<{ full_name: string | null; username: string; email: string | null }>(
    `select full_name, username, email from users where condominium_id=$1 and role in ('sindico','subsindico') and deleted_at is null`,
    [row.condominium_id],
  );
  for (const manager of managers.rows) {
    if (!manager.email) continue;
    try {
      await sendPlatformInvoiceReceiptEmail(manager.email, manager.full_name || manager.username, condo.rows[0]?.name || '', new Date(row.reference_month), row.amount_cents);
    } catch (error) {
      console.warn('platform invoice receipt email failed', error);
    }
  }
};

// Marca a fatura como paga e manda o recibo — uma única vez, mesmo que
// webhook, reconciliação e confirmação manual aconteçam ao mesmo tempo: o
// recibo só é enviado por quem conseguir "reivindicar" receipt_sent_at
// (update condicional).
export const settlePlatformInvoiceById = async (invoiceId: string, options: SettleOptions = {}): Promise<boolean> => {
  const current = await query<{ status: string }>(`select status from platform_invoices where id=$1`, [invoiceId]);
  if (!current.rows[0]) return false;
  if (current.rows[0].status === 'canceled') {
    // Dinheiro entrou numa fatura já cancelada (ex.: o cancelamento do Pix no
    // Mercado Pago falhou e o síndico pagou mesmo assim) — não reabre a
    // fatura, só levanta o alerta no painel pro admin reembolsar.
    await query(`update platform_invoices set paid_after_canceled_at=coalesce(paid_after_canceled_at, now()) where id=$1`, [invoiceId]);
    console.warn('platform invoice paid after cancellation', { invoiceId });
    return false;
  }
  if (current.rows[0].status === 'refunded') return false;
  const invoice = await query<InvoiceRow>(
    `update platform_invoices set status='paid', paid_at=coalesce(paid_at, now()),
       payment_method=coalesce(payment_method, $2), manual_note=coalesce($3, manual_note), confirmed_by=coalesce($4, confirmed_by)
     where id=$1 returning id, condominium_id, reference_month, amount_cents`,
    [invoiceId, options.method || 'pix_mercadopago', options.note || null, options.confirmedBy || null],
  );
  const row = invoice.rows[0];
  if (!row) return false;

  const claimed = await query(`update platform_invoices set receipt_sent_at=now() where id=$1 and receipt_sent_at is null returning id`, [row.id]);
  if (claimed.rows.length) await sendReceiptEmails(row);
  return true;
};

// Reenvio manual do recibo (painel de Recebimentos) — só de fatura já paga.
export const resendPlatformInvoiceReceipt = async (invoiceId: string): Promise<boolean> => {
  const invoice = await query<InvoiceRow>(
    `select id, condominium_id, reference_month, amount_cents from platform_invoices where id=$1 and status='paid'`,
    [invoiceId],
  );
  if (!invoice.rows[0]) return false;
  await sendReceiptEmails(invoice.rows[0]);
  await query(`update platform_invoices set receipt_sent_at=now() where id=$1`, [invoiceId]);
  return true;
};

// Confirma o pagamento a partir do id da order do Mercado Pago (webhook e
// reconciliação).
export const settlePlatformInvoicePayment = async (orderId: string): Promise<boolean> => {
  const invoice = await query<{ id: string }>(`select id from platform_invoices where pix_payment_id=$1`, [orderId]);
  return invoice.rows[0] ? settlePlatformInvoiceById(invoice.rows[0].id) : false;
};

// Consulta uma fatura específica no Mercado Pago (botão "Verificar" do painel).
export const verifyPlatformInvoice = async (invoiceId: string): Promise<{ status: string; paid: boolean; providerStatus: string | null; providerDetail: string | null } | null> => {
  const invoice = await query<{ status: string; pix_payment_id: string | null }>(`select status, pix_payment_id from platform_invoices where id=$1`, [invoiceId]);
  const row = invoice.rows[0];
  if (!row || !row.pix_payment_id) return null;
  const order = await getOrder(row.pix_payment_id);
  if (order.paid) await settlePlatformInvoiceById(invoiceId);
  const after = await query<{ status: string }>(`select status from platform_invoices where id=$1`, [invoiceId]);
  return { status: after.rows[0].status, paid: order.paid, providerStatus: order.status, providerDetail: order.statusDetail };
};

// Rede de segurança do webhook: consulta no Mercado Pago o status de toda
// fatura com Pix criado e ainda não paga (ou só as de um condomínio) e
// confirma as que já foram pagas. Cobre webhook que não chegou (servidor
// fora do ar, URL não cadastrada, MP sem alcançar localhost etc.). Nunca
// lança — uma consulta que falha não impede as outras.
export const reconcilePlatformInvoices = async (condominiumId?: string): Promise<{ checked: number; paid: number }> => {
  if (!isMercadoPagoConfigured()) return { checked: 0, paid: 0 };
  const pending = await query<{ pix_payment_id: string }>(
    `select pix_payment_id from platform_invoices
     where pix_payment_id is not null and ($1::uuid is null or condominium_id=$1)
       and (status in ('pending','sent') or (status='canceled' and paid_after_canceled_at is null and canceled_at > now() - interval '60 days'))`,
    [condominiumId || null],
  );
  let paid = 0;
  for (const row of pending.rows) {
    try {
      const order = await getOrder(row.pix_payment_id);
      if (order.paid && await settlePlatformInvoicePayment(order.id)) paid += 1;
    } catch (error) {
      console.warn('platform invoice reconcile failed', { orderId: row.pix_payment_id, error });
    }
  }
  return { checked: pending.rows.length, paid };
};

// Monta o detalhe do plano pro e-mail (ver planDetailRows em
// emailService.ts) a partir do plano e das faixas já carregados — mesma
// lógica de computePlanAmountCents, só reorganizada pra explicar a conta
// em vez de só devolver o total.
const buildPlanDetail = (plan: PlatformPlan, tiers: PlatformPlanTier[], activeUsers: number): PlatformInvoicePlanDetail => {
  if (plan.plan_type === 'included_overage') {
    const overage = computeIncludedOverage(plan, activeUsers);
    return {
      type: 'included_overage',
      includedQuantity: plan.included_quantity || 0,
      basePriceCents: plan.base_price_cents || 0,
      overagePriceCents: plan.overage_price_cents || 0,
      overageUnits: overage.overageUnits,
      overageAmountCents: overage.overageAmountCents,
    };
  }
  if (plan.plan_type === 'per_active_user') {
    return {
      type: 'per_active_user',
      priceCentsPerUser: plan.price_per_active_user_cents || 0,
      minimumPriceCents: plan.minimum_price_cents,
    };
  }
  const tier = tiers.find(item => activeUsers >= item.min_active_users && (item.max_active_users === null || activeUsers <= item.max_active_users));
  return { type: 'tiered_bracket', tierMin: tier?.min_active_users ?? 0, tierMax: tier?.max_active_users ?? null };
};

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMonthLabel = (referenceMonth: Date) =>
  referenceMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

type Manager = { id: string; full_name: string | null; email: string | null; cpf: string | null };

// Cria a cobrança Pix da fatura e guarda no banco — uma só, compartilhada
// entre síndico e subsíndico (qualquer um paga). O pagador é o primeiro
// gestor com e-mail cadastrado. Devolve null (sem lançar) quando o Mercado
// Pago não está configurado, não há e-mail de gestor ou a criação falha —
// nesses casos o e-mail da fatura sai só informativo, e o admin pode gerar
// o Pix depois pelo painel de Recebimentos.
const createAndStorePix = async (
  invoiceId: string, condominiumName: string, referenceMonth: Date, amountCents: number, managers: Manager[], idempotencyKey?: string,
): Promise<PlatformInvoicePix | null> => {
  const payer = managers.find(m => m.email);
  if (!isMercadoPagoConfigured() || !payer?.email) return null;
  try {
    const [firstName, ...rest] = (payer.full_name || '').trim().split(/\s+/);
    const charge = await createPixCharge({
      amountCents,
      description: `Assinatura Lar em Dia — ${condominiumName} — ${formatMonthLabel(referenceMonth)}`,
      externalReference: invoiceId,
      idempotencyKey,
      expiresInDays: PLATFORM_PIX_VALID_DAYS,
      payerEmail: payer.email,
      payerFirstName: firstName || undefined,
      payerLastName: rest.length ? rest.join(' ') : undefined,
      payerDocument: payer.cpf,
    });
    await query(
      `update platform_invoices set pix_payment_id=$2, pix_copy_paste=$3, pix_qr_code_base64=$4, pix_expires_at=$5 where id=$1`,
      [invoiceId, charge.id, charge.copyPaste, charge.qrCodeBase64, charge.expiresAt],
    );
    return { copyPaste: charge.copyPaste || '', expiresAt: charge.expiresAt };
  } catch (error) {
    console.warn('platform invoice pix charge failed', error);
    return null;
  }
};

const loadManagers = async (condominiumId: string) => (await query<Manager>(
  `select id, full_name, email, cpf from users where condominium_id=$1 and role in ('sindico','subsindico') and deleted_at is null`,
  [condominiumId],
)).rows;

// Gera a fatura da plataforma de UM condomínio — chamada pelo job diário e pelo
// botão "Gerar faturas" do painel de Recebimentos (admin geral), nunca por login.
// Gera e envia a fatura da plataforma do mês corrente se, e só se, a data de
// início de cobrança do condomínio (billing_starts_at) já passou e ainda não
// existe fatura para esse mês — a unique constraint em platform_invoices
// impede duplicar o envio quando essa checagem roda em vários logins.
export const checkAndSendPlatformInvoice = async (condominiumId: string): Promise<boolean> => {
  const condo = await query<{ platform_status: string; name: string }>(
    `select platform_status, name from condominiums where id=$1`,
    [condominiumId],
  );
  if (!condo.rows[0] || condo.rows[0].platform_status !== 'active') return false;

  const sub = await query<{ id: string; plan_id: string; billing_starts_at: string }>(
    `select id, plan_id, to_char(billing_starts_at, 'YYYY-MM-DD') as billing_starts_at
     from condominium_plan_subscriptions where condominium_id=$1 and ended_at is null`,
    [condominiumId],
  );
  const subscription = sub.rows[0];
  if (!subscription) return false;
  if (new Date(`${subscription.billing_starts_at}T00:00:00Z`) > new Date()) return false; // ainda em adaptação

  const planResult = await query<PlatformPlan & { name: string }>(`select * from platform_plans where id=$1`, [subscription.plan_id]);
  const plan = planResult.rows[0];
  if (!plan) return false;
  const tiers = await query<PlatformPlanTier>(`select * from platform_plan_tiers where plan_id=$1 order by min_active_users asc`, [subscription.plan_id]);

  const activeUsers = await countActiveUsers(condominiumId, plan.active_user_metric);
  const amountCents = computePlanAmountCents(plan, tiers.rows, activeUsers);
  const planDetail = buildPlanDetail(plan, tiers.rows, activeUsers);

  const referenceMonth = new Date();
  referenceMonth.setUTCDate(1);
  const referenceMonthIso = referenceMonth.toISOString().slice(0, 10);

  let invoiceId: string;
  try {
    const inserted = await query<{ id: string }>(
      `insert into platform_invoices (id, condominium_id, plan_id, reference_month, active_users, amount_cents, due_date)
       values ($1,$2,$3,$4,$5,$6, current_date + $7::int) returning id`,
      [randomUUID(), condominiumId, subscription.plan_id, referenceMonthIso, activeUsers, amountCents, PLATFORM_INVOICE_DUE_DAYS],
    );
    invoiceId = inserted.rows[0].id;
  } catch (error: any) {
    if (error?.code === '23505') return false; // já existe fatura desse mês para este condomínio
    throw error;
  }

  const managers = await loadManagers(condominiumId);
  const pix = await createAndStorePix(invoiceId, condo.rows[0].name, referenceMonth, amountCents, managers);
  const dueDate = new Date((await query<{ due_date: string }>(`select to_char(due_date,'YYYY-MM-DD') as due_date from platform_invoices where id=$1`, [invoiceId])).rows[0].due_date + 'T00:00:00Z');

  const title = 'Fatura da plataforma disponível';
  const body = `A fatura de ${formatMonthLabel(referenceMonth)} do condomínio ${condo.rows[0].name} já está disponível: ${formatCurrency(amountCents)} (${activeUsers} usuário(s) ativo(s)), com vencimento em ${dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}. Veja e pague pelo Pix na tela Início.`;

  const notificationId = randomUUID();
  await query(
    `insert into notifications(id,condominium_id,title,body,provider_status,audience_type) values($1,$2,$3,$4,'pending','personal')`,
    [notificationId, condominiumId, title, body],
  );
  for (const manager of managers) {
    await query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, manager.id]);
    if (manager.email) {
      try {
        await sendPlatformInvoiceEmail(manager.email, manager.full_name || '', condo.rows[0].name, plan.name, planDetail, referenceMonth, amountCents, activeUsers, pix, dueDate);
      } catch (error) {
        console.warn('platform invoice email failed', error);
      }
    }
  }

  try {
    const devices = await query<{ fcm_token: string }>(
      `select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`,
      [managers.map(m => m.id)],
    );
    await sendPushNotification({ tokens: devices.rows.map(d => d.fcm_token), title, body, data: { screen: 'Home' } });
  } catch (error) {
    console.warn('platform invoice push failed', error);
  }

  await query(`update platform_invoices set status='sent', sent_at=now() where id=$1`, [invoiceId]);
  return true;
};

// Gera as faturas do mês de TODOS os condomínios com plano vinculado e
// cobrança já iniciada (job diário e botão "Gerar faturas" do admin geral).
// Idempotente: quem já tem fatura do mês é ignorado. Uma falha em um
// condomínio não impede os outros.
export const generatePlatformInvoices = async (): Promise<{ created: number; skipped: number; failed: number }> => {
  const condos = await query<{ condominium_id: string }>(
    `select s.condominium_id from condominium_plan_subscriptions s
     join condominiums c on c.id = s.condominium_id
     where s.ended_at is null and c.platform_status = 'active'`,
  );
  const result = { created: 0, skipped: 0, failed: 0 };
  for (const row of condos.rows) {
    try {
      if (await checkAndSendPlatformInvoice(row.condominium_id)) result.created += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      console.warn('platform invoice generation failed', { condominiumId: row.condominium_id, error });
    }
  }
  return result;
};

// Gera um Pix (novo) para uma fatura em aberto — cobre fatura criada sem
// Pix (Mercado Pago ainda não configurado, falha na emissão) e Pix
// expirado — e reenvia o e-mail da fatura, agora com o código de pagamento.
export const reissuePlatformInvoicePix = async (invoiceId: string): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (!isMercadoPagoConfigured()) return { ok: false, message: 'Mercado Pago não está configurado (MERCADOPAGO_ACCESS_TOKEN).' };
  const invoice = await query<{ id: string; condominium_id: string; plan_id: string; reference_month: string; active_users: number; amount_cents: number; status: string; due_date: string | null }>(
    `select id, condominium_id, plan_id, reference_month, active_users, amount_cents, status, to_char(due_date,'YYYY-MM-DD') as due_date from platform_invoices where id=$1`,
    [invoiceId],
  );
  const row = invoice.rows[0];
  if (!row) return { ok: false, message: 'Fatura não encontrada.' };
  if (row.status !== 'pending' && row.status !== 'sent') return { ok: false, message: 'Só é possível gerar Pix para fatura em aberto.' };

  const managers = await loadManagers(row.condominium_id);
  if (!managers.some(m => m.email)) return { ok: false, message: 'Nenhum síndico/subsíndico do condomínio tem e-mail cadastrado.' };

  const condo = await query<{ name: string }>(`select name from condominiums where id=$1`, [row.condominium_id]);
  const referenceMonth = new Date(row.reference_month);
  const pix = await createAndStorePix(invoiceId, condo.rows[0]?.name || '', referenceMonth, row.amount_cents, managers, `${invoiceId}-${Date.now()}`);
  if (!pix) return { ok: false, message: 'O Mercado Pago recusou a criação do Pix. Veja o log da API para o motivo.' };

  const plan = (await query<PlatformPlan & { name: string }>(`select * from platform_plans where id=$1`, [row.plan_id])).rows[0];
  if (plan) {
    const tiers = await query<PlatformPlanTier>(`select * from platform_plan_tiers where plan_id=$1 order by min_active_users asc`, [row.plan_id]);
    const planDetail = buildPlanDetail(plan, tiers.rows, row.active_users);
    for (const manager of managers) {
      if (!manager.email) continue;
      try {
        await sendPlatformInvoiceEmail(manager.email, manager.full_name || '', condo.rows[0]?.name || '', plan.name, planDetail, referenceMonth, row.amount_cents, row.active_users, pix, row.due_date ? new Date(`${row.due_date}T00:00:00Z`) : null);
      } catch (error) {
        console.warn('platform invoice email failed', error);
      }
    }
  }
  await query(`update platform_invoices set status='sent', sent_at=coalesce(sent_at, now()) where id=$1`, [invoiceId]);
  return { ok: true };
};

// Lembretes das faturas da plataforma (job diário): "vence em 3 dias" e
// "em atraso" — cada um no máximo uma vez por fatura (marcadores
// due_soon_notified_at / overdue_notified_at), por e-mail e aviso no app pra
// síndico e subsíndico. Só avisa; nada é bloqueado. Nunca lança.
export const notifyPlatformInvoiceReminders = async (): Promise<{ dueSoon: number; overdue: number }> => {
  const counts = { dueSoon: 0, overdue: 0 };
  const run = async (kind: 'due_soon' | 'overdue', filter: string, marker: string) => {
    const claimed = await query<{ id: string; condominium_id: string; reference_month: string; amount_cents: number; due_date: string; pix_copy_paste: string | null; pix_expires_at: string | null }>(
      `update platform_invoices set ${marker}=now()
       where status in ('pending','sent') and ${marker} is null and ${filter}
       returning id, condominium_id, reference_month, amount_cents, to_char(due_date,'YYYY-MM-DD') as due_date, pix_copy_paste, pix_expires_at`,
    );
    for (const row of claimed.rows) {
      try {
        const managers = await loadManagers(row.condominium_id);
        const condo = await query<{ name: string }>(`select name from condominiums where id=$1`, [row.condominium_id]);
        const referenceMonth = new Date(row.reference_month);
        const dueDate = new Date(`${row.due_date}T00:00:00Z`);
        const pix = row.pix_copy_paste ? { copyPaste: row.pix_copy_paste, expiresAt: row.pix_expires_at } : null;
        const overdue = kind === 'overdue';
        await notifyUsers({
          condominiumId: row.condominium_id,
          recipientIds: managers.map(m => m.id),
          title: overdue ? 'Fatura da plataforma em atraso' : 'Fatura da plataforma vence em 3 dias',
          body: `A fatura de ${formatMonthLabel(referenceMonth)} (${formatCurrency(row.amount_cents)}) ${overdue ? 'venceu' : 'vence'} em ${dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}. Veja e pague pelo Pix na tela Início.`,
          screen: 'Home',
        });
        for (const manager of managers) {
          if (!manager.email) continue;
          try {
            await sendPlatformInvoiceReminderEmail(manager.email, manager.full_name || '', condo.rows[0]?.name || '', referenceMonth, row.amount_cents, dueDate, kind, pix);
          } catch (error) {
            console.warn('platform invoice reminder email failed', error);
          }
        }
        if (overdue) counts.overdue += 1; else counts.dueSoon += 1;
      } catch (error) {
        console.warn('platform invoice reminder failed', { invoiceId: row.id, error });
      }
    }
  };
  try {
    await run('due_soon', "due_date = current_date + 3", 'due_soon_notified_at');
    await run('overdue', "due_date < current_date", 'overdue_notified_at');
  } catch (error) {
    console.warn('platform invoice reminders failed', error);
  }
  return counts;
};

// Fatura em aberto mais antiga do condomínio (a que vence primeiro), com o
// Pix pra pagar — alimenta o cartão "Fatura da plataforma" da tela Início do
// síndico/subsíndico. null quando não há nada em aberto.
export const getOpenPlatformInvoice = async (condominiumId: string) => {
  const result = await query<any>(
    `select i.id, i.reference_month, i.amount_cents, i.active_users, p.name as plan_name, i.status,
            to_char(i.due_date,'YYYY-MM-DD') as due_date, (i.due_date < current_date) as overdue,
            i.pix_copy_paste, i.pix_qr_code_base64, i.pix_expires_at
     from platform_invoices i join platform_plans p on p.id = i.plan_id
     where i.condominium_id=$1 and i.status in ('pending','sent')
     order by i.due_date asc limit 1`,
    [condominiumId],
  );
  return result.rows[0] || null;
};

type ActionResult = { ok: true; pixCanceled: boolean | null; created?: boolean } | { ok: false; message: string };

// Cancela uma fatura em aberto com motivo: cancela o Pix no Mercado Pago (pra
// não dar pra pagar uma fatura cancelada), registra quem/por quê e avisa
// síndico e subsíndico por e-mail e aviso no app. Se o Mercado Pago revelar
// que ela JÁ foi paga, não cancela — confirma o pagamento.
export const cancelPlatformInvoice = async (invoiceId: string, reason: string, canceledBy: string | null, replaced = false): Promise<ActionResult> => {
  const invoice = await query<{ id: string; condominium_id: string; reference_month: string; amount_cents: number; status: string; pix_payment_id: string | null }>(
    `select id, condominium_id, reference_month, amount_cents, status, pix_payment_id from platform_invoices where id=$1`,
    [invoiceId],
  );
  const row = invoice.rows[0];
  if (!row) return { ok: false, message: 'Fatura não encontrada.' };
  if (row.status !== 'pending' && row.status !== 'sent') return { ok: false, message: 'Só é possível cancelar fatura pendente ou aguardando pagamento.' };

  let pixCanceled: boolean | null = null;
  if (row.pix_payment_id && isMercadoPagoConfigured()) {
    try {
      const order = await getOrder(row.pix_payment_id);
      if (order.paid) {
        await settlePlatformInvoiceById(invoiceId);
        return { ok: false, message: 'Esta fatura já foi paga no Mercado Pago — foi marcada como paga e o recibo enviado. Para desfazer, use "Estornar".' };
      }
      await cancelOrder(row.pix_payment_id);
      pixCanceled = true;
    } catch (error) {
      pixCanceled = false;
      console.warn('platform invoice pix cancel failed', { invoiceId, error });
    }
  }

  await query(
    `update platform_invoices set status='canceled', cancel_reason=$2, canceled_at=now(), canceled_by=$3 where id=$1`,
    [invoiceId, reason, canceledBy],
  );

  const managers = await loadManagers(row.condominium_id);
  const condo = await query<{ name: string }>(`select name from condominiums where id=$1`, [row.condominium_id]);
  const referenceMonth = new Date(row.reference_month);
  try {
    await notifyUsers({
      condominiumId: row.condominium_id,
      recipientIds: managers.map(m => m.id),
      title: 'Fatura da plataforma cancelada',
      body: `A fatura de ${formatMonthLabel(referenceMonth)} (${formatCurrency(row.amount_cents)}) foi cancelada: ${reason}. Desconsidere o Pix dela.`,
      screen: 'Home',
    });
  } catch (error) {
    console.warn('platform invoice cancel notification failed', error);
  }
  for (const manager of managers) {
    if (!manager.email) continue;
    try {
      await sendPlatformInvoiceCanceledEmail(manager.email, manager.full_name || '', condo.rows[0]?.name || '', referenceMonth, row.amount_cents, reason, replaced);
    } catch (error) {
      console.warn('platform invoice canceled email failed', error);
    }
  }
  return { ok: true, pixCanceled };
};

// Corrige e reemite: cancela a fatura errada (com motivo e aviso) e gera outra
// do zero com os dados de hoje — plano, usuários ativos e valor recalculados,
// novo Pix, novo vencimento (hoje + prazo padrão). Só do mês corrente: a
// fatura nova é sempre da competência atual.
export const correctPlatformInvoice = async (invoiceId: string, reason: string, canceledBy: string | null): Promise<ActionResult> => {
  const invoice = await query<{ condominium_id: string; current_month: boolean }>(
    `select condominium_id, (reference_month = date_trunc('month', current_date)::date) as current_month from platform_invoices where id=$1`,
    [invoiceId],
  );
  const row = invoice.rows[0];
  if (!row) return { ok: false, message: 'Fatura não encontrada.' };
  if (!row.current_month) return { ok: false, message: 'Só é possível corrigir e reemitir a fatura do mês corrente. Para competência antiga, cancele e trate por fora.' };

  const canceled = await cancelPlatformInvoice(invoiceId, reason, canceledBy, true);
  if (!canceled.ok) return canceled;
  const created = await checkAndSendPlatformInvoice(row.condominium_id);
  return { ok: true, pixCanceled: canceled.pixCanceled, created };
};

// Estorno de fatura já paga: só REGISTRA (status 'estornada' + motivo). O
// reembolso em si é feito no painel do Mercado Pago (ou por fora, se o
// pagamento foi manual) — não automatizamos dinheiro saindo da conta.
export const refundPlatformInvoice = async (invoiceId: string, note: string): Promise<ActionResult> => {
  const result = await query(
    `update platform_invoices set status='refunded', refund_note=$2, refunded_at=now() where id=$1 and status='paid' returning id`,
    [invoiceId, note],
  );
  if (!result.rows.length) return { ok: false, message: 'Só é possível estornar uma fatura paga.' };
  return { ok: true, pixCanceled: null };
};
