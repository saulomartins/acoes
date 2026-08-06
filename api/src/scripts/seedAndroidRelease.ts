/// <reference path="../pg.d.ts" />

import { createHash, randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const [sourceUrl, version, buildNumber, expectedSha256] = process.argv.slice(2);
if (!sourceUrl || !version || !buildNumber || !expectedSha256) {
  throw new Error('Usage: seedAndroidRelease <sourceUrl> <version> <buildNumber> <sha256>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

const directory = resolve(process.env.MOBILE_RELEASES_DIR || (process.env.NODE_ENV === 'production' ? '/data/mobile-releases' : './data/mobile-releases'));
mkdirSync(directory, { recursive: true });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const existing = await pool.query<{id:string;file_path:string|null}>(
    `select id,file_path from mobile_releases where platform='android' and version=$1 and build_number=$2 and file_path is not null order by published_at desc limit 1`,
    [version, buildNumber],
  );
  if (existing.rows[0]?.file_path) {
    await pool.query('update mobile_releases set active=true,published_at=now() where id=$1', [existing.rows[0].id]);
    await pool.end();
    console.log(`Android ${version} build ${buildNumber} already exists and was promoted.`);
    return;
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Failed to download APK: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) throw new Error(`APK checksum mismatch: ${actualSha256}`);

  const id = randomUUID();
  const fileName = `lar-em-dia-${version}-build-${buildNumber}.apk`;
  const filePath = resolve(directory, `${id}.apk`);
  writeFileSync(filePath, bytes);

  try {
    await pool.query(`
      insert into mobile_releases(
        id,platform,version,build_number,release_notes,file_path,file_name,file_size,mime_type,active,published_at
      ) values($1,'android',$2,$3,$4,$5,$6,$7,'application/vnd.android.package-archive',true,now())
    `, [id, version, buildNumber, 'Versão oficial de produção do Lar em Dia.', filePath, basename(fileName), bytes.length]);
  } finally {
    await pool.end();
  }
  console.log(`Android ${version} build ${buildNumber} published (${bytes.length} bytes, SHA-256 ${actualSha256}).`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
