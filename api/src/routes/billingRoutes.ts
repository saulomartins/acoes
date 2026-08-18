import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import multer from 'multer';
import ExcelJS from 'exceljs';
import bcrypt from 'bcrypt';
import { Readable } from 'stream';
import { createInterBoleto } from '../services/interService';
import { createBillingTemplateWorkbook } from '../services/billingTemplateService';
import { getInterIntegration } from './invoiceRoutes';
import { notifyNewInvoice } from '../services/invoiceReminderService';
import { logAudit } from '../services/auditService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const issuanceErrorMessage = (error: any) => {
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  const nested = Array.isArray(error?.errors) ? error.errors.find((item: any) => item?.message)?.message : null;
  if (nested) return String(nested);
  if (error?.code === 'EACCES') return 'O servidor não conseguiu acessar o Banco Inter. Verifique a permissão de conexão HTTPS.';
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'O Banco Inter não devolveu detalhes da falha. Tente novamente ou consulte o suporte.';
};
const interDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!iso) throw new Error('A data de vencimento da cobrança é inválida.');
  return iso[1];
};
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
};
const formatDateBr = (iso: string) => `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
const moneyBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const REQUIRED_BILLING_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'full_name', label: 'nome completo' },
  { key: 'cpf', label: 'CPF' },
  { key: 'street', label: 'rua' },
  { key: 'address_number', label: 'número do endereço' },
  { key: 'neighborhood', label: 'bairro' },
  { key: 'city', label: 'cidade' },
  { key: 'state', label: 'estado' },
  { key: 'postal_code', label: 'CEP' },
];
// item precisa trazer os campos de REQUIRED_BILLING_FIELDS (join com users) e hasAmount
// já considerando valor manual/override, já que a tipologia sozinha pode não ter valor.
const missingBillingFields = (item: Record<string, unknown>, hasAmount: boolean): string[] => {
  const missing = REQUIRED_BILLING_FIELDS.filter(field => !item[field.key]).map(field => field.label);
  if (!hasAmount) missing.push('valor da tipologia (ou informe um valor manual)');
  return missing;
};
const missingBillingFieldsMessage = (item: Record<string, unknown>, hasAmount: boolean): string | null => {
  const missing = missingBillingFields(item, hasAmount);
  return missing.length ? `Cadastro incompleto: falta preencher ${missing.join(', ')}.` : null;
};
type ExtraChargeMapEntry = { sumCents: number; installmentIds: string[]; descriptions: string[]; items: Array<{ description: string; amountCents: number }> };
const extraChargesByUnit = async (unitIds: (string | null | undefined)[], referenceMonthDate: string) => {
  const ids = [...new Set(unitIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, ExtraChargeMapEntry>();
  if (!ids.length) return map;
  const rows = await query<{ unit_id: string; description: string; id: string; amount_cents: number }>(
    `select ec.unit_id, ec.description, eci.id, eci.amount_cents
     from unit_extra_charge_installments eci join unit_extra_charges ec on ec.id = eci.charge_id
     where ec.unit_id = any($1::uuid[]) and eci.reference_month = $2::date and eci.status = 'pending'`,
    [ids, referenceMonthDate],
  );
  for (const row of rows.rows) {
    const entry = map.get(row.unit_id) || { sumCents: 0, installmentIds: [], descriptions: [], items: [] };
    entry.sumCents += Number(row.amount_cents);
    entry.installmentIds.push(row.id);
    if (!entry.descriptions.includes(row.description)) entry.descriptions.push(row.description);
    entry.items.push({ description: row.description, amountCents: Number(row.amount_cents) });
    map.set(row.unit_id, entry);
  }
  return map;
};
const UTILITY_LABEL: Record<string, string> = { agua: 'Água', gas: 'Gás', energia: 'Energia' };
type ConsumptionItem = { utilityType: string; quantity: number; unitPriceCents: number; amountCents: number };
type ConsumptionMapEntry = { sumCents: number; chargeIds: string[]; descriptions: string[]; items: ConsumptionItem[] };
// Mesmo fallback do requireFeature: sem linha em condominium_features, a
// feature conta como ativa (condomínio nunca configurado por lá). Exportada
// porque invoiceRoutes também precisa gatear consumption_items da mesma forma.
export const isConsumptionFeatureEnabled = async (condominiumId: string | null | undefined) => {
  if (!condominiumId) return false;
  const result = await query<{ enabled: boolean }>(`select consumo_individualizado as enabled from condominium_features where condominium_id=$1`, [condominiumId]);
  return result.rows[0] ? result.rows[0].enabled : true;
};
// Espelha extraChargesByUnit, mas lê de unit_consumption_charges (módulo
// "Cobrança por consumo", opcional por condomínio). Quando o condomínio não
// tem a feature ligada, retorna sempre vazio — nem lançamentos antigos (de
// quando a feature esteve ligada) voltam a ser cobrados ou exibidos.
// `items` guarda cada tipo (água/gás/energia) separado — a soma/descrições
// combinadas continuam existindo pra quem só precisa do total.
const consumptionChargesByUnit = async (condominiumId: string | null | undefined, unitIds: (string | null | undefined)[], referenceMonthDate: string) => {
  const map = new Map<string, ConsumptionMapEntry>();
  const ids = [...new Set(unitIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length || !(await isConsumptionFeatureEnabled(condominiumId))) return map;
  const rows = await query<{ unit_id: string; utility_type: string; id: string; amount_cents: number; quantity: number; unit_price_cents: number }>(
    `select unit_id, utility_type, id, amount_cents, quantity, unit_price_cents
     from unit_consumption_charges
     where unit_id = any($1::uuid[]) and reference_month = $2::date and status = 'pending'`,
    [ids, referenceMonthDate],
  );
  for (const row of rows.rows) {
    const entry = map.get(row.unit_id) || { sumCents: 0, chargeIds: [], descriptions: [], items: [] };
    entry.sumCents += Number(row.amount_cents);
    entry.chargeIds.push(row.id);
    entry.items.push({ utilityType: row.utility_type, quantity: Number(row.quantity), unitPriceCents: Number(row.unit_price_cents), amountCents: Number(row.amount_cents) });
    entry.descriptions.push(UTILITY_LABEL[row.utility_type] || row.utility_type);
    map.set(row.unit_id, entry);
  }
  return map;
};
router.use(authenticate, authorize('sindico', 'subsindico'), requireFeature('config_enviar_cobrancas'));

router.get('/settings', asyncHandler(async (req, res) => {
  const [result, condominium] = await Promise.all([query(
    `select * from billing_settings where condominium_id = $1`,
    [req.user?.condominiumId],
  ), query(`select id,name,cnpj from condominiums where id=$1`,[req.user?.condominiumId])]);
  return res.json({ settings: result.rows[0] || null, condominium:condominium.rows[0] || null });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });
  const body = req.body || {};
  if (String(body.descriptionTemplate || '').length > 100) return res.status(400).json({ message: 'A descrição deve ter no máximo 100 caracteres.' });
  const daysAfterDue = Number(body.daysAfterDue ?? 30);
  const discountDays = Number(body.discountDays ?? 0);
  if (daysAfterDue < 0 || daysAfterDue > 60 || discountDays < 0 || discountDays > 60) {
    return res.status(400).json({ message: 'Os prazos devem estar entre 0 e 60 dias.' });
  }
  if (!body.receiveBoleto && !body.receivePix) return res.status(400).json({ message: 'Selecione boleto e/ou Pix.' });
  const percentOrNull = (value: unknown, label: string) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw Object.assign(new Error(`${label} deve estar entre 0 e 100.`), { statusCode: 400 });
    return parsed;
  };
  let condoFeePercent: number | null; let improvementFeePercent: number | null;
  try {
    condoFeePercent = percentOrNull(body.condoFeePercent, 'A taxa de condomínio');
    improvementFeePercent = percentOrNull(body.improvementFeePercent, 'A taxa de melhoria');
  } catch (error: any) { return res.status(error?.statusCode || 400).json({ message: error.message }); }
  const result = await query(
    `insert into billing_settings (condominium_id, description_template, receive_boleto, receive_pix,
       allow_after_due, days_after_due, fine_type, fine_value, interest_type, interest_value,
       discount_type, discount_value, discount_days, condo_fee_percent, improvement_fee_percent, updated_by, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
     on conflict (condominium_id) do update set description_template=excluded.description_template,
       receive_boleto=excluded.receive_boleto, receive_pix=excluded.receive_pix,
       allow_after_due=excluded.allow_after_due, days_after_due=excluded.days_after_due,
       fine_type=excluded.fine_type, fine_value=excluded.fine_value,
       interest_type=excluded.interest_type, interest_value=excluded.interest_value,
       discount_type=excluded.discount_type, discount_value=excluded.discount_value,
       discount_days=excluded.discount_days, condo_fee_percent=excluded.condo_fee_percent,
       improvement_fee_percent=excluded.improvement_fee_percent, updated_by=excluded.updated_by, updated_at=now()
     returning *`,
    [condominiumId, String(body.descriptionTemplate ?? ''),
      Boolean(body.receiveBoleto), Boolean(body.receivePix), Boolean(body.allowAfterDue), daysAfterDue,
      body.fineType || 'NONE', Number(body.fineValue || 0), body.interestType || 'NONE', Number(body.interestValue || 0),
      body.discountType || 'NONE', Number(body.discountValue || 0), discountDays, condoFeePercent, improvementFeePercent, req.user?.id],
  );
  await logAudit(req, 'config_enviar_cobrancas', 'updated', 'Atualizou a configuração de cobranças');
  return res.json({ settings: result.rows[0] });
}));

router.post('/batches/preview', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const referenceMonth = String(req.body?.referenceMonth || '');
  const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const amountOverrides: Record<string, number> = req.body?.amountOverrides && typeof req.body.amountOverrides === 'object' ? req.body.amountOverrides : {};
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) return res.status(400).json({ message: 'Informe o mês de referência no formato AAAA-MM.' });
  if (!userIds.length) return res.status(400).json({ message: 'Selecione ao menos uma pessoa.' });
  const result = await query<{
    id: string; full_name: string | null; username: string; cpf: string | null; unit: string | null; unit_id: string | null;
    unit_type_name: string | null; fee_cents: number | null; street: string|null; address_number: string|null; neighborhood: string|null;
    city: string|null; state: string|null; postal_code: string|null; duplicate: boolean; billing_exempt:boolean; preferred_due_day:number;
    existing_amount_cents: number|null; existing_status: string|null;
  }>(
    `select u.id,u.full_name,u.username,u.cpf,u.unit,u.billing_exempt,u.preferred_due_day,
       u.street,u.address_number,u.neighborhood,u.city,u.state,u.postal_code,
       un.id unit_id,ut.name unit_type_name,ut.fee_cents,
       exists(select 1 from invoices i where i.user_id=u.id and i.reference_month=$3::date and i.status <> 'canceled') duplicate,
       (select i.amount_cents from invoices i where i.user_id=u.id and i.reference_month=$3::date and i.status <> 'canceled' order by i.created_at desc limit 1) existing_amount_cents,
       (select i.status from invoices i where i.user_id=u.id and i.reference_month=$3::date and i.status <> 'canceled' order by i.created_at desc limit 1) existing_status
     from users u left join units un on un.id=u.unit_id left join unit_types ut on ut.id=un.unit_type_id
     where u.condominium_id=$1 and u.id=any($2::uuid[]) order by u.full_name,u.username`,
    [condominiumId, userIds, `${referenceMonth}-01`],
  );
  const extraMap = await extraChargesByUnit(result.rows.map(row => row.unit_id), `${referenceMonth}-01`);
  const consumptionMap = await consumptionChargesByUnit(condominiumId, result.rows.map(row => row.unit_id), `${referenceMonth}-01`);
  const items = result.rows.map(row => {const dueDate=`${referenceMonth}-${String(row.preferred_due_day).padStart(2,'0')}`;const extra=row.unit_id?extraMap.get(row.unit_id):undefined;const consumption=row.unit_id?consumptionMap.get(row.unit_id):undefined;
    const override=Number(amountOverrides[row.id]); const hasOverride=Number.isInteger(override)&&override>0;
    const feeCents=hasOverride?override:Number(row.fee_cents||0)+(extra?.sumCents||0)+(consumption?.sumCents||0);
    const missingFields=missingBillingFields(row,Boolean(hasOverride||row.fee_cents));
    // Duplicidade não bloqueia mais a validade: uma pessoa pode ter mais de um
    // boleto na mesma referência (ex.: cobrança extra). O front decide se pede
    // confirmação extra mostrando existingAmountCents/existingStatus.
    return ({ ...row, extraChargeCents: extra?.sumCents||0, extraChargeItems: hasOverride?[]:(extra?.items||[]), consumptionChargeCents: consumption?.sumCents||0, consumptionItems: hasOverride?[]:(consumption?.items||[]), manualOverride: hasOverride,
    existingAmountCents: row.existing_amount_cents, existingStatus: row.existing_status,
    valid: Boolean(!missingFields.length && !row.billing_exempt && dueDate>=todayIso()),
    issues: [missingFields.length ? `Cadastro incompleto: falta preencher ${missingFields.join(', ')}` : null,
      row.duplicate ? `Já existe cobrança de ${(Number(row.existing_amount_cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} nesta referência (não impede uma nova emissão)` : null,
      row.billing_exempt ? 'Pessoa isenta de boleto' : null,
      dueDate<todayIso() ? `O vencimento ${formatDateBr(dueDate)} já passou` : null].filter(Boolean),
      due_date:dueDate, fee_cents:feeCents })});
  return res.json({ referenceMonth, items, validCount: items.filter(i => i.valid).length,
    totalAmountCents: items.filter(i => i.valid).reduce((sum, i) => sum + Number(i.fee_cents || 0), 0) });
}));

router.post('/batches', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const { referenceMonth, description, userIds } = req.body || {};
  const amountOverrides: Record<string, number> = req.body?.amountOverrides && typeof req.body.amountOverrides === 'object' ? req.body.amountOverrides : {};
  if (!/^\d{4}-\d{2}$/.test(String(referenceMonth || '')) || !Array.isArray(userIds) || !userIds.length) {
    return res.status(400).json({ message: 'Informe mês de referência e pessoas.' });
  }
  // Opcional: quando vazia, a observação do boleto usa só o padrão "Taxa
  // condominial - {tipologia}" + o detalhamento de taxas/consumo (ver
  // /batches/:id/issue) — não é mais obrigatório digitar algo aqui.
  const billingDescription=String(description||'').trim();
  if(billingDescription.length>100) return res.status(400).json({message:'A descrição deve ter no máximo 100 caracteres.'});
  const condominium=await query<{name:string;cnpj:string|null}>(`select name,cnpj from condominiums where id=$1`,[condominiumId]);
  if(!condominium.rows[0]?.name||!condominium.rows[0]?.cnpj) return res.status(400).json({message:'Complete o nome e o CNPJ do condomínio antes de gerar boletos.'});
  const overrideFor=(personId:string)=>{const value=Number(amountOverrides[personId]);return Number.isInteger(value)&&value>0?value:null;};
  const people = await query<any>(
    `select u.id,u.full_name,u.username,u.cpf,u.preferred_due_day,un.id unit_id,ut.fee_cents
     from users u left join units un on un.id=u.unit_id left join unit_types ut on ut.id=un.unit_type_id
     where u.condominium_id=$1 and u.billing_exempt=false and u.id=any($2::uuid[])`,
    [condominiumId,userIds],
  );
  // Uma pessoa pode ter mais de uma cobrança na mesma referência (ex.: cobrança
  // extra/avulsa) — não bloqueamos aqui. O aviso já foi mostrado na prévia
  // (/batches/preview) para o síndico confirmar antes de chegar neste ponto.
  const withoutAmount=people.rows.filter((person:any)=>!overrideFor(person.id)&&!person.fee_cents);
  if (withoutAmount.length) return res.status(400).json({ message: `${withoutAmount.map((p:any)=>p.full_name||p.username).join(', ')} sem valor de tipologia. Informe um valor manual ou complete o cadastro da unidade.` });
  const extraMap = await extraChargesByUnit(people.rows.map((p:any)=>p.unit_id), `${referenceMonth}-01`);
  const consumptionMap = await consumptionChargesByUnit(condominiumId, people.rows.map((p:any)=>p.unit_id), `${referenceMonth}-01`);
  const amountFor=(person:any)=>overrideFor(person.id)??(Number(person.fee_cents||0)+(extraMap.get(person.unit_id)?.sumCents||0)+(consumptionMap.get(person.unit_id)?.sumCents||0));
  const batch = await withTransaction(async client=>{
    const batchId=randomUUID(); const total=people.rows.reduce((sum:number,p:any)=>sum+amountFor(p),0);
    const created=await client.query(
      `insert into billing_batches(id,condominium_id,reference_month,due_date,description,beneficiary_name,beneficiary_document,status,total_items,total_amount_cents,created_by)
       values($1,$2,$3,$4,$5,$6,$7,'validated',$8,$9,$10) returning *`,
      [batchId,condominiumId,`${referenceMonth}-01`,null,billingDescription,condominium.rows[0].name,condominium.rows[0].cnpj,people.rows.length,total,req.user?.id]);
    for(const person of people.rows) await client.query(
      `insert into billing_batch_items(id,batch_id,user_id,document,payer_name,amount_cents,amount_override_cents,due_date,status)
       values($1,$2,$3,$4,$5,$6,$7,$8,'valid')`,
      [randomUUID(),batchId,person.id,person.cpf||person.id,person.full_name||person.username,amountFor(person),overrideFor(person.id),`${referenceMonth}-${String(person.preferred_due_day).padStart(2,'0')}`]);
    await client.query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'monthly_batch_created',$5)`,[randomUUID(),condominiumId,batchId,req.user?.id,JSON.stringify({referenceMonth,userIds,hasManualOverrides:Object.keys(amountOverrides).length>0})]);
    return created;
  });
  await logAudit(req, 'config_enviar_cobrancas', 'created', `Criou o lote de referência ${referenceMonth} (${people.rows.length} pessoa(s))`, { entityId: String((batch.rows[0] as any).id) });
  return res.status(201).json({ batch: batch.rows[0], message: 'Lote salvo como rascunho. Nenhuma cobrança foi emitida.' });
}));

