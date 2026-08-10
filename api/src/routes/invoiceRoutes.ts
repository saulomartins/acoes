import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { createInterBoleto, getInterBoleto, getInterBoletoPdf, listInterBoletosByPayer, mapInterStatus, type InterIntegrationConfig, type InterListedBoleto } from '../services/interService';
import { sendPushNotification } from '../services/notificationService';
import { notifyNewInvoice, transitionOverdueInvoices } from '../services/invoiceReminderService';
import { logAudit } from '../services/auditService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.use(authenticate);
router.use(requireFeature('gestao_cobrancas'));

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

export const syncInterInvoice = async (invoice: { id:string; condominium_id:string; external_id:string }) => {
  const integration=await getInterIntegration(invoice.condominium_id);
  if(!integration) throw new Error('Integração Banco Inter não configurada.');
  const inter=await getInterBoleto(invoice.external_id,integration);
  const status=mapInterStatus(inter.cobranca.situacao);
  const paidAt=status==='paid'?(inter.cobranca.dataSituacao||new Date().toISOString()):null;
  const providerDueDate=/^\d{4}-\d{2}-\d{2}$/.test(inter.cobranca.dataVencimento||'')?inter.cobranca.dataVencimento:null;
  const updated=await query(`update invoices set status=$1,digitable_line=$2,pdf_url=$3,barcode=$4,pix_copy_paste=$5,
    due_date=coalesce($6::date,due_date),paid_at=coalesce(paid_at,$7),
    paid_amount_cents=case when $1::invoice_status='paid'::invoice_status then amount_cents else paid_amount_cents end
    where id=$8 returning *`,[status,inter.boleto?.linhaDigitavel||null,`/cobranca/v3/cobrancas/${invoice.external_id}/pdf`,inter.boleto?.codigoBarras||null,inter.pix?.pixCopiaECola||null,providerDueDate,paidAt,invoice.id]);
  await query(`insert into invoice_events(id,invoice_id,event_type,provider_status,details) values($1,$2,'provider_sync',$3,$4)`,[randomUUID(),invoice.id,inter.cobranca.situacao,JSON.stringify(inter)]);
  return {invoice:updated.rows[0],inter};
};

export type UnmatchedCharge = { payerName: string; payerDocument: string; dueDate: string; amountCents: number };
export type ConflictedCharge = { payerName: string; dueDate: string; reason: string };

