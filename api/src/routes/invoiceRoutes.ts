import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { createInterBoleto, getInterBoleto, getInterBoletoPdf, type InterIntegrationConfig } from '../services/interService';

const router = Router();

router.use(authenticate);

type InterIntegrationRow = {
  id: string;
  client_id: string;
  client_secret: string;
  cert_path: string;
  key_path: string;
  cert_passphrase: string | null;
  base_url: string;
  token_path: string;
  scopes: string;
  enabled: boolean;
};

export const getInterIntegration = async (condominiumId: string): Promise<InterIntegrationConfig | null> => {
  const result = await query<InterIntegrationRow>(
    `select b.id, b.client_id, b.client_secret, b.cert_path, b.key_path, b.cert_passphrase,
            b.base_url, b.token_path, b.scopes, b.enabled
     from condominium_bank_configurations cb
     join bank_configurations b on b.id = cb.bank_configuration_id
     where cb.condominium_id = $1 and b.provider = 'inter'`,
    [condominiumId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    certPath: row.cert_path,
    keyPath: row.key_path,
    certPassphrase: row.cert_passphrase,
    baseUrl: row.base_url,
    tokenPath: row.token_path,
    scopes: row.scopes,
    enabled: row.enabled,
  };
};

const syncInterInvoice = async (invoice: { id:string; condominium_id:string; external_id:string }) => {
  const integration=await getInterIntegration(invoice.condominium_id);
  if(!integration) throw new Error('Integração Banco Inter não configurada.');
  const inter=await getInterBoleto(invoice.external_id,integration);
  const statusMap:Record<string,string>={RECEBIDO:'paid',A_RECEBER:'issued',ATRASADO:'overdue',CANCELADO:'canceled',EXPIRADO:'canceled'};
  const status=statusMap[inter.cobranca.situacao]||'pending_provider';
  const paidAt=status==='paid'?(inter.cobranca.dataSituacao||new Date().toISOString()):null;
  const providerDueDate=/^\d{4}-\d{2}-\d{2}$/.test(inter.cobranca.dataVencimento||'')?inter.cobranca.dataVencimento:null;
  const updated=await query(`update invoices set status=$1,digitable_line=$2,pdf_url=$3,barcode=$4,pix_copy_paste=$5,
    due_date=coalesce($6::date,due_date),paid_at=coalesce(paid_at,$7),
    paid_amount_cents=case when $1::invoice_status='paid'::invoice_status then amount_cents else paid_amount_cents end
    where id=$8 returning *`,[status,inter.boleto?.linhaDigitavel||null,`/cobranca/v3/cobrancas/${invoice.external_id}/pdf`,inter.boleto?.codigoBarras||null,inter.pix?.pixCopiaECola||null,providerDueDate,paidAt,invoice.id]);
  await query(`insert into invoice_events(id,invoice_id,event_type,provider_status,details) values($1,$2,'provider_sync',$3,$4)`,[randomUUID(),invoice.id,inter.cobranca.situacao,JSON.stringify(inter)]);
  return {invoice:updated.rows[0],inter};
};

router.get('/', asyncHandler(async (req, res) => {
  const { userId, condominiumId, status } = req.query;
  const scopedUserId = req.user?.role === 'proprietario' || req.user?.role === 'inquilino' ? req.user.id : userId;
  const scopedCondominiumId = req.user?.role === 'admin_geral'
    ? condominiumId || null
    : req.user?.condominiumId;

  await query(`update invoices set status='overdue'::invoice_status
    where status in ('pending_provider'::invoice_status,'issued'::invoice_status) and due_date < current_date`);

  const result = await query(
    `select invoices.id, invoices.condominium_id, invoices.user_id,
            invoices.amount_cents, invoices.due_date, invoices.status, invoices.provider,
            invoices.external_id, invoices.digitable_line, invoices.pdf_url, invoices.created_at,
            invoices.barcode, invoices.pix_copy_paste, invoices.paid_at, invoices.paid_amount_cents, invoices.batch_id,
            invoices.reference_month,
            users.username as user_username,
            users.full_name as user_full_name
     from invoices
     join users on users.id = invoices.user_id
     where ($1::uuid is null or invoices.user_id = $1)
       and ($2::uuid is null or invoices.condominium_id = $2)
       and ($3::text is null or invoices.status = $3::invoice_status)
     order by invoices.due_date desc, invoices.created_at desc`,
    [scopedUserId || null, scopedCondominiumId || null, status || null],
  );

  return res.json({ invoices: result.rows });
}));

router.post('/', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const { userId, dueDate, description } = req.body ?? {};
  const targetCondominiumId = req.user?.condominiumId;

  if (!userId || !dueDate) {
    return res.status(400).json({ message: 'userId and dueDate are required' });
  }

  if (!targetCondominiumId) {
    return res.status(400).json({ message: 'condominiumId is required' });
  }

  const userResult = await query<{
    id: string; full_name: string | null; username: string; cpf: string | null; email: string | null; phone: string | null;
    unit: string | null; street: string | null; address_number: string | null; address_complement: string | null;
    neighborhood: string | null; city: string | null; state: string | null; postal_code: string | null;
    fee_cents: number | null; unit_type_name: string | null; billing_exempt: boolean;
  }>(
    `select users.id, users.full_name, users.username, users.cpf, users.email, users.phone, users.unit, users.billing_exempt,
            users.street, users.address_number, users.address_complement, users.neighborhood, users.city,
            users.state, users.postal_code, unit_types.fee_cents, unit_types.name as unit_type_name
     from users left join units on units.id = users.unit_id left join unit_types on unit_types.id = units.unit_type_id
     where users.id = $1 and users.condominium_id = $2`,
    [userId, targetCondominiumId],
  );
  const payer = userResult.rows[0];
  if (!payer) {
    return res.status(404).json({ message: 'user not found for condominium' });
  }
  if (payer.billing_exempt) return res.status(400).json({ message: 'Esta pessoa está isenta da geração de boleto.' });
  if (!payer.fee_cents) return res.status(400).json({ message: 'Morador sem tipologia ou valor condominial configurado.' });
  if (!payer.cpf || !payer.full_name) return res.status(400).json({ message: 'Morador precisa ter nome completo e CPF.' });
  if (!payer.street || !payer.address_number || !payer.neighborhood || !payer.city || !payer.state || !payer.postal_code) {
    return res.status(400).json({ message: 'Complete o endereço do morador antes de emitir a cobrança.' });
  }

  const payerCpf = payer.cpf.replace(/\D/g, '');
  const allowedCpf = (process.env.INTER_ISSUANCE_ALLOWED_CPF || '').replace(/\D/g, '');
  if (!allowedCpf || payerCpf !== allowedCpf) {
    return res.status(403).json({ message: 'Emissão Inter bloqueada: CPF não autorizado para o teste de produção.' });
  }

  // Reserve before contacting Inter. The primary key makes this atomic and
  // protects against double clicks and concurrent requests.
  try {
    await query(
      `insert into inter_issuance_guards (payer_cpf, user_id) values ($1, $2)`,
      [payerCpf, payer.id],
    );
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Emissão bloqueada: este CPF já utilizou a autorização única de boleto.' });
    }
    throw error;
  }

  const integration = await getInterIntegration(targetCondominiumId);
  const boleto = await createInterBoleto(
    {
      payerName: payer.full_name || payer.username,
      payerDocument: payer.cpf,
      amountCents: payer.fee_cents,
      dueDate,
      description: description || `Taxa condominial - ${payer.unit_type_name || payer.unit || 'unidade'}`,
      payerEmail: payer.email,
      payerPhone: payer.phone,
      payerStreet: payer.street,
      payerNumber: payer.address_number,
      payerComplement: payer.address_complement,
      payerNeighborhood: payer.neighborhood,
      payerCity: payer.city,
      payerState: payer.state,
      payerPostalCode: payer.postal_code,
      payerUnit: payer.unit,
    },
    integration,
  );

  const result = await query(
    `insert into invoices (
       id, condominium_id, user_id, amount_cents, due_date, status,
       provider, external_id, digitable_line, pdf_url
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id, condominium_id, user_id, amount_cents, due_date, status,
               provider, external_id, digitable_line, pdf_url, created_at`,
    [
      randomUUID(),
      targetCondominiumId,
      userId,
      payer.fee_cents,
      dueDate,
      boleto.status === 'issued' ? 'issued' : 'pending_provider',
      boleto.provider,
      boleto.externalId,
      boleto.digitableLine,
      boleto.pdfUrl,
    ],
  );

  await query(
    `update inter_issuance_guards set invoice_id = $1 where payer_cpf = $2`,
    [result.rows[0].id, payerCpf],
  );

  return res.status(201).json({ invoice: result.rows[0], provider: boleto });
}));