router.get('/batches', asyncHandler(async (req, res) => {
  const result = await query(`select * from billing_batches where condominium_id=$1 and reference_month is not null order by reference_month desc,created_at desc`, [req.user?.condominiumId]);
  return res.json({ batches: result.rows });
}));

// Exclui a referência (lote) inteira, junto de tudo que faz referência a
// ela: itens do lote e eventos de auditoria (ambos com "on delete cascade"
// em billing_batches). Só é permitido quando NENHUM item do lote tem
// boleto emitido — se algum já foi emitido, o registro em `invoices` é
// financeiro e não pode simplesmente desaparecer; o síndico precisa
// cancelar esses boletos primeiro em Gestão de cobranças.
router.delete('/batches/:id', asyncHandler(async (req,res)=>{
  const condominiumId=req.user?.condominiumId;
  const batch=await query<any>(`select * from billing_batches where id=$1 and condominium_id=$2`,[req.params.id,condominiumId]);
  if(!batch.rows[0]) return res.status(404).json({message:'Referência não encontrada.'});
  const issued=await query<any>(`select count(*)::int as count from billing_batch_items where batch_id=$1 and invoice_id is not null`,[req.params.id]);
  if(Number(issued.rows[0]?.count)>0) return res.status(409).json({message:'Não é possível excluir: esta referência já tem boleto(s) emitido(s) no banco. Cancele os boletos emitidos em Gestão de cobranças antes de excluir a referência.'});
  await query(`delete from billing_batches where id=$1`,[req.params.id]);
  await logAudit(req, 'config_enviar_cobrancas', 'deleted', `Excluiu a referência ${req.params.id}`, { entityId: req.params.id });
  return res.json({message:'Referência excluída, junto com todas as cobranças pendentes desta competência.'});
}));

