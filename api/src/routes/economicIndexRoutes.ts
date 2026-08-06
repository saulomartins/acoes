import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';

const router = Router();
router.use(authenticate);

router.get('/', authorize('sindico', 'subsindico', 'admin_geral'), asyncHandler(async (req, res) => {
  const { indexName, referenceMonth } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (indexName) { params.push(indexName); conditions.push(`index_name=$${params.length}`); }
  if (referenceMonth) { params.push(referenceMonth); conditions.push(`reference_month=$${params.length}`); }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
  const result = await query(
    `select id, index_name, reference_month, monthly_percent, created_at from economic_indexes ${where} order by reference_month desc, index_name`,
    params,
  );
  return res.json({ indexes: result.rows });
}));

router.post('/', authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { indexName, referenceMonth, monthlyPercent } = req.body ?? {};
  if (!['IGPM', 'INPC'].includes(indexName)) return res.status(400).json({ message: 'Informe um índice válido (IGPM ou INPC).' });
  if (!referenceMonth || !/^\d{4}-\d{2}-\d{2}$/.test(String(referenceMonth))) return res.status(400).json({ message: 'Informe o mês de referência no formato AAAA-MM-DD.' });
  if (!Number.isFinite(Number(monthlyPercent))) return res.status(400).json({ message: 'Informe o percentual mensal do índice.' });

  const result = await query(
    `insert into economic_indexes(id, index_name, reference_month, monthly_percent, created_by)
     values($1,$2,$3,$4,$5)
     on conflict(index_name, reference_month) do update set monthly_percent=excluded.monthly_percent
     returning id, index_name, reference_month, monthly_percent, created_at`,
    [randomUUID(), indexName, referenceMonth, Number(monthlyPercent), req.user?.id || null],
  );
  return res.status(201).json({ index: result.rows[0] });
}));

export default router;
