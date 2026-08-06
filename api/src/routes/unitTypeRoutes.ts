import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(authenticate);
router.use(requireFeature('tipologias'));

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

  const result = await query<any>(
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
  await logAudit(req, 'tipologias', 'created', `Cadastrou/atualizou a tipologia ${result.rows[0].name}`, { entityId: result.rows[0].id });
  return res.status(200).json({ unitType: result.rows[0] });
}));

router.patch('/:id', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const { name, feeCents, description } = req.body ?? {};
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });
  if (!name || !Number.isInteger(Number(feeCents)) || Number(feeCents) <= 0) {
    return res.status(400).json({ message: 'name and a positive feeCents are required' });
  }

  try {
    const result = await query<any>(
      `update unit_types
       set name = $1, fee_cents = $2, description = $3, updated_at = now()
       where id = $4 and condominium_id = $5
       returning id, condominium_id, name, fee_cents, description, active, created_at, updated_at`,
      [String(name).trim().toUpperCase(), Number(feeCents), description ? String(description).trim() : null, req.params.id, condominiumId],
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Tipologia não encontrada.' });
    await logAudit(req, 'tipologias', 'updated', `Editou a tipologia ${result.rows[0].name}`, { entityId: result.rows[0].id });
    return res.json({ unitType: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ message: 'Já existe uma tipologia com esse nome.' });
    throw error;
  }
}));

router.delete('/:id', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });

  const usage = await query<{ count: string }>(
    `select
       (select count(*) from units where unit_type_id = $1) +
       (select count(*) from users where unit_type_id = $1) as count`,
    [req.params.id],
  );
  if (Number(usage.rows[0]?.count) > 0) {
    return res.status(409).json({ message: 'Esta tipologia está em uso por unidades ou moradores e não pode ser excluída.' });
  }

  const result = await query<any>(
    `delete from unit_types where id = $1 and condominium_id = $2 returning id, name`,
    [req.params.id, condominiumId],
  );
  if (!result.rows[0]) return res.status(404).json({ message: 'Tipologia não encontrada.' });
  await logAudit(req, 'tipologias', 'deleted', `Excluiu a tipologia ${result.rows[0].name}`, { entityId: result.rows[0].id });
  return res.json({ message: 'Tipologia excluída.' });
}));

export default router;
