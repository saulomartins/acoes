import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(authenticate, authorize('sindico', 'subsindico'), requireFeature('consumo_individualizado'));

export const UTILITY_TYPES = ['agua', 'gas', 'energia'] as const;
export type UtilityType = typeof UTILITY_TYPES[number];
const isUtilityType = (value: unknown): value is UtilityType => UTILITY_TYPES.includes(value as UtilityType);
// Só para exibição — não é campo configurável.
export const UTILITY_UNIT_LABEL: Record<UtilityType, string> = { agua: 'm³', gas: 'kg', energia: 'kWh' };
const isValidReferenceMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);

router.get('/rates', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const result = await query<{ utility_type: UtilityType; unit_price_cents: number; updated_at: string }>(
    `select utility_type, unit_price_cents, updated_at from condominium_utility_rates where condominium_id = $1`,
    [condominiumId],
  );
  const byType = new Map(result.rows.map(row => [row.utility_type, row]));
  const rates = UTILITY_TYPES.map(utilityType => ({
    utilityType, unitLabel: UTILITY_UNIT_LABEL[utilityType],
    unitPriceCents: byType.get(utilityType)?.unit_price_cents ?? null,
    updatedAt: byType.get(utilityType)?.updated_at ?? null,
  }));
  return res.json({ rates });
}));

router.put('/rates', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const items: unknown[] = Array.isArray(req.body?.rates) ? req.body.rates : [];
  const parsed = items.map((item: any) => ({ utilityType: item?.utilityType, unitPriceCents: Number(item?.unitPriceCents) }));
  const invalid = parsed.find(item => !isUtilityType(item.utilityType) || !Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0);
  if (!parsed.length || invalid) return res.status(400).json({ message: 'Informe uma tarifa válida (em centavos) para cada tipo de consumo.' });
  await withTransaction(async client => {
    for (const item of parsed) {
      await client.query(
        `insert into condominium_utility_rates(condominium_id, utility_type, unit_price_cents, updated_by, updated_at)
         values($1,$2,$3,$4,now())
         on conflict(condominium_id, utility_type) do update set unit_price_cents=excluded.unit_price_cents, updated_by=excluded.updated_by, updated_at=now()`,
        [condominiumId, item.utilityType, item.unitPriceCents, req.user?.id],
      );
    }
  });
  await logAudit(req, 'consumo_individualizado', 'updated', 'Atualizou as tarifas de água/gás/energia');
  return res.json({ message: 'Tarifas atualizadas.' });
}));

// Um card por mês de referência já lançado, com o total por tipo de consumo
// e quantos itens já foram cobrados em boleto (applied) vs. ainda pendentes.
// O detalhe unidade-a-unidade de um mês reaproveita GET /charges — este
// endpoint só serve pra listar quais meses existem e um resumo de cada um.
router.get('/history', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const rows = await query<{ reference_month: string; utility_type: UtilityType; quantity: string; amount_cents: string; applied_count: string; pending_count: string }>(
    `select to_char(reference_month,'YYYY-MM') as reference_month, utility_type,
       sum(quantity) as quantity, sum(amount_cents) as amount_cents,
       count(*) filter (where status='applied') as applied_count,
       count(*) filter (where status='pending') as pending_count
     from unit_consumption_charges
     where condominium_id=$1 and status <> 'canceled'
     group by reference_month, utility_type
     order by reference_month desc`,
    [condominiumId],
  );
  const byMonth = new Map<string, { referenceMonth: string; totalAmountCents: number; appliedCount: number; pendingCount: number; utilities: Array<{ utilityType: UtilityType; quantity: number; amountCents: number }> }>();
  for (const row of rows.rows) {
    const month = byMonth.get(row.reference_month) || { referenceMonth: row.reference_month, totalAmountCents: 0, appliedCount: 0, pendingCount: 0, utilities: [] };
    month.totalAmountCents += Number(row.amount_cents);
    month.appliedCount += Number(row.applied_count);
    month.pendingCount += Number(row.pending_count);
    month.utilities.push({ utilityType: row.utility_type, quantity: Number(row.quantity), amountCents: Number(row.amount_cents) });
    byMonth.set(row.reference_month, month);
  }
  return res.json({ months: [...byMonth.values()] });
}));

