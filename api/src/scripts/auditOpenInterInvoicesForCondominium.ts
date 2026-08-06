import { query } from '../db';
import { getInterIntegration } from '../routes/invoiceRoutes';
import { listInterBoletosByPayer } from '../services/interService';

const main = async () => {
  const condominiumId = (process.argv[2] || '').trim();
  if (!condominiumId) throw new Error('Informe o condominium_id.');

  const integration = await getInterIntegration(condominiumId);
  if (!integration) throw new Error('Integração Banco Inter não configurada para este condomínio.');

  const usersResult = await query<{ id: string; cpf: string | null; full_name: string | null }>(
    `select id, cpf, full_name from users where condominium_id=$1 and deleted_at is null`, [condominiumId],
  );
  const userByCpf = new Map<string, string>();
  let usersWithoutValidCpf = 0;
  for (const row of usersResult.rows) {
    const cpf = (row.cpf || '').replace(/\D/g, '');
    if (cpf.length === 11) userByCpf.set(cpf, row.full_name || row.id);
    else usersWithoutValidCpf += 1;
  }

  const localInvoices = await query<{ status: string; count: string }>(
    `select status::text, count(*)::text from invoices where condominium_id=$1 group by status`, [condominiumId],
  );

  const year = new Date().getUTCFullYear();
  const start = `${year - 10}-01-01`;
  const end = `${year + 10}-12-31`;
  const charges = await listInterBoletosByPayer(null, start, end, integration);

  const situacaoCounts: Record<string, number> = {};
  const unmatched: Array<{ payerName?: string; payerDocument: string; situacao: string; dueDate: string }> = [];
  for (const item of charges) {
    const situacao = item.cobranca?.situacao || 'DESCONHECIDA';
    situacaoCounts[situacao] = (situacaoCounts[situacao] || 0) + 1;
    if (['A_RECEBER', 'ATRASADO'].includes(situacao)) {
      const doc = (item.cobranca?.pagador?.cpfCnpj || '').replace(/\D/g, '');
      if (!userByCpf.has(doc)) {
        unmatched.push({
          payerName: item.cobranca?.pagador?.nome,
          payerDocument: doc,
          situacao,
          dueDate: item.cobranca?.dataVencimento,
        });
      }
    }
  }

  process.stdout.write(JSON.stringify({
    condominiumId,
    usersTotal: usersResult.rows.length,
    usersWithoutValidCpf,
    localInvoicesByStatus: Object.fromEntries(localInvoices.rows.map(r => [r.status, Number(r.count)])),
    bankChargesTotal: charges.length,
    bankSituacaoCounts: situacaoCounts,
    openMatched: (situacaoCounts.A_RECEBER || 0) + (situacaoCounts.ATRASADO || 0) - unmatched.length,
    openUnmatched: unmatched,
  }, null, 2));
};

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
