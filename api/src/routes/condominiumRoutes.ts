import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { getInterAccessToken, type InterIntegrationConfig } from '../services/interService';
import { sendWhatsAppTemplateMessage } from '../services/whatsappService';
import { extractDriveFolderId, getDriveFolderMeta } from '../services/googleDriveService';
import { FEATURE_CATALOG, FEATURE_KEYS, NEW_CONDOMINIUM_FEATURE_DEFAULTS, dependentsOf, isFeatureKey, type FeatureKey } from '../services/featureCatalog';
import { getOpenPlatformInvoice } from '../services/platformInvoiceService';
import { countActiveUsers, computeIncludedOverage, computePlanAmountCents, type ActiveUserMetric, type PlatformPlan } from '../services/platformPlanService';

const router = Router();
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

router.use(authenticate);

type InterIntegrationRow = {
  id: string;
  client_id: string;
  client_secret: string;
  cert_path: string;
  key_path: string;
  cert_passphrase: string | null;
  base_url: string;
  token_path: string;
  scopes: string;
  enabled: boolean;
};

const mapInterIntegration = (row: InterIntegrationRow): InterIntegrationConfig => ({
  id: row.id,
  clientId: row.client_id,
  clientSecret: row.client_secret,
  certPath: row.cert_path,
  keyPath: row.key_path,
  certPassphrase: row.cert_passphrase,
  baseUrl: row.base_url,
  tokenPath: row.token_path,
  scopes: row.scopes,
  enabled: row.enabled,
});

// Cadastrados: deleted_at is null (mesmo critério da aba "Ativos" de Pessoas).
// Ativos/Inativos: cadastrado com/sem login_enabled (mesmo critério de
// active_user_metric 'login_enabled' em platformPlanService.ts).
// Papel efetivo (EFFECTIVE_ROLE): síndico/subsíndico têm prioridade sobre
// proprietário/inquilino — alguém com papel principal "proprietario" mas com
// perfil adicional (user_profiles, ver POST /users/:id/profiles) de síndico
// ou subsíndico é contado como síndico/subsíndico, não como proprietário.
// Isso só resolve a duplicidade DENTRO da mesma conta — ver PERSON_CTE
// abaixo para quando é a mesma pessoa em contas (linhas de `users`)
// diferentes.
// "Monitora outra unidade": proprietário (papel efetivo) com um vínculo ATIVO
// em unit_ownerships (tabela dedicada para posse sem moradia — ver comentário
// em schema.sql perto de "create table unit_ownerships") para uma unidade
// diferente da sua própria (users.unit_id) — mecanismo real usado quando um
// proprietário acompanha uma unidade alugada a um inquilino. NÃO é exclusivo
// com morar na própria unidade — a mesma pessoa pode morar na sua unidade E
// monitorar outra, então esse número nunca é subtraído de registeredOwners.
// Versões parametrizadas por alias — precisamos delas de novo mais abaixo
// (alias `t`) pra achar o inquilino de uma unidade a partir da linha do
// proprietário (alias `u`).
const effectiveRoleSql = (alias: string) => `(case
  when ${alias}.role='sindico' or exists(select 1 from user_profiles up where up.user_id=${alias}.id and up.role='sindico' and up.condominium_id=${alias}.condominium_id) then 'sindico'
  when ${alias}.role='subsindico' or exists(select 1 from user_profiles up where up.user_id=${alias}.id and up.role='subsindico' and up.condominium_id=${alias}.condominium_id) then 'subsindico'
  else ${alias}.role
end)`;
const monitorsElsewhereSql = (alias: string) => `exists (select 1 from unit_ownerships oo where oo.owner_user_id=${alias}.id and oo.ended_at is null and oo.unit_id is distinct from ${alias}.unit_id)`;
// "Logou no sistema": existe pelo menos uma sessão (refresh_tokens) já criada
// pra esse usuário — refresh_tokens nunca é apagada, só marcada como
// revogada, e uma linha só nasce em login()/refresh()/switchProfile()
// (authService.ts), todos exigindo autenticação prévia bem-sucedida. Por
// isso é diferente de `login_enabled` (Ativos/Inativos, que é permissão de
// acessar, não uso de fato).
const loggedInSql = (alias: string) => `exists(select 1 from refresh_tokens rt where rt.user_id=${alias}.id)`;
const EFFECTIVE_ROLE = effectiveRoleSql('u');
const MONITORS_ELSEWHERE = monitorsElsewhereSql('u');
const LOGGED_IN = loggedInSql('u');
// Proprietário com "Unidade alugada a terceiros" marcado (unit_rented_to_tenant)
// cuja unidade (mesmo u.unit_id) tem um inquilino cadastrado, ativo
// (login_enabled) e que já logou pelo menos uma vez. Usado pra não contar
// esse proprietário em "nunca logaram": quem de fato usa o sistema pela
// unidade é o inquilino, não o proprietário que só acompanha o boleto —
// esse proprietário vira um indicador à parte (ver bucket
// 'owners_never_logged_in_tenant_active' abaixo), em vez de somar ao número
// que sugere descuido/abandono do acesso.
const OWNER_HAS_ACTIVE_LOGGED_IN_TENANT = `exists (
  select 1 from users t
  where t.condominium_id = u.condominium_id
    and t.deleted_at is null
    and t.unit_id = u.unit_id
    and t.login_enabled
    and ${effectiveRoleSql('t')} = 'inquilino'
    and ${loggedInSql('t')}
)`;

