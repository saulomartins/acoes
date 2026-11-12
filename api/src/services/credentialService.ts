import bcrypt from 'bcrypt';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { query } from '../db';
import { hashResetToken } from './authService';
import { sendAccessLinkEmail } from './emailService';

// Acesso emitido pela administração (cadastro novo, "Resetar senha",
// "Reenviar e-mail de acesso"). Até 12/11/2026 a senha era CALCULADA a partir
// do cadastro (apartamento + 4 dígitos do CPF; síndico = 6 dígitos do CPF):
// quem soubesse o CPF entrava, e o reset gerava sempre a mesma senha. Agora:
//
// - com e-mail: link de uso único para a própria pessoa criar a senha (mesmo
//   mecanismo do "Esqueci minha senha", com prazo maior). Ninguém — nem o
//   síndico — conhece a senha;
// - sem e-mail (ou se o envio falhar, ou se o gestor pedir): senha temporária
//   ALEATÓRIA, exibida uma única vez para o gestor repassar.
//
// Nos dois casos a senha anterior deixa de valer na hora e o acesso vence em
// 72 h (users.temporary_password_expires_at, conferido no login).
export const TEMPORARY_CREDENTIAL_TTL_MS = 72 * 60 * 60_000;

// Sem 0/O, 1/I/L: a senha costuma ser ditada ou copiada à mão.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const generateTemporaryPassword = () =>
  Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-');

export type CredentialDelivery = {
  delivery: 'email_link' | 'temporary_password';
  // Só preenchida em 'temporary_password' — e só nesta resposta.
  temporaryPassword: string | null;
  emailSent: boolean;
  expiresAt: string;
};

type CredentialTarget = { id: string; email: string | null; full_name: string | null; username: string };

export const issueAccessCredential = async (
  target: CredentialTarget,
  options: { kind: 'welcome' | 'reset'; condominiumName: string; forceTemporaryPassword?: boolean },
): Promise<CredentialDelivery> => {
  const expiresAt = new Date(Date.now() + TEMPORARY_CREDENTIAL_TTL_MS);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await query(
    `update users set password_hash=$1, must_change_password=true, temporary_password_expires_at=$2,
       login_enabled=case when deleted_at is null then true else login_enabled end
     where id=$3`,
    [passwordHash, expiresAt, target.id],
  );
  // Senha nova derruba as sessões abertas e os links de acesso anteriores.
  await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [target.id]);
  await query(`update password_reset_tokens set used_at=coalesce(used_at,now()) where user_id=$1`, [target.id]);

  const email = target.email?.trim();
  if (email && !options.forceTemporaryPassword) {
    const token = randomBytes(32).toString('hex');
    const tokenId = randomUUID();
    await query(
      `insert into password_reset_tokens(id,user_id,token_hash,expires_at) values($1,$2,$3,$4)`,
      [tokenId, target.id, hashResetToken(token), expiresAt],
    );
    try {
      const result = await sendAccessLinkEmail({
        to: email,
        name: target.full_name || target.username,
        username: target.username,
        condominiumName: options.condominiumName,
        token,
        kind: options.kind,
        expiresAt,
      });
      if (result.status === 'sent') {
        return { delivery: 'email_link', temporaryPassword: null, emailSent: true, expiresAt: expiresAt.toISOString() };
      }
    } catch (error) {
      console.error('Falha ao enviar o link de acesso — devolvendo senha temporária ao gestor', { userId: target.id, error });
    }
    // E-mail não saiu: o link não serve para nada, a senha temporária sim.
    await query(`update password_reset_tokens set used_at=now() where id=$1`, [tokenId]);
  }

  return { delivery: 'temporary_password', temporaryPassword, emailSent: false, expiresAt: expiresAt.toISOString() };
};
