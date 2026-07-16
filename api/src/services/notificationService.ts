type PushInput = {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export const sendPushNotification = async (input: PushInput) => {
  if (!input.tokens.length) {
    return { provider: 'expo', status: 'no_registered_devices', delivered: 0, requested: 0, errors: [] as string[] };
  }

  let delivered = 0;
  const errors: string[] = [];
  for (let offset = 0; offset < input.tokens.length; offset += 100) {
    const messages = input.tokens.slice(offset, offset + 100).map(to => ({
      to,
      title: input.title,
      body: input.body,
      sound: 'default',
      channelId: 'default',
      priority: 'high',
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
    for (const ticket of result.data || []) {
      if (ticket.status === 'error') {
        errors.push(ticket.message || ticket.details?.error || 'Expo push service returned an unknown error');
      }
    }
  }

  return {
    provider: 'expo',
    status: errors.length ? (delivered > 0 ? 'partial' : 'provider_error') : delivered === input.tokens.length ? 'sent' : 'partial',
    delivered,
    requested: input.tokens.length,
    errors,
  };
};
