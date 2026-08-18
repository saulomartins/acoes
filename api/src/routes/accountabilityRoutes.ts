import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import pdf from 'pdf-parse';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { logAudit } from '../services/auditService';
import { listInterExtrato, getInterExtratoPdf, getInterSaldo } from '../services/interService';
import { getInterExtratoIntegration } from './invoiceRoutes';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(authenticate);
router.use(requireFeature('prestacao_contas'));
router.use((req,res,next)=>{if(req.user?.role!=='inquilino')return next();const send=res.json.bind(res);res.json=((body:any)=>{const hide=(item:any)=>{if(item&&typeof item==='object')delete item.bank_balance_cents};if(Array.isArray(body?.reports))body.reports.forEach(hide);hide(body?.report);return send(body)}) as typeof res.json;return next()});

// Conselho Fiscal (opcional, feature `conselho_fiscal`): quem ocupa os dois
// assentos, pra exibir nome/considerações e resolver quem pode homologar.
const hydrateCouncil=async(condo:string)=>{
  const result=await query<{id1:string|null;name1:string|null;id2:string|null;name2:string|null}>(
    `select u1.id id1,u1.full_name name1,u2.id id2,u2.full_name name2
     from condominiums c
     left join users u1 on u1.id=c.fiscal_council_1_user_id
     left join users u2 on u2.id=c.fiscal_council_2_user_id
     where c.id=$1`,[condo]);
  const row=result.rows[0];
  return{
    fiscalCouncil1:row?.id1?{id:row.id1,fullName:row.name1}:null,
    fiscalCouncil2:row?.id2?{id:row.id2,fullName:row.name2}:null,
  };
};
router.get('/council',authorize('sindico','subsindico'),requireFeature('conselho_fiscal'),asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  return res.json(await hydrateCouncil(condo));
}));
router.put('/council',authorize('sindico','subsindico'),requireFeature('conselho_fiscal'),asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  const id1=req.body?.fiscalCouncil1UserId?String(req.body.fiscalCouncil1UserId):null;
  const id2=req.body?.fiscalCouncil2UserId?String(req.body.fiscalCouncil2UserId):null;
  if(id1&&id2&&id1===id2)return res.status(400).json({message:'Escolha duas pessoas diferentes para o Conselho Fiscal 1 e 2.'});
  for(const id of [id1,id2].filter((value):value is string=>Boolean(value))){
    const person=await query(`select id from users where id=$1 and condominium_id=$2 and role in ('proprietario','inquilino') and deleted_at is null`,[id,condo]);
    if(!person.rows[0])return res.status(400).json({message:'Selecione moradores (proprietário ou inquilino) cadastrados neste condomínio.'});
  }
  await query(`update condominiums set fiscal_council_1_user_id=$1,fiscal_council_2_user_id=$2 where id=$3`,[id1,id2,condo]);
  await logAudit(req,'prestacao_contas','updated','Atualizou os membros do Conselho Fiscal');
  return res.json(await hydrateCouncil(condo));
}));

