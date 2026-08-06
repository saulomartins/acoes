import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { getBillingRules, calculateLateFee, dailyInterestPercent } from '../services/lateFeeService';
import { logAudit } from '../services/auditService';
import { getOwnedUnitIds } from '../services/unitOwnershipService';

const router=Router();
router.use(authenticate);
router.use(requireFeature('gestao_debitos'));
const digits=(value:unknown)=>String(value??'').replace(/\D/g,'');
const isoDate=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
const daysBetween=(from:string,to:string)=>Math.max(0,Math.floor((Date.parse(`${to}T12:00:00Z`)-Date.parse(`${from}T12:00:00Z`))/86400000));
const isValidDate=(value:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
};

router.get('/',asyncHandler(async(req,res)=>{
  const condominiumId=req.user?.condominiumId;
  if(!condominiumId)return res.status(400).json({message:'Condomínio obrigatório.'});
  const manager=['sindico','subsindico'].includes(req.user?.role||'');
  const requestedUserId=req.query.userId?String(req.query.userId):null;
  let userId=manager?requestedUserId:req.user?.id;
  // Não-gestor: além do próprio débito, inclui de cara o débito de quem mora
  // em unidade que ele possui (unit_ownerships) — mesma visão somente leitura
  // já aplicada em /invoices, sem precisar pedir explicitamente por ?userId.
  let extraUserIds:string[]=[];
  if(!manager){
    const ownedUnitIds=await getOwnedUnitIds(req.user!.id);
    if(ownedUnitIds.length){
      const residents=await query<{id:string}>(`select id from users where unit_id=any($1::uuid[]) and condominium_id=$2 and id<>$3`,[ownedUnitIds,condominiumId,req.user!.id]);
      extraUserIds=residents.rows.map(row=>row.id);
    }
    // Pedido explícito de outra pessoa (ex.: link direto): só permitido se a
    // unidade dela estiver entre as unidades que o solicitante possui.
    if(requestedUserId&&requestedUserId!==req.user?.id){
      const target=await query<{unit_id:string|null}>(`select unit_id from users where id=$1 and condominium_id=$2`,[requestedUserId,condominiumId]);
      if(target.rows[0]?.unit_id&&ownedUnitIds.includes(target.rows[0].unit_id)) userId=requestedUserId;
    }
  }
  const userIds=userId?[userId,...extraUserIds]:null;
  const asOf=String(req.query.asOf||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))return res.status(400).json({message:'Data de atualização inválida.'});

  let person:any;
  if(userId){
    const result=await query<any>(`select id,full_name,username,cpf,unit from users where id=$1 and condominium_id=$2`,[userId,condominiumId]);
    if(!result.rows[0])return res.status(404).json({message:'Pessoa não encontrada neste condomínio.'});
    person=result.rows[0];
  }else{
    const result=await query<any>(`select id,name from condominiums where id=$1`,[condominiumId]);
    if(!result.rows[0])return res.status(404).json({message:'Condomínio não encontrado.'});
    person={id:result.rows[0].id,full_name:result.rows[0].name,username:result.rows[0].name,cpf:'',unit:null};
  }

  const rules=await getBillingRules(condominiumId);
  const invoices=await query<any>(`select i.id,i.user_id,i.amount_cents,i.due_date,i.reference_month,i.status,i.paid_at,i.paid_amount_cents,i.digitable_line,
      i.invoice_type,i.negotiation_type,i.judicial_process_number,i.external_id,
      u.role payer_role,
      coalesce(u.full_name,u.username) payer_name,
      coalesce(nullif(concat_ws(' - ',nullif(b.name,''),nullif(un.number,'')),''),nullif(u.unit,''),'Sem apartamento') payer_unit,
      ai.fine_cents frozen_fine_cents,ai.interest_cents frozen_interest_cents,ai.frozen_total_cents,
      (a.id is not null) frozen_by_agreement,
      exists(select 1 from debt_agreement_items x where x.invoice_id=i.id) in_agreement,
      coalesce((select jsonb_agg(jsonb_build_object('id',adj.id,'type',adj.type,'amountCents',adj.amount_cents,'previousAmountCents',adj.previous_amount_cents,'previousDueDate',adj.previous_due_date,'previousStatus',adj.previous_status,'reason',adj.reason,'createdAt',adj.created_at,'createdBy',coalesce(cu.full_name,cu.username)) order by adj.created_at desc) from invoice_adjustments adj left join users cu on cu.id=adj.created_by where adj.invoice_id=i.id),'[]') adjustments
    from invoices i join users u on u.id=i.user_id
    left join units un on un.id=u.unit_id
    left join blocks b on b.id=un.block_id
    left join debt_agreement_items ai on ai.invoice_id=i.id and exists(select 1 from debt_agreements active_agreement where active_agreement.id=ai.agreement_id and active_agreement.status in ('accepted','active','at_risk'))
    left join debt_agreements a on a.id=ai.agreement_id
    where ($1::uuid[] is null or i.user_id=any($1::uuid[])) and i.condominium_id=$2 and i.status<>'canceled'::invoice_status and i.invoice_type in ('regular','legacy') and i.deleted_at is null
    order by coalesce(i.reference_month,i.due_date),i.due_date,coalesce(u.full_name,u.username)`,[userIds,condominiumId]);
  const rows=invoices.rows.map((invoice:any)=>{const dueDate=isoDate(invoice.due_date);const open=!['paid','canceled'].includes(invoice.status);const daysLate=open&&dueDate<asOf?daysBetween(dueDate,asOf):0;const principal=Number(invoice.amount_cents);const{fineCents:fine,interestCents:interest}=invoice.frozen_by_agreement?{fineCents:Number(invoice.frozen_fine_cents),interestCents:Number(invoice.frozen_interest_cents)}:calculateLateFee(rules,principal,daysLate);return {id:invoice.id,payerId:invoice.user_id,referenceMonth:isoDate(invoice.reference_month||invoice.due_date).slice(0,7),principalCents:principal,dueDate,daysLate,status:invoice.status,fineCents:fine,interestCents:interest,updatedTotalCents:invoice.frozen_by_agreement?Number(invoice.frozen_total_cents):principal+fine+interest,frozenByAgreement:Boolean(invoice.frozen_by_agreement),open,paidAt:invoice.paid_at,paidAmountCents:invoice.paid_amount_cents,digitableLine:invoice.digitable_line,payerName:invoice.payer_name,payerUnit:invoice.payer_unit,payerRole:invoice.payer_role,invoiceType:invoice.invoice_type,negotiationType:invoice.negotiation_type,judicialProcessNumber:invoice.judicial_process_number,externalId:invoice.external_id,inAgreement:Boolean(invoice.in_agreement),adjustments:invoice.adjustments,ownedElsewhere:extraUserIds.includes(invoice.user_id)}});
  const openRows=rows.filter((row:any)=>row.open);
  const totals={principalCents:openRows.reduce((sum:number,row:any)=>sum+row.principalCents,0),fineCents:openRows.reduce((sum:number,row:any)=>sum+row.fineCents,0),interestCents:openRows.reduce((sum:number,row:any)=>sum+row.interestCents,0),updatedTotalCents:openRows.reduce((sum:number,row:any)=>sum+row.updatedTotalCents,0),openCount:openRows.length};
  return res.json({scope:userId?'person':'condominium',person:{...person,cpf:digits(person.cpf)},asOf,rules:{finePercent:rules.fineType==='PERCENT'?rules.fineValue:0,fineType:rules.fineType,fineValue:rules.fineValue,dailyInterestPercent:dailyInterestPercent(rules),interestType:rules.interestType,interestValue:rules.interestValue,legalBasis:'Configuração de multa e mora do condomínio'},rows,totals});
}));

