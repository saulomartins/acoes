import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { query, withTransaction } from '../db';
import type { AccessTokenPayload, AuthenticatedUser, UserRole } from '../types';
import { sendPasswordResetEmail } from './emailService';
import { checkAndSendPlatformInvoice } from './platformInvoiceService';

type DbUser = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  condominium_id: string | null;
  condominium_name?: string | null;
  full_name: string | null;
  must_change_password: boolean;
  terms_accepted_version: string | null;
  terms_accepted_at: Date | null;
  tour_completed_version: string | null;
  tour_completed_at: Date | null;
};

const publicUser = (user: Pick<DbUser, 'id' | 'username' | 'role' | 'condominium_id' | 'condominium_name' | 'full_name' | 'must_change_password' | 'terms_accepted_version' | 'terms_accepted_at' | 'tour_completed_version' | 'tour_completed_at'>): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  condominiumId: user.condominium_id,
  condominiumName: user.condominium_name || null,
  fullName: user.full_name || null,
  mustChangePassword: user.must_change_password,
  termsAcceptedVersion: user.terms_accepted_version || null,
  termsAcceptedAt: user.terms_accepted_at?.toISOString() || null,
  tourCompletedVersion: user.tour_completed_version || null,
  tourCompletedAt: user.tour_completed_at?.toISOString() || null,
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
      mustChangePassword: user.mustChangePassword,
      activeProfileId: user.activeProfileId ?? null,
    },
    config.accessTokenSecret,
    { expiresIn: config.accessTokenExpiresIn } as SignOptions,
  );

const signRefreshToken = (sessionId: string, userId: string) =>
  jwt.sign({ sub: userId, sid: sessionId }, config.refreshTokenSecret, {
    expiresIn: config.refreshTokenExpiresIn,
  } as SignOptions);

