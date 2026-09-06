import { query } from '../db';

// Unidades cujos débitos o usuário pode VISUALIZAR além da própria (registro
// de propriedade em unit_ownerships). Uso restrito a endpoints de leitura —
// nunca habilita ações (pagar, sincronizar, aceitar acordo), que continuam
// restritas a quem responde pela cobrança.
export const getOwnedUnitIds = async (userId: string): Promise<string[]> => {
  const result = await query<{ unit_id: string }>(
    `select unit_id from unit_ownerships where owner_user_id=$1 and ended_at is null`,
    [userId],
  );
  return result.rows.map(row => row.unit_id);
};

// Unidades onde o usuário é o representante atual (unit_occupancies).
// Cobre o caso do inquilino que mora na unidade mas não é o responsável
// financeiro (Blocos e unidades > Definir financeiro é o proprietário) —
// ele ainda precisa ver os boletos/Gestão de cobranças da própria unidade.
// Mesmo uso restrito a leitura do getOwnedUnitIds acima: nunca habilita
// ações (sincronizar manualmente, aceitar acordo), só visualizar.
export const getRepresentedUnitIds = async (userId: string): Promise<string[]> => {
  const result = await query<{ unit_id: string }>(
    `select unit_id from unit_occupancies where user_id=$1 and ended_at is null and is_representative=true`,
    [userId],
  );
  return result.rows.map(row => row.unit_id);
};
