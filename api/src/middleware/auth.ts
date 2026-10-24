import type { NextFunction, Request, Response } from 'express';
import { query } from '../db';
import { isSessionRevoked, verifyAccessToken } from '../services/authService';
import { requestMeta } from '../services/requestMeta';
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
  // rotas específicas, o token também pode vir por query string. Só em
  // leitura: um link com token na URL nunca pode alterar dados.
  const queryToken = ['GET', 'HEAD'].includes(req.method.toUpperCase()) && typeof req.query?.token === 'string' ? req.query.token : null;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : queryToken;

  if (!token) {
    return res.status(401).json({ message: 'authorization token is required' });
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ message: 'invalid or expired token' });
  }

  // Sessão encerrada de verdade (logout, "sair dos outros aparelhos", troca
  // de senha): o access token ainda valeria até 15 min — corta na hora.
  // Tokens antigos, sem `sid`, só passam até expirarem (15 min do deploy).
  const sessionId = req.user.sessionId;
  if (!sessionId) return continueAuthenticated(req, res, next);
  void isSessionRevoked(sessionId)
    .catch((error) => {
      console.warn('session revocation check failed — allowing request', error);
      return false;
    })
    .then((revoked) => (revoked
      ? res.status(401).json({ message: 'Sessão encerrada. Entre novamente.' })
      : continueAuthenticated(req, res, next)));
};

// Toda escrita autenticada fica em request_log com sessão, IP e aparelho —
// gravado quando a resposta termina (com o status), sem atrasar a requisição.
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const logWriteRequest = (req: Request, res: Response) => {
  if (!WRITE_METHODS.includes(req.method.toUpperCase()) || typeof res.on !== 'function') return;
  const user = req.user;
  const meta = requestMeta(req);
  const path = req.originalUrl.split('?')[0].slice(0, 300);
  res.on('finish', () => {
    void query(
      `insert into request_log(user_id, session_id, role, condominium_id, method, path, status, ip_address, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user?.id || null, user?.sessionId || null, user?.role || null, user?.condominiumId || null, req.method.toUpperCase(), path, res.statusCode, meta.ip, meta.userAgent],
    ).catch(error => console.warn('request_log insert failed', error));
  });
};

const continueAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  logWriteRequest(req, res);

  // Política de inadimplência (platformSuspensionService.ts): com a fatura da
  // plataforma 30+ dias em atraso, síndico/subsíndico ficam somente leitura e
  // moradores ficam bloqueados. Se a consulta falhar (ex.: migração ainda não
  // aplicada), LIBERA — um erro aqui não pode derrubar todos os condomínios.
  const { role, condominiumId } = req.user!;
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
