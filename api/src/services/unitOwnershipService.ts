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
