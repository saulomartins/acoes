import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';

const router=Router();
router.use(authenticate);
const digits=(value:unknown)=>String(value??'').replace(/\D/g,'');
const isoDate=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);
const daysBetween=(from:string,to:string)=>Math.max(0,Math.floor((Date.parse(`${to}T12:00:00Z`)-Date.parse(`${from}T12:00:00Z`))/86400000));

router.get('/',asyncHandler(async(req,res)=>{
  const condominiumId=req.user?.condominiumId;
  if(!condominiumId)return res.status(400).json({message:'Condomínio obrigatório.'});
  const manager=['sindico','subsindico'].includes(req.user?.role||'');
  const userId=manager?(req.query.userId?String(req.query.userId):null):req.user?.id;
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

  const invoices=await query<any>(`select i.id,i.user_id,i.amount_cents,i.due_date,i.reference_month,i.status,i.paid_at,i.paid_amount_cents,i.digitable_line,
      coalesce(u.full_name,u.username) payer_name,
      coalesce(nullif(concat_ws(' - ',nullif(b.name,''),nullif(un.number,'')),''),nullif(u.unit,''),'Sem apartamento') payer_unit,
      ai.fine_cents frozen_fine_cents,ai.interest_cents frozen_interest_cents,ai.frozen_total_cents,
      (a.id is not null) frozen_by_agreement
    from invoices i join users u on u.id=i.user_id
    left join units un on un.id=u.unit_id
    left join blocks b on b.id=un.block_id
    left join debt_agreement_items ai on ai.invoice_id=i.id and exists(select 1 from debt_agreements active_agreement where active_agreement.id=ai.agreement_id and active_agreement.status in ('accepted','active','at_risk'))
    left join debt_agreements a on a.id=ai.agreement_id
    where ($1::uuid is null or i.user_id=$1) and i.condominium_id=$2 and i.status<>'canceled'::invoice_status and i.invoice_type='regular'
    order by coalesce(i.reference_month,i.due_date),i.due_date,coalesce(u.full_name,u.username)`,[userId,condominiumId]);
  const rows=invoices.rows.map((invoice:any)=>{const dueDate=isoDate(invoice.due_date);const open=!['paid','canceled'].includes(invoice.status);const daysLate=open&&dueDate<asOf?daysBetween(dueDate,asOf):0;const principal=Number(invoice.amount_cents);const fine=invoice.frozen_by_agreement?Number(invoice.frozen_fine_cents):daysLate>0?Math.round(principal*0.02):0;const interest=invoice.frozen_by_agreement?Number(invoice.frozen_interest_cents):daysLate>0?Math.round(principal*0.000333*daysLate):0;return {id:invoice.id,payerId:invoice.user_id,referenceMonth:isoDate(invoice.reference_month||invoice.due_date).slice(0,7),principalCents:principal,dueDate,daysLate,status:invoice.status,fineCents:fine,interestCents:interest,updatedTotalCents:invoice.frozen_by_agreement?Number(invoice.frozen_total_cents):principal+fine+interest,frozenByAgreement:Boolean(invoice.frozen_by_agreement),open,paidAt:invoice.paid_at,paidAmountCents:invoice.paid_amount_cents,digitableLine:invoice.digitable_line,payerName:invoice.payer_name,payerUnit:invoice.payer_unit}});
  const openRows=rows.filter((row:any)=>row.open);
  const totals={principalCents:openRows.reduce((sum:number,row:any)=>sum+row.principalCents,0),fineCents:openRows.reduce((sum:number,row:any)=>sum+row.fineCents,0),interestCents:openRows.reduce((sum:number,row:any)=>sum+row.interestCents,0),updatedTotalCents:openRows.reduce((sum:number,row:any)=>sum+row.updatedTotalCents,0),openCount:openRows.length};
  return res.json({scope:userId?'person':'condominium',person:{...person,cpf:digits(person.cpf)},asOf,rules:{finePercent:2,dailyInterestPercent:0.0333,legalBasis:'26ª cláusula da Convenção do Condomínio'},rows,totals});
}));

export default router;
