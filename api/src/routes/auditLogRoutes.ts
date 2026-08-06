import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';

const router = Router();
router.use(authenticate, authorize('admin_geral'));

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = String(req.query.condominiumId || '');
  if (!condominiumId) return res.status(400).json({ message: 'Selecione um condomínio.' });
  const feature = req.query.feature ? String(req.query.feature) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const result = await query(
    `select * from audit_log where condominium_id=$1 and ($2::text is null or feature=$2)
     order by created_at desc limit $3 offset $4`,
    [condominiumId, feature, limit, offset],
  );
  const total = await query<{ count: string }>(
    `select count(*)::int as count from audit_log where condominium_id=$1 and ($2::text is null or feature=$2)`,
    [condominiumId, feature],
  );
  return res.json({ entries: result.rows, total: Number(total.rows[0]?.count || 0) });
}));

export default router;
