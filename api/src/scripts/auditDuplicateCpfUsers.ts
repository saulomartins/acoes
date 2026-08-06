import { query } from '../db';

// Diagnóstico somente leitura: encontra CPFs cadastrados em mais de um usuário
// (ex.: a mesma pessoa com uma conta admin_geral e outra como morador) e mostra
// quantos boletos cada uma dessas contas tem. Se um boleto ficar vinculado à
// conta "errada" (a que a pessoa não usa para logar), ele nunca aparece pra
// ela — mesmo existindo corretamente no sistema.
const main = async () => {
  const duplicates = await query<{ cpf: string; ids: string[] }>(
    `select cpf, array_agg(id order by created_at) ids
     from users
     where cpf is not null and length(regexp_replace(cpf,'\\D','','g'))=11 and deleted_at is null
     group by cpf
     having count(*) > 1`,
  );

  const results = [];
  for (const row of duplicates.rows) {
    const usersResult = await query<{ id: string; username: string; full_name: string | null; role: string; condominium_id: string | null; login_enabled: boolean }>(
      `select id, username, full_name, role, condominium_id, login_enabled from users where id = any($1::uuid[]) order by created_at`,
      [row.ids],
    );
    const accounts = [];
    for (const user of usersResult.rows) {
      const invoicesResult = await query<{ total: string; open: string }>(
        `select count(*)::text total, count(*) filter (where status not in ('paid'::invoice_status,'canceled'::invoice_status))::text open
         from invoices where user_id=$1`,
        [user.id],
      );
      accounts.push({
        id: user.id, username: user.username, fullName: user.full_name, role: user.role,
        hasCondominium: Boolean(user.condominium_id), loginEnabled: user.login_enabled,
        totalInvoices: Number(invoicesResult.rows[0]?.total || 0), openInvoices: Number(invoicesResult.rows[0]?.open || 0),
      });
    }
    results.push({ cpf: row.cpf, accounts });
  }

  process.stdout.write(JSON.stringify({ duplicateCpfCount: results.length, results }, null, 2));
};

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