// "Pessoa" para fins do Painel de usuários: o mesmo CPF/CNPJ pode ter mais de
// uma linha em `users` no MESMO condomínio — ex.: cadastrado uma vez como
// síndico (sem unidade) e outra vez como proprietário de uma unidade própria.
// Isso é legítimo (um CPF/CNPJ pode ter mais de uma unidade, cada uma com seu
// próprio cadastro) e o EFFECTIVE_ROLE acima só resolve a duplicidade DENTRO
// da mesma conta (via user_profiles) — não entre contas diferentes. Aqui
// colapsamos por (condomínio, CPF normalizado) e escolhemos, entre as linhas
// dessa pessoa, a de maior prioridade — mesma ordem do EFFECTIVE_ROLE
// (síndico > subsíndico > proprietário > inquilino > outros) — pra
// síndico/subsíndico que também são moradores não aparecerem contados de
// novo em "Proprietários"/"Inquilinos" nem em "Ativos"/"Já logaram no
// sistema". Uma linha sem CPF nunca colapsa com outra (usa o próprio id como
// chave, então continua contando à parte — não dá pra saber se é a mesma
// pessoa sem CPF).
const PERSON_CTE = `
  with row_info as (
    select
      u.id, u.condominium_id, u.login_enabled, u.full_name, u.username, u.role as primary_role,
      u.unit_id, u.unit as legacy_unit, u.unit_rented_to_tenant,
      coalesce(nullif(regexp_replace(u.cpf, '[^0-9]', '', 'g'), ''), 'id:' || u.id::text) as person_key,
      ${EFFECTIVE_ROLE} as row_role,
      case ${EFFECTIVE_ROLE}
        when 'sindico' then 0 when 'subsindico' then 1
        when 'proprietario' then 2 when 'inquilino' then 3 else 4
      end as role_priority,
      ${LOGGED_IN} as row_logged_in,
      ${MONITORS_ELSEWHERE} as row_monitors_elsewhere,
      case when ${EFFECTIVE_ROLE}='proprietario' and u.unit_rented_to_tenant then ${OWNER_HAS_ACTIVE_LOGGED_IN_TENANT} else false end as row_owner_tenant_active_logged_in
    from users u
    where u.deleted_at is null
  )
  select distinct on (condominium_id, person_key)
    condominium_id, person_key, id as rep_id, full_name, username, primary_role,
    unit_id, legacy_unit, row_role as person_role,
    bool_or(login_enabled) over w as person_active,
    bool_or(row_logged_in) over w as person_logged_in,
    bool_or(row_role='proprietario' and unit_rented_to_tenant) over w as person_owner_rented,
    bool_or(row_role='proprietario' and row_monitors_elsewhere) over w as person_monitors_elsewhere,
    bool_or(row_owner_tenant_active_logged_in) over w as person_owner_tenant_active_logged_in
  from row_info
  window w as (partition by condominium_id, person_key)
  order by condominium_id, person_key, role_priority asc
`;

