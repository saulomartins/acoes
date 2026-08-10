import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { logAudit } from '../services/auditService';
import { notifyUsers } from '../services/notificationService';
import { checkClearance } from '../services/clearanceService';
import { buildClearancePdf, generateVerificationCode, hashDocument } from '../services/clearanceDocument';
import { config } from '../config';

const router = Router();

// Verificação pública: fica ANTES do authenticate de propósito — é o que
// permite a um banco/imobiliária conferir o documento sem ter conta aqui.
router.get('/verify/:code', asyncHandler(async (req, res) => {
  const result = await query<any>(
    `select c.verification_code, c.status, c.issued_at, c.requester_name, c.unit_label,
            c.issuer_name, c.issuer_role, c.condominium_name, c.document_hash
     from clearance_certificates c
     where c.verification_code = $1 and c.status = 'issued'`,
    [String(req.params.code || '').toUpperCase()],
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ valid: false, message: 'Código não encontrado. Confira se digitou exatamente como está no documento.' });
  return res.json({
    valid: true,
    verificationCode: row.verification_code,
    issuedAt: row.issued_at,
    condominiumName: row.condominium_name,
    unitLabel: row.unit_label,
    requesterName: row.requester_name,
    issuerName: row.issuer_name,
    issuerRole: row.issuer_role,
    documentHash: row.document_hash,
  });
}));

router.use(authenticate, requireFeature('nada_consta'));

const manager = (role?: string) => role === 'sindico' || role === 'subsindico';

// Morador vê os próprios pedidos; síndico/subsíndico veem os do condomínio.
router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const isManager = manager(req.user?.role);
  const result = await query<any>(
    `select c.*, coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), un.number) as current_unit_label
     from clearance_certificates c
     left join units un on un.id = c.unit_id
     left join blocks b on b.id = un.block_id
     where c.condominium_id = $1 and ($2 or c.requested_by = $3)
     order by c.created_at desc`,
    [condominiumId, isManager, req.user?.id],
  );
  return res.json({ requests: result.rows });
}));

// Prévia da checagem, sem criar pedido — deixa o morador ver o que está
// pendente antes de solicitar, e o síndico conferir antes de emitir.
router.get('/check', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const targetUserId = manager(req.user?.role) && req.query?.userId ? String(req.query.userId) : req.user!.id;
  return res.json({ check: await checkClearance(condominiumId, targetUserId) });
}));

