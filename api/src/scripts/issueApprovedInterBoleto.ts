import { randomUUID } from 'crypto';
import { pool, query } from '../db';
import { createInterBoleto, type InterIntegrationConfig } from '../services/interService';

const approvedCpf = '06433771661';
const approvedAmountCents = 24081;
const approvedDueDate = '2026-07-20';

type Person = {
  id: string; condominium_id: string; full_name: string; cpf: string; email: string | null; phone: string | null;
  unit: string | null; street: string; address_number: string; address_complement: string | null;
  neighborhood: string; city: string; state: string; postal_code: string; fee_cents: number; unit_type_name: string | null;
};

type IntegrationRow = {
  id: string; client_id: string; client_secret: string; cert_path: string; key_path: string;
  cert_passphrase: string | null; base_url: string; token_path: string; scopes: string; enabled: boolean;
};

(async () => {
  const personResult = await query<Person>(
    `select u.id, u.condominium_id, u.full_name, u.cpf, u.email, u.phone, u.unit,
            u.street, u.address_number, u.address_complement, u.neighborhood, u.city, u.state, u.postal_code,
            ut.fee_cents, ut.name as unit_type_name
     from users u join units un on un.id = u.unit_id join unit_types ut on ut.id = un.unit_type_id
     where regexp_replace(coalesce(u.cpf, ''), '[^0-9]', '', 'g') = $1`,
    [approvedCpf],
  );
  if (personResult.rows.length !== 1) throw new Error(`Expected exactly one approved payer, found ${personResult.rows.length}`);
  const payer = personResult.rows[0];
  if (payer.fee_cents !== approvedAmountCents) throw new Error(`Amount changed: expected ${approvedAmountCents}, found ${payer.fee_cents}`);

  const integrationResult = await query<IntegrationRow>(
    `select id, client_id, client_secret, cert_path, key_path, cert_passphrase, base_url, token_path, scopes, enabled
     from inter_integrations where condominium_id = $1`,
    [payer.condominium_id],
  );
  const row = integrationResult.rows[0];
  if (!row || !row.enabled) throw new Error('Banco Inter integration is missing or disabled');
  if (new URL(row.base_url).host !== 'cdpj.partners.bancointer.com.br') throw new Error('Expected Banco Inter production endpoint');

  await query(`insert into inter_issuance_guards (payer_cpf, user_id) values ($1, $2)`, [approvedCpf, payer.id]);

  const integration: InterIntegrationConfig = {
    id: row.id, clientId: row.client_id, clientSecret: row.client_secret, certPath: row.cert_path,
    keyPath: row.key_path, certPassphrase: row.cert_passphrase, baseUrl: row.base_url,
    tokenPath: row.token_path, scopes: row.scopes, enabled: row.enabled,
  };
  const boleto = await createInterBoleto({
    payerName: payer.full_name, payerDocument: approvedCpf, amountCents: approvedAmountCents,
    dueDate: approvedDueDate, description: `Taxa condominial - ${payer.unit_type_name || payer.unit || 'unidade'}`,
    payerEmail: payer.email, payerPhone: payer.phone, payerStreet: payer.street,
    payerNumber: payer.address_number, payerComplement: payer.address_complement,
    payerNeighborhood: payer.neighborhood, payerCity: payer.city, payerState: payer.state,
    payerPostalCode: payer.postal_code, payerUnit: payer.unit,
  }, integration);

  console.log(`INTER_ACCEPTED codigoSolicitacao=${boleto.externalId}`);
  const invoiceId = randomUUID();
  await query(
    `insert into invoices (id, condominium_id, user_id, expense_id, amount_cents, due_date, status,
       provider, external_id, digitable_line, pdf_url)
     values ($1, $2, $3, null, $4, $5, 'pending_provider', $6, $7, $8, $9)`,
    [invoiceId, payer.condominium_id, payer.id, approvedAmountCents, approvedDueDate,
      boleto.provider, boleto.externalId, boleto.digitableLine, boleto.pdfUrl],
  );
  await query(`update inter_issuance_guards set invoice_id = $1 where payer_cpf = $2`, [invoiceId, approvedCpf]);
  console.log(`INVOICE_SAVED invoiceId=${invoiceId} amount=240.81 dueDate=${approvedDueDate}`);
})()
  .catch((error: any) => {
    if (error?.code === '23505') console.error('ISSUANCE_BLOCKED: the one-time CPF authorization was already used.');
    else console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
