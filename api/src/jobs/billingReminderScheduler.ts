import cron from 'node-cron';
import { notifyDueSoonInvoices, transitionOverdueInvoices } from '../services/invoiceReminderService';

const runDailyChecks = async () => {
  try {
    const dueSoon = await notifyDueSoonInvoices();
    const overdue = await transitionOverdueInvoices();
    if (dueSoon || overdue) console.log(`Lembretes de boleto: ${dueSoon} vencendo em 3 dias, ${overdue} recém vencido(s).`);
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
  runDailyChecks();
};
