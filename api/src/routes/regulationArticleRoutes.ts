import { randomUUID } from 'crypto';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { logAudit } from '../services/auditService';
import { STARTER_REGULATION_TEMPLATE } from '../db/seeds/regulationArticleTemplate';
import { uploadDriveFile, downloadDriveFile, deleteDriveFile } from '../services/googleDriveService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
router.use(authenticate);
router.use(requireFeature('regimento_ocorrencias'));

// PDF do regimento interno (regulation_documents). A leitura fica antes do
// authorize abaixo de propósito: o regimento é um documento do condomínio
// inteiro, então qualquer usuário dele pode consultar e abrir.
router.get('/document/info', asyncHandler(async (req, res) => {
  const result = await query<any>(
    `select file_name, file_size, created_at from regulation_documents where condominium_id=$1`,
    [req.user?.condominiumId],
  );
  const row = result.rows[0];
  return res.json({ document: row ? { fileName: row.file_name, fileSize: row.file_size, uploadedAt: row.created_at } : null });
}));

router.get('/document', asyncHandler(async (req, res) => {
  const result = await query<any>(
    `select file_name, content, drive_file_id from regulation_documents where condominium_id=$1`,
    [req.user?.condominiumId],
  );
  const file = result.rows[0];
  if (!file) return res.status(404).json({ message: 'O regimento interno em PDF ainda não foi enviado.' });
  let content = file.content;
  if (file.drive_file_id) {
    try { content = await downloadDriveFile(file.drive_file_id); }
    catch (error: any) { return res.status(502).json({ message: error?.message || 'Falha ao buscar o regimento no Google Drive.' }); }
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(content);
}));
// A consulta dos artigos também fica antes do authorize: o morador vê o
// regimento em modo leitura (tela "Regimento interno"), mas só os artigos
// ativos — os desativados são assunto da gestão.
router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId || null;
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const manager = ['sindico', 'subsindico'].includes(req.user?.role || '');
  const activeFilter = !manager ? 'and active=true' : req.query.active === 'all' ? '' : req.query.active === 'false' ? 'and active=false' : 'and active=true';
  const result = await query(
    `select ${COLUMNS} from regulation_articles where condominium_id=$1 ${activeFilter} order by article_number`,
    [condominiumId],
  );
  return res.json({ articles: result.rows });
}));

// Regimento é de um condomínio só. admin_geral não tem condominium_id, então
// não há regimento que ele possa gerir — a gestão é sempre local.
router.use(authorize('sindico', 'subsindico'));

// Só síndico/subsíndico chegam aqui, e eles nunca escolhem o condomínio:
// é sempre o próprio, ignorando qualquer valor enviado no corpo/query.
const scopedCondominiumId = (req: any): string | null => req.user?.condominiumId || null;

const COLUMNS = `id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
  late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
  reiteration_daily_percent, acknowledgment_tolerance_days, active, created_at, updated_at`;

const validateArticleBody = (body: any): string | null => {
  const { articleNumber, description, baseFinePercent, paymentDeadlineDays, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent } = body ?? {};
  if (!String(articleNumber || '').trim()) return 'Informe o número do artigo.';
  if (!String(description || '').trim()) return 'Informe a descrição do artigo.';
  if (!Number.isFinite(Number(baseFinePercent)) || Number(baseFinePercent) < 0) return 'Informe um percentual de multa válido.';
  if (!Number.isInteger(Number(paymentDeadlineDays)) || Number(paymentDeadlineDays) <= 0) return 'Informe um prazo de pagamento válido (dias).';
  if (!['IGPM', 'INPC', 'FIXED'].includes(monetaryCorrectionIndex)) return 'Selecione um índice de correção monetária válido.';
  if (monetaryCorrectionIndex === 'FIXED' && !Number.isFinite(Number(fixedMonthlyCorrectionPercent))) {
    return 'Informe o percentual fixo de correção mensal.';
  }
  return null;
};

