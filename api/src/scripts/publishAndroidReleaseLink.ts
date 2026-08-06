/// <reference path="../pg.d.ts" />

import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const [version, buildNumber, externalUrl, releaseNotes = 'Nova versão em processamento no Expo EAS.'] = process.argv.slice(2);
if (!version || !buildNumber || !externalUrl) throw new Error('Usage: publishAndroidReleaseLink <version> <build> <https-url> [notes]');
const parsed = new URL(externalUrl);
if (parsed.protocol !== 'https:') throw new Error('External URL must use HTTPS');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query<{id:string}>(
      `select id from mobile_releases where platform='android' and version=$1 and build_number=$2 and external_url=$3 limit 1`,
      [version, buildNumber, externalUrl],
    );
    if (existing.rows[0]) {
      await pool.query('update mobile_releases set active=true,published_at=now(),release_notes=$2 where id=$1', [existing.rows[0].id, releaseNotes]);
      console.log(`Android ${version} build ${buildNumber} updated.`);
      return;
    }
    await pool.query(`
      insert into mobile_releases(id,platform,version,build_number,release_notes,external_url,active,published_at)
      values($1,'android',$2,$3,$4,$5,true,now())
    `, [randomUUID(), version, buildNumber, releaseNotes, externalUrl]);
    console.log(`Android ${version} build ${buildNumber} published as processing.`);
  } finally {
    await pool.end();
  }
})().catch(error=>{console.error(error);process.exit(1)});
