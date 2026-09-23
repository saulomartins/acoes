import { config } from '../config';
import nodemailer from 'nodemailer';

type EmailInput = { to: string; subject: string; html: string };

export const sendEmail = async ({ to, subject, html }: EmailInput) => {
  const smtp = config.email.smtp;
  if (smtp.host && smtp.user && smtp.pass && config.email.from) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    const info = await transporter.sendMail({
      from: config.email.from,
      to,
      subject,
      html,
      ...(config.email.replyTo ? { replyTo: config.email.replyTo } : {}),
    });
    return { status: 'sent' as const, data: { messageId: info.messageId, provider: 'smtp' } };
  }

  if (!config.email.resendApiKey || !config.email.from) {
    if (process.env.NODE_ENV === 'production') throw new Error('Email service is not configured (SMTP or Resend)');
    console.warn(`Email not sent (SMTP/Resend not configured): ${subject} -> ${to}`);
    return { status: 'pending_configuration' as const };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      subject,
      html,
      ...(config.email.replyTo ? { reply_to: config.email.replyTo } : {}),
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${JSON.stringify(data)}`);
  return { status: 'sent' as const, data };
};

export const sendPasswordResetEmail = (to: string, name: string, resetToken: string) => {
  const baseUrl = config.webUrl.trim();
  const resetUrl = baseUrl.endsWith('://')
    ? `${baseUrl}redefinir-senha?token=${encodeURIComponent(resetToken)}`
    : `${baseUrl.replace(/\/$/, '')}/redefinir-senha?token=${encodeURIComponent(resetToken)}`;
  return sendEmail({
    to,
    subject: 'Redefinição de senha — Lar em Dia',
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
      <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
        <h2 style="margin-top:0">Redefinição de senha</h2>
        <p>Olá, ${escapeHtml(name)}.</p>
        <p>Recebemos uma solicitação para redefinir sua senha no Lar em Dia.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#255eab;color:white;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Criar nova senha</a></p>
        <p>Este link expira em 30 minutos e só pode ser utilizado uma vez.</p>
        <p style="color:#6f7e8d;font-size:13px">Se você não fez esta solicitação, ignore este e-mail. Sua senha continuará a mesma.</p>
      </div></body></html>`,
  });
};

export const sendWelcomeEmail = (to: string, name: string, username: string, password: string, condominiumName: string) => sendEmail({
  to,
  subject: `Cadastro realizado — ${condominiumName || 'Lar em Dia'}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Bem-vindo(a) ao Lar em Dia</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>Seu cadastro foi realizado com sucesso no condomínio <strong>${escapeHtml(condominiumName || '')}</strong>.</p>
      <p>Seus dados de acesso:</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Usuário: <strong>${escapeHtml(username)}</strong><br/>
        Senha inicial: <strong>${escapeHtml(password)}</strong>
      </p>
      <p>No primeiro acesso, você precisará criar uma nova senha antes de usar o aplicativo.</p>
      <p style="color:#6f7e8d;font-size:13px">Guarde este e-mail em local seguro e não compartilhe sua senha com outras pessoas.</p>
    </div></body></html>`,
});

