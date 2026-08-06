import { NextFunction, Request, Response, Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendLeadNotificationEmail } from '../services/emailService';

const router = Router();

// Rota pública (sem authenticate) — o formulário "Fale com a gente" da
// landing page é acessado por quem ainda não tem conta no sistema. Limite
// por IP evita que vire um jeito de mandar e-mail em massa pra caixa da
// Lar em Dia.
const attempts = new Map<string, { count: number; resetAt: number }>();
const limit = (maximum: number, windowMs: number) => (req: Request, res: Response, next: NextFunction) => {
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const current = attempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  attempts.set(key, entry);
  if (entry.count > maximum) return res.status(429).json({ message: 'Muitas tentativas. Aguarde alguns minutos.' });
  return next();
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validProfiles = ['Síndico(a)', 'Subsíndico(a)', 'Morador(a)'];

router.post('/', limit(5, 15 * 60_000), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const condominiumName = String(req.body?.condominiumName || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const message = String(req.body?.message || '').trim();
  const city = String(req.body?.city || '').trim();
  const profile = String(req.body?.profile || '').trim();
  const condominiumCount = String(req.body?.condominiumCount || '').trim();
  const unitCount = String(req.body?.unitCount || '').trim();
  const featureList = Array.isArray(req.body?.featuresOfInterest) ? req.body.featuresOfInterest.map((value: unknown) => String(value).trim()).filter(Boolean) : [];
  const featuresOfInterest = featureList.join(', ');

  if (name.length < 2 || name.length > 100 || !/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(name)) return res.status(400).json({ message: 'Informe um nome válido.' });
  if (condominiumName.length < 2 || condominiumName.length > 140) return res.status(400).json({ message: 'Informe o nome do condomínio.' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Informe um e-mail válido.' });
  if (!/^\d{10,11}$/.test(phone.replace(/\D/g, ''))) return res.status(400).json({ message: 'Informe um telefone ou WhatsApp válido com DDD.' });
  if (city.length < 2 || city.length > 100 || !/^[A-Za-zÀ-ÖØ-öø-ÿ' .-]+$/.test(city)) return res.status(400).json({ message: 'Informe uma cidade válida.' });
  if (!validProfiles.includes(profile)) return res.status(400).json({ message: 'Selecione o perfil do interessado.' });
  if (!/^\d{1,4}$/.test(condominiumCount) || Number(condominiumCount) < 1) return res.status(400).json({ message: 'Informe uma quantidade válida de condomínios.' });
  if (!/^\d{1,6}$/.test(unitCount) || Number(unitCount) < 1) return res.status(400).json({ message: 'Informe uma quantidade válida de unidades.' });
  if (!featureList.length) return res.status(400).json({ message: 'Selecione ao menos uma funcionalidade de interesse.' });

  await sendLeadNotificationEmail({ name, condominiumName, email, phone, message, city, profile, condominiumCount, unitCount, featuresOfInterest });

  return res.status(201).json({ ok: true });
}));

export default router;
