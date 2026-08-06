import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, extname, resolve } from 'path';
import { Router } from 'express';
import multer from 'multer';
import { query } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const releaseDirectory = resolve(process.env.MOBILE_RELEASES_DIR || (process.env.NODE_ENV === 'production' ? '/data/mobile-releases' : './data/mobile-releases'));
mkdirSync(releaseDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: releaseDirectory,
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 150 * 1024 * 1024 },
});

type Platform = 'android' | 'ios';
const isPlatform = (value: string): value is Platform => value === 'android' || value === 'ios';
const serialize = (row: any) => ({
  id: row.id,
  platform: row.platform,
  version: row.version,
  buildNumber: row.build_number,
  releaseNotes: row.release_notes,
  externalUrl: row.external_url,
  hasFile: Boolean(row.file_path),
  fileSize: row.file_size == null ? null : Number(row.file_size),
  publishedAt: row.published_at,
  createdAt: row.created_at,
});

router.use(authenticate);

router.get('/latest', asyncHandler(async (_req, res) => {
  const result = await query<any>(`
    select * from mobile_releases
    where active=true
    order by platform, published_at desc, created_at desc
  `);
  const latest = new Map<string, any>();
  for (const row of result.rows) if (!latest.has(row.platform)) latest.set(row.platform, serialize(row));
  return res.json({ android: latest.get('android') || null, ios: latest.get('ios') || null });
}));

router.get('/', authorize('admin_geral'), asyncHandler(async (_req, res) => {
  const result = await query<any>('select * from mobile_releases order by published_at desc, created_at desc');
  return res.json({ releases: result.rows.map(serialize) });
}));

router.post('/', authorize('admin_geral'), upload.single('file'), asyncHandler(async (req, res) => {
  const platform = String(req.body?.platform || '');
  const version = String(req.body?.version || '').trim();
  const buildNumber = String(req.body?.buildNumber || '').trim();
  const releaseNotes = String(req.body?.releaseNotes || '').trim() || null;
  const externalUrl = String(req.body?.externalUrl || '').trim() || null;
  const file = req.file;

  const removeUploadedFile = async () => {
    if (file?.path && existsSync(file.path)) await unlink(file.path).catch(() => undefined);
  };

  if (!isPlatform(platform) || !version || !buildNumber) {
    await removeUploadedFile();
    return res.status(400).json({ message: 'Informe plataforma, versão e número do build.' });
  }
  if (platform === 'android' && !file && !externalUrl) {
    return res.status(400).json({ message: 'Envie um APK ou informe um link externo para Android.' });
  }
  if (platform === 'ios' && !externalUrl) {
    await removeUploadedFile();
    return res.status(400).json({ message: 'Informe o link da App Store ou TestFlight para iOS.' });
  }
  if (file && (platform !== 'android' || extname(file.originalname).toLowerCase() !== '.apk')) {
    await removeUploadedFile();
    return res.status(400).json({ message: 'Somente arquivos APK podem ser armazenados.' });
  }
  if (externalUrl) {
    try {
      const parsed = new URL(externalUrl);
      if (parsed.protocol !== 'https:') throw new Error('invalid protocol');
    } catch {
      await removeUploadedFile();
      return res.status(400).json({ message: 'O link externo deve ser uma URL HTTPS válida.' });
    }
  }

  const id = randomUUID();
  await query(`
    insert into mobile_releases(
      id,platform,version,build_number,release_notes,external_url,file_path,file_name,file_size,mime_type,active,published_by,published_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,now())
  `, [
    id, platform, version, buildNumber, releaseNotes, externalUrl,
    file?.path || null, file ? basename(file.originalname) : null, file?.size || null,
    file?.mimetype || null, req.user?.id,
  ]);
  return res.status(201).json({ id, message: `${platform === 'android' ? 'Android' : 'iOS'} ${version} publicado.` });
}));

router.patch('/:id/activate', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query<any>('update mobile_releases set active=true,published_at=now() where id=$1 returning platform,version', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: 'Versão não encontrada.' });
  return res.json({ message: `${result.rows[0].platform} ${result.rows[0].version} definido como versão atual.` });
}));

router.delete('/:id', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const result = await query<any>('delete from mobile_releases where id=$1 returning file_path', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ message: 'Versão não encontrada.' });
  const filePath = result.rows[0].file_path as string | null;
  if (filePath && resolve(filePath).startsWith(releaseDirectory) && existsSync(filePath)) await unlink(filePath).catch(() => undefined);
  return res.status(204).send();
}));

router.get('/:id/download', asyncHandler(async (req, res) => {
  const result = await query<any>('select * from mobile_releases where id=$1 and active=true', [req.params.id]);
  const release = result.rows[0];
  if (!release) return res.status(404).json({ message: 'Versão não encontrada.' });
  if (release.file_path && existsSync(release.file_path)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(release.file_name || `lar-em-dia-${release.version}.apk`)}`);
    res.setHeader('Content-Length', String(release.file_size));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(resolve(release.file_path));
  }
  if (release.external_url) return res.redirect(302, release.external_url);
  return res.status(404).json({ message: 'Instalador indisponível.' });
}));

export default router;
