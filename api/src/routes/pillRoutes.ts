import { NextFunction, Request, Response, Router } from 'express';
import { query } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { PILLS } from '../content/pills';
import { findPill, pillSummary, searchPills } from '../services/pillSearchService';
import { sendPillQuestionEmail } from '../services/emailService';

const router = Router();

// Rotas públicas (sem authenticate) das "Pílulas do Condomínio" da landing:
// qualquer visitante lê, busca e deixa uma pergunta. Limite por IP no envio
// de perguntas, pelo mesmo motivo do formulário de leads — não virar canal de
// spam para a caixa da Lar em Dia.
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

router.get('/', (_req, res) => {
  res.json({ pills: PILLS.map(pillSummary) });
});

router.get('/search', limit(60, 60_000), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 300);
  res.json({ pills: q ? searchPills(q).map(pillSummary) : [] });
});

router.post('/questions', limit(5, 60 * 60_000), asyncHandler(async (req, res) => {
  const question = String(req.body?.question || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (question.length < 10 || question.length > 1000) return res.status(400).json({ message: 'Escreva sua pergunta com 10 a 1000 caracteres.' });
  if (email && (email.length > 160 || !isValidEmail(email))) return res.status(400).json({ message: 'Informe um e-mail válido ou deixe o campo em branco.' });

  await query('insert into pill_questions (question, email) values ($1, $2)', [question, email || null]);
  // Aviso por e-mail é conveniência: a pergunta já está salva, então falha de
  // SMTP não deve virar erro para o visitante.
  sendPillQuestionEmail({ question, email }).catch((error) => console.error('Failed to send pill question email', error));

  return res.status(201).json({ ok: true });
}));

router.get('/:slug', (req, res) => {
  const pill = findPill(req.params.slug);
  if (!pill) return res.status(404).json({ message: 'Pílula não encontrada.' });
  return res.json({ pill });
});

export default router;
