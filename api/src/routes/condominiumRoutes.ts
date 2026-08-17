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
// ou subsíndico é contado como síndico/subsíndico, não como proprietário. É
// uma partição sem sobreposição (cada pessoa cai em exatamente um papel
// efetivo), por isso Proprietários+Inquilinos+Síndico+Subsíndico soma
// exatamente registeredUsers — ver checksum exibido na tela.
// "Monitora outra unidade": proprietário (papel efetivo) com um vínculo ATIVO
// em unit_ownerships (tabela dedicada para posse sem moradia — ver comentário
// em schema.sql perto de "create table unit_ownerships") para uma unidade
// diferente da sua própria (users.unit_id) — mecanismo real usado quando um
// proprietário acompanha uma unidade alugada a um inquilino. NÃO é exclusivo
// com morar na própria unidade — a mesma pessoa pode morar na sua unidade E
// monitorar outra, então esse número nunca é subtraído de registeredOwners.
const EFFECTIVE_ROLE = `(case
  when u.role='sindico' or exists(select 1 from user_profiles up where up.user_id=u.id and up.role='sindico' and up.condominium_id=u.condominium_id) then 'sindico'
  when u.role='subsindico' or exists(select 1 from user_profiles up where up.user_id=u.id and up.role='subsindico' and up.condominium_id=u.condominium_id) then 'subsindico'
  else u.role
end)`;
const MONITORS_ELSEWHERE = `exists (select 1 from unit_ownerships oo where oo.owner_user_id=u.id and oo.ended_at is null and oo.unit_id is distinct from u.unit_id)`;

router.get('/user-stats', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('painel_usuarios'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? (String(req.query.condominiumId || '') || null) : req.user?.condominiumId;
  const result = await query<{
    condominium_id: string; name: string; registered_users: number; active_users: number;
    registered_owners: number; registered_tenants: number;
    monitor_only_owners: number; sindico: Array<{ id: string; fullName: string }>; subsindico: Array<{ id: string; fullName: string }>;
    total_units: number; units_with_resident: number;
  }>(
    `select c.id as condominium_id, c.name,
       count(*) filter (where u.deleted_at is null)::int as registered_users,
       count(*) filter (where u.deleted_at is null and u.login_enabled)::int as active_users,
       count(*) filter (where u.deleted_at is null and ${EFFECTIVE_ROLE}='proprietario')::int as registered_owners,
       count(*) filter (where u.deleted_at is null and ${EFFECTIVE_ROLE}='inquilino')::int as registered_tenants,
       count(*) filter (where u.deleted_at is null and ${EFFECTIVE_ROLE}='proprietario' and ${MONITORS_ELSEWHERE})::int as monitor_only_owners,
       coalesce(jsonb_agg(distinct jsonb_build_object('id',u.id,'fullName',coalesce(u.full_name,u.username))) filter (where u.deleted_at is null and ${EFFECTIVE_ROLE}='sindico'), '[]'::jsonb) as sindico,
       coalesce(jsonb_agg(distinct jsonb_build_object('id',u.id,'fullName',coalesce(u.full_name,u.username))) filter (where u.deleted_at is null and ${EFFECTIVE_ROLE}='subsindico'), '[]'::jsonb) as subsindico,
       (select count(*) from units un where un.condominium_id = c.id)::int as total_units,
       (select count(*) from units un where un.condominium_id = c.id
          and exists(select 1 from unit_occupancies oc where oc.unit_id = un.id and oc.ended_at is null))::int as units_with_resident
     from condominiums c
     left join users u on u.condominium_id = c.id
     where ($1::uuid is null or c.id = $1)
     group by c.id, c.name
     order by c.name`,
    [condominiumId],
  );
  return res.json({
    condominiums: result.rows.map(row => ({
      condominiumId: row.condominium_id,
      name: row.name,
      registeredUsers: row.registered_users,
      activeUsers: row.active_users,
      inactiveUsers: row.registered_users - row.active_users,
      registeredOwners: row.registered_owners,
      registeredTenants: row.registered_tenants,
      ownersMonitoringElsewhere: row.monitor_only_owners,
      sindico: row.sindico,
      subsindico: row.subsindico,
      totalUnits: row.total_units,
      unitsWithResident: row.units_with_resident,
      unitsWithoutResident: row.total_units - row.units_with_resident,
    })),
  });
}));

type UserStatsBucket = 'registered' | 'active' | 'inactive' | 'registered_owners' | 'registered_tenants' | 'owners_monitoring_elsewhere' | 'sindico' | 'subsindico';
const USER_STATS_BUCKET_WHERE: Record<UserStatsBucket, string> = {
  registered: `u.deleted_at is null`,
  active: `u.deleted_at is null and u.login_enabled`,
  inactive: `u.deleted_at is null and not u.login_enabled`,
  registered_owners: `u.deleted_at is null and ${EFFECTIVE_ROLE}='proprietario'`,
  registered_tenants: `u.deleted_at is null and ${EFFECTIVE_ROLE}='inquilino'`,
  owners_monitoring_elsewhere: `u.deleted_at is null and ${EFFECTIVE_ROLE}='proprietario' and ${MONITORS_ELSEWHERE}`,
  sindico: `u.deleted_at is null and ${EFFECTIVE_ROLE}='sindico'`,
  subsindico: `u.deleted_at is null and ${EFFECTIVE_ROLE}='subsindico'`,
};

// Lista nominal (nome + apartamento) de quem compõe um dos números do painel
// de usuários — mesma lógica de bucket usada na agregação acima, sem duplicar
// a definição de cada critério. isExtra indica que a pessoa está nesse bucket
// pelo perfil adicional (user_profiles), não pelo papel principal.
router.get('/user-stats/members', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('painel_usuarios'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? String(req.query.condominiumId || '') : req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const bucket = String(req.query.bucket || '') as UserStatsBucket;
  const bucketWhere = USER_STATS_BUCKET_WHERE[bucket];
  if (!bucketWhere) return res.status(400).json({ message: 'Categoria inválida.' });

  const result = await query<{ id: string; full_name: string | null; username: string; role: string; effective_role: string; unit: string | null }>(
    `select u.id, u.full_name, u.username, u.role, ${EFFECTIVE_ROLE} as effective_role,
            coalesce(nullif(concat_ws(' - ', nullif(b.name,''), nullif(un.number,'')), ''), nullif(u.unit,''), 'Sem apartamento') as unit
     from users u
     left join units un on un.id = u.unit_id
     left join blocks b on b.id = un.block_id
     where u.condominium_id = $1 and ${bucketWhere}
     order by coalesce(u.full_name, u.username)`,
    [condominiumId],
  );
  return res.json({
    members: result.rows.map(row => ({
      id: row.id,
      fullName: row.full_name || row.username,
      role: row.effective_role,
      isExtra: row.role !== row.effective_role,
      unit: row.unit,
    })),
  });
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
