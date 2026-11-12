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

// Responsável financeiro de uma unidade pode ser um morador
// (unit_occupancies) ou o proprietário que não mora (unit_ownerships) — ex.:
// dono que aluga o apartamento mas continua pagando o condomínio. Só um por
// unidade, somando as duas tabelas (PATCH /units/:id/financial-responsible).
// `unitExpr` é a expressão SQL do id da unidade na consulta de quem chama.
export const financialResponsibleUserSql = (unitExpr: string) =>
  `(select user_id from unit_occupancies where unit_id=${unitExpr} and ended_at is null and is_financial_responsible=true
    union all
    select owner_user_id from unit_ownerships where unit_id=${unitExpr} and ended_at is null and is_financial_responsible=true
    limit 1)`;

// Mesma regra, do ponto de vista de uma pessoa: ela é o responsável
// financeiro da unidade `unitExpr`?
export const isFinancialResponsibleSql = (userExpr: string, unitExpr: string) =>
  `(exists(select 1 from unit_occupancies where user_id=${userExpr} and unit_id=${unitExpr} and ended_at is null and is_financial_responsible=true)
    or exists(select 1 from unit_ownerships where owner_user_id=${userExpr} and unit_id=${unitExpr} and ended_at is null and is_financial_responsible=true))`;

// Representante da unidade: um morador (unit_occupancies) ou o proprietário
// que não mora (unit_ownerships). Só um por unidade, somando as duas
// tabelas (PATCH /units/:id/representative).
export const representativeUserSql = (unitExpr: string) =>
  `(select user_id from unit_occupancies where unit_id=${unitExpr} and ended_at is null and is_representative=true
    union all
    select owner_user_id from unit_ownerships where unit_id=${unitExpr} and ended_at is null and is_representative=true
    limit 1)`;

export const isRepresentativeSql = (userExpr: string, unitExpr: string) =>
  `(exists(select 1 from unit_occupancies where user_id=${userExpr} and unit_id=${unitExpr} and ended_at is null and is_representative=true)
    or exists(select 1 from unit_ownerships where owner_user_id=${userExpr} and unit_id=${unitExpr} and ended_at is null and is_representative=true))`;

// Unidade sem representante (nem morador nem dono marcado): o morador
// vinculado mais recentemente assume. Usado quando alguém sai da unidade e
// quando um morador é vinculado — quem já é representante nunca é trocado
// por essa regra automática; troca de verdade só em Blocos e unidades.
export const promoteRepresentativeIfMissing = async (unitId: string) => {
  await query(
    `update unit_occupancies set is_representative=true
     where id=(select id from unit_occupancies where unit_id=$1 and ended_at is null order by started_at desc, created_at desc limit 1)
       and not exists (select 1 from unit_occupancies where unit_id=$1 and ended_at is null and is_representative=true)
       and not exists (select 1 from unit_ownerships where unit_id=$1 and ended_at is null and is_representative=true)`,
    [unitId],
  );
};

// Proprietário que NÃO mora na unidade ("O proprietário mora na unidade?" =
// não, users.unit_rented_to_tenant): fica só com a posse (unit_ownerships)
// — vê os débitos e boletos da unidade, recebe avisos e vota em enquetes e
// não conta como morador. Pode ser o responsável financeiro e o
// representante: se já era responsável (morava e pagava), a marca passa da
// moradia para a posse. Se era o representante, quem assume é o morador
// restante vinculado mais recentemente; sem nenhum morador, ele continua
// representante, agora como dono.
export const setOwnerAsMonitoring = async (unitId: string, userId: string, createdBy?: string) => {
  const before = await query<{ is_financial_responsible: boolean; is_representative: boolean }>(
    `select is_financial_responsible, is_representative from unit_occupancies where unit_id=$1 and user_id=$2 and ended_at is null`,
    [unitId, userId],
  );
  const wasResponsible = Boolean(before.rows[0]?.is_financial_responsible);
  const wasRepresentative = Boolean(before.rows[0]?.is_representative);
  await query(
    `update unit_occupancies set ended_at=current_date,is_representative=false,is_financial_responsible=false
     where unit_id=$1 and user_id=$2 and ended_at is null`,
    [unitId, userId],
  );
  await query(
    `insert into unit_ownerships(unit_id,owner_user_id,created_by) values($1,$2,$3) on conflict do nothing`,
    [unitId, userId, createdBy || null],
  );
  if (wasResponsible) {
    await query(
      `update unit_ownerships set is_financial_responsible=true where unit_id=$1 and owner_user_id=$2 and ended_at is null`,
      [unitId, userId],
    );
  }
  if (wasRepresentative) {
    await promoteRepresentativeIfMissing(unitId);
    await query(
      `update unit_ownerships set is_representative=true where unit_id=$1 and owner_user_id=$2 and ended_at is null
         and not exists (select 1 from unit_occupancies where unit_id=$1 and ended_at is null and is_representative=true)`,
      [unitId, userId],
    );
  }
};

