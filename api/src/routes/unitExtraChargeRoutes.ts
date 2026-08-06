import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(authenticate, authorize('sindico', 'subsindico'), requireFeature('cobrancas_adicionais'));

const addMonths = (date: string, months: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10); };
const isValidReferenceMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);
const currentMonthDate = () => { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`; };

const insertChargeWithInstallments = async (client: any, params: { condominiumId: string; unitId: string; description: string; totalAmountCents: number; installmentCount: number; firstReferenceMonth: string; createdBy?: string }) => {
  const chargeId = randomUUID();
  const chargeResult = await client.query(
    `insert into unit_extra_charges(id, condominium_id, unit_id, description, total_amount_cents, installment_count, first_reference_month, created_by)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [chargeId, params.condominiumId, params.unitId, params.description, params.totalAmountCents, params.installmentCount, params.firstReferenceMonth, params.createdBy],
  );
  for (let index = 0; index < params.installmentCount; index++) {
    const base = Math.floor(params.totalAmountCents / params.installmentCount);
    const amount = base + (index === params.installmentCount - 1 ? params.totalAmountCents - base * params.installmentCount : 0);
    await client.query(
      `insert into unit_extra_charge_installments(id, charge_id, installment_number, amount_cents, reference_month)
       values($1,$2,$3,$4,$5)`,
      [randomUUID(), chargeId, index + 1, amount, addMonths(params.firstReferenceMonth, index)],
    );
  }
  return chargeResult.rows[0];
};

// Agrupamento é sempre pela descrição (texto exato) da cobrança — não há
// noção de "lote de criação". Duas cobranças com a mesma descrição, criadas
// em momentos diferentes e para unidades diferentes, aparecem juntas.
router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const unitId = req.query?.unitId ? String(req.query.unitId) : null;
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });

  const charges = await query<any>(
    `select ec.*, coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), un.number) unit_label
     from unit_extra_charges ec join units un on un.id = ec.unit_id left join blocks b on b.id = un.block_id
     where ec.condominium_id = $1 and ($2::uuid is null or ec.unit_id = $2)
     order by ec.description, ec.created_at desc`,
    [condominiumId, unitId],
  );
  const chargeIds = charges.rows.map((row: any) => row.id);
  const installments = chargeIds.length
    ? await query<any>(
        `select * from unit_extra_charge_installments where charge_id = any($1::uuid[]) order by installment_number`,
        [chargeIds],
      )
    : { rows: [] as any[] };

  const chargesWithInstallments = charges.rows.map((charge: any) => {
    const chargeInstallments = installments.rows.filter((item: any) => item.charge_id === charge.id);
    const status = chargeInstallments.every((item: any) => item.status !== 'pending') && chargeInstallments.length
      ? (chargeInstallments.some((item: any) => item.status === 'applied') ? 'finished' : 'canceled')
      : 'active';
    return { ...charge, status, installments: chargeInstallments };
  });

  const groups = new Map<string, any>();
  for (const charge of chargesWithInstallments) {
    const group = groups.get(charge.description) || { description: charge.description, lastActivityAt: charge.created_at, charges: [] };
    group.charges.push(charge);
    if (charge.created_at > group.lastActivityAt) group.lastActivityAt = charge.created_at;
    groups.set(charge.description, group);
  }
  const result = [...groups.values()].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  return res.json({ groups: result });
}));

router.post('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const rawUnitIds: unknown[] = Array.isArray(req.body?.unitIds) ? req.body.unitIds : req.body?.unitId ? [req.body.unitId] : [];
  const unitIds: string[] = [...new Set(rawUnitIds.map((value) => String(value)))];
  const description = String(req.body?.description || '').trim();
  const totalAmountCents = Number(req.body?.totalAmountCents);
  const installmentCount = Number(req.body?.installmentCount);
  const firstReferenceMonth = String(req.body?.firstReferenceMonth || '');
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });
  if (!unitIds.length || !description) return res.status(400).json({ message: 'Informe ao menos uma unidade e a descrição da cobrança.' });
  if (!Number.isInteger(totalAmountCents) || totalAmountCents <= 0) return res.status(400).json({ message: 'Informe um valor total válido.' });
  if (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 60) return res.status(400).json({ message: 'O número de parcelas deve ser entre 1 e 60.' });
  if (!isValidReferenceMonth(firstReferenceMonth)) return res.status(400).json({ message: 'Informe o mês de início no formato AAAA-MM.' });

  const units = await query<any>(`select id from units where id = any($1::uuid[]) and condominium_id = $2`, [unitIds, condominiumId]);
  if (units.rows.length !== unitIds.length) return res.status(404).json({ message: 'Uma ou mais unidades selecionadas não foram encontradas.' });

  const charges = await withTransaction(async (client) => {
    const created: any[] = [];
    for (const unitId of unitIds) {
      created.push(await insertChargeWithInstallments(client, { condominiumId: condominiumId!, unitId, description, totalAmountCents, installmentCount, firstReferenceMonth: `${firstReferenceMonth}-01`, createdBy: req.user?.id }));
    }
    return created;
  });
  await logAudit(req, 'cobrancas_adicionais', 'created', `Criou a cobrança "${description}" para ${charges.length} unidade(s)`, { entityId: charges[0]?.id });
  return res.status(201).json({ charges, message: `Cobrança adicional cadastrada para ${charges.length} unidade(s).` });
}));

