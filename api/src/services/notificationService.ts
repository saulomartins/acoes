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