router.get('/user-stats', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('painel_usuarios'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? (String(req.query.condominiumId || '') || null) : req.user?.condominiumId;
  const result = await query<{
    condominium_id: string; name: string; registered_users: number; active_users: number;
    logged_in_users: number; deleted_users: number;
    registered_owners: number; registered_tenants: number;
    real_tenant_residents: number; owner_residents: number;
    monitor_only_owners: number; sindico: Array<{ id: string; fullName: string }>; subsindico: Array<{ id: string; fullName: string }>;
    total_units: number; units_with_resident: number;
    owners_never_logged_in_tenant_active: number;
    raw_registered_users: number; raw_login_enabled_users: number;
  }>(
    `with person as (${PERSON_CTE})
     select c.id as condominium_id, c.name,
       count(p.rep_id)::int as registered_users,
       count(*) filter (where p.person_active)::int as active_users,
       count(*) filter (where p.person_logged_in)::int as logged_in_users,
       -- Proprietário que nunca logou mas cuja unidade tem inquilino ativo
       -- que já logou sai daqui e vira o indicador
       -- owners_never_logged_in_tenant_active abaixo (ver
       -- OWNER_HAS_ACTIVE_LOGGED_IN_TENANT).
       count(*) filter (where p.person_role='proprietario' and not p.person_logged_in and p.person_owner_tenant_active_logged_in)::int as owners_never_logged_in_tenant_active,
       count(*) filter (where p.person_role='proprietario')::int as registered_owners,
       count(*) filter (where p.person_role='inquilino')::int as registered_tenants,
       count(*) filter (where p.person_role='inquilino' or (p.person_role='proprietario' and p.person_owner_rented))::int as real_tenant_residents,
       count(*) filter (where p.person_role='proprietario' and not p.person_owner_rented)::int as owner_residents,
       count(*) filter (where p.person_role='proprietario' and p.person_monitors_elsewhere)::int as monitor_only_owners,
       coalesce(jsonb_agg(distinct jsonb_build_object('id',p.rep_id,'fullName',coalesce(p.full_name,p.username))) filter (where p.person_role='sindico'), '[]'::jsonb) as sindico,
       coalesce(jsonb_agg(distinct jsonb_build_object('id',p.rep_id,'fullName',coalesce(p.full_name,p.username))) filter (where p.person_role='subsindico'), '[]'::jsonb) as subsindico,
       (select count(*) from units un where un.condominium_id = c.id)::int as total_units,
       (select count(*) from units un where un.condominium_id = c.id
          and exists(select 1 from unit_occupancies oc where oc.unit_id = un.id and oc.ended_at is null))::int as units_with_resident,
       -- Excluídos logicamente (deleted_at preenchido) ficam de fora do
       -- PERSON_CTE de propósito (a aba "Excluídos" de Pessoas já trata como
       -- lista à parte, sem colapsar por CPF) — contagem simples de linhas,
       -- igual ao que a aba já mostra.
       (select count(*) from users du where du.condominium_id = c.id and du.deleted_at is not null)::int as deleted_users,
       -- Mesma contagem "crua" (sem colapsar por pessoa/CPF) usada de
       -- verdade na cobrança da plataforma (countActiveUsers em
       -- platformPlanService.ts) — usada abaixo pra bater "uso do plano"
       -- com o número que vai pra fatura, e não com registeredUsers/
       -- activeUsers acima (que colapsam duplicidade de CPF, então podem
       -- vir menores que o que a plataforma de fato cobra).
       (select count(*) from users u2 where u2.condominium_id = c.id and u2.deleted_at is null)::int as raw_registered_users,
       (select count(*) from users u2 where u2.condominium_id = c.id and u2.deleted_at is null and u2.login_enabled = true)::int as raw_login_enabled_users
     from condominiums c
     left join person p on p.condominium_id = c.id
     where ($1::uuid is null or c.id = $1)
     group by c.id, c.name
     order by c.name`,
    [condominiumId],
  );

  // Plano de cobrança vinculado a cada condomínio (mesma fonte que
  // platformPlanRoutes.ts /overview usa) — carregado à parte, em bloco, em
  // vez de subquery por condomínio, e cruzado em JS pelo Map abaixo.
  const [subs, plans, tiers] = await Promise.all([
    query<{ condominium_id: string; plan_id: string }>(`select condominium_id, plan_id from condominium_plan_subscriptions where ended_at is null`),
    query<{
      id: string; name: string; plan_type: string; active_user_metric: ActiveUserMetric;
      included_quantity: number | null; base_price_cents: number | null; overage_price_cents: number | null;
      price_per_active_user_cents: number | null; minimum_price_cents: number;
    }>(`select id, name, plan_type, active_user_metric, included_quantity, base_price_cents, overage_price_cents,
               price_per_active_user_cents, minimum_price_cents
        from platform_plans`),
    query<{ plan_id: string; min_active_users: number; max_active_users: number | null; price_cents: number }>(`select plan_id, min_active_users, max_active_users, price_cents from platform_plan_tiers order by min_active_users asc`),
  ]);
  const planIdByCondominium = new Map(subs.rows.map(row => [row.condominium_id, row.plan_id]));
  const planById = new Map(plans.rows.map(plan => [plan.id, plan]));
  const tiersByPlan = new Map<string, typeof tiers.rows>();
  for (const tier of tiers.rows) {
    const list = tiersByPlan.get(tier.plan_id) || [];
    list.push(tier);
    tiersByPlan.set(tier.plan_id, list);
  }

  return res.json({
    condominiums: result.rows.map(row => {
      const plan = planById.get(planIdByCondominium.get(row.condominium_id) || '');
      // Mesma regra usada em GET /condominiums/plan-usage: só existe teto
      // pra plano 'faixa fechada' cuja última faixa tem max_active_users
      // definido — 'por usuário ativo' e faixa fechada com topo aberto
      // nunca têm o que exceder.
      const planActiveUsers = plan ? (plan.active_user_metric === 'login_enabled' ? row.raw_login_enabled_users : row.raw_registered_users) : null;
      const planLimit = plan && plan.plan_type === 'tiered_bracket'
        ? (tiersByPlan.get(plan.id) || []).slice().sort((a, b) => b.min_active_users - a.min_active_users)[0]?.max_active_users ?? null
        : null;
      // Ver comentário equivalente em GET /condominiums/plan-usage: excedente
      // aqui é cobrança extra automática, não um teto que "estourou".
      const overage = plan && plan.plan_type === 'included_overage' ? computeIncludedOverage(plan, planActiveUsers ?? 0) : null;
      // "Até o momento o valor está em R$X" — mesma conta da fatura de
      // verdade, vale pros três tipos de plano.
      const planAmountCents = plan ? computePlanAmountCents(plan as PlatformPlan, tiersByPlan.get(plan.id) || [], planActiveUsers ?? 0) : null;

      return {
        condominiumId: row.condominium_id,
        name: row.name,
        registeredUsers: row.registered_users,
        activeUsers: row.active_users,
        inactiveUsers: row.registered_users - row.active_users,
        loggedInUsers: row.logged_in_users,
        // Não inclui quem cai em ownersNeverLoggedInTenantActive: esses
        // proprietários têm indicador próprio, porque quem de fato usa o
        // sistema pela unidade é o inquilino ativo, não o proprietário.
        neverLoggedIn: row.registered_users - row.logged_in_users - row.owners_never_logged_in_tenant_active,
        ownersNeverLoggedInTenantActive: row.owners_never_logged_in_tenant_active,
        deletedUsers: row.deleted_users,
        registeredOwners: row.registered_owners,
        registeredTenants: row.registered_tenants,
        realTenantResidents: row.real_tenant_residents,
        ownerResidents: row.owner_residents,
        ownersMonitoringElsewhere: row.monitor_only_owners,
        sindico: row.sindico,
        subsindico: row.subsindico,
        totalUnits: row.total_units,
        unitsWithResident: row.units_with_resident,
        unitsWithoutResident: row.total_units - row.units_with_resident,
        planName: plan?.name ?? null,
        planType: plan?.plan_type ?? null,
        planActiveUserMetric: plan?.active_user_metric ?? null,
        planActiveUsers,
        planLimit,
        planExceeded: planLimit !== null && (planActiveUsers ?? 0) > planLimit,
        planIncludedQuantity: plan?.included_quantity ?? null,
        planBasePriceCents: plan?.base_price_cents ?? null,
        planOveragePriceCents: plan?.overage_price_cents ?? null,
        planOverageUnits: overage?.overageUnits ?? null,
        planOverageAmountCents: overage?.overageAmountCents ?? null,
        planEstimatedMonthlyAmountCents: planAmountCents,
      };
    }),
  });
}));

