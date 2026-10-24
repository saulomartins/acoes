import { query } from '../db';
import { deleteDriveFile, findOrCreateMonthFolder, getDriveFileSize, getDriveFolderMeta, isGoogleDriveConfigured, uploadDriveFile } from './googleDriveService';

// Desde 24/10/2026 a prestação de contas só guarda arquivo no Google Drive do
// condomínio. Os anexos e extratos enviados antes, quando o condomínio ainda
// não tinha pasta, ficaram dentro do Postgres (coluna `content`) — eram 60% do
// banco. Esta migração leva cada um para a subpasta do mês no Drive e só
// então apaga a cópia do banco.
//
// Segurança dos dados: um arquivo por vez; o conteúdo do banco só é zerado
// depois que o Drive confirma o arquivo com o MESMO tamanho; qualquer falha
// deixa aquele arquivo como estava (tenta de novo na próxima rodada). Roda ao
// salvar a pasta do condomínio e no job diário. Idempotente.
export const DRIVE_REQUIRED_MESSAGE = 'A prestação de contas guarda os arquivos no Google Drive do condomínio, e ele ainda não foi configurado. Peça ao administrador do Lar em Dia para vincular a pasta do Drive do condomínio.';

type Source = {
  table: string;
  key: string[];
  label: string;
};

const SOURCES: Source[] = [
  { table: 'accountability_expense_attachments', key: ['expense_id', 'kind'], label: 'anexo de despesa' },
  { table: 'accountability_report_statements', key: ['report_id'], label: 'extrato' },
];

export type DriveMigrationResult = { moved: number; failed: number; skipped?: string };

const running = new Set<string>();

export const migrateCondominiumFilesToDrive = async (condominiumId: string): Promise<DriveMigrationResult> => {
  if (!isGoogleDriveConfigured()) return { moved: 0, failed: 0, skipped: 'Integração com o Google Drive não configurada no servidor.' };
  // Duas rodadas ao mesmo tempo (salvar a pasta + job diário) enviariam o
  // mesmo arquivo duas vezes.
  if (running.has(condominiumId)) return { moved: 0, failed: 0, skipped: 'Migração já em andamento.' };
  running.add(condominiumId);
  try {
    const condo = await query<{ google_drive_folder_id: string | null }>(`select google_drive_folder_id from condominiums where id=$1`, [condominiumId]);
    const rootFolderId = condo.rows[0]?.google_drive_folder_id;
    if (!rootFolderId) return { moved: 0, failed: 0, skipped: 'Condomínio sem pasta do Google Drive.' };
    await getDriveFolderMeta(rootFolderId); // sem acesso à pasta: lança e não mexe em nada

    const monthFolders = new Map<string, string>();
    const result: DriveMigrationResult = { moved: 0, failed: 0 };
    for (const source of SOURCES) {
      const keyList = source.key.join(', ');
      const pending = await query<Record<string, string>>(
        `select ${keyList}, to_char(reference_month, 'YYYY-MM-DD') reference_month, file_name, mime_type
         from ${source.table} where condominium_id=$1 and content is not null and drive_file_id is null`,
        [condominiumId],
      );
      for (const row of pending.rows) {
        const where = source.key.map((column, index) => `${column}=$${index + 1}`).join(' and ');
        const keyValues = source.key.map(column => row[column]);
        let driveFileId: string | null = null;
        try {
          const file = await query<{ content: Buffer }>(`select content from ${source.table} where ${where}`, keyValues);
          const content = file.rows[0]?.content;
          if (!content) continue;
          let folderId = monthFolders.get(row.reference_month);
          if (!folderId) {
            folderId = await findOrCreateMonthFolder(rootFolderId, row.reference_month);
            monthFolders.set(row.reference_month, folderId);
          }
          driveFileId = await uploadDriveFile(folderId, row.file_name, row.mime_type, content);
          const size = await getDriveFileSize(driveFileId);
          if (size !== content.length) throw new Error(`tamanho no Drive (${size}) diferente do banco (${content.length})`);
          const updated = await query(
            `update ${source.table} set drive_file_id=$${keyValues.length + 1}, content=null where ${where} and drive_file_id is null and content is not null`,
            [...keyValues, driveFileId],
          );
          if (!updated.rowCount) {
            // O arquivo mudou no meio (novo envio pela tela): descarta esta cópia.
            await deleteDriveFile(driveFileId);
            continue;
          }
          result.moved += 1;
        } catch (error) {
          result.failed += 1;
          if (driveFileId) await deleteDriveFile(driveFileId);
          console.warn(`Migração para o Drive: falha ao mover ${source.label}`, { condominiumId, key: keyValues, error: error instanceof Error ? error.message : error });
        }
      }
    }
    if (result.moved || result.failed) console.log(`Migração para o Drive (${condominiumId}): ${result.moved} arquivo(s) movido(s), ${result.failed} com falha.`);
    return result;
  } finally {
    running.delete(condominiumId);
  }
};

// Job diário: todos os condomínios com pasta configurada e arquivo ainda no banco.
export const migrateAllCondominiumFilesToDrive = async () => {
  const condos = await query<{ id: string }>(
    `select c.id from condominiums c where c.google_drive_folder_id is not null and (
       exists(select 1 from accountability_expense_attachments a where a.condominium_id=c.id and a.content is not null)
       or exists(select 1 from accountability_report_statements s where s.condominium_id=c.id and s.content is not null))`,
  );
  for (const condo of condos.rows) {
    try {
      await migrateCondominiumFilesToDrive(condo.id);
    } catch (error) {
      console.warn('Migração para o Drive falhou para o condomínio', { condominiumId: condo.id, error: error instanceof Error ? error.message : error });
    }
  }
};
