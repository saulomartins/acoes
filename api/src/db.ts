import { Pool, PoolClient } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
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
