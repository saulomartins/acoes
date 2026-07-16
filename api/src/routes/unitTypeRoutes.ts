import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';

const router = Router();
router.use(authenticate);

router.get('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });

  const result = await query(
    `select id, condominium_id, name, fee_cents, description, active, created_at, updated_at
     from unit_types where condominium_id = $1 order by name`,
    [condominiumId],
  );
  return res.json({ unitTypes: result.rows });
}));

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const { name, feeCents, description } = req.body ?? {};
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });
  if (!name || !Number.isInteger(Number(feeCents)) || Number(feeCents) <= 0) {
    return res.status(400).json({ message: 'name and a positive feeCents are required' });
  }

  const result = await query(
    `insert into unit_types (id, condominium_id, name, fee_cents, description)
     values ($1, $2, $3, $4, $5)
     on conflict (condominium_id, name) do update
       set fee_cents = excluded.fee_cents,
           description = excluded.description,
           active = true,
           updated_at = now()
     returning id, condominium_id, name, fee_cents, description, active, created_at, updated_at`,
    [randomUUID(), condominiumId, String(name).trim().toUpperCase(), Number(feeCents), description ? String(description).trim() : null],
  );
  return res.status(200).json({ unitType: result.rows[0] });
}));

export default router;