// Grava `user.activeProfileId` na sessão (refresh_tokens.active_profile_id) —
// é o que permite um /auth/refresh em segundo plano restaurar o mesmo perfil
// trocado via switchProfile, em vez de reverter pro perfil padrão.
const createSession = async (user: AuthenticatedUser) => {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(sessionId, user.id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date('9999-12-31T23:59:59.999Z');

  await query(
    `insert into refresh_tokens (id, user_id, token_hash, expires_at, active_profile_id)
     values ($1, $2, $3, $4, $5)`,
    [sessionId, user.id, refreshTokenHash, expiresAt, user.activeProfileId ?? null],
  );

  return {
    token: signAccessToken(user),
    refreshToken,
    user,
  };
};

const findUserById = async (id: string) => {
  const result = await query<DbUser>(
    `select u.id, u.username, u.password_hash, u.role, u.condominium_id, u.full_name, u.must_change_password, u.terms_accepted_version, u.terms_accepted_at, u.tour_completed_version, u.tour_completed_at, c.name condominium_name
     from users u left join condominiums c on c.id=u.condominium_id
     where u.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

// Resolve o perfil ativo de uma sessão em role/condominiumId/condominiumName
// concretos. null = perfil padrão (a própria linha em `users`). Se o perfil
// foi removido nesse meio tempo (gestor revogou), cai pro padrão em vez de
// falhar — quem chama decide se quer persistir essa queda.
const resolveActiveProfile = async (
  activeProfileId: string | null,
  baseUser: DbUser,
): Promise<Pick<AuthenticatedUser, 'role' | 'condominiumId' | 'condominiumName' | 'activeProfileId'>> => {
  if (activeProfileId) {
    const result = await query<{ role: UserRole; condominium_id: string; condominium_name: string | null }>(
      `select p.role, p.condominium_id, c.name condominium_name
       from user_profiles p join condominiums c on c.id=p.condominium_id
       where p.id=$1 and p.user_id=$2`,
      [activeProfileId, baseUser.id],
    );
    const profile = result.rows[0];
    if (profile) {
      return { role: profile.role, condominiumId: profile.condominium_id, condominiumName: profile.condominium_name, activeProfileId };
    }
  }
  return { role: baseUser.role, condominiumId: baseUser.condominium_id, condominiumName: baseUser.condominium_name || null, activeProfileId: null };
};

// Valida um refresh token (assinatura, sessão existente, hash, revogação) e
// aplica a mesma detecção de reuso de /auth/refresh — usado tanto por
// refresh() quanto por switchProfile(), que compartilham exatamente essa
// validação antes de decidir qual perfil ativar.
const validateRefreshSession = async (refreshToken: string) => {
  const payload = jwt.verify(refreshToken, config.refreshTokenSecret) as { sub: string; sid: string };
  const sessionResult = await query<{ id: string; token_hash: string; revoked_at: Date | null; active_profile_id: string | null }>(
    `select id, token_hash, revoked_at, active_profile_id
     from refresh_tokens
     where id = $1 and user_id = $2 and expires_at > now()`,
    [payload.sid, payload.sub],
  );
  const session = sessionResult.rows[0];

  if (!session || !(await bcrypt.compare(refreshToken, session.token_hash))) {
    return null;
  }

  if (session.revoked_at) {
    // O hash bate com um token já rotacionado (revogado) — isso só acontece
    // se alguém reapresentar um refresh token antigo que já foi trocado por
    // um novo, sinal de que o token vazou. Resposta: derruba todas as
    // sessões ativas do usuário, não só nega esta tentativa.
    await query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [payload.sub]);
    return null;
  }

  return { sid: payload.sid as string, userId: payload.sub as string, activeProfileId: session.active_profile_id };
};

export const register = async (username: string, password: string, role: UserRole = 'admin_geral') => {
  const normalizedUsername = username.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  const created = await withTransaction(async (client) => {
    const result = await client.query<DbUser>(
      `insert into users (id, username, password_hash, role)
       values ($1, $2, $3, $4)
       returning id, username, password_hash, role, condominium_id, full_name, must_change_password, terms_accepted_version, terms_accepted_at, tour_completed_version, tour_completed_at`,
      [randomUUID(), normalizedUsername, passwordHash, role],
    );

    return result.rows[0];
  });

  return createSession(publicUser(created));
};

export const login = async (username: string, password: string) => {
  const normalizedUsername = username.trim().toLowerCase();
  const result = await query<DbUser & { login_enabled: boolean }>(
    `select u.id, u.username, u.password_hash, u.role, u.condominium_id, u.full_name, u.must_change_password, u.terms_accepted_version, u.terms_accepted_at, u.tour_completed_version, u.tour_completed_at, u.login_enabled, c.name condominium_name
     from users u left join condominiums c on c.id=u.condominium_id
     where username = $1`,
    [normalizedUsername],
  );
  const user = result.rows[0];

  if (!user || !user.login_enabled || !(await bcrypt.compare(password, user.password_hash))) {
    return null;
  }

  if ((user.role === 'sindico' || user.role === 'subsindico') && user.condominium_id) {
    // Verificação sob demanda da fatura da plataforma: dispara no login, sem
    // bloquear a resposta nem derrubar o login se e-mail/push falharem.
    checkAndSendPlatformInvoice(user.condominium_id).catch(error => console.warn('platform invoice check failed', error));
  }

  return createSession(publicUser(user));
};

export const refresh = async (refreshToken: string) => {
  const session = await validateRefreshSession(refreshToken);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) return null;

  // Preserva o perfil ativo (se algum) através de uma renovação silenciosa —
  // sem isso, o app trocaria de volta pro perfil padrão a cada refresh.
  const activeProfile = await resolveActiveProfile(session.activeProfileId, user);

  // Rotaciona sessões antigas para a política persistente atual.
  const response = await createSession({ ...publicUser(user), ...activeProfile });
  await query(`update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`, [session.sid]);
  return response;
};

// Perfis disponíveis para este login: o padrão (a própria linha em `users`,
// id null) seguido dos adicionais concedidos em `user_profiles`.
export const listProfiles = async (userId: string) => {
  const base = await query<{ role: UserRole; condominium_id: string | null; condominium_name: string | null }>(
    `select u.role, u.condominium_id, c.name condominium_name
     from users u left join condominiums c on c.id=u.condominium_id
     where u.id=$1`,
    [userId],
  );
  const baseRow = base.rows[0];
  const extra = await query<{ id: string; role: UserRole; condominium_id: string; condominium_name: string | null }>(
    `select p.id, p.role, p.condominium_id, c.name condominium_name
     from user_profiles p join condominiums c on c.id=p.condominium_id
     where p.user_id=$1
     order by p.created_at`,
    [userId],
  );

  return [
    ...(baseRow ? [{ id: null as string | null, role: baseRow.role, condominiumId: baseRow.condominium_id, condominiumName: baseRow.condominium_name }] : []),
    ...extra.rows.map(row => ({ id: row.id as string | null, role: row.role, condominiumId: row.condominium_id, condominiumName: row.condominium_name })),
  ];
};

// Troca o perfil ativo da sessão sem pedir senha de novo: valida o refresh
// token exatamente como refresh() (mesma detecção de reuso), confirma que o
// profileId pedido pertence a este login, e rotaciona a sessão já com o
// novo perfil ativo.
export const switchProfile = async (refreshToken: string, profileId: string | null) => {
  const session = await validateRefreshSession(refreshToken);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) return null;

  if (profileId) {
    const owned = await query(`select id from user_profiles where id=$1 and user_id=$2`, [profileId, user.id]);
    if (!owned.rows[0]) return null;
  }

  const activeProfile = await resolveActiveProfile(profileId, user);
  const response = await createSession({ ...publicUser(user), ...activeProfile });
  await query(`update refresh_tokens set revoked_at = now() where id = $1 and revoked_at is null`, [session.sid]);
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

    await client.query(`update users set password_hash=$1, must_change_password=false where id=$2`, [passwordHash, reset.user_id]);
    await client.query(`update password_reset_tokens set used_at=now() where id=$1`, [reset.id]);
    await client.query(`update password_reset_tokens set used_at=coalesce(used_at,now()) where user_id=$1`, [reset.user_id]);
    await client.query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [reset.user_id]);
    return true;
  });
};

export const changePassword = async (userId: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query<DbUser>(
    `update users set password_hash=$1, must_change_password=false where id=$2
     returning id, username, password_hash, role, condominium_id, full_name, must_change_password, terms_accepted_version, terms_accepted_at, tour_completed_version, tour_completed_at`,
    [passwordHash, userId],
  );
  const user = result.rows[0];
  if (!user) return null;
  const condominium = await query<{ name: string | null }>(`select name from condominiums where id=$1`, [user.condominium_id]);
  return publicUser({ ...user, condominium_name: condominium.rows[0]?.name || null });
};

export const verifyAccessToken = (token: string): AuthenticatedUser => {
  const payload = jwt.verify(token, config.accessTokenSecret) as AccessTokenPayload;

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    condominiumId: payload.condominiumId,
    condominiumName: payload.condominiumName,
    mustChangePassword: payload.mustChangePassword,
    activeProfileId: payload.activeProfileId ?? null,
  };
};
