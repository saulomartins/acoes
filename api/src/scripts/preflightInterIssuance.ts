import { pool, query } from '../db';

const cpf = '06433771661';

(async () => {
  const result = await query<{
    id: string;
    full_name: string | null;
    unit: string | null;
    unit_type: string | null;
    fee_cents: number | null;
    address_complete: boolean;
    invoice_count: number;
    guard_count: number;
  }>(
    `select u.id, u.full_name, u.unit, ut.name as unit_type, ut.fee_cents,
            (u.street is not null and u.address_number is not null and u.neighborhood is not null
             and u.city is not null and u.state is not null and u.postal_code is not null) as address_complete,
            (select count(*)::int from invoices i where i.user_id = u.id and i.provider = 'inter') as invoice_count,
            (select count(*)::int from inter_issuance_guards g where g.payer_cpf = $1) as guard_count
     from users u
     left join units un on un.id = u.unit_id left join unit_types ut on ut.id = un.unit_type_id
     where regexp_replace(coalesce(u.cpf, ''), '[^0-9]', '', 'g') = $1`,
    [cpf],
  );

  if (result.rows.length !== 1) throw new Error(`Expected one matching person, found ${result.rows.length}`);
  const person = result.rows[0];
  console.log(JSON.stringify({
    name: person.full_name,
    cpf,
    unit: person.unit,
    unitType: person.unit_type,
    amount: person.fee_cents == null ? null : (person.fee_cents / 100).toFixed(2),
    dueDate: '2026-07-20',
    addressComplete: person.address_complete,
    existingInterInvoices: person.invoice_count,
    issuanceGuardReservations: person.guard_count,
  }, null, 2));
})()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
