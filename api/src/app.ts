import express from 'express';
import authRoutes from './routes/authRoutes';
import condominiumRoutes from './routes/condominiumRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import notificationRoutes from './routes/notificationRoutes';
import userRoutes from './routes/userRoutes';
import unitTypeRoutes from './routes/unitTypeRoutes';
import billingRoutes from './routes/billingRoutes';
import interWebhookRoutes from './routes/interWebhookRoutes';
import unitRoutes from './routes/unitRoutes';
import debtRoutes from './routes/debtRoutes';
import reportRoutes from './routes/reportRoutes';
import bankConfigurationRoutes from './routes/bankConfigurationRoutes';
import accountabilityRoutes from './routes/accountabilityRoutes';
import accountabilityAttachmentRoutes from './routes/accountabilityAttachmentRoutes';
import agreementRoutes from './routes/agreementRoutes';
import { config } from './config';

export const app = express();

const originMatches = (origin: string, configuredOrigin: string) => {
  if (!configuredOrigin.includes('*')) return origin === configuredOrigin;
  const escaped = configuredOrigin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-zA-Z0-9-]+');
  return new RegExp(`^${escaped}$`).test(origin);
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.some(configuredOrigin => originMatches(origin, configuredOrigin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.disable('x-powered-by');

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/webhooks/inter', interWebhookRoutes);
app.use('/condominiums', condominiumRoutes);
app.use('/users', userRoutes);
app.use('/unit-types', unitTypeRoutes);
app.use('/units', unitRoutes);
app.use('/invoices', invoiceRoutes);
app.use('/debts', debtRoutes);
app.use('/agreements', agreementRoutes);
app.use('/billing', billingRoutes);
app.use('/notifications', notificationRoutes);
app.use('/reports', reportRoutes);
app.use('/bank-configurations', bankConfigurationRoutes);
app.use('/accountability', accountabilityRoutes);
app.use('/accountability-attachments', accountabilityAttachmentRoutes);

app.use((_req, res) => res.status(404).json({ message: 'route not found' }));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
    return res.status(409).json({ message: 'registro duplicado' });
  }

  console.error('Unhandled API error', error);
  return res.status(500).json({ message: 'internal server error' });
});