// Adiciona unidades a um grupo (descrição) já existente, copiando valor,
// parcelas e mês inicial da cobrança mais recente com a mesma descrição.
// Se o mês inicial original já passou, começa no mês atual em vez de
// tentar criar parcela retroativa.
router.post('/add-units', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const description = String(req.body?.description || '').trim();
  const rawUnitIds: unknown[] = Array.isArray(req.body?.unitIds) ? req.body.unitIds : [];
  const unitIds: string[] = [...new Set(rawUnitIds.map((value) => String(value)))];
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });
  if (!description || !unitIds.length) return res.status(400).json({ message: 'Informe a descrição e ao menos uma unidade.' });

  const template = await query<any>(
    `select total_amount_cents, installment_count, to_char(first_reference_month, 'YYYY-MM-DD') as first_reference_month
     from unit_extra_charges where condominium_id = $1 and description = $2 order by created_at desc limit 1`,
    [condominiumId, description],
  );
  if (!template.rows[0]) return res.status(404).json({ message: 'Nenhuma cobrança com essa descrição foi encontrada.' });

  const existing = await query<any>(`select unit_id from unit_extra_charges where condominium_id = $1 and description = $2`, [condominiumId, description]);
  const existingUnitIds = new Set(existing.rows.map((row: any) => row.unit_id));
  const newUnitIds = unitIds.filter((id) => !existingUnitIds.has(id));
  if (!newUnitIds.length) return res.status(409).json({ message: 'As unidades selecionadas já fazem parte desta cobrança.' });

  const units = await query<any>(`select id from units where id = any($1::uuid[]) and condominium_id = $2`, [newUnitIds, condominiumId]);
  if (units.rows.length !== newUnitIds.length) return res.status(404).json({ message: 'Uma ou mais unidades selecionadas não foram encontradas.' });

  const firstReferenceMonth = template.rows[0].first_reference_month > currentMonthDate()
    ? template.rows[0].first_reference_month
    : currentMonthDate();

  const charges = await withTransaction(async (client) => {
    const created: any[] = [];
    for (const unitId of newUnitIds) {
      created.push(await insertChargeWithInstallments(client, {
        condominiumId: condominiumId!,
        unitId,
        description,
        totalAmountCents: template.rows[0].total_amount_cents,
        installmentCount: template.rows[0].installment_count,
        firstReferenceMonth,
        createdBy: req.user?.id,
      }));
    }
    return created;
  });
  await logAudit(req, 'cobrancas_adicionais', 'updated', `Adicionou ${charges.length} unidade(s) à cobrança "${description}"`, { entityId: charges[0]?.id });
  return res.status(201).json({ charges, message: `${charges.length} unidade(s) adicionada(s) à cobrança.` });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const charge = await query<any>(`select id, description from unit_extra_charges where id = $1 and condominium_id = $2`, [req.params.id, condominiumId]);
  if (!charge.rows[0]) return res.status(404).json({ message: 'Cobrança não encontrada.' });

  const applied = await query<any>(`select count(*)::int as count from unit_extra_charge_installments where charge_id = $1 and status = 'applied'`, [req.params.id]);
  if (Number(applied.rows[0]?.count) > 0) {
    await query(
      `update unit_extra_charge_installments set status = 'canceled', canceled_at = now(), canceled_by = $1 where charge_id = $2 and status = 'pending'`,
      [req.user?.id, req.params.id],
    );
    await logAudit(req, 'cobrancas_adicionais', 'updated', `Cancelou parcelas pendentes da cobrança "${charge.rows[0].description}"`, { entityId: req.params.id });
    return res.json({ message: 'Esta unidade já tinha parcela cobrada em boleto: as parcelas pendentes foram canceladas e o histórico foi mantido.' });
  }

  await query(`delete from unit_extra_charges where id = $1`, [req.params.id]);
  await logAudit(req, 'cobrancas_adicionais', 'deleted', `Removeu uma unidade da cobrança "${charge.rows[0].description}"`, { entityId: req.params.id });
  return res.json({ message: 'Unidade removida da cobrança.' });
}));

router.post('/:id/cancel-remaining', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const charge = await query<any>(`select id, description from unit_extra_charges where id = $1 and condominium_id = $2`, [req.params.id, condominiumId]);
  if (!charge.rows[0]) return res.status(404).json({ message: 'Cobrança não encontrada.' });

  const result = await query(
    `update unit_extra_charge_installments set status = 'canceled', canceled_at = now(), canceled_by = $1
     where charge_id = $2 and status = 'pending' returning id`,
    [req.user?.id, req.params.id],
  );
  if (result.rowCount) await logAudit(req, 'cobrancas_adicionais', 'updated', `Cancelou ${result.rowCount} parcela(s) pendente(s) da cobrança "${charge.rows[0].description}"`, { entityId: req.params.id });
  return res.json({ message: `${result.rowCount} parcela(s) pendente(s) cancelada(s).` });
}));

export default router;
