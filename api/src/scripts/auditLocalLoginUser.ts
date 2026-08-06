import { query } from '../db';

const main = async () => {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  if (!username) throw new Error('Informe o usuário.');
  if (process.argv.includes('--enable')) {
    await query(`update users set login_enabled=true where lower(username)=$1 and deleted_at is null`, [username]);
  }
  const result = await query<{
    username: string;
    role: string;
    login_enabled: boolean;
    deleted_at: Date | null;
    must_change_password: boolean;
    condominium_id: string | null;
    has_password: boolean;
  }>(
    `select username, role, login_enabled, deleted_at, must_change_password, condominium_id,
            (password_hash is not null and length(password_hash) > 20) as has_password
     from users where lower(username)=$1`,
    [username],
  );
  process.stdout.write(JSON.stringify({
    matches: result.rows.length,
    users: result.rows.map(user => ({
      username: user.username,
      role: user.role,
      loginEnabled: user.login_enabled,
      deleted: Boolean(user.deleted_at),
      mustChangePassword: user.must_change_password,
      hasCondominium: Boolean(user.condominium_id),
      hasPasswordHash: user.has_password,
    })),
  }));
};

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