type UserStatsBucket = 'registered' | 'active' | 'inactive' | 'logged_in' | 'never_logged_in' | 'owners_never_logged_in_tenant_active' | 'deleted' | 'registered_owners' | 'registered_tenants' | 'real_tenant_residents' | 'owner_residents' | 'owners_monitoring_elsewhere' | 'sindico' | 'subsindico';
const USER_STATS_BUCKET_WHERE: Record<UserStatsBucket, string> = {
  // Nunca usado — bucket 'deleted' retorna antes de chegar aqui (ver
  // /user-stats/members), só existe pra satisfazer o Record exaustivo.
  deleted: '',
  registered: `true`,
  active: `p.person_active`,
  inactive: `not p.person_active`,
  logged_in: `p.person_logged_in`,
  // Exclui o proprietário coberto por owners_never_logged_in_tenant_active
  // abaixo — mesmo critério usado na contagem de /user-stats.
  never_logged_in: `not p.person_logged_in and not (p.person_role='proprietario' and p.person_owner_tenant_active_logged_in)`,
  owners_never_logged_in_tenant_active: `p.person_role='proprietario' and not p.person_logged_in and p.person_owner_tenant_active_logged_in`,
  registered_owners: `p.person_role='proprietario'`,
  registered_tenants: `p.person_role='inquilino'`,
  real_tenant_residents: `(p.person_role='inquilino' or (p.person_role='proprietario' and p.person_owner_rented))`,
  owner_residents: `p.person_role='proprietario' and not p.person_owner_rented`,
  owners_monitoring_elsewhere: `p.person_role='proprietario' and p.person_monitors_elsewhere`,
  sindico: `p.person_role='sindico'`,
  subsindico: `p.person_role='subsindico'`,
};

// Lista nominal (nome + apartamento) de quem compõe um dos números do painel
// de usuários — mesma lógica de bucket usada na agregação acima (inclusive o
// colapso por pessoa/CPF do PERSON_CTE), sem duplicar a definição de cada
// critério. isExtra indica que a pessoa está nesse bucket por um perfil
// adicional (user_profiles) ou por outra conta com o mesmo CPF — não pelo
// papel principal desta linha específica.
router.get('/user-stats/members', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('painel_usuarios'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? String(req.query.condominiumId || '') : req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const bucket = String(req.query.bucket || '') as UserStatsBucket;

  // "Excluídos logicamente" fica de fora do PERSON_CTE de propósito (ver
  // comentário em deleted_users acima) — lista direto de `users`, sem
  // colapsar por CPF, igual à aba "Excluídos" de Pessoas.
  if (bucket === 'deleted') {
    const deleted = await query<{ id: string; full_name: string | null; username: string; role: string; unit: string | null }>(
      `select u.id, u.full_name, u.username, u.role,
              coalesce(nullif(concat_ws(' - ', nullif(b.name,''), nullif(un.number,'')), ''), nullif(u.unit,''), 'Sem apartamento') as unit
       from users u
       left join units un on un.id = u.unit_id
       left join blocks b on b.id = un.block_id
       where u.condominium_id = $1 and u.deleted_at is not null
       order by coalesce(u.full_name, u.username)`,
      [condominiumId],
    );
    return res.json({
      members: deleted.rows.map(row => ({
        id: row.id, fullName: row.full_name || row.username, role: row.role, isExtra: false, unit: row.unit,
      })),
    });
  }

  const bucketWhere = USER_STATS_BUCKET_WHERE[bucket];
  if (!bucketWhere) return res.status(400).json({ message: 'Categoria inválida.' });

  const result = await query<{ id: string; full_name: string | null; username: string; primary_role: string; person_role: string; unit: string | null }>(
    `with person as (${PERSON_CTE})
     select p.rep_id as id, p.full_name, p.username, p.primary_role, p.person_role,
            coalesce(nullif(concat_ws(' - ', nullif(b.name,''), nullif(un.number,'')), ''), nullif(p.legacy_unit,''), 'Sem apartamento') as unit
     from person p
     left join units un on un.id = p.unit_id
     left join blocks b on b.id = un.block_id
     where p.condominium_id = $1 and ${bucketWhere}
     order by coalesce(p.full_name, p.username)`,
    [condominiumId],
  );
  return res.json({
    members: result.rows.map(row => ({
      id: row.id,
      fullName: row.full_name || row.username,
      role: row.person_role,
      isExtra: row.primary_role !== row.person_role,
      unit: row.unit,
    })),
  });
}));