router.post('/', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const error = validateArticleBody(req.body);
  if (error) return res.status(400).json({ message: error });

  const {
    articleNumber, description, baseFinePercent, paymentDeadlineDays,
    lateInterestPercentMonth, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent,
    reiterationDailyPercent, acknowledgmentToleranceDays,
  } = req.body;

  const result = await query<any>(
    `insert into regulation_articles(
       id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
       late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
       reiteration_daily_percent, acknowledgment_tolerance_days, created_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning ${COLUMNS}`,
    [
      randomUUID(), condominiumId, String(articleNumber).trim(), String(description).trim(),
      Number(baseFinePercent), Number(paymentDeadlineDays), Number(lateInterestPercentMonth) || 0,
      monetaryCorrectionIndex, monetaryCorrectionIndex === 'FIXED' ? Number(fixedMonthlyCorrectionPercent) : null,
      Number(reiterationDailyPercent) || 0, acknowledgmentToleranceDays != null ? Number(acknowledgmentToleranceDays) : null,
      req.user?.id || null,
    ],
  );
  await logAudit(req, 'regimento', 'created', `Cadastrou o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
  return res.status(201).json({ article: result.rows[0] });
}));

// Envia ou substitui o PDF do regimento. Conferimos a assinatura do arquivo
// (%PDF-) além do tipo informado, que o navegador preenche pela extensão.
// O multer rejeita arquivo acima do limite com um erro próprio, que o
// tratador geral devolveria como "internal server error".
const receivePdf: RequestHandler = (req, res, next) => upload.single('file')(req, res, error =>
  error ? res.status(400).json({ message: 'Envie o regimento interno em PDF, com até 20 MB.' }) : next());

router.post('/document', receivePdf, asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  if (!req.file || req.file.mimetype !== 'application/pdf' || req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ message: 'Envie o regimento interno em PDF, com até 20 MB.' });
  }
  const condominium = await query<{ google_drive_folder_id: string | null }>(`select google_drive_folder_id from condominiums where id=$1`, [condominiumId]);
  const rootFolderId = condominium.rows[0]?.google_drive_folder_id;
  const previous = await query<{ drive_file_id: string | null }>(`select drive_file_id from regulation_documents where condominium_id=$1`, [condominiumId]);
  let driveFileId: string | null = null;
  let content: Buffer | null = req.file.buffer;
  if (rootFolderId) {
    try { driveFileId = await uploadDriveFile(rootFolderId, req.file.originalname, 'application/pdf', req.file.buffer); content = null; }
    catch (error: any) { return res.status(502).json({ message: error?.message || 'Falha ao enviar o regimento para o Google Drive. Verifique a pasta configurada para este condomínio.' }); }
  }
  await query(
    `insert into regulation_documents(condominium_id,file_name,file_size,content,drive_file_id,uploaded_by) values($1,$2,$3,$4,$5,$6)
     on conflict(condominium_id) do update set file_name=excluded.file_name,file_size=excluded.file_size,content=excluded.content,
       drive_file_id=excluded.drive_file_id,uploaded_by=excluded.uploaded_by,created_at=now()`,
    [condominiumId, req.file.originalname, req.file.size, content, driveFileId, req.user?.id || null],
  );
  if (previous.rows[0]?.drive_file_id && previous.rows[0].drive_file_id !== driveFileId) await deleteDriveFile(previous.rows[0].drive_file_id);
  await logAudit(req, 'regimento', 'attachment_uploaded', `${previous.rows[0] ? 'Substituiu' : 'Enviou'} o PDF do regimento interno (${req.file.originalname})`, {});
  return res.status(201).json({ message: 'Regimento interno armazenado.' });
}));

router.delete('/document', asyncHandler(async (req, res) => {
  const existing = await query<{ drive_file_id: string | null; file_name: string }>(
    `delete from regulation_documents where condominium_id=$1 returning drive_file_id, file_name`,
    [scopedCondominiumId(req)],
  );
  if (!existing.rows[0]) return res.status(404).json({ message: 'Não há PDF do regimento interno para excluir.' });
  if (existing.rows[0].drive_file_id) await deleteDriveFile(existing.rows[0].drive_file_id);
  await logAudit(req, 'regimento', 'attachment_deleted', `Excluiu o PDF do regimento interno (${existing.rows[0].file_name})`, {});
  return res.status(204).send();
}));

// Exclusão definitiva só para artigo que nunca foi usado. Notificação de
// infração guarda a referência ao artigo (article_id, on delete restrict):
// se já houve emissão, o caminho é desativar, que preserva o histórico.
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await query<{ condominium_id: string; article_number: string }>(`select condominium_id, article_number from regulation_articles where id=$1`, [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ message: 'Artigo não encontrado.' });
  if (existing.rows[0].condominium_id !== req.user?.condominiumId) {
    return res.status(403).json({ message: 'Você não tem acesso a este condomínio.' });
  }
  const used = await query<{ count: number }>(`select count(*)::int count from infraction_notices where article_id=$1`, [req.params.id]);
  const count = Number(used.rows[0]?.count || 0);
  if (count > 0) {
    return res.status(409).json({ message: `Este artigo já foi usado em ${count} notificação(ões) de infração e não pode ser excluído. Use "Desativar" para que ele deixe de aparecer em novas emissões.` });
  }
  await query(`delete from regulation_articles where id=$1`, [req.params.id]);
  await logAudit(req, 'regimento', 'deleted', `Excluiu o artigo ${existing.rows[0].article_number} do regimento`, { entityId: req.params.id });
  return res.status(204).send();
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await query<{ condominium_id: string }>(`select condominium_id from regulation_articles where id=$1`, [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ message: 'Artigo não encontrado.' });
  if (existing.rows[0].condominium_id !== req.user?.condominiumId) {
    return res.status(403).json({ message: 'Você não tem acesso a este condomínio.' });
  }

  // Desativação isolada não passa pelas mesmas validações de um artigo completo.
  if (Object.keys(req.body ?? {}).length === 1 && typeof req.body?.active === 'boolean') {
    const result = await query<any>(
      `update regulation_articles set active=$1, updated_at=now() where id=$2 returning ${COLUMNS}`,
      [req.body.active, req.params.id],
    );
    await logAudit(req, 'regimento', req.body.active ? 'reactivated' : 'deactivated', `${req.body.active ? 'Reativou' : 'Desativou'} o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
    return res.json({ article: result.rows[0] });
  }

  const error = validateArticleBody(req.body);
  if (error) return res.status(400).json({ message: error });

  const {
    articleNumber, description, baseFinePercent, paymentDeadlineDays,
    lateInterestPercentMonth, monetaryCorrectionIndex, fixedMonthlyCorrectionPercent,
    reiterationDailyPercent, acknowledgmentToleranceDays,
  } = req.body;

  // Importante: isto só altera a configuração viva do artigo. Notificações
  // já emitidas guardam seu próprio article_snapshot e nunca são reescritas
  // por essa atualização — só notificações futuras usam os valores novos.
  const result = await query<any>(
    `update regulation_articles set
       article_number=$1, description=$2, base_fine_percent=$3, payment_deadline_days=$4,
       late_interest_percent_month=$5, monetary_correction_index=$6, fixed_monthly_correction_percent=$7,
       reiteration_daily_percent=$8, acknowledgment_tolerance_days=$9, updated_at=now()
     where id=$10
     returning ${COLUMNS}`,
    [
      String(articleNumber).trim(), String(description).trim(), Number(baseFinePercent), Number(paymentDeadlineDays),
      Number(lateInterestPercentMonth) || 0, monetaryCorrectionIndex, monetaryCorrectionIndex === 'FIXED' ? Number(fixedMonthlyCorrectionPercent) : null,
      Number(reiterationDailyPercent) || 0, acknowledgmentToleranceDays != null ? Number(acknowledgmentToleranceDays) : null,
      req.params.id,
    ],
  );
  await logAudit(req, 'regimento', 'updated', `Editou o artigo ${result.rows[0].article_number} do regimento`, { entityId: result.rows[0].id });
  return res.json({ article: result.rows[0] });
}));