router.get('/profiles', asyncHandler(async (req,res)=>{
  const result=await query(
    `select p.*,u.full_name,u.username,u.cpf,u.unit,ut.name unit_type_name,ut.fee_cents unit_type_fee_cents
     from person_billing_profiles p join users u on u.id=p.user_id left join units un on un.id=u.unit_id left join unit_types ut on ut.id=un.unit_type_id
     where p.condominium_id=$1 order by u.full_name,u.username`,[req.user?.condominiumId]);
  return res.json({profiles:result.rows});
}));

const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const textValue = (value: unknown) => String(value ?? '').trim();
const moneyCents = (value: unknown) => {
  if (typeof value === 'number') return Math.round(value * 100);
  const clean = textValue(value).replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Math.round(Number(clean || 0) * 100);
};
const isoDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = textValue(value);
  const br = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

router.post('/imports/excel', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Selecione um arquivo Excel.' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ message: 'Use o arquivo .xlsx do modelo do Banco Inter.' });
  const rawRows: Array<{ row:number; name:string; document:string; email:string; phone:string; street:string; number:string; complement:string; neighborhood:string; city:string; state:string; postalCode:string; amountCents:number; code:string; description:string; dueDate:string|null; config:any }> = [];
  let targetSheetFound=false;
  const reader=new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(req.file.buffer) as any,{worksheets:'emit',sharedStrings:'cache',styles:'ignore',hyperlinks:'ignore'});
  for await (const sheet of reader) {
    const sheetKey=String((sheet as any).name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(sheetKey!=='cobranca simples') continue;
    targetSheetFound=true;
    for await (const row of sheet) {
    const rowNumber=row.number;
    if (rowNumber < 4) continue;
    const document = digits(row.getCell(2).value);
    const name = textValue(row.getCell(1).text);
    if (!document || (!name && !row.getCell(17).value)) continue;
    if (name === 'Cliente Inter Nome' || document === '11122233344') continue;
    rawRows.push({ row:rowNumber, name, document, email:textValue(row.getCell(3).text), phone:digits(row.getCell(4).text),
      street:textValue(row.getCell(5).text), number:textValue(row.getCell(6).text), complement:textValue(row.getCell(7).text),
      neighborhood:textValue(row.getCell(8).text), city:textValue(row.getCell(9).text), state:textValue(row.getCell(10).text).toUpperCase(),
      postalCode:digits(row.getCell(11).text), amountCents:moneyCents(row.getCell(17).value ?? row.getCell(17).text),
      code:textValue(row.getCell(18).text), description:textValue(row.getCell(19).text), dueDate:isoDate(row.getCell(20).value ?? row.getCell(20).text),
      config:{ receivePix:/sim/i.test(textValue(row.getCell(15).text)), receiveBoleto:/boleto/i.test(textValue(row.getCell(16).text)),
        allowAfterDue:/sim/i.test(textValue(row.getCell(21).text)), daysAfterDue:Number(row.getCell(22).value||0),
        fineType:/percent|%/i.test(textValue(row.getCell(23).text))?'PERCENT':/R\$/i.test(textValue(row.getCell(23).text))?'FIXED':'NONE', fineValue:Number(textValue(row.getCell(24).text).replace(',','.')||0),
        interestType:/percent|%/i.test(textValue(row.getCell(25).text))?'PERCENT_MONTH':/R\$/i.test(textValue(row.getCell(25).text))?'FIXED':'NONE', interestValue:Number(textValue(row.getCell(26).text).replace(',','.')||0),
        discountType:/percent|%/i.test(textValue(row.getCell(27).text))?'PERCENT':/R\$/i.test(textValue(row.getCell(27).text))?'FIXED':'NONE', discountValue:Number(textValue(row.getCell(28).text).replace(',','.')||0), discountDays:Number(row.getCell(29).value||0) } });
    }
  }
  if (!targetSheetFound) return res.status(400).json({ message: 'A planilha "Cobrança Simples" não foi encontrada.' });
  if (!rawRows.length) return res.status(400).json({ message: 'Nenhuma linha preenchida foi encontrada.' });
  const dueDates = [...new Set(rawRows.map(r=>r.dueDate).filter(Boolean))];
  const documents = rawRows.map(r=>r.document);
  const people = await query<any>(
    `select u.id,u.full_name,u.cpf,u.email,u.phone,u.street,u.address_number,u.address_complement,u.neighborhood,u.city,u.state,u.postal_code,u.unit,ut.name unit_type_name,ut.fee_cents
     from users u left join units un on un.id=u.unit_id left join unit_types ut on ut.id=un.unit_type_id
     where u.condominium_id=$1 and regexp_replace(coalesce(u.cpf,''),'[^0-9]','','g')=any($2::text[])`,
    [req.user?.condominiumId, documents],
  );
  const byDocument = new Map(people.rows.map((p:any)=>[digits(p.cpf),p]));
  const seen = new Set<string>();
  const batchId = randomUUID();
  const items = [];
  for (const row of rawRows) {
    let person:any = byDocument.get(row.document);
    const issues:string[] = [];
    let status = 'valid';
    if (!row.dueDate) { issues.push('Data de vencimento inválida ou não informada'); status='invalid'; }
    if (seen.has(row.document)) { issues.push('Documento repetido dentro da planilha'); status='duplicate'; }
    seen.add(row.document);
    if (!person) {
      if (!row.name || ![11,14].includes(row.document.length)) { issues.push('Nome e CPF/CNPJ válido são obrigatórios para criar a pessoa'); status='invalid'; }
      else {
        const newId=randomUUID(); const generatedUsername=`importado_${row.document}`;
        const passwordHash=await bcrypt.hash(randomUUID(),10);
        const created=await query<any>(
          `insert into users(id,username,password_hash,role,condominium_id,full_name,cpf,email,phone,street,address_number,address_complement,neighborhood,city,state,postal_code,login_enabled)
           values($1,$2,$3,'proprietario',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)
           returning id,full_name,cpf,email,phone,street,address_number,address_complement,neighborhood,city,state,postal_code,unit,null::text unit_type_name,null::integer fee_cents`,
          [newId,generatedUsername,passwordHash,req.user?.condominiumId,row.name,row.document,row.email||null,row.phone||null,row.street||null,row.number||null,row.complement||null,row.neighborhood||null,row.city||null,row.state||null,row.postalCode||null]);
        person=created.rows[0]; byDocument.set(row.document,person);
        issues.push('Pessoa criada pela importação; complete unidade e tipologia'); status='invalid';
      }
    }
    if (person) {
      await query(
        `update users set full_name=coalesce(full_name,$1),email=coalesce(email,$2),phone=coalesce(phone,$3),street=coalesce(street,$4),address_number=coalesce(address_number,$5),address_complement=coalesce(address_complement,$6),neighborhood=coalesce(neighborhood,$7),city=coalesce(city,$8),state=coalesce(state,$9),postal_code=coalesce(postal_code,$10) where id=$11`,
        [row.name||null,row.email||null,row.phone||null,row.street||null,row.number||null,row.complement||null,row.neighborhood||null,row.city||null,row.state||null,row.postalCode||null,person.id]);
      await query(
        `insert into person_billing_profiles(user_id,condominium_id,amount_override_cents,description,receive_boleto,receive_pix,allow_after_due,days_after_due,fine_type,fine_value,interest_type,interest_value,discount_type,discount_value,discount_days,source)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'excel') on conflict(user_id) do update set amount_override_cents=excluded.amount_override_cents,description=excluded.description,receive_boleto=excluded.receive_boleto,receive_pix=excluded.receive_pix,allow_after_due=excluded.allow_after_due,days_after_due=excluded.days_after_due,fine_type=excluded.fine_type,fine_value=excluded.fine_value,interest_type=excluded.interest_type,interest_value=excluded.interest_value,discount_type=excluded.discount_type,discount_value=excluded.discount_value,discount_days=excluded.discount_days,source='excel',updated_at=now()`,
        [person.id,req.user?.condominiumId,row.amountCents||null,row.description||null,row.config.receiveBoleto,row.config.receivePix,row.config.allowAfterDue,row.config.daysAfterDue,row.config.fineType,row.config.fineValue,row.config.interestType,row.config.interestValue,row.config.discountType,row.config.discountValue,row.config.discountDays]);
      const diffs:Array<[string,string,string]> = [['nome',row.name,person.full_name],['email',row.email,person.email],['telefone',row.phone,digits(person.phone)],['logradouro',row.street,person.street],['número',row.number,person.address_number],['bairro',row.neighborhood,person.neighborhood],['cidade',row.city,person.city],['UF',row.state,person.state],['CEP',row.postalCode,digits(person.postal_code)]];
      diffs.forEach(([label,sheetValue,masterValue])=>{ if(sheetValue && masterValue && sheetValue.toLowerCase()!==String(masterValue).toLowerCase()) issues.push(`${label} diverge; cadastro será utilizado`); });
      if (!person.fee_cents) { issues.push('Tipologia sem valor'); status='invalid'; }
      if (row.amountCents && row.amountCents !== person.fee_cents) issues.push('Valor da planilha ignorado; valor da tipologia será utilizado');
      const duplicate = await query(`select 1 from invoices where user_id=$1 and due_date=$2 and status<>'canceled'`, [person.id, row.dueDate]);
      if (duplicate.rows[0]) { issues.push('Cobrança já existente para este vencimento'); status='duplicate'; }
    }
    items.push({ ...row, person, issues, status });
  }
  const valid = items.filter(i=>i.status==='valid');
  await query(`insert into billing_batches(id,condominium_id,due_date,description,status,total_items,total_amount_cents,created_by) values($1,$2,$3,$4,'validated',$5,$6,$7)`,
    [batchId,req.user?.condominiumId,dueDates.length===1?dueDates[0]:null,valid[0]?.description||'Importação Excel',items.length,valid.reduce((s,i)=>s+Number(i.person?.fee_cents||0),0),req.user?.id]);
  for (const item of items) await query(
    `insert into billing_batch_items(id,batch_id,user_id,document,payer_name,amount_cents,due_date,source_row,status,issues,spreadsheet_data) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(batch_id,document) do nothing`,
    [randomUUID(),batchId,item.person?.id||null,item.document,item.person?.full_name||item.name,item.person?.fee_cents||item.amountCents,item.dueDate,item.row,item.status,JSON.stringify(item.issues),JSON.stringify(item)]);
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'excel_imported',$5)`,
    [randomUUID(),req.user?.condominiumId,batchId,req.user?.id,JSON.stringify({file:req.file.originalname,rows:items.length,valid:valid.length})]);
  await logAudit(req, 'config_enviar_cobrancas', 'imported', `Importou lote via Excel (${valid.length} de ${items.length} válidos)`, { entityId: batchId });
  return res.status(201).json({ batchId, total:items.length, valid:valid.length, invalid:items.length-valid.length, items:items.map(i=>({row:i.row,document:i.document,name:i.person?.full_name||i.name,status:i.status,amountCents:i.person?.fee_cents||i.amountCents,issues:i.issues})) });
}));

router.get('/batches/:id/items', asyncHandler(async (req,res)=>{
  const batch=await query<any>(`select * from billing_batches where id=$1 and condominium_id=$2`,[req.params.id,req.user?.condominiumId]);
  if(!batch.rows[0]) return res.status(404).json({message:'Lote não encontrado.'});
  const items=await query<any>(
    `select bi.*, un.id unit_id, coalesce(nullif(concat_ws(' - ',blk.name,un.number),''),u.unit) unit_label
     from billing_batch_items bi left join users u on u.id=bi.user_id left join units un on un.id=u.unit_id left join blocks blk on blk.id=un.block_id
     where bi.batch_id=$1 order by bi.source_row nulls last,bi.created_at`,[req.params.id]);
  const extraMap=batch.rows[0].reference_month?await extraChargesByUnit(items.rows.map((item:any)=>item.unit_id),interDate(batch.rows[0].reference_month)):new Map();
  const consumptionMap=batch.rows[0].reference_month?await consumptionChargesByUnit(req.user?.condominiumId,items.rows.map((item:any)=>item.unit_id),interDate(batch.rows[0].reference_month)):new Map();
  const feeSettings=await query<{condo_fee_percent:number|null;improvement_fee_percent:number|null}>(`select condo_fee_percent,improvement_fee_percent from billing_settings where condominium_id=$1`,[req.user?.condominiumId]);
  const condoFeePercent=Number(feeSettings.rows[0]?.condo_fee_percent||0);
  const improvementFeePercent=Number(feeSettings.rows[0]?.improvement_fee_percent||0);
  const itemsWithBreakdown=items.rows.map((item:any)=>{
    const hasOverride=Number.isInteger(item.amount_override_cents)&&item.amount_override_cents>0;
    if(hasOverride) return {...item,manualOverride:true,extraChargeCents:0,extraChargeDescriptions:[],consumptionChargeCents:0,consumptionItems:[],baseFeeCents:Number(item.amount_cents||0),condoFeeCents:null,improvementFeeCents:null};
    const extra=item.unit_id?extraMap.get(item.unit_id):undefined;
    const consumption=item.unit_id?consumptionMap.get(item.unit_id):undefined;
    const extraCents=extra?.sumCents||0;
    const consumptionCents=consumption?.sumCents||0;
    const baseFeeCents=Number(item.amount_cents||0)-extraCents-consumptionCents;
    const condoFeeCents=condoFeePercent>0?Math.round(baseFeeCents*condoFeePercent/100):null;
    const improvementFeeCents=improvementFeePercent>0?Math.round(baseFeeCents*improvementFeePercent/100):null;
    return {...item,manualOverride:false,extraChargeCents:extraCents,extraChargeDescriptions:extra?.descriptions||[],extraChargeItems:extra?.items||[],consumptionChargeCents:consumptionCents,consumptionChargeDescriptions:consumption?.descriptions||[],consumptionItems:consumption?.items||[],baseFeeCents,condoFeePercent:condoFeeCents!==null?condoFeePercent:null,condoFeeCents,improvementFeePercent:improvementFeeCents!==null?improvementFeePercent:null,improvementFeeCents};
  });
  return res.json({batch:batch.rows[0],items:itemsWithBreakdown});
}));

router.post('/batches/:batchId/items', asyncHandler(async (req,res)=>{
  const condominiumId=req.user?.condominiumId;
  const userId=String(req.body?.userId||'');
  if(!userId) return res.status(400).json({message:'Selecione a pessoa a adicionar.'});
  const batch=await query<any>(`select * from billing_batches where id=$1 and condominium_id=$2 and status<>'processing'`,[req.params.batchId,condominiumId]);
  if(!batch.rows[0]) return res.status(409).json({message:'Lote não encontrado ou em processamento no momento.'});
  if(!batch.rows[0].reference_month) return res.status(400).json({message:'Este lote não tem mês de referência (foi criado por importação) e não aceita adicionar unidades por aqui.'});
  const referenceMonth=interDate(batch.rows[0].reference_month);
  const person=await query<any>(
    `select u.id,u.full_name,u.username,u.cpf,u.preferred_due_day,un.id unit_id,ut.fee_cents,
       exists(select 1 from invoices i where i.user_id=u.id and i.reference_month=$3::date and i.status<>'canceled') duplicate,
       exists(select 1 from billing_batch_items bi where bi.batch_id=$4 and bi.user_id=u.id) already_in_batch
     from users u join units un on un.id=u.unit_id join unit_types ut on ut.id=un.unit_type_id
     where u.id=$1 and u.condominium_id=$2 and u.billing_exempt=false`,
    [userId,condominiumId,referenceMonth,req.params.batchId]);
  if(!person.rows[0]) return res.status(404).json({message:'Pessoa não encontrada, isenta de boleto ou sem tipologia/unidade configurada.'});
  if(person.rows[0].duplicate) return res.status(409).json({message:'Esta pessoa já possui cobrança nesta referência.'});
  if(person.rows[0].already_in_batch) return res.status(409).json({message:'Esta pessoa já está neste lote.'});
  const extraMap=await extraChargesByUnit([person.rows[0].unit_id],referenceMonth);
  const consumptionMap=await consumptionChargesByUnit(condominiumId,[person.rows[0].unit_id],referenceMonth);
  const amountCents=Number(person.rows[0].fee_cents||0)+(extraMap.get(person.rows[0].unit_id)?.sumCents||0)+(consumptionMap.get(person.rows[0].unit_id)?.sumCents||0);
  const dueDate=`${referenceMonth.slice(0,7)}-${String(person.rows[0].preferred_due_day).padStart(2,'0')}`;
  if(dueDate<todayIso()) return res.status(400).json({message:`O vencimento ${formatDateBr(dueDate)} já passou. Ajuste o dia preferido da pessoa antes de adicionar.`});
  const item=await withTransaction(async client=>{
    const inserted=await client.query(
      `insert into billing_batch_items(id,batch_id,user_id,document,payer_name,amount_cents,due_date,status) values($1,$2,$3,$4,$5,$6,$7,'valid') returning *`,
      [randomUUID(),req.params.batchId,person.rows[0].id,person.rows[0].cpf||person.rows[0].id,person.rows[0].full_name||person.rows[0].username,amountCents,dueDate]);
    await client.query(`update billing_batches set total_items=total_items+1,total_amount_cents=total_amount_cents+$1 where id=$2`,[amountCents,req.params.batchId]);
    return inserted.rows[0];
  });
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'batch_item_added',$5)`,
    [randomUUID(),condominiumId,req.params.batchId,req.user?.id,JSON.stringify({userId,payerName:item.payer_name,amountCents})]);
  await logAudit(req, 'config_enviar_cobrancas', 'updated', `Adicionou ${item.payer_name} a um lote`, { entityId: req.params.batchId });
  return res.status(201).json({item,message:`${item.payer_name} adicionado(a) ao lote.`});
}));