// Importa/atualiza localmente as cobranças relevantes encontradas no Inter
// (em aberto, atrasadas ou já pagas — ver relevantInterCharges). resolveUserId
// decide, por CPF/CNPJ do pagador, a quem a cobrança pertence. Cobranças sem
// usuário correspondente (CPF do pagador não bate com ninguém cadastrado no
// condomínio) não podem ser importadas — voltam em `unmatched` para que o
// síndico saiba que existem boletos no banco sem morador vinculado no
// sistema, em vez de desaparecerem silenciosamente.
//
// Cada cobrança é inserida individualmente (sem transação única para o lote
// inteiro): se uma falhar — por exemplo, colidindo com a restrição que
// permite só uma cobrança ativa por morador/mês (invoices_user_reference_active),
// quando já existe um lançamento manual/legado para o mesmo mês — ela é
// registrada em `conflicts` e o processamento continua para as demais.
// Deixar uma falha abortar o laço inteiro é exatamente o que fazia a
// importação trazer "alguns boletos, não todos".
const importCharges = async (
  condominiumId: string,
  charges: InterListedBoleto[],
  resolveUserId: (payerDocument: string) => string | undefined,
) => {
  let imported = 0;
  const unmatched: UnmatchedCharge[] = [];
  const conflicts: ConflictedCharge[] = [];
  for (const item of charges) {
    const charge = item.cobranca;
    if (!charge?.codigoSolicitacao || !/^\d{4}-\d{2}-\d{2}$/.test(charge.dataVencimento || '')) continue;
    const payerDocument = (charge.pagador?.cpfCnpj || '').replace(/\D/g, '');
    const amountCents = Math.round(Number(charge.valorNominal) * 100);
    const userId = resolveUserId(payerDocument);
    if (!userId) {
      unmatched.push({
        payerName: charge.pagador?.nome || 'Pagador desconhecido',
        payerDocument,
        dueDate: charge.dataVencimento,
        amountCents: Number.isFinite(amountCents) ? amountCents : 0,
      });
      continue;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue;
    const status = mapInterStatus(charge.situacao);
    const isPaid = status === 'paid';
    const paidAmountCents = isPaid ? amountCents : null;
    const paidAt = isPaid ? (charge.dataSituacao || null) : null;
    try {
      const result = await query(
        `insert into invoices (
           id, condominium_id, user_id, amount_cents, due_date, reference_month, status, provider,
           external_id, digitable_line, pdf_url, barcode, pix_copy_paste, invoice_type, paid_amount_cents, paid_at
         ) values ($1,$2,$3,$4,$5,date_trunc('month',$5::date)::date,$6,'inter',$7,$8,$9,$10,$11,'regular',$12,$13)
         on conflict (external_id) where external_id is not null do update set
           condominium_id=excluded.condominium_id, user_id=excluded.user_id,
           amount_cents=excluded.amount_cents, due_date=excluded.due_date, status=excluded.status,
           digitable_line=coalesce(excluded.digitable_line,invoices.digitable_line),
           barcode=coalesce(excluded.barcode,invoices.barcode),
           pix_copy_paste=coalesce(excluded.pix_copy_paste,invoices.pix_copy_paste),
           paid_amount_cents=coalesce(excluded.paid_amount_cents,invoices.paid_amount_cents),
           paid_at=coalesce(excluded.paid_at,invoices.paid_at)
         returning (xmax = 0) as inserted`,
        [randomUUID(), condominiumId, userId, amountCents, charge.dataVencimento,
         status, charge.codigoSolicitacao,
         item.boleto?.linhaDigitavel || null, `/cobranca/v3/cobrancas/${charge.codigoSolicitacao}/pdf`,
         item.boleto?.codigoBarras || null, item.pix?.pixCopiaECola || null, paidAmountCents, paidAt],
      );
      if (result.rows[0]?.inserted) imported += 1;
    } catch (error: any) {
      const reason = error?.code === '23505'
        ? 'já existe outro lançamento ativo para este morador no mesmo mês.'
        : (error?.message || 'falha ao gravar a cobrança.');
      conflicts.push({ payerName: charge.pagador?.nome || 'Pagador desconhecido', dueDate: charge.dataVencimento, reason });
    }
  }
  return { imported, unmatched, conflicts };
};

// Por padrão busca "tudo" (janela ampla). Quando o admin geral configura o
// condomínio para buscar boletos só a partir de um mês (boleto_sync_mode
// 'from_period', em Vincular banco ao condomínio), o início da janela passa
// a ser esse mês — histórico anterior deixa de ser buscado no banco.
const openInterChargesWindow = async (condominiumId: string) => {
  const year = new Date().getUTCFullYear();
  const fallback = { start: `${year - 10}-01-01`, end: `${year + 10}-12-31` };
  const config = await query<{ boleto_sync_mode: string; boleto_sync_start_period: string | null }>(
    `select boleto_sync_mode, to_char(boleto_sync_start_period, 'YYYY-MM-DD') as boleto_sync_start_period
     from condominium_bank_configurations where condominium_id=$1`,
    [condominiumId],
  );
  const row = config.rows[0];
  if (row?.boleto_sync_mode === 'from_period' && row.boleto_sync_start_period) {
    return { start: row.boleto_sync_start_period, end: fallback.end };
  }
  return fallback;
};

// Cobranças em aberto/atrasadas/expiradas/protestadas entram sempre, cobranças
// já pagas ou conciliadas manualmente (RECEBIDO/MARCADO_RECEBIDO) entram por
// completo também — o sistema precisa espelhar o histórico real do banco
// (inclusive para prestação de contas), não só o que ainda está pendente.
// EM_PROCESSAMENTO e FALHA_EMISSAO também entram: são exatamente as cobranças
// "órfãs" que ficam presas no banco sem nunca terem sido salvas localmente
// (ex.: nossa chamada deu timeout depois do Inter já ter aceitado o pedido) —
// deixá-las de fora da busca era o que permitia uma reemissão criar duplicata
// sem ninguém perceber que a primeira cobrança ainda existia no banco. Por
// ser uma lista de permissão explícita, cobranças ARQUIVADO (dormentes/
// antigas) nunca entram aqui — não precisam de exclusão própria, basta não
// estarem na lista.
const relevantInterCharges = (bankCharges: InterListedBoleto[]) => {
  const open = bankCharges.filter(item => ['A_RECEBER', 'ATRASADO', 'EXPIRADO', 'PROTESTO', 'EM_PROCESSAMENTO', 'FALHA_EMISSAO'].includes(item.cobranca?.situacao));
  const paid = bankCharges.filter(item => ['RECEBIDO', 'MARCADO_RECEBIDO'].includes(item.cobranca?.situacao));
  return { open, paid, all: [...open, ...paid] };
};

export const discoverOpenInterInvoices = async (userId: string, condominiumId: string) => {
  const userResult = await query<{ cpf: string | null }>(
    `select cpf from users where id=$1 and condominium_id=$2`, [userId, condominiumId],
  );
  const cpf = (userResult.rows[0]?.cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) throw new Error('Cadastre um CPF válido no seu perfil para buscar boletos no Banco Inter.');
  const integration = await getInterIntegration(condominiumId);
  if (!integration) throw new Error('Integração Banco Inter não configurada.');
  const { start, end } = await openInterChargesWindow(condominiumId);
  const bankCharges = await listInterBoletosByPayer(cpf, start, end, integration);
  const { open, paid, all } = relevantInterCharges(bankCharges);
  const { imported, unmatched, conflicts } = await importCharges(condominiumId, all, document => document === cpf ? userId : undefined);
  return { found: all.length, foundOpen: open.length, foundPaid: paid.length, imported, unmatched, conflicts };
};

// Varredura por todo o condomínio: busca no Inter todas as cobranças em
// aberto da conta (sem filtrar por um único pagador) e vincula cada uma ao
// morador cujo CPF bate. Usada por síndico/subsíndico em "Atualizar todos os
// boletos" — usar discoverOpenInterInvoices aqui buscaria só o CPF de quem
// clicou, deixando de fora as cobranças dos demais moradores.
export const discoverOpenInterInvoicesForCondominium = async (condominiumId: string) => {
  const integration = await getInterIntegration(condominiumId);
  if (!integration) throw new Error('Integração Banco Inter não configurada.');
  // Só proprietario/inquilino podem ter boletos vinculados. Sem esse filtro de
  // role, um CPF cadastrado em mais de uma conta no mesmo condomínio (ex.:
  // síndico que também é morador) pode acabar recebendo o boleto do morador
  // por coincidência de ordem no resultado da consulta.
  const usersResult = await query<{ id: string; cpf: string | null }>(
    `select id, cpf from users where condominium_id=$1 and cpf is not null and deleted_at is null and role in ('proprietario','inquilino')`, [condominiumId],
  );
  const userIdByCpf = new Map<string, string>();
  for (const row of usersResult.rows) {
    const cpf = (row.cpf || '').replace(/\D/g, '');
    if (cpf.length === 11) userIdByCpf.set(cpf, row.id);
  }
  const { start, end } = await openInterChargesWindow(condominiumId);
  const bankCharges = await listInterBoletosByPayer(null, start, end, integration);
  const { open, paid, all } = relevantInterCharges(bankCharges);
  const { imported, unmatched, conflicts } = await importCharges(condominiumId, all, document => userIdByCpf.get(document));
  return { found: all.length, foundOpen: open.length, foundPaid: paid.length, imported, unmatched, conflicts };
};

router.get('/', asyncHandler(async (req, res) => {
  const { userId, condominiumId, status } = req.query;
  const isResident = req.user?.role === 'proprietario' || req.user?.role === 'inquilino';
  const scopedUserId = isResident ? req.user!.id : userId;
  const scopedCondominiumId = req.user?.role === 'admin_geral'
    ? condominiumId || null
    : req.user?.condominiumId;

  await transitionOverdueInvoices();

  const invoicesQuery = `select invoices.id, invoices.condominium_id, invoices.user_id,
            invoices.amount_cents, invoices.due_date, invoices.status, invoices.provider,
            invoices.external_id, invoices.digitable_line, invoices.pdf_url, invoices.created_at,
            invoices.barcode, invoices.pix_copy_paste, invoices.paid_at, invoices.paid_amount_cents, invoices.batch_id,
            invoices.reference_month, invoices.invoice_type, invoices.agreement_id, invoices.cancellation_reason,
            users.username as user_username,
            users.full_name as user_full_name
     from invoices
     join users on users.id = invoices.user_id
     where ($1::uuid is null or invoices.user_id = $1)
       and ($2::uuid is null or invoices.condominium_id = $2)
       and ($3::text is null or invoices.status = $3::invoice_status)
       and invoices.deleted_at is null
     order by invoices.due_date desc, invoices.created_at desc`;
  const invoicesParams = [scopedUserId || null, scopedCondominiumId || null, status || null];

  const result = await query(invoicesQuery, invoicesParams);

  // Sincroniza concorrentemente com o Inter antes de retornar (dados sempre frescos)
  const activeInterInvoices = result.rows.filter(
    (inv: any) => inv.external_id && ['issued', 'pending_provider', 'overdue'].includes(inv.status)
  );
  if (activeInterInvoices.length > 0) {
    await Promise.allSettled(
      activeInterInvoices.map((invoice: any) =>
        syncInterInvoice(invoice as {id:string;condominium_id:string;external_id:string}).catch(() => {})
      )
    );
    // Re-consulta com status atualizados
    const fresh = await query(invoicesQuery, invoicesParams);
    return res.json({ invoices: fresh.rows });
  }

  return res.json({ invoices: result.rows });
}));

// Painel financeiro do síndico/subsíndico. Filtro por mês de referência
// (reference_month, com fallback pra due_date quando nulo) aplicado
// uniformemente às 4 categorias — "Pagos" aqui significa "dos boletos
// daquele mês de referência, o que já foi pago", igual ao card "recebido
// na referência" que já existe em Gestão de cobranças, não regime de
// caixa puro. Boletos cancelados no banco mas conciliados manualmente via
// Pix (settledExternally em PATCH /:id/cancellation-reason) ficam com
// paid_at/paid_amount_cents preenchidos mesmo com status='canceled' — por
// isso entram em "Pagos" (separados do valor pago normalmente pelo
// banco), e não em "Cancelados" (que é só quem nunca recebeu nada).
//
// "Em aberto" é só status='issued'. Boletos 'pending_provider' têm o card
// próprio "Aguardando o banco" (pendingBank abaixo) — contá-los também em
// "Em aberto" somava o mesmo valor duas vezes no painel. Além disso eles
// ainda não existem para o morador pagar, então não são cobrança em aberto.
//
// Todas as datas são lidas via to_char/aritmética em SQL, nunca como
// Date do JS — node-postgres devolve colunas `date` como objeto Date por
// padrão, o que já causou bugs de comparação nesta mesma base de código.
router.get('/dashboard/summary', authorize('sindico', 'subsindico'), requireFeature('painel'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const rawReferenceMonth = String(req.query?.referenceMonth || '');
  const referenceMonth = /^\d{4}-\d{2}-01$/.test(rawReferenceMonth) ? rawReferenceMonth : null;

  const scopeSql = `and ($2::text is null or to_char(date_trunc('month', coalesce(reference_month, due_date)), 'YYYY-MM-DD') = $2)`;

  const totals = await query<{
    bank_paid_cents: number; bank_paid_count: number; pix_settled_cents: number; pix_settled_count: number;
    open_cents: number; open_count: number; canceled_cents: number; canceled_count: number;
    overdue_cents: number; overdue_count: number; pending_provider_cents: number; pending_provider_count: number;
  }>(
    `select
       coalesce(sum(coalesce(paid_amount_cents, amount_cents)) filter (where paid_at is not null and status <> 'canceled'), 0)::int as bank_paid_cents,
       count(*) filter (where paid_at is not null and status <> 'canceled')::int as bank_paid_count,
       coalesce(sum(coalesce(paid_amount_cents, amount_cents)) filter (where paid_at is not null and status = 'canceled'), 0)::int as pix_settled_cents,
       count(*) filter (where paid_at is not null and status = 'canceled')::int as pix_settled_count,
       coalesce(sum(amount_cents) filter (where status = 'issued' and paid_at is null), 0)::int as open_cents,
       count(*) filter (where status = 'issued' and paid_at is null)::int as open_count,
       coalesce(sum(amount_cents) filter (where status = 'canceled' and paid_at is null), 0)::int as canceled_cents,
       count(*) filter (where status = 'canceled' and paid_at is null)::int as canceled_count,
       coalesce(sum(amount_cents) filter (where status = 'overdue'), 0)::int as overdue_cents,
       count(*) filter (where status = 'overdue')::int as overdue_count,
       coalesce(sum(amount_cents) filter (where status = 'pending_provider' and paid_at is null), 0)::int as pending_provider_cents,
       count(*) filter (where status = 'pending_provider' and paid_at is null)::int as pending_provider_count
     from invoices
     where condominium_id = $1 and deleted_at is null ${scopeSql}`,
    [condominiumId, referenceMonth],
  );

  // "Aguardando o banco" = boletos que já foram enviados pro Inter mas
  // ainda não têm confirmação (situação EM_PROCESSAMENTO ou não mapeada —
  // ver mapInterStatus em interService.ts). São os únicos que ainda podem
  // mudar de status sem nenhuma ação do síndico, então valem uma lista à
  // parte pra acompanhar de perto.
  const pendingBank = await query<{
    id: string; amount_cents: number; due_date: string; created_at: string;
    full_name: string | null; username: string; unit: string | null;
  }>(
    `select i.id, i.amount_cents, i.due_date, i.created_at, u.full_name, u.username, u.unit
     from invoices i join users u on u.id = i.user_id
     where i.condominium_id = $1 and i.status = 'pending_provider' and i.paid_at is null and i.deleted_at is null ${scopeSql}
     order by i.created_at asc`,
    [condominiumId, referenceMonth],
  );

  const pixSettled = await query<{
    id: string; amount_cents: number; paid_amount_cents: number | null; paid_at: string; due_date: string;
    cancellation_reason: string | null; user_full_name: string | null; user_username: string;
  }>(
    `select i.id, i.amount_cents, i.paid_amount_cents, i.paid_at, i.due_date, i.cancellation_reason,
            u.full_name as user_full_name, u.username as user_username
     from invoices i join users u on u.id = i.user_id
     where i.condominium_id = $1 and i.status = 'canceled' and i.paid_at is not null and i.deleted_at is null ${scopeSql}
     order by i.paid_at desc`,
    [condominiumId, referenceMonth],
  );

  const overdueByPerson = await query<{
    user_id: string; full_name: string | null; username: string; unit: string | null;
    overdue_count: number; overdue_cents: number; oldest_due_date: string; days_overdue: number;
  }>(
    `select u.id as user_id, u.full_name, u.username, u.unit,
            count(*)::int as overdue_count,
            sum(i.amount_cents)::int as overdue_cents,
            to_char(min(i.due_date),'YYYY-MM-DD') as oldest_due_date,
            (current_date - min(i.due_date))::int as days_overdue
     from invoices i join users u on u.id = i.user_id
     where i.condominium_id = $1 and i.status = 'overdue' and i.deleted_at is null ${scopeSql}
     group by u.id, u.full_name, u.username, u.unit
     order by overdue_cents desc`,
    [condominiumId, referenceMonth],
  );

  const availableMonths = await query<{ month: string }>(
    `select distinct to_char(date_trunc('month', coalesce(reference_month, due_date)), 'YYYY-MM-DD') as month
     from invoices where condominium_id = $1 and deleted_at is null order by month desc`,
    [condominiumId],
  );

  const row = totals.rows[0] || {
    bank_paid_cents: 0, bank_paid_count: 0, pix_settled_cents: 0, pix_settled_count: 0,
    open_cents: 0, open_count: 0, canceled_cents: 0, canceled_count: 0, overdue_cents: 0, overdue_count: 0,
    pending_provider_cents: 0, pending_provider_count: 0,
  };

  return res.json({
    referenceMonth,
    availableReferenceMonths: availableMonths.rows.map(item => item.month),
    paid: {
      totalCents: row.bank_paid_cents + row.pix_settled_cents,
      count: row.bank_paid_count + row.pix_settled_count,
      bankCents: row.bank_paid_cents,
      bankCount: row.bank_paid_count,
      pixSettledCents: row.pix_settled_cents,
      pixSettledCount: row.pix_settled_count,
      pixSettledInvoices: pixSettled.rows.map(item => ({
        id: item.id,
        amountCents: item.paid_amount_cents ?? item.amount_cents,
        paidAt: item.paid_at,
        dueDate: item.due_date,
        cancellationReason: item.cancellation_reason,
        userFullName: item.user_full_name,
        userUsername: item.user_username,
      })),
    },
    open: { totalCents: row.open_cents, count: row.open_count },
    canceled: { totalCents: row.canceled_cents, count: row.canceled_count },
    pendingBank: {
      totalCents: row.pending_provider_cents,
      count: row.pending_provider_count,
      invoices: pendingBank.rows.map(item => ({
        id: item.id,
        amountCents: item.amount_cents,
        dueDate: item.due_date,
        createdAt: item.created_at,
        fullName: item.full_name,
        username: item.username,
        unit: item.unit,
      })),
    },
    overdue: {
      totalCents: row.overdue_cents,
      count: row.overdue_count,
      byPerson: overdueByPerson.rows.map(item => ({
        userId: item.user_id,
        fullName: item.full_name,
        username: item.username,
        unit: item.unit,
        overdueCount: item.overdue_count,
        overdueCents: item.overdue_cents,
        oldestDueDate: item.oldest_due_date,
        daysOverdue: item.days_overdue,
      })),
    },
  });
}));

