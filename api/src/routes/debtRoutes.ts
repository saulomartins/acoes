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
  const userId=manager?String(req.query.userId||''):req.user?.id;
  if(!userId)return res.status(400).json({message:'Selecione uma pessoa para consultar os débitos.'});
  const asOf=String(req.query.asOf||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))return res.status(400).json({message:'Data de atualização inválida.'});
  const person=await query<any>(`select id,full_name,username,cpf,unit from users where id=$1 and condominium_id=$2`,[userId,condominiumId]);
  if(!person.rows[0])return res.status(404).json({message:'Pessoa não encontrada neste condomínio.'});
  const invoices=await query<any>(`select id,amount_cents,due_date,reference_month,status,paid_at,paid_amount_cents,digitable_line
    from invoices where user_id=$1 and condominium_id=$2 and status<>'canceled'::invoice_status
    order by coalesce(reference_month,due_date),due_date`,[userId,condominiumId]);
  const rows=invoices.rows.map((invoice:any)=>{const dueDate=isoDate(invoice.due_date);const open=!['paid','canceled'].includes(invoice.status);const daysLate=open&&dueDate<asOf?daysBetween(dueDate,asOf):0;const principal=Number(invoice.amount_cents);const fine=daysLate>0?Math.round(principal*0.02):0;const interest=daysLate>0?Math.round(principal*0.000333*daysLate):0;return {id:invoice.id,referenceMonth:isoDate(invoice.reference_month||invoice.due_date).slice(0,7),principalCents:principal,dueDate,daysLate,status:invoice.status,fineCents:fine,interestCents:interest,updatedTotalCents:principal+fine+interest,open,paidAt:invoice.paid_at,paidAmountCents:invoice.paid_amount_cents,digitableLine:invoice.digitable_line}});
  const openRows=rows.filter((row:any)=>row.open);const totals={principalCents:openRows.reduce((sum:number,row:any)=>sum+row.principalCents,0),fineCents:openRows.reduce((sum:number,row:any)=>sum+row.fineCents,0),interestCents:openRows.reduce((sum:number,row:any)=>sum+row.interestCents,0),updatedTotalCents:openRows.reduce((sum:number,row:any)=>sum+row.updatedTotalCents,0),openCount:openRows.length};
  return res.json({person:{...person.rows[0],cpf:digits(person.rows[0].cpf)},asOf,rules:{finePercent:2,dailyInterestPercent:0.0333,legalBasis:'26ª cláusula da Convenção do Condomínio'},rows,totals});
}));

export default router;
