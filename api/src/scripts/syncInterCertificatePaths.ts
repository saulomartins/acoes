/// <reference path="../pg.d.ts" />

import { config } from '../config';
import { pool, query } from '../db';

const run = async () => {
  const { certPath, keyPath } = config.inter;
  if (!certPath || !keyPath) {
    throw new Error('INTER_CERT_PATH and INTER_KEY_PATH are required');
  }

  const result = await query(
    `update bank_configurations
       set cert_path=$1, key_path=$2, updated_at=now()
     where provider='inter' and enabled=true
     returning id`,
    [certPath, keyPath],
  );

  console.log(`Updated ${result.rowCount || 0} active Banco Inter configuration(s).`);
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