// Morador solicita. A checagem roda na hora: com bloqueio, o pedido já
// nasce recusado com o detalhe — não fica esperando o síndico responder.
router.post('/', authorize('proprietario', 'inquilino'), asyncHandler(async (req, res) => {
  const condominiumId = req.user!.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });

  const person = await query<any>(
    `select u.id, coalesce(u.full_name, u.username) as name, u.cpf, u.unit_id,
            coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), un.number) as unit_label
     from users u left join units un on un.id = u.unit_id left join blocks b on b.id = un.block_id
     where u.id = $1`,
    [req.user!.id],
  );
  const me = person.rows[0];
  const condominium = await query<any>(`select name, address, cnpj from condominiums where id = $1`, [condominiumId]);
  const condo = condominium.rows[0];
  if (!condo) return res.status(404).json({ message: 'Condomínio não encontrado.' });

  const check = await checkClearance(condominiumId, req.user!.id);
  const status = check.eligible ? 'pending' : 'refused';
  const refusalReason = check.eligible ? null : check.blockers.map(item => `${item.label}${item.referenceMonth ? ` (${item.referenceMonth})` : ''}`).join('; ');

  const created = await query<any>(
    `insert into clearance_certificates
       (condominium_id, unit_id, requested_by, status, requester_name, requester_cpf, unit_label,
        condominium_name, condominium_address, condominium_cnpj, debt_snapshot, refusal_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [condominiumId, me?.unit_id || null, req.user!.id, status, me?.name || req.user!.username, me?.cpf || null,
     me?.unit_label || null, condo.name, condo.address, condo.cnpj, JSON.stringify(check), refusalReason],
  );

  if (check.eligible) {
    const managers = await query<{ id: string }>(
      `select id from users where condominium_id = $1 and role in ('sindico','subsindico') and login_enabled = true and deleted_at is null`,
      [condominiumId],
    );
    await notifyUsers({
      condominiumId, senderId: req.user!.id, recipientIds: managers.rows.map(row => row.id),
      title: 'Nada consta solicitado',
      body: `${me?.name || req.user!.username}${me?.unit_label ? ` (${me.unit_label})` : ''} solicitou a declaração de quitação.`,
      screen: 'Clearances',
    });
  }
  return res.status(201).json({ request: created.rows[0], check });
}));

// Síndico/subsíndico emite. A checagem roda de novo aqui: entre o pedido e
// a emissão pode ter vencido um boleto, e o documento não pode declarar
// quitação de quem passou a dever no meio do caminho.
router.post('/:id/issue', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user!.condominiumId;
  const found = await query<any>(
    `select * from clearance_certificates where id = $1 and condominium_id = $2`,
    [req.params.id, condominiumId],
  );
  const request = found.rows[0];
  if (!request) return res.status(404).json({ message: 'Solicitação não encontrada.' });
  if (request.status === 'issued') return res.status(409).json({ message: 'Esta declaração já foi emitida.' });

  const check = await checkClearance(condominiumId!, request.requested_by);
  if (!check.eligible) {
    const reason = check.blockers.map(item => `${item.label}${item.referenceMonth ? ` (${item.referenceMonth})` : ''}`).join('; ');
    await query(`update clearance_certificates set status = 'refused', refusal_reason = $1, debt_snapshot = $2 where id = $3`,
      [reason, JSON.stringify(check), request.id]);
    return res.status(409).json({ message: `Não é possível emitir: ${reason}`, check });
  }

  const issuer = await query<any>(
    `select coalesce(full_name, username) as name, cpf from users where id = $1`, [req.user!.id],
  );
  const verificationCode = generateVerificationCode();
  const issuedAt = new Date();
  const documentHash = hashDocument({
    condominiumName: request.condominium_name, condominiumAddress: request.condominium_address,
    condominiumCnpj: request.condominium_cnpj, issuerName: issuer.rows[0]?.name || req.user!.username,
    issuerCpf: issuer.rows[0]?.cpf || null, issuerRole: req.user!.role,
    requesterName: request.requester_name, requesterCpf: request.requester_cpf,
    unitLabel: request.unit_label, issuedAt, verificationCode,
  });

  const updated = await query<any>(
    `update clearance_certificates
     set status = 'issued', issued_by = $1, issuer_name = $2, issuer_cpf = $3, issuer_role = $4,
         issued_at = $5, verification_code = $6, document_hash = $7, debt_snapshot = $8, refusal_reason = null
     where id = $9 returning *`,
    [req.user!.id, issuer.rows[0]?.name || req.user!.username, issuer.rows[0]?.cpf || null, req.user!.role,
     issuedAt, verificationCode, documentHash, JSON.stringify(check), request.id],
  );

  await notifyUsers({
    condominiumId: condominiumId!, senderId: req.user!.id, recipientIds: [request.requested_by],
    title: 'Declaração de quitação emitida',
    body: 'Seu nada consta está disponível para download no aplicativo.',
    screen: 'Clearances',
  });
  await logAudit(req, 'pessoas', 'clearance_issued', `Emitiu declaração de quitação para ${request.requester_name}`, { entityId: request.id });
  return res.json({ request: updated.rows[0] });
}));

// PDF do documento emitido. Morador baixa o seu; síndico baixa o de todos.
router.get('/:id/document', asyncHandler(async (req, res) => {
  const isManager = manager(req.user?.role);
  const found = await query<any>(
    `select * from clearance_certificates where id = $1 and condominium_id = $2 and ($3 or requested_by = $4)`,
    [req.params.id, req.user?.condominiumId, isManager, req.user?.id],
  );
  const request = found.rows[0];
  if (!request) return res.status(404).json({ message: 'Declaração não encontrada.' });
  if (request.status !== 'issued') return res.status(409).json({ message: 'Esta declaração ainda não foi emitida.' });

  const verifyUrl = `${config.webUrl.replace(/\/$/, '')}/verificar/${request.verification_code}`;
  const pdf = await buildClearancePdf({
    condominiumName: request.condominium_name, condominiumAddress: request.condominium_address,
    condominiumCnpj: request.condominium_cnpj, issuerName: request.issuer_name, issuerCpf: request.issuer_cpf,
    issuerRole: request.issuer_role, requesterName: request.requester_name, requesterCpf: request.requester_cpf,
    unitLabel: request.unit_label, issuedAt: new Date(request.issued_at), verificationCode: request.verification_code,
  }, verifyUrl);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="nada-consta-${request.verification_code}.pdf"`);
  return res.send(pdf);
}));

export default router;
