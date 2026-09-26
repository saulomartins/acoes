// Gera a página "Prévia de e-mails" (artifact publicado) a partir das funções
// REAIS de emailService.ts — assunto e HTML saem exatamente como o sistema
// envia, sem cópia manual que fica desatualizada. Nenhum e-mail é enviado:
// o provedor é configurado de mentira e o fetch do Resend é interceptado.
//
//   npm run emails:preview -- caminho/da/pagina.html
//
// Dados de exemplo apenas (nenhum morador/condomínio real, CPF zerado).
import { writeFileSync } from 'fs';

type Captured = { to: string; subject: string; html: string; attachments: string[] };
type Entry = { kind: 'invoice' | 'due' | 'overdue' | 'receipt' | 'canceled' | 'suspension'; chip: string; trigger: string; send: () => Promise<unknown> };

const outputPath = process.argv[2];
if (!outputPath) {
  console.error('Uso: npm run emails:preview -- <arquivo.html>');
  process.exit(1);
}

// Antes de carregar config.ts: dotenv não sobrescreve variável já definida,
// então isto vence o .env (SMTP real e dados reais do recibo ficam de fora).
Object.assign(process.env, {
  NODE_ENV: 'development',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
  RESEND_API_KEY: 'preview-only',
  EMAIL_FROM: 'Lar em Dia <no-reply@gestaolaremdia.com>',
  EMAIL_REPLY_TO: '',
  APP_WEB_URL: 'https://gestaolaremdia.com',
  PLATFORM_RECEIPT_OWNER_NAME: 'Saulo Martins Costa',
  PLATFORM_RECEIPT_OWNER_CPF: '000.000.000-00',
  PLATFORM_RECEIPT_OWNER_CITY: 'São Paulo',
});

