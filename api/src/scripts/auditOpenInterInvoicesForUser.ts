import { query } from '../db';
import { discoverOpenInterInvoices, getInterIntegration } from '../routes/invoiceRoutes';
import { listInterBoletosByPayer } from '../services/interService';

const main = async () => {
  const search = (process.argv[2] || '').trim();
  if (!search) throw new Error('Informe parte do nome ou usuário.');
  const users = await query<{ id: string; condominium_id: string | null; cpf: string | null; role: string; username: string }>(
    `select id, condominium_id, cpf, role, username
     from users
     where full_name ilike $1 or username ilike $1
     order by created_at desc`,
    [`%${search}%`],
  );
  const year = new Date().getUTCFullYear();
  const results = [];
  for (const user of users.rows) {
    const localInvoices = await query<{ total: string; open: string }>(
      `select count(*)::text total,
              count(*) filter (where status not in ('paid'::invoice_status,'canceled'::invoice_status))::text open
       from invoices where user_id=$1`,
      [user.id],
    );
    const cpf = (user.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) {
      results.push({ username: user.username, role: user.role, hasCondominium: Boolean(user.condominium_id),
        validCpf: false, localInvoices: Number(localInvoices.rows[0]?.total || 0),
        localOpen: Number(localInvoices.rows[0]?.open || 0), bankCharges: 0, openCharges: 0 });
      continue;
    }
    if (!user.condominium_id) {
      results.push({ username: user.username, role: user.role, hasCondominium: false,
        validCpf: true, localInvoices: Number(localInvoices.rows[0]?.total || 0),
        localOpen: Number(localInvoices.rows[0]?.open || 0), bankConfigured: false, bankCharges: 0, openCharges: 0 });
      continue;
    }
    const integration = await getInterIntegration(user.condominium_id);
    if (!integration) {
      results.push({ username: user.username, role: user.role, hasCondominium: true,
        validCpf: true, localInvoices: Number(localInvoices.rows[0]?.total || 0),
        localOpen: Number(localInvoices.rows[0]?.open || 0), bankConfigured: false, bankCharges: 0, openCharges: 0 });
      continue;
    }
    const charges = await listInterBoletosByPayer(cpf, `${year - 10}-01-01`, `${year + 10}-12-31`, integration);
    const open = charges.filter(item => ['A_RECEBER', 'ATRASADO'].includes(item.cobranca?.situacao));
    const sample = open[0] ? {
      itemKeys: Object.keys(open[0]),
      chargeKeys: Object.keys(open[0].cobranca || {}),
      payerKeys: Object.keys(open[0].cobranca?.pagador || {}),
      payerDocumentMatches: (open[0].cobranca?.pagador?.cpfCnpj || '').replace(/\D/g, '') === cpf,
      validDueDate: /^\d{4}-\d{2}-\d{2}$/.test(open[0].cobranca?.dataVencimento || ''),
      validAmount: Number.isFinite(Number(open[0].cobranca?.valorNominal)),
    } : null;
    const imported = process.argv.includes('--import')
      ? await discoverOpenInterInvoices(user.id, user.condominium_id)
      : null;
    results.push({ username: user.username, role: user.role, hasCondominium: true,
      validCpf: true, localInvoices: Number(localInvoices.rows[0]?.total || 0),
      localOpen: Number(localInvoices.rows[0]?.open || 0), bankConfigured: true,
      bankCharges: charges.length, openCharges: open.length, sample, imported });
  }
  process.stdout.write(JSON.stringify({ matchedUsers: users.rows.length, results }));
};

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