// Edição total de um débito: valor, vencimento, observação, ou marcar como
// pago retroativamente (ex.: débito antigo que já tinha sido pago antes de
// entrar no sistema). Valor/vencimento só são editáveis enquanto o boleto
// nunca foi emitido no banco (external_id nulo) — depois disso a fonte da
// verdade é o Inter, e alterar aqui desincronizaria do boleto real.
router.patch('/:id', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const invoiceId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Informe o motivo da edição.' });

  const result = await query<any>(`select * from invoices where id=$1 and condominium_id=$2 and deleted_at is null`, [invoiceId, condominiumId]);
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Débito não encontrado.' });

  const hasAmountOrDueDateChange = req.body?.amountCents !== undefined || req.body?.dueDate !== undefined;
  if (hasAmountOrDueDateChange && invoice.external_id) {
    return res.status(409).json({ message: 'Este débito já foi emitido no banco; não é possível alterar valor ou vencimento manualmente. Cancele o boleto no banco antes de editar.' });
  }

  const nextAmountCents = req.body?.amountCents !== undefined ? Math.round(Number(req.body.amountCents)) : Number(invoice.amount_cents);
  if (!Number.isInteger(nextAmountCents) || nextAmountCents <= 0) return res.status(400).json({ message: 'Informe um valor de débito válido.' });
  const nextDueDate = req.body?.dueDate !== undefined ? String(req.body.dueDate) : isoDate(invoice.due_date);
  if (!isValidDate(nextDueDate)) return res.status(400).json({ message: 'Informe uma data de vencimento válida.' });
  const nextNotes = req.body?.notes !== undefined ? (String(req.body.notes).trim() || null) : invoice.notes;

  const markPaid = req.body?.markPaid === true;
  if (markPaid && !isValidDate(String(req.body?.paidAt || ''))) {
    return res.status(400).json({ message: 'Informe a data em que o débito foi pago.' });
  }

  const updated = await withTransaction(async client => {
    const row = await client.query<any>(
      `update invoices set amount_cents=$1,due_date=$2,notes=$3,
         status=case when $4 then 'paid'::invoice_status else status end,
         paid_at=case when $4 then $5::timestamptz else paid_at end,
         paid_amount_cents=case when $4 then $1 else paid_amount_cents end
       where id=$6 returning *`,
      [nextAmountCents, nextDueDate, nextNotes, markPaid, markPaid ? `${req.body.paidAt}T12:00:00Z` : null, invoiceId],
    );
    await client.query(
      `insert into invoice_adjustments(invoice_id,condominium_id,type,amount_cents,previous_amount_cents,previous_due_date,previous_status,reason,created_by)
       values($1,$2,'edit',$3,$4,$5,$6,$7,$8)`,
      [invoiceId, condominiumId, nextAmountCents, invoice.amount_cents, invoice.due_date, invoice.status, reason, req.user?.id],
    );
    return row.rows[0];
  });

  await logAudit(req, 'gestao_debitos', 'updated', `Editou um débito: ${reason}`, { entityId: invoiceId });
  return res.json({ invoice: updated, message: 'Débito atualizado.' });
}));