// Uso do plano de cobrança da plataforma, para o cadastro de pessoas avisar
// síndico/subsíndico quando estão perto de (ou já) estourar a faixa
// contratada. Só existe teto pra plano 'faixa fechada' cuja última faixa
// tem max_active_users definido — 'por usuário ativo' escala o preço com o
// uso, sem teto algum, então nunca "excede" (limit vem null e o front não
// mostra alerta). Mesma métrica de usuário ativo (login_enabled/registered)
// usada na cobrança de verdade (platformInvoiceService.ts), pra o número
// batido aqui ser exatamente o que vai pra fatura do condomínio.
router.get('/plan-usage', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? (String(req.query.condominiumId || '') || null) : req.user?.condominiumId;
  if (!condominiumId) return res.json({ hasPlan: false });

  const subscription = await query<{ plan_id: string }>(
    `select plan_id from condominium_plan_subscriptions where condominium_id=$1 and ended_at is null limit 1`,
    [condominiumId],
  );
  if (!subscription.rows.length) return res.json({ hasPlan: false });

  const planResult = await query<{
    id: string; name: string; plan_type: string; active_user_metric: ActiveUserMetric;
    included_quantity: number | null; base_price_cents: number | null; overage_price_cents: number | null;
    price_per_active_user_cents: number | null; minimum_price_cents: number;
  }>(
    `select id, name, plan_type, active_user_metric, included_quantity, base_price_cents, overage_price_cents,
            price_per_active_user_cents, minimum_price_cents
     from platform_plans where id=$1`,
    [subscription.rows[0].plan_id],
  );
  const plan = planResult.rows[0];
  if (!plan) return res.json({ hasPlan: false });

  const activeUsers = await countActiveUsers(condominiumId, plan.active_user_metric);
  const tiers = await query<{ plan_id: string; min_active_users: number; max_active_users: number | null; price_cents: number }>(
    `select plan_id, min_active_users, max_active_users, price_cents from platform_plan_tiers where plan_id=$1 order by min_active_users asc`,
    [plan.id],
  );

  let limit: number | null = null;
  if (plan.plan_type === 'tiered_bracket') {
    limit = tiers.rows.slice().sort((a, b) => b.min_active_users - a.min_active_users)[0]?.max_active_users ?? null;
  }

  // Plano 'included_overage' (base + incluídos + excedente): passar do
  // incluído não é erro, é cobrança extra automática — por isso não usa o
  // par limit/exceeded acima (que é um teto de verdade, "não cabe no
  // plano"). O front mostra esse caso com tom neutro/informativo.
  const overage = plan.plan_type === 'included_overage' ? computeIncludedOverage(plan, activeUsers) : null;
  // Valor estimado do mês corrente, pra "até o momento o valor está R$X" —
  // mesma conta usada de verdade na fatura (computePlanAmountCents), vale
  // pros três tipos de plano, não só included_overage.
  const estimatedMonthlyAmountCents = computePlanAmountCents(plan as PlatformPlan, tiers.rows, activeUsers);

  return res.json({
    hasPlan: true,
    planName: plan.name,
    planType: plan.plan_type,
    activeUserMetric: plan.active_user_metric,
    activeUsers,
    limit,
    exceeded: limit !== null && activeUsers > limit,
    includedQuantity: plan.included_quantity,
    basePriceCents: plan.base_price_cents,
    overagePriceCents: plan.overage_price_cents,
    overageUnits: overage?.overageUnits ?? null,
    overageAmountCents: overage?.overageAmountCents ?? null,
    estimatedMonthlyAmountCents,
  });
}));

// Fatura da plataforma em aberto do condomínio do síndico/subsíndico (com o
// Pix pra pagar). Sem requireFeature de propósito: é cobrança da plataforma,
// não um módulo que o admin liga/desliga por condomínio.
router.get('/platform-invoice', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.json({ invoice: null });
  return res.json({ invoice: await getOpenPlatformInvoice(condominiumId) });
}));

router.get('/', authorize('admin_geral'), asyncHandler(async (_req, res) => {
  const result = await query(
    `select c.id, c.name, c.cnpj, c.address, c.phone, c.email, c.created_at, c.google_drive_folder_id,
            (b.id is not null) as bank_integration_configured,
            coalesce(b.enabled, false) as bank_integration_enabled,
            b.updated_at as bank_integration_updated_at,
            b.id as bank_configuration_id,
            b.name as bank_configuration_name,
            b.provider as bank_provider,
            cb.boleto_sync_mode,
            cb.boleto_sync_start_period,
            (be.id is not null) as bank_extrato_configured,
            coalesce(be.enabled, false) as bank_extrato_enabled,
            be.id as bank_extrato_configuration_id,
            be.name as bank_extrato_configuration_name
     from condominiums c
     left join condominium_bank_configurations cb on cb.condominium_id = c.id and cb.purpose = 'boleto'
     left join bank_configurations b on b.id = cb.bank_configuration_id
     left join condominium_bank_configurations cbe on cbe.condominium_id = c.id and cbe.purpose = 'extrato'
     left join bank_configurations be on be.id = cbe.bank_configuration_id
     order by c.created_at desc`,
  );

  return res.json({ condominiums: result.rows });
}));

router.post('/', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { name, cnpj, address, phone, email, googleDriveFolderUrl } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'name is required' });
  }
  const driveFolderId = googleDriveFolderUrl ? extractDriveFolderId(String(googleDriveFolderUrl)) : null;

  const condominiumId = randomUUID();
  const result = await query(
    `insert into condominiums (id, name, cnpj, address, phone, email, google_drive_folder_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, name, cnpj, address, phone, email, created_at, google_drive_folder_id`,
    [condominiumId, name.trim(), cnpj || null, address || null, phone || null, email || null, driveFolderId],
  );

  // Ponto de partida das funcionalidades para um condomínio novo (ver
  // NEW_CONDOMINIUM_FEATURE_DEFAULTS) — condomínios que já existiam antes
  // desta feature não ganham essa linha retroativamente, então continuam
  // resolvendo tudo como ativo (comportamento inalterado).
  const defaultsColumns = FEATURE_KEYS.join(', ');
  const defaultsPlaceholders = FEATURE_KEYS.map((_, index) => `$${index + 2}`).join(', ');
  const defaultsValues = FEATURE_KEYS.map(key => NEW_CONDOMINIUM_FEATURE_DEFAULTS[key]);
  await query(
    `insert into condominium_features (condominium_id, ${defaultsColumns}) values ($1, ${defaultsPlaceholders})`,
    [condominiumId, ...defaultsValues],
  );

  return res.status(201).json({ condominium: result.rows[0] });
}));

