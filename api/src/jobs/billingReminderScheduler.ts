import cron from 'node-cron';
import { query } from '../db';
import { migrateAllCondominiumFilesToDrive } from '../services/driveMigrationService';
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
  // Retenção do request_log (origem de cada escrita): 180 dias bastam pra
  // investigar um "não fui eu" sem acumular IP/aparelho pra sempre (LGPD).
  // refresh_tokens NÃO é apagada: "Logou no sistema" (condominiumRoutes)
  // depende de existir pelo menos uma linha; lá só o IP/aparelho é limpo.
  try {
    await query(`delete from request_log where created_at < now() - interval '180 days'`);
    await query(
      `update refresh_tokens set ip_address = null, user_agent = null
       where ip_address is not null and coalesce(revoked_at, expires_at) < now() - interval '180 days'`,
    );
    // Cada renovação (a cada ~15 min de uso) cria uma linha e substitui a
    // anterior: sem limpeza a tabela cresce sem parar. Linha substituída há
    // mais de 30 dias não serve mais nem para a detecção de reuso (a sessão
    // vence em 14 dias sem uso) — e sempre há uma sucessora, então o usuário
    // nunca fica sem linha ("Logou no sistema" continua certo).
    await query(`delete from refresh_tokens where replaced_by is not null and revoked_at < now() - interval '30 days'`);
  } catch (error) {
    console.error('Falha na limpeza do request_log', error);
  }
  // Rede de segurança da migração para o Drive (a principal roda ao salvar a
  // pasta do condomínio): leva o que ainda estiver no banco.
  await migrateAllCondominiumFilesToDrive().catch(error => console.error('Falha na migração diária para o Drive', error));
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