router.get('/charges', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const referenceMonth = String(req.query?.referenceMonth || '');
  if (!isValidReferenceMonth(referenceMonth)) return res.status(400).json({ message: 'Informe o mês de referência no formato AAAA-MM.' });
  const referenceMonthDate = `${referenceMonth}-01`;
  const [rates, units, charges] = await Promise.all([
    query<{ utility_type: UtilityType; unit_price_cents: number }>(`select utility_type, unit_price_cents from condominium_utility_rates where condominium_id=$1`, [condominiumId]),
    query<{ id: string; unit_label: string }>(
      `select un.id, coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), un.number) as unit_label
       from units un left join blocks b on b.id = un.block_id
       where un.condominium_id = $1 and un.active = true order by unit_label`,
      [condominiumId],
    ),
    query<any>(`select * from unit_consumption_charges where condominium_id=$1 and reference_month=$2`, [condominiumId, referenceMonthDate]),
  ]);
  const rateByType = Object.fromEntries(rates.rows.map(row => [row.utility_type, row.unit_price_cents])) as Record<string, number>;
  const chargesByUnit = new Map<string, any[]>();
  for (const charge of charges.rows) {
    const list = chargesByUnit.get(charge.unit_id) || [];
    list.push(charge);
    chargesByUnit.set(charge.unit_id, list);
  }
  const items = units.rows.map(unit => ({
    unitId: unit.id, unitLabel: unit.unit_label,
    charges: Object.fromEntries(UTILITY_TYPES.map(utilityType => {
      const charge = (chargesByUnit.get(unit.id) || []).find(item => item.utility_type === utilityType);
      return [utilityType, charge ? { id: charge.id, quantity: Number(charge.quantity), amountCents: charge.amount_cents, status: charge.status } : null];
    })),
  }));
  return res.json({ referenceMonth, rates: UTILITY_TYPES.map(utilityType => ({ utilityType, unitLabel: UTILITY_UNIT_LABEL[utilityType], unitPriceCents: rateByType[utilityType] ?? null })), units: items });
}));

router.post('/charges', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const referenceMonth = String(req.body?.referenceMonth || '');
  if (!isValidReferenceMonth(referenceMonth)) return res.status(400).json({ message: 'Informe o mês de referência no formato AAAA-MM.' });
  const referenceMonthDate = `${referenceMonth}-01`;
  const rawItems: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = rawItems.map((item: any) => ({ unitId: String(item?.unitId || ''), utilityType: item?.utilityType, quantity: Number(item?.quantity) }));
  const invalid = items.find(item => !item.unitId || !isUtilityType(item.utilityType) || !Number.isFinite(item.quantity) || item.quantity < 0);
  if (!items.length || invalid) return res.status(400).json({ message: 'Informe unidade, tipo e uma quantidade válida (maior ou igual a zero) para cada lançamento.' });

  const unitIds = [...new Set(items.map(item => item.unitId))];
  const units = await query<{ id: string }>(`select id from units where id = any($1::uuid[]) and condominium_id = $2`, [unitIds, condominiumId]);
  if (units.rows.length !== unitIds.length) return res.status(404).json({ message: 'Uma ou mais unidades não foram encontradas.' });

  const rates = await query<{ utility_type: UtilityType; unit_price_cents: number }>(`select utility_type, unit_price_cents from condominium_utility_rates where condominium_id=$1`, [condominiumId]);
  const rateByType = Object.fromEntries(rates.rows.map(row => [row.utility_type, row.unit_price_cents])) as Record<string, number | undefined>;
  const missingRate = items.find(item => !Number.isInteger(rateByType[item.utilityType]));
  if (missingRate) return res.status(400).json({ message: `Configure a tarifa de ${missingRate.utilityType} antes de lançar consumo.` });

  const locked = await query<{ unit_id: string; utility_type: string }>(
    `select unit_id, utility_type from unit_consumption_charges
     where condominium_id=$1 and reference_month=$2 and status='applied' and (unit_id,utility_type) in (${items.map((_, index) => `($${index * 2 + 3},$${index * 2 + 4})`).join(',')})`,
    [condominiumId, referenceMonthDate, ...items.flatMap(item => [item.unitId, item.utilityType])],
  );
  if (locked.rows[0]) return res.status(409).json({ message: 'Um ou mais lançamentos já foram emitidos em boleto e não podem ser alterados. Exclua o boleto correspondente antes, se precisar corrigir.' });

  await withTransaction(async client => {
    for (const item of items) {
      const unitPriceCents = rateByType[item.utilityType]!;
      const amountCents = Math.round(item.quantity * unitPriceCents);
      await client.query(
        `insert into unit_consumption_charges(id, condominium_id, unit_id, utility_type, reference_month, quantity, unit_price_cents, amount_cents, status, created_by)
         values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
         on conflict(unit_id, utility_type, reference_month) do update set quantity=excluded.quantity, unit_price_cents=excluded.unit_price_cents, amount_cents=excluded.amount_cents, created_by=excluded.created_by
         where unit_consumption_charges.status = 'pending'`,
        [randomUUID(), condominiumId, item.unitId, item.utilityType, referenceMonthDate, item.quantity, unitPriceCents, amountCents, req.user?.id],
      );
    }
  });
  await logAudit(req, 'consumo_individualizado', 'updated', `Lançou consumo de ${items.length} item(ns) para a referência ${referenceMonth}`);
  return res.status(201).json({ message: `${items.length} lançamento(s) de consumo salvo(s).` });
}));

