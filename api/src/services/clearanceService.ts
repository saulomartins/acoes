import { query } from '../db';

// Regra de elegibilidade do nada consta: qualquer valor em aberto barra a
// emissão, tenha vencido ou não. O termo declara quitação total, então não
// cabe emitir com boleto ou cobrança adicional pendente no nome do morador.
//
// BLOQUEIA: boleto em aberto (vencido ou a vencer), débito antigo (legacy),
// acordo de negociação rompido, parcela de cobrança adicional não paga.
// NÃO BLOQUEIA (só informa): acordo de negociação em dia — a dívida dele já
// aparece como boleto e barraria duas vezes.
export type Blocker = { source: 'invoice' | 'agreement' | 'extra_charge'; label: string; referenceMonth?: string; dueDate?: string; amountCents?: number };
export type Pending = { source: 'invoice' | 'agreement' | 'extra_charge'; label: string; referenceMonth?: string; dueDate?: string; amountCents?: number };
export type ClearanceCheck = { eligible: boolean; blockers: Blocker[]; pendings: Pending[]; checkedAt: string };

export const checkClearance = async (condominiumId: string, userId: string): Promise<ClearanceCheck> => {
  const blockers: Blocker[] = [];
  const pendings: Pending[] = [];

  // 1) Boletos: aberto = status fora de paid/canceled. Todos barram; a data
  // de vencimento só muda o texto mostrado ao morador.
  const invoices = await query<{
    id: string; amount_cents: number; status: string; invoice_type: string;
    due_date: string; reference_month: string | null; is_overdue: boolean;
  }>(
    `select id, amount_cents, status, invoice_type,
            to_char(due_date, 'YYYY-MM-DD') as due_date,
            to_char(coalesce(reference_month, due_date), 'YYYY-MM') as reference_month,
            (due_date < current_date) as is_overdue
     from invoices
     where user_id = $1 and condominium_id = $2 and deleted_at is null
       and status not in ('paid', 'canceled') and paid_at is null
     order by due_date`,
    [userId, condominiumId],
  );
  for (const invoice of invoices.rows) {
    const kind = invoice.invoice_type === 'legacy' ? 'Débito antigo' : 'Boleto';
    blockers.push({
      source: 'invoice',
      label: `${kind} ${invoice.is_overdue ? 'vencido' : 'em aberto (a vencer)'}`,
      referenceMonth: invoice.reference_month || undefined,
      dueDate: invoice.due_date,
      amountCents: invoice.amount_cents,
    });
  }

  // 2) Acordos: rompido barra; ativo/em risco em dia só informa.
  const agreements = await query<{ id: string; status: string; negotiated_total_cents: number }>(
    `select id, status, negotiated_total_cents from debt_agreements
     where debtor_user_id = $1 and condominium_id = $2
       and status in ('sent', 'accepted', 'active', 'at_risk', 'breached')`,
    [userId, condominiumId],
  );
  for (const agreement of agreements.rows) {
    if (agreement.status === 'breached') {
      blockers.push({ source: 'agreement', label: 'Acordo de negociação rompido', amountCents: agreement.negotiated_total_cents });
    } else {
      pendings.push({ source: 'agreement', label: `Acordo de negociação em andamento (${agreement.status})`, amountCents: agreement.negotiated_total_cents });
    }
  }

  // 3) Cobranças adicionais ainda não lançadas em boleto — também barram; as
  // já lançadas viram boleto e caem na checagem (1).
  const extras = await query<{ description: string; amount_cents: number; reference_month: string }>(
    `select ec.description, ins.amount_cents, to_char(ins.reference_month, 'YYYY-MM') as reference_month
     from unit_extra_charges ec
     join unit_extra_charge_installments ins on ins.charge_id = ec.id
     join unit_occupancies uo on uo.unit_id = ec.unit_id and uo.ended_at is null
     where uo.user_id = $1 and ec.condominium_id = $2 and ins.status = 'pending'
     order by ins.reference_month`,
    [userId, condominiumId],
  );
  for (const extra of extras.rows) {
    blockers.push({ source: 'extra_charge', label: `Cobrança adicional em aberto: ${extra.description}`, referenceMonth: extra.reference_month, amountCents: extra.amount_cents });
  }

  return { eligible: blockers.length === 0, blockers, pendings, checkedAt: new Date().toISOString() };
};
