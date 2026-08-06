import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { findOrCreateMonthFolder, uploadDriveFile, downloadDriveFile, deleteDriveFile } from '../services/googleDriveService';
import { logAudit } from '../services/auditService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(authenticate);
router.use(requireFeature('regimento_ocorrencias'));

const manager = (role?: string) => role === 'sindico' || role === 'subsindico' || role === 'admin_geral';
const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const canAccessOccurrence = async (occurrenceId: string, condominiumId: string, userId: string, isManager: boolean) => {
  const occurrence = await query<any>(`select id, reported_by, unit_id from occurrences where id=$1 and condominium_id=$2`, [occurrenceId, condominiumId]);
  if (!occurrence.rows[0]) return false;
  if (isManager) return true;
  if (occurrence.rows[0].reported_by === userId) return true;
  const own = await query<{ unit_id: string }>(`select unit_id from unit_occupancies where user_id=$1 and ended_at is null`, [userId]);
  return own.rows.some(row => row.unit_id === occurrence.rows[0].unit_id);
};

router.get('/:occurrenceId', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  if (!(await canAccessOccurrence(req.params.occurrenceId, condominiumId, req.user!.id, manager(req.user?.role)))) {
    return res.status(403).json({ message: 'Você não tem acesso a esta ocorrência.' });
  }
  const result = await query(
    `select id, file_name, mime_type, file_size, created_at from occurrence_attachments where occurrence_id=$1 order by created_at`,
    [req.params.occurrenceId],
  );
  return res.json({ attachments: result.rows });
}));

router.post('/:occurrenceId', upload.single('file'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  if (!(await canAccessOccurrence(req.params.occurrenceId, condominiumId, req.user!.id, manager(req.user?.role)))) {
    return res.status(403).json({ message: 'Você não tem acesso a esta ocorrência.' });
  }
  if (!req.file || !allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ message: 'Envie JPG, PNG, WEBP ou PDF de até 10 MB.' });
  }

  const occurrence = await query<{ created_at: string }>(`select created_at from occurrences where id=$1`, [req.params.occurrenceId]);
  const condominium = await query<{ google_drive_folder_id: string | null }>(`select google_drive_folder_id from condominiums where id=$1`, [condominiumId]);
  const rootFolderId = condominium.rows[0]?.google_drive_folder_id;

  let driveFileId: string | null = null;
  let content: Buffer | null = req.file.buffer;
  if (rootFolderId) {
    try {
      const referenceMonth = new Date(occurrence.rows[0].created_at).toISOString().slice(0, 10);
      const folderId = await findOrCreateMonthFolder(rootFolderId, referenceMonth);
      driveFileId = await uploadDriveFile(folderId, req.file.originalname, req.file.mimetype, req.file.buffer);
      content = null;
    } catch (error: any) {
      return res.status(502).json({ message: error?.message || 'Falha ao enviar o arquivo para o Google Drive.' });
    }
  }

  await query(
    `insert into occurrence_attachments(id, occurrence_id, condominium_id, file_name, mime_type, file_size, content, drive_file_id, uploaded_by)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), req.params.occurrenceId, condominiumId, req.file.originalname, req.file.mimetype, req.file.size, content, driveFileId, req.user?.id],
  );
  await logAudit(req, 'ocorrencias', 'attachment_uploaded', 'Enviou um anexo de ocorrência', { entityId: req.params.occurrenceId });
  return res.status(201).json({ message: 'Anexo armazenado.' });
}));

router.get('/:occurrenceId/:attachmentId/download', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  if (!(await canAccessOccurrence(req.params.occurrenceId, condominiumId, req.user!.id, manager(req.user?.role)))) {
    return res.status(403).json({ message: 'Você não tem acesso a esta ocorrência.' });
  }
  const result = await query<any>(
    `select file_name, mime_type, content, drive_file_id from occurrence_attachments where id=$1 and occurrence_id=$2`,
    [req.params.attachmentId, req.params.occurrenceId],
  );
  const file = result.rows[0];
  if (!file) return res.status(404).json({ message: 'Anexo não encontrado.' });
  let content = file.content;
  if (file.drive_file_id) {
    try { content = await downloadDriveFile(file.drive_file_id); }
    catch (error: any) { return res.status(502).json({ message: error?.message || 'Falha ao buscar o arquivo no Google Drive.' }); }
  }
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(content);
}));

router.delete('/:occurrenceId/:attachmentId', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);
  const occurrence = await query<any>(`select reported_by from occurrences where id=$1 and condominium_id=$2`, [req.params.occurrenceId, condominiumId]);
  if (!occurrence.rows[0]) return res.status(404).json({ message: 'Ocorrência não encontrada.' });

  const attachment = await query<any>(`select uploaded_by, drive_file_id from occurrence_attachments where id=$1 and occurrence_id=$2`, [req.params.attachmentId, req.params.occurrenceId]);
  if (!attachment.rows[0]) return res.status(404).json({ message: 'Anexo não encontrado.' });
  if (!isManager && attachment.rows[0].uploaded_by !== req.user?.id) {
    return res.status(403).json({ message: 'Você só pode excluir anexos que você mesmo enviou.' });
  }

  await query(`delete from occurrence_attachments where id=$1`, [req.params.attachmentId]);
  if (attachment.rows[0].drive_file_id) await deleteDriveFile(attachment.rows[0].drive_file_id);
  await logAudit(req, 'ocorrencias', 'attachment_deleted', 'Excluiu um anexo de ocorrência', { entityId: req.params.occurrenceId });
  return res.status(204).send();
}));

export default router;