router.delete('/batches/:batchId/items/:itemId', asyncHandler(async (req,res)=>{
  const condominiumId=req.user?.condominiumId;
  const item=await query<any>(
    `select bi.* from billing_batch_items bi join billing_batches b on b.id=bi.batch_id
     where bi.id=$1 and bi.batch_id=$2 and b.condominium_id=$3`,
    [req.params.itemId,req.params.batchId,condominiumId]);
  if(!item.rows[0]) return res.status(404).json({message:'Cobrança não encontrada.'});
  if(item.rows[0].invoice_id||item.rows[0].status==='issued') return res.status(409).json({message:'Não é possível excluir: este boleto já foi emitido. Cancele o boleto em Gestão de cobranças.'});
  await withTransaction(async client=>{
    await client.query(`delete from billing_batch_items where id=$1`,[req.params.itemId]);
    await client.query(`update billing_batches set total_items=total_items-1,total_amount_cents=total_amount_cents-$1 where id=$2`,[item.rows[0].amount_cents,req.params.batchId]);
  });
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'batch_item_removed',$5)`,
    [randomUUID(),condominiumId,req.params.batchId,req.user?.id,JSON.stringify({itemId:req.params.itemId,payerName:item.rows[0].payer_name})]);
  await logAudit(req, 'config_enviar_cobrancas', 'updated', `Removeu ${item.rows[0].payer_name} de um lote`, { entityId: req.params.batchId });
  return res.json({message:`${item.rows[0].payer_name} removido(a) do lote.`});
}));

router.patch('/batches/:batchId/items/:itemId/due-date', asyncHandler(async (req,res)=>{
  const dueDate=String(req.body?.dueDate||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({message:'Informe o vencimento no formato DD/MM/AAAA.'});
  if(dueDate<todayIso()) return res.status(400).json({message:`O vencimento deve ser igual ou posterior a ${formatDateBr(todayIso())}.`});
  const previous=await query<any>(`select bi.due_date,bi.payer_name,b.condominium_id
    from billing_batch_items bi join billing_batches b on b.id=bi.batch_id
    where bi.id=$1 and bi.batch_id=$2 and b.condominium_id=$3 and bi.status in ('valid','confirmed','failed') and bi.invoice_id is null`,
    [req.params.itemId,req.params.batchId,req.user?.condominiumId]);
  if(!previous.rows[0]) return res.status(409).json({message:'Esta cobrança não está disponível para correção ou já foi emitida.'});
  const updated=await query<any>(`update billing_batch_items set due_date=$1 where id=$2 and batch_id=$3 returning *`,
    [dueDate,req.params.itemId,req.params.batchId]);
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details)
    values($1,$2,$3,$4,'failed_item_due_date_adjusted',$5)`,[randomUUID(),req.user?.condominiumId,req.params.batchId,req.user?.id,
      JSON.stringify({itemId:req.params.itemId,payerName:previous.rows[0].payer_name,oldDueDate:interDate(previous.rows[0].due_date),newDueDate:dueDate})]);
  await logAudit(req, 'config_enviar_cobrancas', 'updated', `Alterou o vencimento de ${previous.rows[0].payer_name} para ${formatDateBr(dueDate)}`, { entityId: req.params.batchId });
  return res.json({item:updated.rows[0],message:`Vencimento de ${previous.rows[0].payer_name} alterado para ${formatDateBr(dueDate)}.`});
}));

