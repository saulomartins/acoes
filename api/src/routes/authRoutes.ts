import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../middleware/auth';
import { login, refresh, register, requestPasswordReset, resetPassword, revokeRefreshToken } from '../services/authService';
import { query } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
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
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'username and password are required' });
    }

    if (username.trim().length < 3 || password.length < 6) {
      return res.status(400).json({ message: 'username must have 3+ chars and password 6+ chars' });
    }

    // Public registration only bootstraps a completely new installation.
    // Once an administrator exists, accounts are created by authenticated managers.
    const existingAdmin = await query(`select id from users where role = 'admin_geral' limit 1`);
    if (existingAdmin.rows[0]) {
      return res.status(403).json({ message: 'Cadastro público desabilitado. Usuários devem ser criados pela administração.' });
    }

    const response = await register(username, password, 'admin_geral');
    return res.status(201).json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return res.status(409).json({ message: 'username already exists' });
    }

    console.error('Error on /auth/register', error);
    return res.status(500).json({ message: 'internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'username and password are required' });
    }

    const response = await login(username, password);
    if (!response) {
      return res.status(401).json({ message: 'invalid credentials' });
    }

    return res.json(response);
  } catch (error) {
    console.error('Error on /auth/login', error);
    return res.status(500).json({ message: 'internal server error' });
  }
});

router.post('/forgot-password', limit(5, 15 * 60_000), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Informe um e-mail válido.' });
  try {
    await requestPasswordReset(email);
  } catch (error) {
    console.error('Failed to send password reset email', error);
  }
  return res.json({ message: 'Se o e-mail estiver cadastrado, enviaremos um link de recuperação.' });
}));

router.post('/reset-password', limit(10, 15 * 60_000), asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (token.length < 32) return res.status(400).json({ message: 'Link de recuperação inválido.' });
  if (password.length < 8) return res.status(400).json({ message: 'A nova senha deve ter pelo menos 8 caracteres.' });
  const changed = await resetPassword(token, password);
  if (!changed) return res.status(400).json({ message: 'Este link é inválido, expirou ou já foi utilizado.' });
  return res.json({ message: 'Senha alterada. Entre novamente com a nova senha.' });
}));

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json({ message: 'refreshToken is required' });
    }

    const response = await refresh(refreshToken);
    if (!response) {
      return res.status(401).json({ message: 'invalid refresh token' });
    }

    return res.json(response);
  } catch {
    return res.status(401).json({ message: 'invalid refresh token' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body ?? {};

    if (refreshToken && typeof refreshToken === 'string') {
      await revokeRefreshToken(refreshToken);
    }

    return res.status(204).send();
  } catch {
    return res.status(204).send();
  }
});

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await query<{ condominium_name:string|null }>(
    `select c.name condominium_name from users u left join condominiums c on c.id=u.condominium_id where u.id=$1`,
    [req.user?.id],
  );
  return res.json({ user: { ...req.user, condominiumName:result.rows[0]?.condominium_name || null } });
}));

export default router;