router.delete('/charges/:id', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const charge = await query<any>(`select id, status from unit_consumption_charges where id=$1 and condominium_id=$2`, [req.params.id, condominiumId]);
  if (!charge.rows[0]) return res.status(404).json({ message: 'Lançamento não encontrado.' });
  if (charge.rows[0].status !== 'pending') return res.status(409).json({ message: 'Este lançamento já foi emitido em boleto e não pode ser removido.' });
  await query(`delete from unit_consumption_charges where id=$1`, [req.params.id]);
  await logAudit(req, 'consumo_individualizado', 'deleted', 'Removeu um lançamento de consumo', { entityId: req.params.id });
  return res.json({ message: 'Lançamento removido.' });
}));

// Reabre um lançamento já cobrado (status 'applied') pra edição — só quando
// o boleto que o carregava já foi cancelado no banco. Sem essa checagem,
// editar e reemitir cobraria a mesma unidade duas vezes (o boleto antigo
// continuaria ativo). O síndico precisa cancelar no Banco Inter e rodar
// "Atualizar todos os boletos" antes de conseguir destravar aqui.
router.post('/charges/:id/unlock', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const charge = await query<{ id: string; status: string; invoice_id: string | null }>(
    `select id, status, invoice_id from unit_consumption_charges where id=$1 and condominium_id=$2`,
    [req.params.id, condominiumId],
  );
  if (!charge.rows[0]) return res.status(404).json({ message: 'Lançamento não encontrado.' });
  if (charge.rows[0].status === 'pending') return res.json({ message: 'Este lançamento já está disponível para edição.' });
  if (charge.rows[0].status !== 'applied' || !charge.rows[0].invoice_id) return res.status(409).json({ message: 'Este lançamento não pode ser destravado.' });
  const invoice = await query<{ status: string }>(`select status from invoices where id=$1`, [charge.rows[0].invoice_id]);
  if (invoice.rows[0]?.status !== 'canceled') {
    return res.status(409).json({ message: 'O boleto que carrega este lançamento ainda está ativo no banco. Cancele-o no Banco Inter, rode "Atualizar todos os boletos" em Gestão de cobranças e tente de novo — senão a unidade seria cobrada duas vezes.' });
  }
  await query(`update unit_consumption_charges set status='pending', invoice_id=null, applied_at=null where id=$1`, [req.params.id]);
  await logAudit(req, 'consumo_individualizado', 'updated', 'Destravou um lançamento de consumo para edição (boleto anterior cancelado)', { entityId: req.params.id });
  return res.json({ message: 'Lançamento liberado para edição. Ajuste a quantidade e salve; ele entrará no próximo boleto emitido para esta unidade.' });
}));

export default router;