router.patch('/:id', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { name, cnpj, address, phone, email, googleDriveFolderUrl } = req.body ?? {};
  const driveFolderId = googleDriveFolderUrl === undefined
    ? null
    : (googleDriveFolderUrl ? extractDriveFolderId(String(googleDriveFolderUrl)) : '');

  const result = await query(
    `update condominiums
     set name = coalesce($2, name),
         cnpj = coalesce($3, cnpj),
         address = coalesce($4, address),
         phone = coalesce($5, phone),
         email = coalesce($6, email),
         google_drive_folder_id = case when $7 = '' then null when $7 is null then google_drive_folder_id else $7 end
     where id = $1
     returning id, name, cnpj, address, phone, email, created_at, google_drive_folder_id`,
    [req.params.id, name || null, cnpj || null, address || null, phone || null, email || null, driveFolderId],
  );

  if (!result.rows[0]) {
    return res.status(404).json({ message: 'condominium not found' });
  }

  return res.json({ condominium: result.rows[0] });
}));

// Só permite excluir um condomínio se ele estiver "vazio": sem nenhuma
// pessoa cadastrada e sem nenhum registro de uso (unidades, cobranças,
// ocorrências, etc). Config pura (integrações, condominium_features,
// billing_settings) cascade normalmente, porque isso não é "cadastro" —
// nunca bloqueia a exclusão de um condomínio genuinamente vazio.
router.delete('/:id', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const condominium = await query<{ name: string }>(`select name from condominiums where id=$1`, [req.params.id]);
  if (!condominium.rows[0]) return res.status(404).json({ message: 'Condomínio não encontrado.' });

  const usage = await query<{ label: string }>(
    `select label from (
       select 'Pessoas cadastradas' as label, exists(select 1 from users where condominium_id=$1) as found
       union all select 'Tipologias cadastradas', exists(select 1 from unit_types where condominium_id=$1)
       union all select 'Blocos cadastrados', exists(select 1 from blocks where condominium_id=$1)
       union all select 'Unidades cadastradas', exists(select 1 from units where condominium_id=$1)
       union all select 'Despesas cadastradas', exists(select 1 from expenses where condominium_id=$1)
       union all select 'Boletos/cobranças emitidos', exists(select 1 from invoices where condominium_id=$1)
       union all select 'Acordos de débito', exists(select 1 from debt_agreements where condominium_id=$1)
       union all select 'Lotes de cobrança', exists(select 1 from billing_batches where condominium_id=$1)
       union all select 'Cobranças adicionais', exists(select 1 from unit_extra_charges where condominium_id=$1)
       union all select 'Avisos enviados', exists(select 1 from notifications where condominium_id=$1)
       union all select 'Relatos e solicitações', exists(select 1 from resident_reports where condominium_id=$1)
       union all select 'Prestações de contas', exists(select 1 from accountability_reports where condominium_id=$1)
       union all select 'Artigos do regimento', exists(select 1 from regulation_articles where condominium_id=$1)
       union all select 'Ocorrências', exists(select 1 from occurrences where condominium_id=$1)
       union all select 'Notificações de infração', exists(select 1 from infraction_notices where condominium_id=$1)
       union all select 'Assinatura de plano da plataforma', exists(select 1 from condominium_plan_subscriptions where condominium_id=$1)
       union all select 'Faturas da plataforma', exists(select 1 from platform_invoices where condominium_id=$1)
     ) t where found`,
    [req.params.id],
  );
  if (usage.rows.length) {
    return res.status(409).json({
      message: `Não é possível excluir: este condomínio já tem ${usage.rows.map(row => row.label).join(', ').toLowerCase()}.`,
    });
  }

  await query(`delete from condominiums where id=$1`, [req.params.id]);
  return res.json({ message: `Condomínio "${condominium.rows[0].name}" excluído.` });
}));

router.get('/:id/inter-integration', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query(
    `select condominiums.id as condominium_id,
            condominiums.name as condominium_name,
            inter_integrations.id,
            inter_integrations.client_id,
            inter_integrations.cert_path,
            inter_integrations.key_path,
            inter_integrations.base_url,
            inter_integrations.token_path,
            inter_integrations.scopes,
            inter_integrations.enabled,
            inter_integrations.created_at,
            inter_integrations.updated_at
     from condominiums
     left join inter_integrations on inter_integrations.condominium_id = condominiums.id
     where condominiums.id = $1`,
    [req.params.id],
  );

  if (!result.rows[0]) {
    return res.status(404).json({ message: 'condominium not found' });
  }

  return res.json({ integration: result.rows[0] });
}));

router.put('/:id/inter-integration', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const {
    clientId,
    clientSecret,
    certPath,
    keyPath,
    certPassphrase,
    baseUrl,
    tokenPath,
    scopes,
    enabled,
  } = req.body ?? {};

  const condominium = await query(`select id from condominiums where id = $1`, [req.params.id]);

  if (!condominium.rows[0]) {
    return res.status(404).json({ message: 'condominium not found' });
  }

  const current = await query(`select id, client_secret, cert_passphrase from inter_integrations where condominium_id = $1`, [
    req.params.id,
  ]);

  if (!clientId || !certPath || !keyPath) {
    return res.status(400).json({ message: 'clientId, certPath and keyPath are required' });
  }

  if (!clientSecret && !current.rows[0]?.client_secret) {
    return res.status(400).json({ message: 'clientSecret is required' });
  }

  const interBaseUrl = baseUrl || 'https://cdpj.partners.bancointer.com.br';
  const interTokenPath = tokenPath || '/oauth/v2/token';
  const interScopes = scopes || 'boleto-cobranca.write boleto-cobranca.read';

  const result = await query(
    `insert into inter_integrations (
       id, condominium_id, client_id, client_secret, cert_path, key_path, cert_passphrase,
       base_url, token_path, scopes, enabled, updated_at
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (condominium_id) do update
       set client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           cert_path = excluded.cert_path,
           key_path = excluded.key_path,
           cert_passphrase = excluded.cert_passphrase,
           base_url = excluded.base_url,
           token_path = excluded.token_path,
           scopes = excluded.scopes,
           enabled = excluded.enabled,
           updated_at = now()
     returning id, condominium_id, client_id, cert_path, key_path, base_url, token_path, scopes, enabled, created_at, updated_at`,
    [
      current.rows[0]?.id || randomUUID(),
      req.params.id,
      String(clientId).trim(),
      clientSecret ? String(clientSecret) : current.rows[0]?.client_secret,
      String(certPath).trim(),
      String(keyPath).trim(),
      certPassphrase === undefined ? current.rows[0]?.cert_passphrase || null : certPassphrase || null,
      interBaseUrl,
      interTokenPath,
      interScopes,
      typeof enabled === 'boolean' ? enabled : true,
    ],
  );

  return res.json({ integration: result.rows[0] });
}));

