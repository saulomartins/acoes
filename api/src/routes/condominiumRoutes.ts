import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { getInterAccessToken, type InterIntegrationConfig } from '../services/interService';

const router = Router();

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

router.get('/', authorize('admin_geral'), asyncHandler(async (_req, res) => {
  const result = await query(
    `select c.id, c.name, c.cnpj, c.address, c.created_at,
            (b.id is not null) as bank_integration_configured,
            coalesce(b.enabled, false) as bank_integration_enabled,
            b.updated_at as bank_integration_updated_at,
            b.id as bank_configuration_id,
            b.name as bank_configuration_name,
            b.provider as bank_provider
     from condominiums c
     left join condominium_bank_configurations cb on cb.condominium_id = c.id
     left join bank_configurations b on b.id = cb.bank_configuration_id
     order by c.created_at desc`,
  );

  return res.json({ condominiums: result.rows });
}));

router.post('/', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { name, cnpj, address } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'name is required' });
  }

  const result = await query(
    `insert into condominiums (id, name, cnpj, address)
     values ($1, $2, $3, $4)
     returning id, name, cnpj, address, created_at`,
    [randomUUID(), name.trim(), cnpj || null, address || null],
  );

  return res.status(201).json({ condominium: result.rows[0] });
}));

router.patch('/:id', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { name, cnpj, address } = req.body ?? {};

  const result = await query(
    `update condominiums
     set name = coalesce($2, name),
         cnpj = coalesce($3, cnpj),
         address = coalesce($4, address)
     where id = $1
     returning id, name, cnpj, address, created_at`,
    [req.params.id, name || null, cnpj || null, address || null],
  );

  if (!result.rows[0]) {
    return res.status(404).json({ message: 'condominium not found' });
  }

  return res.json({ condominium: result.rows[0] });
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

export default router;
