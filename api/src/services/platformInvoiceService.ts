import { randomUUID } from 'crypto';
import { query } from '../db';
import { computePlanAmountCents, countActiveUsers, type PlatformPlan, type PlatformPlanTier } from './platformPlanService';
import { sendPlatformInvoiceEmail } from './emailService';
import { sendPushNotification } from './notificationService';

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMonthLabel = (referenceMonth: Date) =>
  referenceMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Verificação sob demanda (sem cron): chamada no login do síndico/subsíndico.
// Gera e envia a fatura da plataforma do mês corrente se, e só se, a data de
// início de cobrança do condomínio (billing_starts_at) já passou e ainda não
// existe fatura para esse mês — a unique constraint em platform_invoices
// impede duplicar o envio quando essa checagem roda em vários logins.
export const checkAndSendPlatformInvoice = async (condominiumId: string) => {
  const condo = await query<{ platform_status: string; name: string }>(
    `select platform_status, name from condominiums where id=$1`,
    [condominiumId],
  );
  if (!condo.rows[0] || condo.rows[0].platform_status !== 'active') return;

  const sub = await query<{ id: string; plan_id: string; billing_starts_at: string }>(
    `select id, plan_id, to_char(billing_starts_at, 'YYYY-MM-DD') as billing_starts_at
     from condominium_plan_subscriptions where condominium_id=$1 and ended_at is null`,
    [condominiumId],
  );
  const subscription = sub.rows[0];
  if (!subscription) return;
  if (new Date(`${subscription.billing_starts_at}T00:00:00Z`) > new Date()) return; // ainda em adaptação

  const planResult = await query<PlatformPlan & { name: string }>(`select * from platform_plans where id=$1`, [subscription.plan_id]);
  const plan = planResult.rows[0];
  if (!plan) return;
  const tiers = await query<PlatformPlanTier>(`select * from platform_plan_tiers where plan_id=$1 order by min_active_users asc`, [subscription.plan_id]);

  const activeUsers = await countActiveUsers(condominiumId, plan.active_user_metric);
  const amountCents = computePlanAmountCents(plan, tiers.rows, activeUsers);

  const referenceMonth = new Date();
  referenceMonth.setUTCDate(1);
  const referenceMonthIso = referenceMonth.toISOString().slice(0, 10);

  let invoiceId: string;
  try {
    const inserted = await query<{ id: string }>(
      `insert into platform_invoices (id, condominium_id, plan_id, reference_month, active_users, amount_cents)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [randomUUID(), condominiumId, subscription.plan_id, referenceMonthIso, activeUsers, amountCents],
    );
    invoiceId = inserted.rows[0].id;
  } catch (error: any) {
    if (error?.code === '23505') return; // já existe fatura desse mês para este condomínio
    throw error;
  }

  const managers = await query<{ id: string; full_name: string | null; email: string | null }>(
    `select id, full_name, email from users where condominium_id=$1 and role in ('sindico','subsindico') and deleted_at is null`,
    [condominiumId],
  );

  const title = 'Fatura da plataforma disponível';
  const body = `A fatura de ${formatMonthLabel(referenceMonth)} do condomínio ${condo.rows[0].name} já está disponível: ${formatCurrency(amountCents)} (${activeUsers} usuário(s) ativo(s)).`;

  const notificationId = randomUUID();
  await query(
    `insert into notifications(id,condominium_id,title,body,provider_status,audience_type) values($1,$2,$3,$4,'pending','personal')`,
    [notificationId, condominiumId, title, body],
  );
  for (const manager of managers.rows) {
    await query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, manager.id]);
    if (manager.email) {
      try {
        await sendPlatformInvoiceEmail(manager.email, manager.full_name || '', condo.rows[0].name, referenceMonth, amountCents, activeUsers);
      } catch (error) {
        console.warn('platform invoice email failed', error);
      }
    }
  }

  try {
    const devices = await query<{ fcm_token: string }>(
      `select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`,
      [managers.rows.map(m => m.id)],
    );
    await sendPushNotification({ tokens: devices.rows.map(d => d.fcm_token), title, body, data: { screen: 'PlatformInvoice' } });
  } catch (error) {
    console.warn('platform invoice push failed', error);
  }

  await query(`update platform_invoices set status='sent', sent_at=now() where id=$1`, [invoiceId]);
};
