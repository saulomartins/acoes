import { randomUUID } from 'crypto';
import { query, withTransaction } from '../db';

type PushInput = {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const isExpoToken = (value: string) => /^ExponentPushToken\[.+\]$|^ExpoPushToken\[.+\]$/.test(value);

export const sendPushNotification = async (input: PushInput) => {
  const validTokens = Array.from(new Set(input.tokens.filter(token => typeof token === 'string' && isExpoToken(token))));
  if (!validTokens.length) {
    return { provider: 'expo', status: 'no_registered_devices', delivered: 0, requested: 0, errors: ['Nenhum token Expo válido encontrado.'], invalidTokens: [] as string[] };
  }

  let delivered = 0;
  const errors: string[] = [];
  const invalidTokens = new Set<string>();
  for (let offset = 0; offset < validTokens.length; offset += 100) {
    const chunk = validTokens.slice(offset, offset + 100);
    const messages = chunk.map(to => ({
      to,
      title: input.title,
      body: input.body,
      sound: 'default',
      channelId: 'default',
      priority: 'high',
      ttl: 3600,
      data: input.data || { screen: 'Communications' },
    }));
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
    const result = await response.json() as { data?: Array<{ status: 'ok' | 'error'; message?: string; details?: { error?: string } }> };
    delivered += result.data?.filter(ticket => ticket.status === 'ok').length || 0;
    (result.data || []).forEach((ticket, index) => {
      if (ticket.status === 'error') {
        errors.push(ticket.message || ticket.details?.error || 'Expo push service returned an unknown error');
        if (ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.add(chunk[index]);
        }
      }
    });
  }

  return {
    provider: 'expo',
    status: errors.length ? (delivered > 0 ? 'partial' : 'provider_error') : delivered === validTokens.length ? 'sent' : 'partial',
    delivered,
    requested: validTokens.length,
    errors,
    invalidTokens: Array.from(invalidTokens),
  };
};

// Cria um aviso no inbox do app (Comunicação) para cada destinatário e, em
// paralelo, tenta o push nativo — usado sempre que uma ação de um lado
// (síndico/subsíndico ou morador) gera algo que a outra parte precisa ver.
// Nunca lança: falha de notificação não pode derrubar a ação principal.
export const notifyUsers = async (input: {
  condominiumId: string;
  senderId?: string | null;
  recipientIds: string[];
  title: string;
  body: string;
  screen?: string;
}) => {
  const recipientIds = Array.from(new Set(input.recipientIds));
  if (!recipientIds.length) return;

  const devices = await query<{ fcm_token: string }>(`select distinct fcm_token from device_tokens where user_id = any($1::uuid[])`, [recipientIds]);
  const tokens = devices.rows.map(row => row.fcm_token).filter(Boolean);
  let push: { status: string; invalidTokens?: string[]; errors?: string[] };
  try {
    push = await sendPushNotification({ tokens, title: input.title, body: input.body, data: { screen: input.screen || 'Communications' } });
    if (push.invalidTokens?.length) await query(`delete from device_tokens where fcm_token = any($1::text[])`, [push.invalidTokens]);
  } catch (error) {
    console.warn('notifyUsers push failed', error);
    push = { status: 'provider_error' };
  }

  try {
    await withTransaction(async client => {
      const notificationId = randomUUID();
      await client.query(
        `insert into notifications(id,condominium_id,title,body,created_by,provider_status,audience_type) values($1,$2,$3,$4,$5,$6,'personal')`,
        [notificationId, input.condominiumId, input.title, input.body, input.senderId || null, push.status],
      );
      for (const userId of recipientIds) {
        await client.query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, userId]);
      }
    });
  } catch (error) {
    console.error('notifyUsers failed to record in-app notification', error);
  }
};