// Homologação: cada assento (síndico, subsíndico e, se o Conselho Fiscal
// estiver ligado, conselho_fiscal_1/2) pode homologar e/ou deixar uma
// consideração sobre um relatório específico — sem bloquear nada, é só um
// registro ao lado do relatório (que continua sempre visível a todos).
// Fica registrada por `seat`, não só por `user_id`: se a pessoa que ocupa o
// assento mudar de um mês pro outro, cada relatório mantém quem homologou
// de fato naquele momento.
// Aberto a qualquer papel (não só síndico/subsíndico) porque um conselheiro
// fiscal pode ser proprietário/inquilino — por isso estas duas rotas ficam
// antes do filtro "só gestor" logo abaixo, que bloquearia o PUT de um
// conselheiro morador.
const noteText=(value:unknown)=>{const raw=String(value??'').trim();return raw.slice(0,1000)};
// Quem exerce este papel no condomínio "de fato": ou é o role padrão da
// conta (users.role), ou tem um perfil extra com esse role (user_profiles) —
// alguém cujo cadastro principal é proprietário/inquilino também pode ser
// síndico/subsíndico por um perfil adicional (mesmo padrão de EFFECTIVE_ROLE
// em condominiumRoutes.ts). Sem checar user_profiles aqui, quem só tem o
// papel por perfil extra aparecia como "não definido" na homologação, mesmo
// já sendo o síndico/subsíndico de fato.
const findRoleHolder=async(condo:string,role:'sindico'|'subsindico')=>{
  const result=await query<{id:string;full_name:string|null}>(
    `select u.id,u.full_name from users u
     where u.condominium_id=$1 and u.deleted_at is null
       and (u.role=$2 or exists(select 1 from user_profiles up where up.user_id=u.id and up.role=$2 and up.condominium_id=$1))
     order by (u.role=$2) desc, u.created_at limit 1`,
    [condo,role],
  );
  return result.rows[0]||null;
};
const resolveApprovalSeat=async(req:any):Promise<string|null>=>{
  if(req.user?.role==='sindico')return'sindico';
  if(req.user?.role==='subsindico')return'subsindico';
  const condo=req.user?.condominiumId;if(!condo)return null;
  const featureRow=await query<{enabled:boolean}>(`select conselho_fiscal as enabled from condominium_features where condominium_id=$1`,[condo]);
  if(!(featureRow.rows[0]?featureRow.rows[0].enabled:false))return null;
  const condoRow=await query<{fiscal_council_1_user_id:string|null;fiscal_council_2_user_id:string|null}>(`select fiscal_council_1_user_id,fiscal_council_2_user_id from condominiums where id=$1`,[condo]);
  if(condoRow.rows[0]?.fiscal_council_1_user_id===req.user?.id)return'conselho_fiscal_1';
  if(condoRow.rows[0]?.fiscal_council_2_user_id===req.user?.id)return'conselho_fiscal_2';
  return null;
};
router.get('/:id/approvals',asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  const report=await query(`select id from accountability_reports where id=$1 and condominium_id=$2`,[req.params.id,condo]);
  if(!report.rows[0])return res.status(404).json({message:'Prestação de contas não encontrada.'});
  const [sindicoHolder,subsindicoHolder,featureRow,council,approvalsRow]=await Promise.all([
    findRoleHolder(condo,'sindico'),
    findRoleHolder(condo,'subsindico'),
    query<{enabled:boolean}>(`select conselho_fiscal as enabled from condominium_features where condominium_id=$1`,[condo]),
    hydrateCouncil(condo),
    query<{seat:string;user_id:string|null;approved:boolean;note:string|null;updated_at:string}>(`select seat,user_id,approved,note,updated_at from accountability_report_approvals where report_id=$1`,[req.params.id]),
  ]);
  const councilEnabled=featureRow.rows[0]?featureRow.rows[0].enabled:false;
  const seats=[
    {seat:'sindico',label:'Síndico',holderId:sindicoHolder?.id||null,holderName:sindicoHolder?.full_name||null},
    {seat:'subsindico',label:'Subsíndico',holderId:subsindicoHolder?.id||null,holderName:subsindicoHolder?.full_name||null},
    ...(councilEnabled?[
      {seat:'conselho_fiscal_1',label:'Conselho Fiscal 1',holderId:council.fiscalCouncil1?.id||null,holderName:council.fiscalCouncil1?.fullName||null},
      {seat:'conselho_fiscal_2',label:'Conselho Fiscal 2',holderId:council.fiscalCouncil2?.id||null,holderName:council.fiscalCouncil2?.fullName||null},
    ]:[]),
  ];
  const approvalBySeat=new Map(approvalsRow.rows.map(row=>[row.seat,row]));
  const result=seats.map(seatInfo=>{
    const approval=approvalBySeat.get(seatInfo.seat);
    return{...seatInfo,approved:approval?.approved||false,note:approval?.note||null,updatedAt:approval?.updated_at||null};
  });
  const applicable=result.filter(item=>item.holderId);
  return res.json({
    seats:result,
    approvedCount:result.filter(item=>item.approved).length,
    totalSeats:result.length,
    fullyHomologated:applicable.length>0&&applicable.every(item=>item.approved),
  });
}));
router.put('/:id/approval',asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  const report=await query(`select id from accountability_reports where id=$1 and condominium_id=$2`,[req.params.id,condo]);
  if(!report.rows[0])return res.status(404).json({message:'Prestação de contas não encontrada.'});
  const seat=await resolveApprovalSeat(req);
  if(!seat)return res.status(403).json({message:'Você não está entre os responsáveis por homologar esta prestação de contas.'});
  const approved=Boolean(req.body?.approved);
  const note=noteText(req.body?.note)||null;
  await query(
    `insert into accountability_report_approvals(id,report_id,seat,user_id,approved,note,updated_at)
     values($1,$2,$3,$4,$5,$6,now())
     on conflict (report_id,seat) do update set user_id=excluded.user_id,approved=excluded.approved,note=excluded.note,updated_at=now()`,
    [randomUUID(),req.params.id,seat,req.user?.id,approved,note],
  );
  await logAudit(req,'prestacao_contas','updated',`${approved?'Homologou':'Atualizou considerações sobre'} a prestação de contas (${seat})`,{entityId:req.params.id});
  return res.json({ok:true});
}));

