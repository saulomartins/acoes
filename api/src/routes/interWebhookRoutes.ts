import { randomUUID, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { mapInterStatus } from '../services/interService';

const router = Router();
const safeEqual = (received:string,expected:string) => {
  const a=Buffer.from(received); const b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
};

router.post('/:secret', asyncHandler(async (req,res)=>{
  const expected=process.env.INTER_WEBHOOK_SECRET || '';
  if(!expected || !safeEqual(String(req.params.secret||''),expected)) return res.status(404).end();
  const callbacks=Array.isArray(req.body)?req.body:[req.body];
  let updated=0;
  for(const callback of callbacks){
    const externalId=String(callback?.codigoSolicitacao||'');
    if(!externalId) continue;
    const status=mapInterStatus(String(callback.situacao||''));
    const paidCents=status==='paid'?Math.round(Number(String(callback.valorTotalRecebido||'0').replace(',','.'))*100):null;
    const result=await query<any>(
      `update invoices set status=$1,digitable_line=coalesce($2,digitable_line),barcode=coalesce($3,barcode),
       pix_copy_paste=coalesce($4,pix_copy_paste),paid_at=case when $1='paid' then coalesce(paid_at,now()) else paid_at end,
       paid_amount_cents=coalesce($5,paid_amount_cents) where external_id=$6 returning id`,
      [status,callback.linhaDigitavel||null,callback.codigoBarras||null,callback.pixCopiaECola||null,paidCents,externalId]);
    if(result.rows[0]){
      updated++;
      await query(`insert into invoice_events(id,invoice_id,event_type,provider_status,details) values($1,$2,'inter_webhook',$3,$4)`,[randomUUID(),result.rows[0].id,callback.situacao||null,JSON.stringify(callback)]);
    }
  }
  return res.status(200).json({received:callbacks.length,updated});
}));

export default router;