router.post('/sync-all', authorize('sindico', 'subsindico'), asyncHandler(async (req,res)=>{
  const invoices=await query<{id:string;condominium_id:string;external_id:string;user_full_name:string|null;user_username:string}>(`select i.id,i.condominium_id,i.external_id,u.full_name user_full_name,u.username user_username
    from invoices i join users u on u.id=i.user_id
    where i.condominium_id=$1 and i.external_id is not null and i.status<>'canceled'::invoice_status
    order by i.due_date desc`,[req.user?.condominiumId]);
  let updated=0;const failures:Array<{payerName:string;reason:string}>=[];
  for(const invoice of invoices.rows){try{await syncInterInvoice(invoice);updated+=1}catch(error:any){failures.push({payerName:invoice.user_full_name||invoice.user_username,reason:error?.message||'Falha ao consultar o Banco Inter.'})}}
  const message=failures.length===0?`${updated} cobrança(s) atualizada(s) com sucesso.`:`${updated} cobrança(s) atualizada(s) e ${failures.length} com falha. ${failures.map(item=>`${item.payerName}: ${item.reason}`).join(' | ')}`;
  return res.json({updated,failed:failures.length,failures,message});
}));

router.post('/:id/sync', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const result = await query<{ id: string; condominium_id: string; external_id: string | null }>(
    `select id, condominium_id, external_id from invoices where id = $1 and condominium_id = $2`,
    [req.params.id, req.user?.condominiumId],
  );
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Cobrança não encontrada.' });
  if (!invoice.external_id) return res.status(400).json({ message: 'Cobrança ainda não possui código do Banco Inter.' });

  return res.json(await syncInterInvoice(invoice as {id:string;condominium_id:string;external_id:string}));
}));