router.use((req,res,next)=>req.method==='GET'||req.user?.role==='sindico'||req.user?.role==='subsindico'?next():res.status(403).json({message:'Permissão insuficiente.'}));
router.use((req,_res,next)=>{if((req.method==='POST'||req.method==='PUT')&&monthKey(req.body?.referenceMonth)){req.body.periodStart=`${req.body.referenceMonth}-01`;req.body.periodEnd=monthEnd(req.body.referenceMonth)}next()});
router.use((req,res,next)=>{if(!['POST','PUT'].includes(req.method)||!Array.isArray(req.body?.expenses))return next();for(const [index,item] of req.body.expenses.entries()){const raw=String(item.serviceDate||'');const match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(match)item.serviceDate=`${match[3]}-${match[2]}-${match[1]}`;if(!String(item.provider||'').trim())return res.status(400).json({message:`Informe a empresa ou pessoa da despesa ${index+1}.`});if(!String(item.purpose||'').trim())return res.status(400).json({message:`Informe o objetivo da despesa ${index+1}.`});if(!isoDate(item.serviceDate))return res.status(400).json({message:`Informe uma data válida na despesa ${index+1}. Use DD/MM/AAAA.`});if(!Number.isInteger(Number(item.amountCents))||Number(item.amountCents)<=0)return res.status(400).json({message:`Informe um valor maior que zero na despesa ${index+1}.`})}return next()});

