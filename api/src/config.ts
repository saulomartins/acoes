import dotenv from 'dotenv';

dotenv.config();

const requiredInProduction = (name: string, fallback: string) => {
  const value = process.env[name] || fallback;

  if (process.env.NODE_ENV === 'production' && value === fallback) {
    throw new Error(`${name} must be configured in production`);
  }

  return value;
};

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  accessTokenSecret: requiredInProduction('JWT_SECRET', 'dev-secret-change-me'),
  refreshTokenSecret: requiredInProduction('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  // Sessão renovável por rotação (ver refresh() em authService) até este limite;
  // depois disso o usuário precisa logar de novo mesmo com uso contínuo do app.
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  webUrl: process.env.APP_WEB_URL || 'http://localhost:8081',
  allowedOrigins: (process.env.CORS_ORIGINS || process.env.APP_WEB_URL || 'http://localhost:8081,http://localhost:8082,http://localhost:19006')
    .split(',').map(value => value.trim()).filter(Boolean),
  email: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    replyTo: process.env.EMAIL_REPLY_TO || '',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },
  inter: {
    clientId: process.env.INTER_CLIENT_ID || '',
    clientSecret: process.env.INTER_CLIENT_SECRET || '',
    certPath: process.env.INTER_CERT_PATH || '',
    keyPath: process.env.INTER_KEY_PATH || '',
    certPassphrase: process.env.INTER_CERT_PASSPHRASE || '',
    baseUrl: process.env.INTER_BASE_URL || 'https://cdpj.partners.bancointer.com.br',
    tokenPath: process.env.INTER_TOKEN_PATH || '/oauth/v2/token',
    scopes: process.env.INTER_SCOPES || 'boleto-cobranca.write boleto-cobranca.read',
  },
  googleDrive: {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '',
  },
  // Cobrança da fatura da plataforma via Pix, conta pessoa física do dono
  // da plataforma (sem split/marketplace — o valor cai direto nessa
  // conta). Sem accessToken configurado, checkAndSendPlatformInvoice pula a
  // criação da cobrança e o e-mail sai só informativo (mesmo padrão do
  // e-mail sem SMTP/Resend).
  mercadoPago: {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  },
  // URL pública da própria API (não a do app web) — usada só pra montar a
  // notification_url que o Mercado Pago chama quando um pagamento muda de
  // status. Em produção é a URL do Railway; em dev local o MP não consegue
  // alcançar localhost, então o webhook simplesmente não dispara (o
  // pagamento ainda pode ser conferido manualmente via GET /v1/payments).
  apiPublicUrl: process.env.API_PUBLIC_URL || 'http://localhost:3000',
  // Identificação de quem emite o recibo por e-mail (pessoa física, dono da
  // plataforma) — como a conta é PF, sem nota fiscal automática, esse
  // recibo é o documento que o síndico anexa na prestação de contas do
  // condomínio. Nunca versionar CPF real — preencher só no .env.
  platformReceipt: {
    ownerName: process.env.PLATFORM_RECEIPT_OWNER_NAME || '',
    ownerCpf: process.env.PLATFORM_RECEIPT_OWNER_CPF || '',
    ownerCity: process.env.PLATFORM_RECEIPT_OWNER_CITY || '',
  },
};

if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  console.warn('JWT secrets are not fully set. Using insecure development fallback secrets.');
}
