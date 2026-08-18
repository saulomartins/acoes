import { NextFunction, Request, Response, Router } from 'express';
import { authenticate } from '../middleware/auth';
import { AMBIGUOUS_LOGIN, changePassword, listProfiles, login, refresh, register, requestPasswordReset, resetPassword, revokeRefreshToken, switchProfile } from '../services/authService';
import { query } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { FEATURE_KEYS, type FeatureKey } from '../services/featureCatalog';

const router = Router();
export const CURRENT_TERMS_VERSION = '2026-08-04';
export const CURRENT_TOUR_VERSION = '2026-08-17-1';
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

// Bloqueio por conta (além do limite por IP acima): a senha inicial de
// moradores é derivada de CPF/unidade (ver passwordRuleService), então um
// limite só por IP não impede tentativas distribuídas contra a mesma conta.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_LOCKOUT_MS = 15 * 60_000;
const loginFailuresByUsername = new Map<string, { count: number; windowResetAt: number; lockedUntil: number }>();

const isLoginLocked = (username: string) => {
  const entry = loginFailuresByUsername.get(username);
  return !!entry && entry.lockedUntil > Date.now();
};

const registerLoginFailure = (username: string) => {
  const now = Date.now();
  const current = loginFailuresByUsername.get(username);
  const entry = !current || current.windowResetAt <= now
    ? { count: 0, windowResetAt: now + LOGIN_FAILURE_WINDOW_MS, lockedUntil: 0 }
    : current;
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginFailuresByUsername.set(username, entry);
};

const clearLoginFailures = (username: string) => loginFailuresByUsername.delete(username);

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

router.post('/login', limit(20, 15 * 60_000), async (req, res) => {
  try {
    // `username` aqui é o identificador digitado: usuário de acesso, CPF ou
    // e-mail. O nome do campo é mantido para não quebrar clientes já
    // publicados (app instalado e web em cache) que enviam essa chave.
    const { username, password } = req.body ?? {};

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'username and password are required' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (isLoginLocked(normalizedUsername)) {
      return res.status(429).json({ message: 'Muitas tentativas para este usuário. Aguarde alguns minutos e tente novamente.' });
    }

    const response = await login(username, password);
    // Senha correta, mas o CPF/e-mail informado serve a mais de uma conta —
    // não conta como tentativa falha, já que a credencial está certa.
    if (response === AMBIGUOUS_LOGIN) {
      clearLoginFailures(normalizedUsername);
      return res.status(409).json({ message: 'Este CPF/e-mail está vinculado a mais de uma conta. Entre com o seu usuário de acesso.' });
    }
    if (!response) {
      registerLoginFailure(normalizedUsername);
      return res.status(401).json({ message: 'invalid credentials' });
    }

    clearLoginFailures(normalizedUsername);
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

router.get('/profiles', authenticate, asyncHandler(async (req, res) => {
  return res.json({ profiles: await listProfiles(req.user!.id) });
}));

// Sem `authenticate`: a prova de sessão válida é o próprio refreshToken no
// corpo (mesmo padrão de /auth/refresh, validado em switchProfile() com a
// mesma detecção de reuso) — não depende de um access token ainda válido.
router.post('/switch-profile', asyncHandler(async (req, res) => {
  const { refreshToken, profileId } = req.body ?? {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ message: 'refreshToken is required' });
  }

  try {
    const response = await switchProfile(refreshToken, profileId ? String(profileId) : null);
    if (!response) return res.status(401).json({ message: 'invalid refresh token or profile' });
    return res.json(response);
  } catch {
    return res.status(401).json({ message: 'invalid refresh token or profile' });
  }
}));

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ message: 'A nova senha deve ter pelo menos 8 caracteres.' });
  const user = await changePassword(req.user!.id, password);
  if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
  return res.json({ user });
}));

