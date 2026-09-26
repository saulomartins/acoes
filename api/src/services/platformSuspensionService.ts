import { query } from '../db';
import { notifyUsers } from './notificationService';
import { sendPlatformSuspensionEmail } from './emailService';

// Política de inadimplência da assinatura da plataforma:
//   - 7, 15 e 25 dias de atraso: aviso ao síndico/subsíndico com a data da suspensão;
//   - 30 dias: gestão do condomínio em modo somente leitura (ver
//     middleware/auth.ts) — síndico/subsíndico continuam vendo tudo e podem
//     pagar; moradores (proprietário/inquilino — o app das lojas é só deles)
//     ficam com o acesso bloqueado, vendo só o aviso de suspensão;
//   - pagou (ou a fatura foi cancelada): libera na hora.
// A restrição NÃO é um estado gravado: é calculada a partir da fatura em
// aberto mais antiga, então qualquer pagamento, cancelamento ou prorrogação
// vale no mesmo instante, sem depender de job. O relógio de cada fatura é
// suspension_clock_from (vencimento, ou a data em que a política entrou —
// ver schema.sql).
export const SUSPENSION_AFTER_DAYS = 30;

// Estágios de aviso, do mais avançado pro menos: em cada rodada a fatura
// recebe só o aviso mais recente que ainda não recebeu (quem ficou dias sem
// rodar não recebe os três de uma vez).
const REMINDER_STAGES = [
  { stage: 4, daysLate: SUSPENSION_AFTER_DAYS },
  { stage: 3, daysLate: 25 },
  { stage: 2, daysLate: 15 },
  { stage: 1, daysLate: 7 },
] as const;

export type PlatformRestriction = {
  restricted: boolean;
  suspendsOn: string; // YYYY-MM-DD — primeiro dia com a gestão restrita
  extendedUntil: string | null;
};

// Data da suspensão = relógio da fatura em aberto mais antiga + 30 dias, ou o
// dia seguinte ao fim da prorrogação, o que for mais tarde (greatest ignora
// prorrogação nula). `i` = platform_invoices, `c` = condominiums.
const SUSPENDS_ON_SQL = `greatest(i.suspension_clock_from + ${SUSPENSION_AFTER_DAYS}, c.platform_suspension_extended_until + 1)`;

// Situação do condomínio frente à política — null quando não há fatura em
// aberto (nada a suspender).
export const getPlatformRestriction = async (condominiumId: string): Promise<PlatformRestriction | null> => {
  const result = await query<{ suspends_on: string; restricted: boolean; extended_until: string | null }>(
    `select to_char(${SUSPENDS_ON_SQL}, 'YYYY-MM-DD') as suspends_on, (${SUSPENDS_ON_SQL} <= current_date) as restricted,
            to_char(c.platform_suspension_extended_until, 'YYYY-MM-DD') as extended_until
     from platform_invoices i join condominiums c on c.id = i.condominium_id
     where i.condominium_id = $1 and i.status in ('pending','sent') and i.suspension_clock_from is not null
     order by i.suspension_clock_from asc limit 1`,
    [condominiumId],
  );
  const row = result.rows[0];
  return row ? { restricted: row.restricted, suspendsOn: row.suspends_on, extendedUntil: row.extended_until } : null;
};

export const isPlatformRestricted = async (condominiumId: string) => (await getPlatformRestriction(condominiumId))?.restricted === true;

// O que síndico/subsíndico ainda podem ALTERAR com a gestão restrita. Leitura
// (GET) é sempre liberada — ver tudo, exportar planilhas e baixar recibos.
//   /auth: login, troca de perfil/senha, aceite de termos, sair;
//   /condominiums/platform-invoice: "Já paguei — verificar pagamento";
//   /notifications: marcar como lida, registrar o aparelho pro push;
//   /support: destravar login e redefinir senha de morador — senão o morador
//   que perdeu o acesso ficaria preso por uma dívida que não é dele.
const WRITE_ALLOWED_WHILE_RESTRICTED = ['/auth/', '/condominiums/platform-invoice/', '/notifications/', '/support/'];

// `path` sem query string (req.baseUrl + req.path). A barra final evita que
// um prefixo case com outra rota que só começa igual.
export const isWriteAllowedWhileRestricted = (method: string, path: string) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  const normalized = path.endsWith('/') ? path : `${path}/`;
  return WRITE_ALLOWED_WHILE_RESTRICTED.some(prefix => normalized.startsWith(prefix));
};

// Moradores: bloqueio total (decisão de 26/09/2026) — nem leitura. Só passa o
// necessário pra o app mostrar o aviso e voltar sozinho depois do pagamento:
//   /auth: login, sessão, termos e /auth/access-status (o app pergunta se está suspenso);
//   /notifications/devices: registro do aparelho pro push — o app só registra
//   ao abrir, então bloquear aqui deixaria o morador sem push mesmo depois de
//   liberado.
const RESIDENT_ALLOWED_WHILE_SUSPENDED = ['/auth/', '/notifications/devices/'];

export const isResidentRequestAllowedWhileSuspended = (path: string) => {
  const normalized = path.endsWith('/') ? path : `${path}/`;
  return RESIDENT_ALLOWED_WHILE_SUSPENDED.some(prefix => normalized.startsWith(prefix));
};