const isoDate = (value: unknown) => { const raw=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;const [y,m,d]=raw.split('-').map(Number);const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d; };
const monthKey = (value: unknown) => /^\d{4}-\d{2}$/.test(String(value || ''));
const monthEnd = (month:string) => { const [year,number]=month.split('-').map(Number);return `${month}-${String(new Date(Date.UTC(year,number,0)).getUTCDate()).padStart(2,'0')}`; };
const moneyToCents = (raw: string) => { const clean=raw.replace(/R\$|\s/g,''); const normalized=clean.includes(',')?clean.replace(/\./g,'').replace(',','.'):clean.replace(/,/g,''); return Math.round(Math.abs(Number(normalized))*100); };
const shortText = (value: unknown) => { const raw=String(value??'').trim(); return raw.slice(0,120); };
const brToIso = (raw: string) => { const [,d,m,y]=raw.match(/(\d{2})\/(\d{2})\/(\d{4})/)||[]; return y?`${y}-${m}-${d}`:''; };
// O endereço do condomínio é um texto livre único (sem coluna de cidade
// separada), no formato observado "Rua X, Bairro, Cidade - UF". Extrai só a
// cidade removendo o "- UF" do final e pegando o último trecho entre vírgulas.
const extractCityFromAddress = (address: unknown) => { const raw=String(address||'').trim();if(!raw)return'';const withoutState=raw.replace(/\s*-\s*[A-Za-zÀ-ÿ]{2}\s*$/,'');const parts=withoutState.split(',').map(p=>p.trim()).filter(Boolean);return parts.length?parts[parts.length-1]:''; };
const hydrate = async(id:string,condo:string) => {
  const report=await query<any>(`select a.*,c.name origin,coalesce(sum(e.amount_cents),0)::bigint total_expenses_cents,(a.received_amount_cents-coalesce(sum(e.amount_cents),0))::bigint balance_cents from accountability_reports a join condominiums c on c.id=a.condominium_id left join accountability_expenses e on e.report_id=a.id where a.id=$1 and a.condominium_id=$2 group by a.id,c.name`,[id,condo]);
  if(!report.rows[0])return null; const expenses=await query(`select e.id,e.provider,e.purpose,to_char(e.service_date,'DD/MM/YYYY') "serviceDate",e.amount_cents "amountCents",e.position,
      (r.expense_id is not null) has_receipt,r.file_name receipt_file_name,r.mime_type receipt_mime_type,
      (p.expense_id is not null) has_proof,p.file_name proof_file_name,p.mime_type proof_mime_type
    from accountability_expenses e
    left join accountability_expense_attachments r on r.expense_id=e.id and r.kind='receipt'
    left join accountability_expense_attachments p on p.expense_id=e.id and p.kind='proof'
    where e.report_id=$1 order by e.position,e.created_at`,[id]); return {...report.rows[0],expenses:expenses.rows};
};

router.get('/',asyncHandler(async(req,res)=>{if(!req.user?.condominiumId)return res.status(400).json({message:'Usuário sem condomínio.'});const result=await query<any>(`select a.*,c.name origin,coalesce(sum(e.amount_cents),0)::bigint total_expenses_cents,(a.received_amount_cents-coalesce(sum(e.amount_cents),0))::bigint balance_cents from accountability_reports a join condominiums c on c.id=a.condominium_id left join accountability_expenses e on e.report_id=a.id where a.condominium_id=$1 group by a.id,c.name order by a.reference_month desc`,[req.user.condominiumId]);return res.json({reports:result.rows})}));