router.post('/:id/google-drive/test', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query<{ google_drive_folder_id: string | null }>(
    `select google_drive_folder_id from condominiums where id = $1`, [req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ message: 'Condomínio não encontrado.' });
  const folderId = result.rows[0].google_drive_folder_id;
  if (!folderId) return res.status(400).json({ message: 'Nenhuma pasta do Google Drive configurada para este condomínio.' });

  try {
    const folder = await getDriveFolderMeta(folderId);
    return res.json({ ok: true, folderName: folder.name });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Não foi possível acessar a pasta. Confirme se ela foi compartilhada com laremdia.condominio@gmail.com com permissão de editor.' });
  }
}));

router.post('/:id/inter-integration/test', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query<InterIntegrationRow>(
    `select id, client_id, client_secret, cert_path, key_path, cert_passphrase,
            base_url, token_path, scopes, enabled
     from inter_integrations
     where condominium_id = $1`,
    [req.params.id],
  );

  const integration = result.rows[0];

  if (!integration) {
    return res.status(404).json({ message: 'inter integration not configured' });
  }

  const token = await getInterAccessToken(mapInterIntegration(integration));

  if (!token) {
    return res.status(400).json({ message: 'inter integration is disabled or incomplete' });
  }

  return res.json({ ok: true });
}));

router.get('/:id/whatsapp-integration', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query(
    `select condominium_id, phone_number_id, business_account_id, template_name, template_language, enabled, created_at, updated_at
     from whatsapp_integrations where condominium_id = $1`,
    [req.params.id],
  );

  return res.json({ integration: result.rows[0] || null });
}));

router.put('/:id/whatsapp-integration', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { phoneNumberId, accessToken, businessAccountId, templateName, templateLanguage, enabled } = req.body ?? {};

  const condominium = await query(`select id from condominiums where id = $1`, [req.params.id]);
  if (!condominium.rows[0]) return res.status(404).json({ message: 'Condomínio não encontrado.' });

  const current = await query<{ access_token: string }>(`select access_token from whatsapp_integrations where condominium_id = $1`, [req.params.id]);

  if (!String(phoneNumberId || '').trim()) {
    return res.status(400).json({ message: 'Informe o Phone Number ID da API do WhatsApp Business.' });
  }
  if (!accessToken && !current.rows[0]?.access_token) {
    return res.status(400).json({ message: 'Informe o token de acesso da API do WhatsApp Business.' });
  }

  const result = await query(
    `insert into whatsapp_integrations (id, condominium_id, phone_number_id, access_token, business_account_id, template_name, template_language, enabled, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (condominium_id) do update
       set phone_number_id = excluded.phone_number_id,
           access_token = coalesce($4, whatsapp_integrations.access_token),
           business_account_id = excluded.business_account_id,
           template_name = excluded.template_name,
           template_language = excluded.template_language,
           enabled = excluded.enabled,
           updated_at = now()
     returning condominium_id, phone_number_id, business_account_id, template_name, template_language, enabled, created_at, updated_at`,
    [
      randomUUID(),
      req.params.id,
      String(phoneNumberId).trim(),
      accessToken ? String(accessToken).trim() : current.rows[0]?.access_token || null,
      businessAccountId ? String(businessAccountId).trim() : null,
      String(templateName || 'aviso_condominio').trim(),
      String(templateLanguage || 'pt_BR').trim(),
      typeof enabled === 'boolean' ? enabled : true,
    ],
  );

  return res.json({ integration: result.rows[0] });
}));

router.post('/:id/whatsapp-integration/test', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const toPhone = digits(req.body?.phone);
  if (toPhone.length < 10) return res.status(400).json({ message: 'Informe um telefone válido para o teste.' });

  const result = await query<any>(`select * from whatsapp_integrations where condominium_id = $1`, [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ message: 'Integração do WhatsApp Business não configurada para este condomínio.' });

  const outcome = await sendWhatsAppTemplateMessage(
    {
      phoneNumberId: row.phone_number_id,
      accessToken: row.access_token,
      templateName: row.template_name,
      templateLanguage: row.template_language,
      enabled: row.enabled,
    },
    toPhone,
    'Mensagem de teste da integração WhatsApp Business.',
  );

  if (!outcome.sent) return res.status(400).json({ message: 'Integração desabilitada ou incompleta.' });
  return res.json({ ok: true });
}));

// Controle de funcionalidades por condomínio: um condomínio sem linha em
// condominium_features tem tudo ativo — resolvido aqui do mesmo jeito que
// no middleware requireFeature, pra nunca haver divergência entre o que a
// tela mostra e o que a API de fato bloqueia.
router.get('/:id/features', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query<Record<FeatureKey, boolean>>(
    `select ${FEATURE_KEYS.join(', ')} from condominium_features where condominium_id=$1`,
    [req.params.id],
  );
  const row = result.rows[0];
  const features = Object.fromEntries(FEATURE_KEYS.map(key => [key, row ? row[key] : true])) as Record<FeatureKey, boolean>;
  return res.json({ features });
}));

