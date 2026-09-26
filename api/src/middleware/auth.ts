import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/authService';
import {
  isPlatformRestricted,
  isResidentRequestAllowedWhileSuspended,
  isWriteAllowedWhileRestricted,
  RESIDENT_SUSPENDED_MESSAGE,
  RESTRICTED_WRITE_MESSAGE,
} from '../services/platformSuspensionService';
import type { UserRole } from '../types';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  // Downloads acionados por um link direto do navegador (não um fetch() com
  // header customizado) não conseguem anexar Authorization — para essas
  // rotas específicas, o token também pode vir por query string.
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : (typeof req.query.token === 'string' ? req.query.token : null);

  if (!token) {
    return res.status(401).json({ message: 'authorization token is required' });
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ message: 'invalid or expired token' });
  }

  // Política de inadimplência (platformSuspensionService.ts): com a fatura da
  // plataforma 30+ dias em atraso, síndico/subsíndico ficam somente leitura e
  // moradores ficam bloqueados. Se a consulta falhar (ex.: migração ainda não
  // aplicada), LIBERA — um erro aqui não pode derrubar todos os condomínios.
  const { role, condominiumId } = req.user;
  const path = req.originalUrl.split('?')[0];
  if (!condominiumId) return next();

  const isManager = role === 'sindico' || role === 'subsindico';
  const isResident = role === 'proprietario' || role === 'inquilino';
  if (isManager && !isWriteAllowedWhileRestricted(req.method, path)) {
    // Só escrita de gestor consulta o banco — sem cache, pra liberar no
    // mesmo instante do pagamento.
    return respondIfRestricted(isPlatformRestricted(condominiumId), res, next, { message: RESTRICTED_WRITE_MESSAGE, code: 'PLATFORM_RESTRICTED' });
  }
  if (isResident && !isResidentRequestAllowedWhileSuspended(path)) {
    // Morador: toda requisição (leitura inclusive) — por isso com cache curto.
    return respondIfRestricted(cachedRestriction(condominiumId), res, next, { message: RESIDENT_SUSPENDED_MESSAGE, code: 'PLATFORM_SUSPENDED' });
  }
  return next();
};

const respondIfRestricted = (check: Promise<boolean>, res: Response, next: NextFunction, body: { message: string; code: string }) => {
  void check
    .catch((error) => {
      console.warn('platform restriction check failed — allowing request', error);
      return false;
    })
    .then((restricted) => (restricted ? res.status(403).json(body) : next()));
};

// Cache da restrição pros moradores (30 s por condomínio): o app faz várias
// chamadas em paralelo e em polling, e cada uma consultaria o banco. O
// pagamento libera os moradores em até 30 s — ou na hora, quando o app
// pergunta /auth/access-status (que chama forgetPlatformRestriction).
const RESIDENT_CACHE_MS = 30_000;
const restrictionCache = new Map<string, { restricted: boolean; expiresAt: number }>();

const cachedRestriction = async (condominiumId: string) => {
  const cached = restrictionCache.get(condominiumId);
  if (cached && cached.expiresAt > Date.now()) return cached.restricted;
  const restricted = await isPlatformRestricted(condominiumId);
  restrictionCache.set(condominiumId, { restricted, expiresAt: Date.now() + RESIDENT_CACHE_MS });
  return restricted;
};

export const forgetPlatformRestriction = (condominiumId?: string) => {
  if (condominiumId) restrictionCache.delete(condominiumId);
  else restrictionCache.clear();
};

export const authorize = (...roles: UserRole[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ message: 'authorization token is required' });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'insufficient permissions' });
  }

  return next();
};
