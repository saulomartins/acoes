import { randomUUID } from 'crypto';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(authenticate, authorize('sindico', 'subsindico'), requireFeature('cobrancas_adicionais'));

const addMonths = (date: string, months: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10); };

// A parcela entra somada ao boleto do mês, então "pagou a cobrança adicional"
// = pagou o boleto que a carregava. Por isso a situação sai do invoice
// vinculado (invoice_id), sem controle de pagamento paralelo.
const paymentStateOf = (item: any) => {
  if (item.status === 'canceled') return 'canceled';
  if (item.status !== 'applied' || !item.invoice_id) return 'awaiting_issue';
  if (item.invoice_paid_at) return 'paid';
  if (item.invoice_status === 'overdue') return 'overdue';
  if (item.invoice_status === 'canceled') return 'invoice_canceled';
  return 'open';
};
const paymentStateLabel: Record<string, string> = {
  paid: 'Paga', open: 'Em aberto', overdue: 'Vencida',
  awaiting_issue: 'Aguardando emissão', invoice_canceled: 'Boleto cancelado', canceled: 'Cancelada',
};
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
  // A parcela guarda o boleto em que entrou (invoice_id). Como a cobrança
  // adicional é somada ao boleto do mês, "quem pagou a cobrança adicional"
  // é exatamente quem pagou esse boleto — por isso a situação de pagamento
  // vem do próprio invoice, não de um controle separado.
  const installments = chargeIds.length
    ? await query<any>(
        `select ins.*, inv.status as invoice_status, inv.paid_at as invoice_paid_at,
                to_char(inv.due_date, 'YYYY-MM-DD') as invoice_due_date
         from unit_extra_charge_installments ins
         left join invoices inv on inv.id = ins.invoice_id and inv.deleted_at is null
         where ins.charge_id = any($1::uuid[])
         order by ins.installment_number`,
        [chargeIds],
      )
    : { rows: [] as any[] };

  const chargesWithInstallments = charges.rows.map((charge: any) => {
    const chargeInstallments = installments.rows
      .filter((item: any) => item.charge_id === charge.id)
      .map((item: any) => ({ ...item, paymentState: paymentStateOf(item) }));
    const status = chargeInstallments.every((item: any) => item.status !== 'pending') && chargeInstallments.length
      ? (chargeInstallments.some((item: any) => item.status === 'applied') ? 'finished' : 'canceled')
      : 'active';
    const billable = chargeInstallments.filter((item: any) => item.status !== 'canceled');
    const paid = billable.filter((item: any) => item.paymentState === 'paid');
    const payment = {
      paidCount: paid.length,
      billableCount: billable.length,
      paidCents: paid.reduce((sum: number, item: any) => sum + item.amount_cents, 0),
      billableCents: billable.reduce((sum: number, item: any) => sum + item.amount_cents, 0),
      overdueCount: billable.filter((item: any) => item.paymentState === 'overdue').length,
      openCount: billable.filter((item: any) => item.paymentState === 'open').length,
      awaitingIssueCount: billable.filter((item: any) => item.paymentState === 'awaiting_issue').length,
    };
    return { ...charge, status, payment, installments: chargeInstallments };
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

// Planilha de acompanhamento: quem pagou e quem não pagou a cobrança
// adicional. `description` opcional exporta só um grupo; sem ela, exporta
// todas as cobranças do condomínio.
router.get('/export', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'condominiumId is required' });
  const description = req.query?.description ? String(req.query.description) : null;

  const rows = await query<any>(
    `select ec.description,
            coalesce(nullif(concat_ws(' - ', b.name, un.number), ''), un.number) as unit_label,
            coalesce(morador.full_name, morador.username) as resident_name,
            ec.installment_count, ins.installment_number, ins.amount_cents,
            to_char(ins.reference_month, 'MM/YYYY') as reference_month,
            ins.status, ins.invoice_id, inv.status as invoice_status,
            to_char(inv.due_date, 'DD/MM/YYYY') as due_date,
            to_char(inv.paid_at, 'DD/MM/YYYY') as paid_at, inv.paid_at as paid_at_raw
     from unit_extra_charges ec
     join units un on un.id = ec.unit_id
     left join blocks b on b.id = un.block_id
     join unit_extra_charge_installments ins on ins.charge_id = ec.id
     left join invoices inv on inv.id = ins.invoice_id and inv.deleted_at is null
     left join lateral (
       select u.full_name, u.username from unit_occupancies uo
       join users u on u.id = uo.user_id
       where uo.unit_id = ec.unit_id and uo.ended_at is null and u.deleted_at is null
       order by uo.is_representative desc nulls last limit 1
     ) morador on true
     where ec.condominium_id = $1 and ($2::text is null or ec.description = $2)
     order by ec.description, unit_label, ins.installment_number`,
    [condominiumId, description],
  );

  const enriched = rows.rows.map((row: any) => ({ ...row, state: paymentStateOf({ ...row, invoice_paid_at: row.paid_at_raw }) }));

  const workbook = new ExcelJS.Workbook();
  const detail = workbook.addWorksheet('Parcelas');
  detail.columns = [
    { header: 'Cobrança', key: 'description', width: 28 },
    { header: 'Unidade', key: 'unit', width: 18 },
    { header: 'Morador', key: 'resident', width: 28 },
    { header: 'Parcela', key: 'installment', width: 10 },
    { header: 'Referência', key: 'reference', width: 12 },
    { header: 'Valor', key: 'amount', width: 14 },
    { header: 'Situação', key: 'state', width: 20 },
    { header: 'Vencimento', key: 'due', width: 14 },
    { header: 'Pago em', key: 'paid', width: 14 },
  ];
  for (const row of enriched) {
    detail.addRow({
      description: row.description,
      unit: row.unit_label,
      resident: row.resident_name || '—',
      installment: row.installment_count > 1 ? `${row.installment_number}/${row.installment_count}` : 'Única',
      reference: row.reference_month,
      amount: row.amount_cents / 100,
      state: paymentStateLabel[row.state] || row.state,
      due: row.due_date || '—',
      paid: row.paid_at || '—',
    });
  }
  detail.getColumn('amount').numFmt = 'R$ #,##0.00';
  detail.getRow(1).font = { bold: true };

  // Aba consolidada por unidade — é a leitura de "quem pagou e quem não
  // pagou" sem precisar somar parcela por parcela na mão.
  const summary = workbook.addWorksheet('Por unidade');
  summary.columns = [
    { header: 'Cobrança', key: 'description', width: 28 },
    { header: 'Unidade', key: 'unit', width: 18 },
    { header: 'Morador', key: 'resident', width: 28 },
    { header: 'Total', key: 'total', width: 14 },
    { header: 'Pago', key: 'paid', width: 14 },
    { header: 'Em aberto', key: 'open', width: 14 },
    { header: 'Parcelas pagas', key: 'paidCount', width: 15 },
    { header: 'Situação', key: 'state', width: 18 },
  ];
  const byUnit = new Map<string, any>();
  for (const row of enriched) {
    if (row.state === 'canceled') continue;
    const key = `${row.description}||${row.unit_label}`;
    const acc = byUnit.get(key) || { description: row.description, unit: row.unit_label, resident: row.resident_name || '—', total: 0, paid: 0, paidCount: 0, count: 0 };
    acc.total += row.amount_cents;
    acc.count += 1;
    if (row.state === 'paid') { acc.paid += row.amount_cents; acc.paidCount += 1; }
    byUnit.set(key, acc);
  }
  for (const acc of byUnit.values()) {
    summary.addRow({
      description: acc.description,
      unit: acc.unit,
      resident: acc.resident,
      total: acc.total / 100,
      paid: acc.paid / 100,
      open: (acc.total - acc.paid) / 100,
      paidCount: `${acc.paidCount}/${acc.count}`,
      state: acc.paid === 0 ? 'Nada pago' : acc.paid >= acc.total ? 'Quitado' : 'Parcial',
    });
  }
  summary.getColumn('total').numFmt = 'R$ #,##0.00';
  summary.getColumn('paid').numFmt = 'R$ #,##0.00';
  summary.getColumn('open').numFmt = 'R$ #,##0.00';
  summary.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const slug = (description || 'todas').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cobrancas-adicionais-${slug}.xlsx"`);
  return res.send(Buffer.from(buffer));
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
