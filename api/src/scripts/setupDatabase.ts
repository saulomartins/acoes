/// <reference path="../pg.d.ts" />

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const targetUrl = new URL(databaseUrl);
const databaseName = targetUrl.pathname.replace('/', '');
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';

const ensureDatabase = async () => {
  const adminPool = new Pool({ connectionString: adminUrl.toString() });

  try {
    const exists = await adminPool.query<{ exists: boolean }>('select exists(select 1 from pg_database where datname = $1)', [
      databaseName,
    ]);

    if (!exists.rows[0]?.exists) {
      const safeDatabaseName = databaseName.replace(/"/g, '""');
      await adminPool.query(`create database "${safeDatabaseName}"`);
      console.log(`Database "${databaseName}" created.`);
    } else {
      console.log(`Database "${databaseName}" already exists.`);
    }
  } finally {
    await adminPool.end();
  }
};

const applySchema = async () => {
  const appPool = new Pool({ connectionString: databaseUrl });
  const schemaPath = resolve(__dirname, '..', 'db', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');

  try {
    await appPool.query(schema);
    console.log('Schema applied successfully.');
  } finally {
    await appPool.end();
  }
};

(async () => {
  await ensureDatabase();
  await applySchema();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