let captured: Captured | null = null;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`prévia não acessa a rede: ${url}`);
  const body = JSON.parse(String(init?.body));
  const attachments = (body.attachments || []).map((a: { filename: string; content: string }) =>
    `${a.filename} (${(Buffer.from(a.content, 'base64').length / 1024).toFixed(1).replace('.', ',')} KB)`);
  captured = { to: body.to[0], subject: body.subject, html: body.html, attachments };
  return new Response(JSON.stringify({ id: 'preview' }), { status: 200 });
}) as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const email = require('../services/emailService') as typeof import('../services/emailService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPlatformReceiptPdf } = require('../services/platformReceiptDocument') as typeof import('../services/platformReceiptDocument');

// Mesmo PDF que o sistema anexa ao recibo (dados de exemplo).
const receiptPdf = async () => ({
  filename: 'recibo-lar-em-dia-2026-09.pdf',
  contentType: 'application/pdf',
  content: await buildPlatformReceiptPdf({
    invoiceId: '3f2a9c1e-5b7d-4e21-9a0c-7d1e2f3a4b5c', condominiumName: 'Residencial Templum', referenceMonth: '2026-09-01',
    amountCents: 9900, activeUsers: 35, planName: 'Essencial', paidAt: new Date('2026-09-05T14:20:00Z'), paymentMethod: 'pix_mercadopago',
  }),
});

const month = new Date('2026-09-01T00:00:00Z');
const dueDate = new Date('2026-09-11T00:00:00Z');
const pix = { copyPaste: '00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540599.005802BR5913LAR EM DIA6009SAO PAULO62070503***6304ABCD', expiresAt: '2026-10-01T12:00:00Z' };
const renewedPix = { copyPaste: '00020126580014br.gov.bcb.pix0136f9e8d7c6-b5a4-3210-fedc-ba9876543210520400005303986540599.005802BR5913LAR EM DIA6009SAO PAULO62070503***6304DCBA', expiresAt: '2026-10-31T12:00:00Z' };
const essencial = { type: 'included_overage' as const, includedQuantity: 40, basePriceCents: 9900, overagePriceCents: 500, overageUnits: 0, overageAmountCents: 0 };
const sindica = 'sindico@residencialtemplum.com.br';

const entries: Entry[] = [
  { kind: 'invoice', chip: 'Fatura · dentro do plano, com Pix', trigger: 'Job diário 9h ou "Gerar faturas" do admin (checkAndSendPlatformInvoice)',
    send: () => email.sendPlatformInvoiceEmail(sindica, 'Maria Silva', 'Residencial Templum', 'Essencial', essencial, month, 9900, 35, pix, dueDate) },
  { kind: 'invoice', chip: 'Fatura · com excedente', trigger: 'Job diário 9h ou "Gerar faturas" do admin (checkAndSendPlatformInvoice)',
    send: () => email.sendPlatformInvoiceEmail(sindica, 'Maria Silva', 'Residencial Templum', 'Essencial', { ...essencial, overageUnits: 15, overageAmountCents: 7500 }, month, 17400, 55, pix, dueDate) },
  { kind: 'invoice', chip: 'Fatura · piso mínimo, sem Pix', trigger: 'Job diário 9h, sem Mercado Pago configurado (checkAndSendPlatformInvoice)',
    send: () => email.sendPlatformInvoiceEmail('sindico@condominioparque.com.br', 'Carlos Nunes', 'Condomínio Parque das Flores', 'Usuário Cadastrado', { type: 'per_active_user', priceCentsPerUser: 490, minimumPriceCents: 5000 }, month, 5000, 5, null, dueDate) },
  { kind: 'invoice', chip: 'Novo código Pix · o anterior expirou', trigger: 'Job de 15 min (renewExpiredPlatformInvoicePix)',
    send: () => email.sendPlatformInvoiceEmail(sindica, 'Maria Silva', 'Residencial Templum', 'Essencial', essencial, month, 9900, 35, renewedPix, dueDate, true) },
  { kind: 'due', chip: 'Lembrete · fatura vence em 3 dias', trigger: 'Job diário 9h (notifyPlatformInvoiceReminders)',
    send: () => email.sendPlatformInvoiceReminderEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, dueDate, 'due_soon', pix) },
  { kind: 'overdue', chip: 'Lembrete · fatura em atraso', trigger: 'Job diário 9h, dia seguinte ao vencimento (notifyPlatformInvoiceReminders)',
    send: () => email.sendPlatformInvoiceReminderEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, dueDate, 'overdue', pix) },
  { kind: 'suspension', chip: 'Aviso · suspensão marcada', trigger: 'Job diário 9h, com 7, 15 e 25 dias de atraso (notifyPlatformSuspensionReminders)',
    send: () => email.sendPlatformSuspensionEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, new Date('2026-10-11T00:00:00Z'), 'warning') },
  { kind: 'suspension', chip: 'Aviso · gestão restrita', trigger: 'Job diário 9h, com 30 dias de atraso (notifyPlatformSuspensionReminders)',
    send: () => email.sendPlatformSuspensionEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, new Date('2026-10-11T00:00:00Z'), 'restricted') },
  { kind: 'canceled', chip: 'Cancelamento · fatura cancelada', trigger: 'Admin: "Cancelar" em Recebimentos (cancelPlatformInvoice)',
    send: () => email.sendPlatformInvoiceCanceledEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, 'Condomínio em período de adaptação, cobrança iniciada por engano.', false) },
  { kind: 'canceled', chip: 'Cancelamento · corrigida e reemitida', trigger: 'Admin: "Corrigir e reemitir" em Recebimentos (correctPlatformInvoice)',
    send: () => email.sendPlatformInvoiceCanceledEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 17400, 'Usuários ativos contados a mais (cadastros duplicados).', true) },
  { kind: 'receipt', chip: 'Recibo · pagamento confirmado, PDF anexo', trigger: 'Confirmação do pagamento: webhook, reconciliação ou admin (settlePlatformInvoiceById)',
    send: async () => email.sendPlatformInvoiceReceiptEmail(sindica, 'Maria Silva', 'Residencial Templum', month, 9900, await receiptPdf()) },
  { kind: 'due', chip: 'Boleto · vence em 3 dias', trigger: 'Job diário 9h (notifyDueSoonInvoices)',
    send: () => email.sendInvoiceDueSoonEmail('joao.pereira@gmail.com', 'João Pereira', 'Residencial Templum', 'R$ 620,00', '25/09/2026') },
  { kind: 'overdue', chip: 'Boleto · vencido', trigger: 'Job diário 9h (transitionOverdueInvoices)',
    send: () => email.sendInvoiceOverdueEmail('ana.costa@gmail.com', 'Ana Costa', 'Residencial Templum', 'R$ 580,00', '18/09/2026') },
];