router.post('/batches/:id/confirm', asyncHandler(async (req,res)=>{
  const updated=await query(`update billing_batches set status='confirmed' where id=$1 and condominium_id=$2 and status in ('draft','validated') returning *`,[req.params.id,req.user?.condominiumId]);
  if(!updated.rows[0]) return res.status(409).json({message:'Lote inexistente ou já confirmado.'});
  await query(`update billing_batch_items set status='confirmed' where batch_id=$1 and status='valid'`,[req.params.id]);
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'batch_confirmed_without_issuance',$5)`,[randomUUID(),req.user?.condominiumId,req.params.id,req.user?.id,JSON.stringify({issuance:false})]);
  await logAudit(req, 'config_enviar_cobrancas', 'updated', `Confirmou o lote ${req.params.id} para revisão`, { entityId: req.params.id });
  return res.json({batch:updated.rows[0],message:'Lote confirmado para revisão. Nenhum boleto foi emitido.'});
}));

router.post('/batches/:id/issue', asyncHandler(async (req,res)=>{
  const condominiumId=req.user?.condominiumId;
  const batchResult=await query<any>(`select * from billing_batches where id=$1 and condominium_id=$2 and status in ('confirmed','partial')`,[req.params.id,condominiumId]);
  const batch=batchResult.rows[0];
  if(!batch) return res.status(409).json({message:'O lote precisa estar confirmado antes do envio ao banco.'});
  const integration=await getInterIntegration(condominiumId!);
  if(!integration?.enabled) return res.status(400).json({message:'Integração Banco Inter não configurada ou desabilitada.'});
  const feeSettings=await query<{condo_fee_percent:number|null;improvement_fee_percent:number|null}>(`select condo_fee_percent,improvement_fee_percent from billing_settings where condominium_id=$1`,[condominiumId]);
  const condoFeePercent=Number(feeSettings.rows[0]?.condo_fee_percent||0);
  const improvementFeePercent=Number(feeSettings.rows[0]?.improvement_fee_percent||0);
  const items=await query<any>(
    `select bi.*,u.full_name,u.username,u.cpf,u.email,u.phone,u.street,u.address_number,u.address_complement,u.neighborhood,u.city,u.state,u.postal_code,u.unit,un.id unit_id,
            ut.name unit_type_name,ut.fee_cents
     from billing_batch_items bi join users u on u.id=bi.user_id left join units un on un.id=u.unit_id left join unit_types ut on ut.id=un.unit_type_id
     where bi.batch_id=$1 and bi.status in ('confirmed','failed') order by bi.created_at`,[batch.id]);
  const extraMap=await extraChargesByUnit(items.rows.map((item:any)=>item.unit_id),batch.reference_month);
  const consumptionMap=await consumptionChargesByUnit(condominiumId,items.rows.map((item:any)=>item.unit_id),batch.reference_month);
  await query(`update billing_batches set status='processing' where id=$1`,[batch.id]);
  let issued=0;let failed=0;const failures:Array<{payerName:string;reason:string}>=[];
  for(const item of items.rows){
    let reservationKey:string|null=null;
    const extra=item.unit_id?extraMap.get(item.unit_id):undefined;
    const consumption=item.unit_id?consumptionMap.get(item.unit_id):undefined;
    const hasOverride=Number.isInteger(item.amount_override_cents)&&item.amount_override_cents>0;
    const amountCents=hasOverride?item.amount_override_cents:Number(item.fee_cents||0)+(extra?.sumCents||0)+(consumption?.sumCents||0);
    try{
      const missingFieldsMessage=missingBillingFieldsMessage(item,Boolean(amountCents));
      if(missingFieldsMessage) throw new Error(missingFieldsMessage);
      const payerCpf=String(item.cpf).replace(/\D/g,'');
      reservationKey=randomUUID();
      // A trava é só contra corrida (clique duplo/requisições concorrentes) durante
      // a emissão em si — uma pessoa pode ter várias cobranças ativas ao longo do
      // tempo. Por isso só bloqueia se já existe uma reserva em andamento (feita há
      // menos de 2 minutos); reservas concluídas (reservation_key volta a null) ou
      // travadas há mais tempo liberam uma nova tentativa.
      const reservation=await query(`insert into inter_issuance_guards(payer_cpf,user_id,reservation_key) values($1,$2,$3)
        on conflict(payer_cpf) do update set user_id=excluded.user_id,invoice_id=null,reservation_key=excluded.reservation_key,reserved_at=now()
        where inter_issuance_guards.reservation_key is null or inter_issuance_guards.reserved_at < now() - interval '2 minutes'
        returning payer_cpf`,[payerCpf,item.user_id,reservationKey]);
      if(!reservation.rows[0]) throw new Error('Já existe uma emissão em andamento para este CPF. Aguarde alguns instantes e tente novamente.');
      const dueDate=interDate(item.due_date);
      if(dueDate<todayIso()) throw new Error(`O vencimento ${formatDateBr(dueDate)} já passou. Escolha um vencimento igual ou posterior a ${formatDateBr(todayIso())}.`);
      // O detalhamento de Taxa de condomínio/Taxa de melhoria decompõe só a
      // tipologia (item.fee_cents) — override manual fica de fora (o valor
      // manual substitui o cálculo padrão por completo).
      const feeCents=Number(item.fee_cents||0);
      const condoBaseFeeCents=!hasOverride?feeCents:null;
      const condoFeeCents=!hasOverride&&condoFeePercent>0?Math.round(feeCents*condoFeePercent/100):null;
      const improvementFeeCents=!hasOverride&&improvementFeePercent>0?Math.round(feeCents*improvementFeePercent/100):null;
      // Não usa mais a tipologia da unidade (ex.: "AREA COMUM") na observação
      // — só o que o síndico digitou (se digitou algo) + o detalhamento.
      const tipologiaLabel=item.unit_type_name||item.unit||'';
      const baseDescription=(batch.description||'').replace('{tipologia}',tipologiaLabel).trim();
      // A observação sempre traz: o que o síndico digitou (se houver) + Tx
      // cond./Tx Melhoria (quando configuradas) + cobranças adicionais e
      // consumo (quando existirem no mês), sempre com valor — não depende
      // de nenhuma escolha na hora de emitir. O campo do Banco Inter
      // (mensagem.linha1) aceita só 78 caracteres, então o formato é
      // abreviado e createInterBoleto ainda corta em 78 como rede de
      // segurança se a soma de tudo passar do previsto (prioridade: o texto
      // digitado primeiro, detalhamento de taxas depois).
      const breakdownParts=!hasOverride?[
        condoFeeCents!==null?`Tx cond. ${condoFeePercent}%:${moneyBRL(condoFeeCents)}`:null,
        improvementFeeCents!==null?`Tx Melhoria ${improvementFeePercent}%:${moneyBRL(improvementFeeCents)}`:null,
        extra?.descriptions.length?`${extra.descriptions.join('/')}:${moneyBRL(extra.sumCents)}`:null,
        consumption?.descriptions.length?`${consumption.descriptions.join('/')}:${moneyBRL(consumption.sumCents)}`:null,
      ].filter((part):part is string=>Boolean(part)):[];
      const description=[baseDescription,...breakdownParts].filter(Boolean).join('+')||'Taxa condominial';
      const boleto=await createInterBoleto({payerName:item.full_name,payerDocument:item.cpf,amountCents,dueDate,description,payerEmail:item.email,payerPhone:item.phone,payerStreet:item.street,payerNumber:item.address_number,payerComplement:item.address_complement,payerNeighborhood:item.neighborhood,payerCity:item.city,payerState:item.state,payerPostalCode:item.postal_code,payerUnit:item.unit},integration);
      const invoice=await query<any>(`insert into invoices(id,condominium_id,user_id,amount_cents,due_date,reference_month,batch_id,status,provider,external_id,digitable_line,pdf_url,condo_fee_percent,condo_fee_cents,improvement_fee_percent,improvement_fee_cents,condo_base_fee_cents) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,[randomUUID(),condominiumId,item.user_id,amountCents,item.due_date,batch.reference_month,batch.id,boleto.status==='issued'?'issued':'pending_provider',boleto.provider,boleto.externalId,boleto.digitableLine,boleto.pdfUrl,condoFeeCents!==null?condoFeePercent:null,condoFeeCents,improvementFeeCents!==null?improvementFeePercent:null,improvementFeeCents,condoBaseFeeCents]);
      await query(`update billing_batch_items set status='issued',invoice_id=$1,amount_cents=$2,issues='[]'::jsonb where id=$3`,[invoice.rows[0].id,amountCents,item.id]);
      await query(`update inter_issuance_guards set invoice_id=$1,reservation_key=null where payer_cpf=$2 and reservation_key=$3`,[invoice.rows[0].id,payerCpf,reservationKey]);
      if(!hasOverride&&extra?.installmentIds.length) await query(`update unit_extra_charge_installments set status='applied',invoice_id=$1,applied_at=now() where id=any($2::uuid[])`,[invoice.rows[0].id,extra.installmentIds]);
      if(!hasOverride&&consumption?.chargeIds.length) await query(`update unit_consumption_charges set status='applied',invoice_id=$1,applied_at=now() where id=any($2::uuid[])`,[invoice.rows[0].id,consumption.chargeIds]);
      await notifyNewInvoice({id:invoice.rows[0].id,condominiumId:condominiumId!,userId:item.user_id,amountCents,dueDate:item.due_date});
      issued+=1;
    }catch(error:any){failed+=1;if(reservationKey)await query(`delete from inter_issuance_guards where payer_cpf=$1 and reservation_key=$2 and invoice_id is null`,[String(item.cpf).replace(/\D/g,''),reservationKey]);const reason=issuanceErrorMessage(error);console.error('Falha na emissão do item do lote',{batchId:batch.id,itemId:item.id,code:error?.code||null,reason});failures.push({payerName:item.full_name||item.username||item.payer_name,reason});await query(`update billing_batch_items set status='failed',issues=$1 where id=$2`,[JSON.stringify([reason]),item.id]);}
  }
  const status=failed===0?'completed':issued===0?'partial':'partial';
  await query(`update billing_batches set status=$1 where id=$2`,[status,batch.id]);
  await query(`insert into billing_audit_events(id,condominium_id,batch_id,actor_id,event_type,details) values($1,$2,$3,$4,'bank_issuance_finished',$5)`,[randomUUID(),condominiumId,batch.id,req.user?.id,JSON.stringify({issued,failed})]);
  await logAudit(req, 'config_enviar_cobrancas', 'issued', `Emitiu boletos do lote ${batch.id}: ${issued} com sucesso, ${failed} com falha`, { entityId: batch.id });
  const message=failed===0
    ? `${issued===1?'Boleto emitido':'Boletos emitidos'} com sucesso: ${issued}.`
    : issued===0
      ? `Nenhum boleto foi emitido. ${failures.map(item=>`${item.payerName}: ${item.reason}`).join(' | ')}`
      : `${issued} emitido(s) com sucesso e ${failed} com falha. ${failures.map(item=>`${item.payerName}: ${item.reason}`).join(' | ')}`;
  return res.json({message,issued,failed,status,failures});
}));

