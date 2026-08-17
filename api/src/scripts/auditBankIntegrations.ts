import { pool, query } from '../db';

const run = async () => {
  const result = await query<{
    name: string;
    cnpj: string | null;
    configured: boolean;
    enabled: boolean;
    updated_at: Date | null;
  }>(
    `select c.name, c.cnpj,
            (b.id is not null) as configured,
            coalesce(b.enabled, false) as enabled,
            b.updated_at
     from condominiums c
     left join condominium_bank_configurations cb on cb.condominium_id = c.id and cb.purpose = 'boleto'
     left join bank_configurations b on b.id = cb.bank_configuration_id
     order by c.name`,
  );

  console.table(result.rows.map((row) => ({
    condominio: row.name,
    cnpj: row.cnpj || 'não informado',
    integracao: row.configured ? (row.enabled ? 'ativa' : 'desabilitada') : 'não configurada',
    atualizadaEm: row.updated_at?.toISOString() || '-',
  })));
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
