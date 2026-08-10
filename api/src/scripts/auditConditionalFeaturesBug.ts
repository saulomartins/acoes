import { query } from '../db';

// Diagnóstico somente leitura para o bug corrigido em condominiumRoutes.ts
// (PATCH /:id/features): antes da correção, a primeira vez que o
// admin_geral tocava em QUALQUER funcionalidade de um condomínio sem linha
// em condominium_features criava a linha usando os defaults da COLUNA, não
// `true` para todas — e o único default divergente é enquetes/reserva_espacos
// (false). Então uma linha com as duas em false, criada bem depois do
// condomínio já existir, é o padrão do bug: ninguém pediu pra desativar
// essas duas, foi efeito colateral de mexer em outra coisa.
//
// Não é 100% garantido (um admin pode ter desativado as duas de propósito),
// por isso isso aqui só lista candidatos — a correção de dados é manual,
// script separado.
const main = async () => {
  const result = await query<{
    condominium_id: string; name: string; condominium_created_at: string;
    features_updated_at: string; updated_by: string | null; updated_by_username: string | null;
    gap_seconds: string;
  }>(
    `select
       cf.condominium_id, c.name, c.created_at as condominium_created_at,
       cf.updated_at as features_updated_at, cf.updated_by,
       u.username as updated_by_username,
       extract(epoch from (cf.updated_at - c.created_at))::text as gap_seconds
     from condominium_features cf
     join condominiums c on c.id = cf.condominium_id
     left join users u on u.id = cf.updated_by
     where cf.enquetes = false and cf.reserva_espacos = false
     order by gap_seconds desc nulls last`,
  );

  process.stdout.write(JSON.stringify({ candidateCount: result.rows.length, candidates: result.rows }, null, 2));
};

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
