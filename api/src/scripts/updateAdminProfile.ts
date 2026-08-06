import bcrypt from 'bcrypt';
import { pool, query, withTransaction } from '../db';

// Promove a conta com este e-mail a admin_geral (username/senha/nome abaixo)
// e remove qualquer outra conta admin_geral existente. Ajuste aqui antes de
// rodar em outro cenário.
const TARGET = {
  fullName: 'Saulo Martins da Costa Oliveira',
  username: 'admin',
  password: 'Sa@159753',
  email: 'saulomartins.costa@gmail.com',
};

const run = async () => {
  const normalizedEmail = TARGET.email.trim().toLowerCase();
  const normalizedUsername = TARGET.username.trim().toLowerCase();

  const personResult = await query<{ id: string; username: string; role: string; full_name: string | null }>(
    `select id, username, role, full_name from users where lower(email) = $1`,
    [normalizedEmail],
  );
  if (personResult.rows.length !== 1) {
    throw new Error(personResult.rows.length === 0
      ? `Nenhuma conta encontrada com o e-mail "${TARGET.email}".`
      : `Mais de uma conta encontrada com o e-mail "${TARGET.email}" — resolva a duplicidade antes de rodar este script.`);
  }
  const person = personResult.rows[0];

  const oldAdmins = await query<{ id: string; username: string }>(
    `select id, username from users where role = 'admin_geral' and id <> $1`,
    [person.id],
  );

  const passwordHash = await bcrypt.hash(TARGET.password, 10);

  await withTransaction(async (client) => {
    for (const oldAdmin of oldAdmins.rows) {
      try {
        await client.query(`delete from users where id=$1`, [oldAdmin.id]);
      } catch (error: any) {
        if (error?.code === '23503') {
          throw new Error(`Não foi possível excluir a conta admin antiga "${oldAdmin.username}": existem registros vinculados a ela. Resolva manualmente antes de rodar este script.`);
        }
        throw error;
      }
    }

    const usernameConflict = await client.query(`select id from users where lower(username) = $1 and id <> $2`, [normalizedUsername, person.id]);
    if (usernameConflict.rows[0]) {
      throw new Error(`O nome de usuário "${normalizedUsername}" já está em uso por outra conta que não pôde ser resolvida automaticamente.`);
    }

    await client.query(
      `update users set role='admin_geral', username=$1, full_name=$2, password_hash=$3, email=$4, condominium_id=null, unit_id=null, unit=null where id=$5`,
      [normalizedUsername, TARGET.fullName, passwordHash, normalizedEmail, person.id],
    );

    await client.query(`update unit_occupancies set ended_at=current_date, is_representative=false where user_id=$1 and ended_at is null`, [person.id]);
  });

  console.log('Conta promovida a admin_geral com sucesso.');
  console.log(`  conta usada: username antigo="${person.username}" (era ${person.role}) -> username novo="${normalizedUsername}"`);
  console.log(`  contas admin_geral antigas removidas: ${oldAdmins.rows.map((a) => a.username).join(', ') || 'nenhuma'}`);
};

run()
  .catch((error) => {
    console.error('Falha ao atualizar admin:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