// Proprietário que passou a morar na unidade (já com a moradia ativa): a
// posse dela termina e o que ele era como dono (responsável financeiro,
// representante) passa para a moradia.
export const endOwnershipAsResident = async (unitId: string, userId: string) => {
  const before = await query<{ is_financial_responsible: boolean; is_representative: boolean }>(
    `select is_financial_responsible, is_representative from unit_ownerships where unit_id=$1 and owner_user_id=$2 and ended_at is null`,
    [unitId, userId],
  );
  await query(
    `update unit_ownerships set ended_at=current_date,is_financial_responsible=false,is_representative=false
     where unit_id=$1 and owner_user_id=$2 and ended_at is null`,
    [unitId, userId],
  );
  if (before.rows[0]?.is_financial_responsible) {
    await query(
      `update unit_occupancies set is_financial_responsible=true where unit_id=$1 and user_id=$2 and ended_at is null`,
      [unitId, userId],
    );
  }
  if (before.rows[0]?.is_representative) {
    await query(
      `update unit_occupancies set is_representative=true where unit_id=$1 and user_id=$2 and ended_at is null
         and not exists (select 1 from unit_occupancies where unit_id=$1 and ended_at is null and is_representative=true)`,
      [unitId, userId],
    );
  }
};

// Responsável financeiro atual de cada unidade (Blocos e unidades > Definir
// financeiro). Usado na visão do proprietário que não mora: o card do
// apartamento mostra quem paga, não o próprio proprietário (a não ser que
// seja ele quem paga).
export const getFinancialResponsibles = async (unitIds: string[]) => {
  if (!unitIds.length) return [];
  const result = await query<{ unit_id: string; unit_label: string; full_name: string | null; role: string | null }>(
    `select un.id unit_id,
            coalesce(nullif(concat_ws(' - ',nullif(b.name,''),nullif(un.number,'')),''),un.number) unit_label,
            coalesce(fu.full_name,fu.username) full_name, fu.role
     from units un
     left join blocks b on b.id=un.block_id
     left join users fu on fu.id=${financialResponsibleUserSql('un.id')}
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

// Aviso da tela Boletos do morador. O boleto pertence a quem foi escolhido
// como pagador na emissão (invoices.user_id) e continua com essa pessoa —
// marcar outro responsável financeiro só muda as PRÓXIMAS cobranças. Quem
// entra na unidade depois (ex.: inquilino novo) não vê os boletos anteriores
// e achava que o app estava com defeito. Aqui contamos os boletos da unidade
// que existem mas não estão na lista desta pessoa, para a tela explicar.
// Caso real: Patrícia (APTO-408, Templum), 12/11/2026.
export type ResidentInvoiceNotice = {
  unitLabel: string;
  linkedSince: string | null;
  isFinancialResponsible: boolean;
  hiddenUnitInvoices: number;
};

export const getResidentInvoiceNotice = async (userId: string, visibleInvoiceIds: string[]): Promise<ResidentInvoiceNotice | null> => {
  const result = await query<{ unit_label: string; linked_since: string | null; is_fr: boolean; hidden_count: number }>(
    `with me as (
       select u.id, u.unit_id, u.condominium_id,
              coalesce(nullif(concat_ws(' - ',nullif(b.name,''),nullif(un.number,'')),''),un.number,u.unit) unit_label,
              (select to_char(min(o.started_at),'YYYY-MM-DD') from unit_occupancies o where o.user_id=u.id and o.unit_id=u.unit_id and o.ended_at is null) linked_since,
              ${isFinancialResponsibleSql('u.id', 'u.unit_id')} is_fr
       from users u
       left join units un on un.id=u.unit_id
       left join blocks b on b.id=un.block_id
       where u.id=$1
     )
     select me.unit_label, me.linked_since, me.is_fr,
            (select count(*)::int from invoices i join users p on p.id=i.user_id
             where i.condominium_id=me.condominium_id and i.deleted_at is null and i.invoice_type<>'legacy' and i.status<>'canceled'
               and i.user_id<>me.id and not (i.id = any($2::uuid[]))
               and (p.unit_id=me.unit_id
                    or exists(select 1 from unit_occupancies o where o.unit_id=me.unit_id and o.user_id=p.id)
                    or exists(select 1 from unit_ownerships w where w.unit_id=me.unit_id and w.owner_user_id=p.id))) hidden_count
     from me where me.unit_id is not null`,
    [userId, visibleInvoiceIds],
  );
  const row = result.rows[0];
  if (!row || !row.hidden_count) return null;
  return { unitLabel: row.unit_label, linkedSince: row.linked_since, isFinancialResponsible: Boolean(row.is_fr), hiddenUnitInvoices: row.hidden_count };
};
