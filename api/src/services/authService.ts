import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { query, withTransaction } from '../db';
import type { AccessTokenPayload, AuthenticatedUser, UserRole } from '../types';
import { sendPasswordResetEmail } from './emailService';

type DbUser = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  condominium_id: string | null;
  condominium_name?: string | null;
};

const publicUser = (user: Pick<DbUser, 'id' | 'username' | 'role' | 'condominium_id' | 'condominium_name'>): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  condominiumId: user.condominium_id,
  condominiumName: user.condominium_name || null,
});

const signAccessToken = (user: AuthenticatedUser) =>
  jwt.sign(
    {
      sub: user.id,
      id: user.id,
      username: user.username,
      role: user.role,
      condominiumId: user.condominiumId,
      condominiumName: user.condominiumName,
    },
    config.accessTokenSecret,
    { expiresIn: config.accessTokenExpiresIn } as SignOptions,
  );

const signRefreshToken = (sessionId: string, userId: string) =>
  jwt.sign({ sub: userId, sid: sessionId }, config.refreshTokenSecret, {
    expiresIn: config.refreshTokenExpiresIn,
  } as SignOptions);

const createSession = async (user: AuthenticatedUser) => {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(sessionId, user.id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date('9999-12-31T23:59:59.999Z');

  await query(
    `insert into refresh_tokens (id, user_id, token_hash, expires_at)
     values ($1, $2, $3, $4)`,
    [sessionId, user.id, refreshTokenHash, expiresAt],
  );

  return {
    token: signAccessToken(user),
    refreshToken,
    user,
  };
};

export const register = async (username: string, password: string, role: UserRole = 'admin_geral') => {
  const normalizedUsername = username.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  const created = await withTransaction(async (client) => {
    const result = await client.query<DbUser>(
      `insert into users (id, username, password_hash, role)
       values ($1, $2, $3, $4)
       returning id, username, password_hash, role, condominium_id`,
      [randomUUID(), normalizedUsername, passwordHash, role],
    );

    return result.rows[0];
  });

  return createSession(publicUser(created));
};

export const login = async (username: string, password: string) => {
  const normalizedUsername = username.trim().toLowerCase();
  const result = await query<DbUser>(
    `select u.id, u.username, u.password_hash, u.role, u.condominium_id, c.name condominium_name
     from users u left join condominiums c on c.id=u.condominium_id
     where username = $1`,
    [normalizedUsername],
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return null;
  }

  return createSession(publicUser(user));
};

export const refresh = async (refreshToken: string) => {
  const payload = jwt.verify(refreshToken, config.refreshTokenSecret) as { sub: string; sid: string };
  const sessionResult = await query<{ id: string; token_hash: string; revoked_at: Date | null }>(
    `select id, token_hash, revoked_at
     from refresh_tokens
     where id = $1 and user_id = $2 and expires_at > now()`,
    [payload.sid, payload.sub],
  );
  const session = sessionResult.rows[0];

  if (!session || session.revoked_at || !(await bcrypt.compare(refreshToken, session.token_hash))) {
    return null;
  }

  const userResult = await query<DbUser>(
    `select u.id, u.username, u.password_hash, u.role, u.condominium_id, c.name condominium_name
     from users u left join condominiums c on c.id=u.condominium_id
     where u.id = $1`,
    [payload.sub],
  );
  const user = userResult.rows[0];

  if (!user) {
    return null;
  }

  // Rotaciona sessões antigas para a política persistente atual.
  const response = await createSession(publicUser(user));
  await query(`update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`, [payload.sid]);
  return response;
};

export const revokeRefreshToken = async (refreshToken: string) => {
  const payload = jwt.verify(refreshToken, config.refreshTokenSecret) as { sid: string };

  await query(
    `update refresh_tokens
     set revoked_at = now()
     where id = $1 and revoked_at is null`,
    [payload.sid],
  );
};

const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const requestPasswordReset = async (email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await query<{ id: string; username: string; full_name: string | null; email: string }>(
    `select id,username,full_name,email from users
     where lower(email)= $1 and login_enabled=true limit 2`,
    [normalizedEmail],
  );
  // E-mails duplicados não podem identificar com segurança qual conta deve ser alterada.
  if (users.rows.length !== 1) return;

  const user = users.rows[0];
  const token = randomBytes(32).toString('hex');
  const id = randomUUID();
  await query(
    `insert into password_reset_tokens(id,user_id,token_hash,expires_at)
     values($1,$2,$3,now() + interval '30 minutes')`,
    [id, user.id, hashResetToken(token)],
  );
  try {
    await sendPasswordResetEmail(user.email, user.full_name || user.username, token);
  } catch (error) {
    await query(`delete from password_reset_tokens where id=$1`, [id]).catch(() => null);
    throw error;
  }
};

export const resetPassword = async (token: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, 10);
  return withTransaction(async client => {
    const result = await client.query<{ id: string; user_id: string }>(
      `select id,user_id from password_reset_tokens
       where token_hash=$1 and used_at is null and expires_at>now() for update`,
      [hashResetToken(token)],
    );
    const reset = result.rows[0];
    if (!reset) return false;

    await client.query(`update users set password_hash=$1 where id=$2`, [passwordHash, reset.user_id]);
    await client.query(`update password_reset_tokens set used_at=now() where id=$1`, [reset.id]);
    await client.query(`update password_reset_tokens set used_at=coalesce(used_at,now()) where user_id=$1`, [reset.user_id]);
    await client.query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [reset.user_id]);
    return true;
  });
};

export const verifyAccessToken = (token: string): AuthenticatedUser => {
  const payload = jwt.verify(token, config.accessTokenSecret) as AccessTokenPayload;

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    condominiumId: payload.condominiumId,
    condominiumName: payload.condominiumName,
  };
};
