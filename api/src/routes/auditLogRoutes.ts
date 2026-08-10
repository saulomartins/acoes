import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { brazilMidnightUtc } from '../services/timezone';

const router = Router();
router.use(authenticate, authorize('admin_geral'));

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = String(req.query.condominiumId || '');
  if (!condominiumId) return res.status(400).json({ message: 'Selecione um condomínio.' });
  const feature = req.query.feature ? String(req.query.feature) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  // Sem filtro de data explícito, mostra só os últimos 3 dias (hoje + os 3
  // anteriores, no fuso do condomínio) — evita carregar o histórico inteiro
  // toda vez que a tela abre.
  const from = req.query.from ? new Date(String(req.query.from)) : brazilMidnightUtc(3);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return res.status(400).json({ message: 'Período inválido.' });
  const result = await query(
    `select * from audit_log where condominium_id=$1 and ($2::text is null or feature=$2) and created_at>=$3 and created_at<=$4
     order by created_at desc limit $5 offset $6`,
    [condominiumId, feature, from, to, limit, offset],
  );
  const total = await query<{ count: string }>(
    `select count(*)::int as count from audit_log where condominium_id=$1 and ($2::text is null or feature=$2) and created_at>=$3 and created_at<=$4`,
    [condominiumId, feature, from, to],
  );
  return res.json({ entries: result.rows, total: Number(total.rows[0]?.count || 0) });
}));

export default router;
