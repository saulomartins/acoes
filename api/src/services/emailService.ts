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

export const sendPlatformInvoiceEmail = (
  to: string,
  name: string,
  condominiumName: string,
  referenceMonth: Date,
  amountCents: number,
  activeUsers: number,
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
        Usuários ativos cobrados: <strong>${activeUsers}</strong><br/>
        Valor: <strong>${escapeHtml(formatCurrencyBRL(amountCents))}</strong>
      </p>
      <p style="color:#6f7e8d;font-size:13px">Este valor se refere à assinatura da plataforma pelo condomínio, não a taxas condominiais dos moradores.</p>
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
