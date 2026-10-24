import { query } from '../db';
import { deleteDriveFile, findOrCreateMonthFolder, getDriveFileSize, getDriveFolderMeta, isGoogleDriveConfigured, uploadDriveFile } from './googleDriveService';

// Desde 24/10/2026 todo arquivo do condomínio (prestação de contas, regimento
// em PDF, anexos de ocorrência) fica só no Google Drive do condomínio. Os
// enviados antes, quando o condomínio ainda não tinha pasta, ficaram dentro do
// Postgres (coluna `content`) — chegaram a 60% do banco. Esta migração leva
// cada um para o Drive e só então apaga a cópia do banco.
//
// Segurança dos dados: um arquivo por vez; o conteúdo do banco só é zerado
// depois que o Drive confirma o arquivo com o MESMO tamanho; qualquer falha
// deixa aquele arquivo como estava (tenta de novo na próxima rodada). Roda ao
// salvar a pasta do condomínio, no job diário e em "Mover arquivos". Idempotente.
export const DRIVE_REQUIRED_MESSAGE = 'Este condomínio guarda os arquivos no Google Drive, e a pasta do Drive ainda não foi configurada. Peça ao administrador do Lar em Dia para vincular a pasta do condomínio.';
// Para o morador (anexo de ocorrência), que não fala com o administrador da plataforma.
export const DRIVE_REQUIRED_RESIDENT_MESSAGE = 'O envio de anexos ainda não está disponível neste condomínio. Registre a ocorrência sem anexo e, se precisar, fale com o síndico.';

type Source = {
  table: string;
  key: string[];
  label: string;
  // Mês (YYYY-MM-DD) da subpasta no Drive; null = raiz da pasta do condomínio.
  monthSql: string | null;
  mimeSql: string;
};

const SOURCES: Source[] = [
  { table: 'accountability_expense_attachments', key: ['expense_id', 'kind'], label: 'anexo de despesa', monthSql: `to_char(t.reference_month, 'YYYY-MM-DD')`, mimeSql: 't.mime_type' },
  { table: 'accountability_report_statements', key: ['report_id'], label: 'extrato', monthSql: `to_char(t.reference_month, 'YYYY-MM-DD')`, mimeSql: 't.mime_type' },
  // Mesmo lugar onde o envio pela tela grava (subpasta do mês da ocorrência).
  { table: 'occurrence_attachments', key: ['id'], label: 'anexo de ocorrência', monthSql: `(select to_char(o.created_at, 'YYYY-MM-DD') from occurrences o where o.id = t.occurrence_id)`, mimeSql: 't.mime_type' },
  // Regimento: raiz da pasta, sempre PDF (a tabela não guarda o tipo).
  { table: 'regulation_documents', key: ['condominium_id'], label: 'regimento interno', monthSql: null, mimeSql: `'application/pdf'` },
];

export type DriveMigrationResult = { moved: number; failed: number; skipped?: string };

// Quantos arquivos do condomínio ainda estão dentro do banco.
export const countFilesInDatabase = async (condominiumId: string) => {
  const parts = SOURCES.map(source => `(select count(*) from ${source.table} where condominium_id=$1 and content is not null)`);
  const result = await query<{ count: number }>(`select ${parts.join(' + ')} as count`, [condominiumId]);
  return Number(result.rows[0]?.count || 0);
};

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
      const keyList = source.key.map(column => `t.${column}`).join(', ');
      const pending = await query<Record<string, string | null>>(
        `select ${keyList}, ${source.monthSql ?? 'null'} reference_month, t.file_name, ${source.mimeSql} mime_type
         from ${source.table} t where t.condominium_id=$1 and t.content is not null and t.drive_file_id is null`,
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
          let folderId = rootFolderId;
          if (row.reference_month) {
            const cached = monthFolders.get(row.reference_month);
            folderId = cached || await findOrCreateMonthFolder(rootFolderId, row.reference_month);
            monthFolders.set(row.reference_month, folderId);
          }
          driveFileId = await uploadDriveFile(folderId, String(row.file_name), String(row.mime_type || 'application/octet-stream'), content);
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
  const pending = SOURCES.map(source => `exists(select 1 from ${source.table} t where t.condominium_id=c.id and t.content is not null)`).join(' or ');
  const condos = await query<{ id: string }>(`select c.id from condominiums c where c.google_drive_folder_id is not null and (${pending})`);
  for (const condo of condos.rows) {
    try {
      await migrateCondominiumFilesToDrive(condo.id);
    } catch (error) {
      console.warn('Migração para o Drive falhou para o condomínio', { condominiumId: condo.id, error: error instanceof Error ? error.message : error });
    }
  }
};