router.post('/apply-template', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });

  const existing = await query<{ count: string }>(`select count(*)::int count from regulation_articles where condominium_id=$1`, [condominiumId]);
  if (Number(existing.rows[0]?.count) > 0) {
    return res.status(409).json({ message: 'Este condomínio já tem artigos cadastrados. Aplique o modelo apenas em condomínios sem nenhum artigo.' });
  }

  const inserted: any[] = [];
  for (const item of STARTER_REGULATION_TEMPLATE) {
    const result = await query<any>(
      `insert into regulation_articles(
         id, condominium_id, article_number, description, base_fine_percent, payment_deadline_days,
         late_interest_percent_month, monetary_correction_index, fixed_monthly_correction_percent,
         reiteration_daily_percent, acknowledgment_tolerance_days, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning ${COLUMNS}`,
      [
        randomUUID(), condominiumId, item.articleNumber, item.description, item.baseFinePercent, item.paymentDeadlineDays,
        item.lateInterestPercentMonth, item.monetaryCorrectionIndex, item.fixedMonthlyCorrectionPercent,
        item.reiterationDailyPercent, item.acknowledgmentToleranceDays, req.user?.id || null,
      ],
    );
    inserted.push(result.rows[0]);
  }
  await logAudit(req, 'regimento', 'template_applied', `Aplicou o modelo inicial do regimento (${inserted.length} artigos)`, {});
  return res.status(201).json({ articles: inserted });
}));

export default router;
