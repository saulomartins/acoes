import https from 'https';

export type WhatsAppIntegrationConfig = {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  enabled: boolean;
};

const isConfigured = (integration?: WhatsAppIntegrationConfig | null) =>
  Boolean(integration?.enabled && integration.phoneNumberId && integration.accessToken && integration.templateName);

const graphRequest = <T>(path: string, accessToken: string, body: unknown) =>
  new Promise<T>((resolve, reject) => {
    const payload = JSON.stringify(body);

    const request = https.request(
      `https://graph.facebook.com/v21.0/${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${accessToken}`,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const data = text ? JSON.parse(text) : null;

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            const detail = (data as any)?.error?.error_user_msg || (data as any)?.error?.message || 'A Meta rejeitou o envio da mensagem.';
            const apiError = new Error(detail);
            (apiError as any).statusCode = response.statusCode;
            return reject(apiError);
          }

          return resolve(data as T);
        });
      },
    );

    request.on('error', (error: any) => {
      reject(new Error(error?.message || 'Falha de conexão com a API do WhatsApp.'));
    });

    request.setTimeout(15_000, () => {
      request.destroy(new Error('Tempo limite excedido ao conectar com a API do WhatsApp.'));
    });

    request.write(payload);
    request.end();
  });

// Templates business-initiated pelo WhatsApp Business não aceitam quebras de linha nem espaços duplos no parâmetro.
const sanitizeTemplateText = (value: string) => value.replace(/\s+/g, ' ').trim();

export const sendWhatsAppTemplateMessage = async (
  integration: WhatsAppIntegrationConfig | null | undefined,
  toPhoneDigits: string,
  bodyText: string,
): Promise<{ sent: boolean }> => {
  if (!isConfigured(integration)) return { sent: false };

  const activeIntegration = integration as WhatsAppIntegrationConfig;
  const to = toPhoneDigits.length > 11 ? toPhoneDigits : `55${toPhoneDigits.replace(/^55/, '')}`;

  await graphRequest(`${activeIntegration.phoneNumberId}/messages`, activeIntegration.accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: activeIntegration.templateName,
      language: { code: activeIntegration.templateLanguage },
      components: [{ type: 'body', parameters: [{ type: 'text', text: sanitizeTemplateText(bodyText) }] }],
    },
  });

  return { sent: true };
};
