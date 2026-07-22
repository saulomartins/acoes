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

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char] || char));
