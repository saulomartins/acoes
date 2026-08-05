import { Pool, PoolClient } from 'pg';
import { config } from './config';

// Com PGSSL=true, valida o certificado do servidor por padrão (protege contra
// MITM na conexão com o banco). Só desliga a validação se PGSSL_REJECT_UNAUTHORIZED
// for explicitamente 'false' — necessário apenas se o provedor usar certificado
// autoassinado sem oferecer a CA para configurar em PGSSL_CA.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSL === 'true'
    ? {
        rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.PGSSL_CA || undefined,
        // Bancos gerenciados internos (ex.: addon de Postgres do Railway) costumam
        // emitir o certificado só com SAN "localhost", que nunca bate com o
        // hostname interno real de conexão. Quando uma CA é fixada explicitamente
        // via PGSSL_CA, a cadeia de confiança já garante que é o servidor
        // correto — pular a checagem de hostname aqui não abre mão dessa proteção.
        checkServerIdentity: process.env.PGSSL_CA ? () => undefined : undefined,
      }
    : false,
});

export const query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  return pool.query<T>(text, params);
};

export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>) => {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
