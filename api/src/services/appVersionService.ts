import { query } from '../db';

// Versões do app nas lojas, usadas pelo aviso "Nova versão disponível" do app
// Android/iOS. A comparação de verdade acontece no app (ele sabe a própria
// versão); aqui só guardamos e validamos o que o admin_geral informa.

export type AppPlatform = 'android' | 'ios';
export const APP_PLATFORMS: AppPlatform[] = ['android', 'ios'];

export type AppStoreVersion = {
  platform: AppPlatform;
  latestVersion: string | null;
  minVersion: string | null;
  storeUrl: string | null;
  releaseNotes: string | null;
  updatedAt: string;
};

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// "1.7.10" > "1.7.9": compara número a número, nunca como texto.
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

type VersionInput = { latestVersion?: unknown; minVersion?: unknown; storeUrl?: unknown; releaseNotes?: unknown };

const blankToNull = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
};

export const validateAppVersionInput = (input: VersionInput):
  | { ok: true; value: { latestVersion: string | null; minVersion: string | null; storeUrl: string | null; releaseNotes: string | null } }
  | { ok: false; message: string } => {
  const latestVersion = blankToNull(input.latestVersion);
  const minVersion = blankToNull(input.minVersion);
  const storeUrl = blankToNull(input.storeUrl);
  const releaseNotes = blankToNull(input.releaseNotes);
  if (latestVersion && !VERSION_PATTERN.test(latestVersion)) return { ok: false, message: 'Informe a versão mais recente no formato 1.7.4.' };
  if (minVersion && !VERSION_PATTERN.test(minVersion)) return { ok: false, message: 'Informe a versão mínima no formato 1.7.4.' };
  if (minVersion && !latestVersion) return { ok: false, message: 'Para exigir uma versão mínima, informe também a versão mais recente.' };
  if (minVersion && latestVersion && compareVersions(minVersion, latestVersion) > 0) return { ok: false, message: 'A versão mínima não pode ser maior que a versão mais recente.' };
  if (latestVersion && !storeUrl) return { ok: false, message: 'Informe o link do app na loja — é para onde o botão "Atualizar" leva.' };
  if (storeUrl && !/^https:\/\/\S+$/.test(storeUrl)) return { ok: false, message: 'O link da loja deve começar com https://.' };
  if (releaseNotes && releaseNotes.length > 500) return { ok: false, message: 'As novidades devem ter no máximo 500 caracteres.' };
  return { ok: true, value: { latestVersion, minVersion, storeUrl, releaseNotes } };
};

const toVersion = (row: any): AppStoreVersion => ({
  platform: row.platform,
  latestVersion: row.latest_version,
  minVersion: row.min_version,
  storeUrl: row.store_url,
  releaseNotes: row.release_notes,
  updatedAt: row.updated_at,
});

export const listAppVersions = async () => {
  const result = await query<any>(`select platform, latest_version, min_version, store_url, release_notes, updated_at from app_store_versions order by platform`);
  return result.rows.map(toVersion);
};

export const getAppVersion = async (platform: AppPlatform) => {
  const result = await query<any>(`select platform, latest_version, min_version, store_url, release_notes, updated_at from app_store_versions where platform=$1`, [platform]);
  return result.rows[0] ? toVersion(result.rows[0]) : null;
};

export const saveAppVersion = async (
  platform: AppPlatform,
  value: { latestVersion: string | null; minVersion: string | null; storeUrl: string | null; releaseNotes: string | null },
  updatedBy: string | null,
) => {
  const result = await query<any>(
    `insert into app_store_versions (platform, latest_version, min_version, store_url, release_notes, updated_at, updated_by)
     values ($1,$2,$3,$4,$5,now(),$6)
     on conflict (platform) do update set latest_version=excluded.latest_version, min_version=excluded.min_version,
       store_url=excluded.store_url, release_notes=excluded.release_notes, updated_at=now(), updated_by=excluded.updated_by
     returning platform, latest_version, min_version, store_url, release_notes, updated_at`,
    [platform, value.latestVersion, value.minVersion, value.storeUrl, value.releaseNotes, updatedBy],
  );
  return toVersion(result.rows[0]);
};