router.post('/parse-pdf',authorize('sindico','subsindico'),upload.single('file'),asyncHandler(async(req,res)=>{
  if(!req.file||req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({message:'Envie um arquivo PDF válido.'});
  const parsed=await pdf(req.file.buffer);const text=parsed.text.replace(/\u00a0/g,' ');const period=text.match(/(\d{2}\/\d{2})(?:\/\d{4})?\s*a\s*(\d{2}\/\d{2})(?:\/(\d{4}))?/i);const dates=[...text.matchAll(/(\d{2}\/\d{2}\/\d{4})\s*R?\$?\s*([\d.,]+)/g)];const year=period?.[3]||dates[0]?.[1].slice(-4)||String(new Date().getFullYear());const start=period?brToIso(`${period[1]}/${year}`):'';const end=period?brToIso(`${period[2]}/${year}`):'';const total=text.match(/Total\s*A\s*R\$?\s*([\d.,]+)/i)||text.match(/RECEITA[\s\S]{0,250}?R\$?\s*([\d.,]+)/i);
  const expenses=dates.map((match,index)=>{const before=text.slice(Math.max(0,match.index!-100),match.index).split(/\r?\n/).filter(Boolean).pop()||'';return{provider:before.trim().replace(/Empresa|Objetivo|Data|Valor/gi,'').trim()||`Prestador ${index+1}`,purpose:'Serviço/fornecimento',serviceDate:match[1],amountCents:moneyToCents(match[2])}}).filter(e=>e.amountCents>0);const count=(pattern:RegExp)=>Number(text.match(pattern)?.[1]||0);
  return res.json({draft:{referenceMonth:start.slice(0,7),periodStart:start,periodEnd:end,paidUnits:count(/(\d+)\s*(?:apartamentos?)?\s*que\s*pagaram/i),exemptUnits:count(/(\d+)\s*(?:apartamentos?)?\s*isentos/i),unpaidUnits:count(/(\d+)\s*(?:apartamentos?)?\s*(?:que\s*)?n[aã]o\s*pag/i),receivedAmountCents:total?moneyToCents(total[1]):0,expenses,sourceFileName:req.file.originalname},warnings:expenses.length?[]:['Nenhuma despesa foi reconhecida automaticamente. Revise os dados.']});
}));

router.get('/autofill',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  const referenceMonth=String(req.query.referenceMonth||'');
  if(!monthKey(referenceMonth))return res.status(400).json({message:'Informe um mês válido (o campo "Mês") para importar os dados do período.'});
  const periodStart=`${referenceMonth}-01`;const periodEnd=monthEnd(referenceMonth);
  const [condoRow,sindicoHolder,invoiceStats,exemptResult]=await Promise.all([
    query<{address:string|null}>(`select address from condominiums where id=$1`,[condo]),
    findRoleHolder(condo,'sindico'),
    query<{paid_units:string;unpaid_units:string;received_amount_cents:string}>(
      `select count(*) filter (where status='paid') paid_units,
              count(*) filter (where status in ('issued','overdue')) unpaid_units,
              coalesce(sum(coalesce(paid_amount_cents,amount_cents)) filter (where status='paid'),0) received_amount_cents
       from invoices where condominium_id=$1 and reference_month=$2::date and deleted_at is null`,
      [condo,periodStart]),
    query<{count:string}>(`select count(*) from users where condominium_id=$1 and billing_exempt=true and deleted_at is null and role in ('proprietario','inquilino')`,[condo]),
  ]);
  const warnings:string[]=[];
  const expenses:any[]=[];
  let bankBalanceCents:number|null=null;
  const integration=await getInterExtratoIntegration(condo);
  if(!integration){
    warnings.push('Nenhuma integração bancária de extrato configurada — despesas e saldo bancário não foram importados.');
  }else{
    try{
      const transactions=await listInterExtrato(periodStart,periodEnd,integration);
      for(const item of transactions){
        const cents=Math.round(Math.abs(Number(item.valor))*100);
        if(!Number.isFinite(cents)||cents<=0||item.tipoOperacao!=='D')continue;
        expenses.push({provider:shortText(item.descricao||item.titulo)||'Movimentação bancária',purpose:'Despesa identificada no extrato bancário',serviceDate:item.dataEntrada,amountCents:cents});
      }
      if(!expenses.length)warnings.push('Nenhuma despesa foi encontrada no extrato bancário para o período informado.');
    }catch(error:any){
      warnings.push(`Não foi possível importar as despesas do extrato bancário: ${error?.message||'erro desconhecido'}.`);
    }
    try{
      // Saldo da competência = saldo do banco no fechamento do mês (periodEnd).
      // Se o mês ainda não terminou, o Inter não tem saldo pra uma data futura
      // — usa a data de hoje (saldo "até agora") como aproximação.
      const today=new Date().toISOString().slice(0,10);
      const saldoDate=periodEnd<today?periodEnd:today;
      const saldo=await getInterSaldo(saldoDate,integration);
      bankBalanceCents=Math.round(Number(saldo.disponivel)*100);
    }catch(error:any){
      warnings.push(`Não foi possível importar o saldo bancário: ${error?.message||'erro desconhecido'}.`);
    }
  }
  return res.json({draft:{
    periodStart,periodEnd,
    paidUnits:Number(invoiceStats.rows[0]?.paid_units||0),
    unpaidUnits:Number(invoiceStats.rows[0]?.unpaid_units||0),
    exemptUnits:Number(exemptResult.rows[0]?.count||0),
    receivedAmountCents:Number(invoiceStats.rows[0]?.received_amount_cents||0),
    bankBalanceCents,
    city:extractCityFromAddress(condoRow.rows[0]?.address),
    sindicoName:sindicoHolder?.full_name||'',
    expenses,
  },warnings});
}));

