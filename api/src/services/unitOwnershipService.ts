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

// Proprietário que NÃO mora na unidade ("Quem mora de fato na unidade?" =
// outra pessoa, users.unit_rented_to_tenant): fica só com a posse
// (unit_ownerships) — acompanha os débitos, recebe avisos e vota em
// enquetes, mas nunca é morador, representante nem responsável financeiro.
// Se ele era o representante, o morador restante vinculado mais
// recentemente assume, mesma regra da troca de unidade em PUT /users/:id.
export const setOwnerAsMonitoring = async (unitId: string, userId: string, createdBy?: string) => {
  await query(
    `update unit_occupancies set ended_at=current_date,is_representative=false,is_financial_responsible=false
     where unit_id=$1 and user_id=$2 and ended_at is null`,
    [unitId, userId],
  );
  await query(
    `update unit_occupancies set is_representative=true
     where id=(select id from unit_occupancies where unit_id=$1 and ended_at is null order by started_at desc limit 1)
       and not exists (select 1 from unit_occupancies where unit_id=$1 and ended_at is null and is_representative=true)`,
    [unitId],
  );
  await query(
    `insert into unit_ownerships(unit_id,owner_user_id,created_by) values($1,$2,$3) on conflict do nothing`,
    [unitId, userId, createdBy || null],
  );
};

// Responsável financeiro atual de cada unidade (Blocos e unidades > Definir
// financeiro). Usado na visão do proprietário que só acompanha: o card do
// apartamento mostra quem paga, não o próprio proprietário.
export const getFinancialResponsibles = async (unitIds: string[]) => {
  if (!unitIds.length) return [];
  const result = await query<{ unit_id: string; unit_label: string; full_name: string | null; role: string | null }>(
    `select un.id unit_id,
            coalesce(nullif(concat_ws(' - ',nullif(b.name,''),nullif(un.number,'')),''),un.number) unit_label,
            coalesce(fu.full_name,fu.username) full_name, fu.role
     from units un
     left join blocks b on b.id=un.block_id
     left join unit_occupancies fr on fr.unit_id=un.id and fr.ended_at is null and fr.is_financial_responsible=true
     left join users fu on fu.id=fr.user_id
     where un.id=any($1::uuid[])`,
    [unitIds],
  );
  return result.rows;
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

// Unidades cujos boletos (Gestão de cobranças, PDF e Pix) o morador pode
// ver além dos próprios: as que ele representa e as que possui sem morar
// (proprietário que só acompanha). Só leitura, como as duas de cima.
export const getViewableUnitIds = async (userId: string): Promise<string[]> => {
  const [represented, owned] = await Promise.all([getRepresentedUnitIds(userId), getOwnedUnitIds(userId)]);
  return [...new Set([...represented, ...owned])];
};
