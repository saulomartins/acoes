import { beforeEach, describe, expect, it, vi } from 'vitest';

// Banco falso: só as consultas da migração. Cada arquivo tem `content`
// (Buffer ou null) e `drive_file_id`.
const db = vi.hoisted(() => ({
  folder: 'pasta-raiz' as string | null,
  attachments: [] as Array<{ expense_id: string; kind: string; reference_month: string; file_name: string; mime_type: string; content: Buffer | null; drive_file_id: string | null }>,
}));

vi.mock('../db', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('select google_drive_folder_id from condominiums')) return { rows: [{ google_drive_folder_id: db.folder }] };
    if (s.includes('from accountability_report_statements')) return { rows: [], rowCount: 0 };
    if (s.startsWith('select expense_id, kind, to_char')) {
      return { rows: db.attachments.filter(a => a.content && !a.drive_file_id).map(({ content, drive_file_id, ...rest }) => rest) };
    }
    const find = () => db.attachments.find(a => a.expense_id === params[0] && a.kind === params[1]);
    if (s.startsWith('select content from accountability_expense_attachments')) return { rows: find() ? [{ content: find()!.content }] : [] };
    if (s.startsWith('update accountability_expense_attachments set drive_file_id')) {
      const row = find();
      if (!row || row.drive_file_id || !row.content) return { rowCount: 0 };
      row.drive_file_id = params[2]; row.content = null;
      return { rowCount: 1 };
    }
    throw new Error(`SQL não esperado: ${s}`);
  }),
}));

const drive = vi.hoisted(() => ({ files: new Map<string, number>(), next: 0, failUpload: false, wrongSize: false }));
vi.mock('./googleDriveService', () => ({
  isGoogleDriveConfigured: () => true,
  getDriveFolderMeta: vi.fn(async () => ({ id: 'pasta-raiz' })),
  findOrCreateMonthFolder: vi.fn(async (_root: string, month: string) => `mes-${month.slice(0, 7)}`),
  uploadDriveFile: vi.fn(async (_folder: string, _name: string, _mime: string, buffer: Buffer) => {
    if (drive.failUpload) throw new Error('Drive fora');
    const id = `arquivo-${++drive.next}`;
    drive.files.set(id, drive.wrongSize ? buffer.length - 1 : buffer.length);
    return id;
  }),
  getDriveFileSize: vi.fn(async (id: string) => drive.files.get(id) ?? null),
  deleteDriveFile: vi.fn(async (id: string) => { drive.files.delete(id); }),
}));

import { migrateCondominiumFilesToDrive } from './driveMigrationService';

const addAttachment = (expenseId: string, bytes = 1000) => db.attachments.push({
  expense_id: expenseId, kind: 'receipt', reference_month: '2026-09-01', file_name: `${expenseId}.pdf`, mime_type: 'application/pdf',
  content: Buffer.alloc(bytes, 1), drive_file_id: null,
});

beforeEach(() => {
  db.folder = 'pasta-raiz';
  db.attachments = [];
  drive.files.clear(); drive.next = 0; drive.failUpload = false; drive.wrongSize = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('migrateCondominiumFilesToDrive', () => {
  it('move cada arquivo para o Drive e só então apaga a cópia do banco', async () => {
    addAttachment('d1'); addAttachment('d2', 5000);
    await expect(migrateCondominiumFilesToDrive('condo-1')).resolves.toEqual({ moved: 2, failed: 0 });
    expect(db.attachments.every(a => a.content === null && a.drive_file_id)).toBe(true);
    expect(drive.files.size).toBe(2);
  });

  it('falha no envio: o arquivo continua inteiro no banco', async () => {
    addAttachment('d1');
    drive.failUpload = true;
    await expect(migrateCondominiumFilesToDrive('condo-1')).resolves.toEqual({ moved: 0, failed: 1 });
    expect(db.attachments[0].content?.length).toBe(1000);
    expect(db.attachments[0].drive_file_id).toBeNull();
  });

  it('Drive gravou tamanho diferente: não apaga do banco e remove a cópia ruim do Drive', async () => {
    addAttachment('d1');
    drive.wrongSize = true;
    await expect(migrateCondominiumFilesToDrive('condo-1')).resolves.toEqual({ moved: 0, failed: 1 });
    expect(db.attachments[0].content?.length).toBe(1000);
    expect(drive.files.size).toBe(0);
  });

  it('sem pasta do Drive no condomínio: não mexe em nada', async () => {
    addAttachment('d1');
    db.folder = null;
    const result = await migrateCondominiumFilesToDrive('condo-1');
    expect(result.moved).toBe(0);
    expect(result.skipped).toBeTruthy();
    expect(db.attachments[0].content?.length).toBe(1000);
  });

  it('rodar de novo não envia o mesmo arquivo duas vezes', async () => {
    addAttachment('d1');
    await migrateCondominiumFilesToDrive('condo-1');
    await expect(migrateCondominiumFilesToDrive('condo-1')).resolves.toEqual({ moved: 0, failed: 0 });
    expect(drive.files.size).toBe(1);
  });
});