router.get('/extrato-pdf',authorize('sindico','subsindico'),asyncHandler(async(req,res)=>{
  const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});
  const referenceMonth=String(req.query.referenceMonth||'');
  if(!monthKey(referenceMonth))return res.status(400).json({message:'Informe um mês válido para baixar o extrato.'});
  const periodStart=`${referenceMonth}-01`;const periodEnd=monthEnd(referenceMonth);
  const integration=await getInterExtratoIntegration(condo);
  if(!integration)return res.status(400).json({message:'Nenhuma integração bancária de extrato configurada para este condomínio.'});
  let pdfBuffer:Buffer;
  try{
    pdfBuffer=await getInterExtratoPdf(periodStart,periodEnd,integration);
  }catch(error:any){
    return res.status(502).json({message:error?.message||'Não foi possível baixar o extrato em PDF.'});
  }
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="extrato-${referenceMonth}.pdf"`);
  return res.send(pdfBuffer);
}));

router.get('/:id',asyncHandler(async(req,res)=>{const report=await hydrate(req.params.id,req.user!.condominiumId!);return report?res.json({report}):res.status(404).json({message:'Prestação de contas não encontrada.'})}));

router.post('/',asyncHandler(async(req,res)=>{const condo=req.user?.condominiumId;if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});const b=req.body||{};const expenses=Array.isArray(b.expenses)?b.expenses:[];if(!monthKey(b.referenceMonth)||!isoDate(b.periodStart)||!isoDate(b.periodEnd))return res.status(400).json({message:'Mês e período são obrigatórios.'});if(`${b.referenceMonth}-01`!==b.periodStart||b.periodEnd.slice(0,7)!==b.referenceMonth)return res.status(400).json({message:'O período deve pertencer ao mês e começar no primeiro dia.'});const nums=[b.paidUnits,b.exemptUnits,b.unpaidUnits,b.receivedAmountCents].map(Number);if(nums.some(n=>!Number.isInteger(n)||n<0))return res.status(400).json({message:'Quantidades e valor devem ser não negativos.'});if(!expenses.length||expenses.some((e:any)=>!String(e.provider||'').trim()||!String(e.purpose||'').trim()||!isoDate(e.serviceDate)||!Number.isInteger(Number(e.amountCents))||Number(e.amountCents)<=0))return res.status(400).json({message:'Informe ao menos uma despesa completa.'});const id=randomUUID();try{await withTransaction(async client=>{await client.query(`insert into accountability_reports(id,condominium_id,reference_month,period_start,period_end,paid_units,exempt_units,unpaid_units,received_amount_cents,source,source_file_name,created_by,city,sindico_name,subsindico_name,fiscal_council_1_name,fiscal_council_2_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[id,condo,`${b.referenceMonth}-01`,b.periodStart,b.periodEnd,...nums,b.source==='pdf'?'pdf':'manual',b.sourceFileName||null,req.user?.id,shortText(b.city)||null,shortText(b.sindicoName)||null,shortText(b.subsindicoName)||null,shortText(b.fiscalCouncil1Name)||null,shortText(b.fiscalCouncil2Name)||null]);for(const [i,e] of expenses.entries())await client.query(`insert into accountability_expenses(id,report_id,provider,purpose,service_date,amount_cents,position) values($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),id,String(e.provider).trim(),String(e.purpose).trim(),e.serviceDate,Number(e.amountCents),i])})}catch(error:any){if(error?.code==='23505')return res.status(409).json({message:'Já existe uma prestação de contas para este mês.'});throw error}await logAudit(req,'prestacao_contas','created',`Criou a prestação de contas de ${b.referenceMonth}`,{entityId:id});return res.status(201).json({report:await hydrate(id,condo)})}));
router.put('/:id',asyncHandler(async(req,res)=>{const condo=req.user?.condominiumId;const b=req.body||{};const expenses=Array.isArray(b.expenses)?b.expenses:[];if(!condo)return res.status(400).json({message:'Usuário sem condomínio.'});if(!monthKey(b.referenceMonth)||!isoDate(b.periodStart)||!isoDate(b.periodEnd))return res.status(400).json({message:'Mês e período são obrigatórios.'});const nums=[b.paidUnits,b.exemptUnits,b.unpaidUnits,b.receivedAmountCents].map(Number);if(nums.some(n=>!Number.isInteger(n)||n<0)||!expenses.length||expenses.some((e:any)=>!String(e.provider||'').trim()||!String(e.purpose||'').trim()||!isoDate(e.serviceDate)||!Number.isInteger(Number(e.amountCents))||Number(e.amountCents)<=0))return res.status(400).json({message:'Revise os valores e as despesas informadas.'});try{const updated=await withTransaction(async client=>{const report=await client.query(`update accountability_reports set reference_month=$1,period_start=$2,period_end=$3,paid_units=$4,exempt_units=$5,unpaid_units=$6,received_amount_cents=$7,city=$8,sindico_name=$9,subsindico_name=$10,fiscal_council_1_name=$11,fiscal_council_2_name=$12,updated_at=now() where id=$13 and condominium_id=$14 returning id`,[`${b.referenceMonth}-01`,b.periodStart,b.periodEnd,...nums,shortText(b.city)||null,shortText(b.sindicoName)||null,shortText(b.subsindicoName)||null,shortText(b.fiscalCouncil1Name)||null,shortText(b.fiscalCouncil2Name)||null,req.params.id,condo]);if(!report.rows[0])return false;const retained=expenses.map((e:any)=>e.id).filter(Boolean);await client.query(`delete from accountability_expenses where report_id=$1 and not(id=any($2::uuid[]))`,[req.params.id,retained]);for(const [i,e] of expenses.entries()){if(e.id)await client.query(`update accountability_expenses set provider=$1,purpose=$2,service_date=$3,amount_cents=$4,position=$5 where id=$6 and report_id=$7`,[String(e.provider).trim(),String(e.purpose).trim(),e.serviceDate,Number(e.amountCents),i,e.id,req.params.id]);else await client.query(`insert into accountability_expenses(id,report_id,provider,purpose,service_date,amount_cents,position) values($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),req.params.id,String(e.provider).trim(),String(e.purpose).trim(),e.serviceDate,Number(e.amountCents),i])}return true});if(!updated)return res.status(404).json({message:'Prestação de contas não encontrada.'})}catch(error:any){if(error?.code==='23505')return res.status(409).json({message:'Já existe uma prestação para esse mês.'});throw error}await logAudit(req,'prestacao_contas','updated',`Editou a prestação de contas de ${b.referenceMonth}`,{entityId:req.params.id});return res.json({report:await hydrate(req.params.id,condo)})}));
router.delete('/:id',asyncHandler(async(req,res)=>{const result=await query<any>(`delete from accountability_reports where id=$1 and condominium_id=$2 returning id,to_char(reference_month,'MM/YYYY') reference_month`,[req.params.id,req.user?.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Prestação de contas não encontrada.'});await logAudit(req,'prestacao_contas','deleted',`Excluiu a prestação de contas de ${result.rows[0].reference_month}`,{entityId:req.params.id});return res.status(204).send()}));
router.patch('/:id/bank-balance',asyncHandler(async(req,res)=>{const value=req.body?.bankBalanceCents;if(value!==null&&!Number.isInteger(Number(value)))return res.status(400).json({message:'Saldo bancário inválido.'});const result=await query(`update accountability_reports set bank_balance_cents=$1,updated_at=now() where id=$2 and condominium_id=$3 returning bank_balance_cents`,[value===null?null:Number(value),req.params.id,req.user?.condominiumId]);if(!result.rows[0])return res.status(404).json({message:'Prestação não encontrada.'});await logAudit(req,'prestacao_contas','updated','Atualizou o saldo bancário da prestação de contas',{entityId:req.params.id});return res.json({bankBalanceCents:result.rows[0].bank_balance_cents})}));
export default router;
