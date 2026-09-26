import cron from 'node-cron';
import { notifyDueSoonInvoices, transitionOverdueInvoices } from '../services/invoiceReminderService';
import { generatePlatformInvoices, notifyPlatformInvoiceReminders, reconcilePlatformInvoices, renewExpiredPlatformInvoicePix } from '../services/platformInvoiceService';
import { notifyPlatformSuspensionReminders } from '../services/platformSuspensionService';

const runDailyChecks = async () => {
  try {
    const dueSoon = await notifyDueSoonInvoices();
    const overdue = await transitionOverdueInvoices();
    if (dueSoon || overdue) console.log(`Lembretes de boleto: ${dueSoon} vencendo em 3 dias, ${overdue} recém vencido(s).`);
    // Fatura da plataforma do mês pra cada condomínio com plano (idempotente).
    const generated = await generatePlatformInvoices();
    if (generated.created) console.log(`Faturas da plataforma: ${generated.created} gerada(s).`);
    // Faturas da plataforma com Pix pendente: confirma as já pagas mesmo se o webhook não chegou.
    const reconciled = await reconcilePlatformInvoices();
    if (reconciled.paid) console.log(`Faturas da plataforma: ${reconciled.paid} pagamento(s) confirmado(s) na reconciliação.`);
    const reminders = await notifyPlatformInvoiceReminders();
    if (reminders.dueSoon || reminders.overdue) console.log(`Faturas da plataforma: ${reminders.dueSoon} lembrete(s) de vencimento, ${reminders.overdue} de atraso.`);
    // Política de inadimplência: avisos de 7/15/25 dias e o de gestão restrita (30).
    const suspension = await notifyPlatformSuspensionReminders();
    if (suspension.warnings || suspension.restricted) console.log(`Faturas da plataforma: ${suspension.warnings} aviso(s) de suspensão, ${suspension.restricted} condomínio(s) com gestão restrita.`);
  } catch (error) {
    console.error('Falha ao rodar os lembretes diários de boleto', error);
  }
};

// Primeiro job agendado do projeto: até aqui tudo era recompute preguiçoso
// em GET (ex.: invoices vira 'overdue' quando alguém abre a tela). Isso não
// serve pro aviso "vence em 3 dias" — precisa avisar mesmo que ninguém abra
// o app naquele dia, então precisa de um horário fixo de verdade.
//
// O Railway reinicia o processo em caso de falha (restartPolicy no
// railway.json); um timer em memória não sobrevive a isso. Por segurança,
// roda uma vez assim que o processo sobe (cobre o caso de o container ter
// ficado fora do ar no horário programado) e depois diariamente às 9h.
export const startBillingReminderScheduler = () => {
  cron.schedule('0 9 * * *', runDailyChecks, { timezone: 'America/Sao_Paulo' });
  // Sem depender do webhook do Mercado Pago: a cada 15 minutos confere os Pix
  // de faturas da plataforma ainda em aberto (poucas consultas — só as
  // pendentes) e confirma os pagos, com o recibo. O webhook, quando
  // cadastrado, só adianta essa confirmação.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const reconciled = await reconcilePlatformInvoices();
      if (reconciled.paid) console.log(`Faturas da plataforma: ${reconciled.paid} pagamento(s) confirmado(s) na reconciliação.`);
      // Pix expirado de fatura ainda em aberto: gera outro e reenvia por
      // e-mail (antes dependia do admin clicar "Gerar novo Pix"). Só aqui,
      // não no job diário das 9h — que coincide com esta rodada das 9h00.
      const renewal = await renewExpiredPlatformInvoicePix();
      if (renewal.renewed || renewal.paid || renewal.failed) {
        console.log(`Faturas da plataforma: Pix expirado — ${renewal.renewed} renovado(s), ${renewal.paid} já estava(m) pago(s), ${renewal.failed} com falha.`);
      }
    } catch (error) {
      console.error('Falha na reconciliação das faturas da plataforma', error);
    }
  }, { timezone: 'America/Sao_Paulo' });
  runDailyChecks();
};