// Pagamento parcial: reduz o saldo em aberto de um débito sem quitá-lo por
// completo (ex.: parte foi paga por fora, antes de entrar no sistema). Se o
// pagamento cobre o saldo inteiro, o débito é quitado automaticamente.
router.post('/:id/partial-payment', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const invoiceId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();
  const paidAt = String(req.body?.paidAt || '');
  const paymentAmountCents = Math.round(Number(req.body?.amountCents));
  if (!reason) return res.status(400).json({ message: 'Informe o motivo do pagamento parcial.' });
  if (!isValidDate(paidAt)) return res.status(400).json({ message: 'Informe a data do pagamento.' });
  if (!Number.isInteger(paymentAmountCents) || paymentAmountCents <= 0) return res.status(400).json({ message: 'Informe um valor de pagamento válido.' });

  const result = await query<any>(`select * from invoices where id=$1 and condominium_id=$2 and deleted_at is null`, [invoiceId, condominiumId]);
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Débito não encontrado.' });
  if (['paid', 'canceled'].includes(invoice.status)) return res.status(409).json({ message: 'Este débito já está quitado/cancelado.' });
  if (paymentAmountCents > Number(invoice.amount_cents)) return res.status(400).json({ message: 'O valor pago não pode ser maior que o saldo em aberto.' });

  const remaining = Number(invoice.amount_cents) - paymentAmountCents;
  const settles = remaining === 0;

  const updated = await withTransaction(async client => {
    const row = await client.query<any>(
      `update invoices set amount_cents=$1,
         status=case when $2 then 'paid'::invoice_status else status end,
         paid_at=case when $2 then $3::timestamptz else paid_at end,
         paid_amount_cents=case when $2 then $1 else paid_amount_cents end
       where id=$4 returning *`,
      [settles ? invoice.amount_cents : remaining, settles, `${paidAt}T12:00:00Z`, invoiceId],
    );
    await client.query(
      `insert into invoice_adjustments(invoice_id,condominium_id,type,amount_cents,previous_amount_cents,previous_due_date,previous_status,reason,created_by)
       values($1,$2,'partial_payment',$3,$4,$5,$6,$7,$8)`,
      [invoiceId, condominiumId, paymentAmountCents, invoice.amount_cents, invoice.due_date, invoice.status, reason, req.user?.id],
    );
    return row.rows[0];
  });

  await logAudit(req, 'gestao_debitos', 'partial_payment', `Registrou pagamento de R$ ${(paymentAmountCents / 100).toFixed(2)} em um débito`, { entityId: invoiceId });
  return res.json({ invoice: updated, message: settles ? 'Pagamento registrado e débito quitado.' : 'Pagamento parcial registrado.' });
}));

// Exclusão total (soft-delete) de um débito lançado por engano ou duplicado.
// Só permitida quando não há boleto em aberto (já pago ou já cancelado) e
// quando o débito não está congelado dentro de um acordo.
router.delete('/:id', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const invoiceId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Informe o motivo da exclusão.' });

  const result = await query<any>(`select * from invoices where id=$1 and condominium_id=$2 and deleted_at is null`, [invoiceId, condominiumId]);
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Débito não encontrado.' });
  if (!['paid', 'canceled'].includes(invoice.status)) {
    return res.status(409).json({ message: 'Não é possível excluir: este débito ainda tem boleto em aberto. Quite, cancele ou registre o pagamento antes de excluir.' });
  }
  const inAgreement = await query<any>(`select 1 from debt_agreement_items where invoice_id=$1`, [invoiceId]);
  if (inAgreement.rows.length) {
    return res.status(409).json({ message: 'Este débito está incluído em um acordo. Remova-o do acordo antes de excluí-lo.' });
  }

  await withTransaction(async client => {
    await client.query(`update invoices set deleted_at=now(),deleted_by=$1,deletion_reason=$2 where id=$3`, [req.user?.id, reason, invoiceId]);
    await client.query(
      `insert into invoice_adjustments(invoice_id,condominium_id,type,previous_amount_cents,previous_due_date,previous_status,reason,created_by)
       values($1,$2,'delete',$3,$4,$5,$6,$7)`,
      [invoiceId, condominiumId, invoice.amount_cents, invoice.due_date, invoice.status, reason, req.user?.id],
    );
  });

  await logAudit(req, 'gestao_debitos', 'deleted', `Excluiu um débito: ${reason}`, { entityId: invoiceId });
  return res.json({ message: 'Débito excluído.' });
}));

export default router;
