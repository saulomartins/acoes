import { existsSync, readdirSync, statSync } from 'fs';
import { unlink } from 'fs/promises';
import { join, resolve } from 'path';

// Os APKs da central "Instalar aplicativo" ficam no volume do serviço `acoes`
// no Railway (434 MB). Cada build tem ~70 MB e nada apagava os antigos: o
// volume encheu em 13/09/2026 (publicação falhou com ENOSPC) e estava em 79%
// em 30/09 com 5 builds. Agora só os RELEASE_FILES_TO_KEEP mais recentes
// ficam em disco — o atual e um de reserva para voltar rápido se o novo der
// problema. As linhas antigas continuam em mobile_releases (histórico), só
// sem arquivo e inativas.
export const RELEASE_FILES_TO_KEEP = 2;
// Arquivo sem linha no banco só é apagado depois disso: o upload da tela
// (multer) grava o arquivo antes de inserir a linha, e não pode ser apagado
// no meio do caminho.
const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

export const releaseDirectoryPath = () => resolve(process.env.MOBILE_RELEASES_DIR || (process.env.NODE_ENV === 'production' ? '/data/mobile-releases' : './data/mobile-releases'));

type Run = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

const insideDirectory = (directory: string, filePath: string) => resolve(filePath).startsWith(directory);

export const pruneAndroidReleaseFiles = async (run: Run, directory = releaseDirectoryPath(), keep = RELEASE_FILES_TO_KEEP) => {
  // active primeiro: a versão servida em /latest nunca é a apagada, mesmo que
  // exista uma inativa publicada depois dela.
  const { rows } = await run(
    `select id,file_path,file_size from mobile_releases
     where platform='android' and file_path is not null
     order by active desc, published_at desc, created_at desc`,
  );
  let removedFiles = 0;
  let freedBytes = 0;
  for (const row of rows.slice(keep)) {
    if (insideDirectory(directory, row.file_path) && existsSync(row.file_path)) {
      await unlink(row.file_path).catch(() => undefined);
      removedFiles += 1;
      freedBytes += Number(row.file_size || 0);
    }
    await run(`update mobile_releases set file_path=null,file_size=null,active=false where id=$1`, [row.id]);
  }

  // Sobras de uploads que falharam ou builds apagados só do banco.
  if (existsSync(directory)) {
    const referenced = new Set(rows.slice(0, keep).map(row => resolve(row.file_path)));
    for (const name of readdirSync(directory)) {
      if (!name.toLowerCase().endsWith('.apk')) continue;
      const filePath = resolve(join(directory, name));
      if (referenced.has(filePath)) continue;
      const stat = statSync(filePath);
      if (Date.now() - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      await unlink(filePath).catch(() => undefined);
      removedFiles += 1;
      freedBytes += stat.size;
    }
  }
  return { removedFiles, freedMb: Math.round(freedBytes / 1024 / 1024) };
};