export const sendPasswordResetByAdminEmail = (to: string, name: string, username: string, password: string, condominiumName: string) => sendEmail({
  to,
  subject: 'Sua senha foi redefinida — Lar em Dia',
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Sua senha foi redefinida</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>A administração do condomínio <strong>${escapeHtml(condominiumName || '')}</strong> redefiniu sua senha de acesso.</p>
      <p>Seus novos dados de acesso:</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Usuário: <strong>${escapeHtml(username)}</strong><br/>
        Nova senha: <strong>${escapeHtml(password)}</strong>
      </p>
      <p>No próximo acesso, você precisará criar uma nova senha antes de continuar usando o aplicativo.</p>
      <p style="color:#6f7e8d;font-size:13px">Se você não esperava esta alteração, procure a administração do seu condomínio.</p>
    </div></body></html>`,
});

const formatMonthLabel = (referenceMonth: Date) =>
  referenceMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatCurrencyBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Detalhe do plano vinculado ao condomínio no momento da fatura — usado só
// pra montar a explicação de "por que esse valor" no e-mail abaixo. Um tipo
// por vez (union), igual ao plan_type de platform_plans.
export type PlatformInvoicePlanDetail =
  | { type: 'per_active_user'; priceCentsPerUser: number; minimumPriceCents: number }
  | { type: 'tiered_bracket'; tierMin: number; tierMax: number | null }
  | { type: 'included_overage'; includedQuantity: number; basePriceCents: number; overagePriceCents: number; overageUnits: number; overageAmountCents: number };

// Linhas de detalhamento do valor cobrado, específicas de cada tipo de
// plano — é aqui que o e-mail explica por que o total pode ser diferente
// do preço "de tabela" do plano (excedente sobre a quantidade incluída,
// valor mínimo mensal aplicado etc.), em vez de só mostrar um número seco.
const planDetailRows = (detail: PlatformInvoicePlanDetail, activeUsers: number): string => {
  if (detail.type === 'included_overage') {
    const overageRow = detail.overageUnits > 0
      ? `<br/>Usuários excedentes: <strong>${detail.overageUnits}</strong> × ${escapeHtml(formatCurrencyBRL(detail.overagePriceCents))} = <strong>${escapeHtml(formatCurrencyBRL(detail.overageAmountCents))}</strong>`
      : `<br/><span style="color:#0f927f">Dentro dos ${detail.includedQuantity} usuário${detail.includedQuantity === 1 ? '' : 's'} incluído${detail.includedQuantity === 1 ? '' : 's'} — sem cobrança de excedente este mês.</span>`;
    return `Valor base do plano: <strong>${escapeHtml(formatCurrencyBRL(detail.basePriceCents))}</strong>
      (até ${detail.includedQuantity} usuário${detail.includedQuantity === 1 ? '' : 's'} incluído${detail.includedQuantity === 1 ? '' : 's'})${overageRow}`;
  }
  if (detail.type === 'per_active_user') {
    const linearTotal = detail.priceCentsPerUser * activeUsers;
    const floorApplied = linearTotal < detail.minimumPriceCents;
    const floorRow = floorApplied
      ? `<br/><span style="color:#d89a2b">Valor mínimo mensal aplicado — o cálculo por usuário ficaria em ${escapeHtml(formatCurrencyBRL(linearTotal))}, abaixo do mínimo de ${escapeHtml(formatCurrencyBRL(detail.minimumPriceCents))}.</span>`
      : '';
    return `Preço por usuário ativo: <strong>${escapeHtml(formatCurrencyBRL(detail.priceCentsPerUser))}</strong>${floorRow}`;
  }
  const rangeLabel = detail.tierMax === null ? `a partir de ${detail.tierMin}` : `${detail.tierMin} a ${detail.tierMax}`;
  return `Faixa contratada: <strong>${rangeLabel} usuários ativos</strong> — valor fixo desta faixa.`;
};

// Cobrança Pix já criada no Mercado Pago pra essa fatura (ver
// mercadoPagoService.ts) — ausente quando MERCADOPAGO_ACCESS_TOKEN não
// está configurado, ou quando a criação da cobrança falhou; nesses casos o
// e-mail sai só informativo, sem bloco de pagamento (nunca falha o envio
// do aviso da fatura por causa disso).
export type PlatformInvoicePix = { copyPaste: string; expiresAt: string | null };

const pixBlockHtml = (pix?: PlatformInvoicePix | null) => {
  if (!pix?.copyPaste) return '';
  const expiryLine = pix.expiresAt
    ? `<p style="color:#6f7e8d;font-size:13px;margin-top:-6px">Válido até ${escapeHtml(new Date(pix.expiresAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.</p>`
    : '';
  return `
      <p style="font-weight:bold;margin-bottom:6px">Pagar agora com Pix</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px;font-family:monospace;font-size:12px;word-break:break-all">${escapeHtml(pix.copyPaste)}</p>
      ${expiryLine}
      <p style="color:#6f7e8d;font-size:13px">Copie o código acima e cole na opção "Pix Copia e Cola" do seu banco.</p>`;
};

export const sendPlatformInvoiceEmail = (
  to: string,
  name: string,
  condominiumName: string,
  planName: string,
  planDetail: PlatformInvoicePlanDetail,
  referenceMonth: Date,
  amountCents: number,
  activeUsers: number,
  pix?: PlatformInvoicePix | null,
  dueDate?: Date | null,
) => sendEmail({
  to,
  subject: `Fatura da plataforma — ${formatMonthLabel(referenceMonth)}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Fatura da plataforma</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>A fatura de <strong>${escapeHtml(formatMonthLabel(referenceMonth))}</strong> do condomínio
      <strong>${escapeHtml(condominiumName || '')}</strong> já está disponível.</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Plano contratado: <strong>${escapeHtml(planName)}</strong><br/>
        ${planDetailRows(planDetail, activeUsers)}<br/>
        Usuários ativos cobrados: <strong>${activeUsers}</strong>
      </p>
      <p style="background:#eaf1fb;border-radius:8px;padding:14px 16px;font-size:16px">
        Valor total do mês: <strong>${escapeHtml(formatCurrencyBRL(amountCents))}</strong>
        ${dueDate ? `<br/><span style="font-size:14px">Vencimento: <strong>${escapeHtml(dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' }))}</strong></span>` : ''}
      </p>
      ${pixBlockHtml(pix)}
      <p style="color:#6f7e8d;font-size:13px">Este valor se refere à assinatura da plataforma pelo condomínio, não a taxas condominiais dos moradores.</p>
    </div></body></html>`,
});

// Lembretes da fatura da plataforma (job diário): "vence em 3 dias" e "em
// atraso", cada um no máximo uma vez por fatura. Reenvia o Pix se existir.
export const sendPlatformInvoiceReminderEmail = (
  to: string,
  name: string,
  condominiumName: string,
  referenceMonth: Date,
  amountCents: number,
  dueDate: Date,
  kind: 'due_soon' | 'overdue',
  pix?: PlatformInvoicePix | null,
) => {
  const dueLabel = dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const overdue = kind === 'overdue';
  return sendEmail({
    to,
    subject: overdue ? `Fatura da plataforma em atraso — ${formatMonthLabel(referenceMonth)}` : `Fatura da plataforma vence em 3 dias — ${formatMonthLabel(referenceMonth)}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
      <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
        <h2 style="margin-top:0">${overdue ? 'Fatura da plataforma em atraso' : 'Sua fatura vence em 3 dias'}</h2>
        <p>Olá, ${escapeHtml(name)}.</p>
        <p>A fatura de <strong>${escapeHtml(formatMonthLabel(referenceMonth))}</strong> do condomínio <strong>${escapeHtml(condominiumName || '')}</strong>
        ${overdue ? `venceu em <strong>${escapeHtml(dueLabel)}</strong> e ainda não foi paga.` : `vence em <strong>${escapeHtml(dueLabel)}</strong>.`}</p>
        <p style="background:${overdue ? '#fbeaea' : '#eaf1fb'};border-radius:8px;padding:14px 16px;font-size:16px">
          Valor: <strong>${escapeHtml(formatCurrencyBRL(amountCents))}</strong>
        </p>
        ${pixBlockHtml(pix)}
        <p style="color:#6f7e8d;font-size:13px">Se você já pagou, desconsidere este aviso — a confirmação pode levar alguns instantes.</p>
      </div></body></html>`,
  });
};

// Aviso de fatura da plataforma cancelada pelo admin geral (fatura indevida
// ou substituída por uma corrigida) — o Pix antigo deixa de valer.
export const sendPlatformInvoiceCanceledEmail = (
  to: string,
  name: string,
  condominiumName: string,
  referenceMonth: Date,
  amountCents: number,
  reason: string,
  replaced: boolean,
) => sendEmail({
  to,
  subject: `Fatura da plataforma cancelada — ${formatMonthLabel(referenceMonth)}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Fatura da plataforma cancelada</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>A fatura de <strong>${escapeHtml(formatMonthLabel(referenceMonth))}</strong> (${escapeHtml(formatCurrencyBRL(amountCents))}) do condomínio
      <strong>${escapeHtml(condominiumName || '')}</strong> foi cancelada pela administração da plataforma.</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">Motivo: ${escapeHtml(reason)}</p>
      <p><strong>Desconsidere o Pix desta fatura</strong> — o código antigo não vale mais.${replaced ? ' Uma nova fatura, com novo Pix, foi enviada em seguida por e-mail.' : ''}</p>
      <p style="color:#6f7e8d;font-size:13px">Se você já pagou esta fatura, responda este e-mail para a administração providenciar o reembolso.</p>
    </div></body></html>`,
});

// Enviado pelo webhook do Mercado Pago (mercadoPagoWebhookRoutes.ts) quando
// o Pix da fatura é confirmado. Como a conta que recebe é pessoa física
// (sem CNPJ, sem nota fiscal automática — ver config.platformReceipt), este
// e-mail funciona como o recibo de verdade: o síndico anexa isso na
// prestação de contas do condomínio. Se PLATFORM_RECEIPT_OWNER_* não
// estiver preenchido no .env, o e-mail sai sem essa identificação — melhor
// avisar que o pagamento foi recebido, mesmo incompleto, do que não avisar.
export const sendPlatformInvoiceReceiptEmail = (
  to: string,
  name: string,
  condominiumName: string,
  referenceMonth: Date,
  amountCents: number,
) => {
  const owner = config.platformReceipt;
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const identification = owner.ownerName
    ? `<p>Eu, <strong>${escapeHtml(owner.ownerName)}</strong>${owner.ownerCpf ? `, CPF ${escapeHtml(owner.ownerCpf)}` : ''},
       declaro ter recebido de <strong>${escapeHtml(condominiumName || '')}</strong> a quantia de
       <strong>${escapeHtml(formatCurrencyBRL(amountCents))}</strong> referente à assinatura da plataforma Lar em Dia,
       competência de <strong>${escapeHtml(formatMonthLabel(referenceMonth))}</strong>.</p>
       <p>${escapeHtml(owner.ownerCity || '')}${owner.ownerCity ? ', ' : ''}${escapeHtml(today)}.</p>`
    : `<p>Recebemos o pagamento de <strong>${escapeHtml(formatCurrencyBRL(amountCents))}</strong> referente à assinatura
       da plataforma Lar em Dia de <strong>${escapeHtml(condominiumName || '')}</strong>, competência de
       <strong>${escapeHtml(formatMonthLabel(referenceMonth))}</strong>.</p>`;
  return sendEmail({
    to,
    subject: `Recibo — Fatura da plataforma paga (${formatMonthLabel(referenceMonth)})`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
      <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
        <h2 style="margin-top:0">Recibo de pagamento</h2>
        <p>Olá, ${escapeHtml(name)}.</p>
        <p>Seu pagamento via Pix foi confirmado. Este e-mail serve como recibo — guarde-o para a prestação de contas do condomínio.</p>
        <div style="background:#f5f7fb;border-radius:8px;padding:16px 18px">${identification}</div>
        <p style="color:#6f7e8d;font-size:13px">Este valor se refere à assinatura da plataforma pelo condomínio, não a taxas condominiais dos moradores.</p>
      </div></body></html>`,
  });
};

const loginUrl = () => {
  const baseUrl = config.webUrl.trim();
  return baseUrl.endsWith('://') ? `${baseUrl}login` : `${baseUrl.replace(/\/$/, '')}/login`;
};

// Os dois e-mails abaixo são disparados pelo job diário de lembrete de
// boleto (billingReminderScheduler.ts / invoiceReminderService.ts), cada um
// no máximo uma vez por boleto: "vence em 3 dias" é marcado por
// due_soon_notified_at, "vencido" pela própria transição de status
// issued/pending_provider -> overdue, que só acontece uma vez.
export const sendInvoiceDueSoonEmail = (to: string, name: string, condominiumName: string, amountLabel: string, dueDateLabel: string) => sendEmail({
  to,
  subject: `Boleto vence em 3 dias — ${condominiumName || 'Lar em Dia'}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Seu boleto vence em 3 dias</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>O boleto do condomínio <strong>${escapeHtml(condominiumName || '')}</strong> vence em breve:</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Valor: <strong>${escapeHtml(amountLabel)}</strong><br/>
        Vencimento: <strong>${escapeHtml(dueDateLabel)}</strong>
      </p>
      <p><a href="${loginUrl()}" style="display:inline-block;background:#255eab;color:white;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Ver meu boleto</a></p>
      <p style="color:#6f7e8d;font-size:13px">Pague até a data de vencimento para evitar juros e multa.</p>
    </div></body></html>`,
});

export const sendInvoiceOverdueEmail = (to: string, name: string, condominiumName: string, amountLabel: string, dueDateLabel: string) => sendEmail({
  to,
  subject: `Boleto vencido — ${condominiumName || 'Lar em Dia'}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Seu boleto está vencido</h2>
      <p>Olá, ${escapeHtml(name)}.</p>
      <p>O boleto do condomínio <strong>${escapeHtml(condominiumName || '')}</strong> está em atraso:</p>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Valor original: <strong>${escapeHtml(amountLabel)}</strong><br/>
        Venceu em: <strong>${escapeHtml(dueDateLabel)}</strong>
      </p>
      <p><a href="${loginUrl()}" style="display:inline-block;background:#255eab;color:white;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:bold">Regularizar agora</a></p>
      <p style="color:#6f7e8d;font-size:13px">Podem incidir juros e multa conforme o regulamento do condomínio.</p>
    </div></body></html>`,
});

// Caixa de e-mail comercial que recebe os contatos do formulário "Fale com
// a gente" da landing page — condomínio interessado em contratar, ainda
// sem conta no sistema.
const LEAD_NOTIFICATION_EMAIL = 'laremdia.condominio@gmail.com';

export const sendLeadNotificationEmail = (lead: {
  name: string; condominiumName: string; email: string; phone: string; message: string;
  city?: string; profile?: string; condominiumCount?: string; unitCount?: string; featuresOfInterest?: string;
}) => sendEmail({
  to: LEAD_NOTIFICATION_EMAIL,
  subject: `Novo contato pelo site — ${lead.condominiumName}`,
  html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17283e;line-height:1.5">
    <div style="max-width:560px;margin:auto;padding:28px;border:1px solid #e4e9ee;border-radius:12px">
      <h2 style="margin-top:0">Novo contato pelo site</h2>
      <p style="background:#f5f7fb;border-radius:8px;padding:14px 16px">
        Nome: <strong>${escapeHtml(lead.name)}</strong><br/>
        Condomínio: <strong>${escapeHtml(lead.condominiumName)}</strong><br/>
        E-mail: <strong>${escapeHtml(lead.email)}</strong><br/>
        WhatsApp: <strong>${escapeHtml(lead.phone || 'não informado')}</strong><br/>
        ${lead.city ? `Cidade: <strong>${escapeHtml(lead.city)}</strong><br/>` : ''}
        ${lead.profile ? `Perfil: <strong>${escapeHtml(lead.profile)}</strong><br/>` : ''}
        ${lead.condominiumCount ? `Nº de condomínios: <strong>${escapeHtml(lead.condominiumCount)}</strong><br/>` : ''}
        ${lead.unitCount ? `Unidades (aprox.): <strong>${escapeHtml(lead.unitCount)}</strong><br/>` : ''}
        ${lead.featuresOfInterest ? `Interesse: <strong>${escapeHtml(lead.featuresOfInterest)}</strong>` : ''}
      </p>
      ${lead.message ? `<p>${escapeHtml(lead.message)}</p>` : ''}
    </div></body></html>`,
});

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char] || char));