router.get('/:id/pix', asyncHandler(async(req,res)=>{
  const result=await query<any>(`select id,condominium_id,user_id,external_id,status,pix_copy_paste from invoices where id=$1 and condominium_id=$2`,[req.params.id,req.user?.condominiumId]);
  let invoice=result.rows[0];
  if(!invoice)return res.status(404).json({message:'Boleto não encontrado.'});
  if(['proprietario','inquilino'].includes(req.user?.role||'')&&invoice.user_id!==req.user?.id)return res.status(403).json({message:'Você não pode acessar o Pix deste boleto.'});
  if(['paid','canceled'].includes(invoice.status))return res.status(409).json({message:invoice.status==='paid'?'Este boleto já foi pago.':'Este boleto foi cancelado.'});
  if(!invoice.external_id)return res.status(409).json({message:'O Banco Inter ainda não disponibilizou o Pix desta cobrança.'});
  if(!invoice.pix_copy_paste){const synced=await syncInterInvoice(invoice);invoice=synced.invoice;}
  if(!invoice.pix_copy_paste)return res.status(409).json({message:'O Banco Inter ainda não retornou o código Pix. Atualize a cobrança e tente novamente.'});
  return res.json({pixCopyPaste:invoice.pix_copy_paste});
}));

router.get('/:id/pdf', asyncHandler(async(req,res)=>{
  const invoice=await query<any>(`select i.id,i.condominium_id,i.user_id,i.external_id,i.status,u.full_name,u.username
    from invoices i join users u on u.id=i.user_id where i.id=$1 and i.condominium_id=$2`,[req.params.id,req.user?.condominiumId]);
  const row=invoice.rows[0];if(!row)return res.status(404).json({message:'Boleto não encontrado.'});
  if(['proprietario','inquilino'].includes(req.user?.role||'')&&row.user_id!==req.user?.id)return res.status(403).json({message:'Você não pode acessar este boleto.'});
  if(row.status==='canceled')return res.status(409).json({message:'Este boleto foi cancelado e não deve ser impresso para pagamento.'});
  if(!row.external_id)return res.status(409).json({message:'O Banco Inter ainda não disponibilizou o PDF deste boleto.'});
  const integration=await getInterIntegration(row.condominium_id);if(!integration)return res.status(400).json({message:'Integração Banco Inter não configurada.'});
  let pdf: Buffer;
  try {
    pdf = await getInterBoletoPdf(row.external_id,integration);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível gerar o PDF deste boleto.';
    return res.status(502).json({ message });
  }
  const safeName=String(row.full_name||row.username||'boleto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-');
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="boleto-${safeName}.pdf"`);return res.send(pdf);
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const invoice = await query(`select id from invoices where id=$1 and condominium_id=$2`, [req.params.id, req.user?.condominiumId]);
  if (!invoice.rows[0]) return res.status(404).json({ message: 'Cobrança não encontrada.' });
  const events = await query(`select id,event_type,provider_status,details,created_at from invoice_events where invoice_id=$1 order by created_at desc`, [req.params.id]);
  return res.json({ events: events.rows });
}));

export default router;