router.get('/batches/:id/export', asyncHandler(async (req,res)=>{
  const batch=await query<any>(`select b.*,c.name condominium_name,c.cnpj condominium_cnpj
    from billing_batches b join condominiums c on c.id=b.condominium_id
    where b.id=$1 and b.condominium_id=$2`,[req.params.id,req.user?.condominiumId]);
  if(!batch.rows[0]) return res.status(404).json({message:'Lote não encontrado.'});
  const items=await query<any>(`select bi.*,u.email,u.phone,u.street,u.address_number,u.address_complement,u.neighborhood,u.city,u.state,u.postal_code from billing_batch_items bi left join users u on u.id=bi.user_id where bi.batch_id=$1 order by bi.source_row`,[req.params.id]);
  const settings=await query<any>(`select * from billing_settings where condominium_id=$1`,[req.user?.condominiumId]);
  const buffer=await createBillingTemplateWorkbook({batchId:batch.rows[0].id,referenceMonth:batch.rows[0].reference_month,
    description:batch.rows[0].description,beneficiaryName:batch.rows[0].condominium_name,
    beneficiaryDocument:batch.rows[0].condominium_cnpj,
    settings:settings.rows[0]||null,items:items.rows});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="lote-${req.params.id}.xlsx"`);
  return res.send(buffer);
}));

export default router;