router.post('/terms/accept', authenticate, asyncHandler(async (req, res) => {
  if (req.body?.accepted !== true || req.body?.version !== CURRENT_TERMS_VERSION) return res.status(400).json({ message: 'Confirme a leitura e aceitação da versão atual dos Termos de Uso.' });
  const ipAddress = req.ip || req.socket.remoteAddress || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500) || null;
  await query(`insert into user_terms_acceptances(id,user_id,terms_version,ip_address,user_agent) values(gen_random_uuid(),$1,$2,$3,$4) on conflict(user_id,terms_version) do nothing`,[req.user!.id,CURRENT_TERMS_VERSION,ipAddress,userAgent]);
  // `req.user` vem do JWT emitido no login/refresh e pode carregar um
  // `mustChangePassword` desatualizado (ex.: senha trocada depois que esse
  // token foi emitido, já que a troca de senha não reemite token). Por isso
  // sempre buscamos o valor atual no banco em vez de espalhar `...req.user`.
  const result=await query<{terms_accepted_at:Date;must_change_password:boolean}>(`update users set terms_accepted_version=$1,terms_accepted_at=now() where id=$2 returning terms_accepted_at,must_change_password`,[CURRENT_TERMS_VERSION,req.user!.id]);
  return res.json({user:{...req.user,mustChangePassword:result.rows[0].must_change_password,termsAcceptedVersion:CURRENT_TERMS_VERSION,termsAcceptedAt:result.rows[0].terms_accepted_at.toISOString()}});
}));

router.post('/tour/complete', authenticate, asyncHandler(async (req, res) => {
  if (req.body?.version !== CURRENT_TOUR_VERSION) return res.status(400).json({ message: 'Versão do tour inválida.' });
  await query(`insert into user_tour_completions(id,user_id,tour_version) values(gen_random_uuid(),$1,$2) on conflict(user_id,tour_version) do nothing`,[req.user!.id,CURRENT_TOUR_VERSION]);
  // Mesmo motivo do /terms/accept acima: não confiar no `mustChangePassword` do JWT antigo.
  const result=await query<{tour_completed_at:Date;terms_accepted_version:string|null;terms_accepted_at:Date|null;must_change_password:boolean}>(`update users set tour_completed_version=$1,tour_completed_at=now() where id=$2 returning tour_completed_at,terms_accepted_version,terms_accepted_at,must_change_password`,[CURRENT_TOUR_VERSION,req.user!.id]);
  return res.json({user:{...req.user,mustChangePassword:result.rows[0].must_change_password,termsAcceptedVersion:result.rows[0].terms_accepted_version,termsAcceptedAt:result.rows[0].terms_accepted_at?.toISOString()||null,tourCompletedVersion:CURRENT_TOUR_VERSION,tourCompletedAt:result.rows[0].tour_completed_at.toISOString()}});
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await query<{ condominium_name:string|null;terms_accepted_version:string|null;terms_accepted_at:Date|null;tour_completed_version:string|null;tour_completed_at:Date|null;must_change_password:boolean }>(
    `select c.name condominium_name,u.terms_accepted_version,u.terms_accepted_at,u.tour_completed_version,u.tour_completed_at,u.must_change_password from users u left join condominiums c on c.id=u.condominium_id where u.id=$1`,
    [req.user?.id],
  );

  // admin_geral não está preso a um condomínio só — não faz sentido filtrar
  // o próprio menu dele por funcionalidades de um condomínio específico.
  let condominiumFeatures: Record<FeatureKey, boolean> | null = null;
  if (req.user?.role !== 'admin_geral' && req.user?.condominiumId) {
    const features = await query<Record<FeatureKey, boolean>>(
      `select ${FEATURE_KEYS.join(', ')} from condominium_features where condominium_id=$1`,
      [req.user.condominiumId],
    );
    const row = features.rows[0];
    condominiumFeatures = Object.fromEntries(FEATURE_KEYS.map(key => [key, row ? row[key] : true])) as Record<FeatureKey, boolean>;
  }

  return res.json({ user: { ...req.user, mustChangePassword:result.rows[0]?.must_change_password ?? req.user?.mustChangePassword, condominiumName:result.rows[0]?.condominium_name || null,termsAcceptedVersion:result.rows[0]?.terms_accepted_version||null,termsAcceptedAt:result.rows[0]?.terms_accepted_at?.toISOString()||null,tourCompletedVersion:result.rows[0]?.tour_completed_version||null,tourCompletedAt:result.rows[0]?.tour_completed_at?.toISOString()||null }, condominiumFeatures });
}));

export default router;