// Painel analítico isolado do Painel financeiro (dashboard/summary acima):
// filtro de período livre (De/Até) em vez de mês de referência, e
// cancelados agrupados por motivo em vez de listados um a um.
//
// Ao contrário do Painel financeiro (que é 100% por regime de competência,
// tudo pelo mês de vencimento), aqui "recebidos" usa a data do PAGAMENTO
// (paid_at), não do vencimento — é regime de caixa: um boleto vencido em
// julho e pago em agosto deve contar como recebido em agosto, não em
// julho. "Não pagos" e "cancelados" continuam por vencimento (due_date),
// porque não têm uma "data do evento" própria pra usar.
router.get('/analytics', authorize('sindico', 'subsindico'), requireFeature('indicadores_boletos'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const from = String(req.query?.from || '');
  const to = String(req.query?.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return res.status(400).json({ message: 'Informe um período válido (de/até).' });
  }

  const totals = await query<{
    received_cents: number; received_count: number;
    unpaid_cents: number; unpaid_count: number;
    canceled_cents: number; canceled_count: number;
  }>(
    `select
       coalesce(sum(coalesce(paid_amount_cents, amount_cents)) filter (where paid_at is not null and paid_at::date between $2::date and $3::date), 0)::int as received_cents,
       count(*) filter (where paid_at is not null and paid_at::date between $2::date and $3::date)::int as received_count,
       coalesce(sum(amount_cents) filter (where status in ('issued','pending_provider','overdue') and paid_at is null and due_date between $2::date and $3::date), 0)::int as unpaid_cents,
       count(*) filter (where status in ('issued','pending_provider','overdue') and paid_at is null and due_date between $2::date and $3::date)::int as unpaid_count,
       coalesce(sum(amount_cents) filter (where status = 'canceled' and paid_at is null and due_date between $2::date and $3::date), 0)::int as canceled_cents,
       count(*) filter (where status = 'canceled' and paid_at is null and due_date between $2::date and $3::date)::int as canceled_count
     from invoices
     where condominium_id = $1 and deleted_at is null`,
    [condominiumId, from, to],
  );

  const byReason = await query<{ reason: string | null; count: number; cents: number }>(
    `select nullif(trim(cancellation_reason), '') as reason, count(*)::int as count, coalesce(sum(amount_cents), 0)::int as cents
     from invoices
     where condominium_id = $1 and status = 'canceled' and paid_at is null and deleted_at is null and due_date between $2::date and $3::date
     group by reason
     order by count desc`,
    [condominiumId, from, to],
  );

  const row = totals.rows[0] || {
    received_cents: 0, received_count: 0, unpaid_cents: 0, unpaid_count: 0, canceled_cents: 0, canceled_count: 0,
  };

  return res.json({
    from,
    to,
    received: { totalCents: row.received_cents, count: row.received_count },
    unpaid: { totalCents: row.unpaid_cents, count: row.unpaid_count },
    canceled: {
      totalCents: row.canceled_cents,
      count: row.canceled_count,
      byReason: byReason.rows.map(item => ({ reason: item.reason, count: item.count, totalCents: item.cents })),
    },
  });
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

  await logAudit(req, 'gestao_cobrancas', 'created', `Emitiu boleto individual para ${payer.full_name || payer.username}`, { entityId: (result.rows[0] as any).id });
  await notifyNewInvoice({ id: (result.rows[0] as any).id, condominiumId: targetCondominiumId, userId, amountCents: payer.fee_cents, dueDate });
  return res.status(201).json({ invoice: result.rows[0], provider: boleto });
}));

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const addMonths = (date: string, months: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
};
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Registro de débito anterior à existência do sistema (negociado entre as partes ou judicialmente).
router.post('/legacy', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId as string;
  const {
    userId, amountCents, dueDate, negotiationType, judicialProcessNumber, notes,
    alreadyNegotiated, negotiatedTotalCents, installmentCount, firstDueDate,
  } = req.body ?? {};

  if (!userId) return res.status(400).json({ message: 'Selecione a pessoa responsável pelo débito.' });
  if (!Number.isInteger(Number(amountCents)) || Number(amountCents) <= 0) {
    return res.status(400).json({ message: 'Informe um valor de débito válido.' });
  }
  if (!isValidDate(String(dueDate || ''))) {
    return res.status(400).json({ message: 'Informe a data de vencimento original no formato AAAA-MM-DD.' });
  }
  if (negotiationType && !['private', 'judicial'].includes(negotiationType)) {
    return res.status(400).json({ message: 'Tipo de negociação inválido.' });
  }
  if (negotiationType === 'judicial' && !String(judicialProcessNumber || '').trim()) {
    return res.status(400).json({ message: 'Informe o número do processo judicial.' });
  }

  const person = await query<{ id: string; unit_id: string | null }>(
    `select id, unit_id from users where id=$1 and condominium_id=$2`,
    [userId, condominiumId],
  );
  if (!person.rows[0]) return res.status(404).json({ message: 'Pessoa não encontrada neste condomínio.' });

  const invoiceId = randomUUID();
  await query(
    `insert into invoices (id, condominium_id, user_id, amount_cents, due_date, status, provider, invoice_type, negotiation_type, judicial_process_number, notes, reference_month)
     values ($1, $2, $3, $4, $5, 'issued', 'manual', 'legacy', $6, $7, $8, $5)`,
    [
      invoiceId,
      condominiumId,
      userId,
      Math.round(Number(amountCents)),
      dueDate,
      negotiationType || null,
      negotiationType === 'judicial' ? String(judicialProcessNumber).trim() : null,
      notes ? String(notes).trim() : null,
    ],
  );

  let agreement: { id: string; negotiatedTotalCents: number; installmentCount: number } | null = null;

  if (alreadyNegotiated) {
    const negotiatedTotal = Math.round(Number(negotiatedTotalCents));
    const count = Number(installmentCount);
    if (!Number.isInteger(negotiatedTotal) || negotiatedTotal <= 0) {
      return res.status(400).json({ message: 'Informe o valor negociado do débito antigo.' });
    }
    if (!Number.isInteger(count) || count < 1 || count > 60) {
      return res.status(400).json({ message: 'Informe a quantidade de parcelas do débito já negociado (1 a 60).' });
    }
    if (!isValidDate(String(firstDueDate || ''))) {
      return res.status(400).json({ message: 'Informe a data da primeira parcela do débito já negociado.' });
    }

    const agreementId = randomUUID();
    await withTransaction(async client => {
      await client.query(
        `insert into debt_agreements (
           id, condominium_id, debtor_user_id, unit_id, created_by, status,
           original_total_cents, negotiated_total_cents, installment_count, first_due_date,
           notes, sent_at
         )
         values ($1,$2,$3,$4,$5,'sent',$6,$7,$8,$9,$10,now())`,
        [
          agreementId, condominiumId, userId, person.rows[0].unit_id, req.user?.id,
          Math.round(Number(amountCents)), negotiatedTotal, count, firstDueDate,
          'Débito antigo negociado registrado retroativamente no sistema.',
        ],
      );
      await client.query(
        `insert into debt_agreement_items (agreement_id, invoice_id, principal_cents, fine_cents, interest_cents, frozen_total_cents, frozen_at)
         values ($1,$2,$3,0,0,$4,current_date)`,
        [agreementId, invoiceId, Math.round(Number(amountCents)), negotiatedTotal],
      );
      for (let index = 0; index < count; index++) {
        const base = Math.floor(negotiatedTotal / count);
        const installmentAmount = base + (index === count - 1 ? negotiatedTotal - base * count : 0);
        await client.query(
          `insert into debt_agreement_installments (id, agreement_id, installment_number, amount_cents, due_date) values ($1,$2,$3,$4,$5)`,
          [randomUUID(), agreementId, index + 1, installmentAmount, addMonths(firstDueDate, index)],
        );
      }
    });
    agreement = { id: agreementId, negotiatedTotalCents: negotiatedTotal, installmentCount: count };

    // O acordo fica com status 'sent': o responsável precisa aceitar explicitamente (dar ciência) em
    // Gestão de débitos antes que qualquer boleto possa ser gerado — nenhum boleto é emitido sem esse aceite.
    const title = 'Proposta de acordo de débito antigo';
    const body = `Foi registrada uma proposta de acordo para um débito antigo (${count} parcela(s), total de ${money(negotiatedTotal)}), referente a um débito de ${money(Math.round(Number(amountCents)))} vencido em ${dueDate.split('-').reverse().join('/')}. Acesse Gestão de débitos e aceite o acordo para que as parcelas possam ser emitidas.`;

    const devices = await query<{ fcm_token: string }>(`select distinct fcm_token from device_tokens where user_id = $1`, [userId]);
    const tokens = devices.rows.map(row => row.fcm_token).filter(Boolean);
    let push: { status: string; invalidTokens?: string[]; errors?: string[] };
    try {
      push = await sendPushNotification({ tokens, title, body, data: { screen: 'Debts' } });
      if (push.errors?.length) console.warn('Legacy debt agreement push notification errors', push.errors);
      if (push.invalidTokens?.length) await query(`delete from device_tokens where fcm_token = any($1::text[])`, [push.invalidTokens]);
    } catch (error) {
      console.warn('Legacy debt agreement push notification failed', error);
      push = { status: 'provider_error' };
    }

    const notificationId = randomUUID();
    await query(
      `insert into notifications(id,condominium_id,title,body,created_by,provider_status,audience_type) values($1,$2,$3,$4,$5,$6,'personal')`,
      [notificationId, condominiumId, title, body, req.user?.id, push.status],
    );
    await query(`insert into notification_recipients(notification_id,user_id) values($1,$2) on conflict do nothing`, [notificationId, userId]);
  }

  await logAudit(req, 'gestao_cobrancas', 'created', `Registrou débito antigo (${money(Math.round(Number(amountCents)))})`, { entityId: invoiceId });
  return res.status(201).json({
    message: agreement ? 'Débito antigo cadastrado. A proposta de acordo aguarda o aceite do responsável antes da emissão dos boletos.' : 'Débito antigo cadastrado.',
    invoiceId,
    agreement,
  });
}));