// Trecho da caixa de saída: o texto logo depois do "Olá, Fulano."
const snippetOf = (html: string) => {
  const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const afterGreeting = text.replace(/^.*?Olá, [^.]*\.\s*/, '');
  return afterGreeting.length > 90 ? `${afterGreeting.slice(0, 90).trimEnd()}…` : afterGreeting;
};

const page = (messages: object[], generatedAt: string) => `<title>Prévia de e-mails</title>
<style>
  :root{
    --ink:#17283e; --muted:#6f7e8d; --faint:#8a97a6;
    --bg:#eef1f5; --surface:#ffffff; --surface-2:#f6f8fb;
    --border:#e2e7ee; --accent:#255eab;
    --selected:#eaf1fb;
    --chip-due:#fff4e0; --chip-due-ink:#8a5a12;
    --chip-overdue:#fdeaea; --chip-overdue-ink:#a3312c;
    --chip-invoice:#eaf1fb; --chip-invoice-ink:#1f4f8f;
    --chip-receipt:#eaf8f3; --chip-receipt-ink:#0f6b5a;
    --chip-canceled:#eef0f3; --chip-canceled-ink:#4a5563;
    --chip-suspension:#f7e6f0; --chip-suspension-ink:#8a2a5e;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      color-scheme:dark;
      --ink:#e8edf5; --muted:#9fb0c3; --faint:#8395a9;
      --bg:#0f1620; --surface:#161f2c; --surface-2:#1b2534;
      --border:#28333f; --accent:#5b9bea;
      --selected:#1c2a3d;
      --chip-due:#3a2c11; --chip-due-ink:#e7bd76;
      --chip-overdue:#3a1c1c; --chip-overdue-ink:#e8918d;
      --chip-invoice:#16263d; --chip-invoice-ink:#8fbdf2;
      --chip-receipt:#12291f; --chip-receipt-ink:#6fd3b6;
      --chip-canceled:#232c38; --chip-canceled-ink:#b7c2cf;
      --chip-suspension:#351a2a; --chip-suspension-ink:#e79cc4;
    }
  }
  :root[data-theme="dark"]{
    color-scheme:dark;
    --ink:#e8edf5; --muted:#9fb0c3; --faint:#8395a9;
    --bg:#0f1620; --surface:#161f2c; --surface-2:#1b2534;
    --border:#28333f; --accent:#5b9bea;
    --selected:#1c2a3d;
    --chip-due:#3a2c11; --chip-due-ink:#e7bd76;
    --chip-overdue:#3a1c1c; --chip-overdue-ink:#e8918d;
    --chip-invoice:#16263d; --chip-invoice-ink:#8fbdf2;
    --chip-receipt:#12291f; --chip-receipt-ink:#6fd3b6;
    --chip-canceled:#232c38; --chip-canceled-ink:#b7c2cf;
    --chip-suspension:#351a2a; --chip-suspension-ink:#e79cc4;
  }
  *{box-sizing:border-box}
  body{margin:0; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    padding-inline:16px; padding-block:24px 40px;}
  .wrap{max-width:1000px; margin:0 auto; display:flex; flex-direction:column; gap:16px;}
  header{display:flex; flex-direction:column; gap:4px;}
  .eyebrow{font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--accent);}
  h1{margin:0; font-size:24px; font-weight:800; letter-spacing:-0.01em; text-wrap:balance;}
  .sub{margin:0; color:var(--muted); font-size:14px; line-height:1.5; max-width:68ch;}
  .client{display:grid; grid-template-columns:310px 1fr; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; min-height:640px;}
  .list{border-right:1px solid var(--border); background:var(--surface-2); display:flex; flex-direction:column; overflow-y:auto; max-height:760px;}
  .list-title{padding:14px 16px 6px; font-size:12px; font-weight:700; color:var(--faint); text-transform:uppercase; letter-spacing:.05em;}
  .item{display:flex; gap:10px; align-items:flex-start; text-align:left; padding:11px 14px; border:none; border-left:3px solid transparent; background:transparent; cursor:pointer; width:100%; font:inherit; color:inherit;}
  .item:hover{background:var(--selected);}
  .item:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}
  .item[aria-current="true"]{background:var(--selected); border-left-color:var(--accent);}
  .dot{width:8px; height:8px; border-radius:50%; background:var(--accent); margin-top:6px; flex-shrink:0;}
  .item-body{min-width:0; display:flex; flex-direction:column; gap:3px;}
  .item-subject{font-size:13.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .item-snippet{font-size:12.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .chip{align-self:flex-start; font-size:10.5px; font-weight:800; letter-spacing:.02em; padding:2px 7px; border-radius:100px; margin-top:2px;}
  .chip.invoice{background:var(--chip-invoice); color:var(--chip-invoice-ink);}
  .chip.due{background:var(--chip-due); color:var(--chip-due-ink);}
  .chip.overdue{background:var(--chip-overdue); color:var(--chip-overdue-ink);}
  .chip.receipt{background:var(--chip-receipt); color:var(--chip-receipt-ink);}
  .chip.canceled{background:var(--chip-canceled); color:var(--chip-canceled-ink);}
  .chip.suspension{background:var(--chip-suspension); color:var(--chip-suspension-ink);}
  .detail{display:flex; flex-direction:column; min-width:0;}
  .detail-head{padding:16px 20px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:8px;}
  .detail-subject{font-size:17px; font-weight:800; letter-spacing:-0.01em; overflow-wrap:anywhere;}
  .meta-grid{display:grid; grid-template-columns:auto 1fr; gap:2px 10px; font-size:12.5px; margin:0;}
  .meta-grid dt{color:var(--faint); font-weight:600;}
  .meta-grid dd{margin:0; overflow-wrap:anywhere;}
  .frame-wrap{flex:1; background:var(--bg); padding:20px;}
  iframe{width:100%; height:600px; border:1px solid var(--border); border-radius:10px; background:#fff; display:block;}
  .note{font-size:12.5px; line-height:1.5; color:var(--muted); margin:0; max-width:90ch;}
  .note b{color:var(--ink);}
  code{font-size:.92em;}
  @media (max-width:720px){
    .client{grid-template-columns:1fr;}
    .list{border-right:none; border-bottom:1px solid var(--border); flex-direction:row; overflow-x:auto; overflow-y:hidden; max-height:none;}
    .list-title{display:none;}
    .item{flex-direction:column; gap:6px; min-width:210px; border-left:none; border-bottom:3px solid transparent;}
    .item[aria-current="true"]{border-bottom-color:var(--accent);}
    .frame-wrap{padding:12px;}
  }
</style>

<div class="wrap">
  <header>
    <span class="eyebrow">Lar em Dia · e-mails transacionais</span>
    <h1>Prévia de e-mails</h1>
    <p class="sub">Os e-mails que o sistema envia hoje, com o assunto e o HTML gerados pelo próprio <code>emailService.ts</code> e dados de exemplo no lugar dos reais. Nenhum e-mail é enviado por esta página.</p>
  </header>

  <div class="client">
    <nav class="list" id="list" aria-label="Mensagens">
      <div class="list-title">Caixa de saída · ${messages.length} modelos</div>
    </nav>
    <section class="detail">
      <div class="detail-head">
        <div class="detail-subject" id="subjectOut"></div>
        <dl class="meta-grid">
          <dt>De</dt><dd>Lar em Dia &lt;no-reply@gestaolaremdia.com&gt;</dd>
          <dt>Para</dt><dd id="toOut"></dd>
          <dt>Enviado por</dt><dd id="triggerOut"></dd>
          <dt id="attachLabel">Anexo</dt><dd id="attachOut"></dd>
        </dl>
      </div>
      <div class="frame-wrap"><iframe id="frame" title="Corpo do e-mail"></iframe></div>
    </section>
  </div>

  <p class="note"><b>Nesta versão:</b> o e-mail de recibo leva o recibo em PDF anexo (o mesmo que o síndico baixa em Minhas faturas), para comprovar o pagamento na prestação de contas. A versão anterior acrescentou os lembretes da fatura, os cancelamentos, o novo código Pix e os avisos de suspensão.</p>
  <p class="note">Gerada em ${generatedAt} com <code>npm run emails:preview</code> (api/src/scripts/buildEmailPreview.ts). Quando um e-mail mudar, é só gerar de novo.</p>
</div>

<script>
(function(){
  const messages = ${JSON.stringify(messages).replace(/</g, '\\u003c')};
  const list = document.getElementById('list');
  const frame = document.getElementById('frame');
  const subjectOut = document.getElementById('subjectOut');
  const toOut = document.getElementById('toOut');
  const triggerOut = document.getElementById('triggerOut');
  const attachOut = document.getElementById('attachOut');
  const attachLabel = document.getElementById('attachLabel');
  const items = [];

  function render(index){
    const m = messages[index];
    subjectOut.textContent = m.subject;
    toOut.textContent = m.to;
    triggerOut.textContent = m.trigger;
    attachOut.textContent = m.attachments.length ? '📎 ' + m.attachments.join(', ') : '';
    attachOut.hidden = attachLabel.hidden = !m.attachments.length;
    frame.srcdoc = m.html;
    items.forEach((el, i) => el.setAttribute('aria-current', String(i === index)));
  }

  messages.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'item';
    btn.type = 'button';
    const dot = document.createElement('span'); dot.className = 'dot';
    const body = document.createElement('span'); body.className = 'item-body';
    const subject = document.createElement('span'); subject.className = 'item-subject'; subject.textContent = m.subject;
    const snippet = document.createElement('span'); snippet.className = 'item-snippet'; snippet.textContent = m.snippet;
    const chip = document.createElement('span'); chip.className = 'chip ' + m.kind; chip.textContent = m.chip;
    body.append(subject, snippet, chip);
    btn.append(dot, body);
    btn.addEventListener('click', () => render(i));
    list.appendChild(btn);
    items.push(btn);
  });

  // Abre no primeiro dos modelos novos desta versão (lembrete de vencimento).
  render(Math.max(0, messages.findIndex(m => m.chip.startsWith('Lembrete'))));
})();
</script>
`;

(async () => {
  const messages = [];
  for (const entry of entries) {
    captured = null;
    await entry.send();
    if (!captured) throw new Error(`nada capturado para "${entry.chip}"`);
    const { to, subject, html, attachments } = captured as Captured;
    messages.push({ kind: entry.kind, chip: entry.chip, trigger: entry.trigger, to, subject, html, attachments, snippet: snippetOf(html) });
  }
  const generatedAt = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  writeFileSync(outputPath, page(messages, generatedAt), 'utf8');
  console.log(`${messages.length} e-mails gerados em ${outputPath}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
