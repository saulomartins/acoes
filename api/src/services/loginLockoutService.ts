import { query } from '../db';

// Bloqueio por conta no login: 5 senhas erradas em 15 min travam aquele
// identificador (usuário, CPF ou e-mail digitado) por 15 min. Até 12/11/2026
// ficava num Map em memória e zerava a cada deploy/reinício — agora fica em
// login_failures. Se o banco falhar, LIBERA (mesma política das outras
// checagens auxiliares): o login em si continua exigindo a senha certa.
export const LOGIN_MAX_FAILURES = 5;
const WINDOW = `interval '15 minutes'`;

export const isLoginLocked = async (identifier: string) => {
  try {
    const result = await query<{ locked: boolean }>(
      `select coalesce(locked_until > now(), false) locked from login_failures where identifier=$1`,
      [identifier],
    );
    return result.rows[0]?.locked ?? false;
  } catch (error) {
    console.warn('login lockout check failed — allowing', error);
    return false;
  }
};

export const registerLoginFailure = async (identifier: string) => {
  try {
    await query(
      `insert into login_failures(identifier,failures,window_reset_at,locked_until) values($1,1,now()+${WINDOW},null)
       on conflict (identifier) do update set
         failures = case when login_failures.window_reset_at <= now() then 1 else login_failures.failures + 1 end,
         window_reset_at = case when login_failures.window_reset_at <= now() then now()+${WINDOW} else login_failures.window_reset_at end,
         locked_until = case
           when (case when login_failures.window_reset_at <= now() then 1 else login_failures.failures + 1 end) >= $2 then now()+${WINDOW}
           else login_failures.locked_until end`,
      [identifier, LOGIN_MAX_FAILURES],
    );
    // Limpeza barata: tabela pequena, linhas velhas não servem para nada.
    await query(`delete from login_failures where window_reset_at < now() - interval '1 day' and (locked_until is null or locked_until < now())`);
  } catch (error) {
    console.warn('login failure register failed', error);
  }
};

export const clearLoginFailures = async (identifier: string) => {
  try {
    await query(`delete from login_failures where identifier=$1`, [identifier]);
  } catch (error) {
    console.warn('login failure clear failed', error);
  }
};