const normalizeHeader = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

const excelDateToIso = (cell: ExcelJS.Cell): string | null => {
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  const text = cell.text.trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
};

const excelMonthToIso = (cell: ExcelJS.Cell): string | null => {
  if (cell.value instanceof Date) return `${cell.value.toISOString().slice(0, 7)}-01`;
  const text = cell.text.trim();
  const monthYear = text.match(/^(\d{2})\/(\d{4})$/);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}-01`;
  const full = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (full) return `${full[3]}-${full[2]}-01`;
  return null;
};

const excelCurrencyToCents = (cell: ExcelJS.Cell): number | null => {
  if (typeof cell.value === 'number') return Math.round(cell.value * 100);
  const text = cell.text.trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
};

// Importação em lote de débitos antigos (planilha .xlsx) para uma pessoa/apartamento já selecionado.
// Multa, mora e total são sempre recalculados pelo sistema a partir da taxa, do vencimento e da
// configuração de multa/mora do condomínio (billing_settings) — os valores dessas colunas na planilha
// de origem são ignorados.
router.post('/legacy/import', authorize('sindico', 'subsindico'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Selecione um arquivo Excel.' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ message: 'O arquivo deve estar no formato .xlsx.' });

  const condominiumId = req.user?.condominiumId as string;
  const userId = String(req.query.userId || req.body?.userId || '');
  if (!userId) return res.status(400).json({ message: 'Selecione a pessoa responsável pelos débitos antes de importar.' });

  const person = await query<{ id: string }>(`select id from users where id=$1 and condominium_id=$2`, [userId, condominiumId]);
  if (!person.rows[0]) return res.status(404).json({ message: 'Pessoa não encontrada neste condomínio.' });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ message: 'A planilha não possui abas.' });

  let headerRow = 0; let mesColumn = 0; let taxaColumn = 0; let vencimentoColumn = 0; let situacaoColumn = 0;
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
    let foundTaxa = 0; let foundVencimento = 0; let foundMes = 0; let foundSituacao = 0;
    sheet.getRow(rowNumber).eachCell((cell, column) => {
      const header = normalizeHeader(cell.text);
      if (header === 'mes') foundMes = column;
      if (header === 'taxa condominio') foundTaxa = column;
      if (header.startsWith('vencimento')) foundVencimento = column;
      if (header === 'situacao') foundSituacao = column;
    });
    if (foundTaxa && foundVencimento) {
      headerRow = rowNumber; mesColumn = foundMes; taxaColumn = foundTaxa; vencimentoColumn = foundVencimento; situacaoColumn = foundSituacao;
      break;
    }
  }
  if (!headerRow) {
    return res.status(400).json({ message: 'Use as colunas "TAXA CONDOMINIO" e "VENCIMENTO BOLETO" na planilha.' });
  }

  const rows: Array<{ row: number; amountCents: number | null; dueDate: string | null; referenceMonth: string | null; paid: boolean }> = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const taxaCell = row.getCell(taxaColumn);
    const vencimentoCell = row.getCell(vencimentoColumn);
    if (!taxaCell.text.trim() && !vencimentoCell.text.trim()) continue;
    const amountCents = excelCurrencyToCents(taxaCell);
    const dueDate = excelDateToIso(vencimentoCell);
    const referenceMonth = mesColumn ? excelMonthToIso(row.getCell(mesColumn)) : null;
    const situacaoText = situacaoColumn ? normalizeHeader(row.getCell(situacaoColumn).text) : '';
    rows.push({ row: rowNumber, amountCents, dueDate, referenceMonth, paid: situacaoText.includes('pago') });
  }
  if (!rows.length) return res.status(400).json({ message: 'Nenhuma linha preenchida foi encontrada na planilha.' });

  const result = await withTransaction(async client => {
    let created = 0; let paidCount = 0; let duplicates = 0;
    const issues: Array<{ row: number; message: string }> = [];
    for (const item of rows) {
      if (!item.amountCents) { issues.push({ row: item.row, message: 'Valor da taxa condominial inválido ou não informado.' }); continue; }
      if (!item.dueDate) { issues.push({ row: item.row, message: 'Data de vencimento do boleto inválida ou não informada.' }); continue; }
      const existing = await client.query(
        `select id from invoices where user_id=$1 and condominium_id=$2 and due_date=$3 and amount_cents=$4 and invoice_type='legacy'`,
        [userId, condominiumId, item.dueDate, item.amountCents],
      );
      if (existing.rows[0]) { duplicates += 1; issues.push({ row: item.row, message: 'Débito já importado anteriormente (mesmo vencimento e valor).' }); continue; }
      await client.query(
        `insert into invoices (id, condominium_id, user_id, amount_cents, due_date, status, provider, invoice_type, reference_month, paid_at, paid_amount_cents)
         values ($1,$2,$3,$4,$5,$6,'manual','legacy',$7,$8,$9)`,
        [
          randomUUID(), condominiumId, userId, item.amountCents, item.dueDate,
          item.paid ? 'paid' : 'issued', item.referenceMonth || item.dueDate,
          item.paid ? item.dueDate : null, item.paid ? item.amountCents : null,
        ],
      );
      created += 1;
      if (item.paid) paidCount += 1;
    }
    return { total: rows.length, created, paid: paidCount, duplicates, invalid: issues.length, issues };
  });

  if (result.created) await logAudit(req, 'gestao_cobrancas', 'imported', `Importou ${result.created} débito(s) antigo(s) via Excel`, { details: result });
  return res.status(201).json({
    message: `${result.created} débito(s) antigo(s) importado(s)${result.paid ? ` (${result.paid} já pago(s))` : ''}.`,
    ...result,
  });
}));

router.post('/sync-all', authorize('sindico', 'subsindico', 'proprietario', 'inquilino'), asyncHandler(async (req,res)=>{
  const isResident = req.user?.role === 'proprietario' || req.user?.role === 'inquilino';
  const discovery = req.user?.condominiumId
    ? (isResident && req.user?.id
        ? await discoverOpenInterInvoices(req.user.id, req.user.condominiumId)
        : await discoverOpenInterInvoicesForCondominium(req.user.condominiumId))
    : { found: 0, foundOpen: 0, foundPaid: 0, imported: 0, unmatched: [] as UnmatchedCharge[], conflicts: [] as ConflictedCharge[] };
  const invoices=await query<{id:string;condominium_id:string;external_id:string;user_full_name:string|null;user_username:string}>(`select i.id,i.condominium_id,i.external_id,u.full_name user_full_name,u.username user_username
    from invoices i join users u on u.id=i.user_id
    where i.condominium_id=$1 and i.external_id is not null and i.status not in ('canceled'::invoice_status,'paid'::invoice_status) and i.deleted_at is null
    and ($2::uuid is null or i.user_id=$2)
    order by i.due_date desc`,[req.user?.condominiumId, isResident ? req.user?.id : null]);
  let updated=0;const failures:Array<{payerName:string;reason:string}>=[];
  for(const invoice of invoices.rows){try{await syncInterInvoice(invoice);updated+=1}catch(error:any){failures.push({payerName:invoice.user_full_name||invoice.user_username,reason:error?.message||'Falha ao consultar o Banco Inter.'})}}
  const prefix=`${discovery.found} boleto(s) encontrado(s) no banco (${discovery.foundOpen} em aberto/atrasado(s), ${discovery.foundPaid} já pago(s) este mês); ${discovery.imported} novo(s) importado(s)/atualizado(s). `;
  const unmatchedSuffix=discovery.unmatched.length?` ${discovery.unmatched.length} boleto(s) em aberto no banco sem morador correspondente no sistema (confira o CPF cadastrado): ${discovery.unmatched.map(item=>`${item.payerName} (venc. ${item.dueDate})`).join(' | ')}.`:'';
  const conflictsSuffix=discovery.conflicts.length?` ${discovery.conflicts.length} boleto(s) não importado(s) por conflito: ${discovery.conflicts.map(item=>`${item.payerName} (venc. ${item.dueDate}): ${item.reason}`).join(' | ')}.`:'';
  const message=(failures.length===0?`${prefix}${updated} cobrança(s) atualizada(s) com sucesso.`:`${prefix}${updated} cobrança(s) atualizada(s) e ${failures.length} com falha. ${failures.map(item=>`${item.payerName}: ${item.reason}`).join(' | ')}`)+unmatchedSuffix+conflictsSuffix;
  return res.json({updated,found:discovery.found,foundOpen:discovery.foundOpen,foundPaid:discovery.foundPaid,imported:discovery.imported,failed:failures.length,failures,unmatched:discovery.unmatched,conflicts:discovery.conflicts,message});
}));

router.post('/:id/sync', authorize('sindico', 'subsindico', 'proprietario'), asyncHandler(async (req, res) => {
  const isResident = req.user?.role === 'proprietario' || req.user?.role === 'inquilino';
  const result = await query<{ id: string; condominium_id: string; external_id: string | null; user_id: string }>(
    `select id, condominium_id, external_id, user_id from invoices where id = $1 and condominium_id = $2`,
    [req.params.id, req.user?.condominiumId],
  );
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Cobrança não encontrada.' });
  if (isResident && invoice.user_id !== req.user?.id) return res.status(403).json({ message: 'Você não pode sincronizar esta cobrança.' });
  if (!invoice.external_id) return res.status(400).json({ message: 'Cobrança ainda não possui código do Banco Inter.' });

  return res.json(await syncInterInvoice(invoice as {id:string;condominium_id:string;external_id:string}));
}));

// Motivo do cancelamento é preenchido manualmente pelo síndico/subsíndico
// depois que o boleto já aparece como cancelado (o Banco Inter não informa
// motivo — só o status). Só faz sentido registrar isso para boletos que já
// estão cancelados; um boleto em aberto/a receber não pode ganhar uma
// "justificativa de cancelamento" que ainda não aconteceu.
//
// settledExternally marca que, apesar do cancelamento no banco, o valor foi
// efetivamente recebido por fora (ex.: morador pagou via Pix direto pela
// chave, sem usar o boleto). Nesse caso reaproveitamos paid_amount_cents/
// paid_at (os mesmos campos usados quando o Inter confirma pagamento) para
// que o boleto passe a contar como recebido nos totais, sem mudar o status
// 'canceled' (que continua correto do ponto de vista do banco). Uma futura
// sincronização com o Inter não sobrescreve esses campos, pois o status
// permanece 'canceled' e syncInterInvoice só atualiza paid_amount_cents/
// paid_at quando o status vira 'paid'.
router.patch('/:id/cancellation-reason', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  const settledExternally = Boolean(req.body?.settledExternally);
  if (!reason) return res.status(400).json({ message: 'Informe o motivo do cancelamento.' });
  if (reason.length > 500) return res.status(400).json({ message: 'O motivo deve ter no máximo 500 caracteres.' });

  const result = await query<{ id: string; status: string }>(
    `select id, status from invoices where id = $1 and condominium_id = $2`,
    [req.params.id, req.user?.condominiumId],
  );
  const invoice = result.rows[0];
  if (!invoice) return res.status(404).json({ message: 'Cobrança não encontrada.' });
  if (invoice.status !== 'canceled') {
    return res.status(400).json({ message: 'Só é possível registrar o motivo para boletos já cancelados no banco. Este boleto ainda está em aberto/a receber.' });
  }

  const updated = await query<{ cancellation_reason: string | null; paid_amount_cents: number | null; paid_at: string | null }>(
    `update invoices set cancellation_reason = $1,
       paid_amount_cents = case when $2 then amount_cents else null end,
       paid_at = case when $2 then coalesce(paid_at, now()) else null end
     where id = $3
     returning cancellation_reason, paid_amount_cents, paid_at`,
    [reason, settledExternally, req.params.id],
  );
  await logAudit(req, 'gestao_cobrancas', 'updated', `Registrou motivo de cancelamento de um boleto: ${reason}`, { entityId: req.params.id });
  return res.json({
    cancellationReason: updated.rows[0].cancellation_reason,
    paidAmountCents: updated.rows[0].paid_amount_cents,
    paidAt: updated.rows[0].paid_at,
  });
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

// Baixa um .zip com um PDF por boleto (n\u00e3o um \u00fanico PDF combinado) de todos
// os boletos n\u00e3o cancelados de uma refer\u00eancia. Segue baixando os demais
// mesmo se algum boleto individual falhar no Inter \u2014 o resumo de falhas vai
// no cabe\u00e7alho da resposta para a tela exibir.
router.get('/export-pdfs', authorize('sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const referenceMonth = String(req.query.referenceMonth || '');
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) return res.status(400).json({ message: 'Informe o m\u00eas de refer\u00eancia no formato AAAA-MM.' });
  const invoices = await query<any>(
    `select i.id,i.external_id,u.full_name,u.username
     from invoices i join users u on u.id=i.user_id
     where i.condominium_id=$1 and i.reference_month=$2::date and i.status<>'canceled' and i.external_id is not null
     order by u.full_name,u.username`,
    [condominiumId, `${referenceMonth}-01`],
  );
  if (!invoices.rows.length) return res.status(404).json({ message: 'Nenhum boleto encontrado para essa refer\u00eancia.' });
  const integration = await getInterIntegration(condominiumId!);
  if (!integration) return res.status(400).json({ message: 'Integra\u00e7\u00e3o Banco Inter n\u00e3o configurada.' });
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const failed: string[] = [];
  for (const row of invoices.rows) {
    const label = row.full_name || row.username || 'boleto';
    try {
      const pdf = await getInterBoletoPdf(row.external_id, integration);
      const baseName = String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
      let fileName = `${baseName}.pdf`;
      let suffix = 2;
      while (usedNames.has(fileName)) { fileName = `${baseName}-${suffix}.pdf`; suffix += 1; }
      usedNames.add(fileName);
      zip.file(fileName, pdf);
    } catch (error) {
      failed.push(label);
      console.error('Falha ao baixar PDF para o zip da refer\u00eancia', { invoiceId: row.id, referenceMonth, error });
    }
  }
  if (!usedNames.size) return res.status(502).json({ message: 'N\u00e3o foi poss\u00edvel gerar nenhum PDF do Banco Inter para essa refer\u00eancia.' });
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  if (failed.length) res.setHeader('X-Failed-Pdfs', encodeURIComponent(failed.join(', ')));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="boletos-${referenceMonth}.zip"`);
  return res.send(buffer);
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const invoice = await query(`select id from invoices where id=$1 and condominium_id=$2`, [req.params.id, req.user?.condominiumId]);
  if (!invoice.rows[0]) return res.status(404).json({ message: 'Cobrança não encontrada.' });
  const events = await query(`select id,event_type,provider_status,details,created_at from invoice_events where invoice_id=$1 order by created_at desc`, [req.params.id]);
  return res.json({ events: events.rows });
}));

export default router;