// Neutra de propósito (decisão de 26/09/2026): não expõe ao morador o motivo
// da suspensão — só orienta a procurar a administração do condomínio.
export const RESIDENT_SUSPENDED_MESSAGE =
  'O acesso ao Lar em Dia está temporariamente indisponível para o seu condomínio. Para mais informações, entre em contato com a administração do condomínio.';

export const RESTRICTED_WRITE_MESSAGE =
  'A gestão do condomínio está em modo somente leitura porque a fatura da plataforma está em atraso há mais de 30 dias. '
  + 'Pague a fatura em "Minhas faturas" — o acesso completo volta automaticamente assim que o pagamento é confirmado.';

// Prorrogação dada pelo admin geral: nenhuma restrição até `until`
// (inclusive). Zera o estágio dos avisos das faturas em aberto, pra o
// síndico receber de novo os avisos com a data nova.
export const extendPlatformSuspension = async (condominiumId: string, until: string, note: string, adminId: string | null) => {
  const updated = await query(
    `update condominiums set platform_suspension_extended_until=$2, platform_suspension_extension_note=$3, platform_suspension_extended_by=$4
     where id=$1 returning id`,
    [condominiumId, until, note, adminId],
  );
  if (!updated.rows.length) return false;
  await query(`update platform_invoices set overdue_reminder_stage=0 where condominium_id=$1 and status in ('pending','sent')`, [condominiumId]);
  return true;
};

const formatDay = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const formatMonthLabel = (referenceMonth: string) =>
  new Date(`${referenceMonth.slice(0, 10)}T00:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Avisos da política (job diário). Só a fatura em aberto mais antiga de cada
// condomínio conta — é ela que define a suspensão. Cada estágio é
// "reivindicado" com update condicional, então duas rodadas simultâneas não
// mandam o mesmo aviso duas vezes. Os limites são contados a partir da data
// da suspensão (não do relógio), pra a prorrogação empurrar os avisos junto.
// Nunca lança.
export const notifyPlatformSuspensionReminders = async (): Promise<{ warnings: number; restricted: number }> => {
  const counts = { warnings: 0, restricted: 0 };
  for (const { stage, daysLate } of REMINDER_STAGES) {
    let claimed: { id: string; condominium_id: string; reference_month: string; amount_cents: number; suspends_on: string; condominium_name: string }[];
    try {
      claimed = (await query<any>(
        `update platform_invoices i set overdue_reminder_stage = $1
         from condominiums c
         where c.id = i.condominium_id and i.status in ('pending','sent') and i.suspension_clock_from is not null
           and i.overdue_reminder_stage < $1
           and current_date >= ${SUSPENDS_ON_SQL} - ${SUSPENSION_AFTER_DAYS - daysLate}
           and i.suspension_clock_from = (select min(o.suspension_clock_from) from platform_invoices o
                                          where o.condominium_id = i.condominium_id and o.status in ('pending','sent'))
         returning i.id, i.condominium_id, to_char(i.reference_month,'YYYY-MM-DD') as reference_month, i.amount_cents,
                   to_char(${SUSPENDS_ON_SQL}, 'YYYY-MM-DD') as suspends_on, c.name as condominium_name`,
        [stage],
      )).rows;
    } catch (error) {
      console.warn('platform suspension reminders failed', { stage, error });
      continue;
    }
    for (const row of claimed) {
      const restricted = stage === 4;
      try {
        const managers = (await query<{ id: string; full_name: string | null; username: string; email: string | null }>(
          `select id, full_name, username, email from users where condominium_id=$1 and role in ('sindico','subsindico') and deleted_at is null`,
          [row.condominium_id],
        )).rows;
        const month = formatMonthLabel(row.reference_month);
        await notifyUsers({
          condominiumId: row.condominium_id,
          recipientIds: managers.map(m => m.id),
          title: restricted ? 'Gestão em modo somente leitura' : `Fatura em atraso — suspensão em ${formatDay(row.suspends_on)}`,
          body: restricted
            ? `A fatura de ${month} (${formatCurrency(row.amount_cents)}) está em atraso há mais de ${SUSPENSION_AFTER_DAYS} dias. A gestão do condomínio ficou somente leitura e os moradores ficaram sem acesso ao aplicativo até o pagamento. Pague em "Minhas faturas" — a liberação é automática.`
            : `A fatura de ${month} (${formatCurrency(row.amount_cents)}) está em atraso. Se não for paga, a partir de ${formatDay(row.suspends_on)} a gestão do condomínio fica somente leitura e os moradores ficam sem acesso ao aplicativo. Pague pelo Pix na tela Início.`,
          screen: 'Home',
        });
        for (const manager of managers) {
          if (!manager.email) continue;
          try {
            await sendPlatformSuspensionEmail(manager.email, manager.full_name || manager.username, row.condominium_name, new Date(`${row.reference_month}T00:00:00Z`), row.amount_cents, new Date(`${row.suspends_on}T00:00:00Z`), restricted ? 'restricted' : 'warning');
          } catch (error) {
            console.warn('platform suspension email failed', error);
          }
        }
        if (restricted) counts.restricted += 1; else counts.warnings += 1;
      } catch (error) {
        console.warn('platform suspension notice failed', { invoiceId: row.id, error });
      }
    }
  }
  return counts;
};