router.patch('/:id/features', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { feature, enabled } = req.body ?? {};
  if (!isFeatureKey(feature)) return res.status(400).json({ message: 'Funcionalidade inválida.' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'Informe se a funcionalidade deve ficar ativa ou não.' });

  const condominium = await query(`select id from condominiums where id=$1`, [req.params.id]);
  if (!condominium.rows[0]) return res.status(404).json({ message: 'Condomínio não encontrado.' });

  const current = await query<Record<FeatureKey, boolean>>(
    `select ${FEATURE_KEYS.join(', ')} from condominium_features where condominium_id=$1`,
    [req.params.id],
  );
  const row = current.rows[0];
  const effective = Object.fromEntries(FEATURE_KEYS.map(key => [key, row ? row[key] : true])) as Record<FeatureKey, boolean>;

  if (enabled) {
    const missing = FEATURE_CATALOG[feature].dependsOn.filter(dep => !effective[dep]);
    if (missing.length) {
      return res.status(409).json({ message: `Ative antes: ${missing.map(dep => FEATURE_CATALOG[dep].label).join(', ')}.` });
    }
  } else {
    const activeDependents = dependentsOf(feature).filter(dep => effective[dep]);
    if (activeDependents.length) {
      return res.status(409).json({ message: `Desative primeiro: ${activeDependents.map(dep => FEATURE_CATALOG[dep].label).join(', ')}.` });
    }
  }

  // Grava todas as FEATURE_KEYS explicitamente (usando `effective`, que já
  // resolve "sem linha = true"), não só a coluna alterada — senão, na
  // primeira vez que o admin_geral mexe numa funcionalidade de um
  // condomínio sem linha ainda, o INSERT cria a linha e as colunas não
  // citadas caem no default da própria tabela (que não é `true` pra todas,
  // ex.: enquetes/reserva_espacos), desativando funcionalidades que
  // ninguém tocou.
  const featureValues = FEATURE_KEYS.map(key => (key === feature ? enabled : effective[key]));
  const insertColumns = ['condominium_id', ...FEATURE_KEYS, 'updated_by', 'updated_at'].join(', ');
  const insertPlaceholders = ['$1', ...FEATURE_KEYS.map((_, index) => `$${index + 2}`), `$${FEATURE_KEYS.length + 2}`, 'now()'].join(', ');
  await query(
    `insert into condominium_features (${insertColumns})
     values (${insertPlaceholders})
     on conflict (condominium_id) do update set ${feature}=excluded.${feature}, updated_by=excluded.updated_by, updated_at=now()`,
    [req.params.id, ...featureValues, req.user?.id || null],
  );

  return res.json({ features: { ...effective, [feature]: enabled } });
}));

router.put('/:id/platform-status', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['active', 'suspended', 'canceled'].includes(status)) {
    return res.status(400).json({ message: 'Situação inválida.' });
  }

  const result = await query(
    `update condominiums set platform_status = $2 where id = $1 returning id, platform_status`,
    [req.params.id, status],
  );

  if (!result.rows[0]) {
    return res.status(404).json({ message: 'Condomínio não encontrado.' });
  }

  return res.json({ condominium: result.rows[0] });
}));

router.put('/:id/plan', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const planId = String(req.body?.planId || '').trim();
  if (!planId) {
    return res.status(400).json({ message: 'Informe o plano a vincular.' });
  }

  const billingStartsAtRaw = req.body?.billingStartsAt;
  let billingStartsAt: string | null = null;
  if (billingStartsAtRaw !== undefined && billingStartsAtRaw !== null && billingStartsAtRaw !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(billingStartsAtRaw))) {
      return res.status(400).json({ message: 'Data de início de cobrança inválida.' });
    }
    billingStartsAt = String(billingStartsAtRaw);
  }

  const condominium = await query(`select id from condominiums where id = $1`, [req.params.id]);
  if (!condominium.rows[0]) {
    return res.status(404).json({ message: 'Condomínio não encontrado.' });
  }

  const plan = await query(`select id from platform_plans where id = $1 and active = true`, [planId]);
  if (!plan.rows[0]) {
    return res.status(400).json({ message: 'Plano inválido ou inativo.' });
  }

  const subscription = await withTransaction(async (client) => {
    const active = await client.query(
      `select id, plan_id from condominium_plan_subscriptions where condominium_id=$1 and ended_at is null`,
      [req.params.id],
    );

    if (active.rows[0]?.plan_id === planId) {
      // Mesmo plano já vinculado: só há algo a fazer se o admin geral está
      // ajustando a data de início de cobrança deste vínculo existente.
      if (!billingStartsAt) return active.rows[0];
      const updated = await client.query(
        `update condominium_plan_subscriptions set billing_starts_at=$2 where id=$1 returning *`,
        [active.rows[0].id, billingStartsAt],
      );
      return updated.rows[0];
    }

    if (active.rows[0]) {
      await client.query(
        `update condominium_plan_subscriptions set ended_at = current_date where id=$1`,
        [active.rows[0].id],
      );
    }

    const created = await client.query(
      `insert into condominium_plan_subscriptions (id, condominium_id, plan_id, notes, created_by, billing_starts_at)
       values ($1,$2,$3,$4,$5, coalesce($6::date, (current_date + interval '1 month')::date))
       returning *`,
      [randomUUID(), req.params.id, planId, req.body?.notes || null, req.user?.id, billingStartsAt],
    );

    return created.rows[0];
  });

  return res.json({ subscription });
}));

export default router;
