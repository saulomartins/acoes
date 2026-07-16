import { randomUUID } from 'crypto';
import { config } from '../config';
import { pool, query } from '../db';

const run = async () => {
  const { clientId, clientSecret, certPath, keyPath, certPassphrase, baseUrl, tokenPath, scopes } = config.inter;

  if (!clientId || !clientSecret || !certPath || !keyPath) {
    throw new Error('INTER_CLIENT_ID, INTER_CLIENT_SECRET, INTER_CERT_PATH and INTER_KEY_PATH are required');
  }

  const condominiums = await query<{ id: string; name: string }>('select id, name from condominiums order by created_at');

  if (condominiums.rows.length !== 1) {
    throw new Error(`Expected exactly one condominium, found ${condominiums.rows.length}`);
  }

  const condominium = condominiums.rows[0];
  await query(
    `insert into inter_integrations (
       id, condominium_id, client_id, client_secret, cert_path, key_path, cert_passphrase,
       base_url, token_path, scopes, enabled, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now())
     on conflict (condominium_id) do update
       set client_id = excluded.client_id,
           client_secret = excluded.client_secret,
           cert_path = excluded.cert_path,
           key_path = excluded.key_path,
           cert_passphrase = excluded.cert_passphrase,
           base_url = excluded.base_url,
           token_path = excluded.token_path,
           scopes = excluded.scopes,
           enabled = true,
           updated_at = now()`,
    [randomUUID(), condominium.id, clientId, clientSecret, certPath, keyPath, certPassphrase || null, baseUrl, tokenPath, scopes],
  );

  console.log(`Inter integration configured for condominium: ${condominium.name}`);
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
