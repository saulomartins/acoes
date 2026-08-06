import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { apiRequest, apiUpload } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { brazilianDateToIso, formatBrazilianDate, formatBrazilianMonth, maskBrazilianDate } from '../utils/date';

type Person = { id: string; full_name: string | null; username: string; unit: string | null };
type DebtAdjustment = {
  id: string;
  type: 'edit' | 'partial_payment' | 'delete';
  amountCents: number | null;
  previousAmountCents: number | null;
  previousDueDate: string | null;
  previousStatus: string | null;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};
type DebtRow = {
  id: string;
  payerId: string;
  referenceMonth: string;
  principalCents: number;
  dueDate: string;
  daysLate: number;
  status: string;
  fineCents: number;
  interestCents: number;
  updatedTotalCents: number;
  open: boolean;
  paidAt: string | null;
  payerName?: string;
  payerUnit?: string | null;
  payerRole?: string | null;
  frozenByAgreement?: boolean;
  invoiceType?: string;
  negotiationType?: string | null;
  judicialProcessNumber?: string | null;
  externalId?: string | null;
  inAgreement?: boolean;
  adjustments?: DebtAdjustment[];
  ownedElsewhere?: boolean;
};
type Agreement = { id:string;status:string;debtor_name:string;apartment:string;original_total_cents:number;negotiated_total_cents:number;installment_count:number;first_due_date:string;valid_until:string|null;sent_at:string|null;accepted_at:string|null;breached_at:string|null;breach_reason:string|null;notes:string|null;cancellation_reason:string|null;installments:Array<{id:string;number:number;amountCents:number;dueDate:string;invoiceId:string|null;status:string|null;canceledAt?:string|null;cancellationReason?:string|null}>;items:Array<{invoiceId:string;referenceMonth:string;dueDate:string;principalCents:number;fineCents:number;interestCents:number;frozenTotalCents:number;frozenAt:string}> };
type DebtData = {
  scope: 'person' | 'condominium';
  person: Person & { cpf: string };
  asOf: string;
  rules: { finePercent: number; dailyInterestPercent: number; fineType: string; interestType: string; legalBasis: string };
  rows: DebtRow[];
  totals: { principalCents: number; fineCents: number; interestCents: number; updatedTotalCents: number; openCount: number };
};
type PersonGroup = {
  payerId: string;
  payerName: string;
  payerRole: string;
  rows: DebtRow[];
  openCount: number;
  updatedTotalCents: number;
};
type UnitGroup = {
  unit: string;
  people: PersonGroup[];
  openCount: number;
  updatedTotalCents: number;
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const maskCurrency = (value: string) => money(Number(value.replace(/\D/g, '') || 0));
const currencyToCents = (value: string) => Number(value.replace(/\D/g, '') || 0);
const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const situation = (row: DebtRow) => row.status === 'paid' ? 'Pago' : row.daysLate > 0 ? 'Em atraso' : 'Em aberto';
const roleLabel = (role: string) => role === 'proprietario' ? 'Proprietário' : role === 'inquilino' ? 'Inquilino' : role ? role : 'Morador';
const agreementStatus:Record<string,string>={draft:'Rascunho',sent:'Aguardando seu aceite',accepted:'Aceito · aguardando boletos',active:'Acordo ativo',at_risk:'Acordo sob risco',breached:'Acordo rompido',settled:'Acordo quitado',rejected:'Proposta recusada',expired:'Proposta expirada',canceled:'Proposta cancelada'};
const installmentStatus=(status:string|null,invoiceId:string|null,canceledAt?:string|null)=>canceledAt?'Cancelada':!invoiceId?'Aguardando emissão':status==='paid'?'Pago':status==='overdue'?'Vencido':status==='canceled'?'Cancelado':'Em aberto';
const canCancelInstallment=(item:{invoiceId:string|null;status:string|null;canceledAt?:string|null})=>!item.canceledAt&&(!item.invoiceId||['paid','canceled'].includes(item.status||''));
const canDeleteAgreement=(agreement:Agreement)=>!['canceled','settled','rejected','expired'].includes(agreement.status)&&!agreement.cancellation_reason&&(agreement.installments||[]).every(item=>Boolean(item.canceledAt)||!item.invoiceId||item.status==='canceled');
const adjustmentLabel=(adjustment:DebtAdjustment)=>{
  const date=formatBrazilianDate(adjustment.createdAt);
  const author=adjustment.createdBy?` · ${adjustment.createdBy}`:'';
  const kind=adjustment.type==='delete'?'Excluído':adjustment.type==='partial_payment'?`Pagamento parcial de ${money(adjustment.amountCents||0)}`:'Editado';
  return `${kind} em ${date}${author}: ${adjustment.reason}`;
};

export default function Debts({ navigation }: any) {
  const { isMobile: compact } = useBreakpoint();
  const { userToken, user, condominiumFeatures } = useContext(AuthContext);
  const manager = ['sindico', 'subsindico'].includes(user?.role || '');
  const agreementEnabled = condominiumFeatures?.historico_acordos === true;
  const [data, setData] = useState<DebtData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreements,setAgreements]=useState<Agreement[]>([]);
  const [negotiating,setNegotiating]=useState<string|null>(null);
  const [installments,setInstallments]=useState('3');
  const [firstDueDate,setFirstDueDate]=useState(()=>{const date=new Date();date.setDate(date.getDate()+10);return date.toLocaleDateString('pt-BR')});
  const [justifyingAgreement,setJustifyingAgreement]=useState<string|null>(null);
  const [justification,setJustification]=useState('');
  const [shouldRecalculate,setShouldRecalculate]=useState(false);
  const [detailsPerson,setDetailsPerson]=useState<PersonGroup|null>(null);
  const [detailsInstallmentsAgreement,setDetailsInstallmentsAgreement]=useState<Agreement|null>(null);
  const [notice,setNotice]=useState('');

  const [showLegacyForm,setShowLegacyForm]=useState(false);
  const [legacyMode,setLegacyMode]=useState<'manual'|'import'>('manual');
  const [people,setPeople]=useState<Person[]>([]);
  const [legacyPersonSearch,setLegacyPersonSearch]=useState('');
  const [legacySelectedPersonId,setLegacySelectedPersonId]=useState('');
  const [legacyAmount,setLegacyAmount]=useState('');
  const [legacyDueDate,setLegacyDueDate]=useState('');
  const [legacyNegotiationType,setLegacyNegotiationType]=useState<'none'|'private'|'judicial'>('none');
  const [legacyProcessNumber,setLegacyProcessNumber]=useState('');
  const [legacyNotes,setLegacyNotes]=useState('');
  const [legacyAlreadyNegotiated,setLegacyAlreadyNegotiated]=useState(false);
  const [legacyNegotiatedTotal,setLegacyNegotiatedTotal]=useState('');
  const [legacyInstallments,setLegacyInstallments]=useState('1');
  const [legacyFirstDueDate,setLegacyFirstDueDate]=useState('');
  const [legacySubmitting,setLegacySubmitting]=useState(false);
  const [legacyImportFile,setLegacyImportFile]=useState<File|{uri:string;name:string;mimeType?:string}|null>(null);
  const [legacyImporting,setLegacyImporting]=useState(false);
  const [legacyImportResult,setLegacyImportResult]=useState<{total:number;created:number;paid:number;duplicates:number;invalid:number;issues:Array<{row:number;message:string}>}|null>(null);

  const [editingDebt,setEditingDebt]=useState<DebtRow|null>(null);
  const [editAmount,setEditAmount]=useState('');
  const [editDueDate,setEditDueDate]=useState('');
  const [editNotes,setEditNotes]=useState('');
  const [editMarkPaid,setEditMarkPaid]=useState(false);
  const [editPaidAt,setEditPaidAt]=useState('');
  const [editReason,setEditReason]=useState('');
  const [editSubmitting,setEditSubmitting]=useState(false);

  const [payingDebt,setPayingDebt]=useState<DebtRow|null>(null);
  const [paymentAmount,setPaymentAmount]=useState('');
  const [paymentDate,setPaymentDate]=useState('');
  const [paymentReason,setPaymentReason]=useState('');
  const [paymentSubmitting,setPaymentSubmitting]=useState(false);

  const [deletingDebt,setDeletingDebt]=useState<DebtRow|null>(null);
  const [deleteReason,setDeleteReason]=useState('');
  const [deleteSubmitting,setDeleteSubmitting]=useState(false);

  const [cancelingInstallment,setCancelingInstallment]=useState<{agreementId:string;installmentId:string;number:number}|null>(null);
  const [installmentCancelReason,setInstallmentCancelReason]=useState('');
  const [installmentCancelSubmitting,setInstallmentCancelSubmitting]=useState(false);

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true);
    setError('');
    try {
      const [debts, agreementData, peopleData] = await Promise.all([
        apiRequest<DebtData>(`/debts?asOf=${todayIso()}`, userToken),
        agreementEnabled ? apiRequest<{ agreements: Agreement[] }>('/agreements', userToken) : Promise.resolve({agreements:[]}),
        manager ? apiRequest<{ users: Person[] }>('/users', userToken) : Promise.resolve({users:[]}),
      ]);
      setData(debts);
      setAgreements(agreementData.agreements);
      setPeople(peopleData.users);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os débitos.');
    } finally {
      setLoading(false);
    }
  }, [userToken, manager, agreementEnabled]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const groupByUnit = (rows: DebtRow[], fallbackUnit: string | null | undefined): UnitGroup[] => {
    const unitGroups = new Map<string, Map<string, DebtRow[]>>();
    rows.forEach(row => {
      const unit = row.payerUnit?.trim() || fallbackUnit?.trim() || 'Sem apartamento';
      const people = unitGroups.get(unit) || new Map<string, DebtRow[]>();
      people.set(row.payerId, [...(people.get(row.payerId) || []), row]);
      unitGroups.set(unit, people);
    });
    return Array.from(unitGroups, ([unit, people]) => {
      const personGroups = Array.from(people, ([payerId, personRows]) => {
        const orderedRows = [...personRows].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth) || b.dueDate.localeCompare(a.dueDate));
        const openRows = orderedRows.filter(row => row.open);
        return {
          payerId,
          payerName: personRows[0].payerName || personRows[0].payerId,
          payerRole: personRows[0].payerRole || '',
          rows: orderedRows,
          openCount: openRows.length,
          updatedTotalCents: openRows.reduce((sum, row) => sum + row.updatedTotalCents, 0),
        };
      }).sort((a, b) => {
        const rank = (role: string) => role === 'proprietario' ? 0 : role === 'inquilino' ? 1 : 2;
        return rank(a.payerRole) - rank(b.payerRole) || a.payerName.localeCompare(b.payerName, 'pt-BR');
      });
      return {
        unit,
        people: personGroups,
        openCount: personGroups.reduce((sum, p) => sum + p.openCount, 0),
        updatedTotalCents: personGroups.reduce((sum, p) => sum + p.updatedTotalCents, 0),
      };
    }).sort((a, b) => a.unit.localeCompare(b.unit, 'pt-BR', { numeric: true }));
  };

  const units = useMemo<UnitGroup[]>(() => {
    if (!data) return [];
    return groupByUnit(data.rows.filter(row => !row.ownedElsewhere), data.person.unit);
  }, [data]);

  const ownedElsewhereUnits = useMemo<UnitGroup[]>(() => {
    if (!data) return [];
    return groupByUnit(data.rows.filter(row => row.ownedElsewhere), null);
  }, [data]);

  const filteredLegacyPeople = useMemo(() => {
    const term = legacyPersonSearch.trim().toLocaleLowerCase('pt-BR');
    if (term.length < 2) return [];
    return people.filter(person => (person.full_name || person.username).toLocaleLowerCase('pt-BR').includes(term)).slice(0, 8);
  }, [people, legacyPersonSearch]);
  const legacySelectedPerson = people.find(person => person.id === legacySelectedPersonId);

  const resetLegacyForm = () => {
    setShowLegacyForm(false);
    setLegacyMode('manual');
    setLegacyPersonSearch('');
    setLegacySelectedPersonId('');
    setLegacyAmount('');
    setLegacyDueDate('');
    setLegacyNegotiationType('none');
    setLegacyProcessNumber('');
    setLegacyNotes('');
    setLegacyAlreadyNegotiated(false);
    setLegacyNegotiatedTotal('');
    setLegacyInstallments('1');
    setLegacyFirstDueDate('');
    setLegacyImportFile(null);
    setLegacyImportResult(null);
  };

  const selectLegacyImportFile = (event: any) => {
    setLegacyImportFile((event?.target?.files?.[0] as File) || null);
    setLegacyImportResult(null);
    setError('');
  };
  const selectLegacyImportFileNative = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setLegacyImportFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    setLegacyImportResult(null);
    setError('');
  };
  const importLegacyDebts = async () => {
    if (!userToken || !legacySelectedPersonId || !legacyImportFile) return;
    setLegacyImporting(true);
    setError('');
    setNotice('');
    try {
      const result = await apiUpload<{ message: string; total: number; created: number; paid: number; duplicates: number; invalid: number; issues: Array<{ row: number; message: string }> }>(
        `/invoices/legacy/import?userId=${legacySelectedPersonId}`,
        userToken,
        legacyImportFile,
      );
      setLegacyImportResult(result);
      setLegacyImportFile(null);
      setNotice(result.message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao importar a planilha.');
    } finally {
      setLegacyImporting(false);
    }
  };

  const createLegacyDebt = async () => {
    if (!userToken || !legacySelectedPersonId) return;
    const dueDateIso = brazilianDateToIso(legacyDueDate);
    if (!dueDateIso) { setError('Informe a data de vencimento original no formato DD/MM/AAAA.'); return; }
    if (legacyNegotiationType === 'judicial' && !legacyProcessNumber.trim()) { setError('Informe o número do processo judicial.'); return; }
    const body: any = {
      userId: legacySelectedPersonId,
      amountCents: currencyToCents(legacyAmount),
      dueDate: dueDateIso,
      negotiationType: legacyNegotiationType === 'none' ? null : legacyNegotiationType,
      judicialProcessNumber: legacyNegotiationType === 'judicial' ? legacyProcessNumber.trim() : null,
      notes: legacyNotes.trim() || null,
      alreadyNegotiated: legacyAlreadyNegotiated,
    };
    if (legacyAlreadyNegotiated) {
      const firstDueDateIso = brazilianDateToIso(legacyFirstDueDate);
      if (!firstDueDateIso) { setError('Informe a data da primeira parcela do débito já negociado.'); return; }
      body.negotiatedTotalCents = currencyToCents(legacyNegotiatedTotal);
      body.installmentCount = Number(legacyInstallments);
      body.firstDueDate = firstDueDateIso;
    }
    setLegacySubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await apiRequest<{ message: string }>('/invoices/legacy', userToken, { method: 'POST', body: JSON.stringify(body) });
      setNotice(result.message);
      resetLegacyForm();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao cadastrar o débito antigo.');
    } finally {
      setLegacySubmitting(false);
    }
  };

  const communicate=async(unit:string,person:PersonGroup)=>{if(!userToken)return;const open=person.rows.filter(row=>row.open);if(!open.length)return;setLoading(true);setError('');setNotice('');try{const result=await apiRequest<{whatsappUrl:string|null;sentAutomatically:boolean}>('/agreements/communicate-debt',userToken,{method:'POST',body:JSON.stringify({userId:person.payerId,invoiceIds:open.map(row=>row.id)})});if(result.sentAutomatically){setNotice('Mensagem enviada automaticamente pelo WhatsApp oficial do condomínio.')}else if(result.whatsappUrl){await Linking.openURL(result.whatsappUrl)}await load()}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao preparar a comunicação.')}finally{setLoading(false)}};
  const createAgreement=async(unit:string,person:PersonGroup)=>{if(!userToken)return;const dueDateIso=brazilianDateToIso(firstDueDate);if(!dueDateIso){setError('Informe o primeiro vencimento no formato DD/MM/AAAA.');return}const open=person.rows.filter(row=>row.open);if(!open.length)return;setLoading(true);try{await apiRequest('/agreements',userToken,{method:'POST',body:JSON.stringify({debtorUserId:person.payerId,invoiceIds:open.map(row=>row.id),installmentCount:Number(installments),firstDueDate:dueDateIso,notes:`Negociação dos débitos do apartamento ${unit} (${roleLabel(person.payerRole)})`})});setNegotiating(null);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao criar a proposta.')}finally{setLoading(false)}};
  const agreementAction=async(agreement:Agreement,action:'send'|'accept'|'issue')=>{if(!userToken)return;setLoading(true);try{await apiRequest(`/agreements/${agreement.id}/${action}`,userToken,{method:'POST'});await load()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar o acordo.')}finally{setLoading(false)}};
  
  const submitCancellation=async()=>{if(!justifyingAgreement||!userToken)return;setLoading(true);try{await apiRequest(`/agreements/${justifyingAgreement}/mark-all-canceled`,userToken,{method:'POST',body:JSON.stringify({cancellationReason:justification,recalculateValue:shouldRecalculate})});setJustifyingAgreement(null);setJustification('');setShouldRecalculate(false);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao registrar cancelamento.')}finally{setLoading(false)}};

  const openEditDebt=(row:DebtRow)=>{setEditingDebt(row);setEditAmount(money(row.principalCents));setEditDueDate(formatBrazilianDate(row.dueDate));setEditNotes('');setEditMarkPaid(false);setEditPaidAt(formatBrazilianDate(todayIso()));setEditReason('')};
  const submitEditDebt=async()=>{
    if(!editingDebt||!userToken)return;
    const dueDateIso=brazilianDateToIso(editDueDate);
    if(!dueDateIso){setError('Informe o vencimento no formato DD/MM/AAAA.');return}
    if(!editReason.trim()){setError('Informe o motivo da edição.');return}
    if(editMarkPaid&&!brazilianDateToIso(editPaidAt)){setError('Informe a data em que o débito foi pago.');return}
    setEditSubmitting(true);setError('');setNotice('');
    try{
      const body:any={amountCents:currencyToCents(editAmount),dueDate:dueDateIso,notes:editNotes.trim()||null,reason:editReason.trim()};
      if(editMarkPaid){body.markPaid=true;body.paidAt=brazilianDateToIso(editPaidAt)}
      const result=await apiRequest<{message:string}>(`/debts/${editingDebt.id}`,userToken,{method:'PATCH',body:JSON.stringify(body)});
      setNotice(result.message);setEditingDebt(null);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao editar o débito.')}finally{setEditSubmitting(false)}
  };

  const openPartialPayment=(row:DebtRow)=>{setPayingDebt(row);setPaymentAmount('');setPaymentDate(formatBrazilianDate(todayIso()));setPaymentReason('')};
  const submitPartialPayment=async()=>{
    if(!payingDebt||!userToken)return;
    const paidAtIso=brazilianDateToIso(paymentDate);
    if(!paidAtIso){setError('Informe a data do pagamento no formato DD/MM/AAAA.');return}
    if(!paymentReason.trim()){setError('Informe o motivo do pagamento parcial.');return}
    const amountCents=currencyToCents(paymentAmount);
    if(amountCents<=0){setError('Informe um valor de pagamento válido.');return}
    setPaymentSubmitting(true);setError('');setNotice('');
    try{
      const result=await apiRequest<{message:string}>(`/debts/${payingDebt.id}/partial-payment`,userToken,{method:'POST',body:JSON.stringify({amountCents,paidAt:paidAtIso,reason:paymentReason.trim()})});
      setNotice(result.message);setPayingDebt(null);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao registrar o pagamento parcial.')}finally{setPaymentSubmitting(false)}
  };

  const openDeleteDebt=(row:DebtRow)=>{setDeletingDebt(row);setDeleteReason('')};
  const submitDeleteDebt=async()=>{
    if(!deletingDebt||!userToken)return;
    if(!deleteReason.trim()){setError('Informe o motivo da exclusão.');return}
    setDeleteSubmitting(true);setError('');setNotice('');
    try{
      const result=await apiRequest<{message:string}>(`/debts/${deletingDebt.id}`,userToken,{method:'DELETE',body:JSON.stringify({reason:deleteReason.trim()})});
      setNotice(result.message);setDeletingDebt(null);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao excluir o débito.')}finally{setDeleteSubmitting(false)}
  };

  const openCancelInstallment=(agreementId:string,installmentId:string,number:number)=>{setCancelingInstallment({agreementId,installmentId,number});setInstallmentCancelReason('')};
  const submitCancelInstallment=async()=>{
    if(!cancelingInstallment||!userToken)return;
    if(!installmentCancelReason.trim()){setError('Informe o motivo do cancelamento da parcela.');return}
    setInstallmentCancelSubmitting(true);setError('');setNotice('');
    try{
      await apiRequest(`/agreements/${cancelingInstallment.agreementId}/installments/${cancelingInstallment.installmentId}`,userToken,{method:'DELETE',body:JSON.stringify({cancellationReason:installmentCancelReason.trim()})});
      setNotice('Parcela cancelada.');setCancelingInstallment(null);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao cancelar a parcela.')}finally{setInstallmentCancelSubmitting(false)}
  };

  const renderUnitGroup = (group: UnitGroup) => <View key={group.unit} style={styles.unitCard}>
    <View style={styles.unitHeader}>
      <View style={styles.unitIdentity}>
        <Text style={styles.unitLabel}>APARTAMENTO</Text>
        <Text style={styles.unitTitle}>{group.unit}</Text>
      </View>
      <View style={styles.unitTotalBox}>
        <Text style={styles.openBadge}>{group.openCount} em aberto</Text>
        <Text style={styles.unitTotalLabel}>Total atualizado</Text>
        <Text style={styles.unitTotal}>{money(group.updatedTotalCents)}</Text>
      </View>
    </View>

    {group.people.map(person => (
      <View key={person.payerId} style={styles.personCard}>
        <View style={styles.personHeader}>
          <View style={styles.grow}>
            <Text style={styles.personRole}>{roleLabel(person.payerRole).toUpperCase()}</Text>
            <Text style={styles.personName}>{person.payerName}</Text>
          </View>
          <View style={styles.personTotalBox}>
            <Text style={styles.personOpenBadge}>{person.openCount} em aberto</Text>
            <Text style={styles.personTotal}>{money(person.updatedTotalCents)}</Text>
          </View>
        </View>

        {manager&&agreementEnabled&&person.openCount>0?<View style={styles.unitActions}><Pressable onPress={()=>communicate(group.unit,person)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Comunicar por WhatsApp</Text></Pressable><Pressable onPress={()=>setNegotiating(current=>current===person.payerId?null:person.payerId)} style={styles.primaryAction}><Text style={styles.primaryActionText}>Criar proposta de acordo</Text></Pressable></View>:null}
        {manager&&negotiating===person.payerId?<View style={styles.proposalForm}><Text style={styles.proposalTitle}>Nova proposta · {money(person.updatedTotalCents)}</Text><View style={styles.formRow}><View style={styles.field}><Text style={styles.fieldLabel}>Quantidade de parcelas</Text><TextInput value={installments} onChangeText={setInstallments} keyboardType="number-pad" style={styles.input}/></View><View style={styles.field}><Text style={styles.fieldLabel}>Primeiro vencimento</Text><TextInput value={firstDueDate} onChangeText={value=>setFirstDueDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input}/></View><View style={styles.formButton}><AppButton title="Salvar proposta" onPress={()=>createAgreement(group.unit,person)} disabled={loading||!brazilianDateToIso(firstDueDate)}/></View></View><Text style={styles.formHint}>A dívida será congelada somente depois que o responsável aceitar a proposta.</Text></View>:null}

        <Pressable onPress={() => setDetailsPerson(person)} style={styles.debtTableTrigger}>
          <Text style={styles.debtTableTriggerText}>Ver tabela de débitos ({person.rows.length})</Text>
          <Text style={styles.debtChevron}>›</Text>
        </Pressable>
      </View>
    ))}
  </View>;

  return <ScrollView contentContainerStyle={[styles.container,compact&&styles.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={styles.eyebrow}>FINANCEIRO</Text>
      <Text style={styles.title}>Gestão de débitos por apartamento</Text>
      <Text style={styles.subtitle}>Cada apartamento apresenta suas referências mensais, encargos e total atualizado diariamente.</Text>

      <View style={styles.updateBox}>
        <View style={styles.updateCopy}>
          <Text style={styles.updateTitle}>Atualização automática</Text>
          <Text style={styles.updateText}>{data ? `Multa de ${percent(data.rules.finePercent)}% e mora de ${percent(data.rules.dailyInterestPercent)}% ao dia, recalculadas pela data atual a cada atualização.` : 'Multa e mora recalculadas pela data atual a cada atualização.'}</Text>
          {data ? <Text style={styles.updateDate}>Posição em {formatBrazilianDate(data.asOf)}</Text> : null}
        </View>
        <View style={styles.updateAction}><AppButton title={loading ? 'Atualizando...' : 'Atualizar agora'} onPress={load} disabled={loading} /></View>
      </View>

      {manager ? <View style={styles.legacyTrigger}><AppButton title="Cadastrar débito antigo" onPress={() => setShowLegacyForm(true)} variant="secondary" /></View> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {data ? <>
        <View style={styles.summaryRow}>
          <View style={styles.summary}><Text style={styles.summaryValue}>{units.length}</Text><Text style={styles.summaryLabel}>apartamentos listados</Text></View>
          <View style={styles.summary}><Text style={styles.summaryValue}>{data.totals.openCount}</Text><Text style={styles.summaryLabel}>referências em aberto</Text></View>
          <View style={styles.summaryTotal}><Text style={styles.summaryTotalValue}>{money(data.totals.updatedTotalCents)}</Text><Text style={styles.summaryTotalLabel}>total atualizado do condomínio</Text></View>
        </View>

        {agreements.length?<View style={styles.agreements}><Text style={styles.sectionTitle}>Propostas e acordos</Text><Text style={styles.sectionHint}>{manager?'Acompanhe propostas, aceites e emissão das parcelas.':'Consulte abaixo todos os valores, débitos incluídos, vencimentos e situação do seu acordo.'}</Text>{agreements.map(agreement=>{const discount=Math.max(0,agreement.original_total_cents-agreement.negotiated_total_cents);const orderedItems=[...(agreement.items||[])].sort((a,b)=>b.referenceMonth.localeCompare(a.referenceMonth));const orderedInstallments=[...(agreement.installments||[])].sort((a,b)=>a.number-b.number);const paid=orderedInstallments.filter(item=>item.status==='paid').length;return <View key={agreement.id} style={[styles.agreementCard,agreement.status==='breached'&&styles.agreementCardDanger]}>
          <View style={styles.agreementHeader}><View style={styles.grow}><Text style={styles.agreementCode}>ACORDO {agreement.id.slice(0,8).toUpperCase()}</Text><Text style={styles.agreementTitle}>{agreement.apartment} · {agreement.debtor_name}</Text></View><Text style={[styles.agreementStatus,agreement.status==='breached'&&styles.agreementStatusDanger,agreement.status==='settled'&&styles.agreementStatusSuccess]}>{agreementStatus[agreement.status]||agreement.status}</Text></View>
          <View style={styles.agreementValues}><View style={styles.agreementValueBox}><Text style={styles.valueLabel}>Dívida original</Text><Text style={styles.valueText}>{money(agreement.original_total_cents)}</Text></View><View style={styles.agreementValueBox}><Text style={styles.valueLabel}>Valor negociado</Text><Text style={styles.valueStrong}>{money(agreement.negotiated_total_cents)}</Text></View><View style={styles.agreementValueBox}><Text style={styles.valueLabel}>Condição</Text><Text style={styles.valueText}>{agreement.installment_count} parcela(s)</Text></View>{discount>0?<View style={styles.agreementValueBox}><Text style={styles.valueLabel}>Redução negociada</Text><Text style={styles.discountValue}>{money(discount)}</Text></View>:null}</View>
          <View style={styles.agreementInfo}><Text style={styles.infoText}>Primeiro vencimento: <Text style={styles.infoStrong}>{formatBrazilianDate(agreement.first_due_date)}</Text></Text>{agreement.valid_until?<Text style={styles.infoText}>Proposta válida até: <Text style={styles.infoStrong}>{formatBrazilianDate(agreement.valid_until)}</Text></Text>:null}{agreement.accepted_at?<Text style={styles.infoText}>Aceito em: <Text style={styles.infoStrong}>{formatBrazilianDate(agreement.accepted_at)}</Text></Text>:null}{agreement.notes?<Text style={styles.infoText}>Observação: <Text style={styles.infoStrong}>{agreement.notes}</Text></Text>:null}</View>
          {orderedItems.length?<View style={styles.agreementSection}><Text style={styles.agreementSectionTitle}>Débitos incluídos no acordo</Text>{orderedItems.map(item=><View key={item.invoiceId} style={styles.detailRow}><View style={styles.grow}><Text style={styles.detailTitle}>Referência {formatBrazilianMonth(item.referenceMonth)}</Text><Text style={styles.detailMeta}>Vencimento original {formatBrazilianDate(item.dueDate)} · cálculo congelado em {formatBrazilianDate(item.frozenAt)}</Text></View><View style={styles.detailAmounts}><Text style={styles.detailMeta}>Taxa {money(item.principalCents)} + encargos {money(item.fineCents+item.interestCents)}</Text><Text style={styles.detailTotal}>{money(item.frozenTotalCents)}</Text></View></View>)}</View>:null}
          <Pressable onPress={()=>setDetailsInstallmentsAgreement(agreement)} style={styles.installmentTrigger}><View style={styles.installmentHeader}><Text style={styles.agreementSectionTitle}>Parcelas do acordo</Text><Text style={styles.progress}>{paid}/{agreement.installment_count} paga(s)</Text></View><Text style={styles.debtChevron}>Ver parcelas ›</Text></Pressable>
          {agreement.status==='breached'?<View style={styles.breachBox}><Text style={styles.breachTitle}>Acordo rompido</Text><Text style={styles.breachText}>{agreement.breach_reason||'As condições do acordo não foram cumpridas.'} Os débitos originais voltaram a receber atualização de multa e mora.</Text></View>:null}
          <View style={styles.agreementActions}>{manager&&agreement.status==='draft'?<View style={styles.smallAction}><AppButton title="Enviar proposta" onPress={()=>agreementAction(agreement,'send')} disabled={loading}/></View>:null}{!manager&&agreement.status==='sent'?<View style={styles.acceptAction}><AppButton title="Li as condições e aceito o acordo" onPress={()=>agreementAction(agreement,'accept')} disabled={loading}/></View>:null}{manager&&agreement.status==='accepted'?<View style={styles.smallAction}><AppButton title="Gerar boletos" onPress={()=>agreementAction(agreement,'issue')} disabled={loading}/></View>:null}{manager&&canDeleteAgreement(agreement)?<View style={styles.smallAction}><AppButton title="Excluir acordo" onPress={()=>{setJustifyingAgreement(agreement.id);setJustification('');setShouldRecalculate(false)}} disabled={loading}/></View>:null}</View>
        </View>})}</View>:null}

        {units.length ? units.map(group => renderUnitGroup(group)) : <EmptyState title="Nenhum débito encontrado" description={manager ? 'Não há cobranças registradas para os apartamentos.' : 'Não há cobranças registradas para o seu apartamento.'} />}

        {!manager && ownedElsewhereUnits.length ? <View style={styles.ownedElsewhereSection}>
          <Text style={styles.sectionTitle}>Apartamentos que você acompanha</Text>
          <Text style={styles.sectionHint}>Você é proprietário adicional dessas unidades — só visualização, o morador é quem responde pela cobrança.</Text>
          {ownedElsewhereUnits.map(group => renderUnitGroup(group))}
        </View> : null}
      </> : null}

      <Modal visible={!!detailsPerson} transparent animationType="fade" onRequestClose={() => setDetailsPerson(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.personTableModalContent}>
            {detailsPerson && <>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, styles.modalTitleFlex]}>{roleLabel(detailsPerson.payerRole)} · {detailsPerson.payerName}</Text>
              <Pressable onPress={() => setDetailsPerson(null)} style={styles.modalCloseButton} accessibilityLabel="Fechar" hitSlop={8}>
                <Text style={styles.modalCloseButtonText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 14 }} style={styles.modalScrollBody}>
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <Text style={[styles.headerCell, styles.referenceCell]}>Referência</Text>
                    <Text style={[styles.headerCell, styles.alignRight]}>Taxa</Text>
                    <Text style={styles.headerCell}>Vencimento</Text>
                    <Text style={[styles.headerCell, styles.alignCenter]}>Dias de atraso</Text>
                    <Text style={[styles.headerCell, styles.alignRight]}>Multa{data ? ` ${percent(data.rules.finePercent)}%` : ''}</Text>
                    <Text style={[styles.headerCell, styles.alignRight]}>Mora{data ? ` ${percent(data.rules.dailyInterestPercent)}% a.d.` : ''}</Text>
                    <Text style={[styles.headerCell, styles.alignRight]}>Total atualizado</Text>
                    <Text style={styles.headerCell}>Situação</Text>
                    {manager ? <Text style={[styles.headerCell, styles.actionsCell]}>Ações</Text> : null}
                  </View>
                  {detailsPerson.rows.map(row => (
                    <View key={row.id} style={[styles.tableRow, row.daysLate > 0 && row.open && styles.lateRow, !row.open && styles.paidRow]}>
                      <View style={styles.referenceCellWrap}>
                        <Text style={[styles.cellText, styles.reference]}>{formatBrazilianMonth(row.referenceMonth)}</Text>
                        {row.invoiceType === 'legacy' ? (
                          <Text style={[styles.legacyTag, row.negotiationType === 'judicial' && styles.legacyTagJudicial]}>
                            {row.negotiationType === 'judicial' ? `JUDICIAL · Nº ${row.judicialProcessNumber}` : row.negotiationType === 'private' ? 'NEGOCIADO' : 'DÉBITO ANTIGO'}
                          </Text>
                        ) : null}
                        {row.adjustments?.length ? (
                          <View style={styles.adjustmentsList}>
                            {row.adjustments.map(adjustment => <Text key={adjustment.id} style={styles.adjustmentText}>{adjustmentLabel(adjustment)}</Text>)}
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.cell, styles.alignRight]}>{money(row.principalCents)}</Text>
                      <Text style={styles.cell}>{formatBrazilianDate(row.dueDate)}</Text>
                      <Text style={[styles.cell, styles.alignCenter]}>{row.daysLate}</Text>
                      <Text style={[styles.cell, styles.alignRight]}>{money(row.fineCents)}</Text>
                      <Text style={[styles.cell, styles.alignRight]}>{money(row.interestCents)}</Text>
                      <Text style={[styles.cell, styles.amount, styles.alignRight]}>{money(row.updatedTotalCents)}</Text>
                      <Text style={[styles.cell, styles.status, row.daysLate > 0 && row.open && styles.statusLate, !row.open && styles.statusPaid]}>
                        {row.frozenByAgreement ? 'Em acordo' : situation(row)}
                      </Text>
                      {manager ? (
                        <View style={[styles.cell, styles.actionsCell, styles.actionsCellRow]}>
                          <Pressable onPress={() => openEditDebt(row)} style={styles.rowActionBtn}><Text style={styles.rowActionText}>Editar</Text></Pressable>
                          {row.open ? <Pressable onPress={() => openPartialPayment(row)} style={styles.rowActionBtn}><Text style={styles.rowActionText}>Pag. parcial</Text></Pressable> : null}
                          {!row.inAgreement && ['paid', 'canceled'].includes(row.status) ? <Pressable onPress={() => openDeleteDebt(row)} style={styles.rowActionBtnDanger}><Text style={styles.rowActionTextDanger}>Excluir</Text></Pressable> : null}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              </ScrollView>
              <AppButton title="Fechar" onPress={() => setDetailsPerson(null)} />
            </ScrollView>
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={!!detailsInstallmentsAgreement} transparent animationType="fade" onRequestClose={() => setDetailsInstallmentsAgreement(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.installmentsModalContent}>
            {detailsInstallmentsAgreement && <>
              <View style={styles.modalHeaderRow}>
                <Text style={[styles.modalTitle, styles.modalTitleFlex]}>Parcelas · ACORDO {detailsInstallmentsAgreement.id.slice(0,8).toUpperCase()}</Text>
                <Pressable onPress={() => setDetailsInstallmentsAgreement(null)} style={styles.modalCloseButton} accessibilityLabel="Fechar" hitSlop={8}>
                  <Text style={styles.modalCloseButtonText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.installmentModalList} style={styles.modalScrollBody}>
                {[...(detailsInstallmentsAgreement.installments||[])].sort((a,b)=>a.number-b.number).map(item=>(
                  <View key={item.id} style={styles.detailRow}>
                    <View style={styles.grow}>
                      <Text style={styles.detailTitle}>Parcela {item.number} de {detailsInstallmentsAgreement.installment_count}</Text>
                      <Text style={styles.detailMeta}>Vencimento {formatBrazilianDate(item.dueDate)}</Text>
                      {item.cancellationReason ? <Text style={styles.detailMeta}>Motivo: {item.cancellationReason}</Text> : null}
                    </View>
                    <Text style={styles.installmentValue}>{money(item.amountCents)}</Text>
                    <Text style={[styles.installmentStatus,item.status==='paid'&&styles.installmentPaid,item.status==='overdue'&&styles.installmentOverdue,(item.status==='canceled'||item.canceledAt)&&styles.installmentCanceled]}>{installmentStatus(item.status,item.invoiceId,item.canceledAt)}</Text>
                    {manager&&canCancelInstallment(item)?<Pressable onPress={()=>openCancelInstallment(detailsInstallmentsAgreement.id,item.id,item.number)} style={styles.rowActionBtnDanger}><Text style={styles.rowActionTextDanger}>Cancelar</Text></Pressable>:null}
                  </View>
                ))}
              </ScrollView>
              <AppButton title="Fechar" onPress={() => setDetailsInstallmentsAgreement(null)} />
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={!!justifyingAgreement} transparent animationType="fade" onRequestClose={()=>setJustifyingAgreement(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Excluir acordo</Text>
            <TextInput placeholder="Motivo da exclusão..." value={justification} onChangeText={setJustification} multiline numberOfLines={4} style={styles.justificationInput}/>
            <View style={styles.checkboxRow}>
              <Pressable onPress={()=>setShouldRecalculate(!shouldRecalculate)} style={styles.checkbox}>
                <Text style={shouldRecalculate?styles.checkboxChecked:styles.checkboxUnchecked}>{shouldRecalculate?'☑':'☐'}</Text>
              </Pressable>
              <Text style={styles.checkboxLabel}>{data ? `Recalcular valor total (${percent(data.rules.finePercent)}% multa + ${percent(data.rules.dailyInterestPercent)}% mora ao dia)` : 'Recalcular valor total (multa + mora ao dia)'}</Text>
            </View>
            <View style={styles.modalActions}>
              <Pressable onPress={()=>setJustifyingAgreement(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
              <Pressable onPress={submitCancellation} disabled={loading||!justification.trim()} style={[styles.submitButton,(!justification.trim()||loading)&&styles.submitButtonDisabled]}><Text style={styles.submitButtonText}>{loading?'Salvando...':'Salvar justificativa'}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!editingDebt} transparent animationType="fade" onRequestClose={()=>setEditingDebt(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {editingDebt && <>
            <Text style={styles.modalTitle}>Editar débito · {formatBrazilianMonth(editingDebt.referenceMonth)}</Text>
            {editingDebt.externalId ? <Text style={styles.legacyHint}>Este débito já foi emitido no banco: valor e vencimento não podem ser alterados aqui. Você ainda pode marcar como pago ou registrar uma observação.</Text> : null}
            <Text style={styles.fieldLabel}>Valor</Text>
            <TextInput value={editAmount} onChangeText={value=>setEditAmount(maskCurrency(value))} keyboardType="number-pad" editable={!editingDebt.externalId} style={[styles.input,editingDebt.externalId&&styles.inputDisabled]}/>
            <Text style={styles.fieldLabel}>Vencimento</Text>
            <TextInput value={editDueDate} onChangeText={value=>setEditDueDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} editable={!editingDebt.externalId} style={[styles.input,editingDebt.externalId&&styles.inputDisabled]}/>
            <Text style={styles.fieldLabel}>Observação (opcional)</Text>
            <TextInput value={editNotes} onChangeText={setEditNotes} placeholder="Detalhes adicionais" multiline numberOfLines={3} style={styles.justificationInput}/>
            <Pressable onPress={()=>setEditMarkPaid(current=>!current)} style={styles.checkboxRow}>
              <View style={styles.checkbox}><Text style={editMarkPaid?styles.checkboxChecked:styles.checkboxUnchecked}>{editMarkPaid?'☑':'☐'}</Text></View>
              <Text style={styles.checkboxLabel}>Marcar como pago (ex.: débito antigo que já tinha sido pago antes de entrar no sistema).</Text>
            </Pressable>
            {editMarkPaid ? <>
              <Text style={styles.fieldLabel}>Data do pagamento</Text>
              <TextInput value={editPaidAt} onChangeText={value=>setEditPaidAt(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input}/>
            </> : null}
            <Text style={styles.fieldLabel}>Motivo da edição</Text>
            <TextInput value={editReason} onChangeText={setEditReason} placeholder="Por que este débito está sendo editado?" multiline numberOfLines={2} style={styles.justificationInput}/>
            <View style={styles.modalActions}>
              <Pressable onPress={()=>setEditingDebt(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
              <Pressable onPress={submitEditDebt} disabled={editSubmitting||!editReason.trim()} style={[styles.submitButton,(editSubmitting||!editReason.trim())&&styles.submitButtonDisabled]}><Text style={styles.submitButtonText}>{editSubmitting?'Salvando...':'Salvar edição'}</Text></Pressable>
            </View>
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={!!payingDebt} transparent animationType="fade" onRequestClose={()=>setPayingDebt(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {payingDebt && <>
            <Text style={styles.modalTitle}>Registrar pagamento parcial</Text>
            <Text style={styles.legacyHint}>Saldo em aberto atual: {money(payingDebt.principalCents)}. Informe quanto já foi pago (por fora do sistema); o restante continua em aberto.</Text>
            <Text style={styles.fieldLabel}>Valor pago</Text>
            <TextInput value={paymentAmount} onChangeText={value=>setPaymentAmount(maskCurrency(value))} placeholder="R$ 0,00" keyboardType="number-pad" style={styles.input}/>
            <Text style={styles.fieldLabel}>Data do pagamento</Text>
            <TextInput value={paymentDate} onChangeText={value=>setPaymentDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input}/>
            <Text style={styles.fieldLabel}>Motivo</Text>
            <TextInput value={paymentReason} onChangeText={setPaymentReason} placeholder="Ex.: pago em dinheiro antes do cadastro" multiline numberOfLines={2} style={styles.justificationInput}/>
            <View style={styles.modalActions}>
              <Pressable onPress={()=>setPayingDebt(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
              <Pressable onPress={submitPartialPayment} disabled={paymentSubmitting||!paymentReason.trim()||currencyToCents(paymentAmount)<=0} style={[styles.submitButton,(paymentSubmitting||!paymentReason.trim()||currencyToCents(paymentAmount)<=0)&&styles.submitButtonDisabled]}><Text style={styles.submitButtonText}>{paymentSubmitting?'Salvando...':'Registrar pagamento'}</Text></Pressable>
            </View>
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={!!deletingDebt} transparent animationType="fade" onRequestClose={()=>setDeletingDebt(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {deletingDebt && <>
            <Text style={styles.modalTitle}>Excluir débito</Text>
            <Text style={styles.legacyHint}>{formatBrazilianMonth(deletingDebt.referenceMonth)} · {money(deletingDebt.principalCents)}. Esta ação remove o débito das listagens, mas mantém o histórico para auditoria.</Text>
            <Text style={styles.fieldLabel}>Motivo da exclusão</Text>
            <TextInput value={deleteReason} onChangeText={setDeleteReason} placeholder="Ex.: lançamento duplicado" multiline numberOfLines={3} style={styles.justificationInput}/>
            <View style={styles.modalActions}>
              <Pressable onPress={()=>setDeletingDebt(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
              <Pressable onPress={submitDeleteDebt} disabled={deleteSubmitting||!deleteReason.trim()} style={[styles.submitButton,(deleteSubmitting||!deleteReason.trim())&&styles.submitButtonDisabled]}><Text style={styles.submitButtonText}>{deleteSubmitting?'Excluindo...':'Excluir débito'}</Text></Pressable>
            </View>
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={!!cancelingInstallment} transparent animationType="fade" onRequestClose={()=>setCancelingInstallment(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {cancelingInstallment && <>
            <Text style={styles.modalTitle}>Cancelar parcela {cancelingInstallment.number}</Text>
            <Text style={styles.fieldLabel}>Motivo</Text>
            <TextInput value={installmentCancelReason} onChangeText={setInstallmentCancelReason} placeholder="Motivo do cancelamento" multiline numberOfLines={3} style={styles.justificationInput}/>
            <View style={styles.modalActions}>
              <Pressable onPress={()=>setCancelingInstallment(null)} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Voltar</Text></Pressable>
              <Pressable onPress={submitCancelInstallment} disabled={installmentCancelSubmitting||!installmentCancelReason.trim()} style={[styles.submitButton,(installmentCancelSubmitting||!installmentCancelReason.trim())&&styles.submitButtonDisabled]}><Text style={styles.submitButtonText}>{installmentCancelSubmitting?'Cancelando...':'Cancelar parcela'}</Text></Pressable>
            </View>
            </>}
          </View>
        </View>
      </Modal>

      <Modal visible={showLegacyForm} transparent animationType="fade" onRequestClose={resetLegacyForm}>
        <View style={styles.modalOverlay}>
          <View style={styles.legacyModalContent}>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.modalTitle}>Cadastrar débito antigo</Text>
              <Text style={styles.legacyHint}>Débito anterior à existência do sistema, para um apartamento e proprietário/inquilino já cadastrado.</Text>

              <Text style={styles.fieldLabel}>Pessoa responsável</Text>
              {legacySelectedPerson ? (
                <View style={styles.legacyPersonSelected}>
                  <Text style={styles.legacyPersonName}>✓ {legacySelectedPerson.full_name || legacySelectedPerson.username}</Text>
                  <Text style={styles.legacyPersonMeta}>{legacySelectedPerson.unit || 'Sem unidade'}</Text>
                  <Pressable onPress={() => { setLegacySelectedPersonId(''); setLegacyPersonSearch(''); }}><Text style={styles.legacyChangePerson}>Trocar</Text></Pressable>
                </View>
              ) : (
                <>
                  <TextInput value={legacyPersonSearch} onChangeText={setLegacyPersonSearch} placeholder="Digite ao menos 2 letras do nome" autoCapitalize="words" style={styles.input} />
                  {legacyPersonSearch.trim().length >= 2 ? (
                    <View style={styles.legacyPeopleList}>
                      {filteredLegacyPeople.length ? filteredLegacyPeople.map(person => (
                        <Pressable key={person.id} onPress={() => { setLegacySelectedPersonId(person.id); setLegacyPersonSearch(person.full_name || person.username); }} style={styles.legacyPersonOption}>
                          <Text style={styles.legacyPersonName}>{person.full_name || person.username}</Text>
                          <Text style={styles.legacyPersonMeta}>{person.unit || 'Sem unidade'}</Text>
                        </Pressable>
                      )) : <Text style={styles.legacyHint}>Nenhuma pessoa encontrada.</Text>}
                    </View>
                  ) : null}
                </>
              )}

              {legacySelectedPerson ? (
                <>
                  <View style={styles.legacyChips}>
                    <Pressable onPress={() => setLegacyMode('manual')} style={[styles.legacyChip, legacyMode === 'manual' && styles.legacyChipOn]}><Text style={[styles.legacyChipText, legacyMode === 'manual' && styles.legacyChipTextOn]}>Cadastro manual</Text></Pressable>
                    <Pressable onPress={() => setLegacyMode('import')} style={[styles.legacyChip, legacyMode === 'import' && styles.legacyChipOn]}><Text style={[styles.legacyChipText, legacyMode === 'import' && styles.legacyChipTextOn]}>Importar planilha</Text></Pressable>
                  </View>

                  {legacyMode === 'import' ? (
                    <View style={styles.legacyImportBox}>
                      <Text style={styles.legacyImportTitle}>Importar planilha (.xlsx)</Text>
                      <Text style={styles.legacyHint}>Colunas esperadas: MES, TAXA CONDOMINIO, VENCIMENTO BOLETO e SITUAÇÃO (opcional, para identificar meses já pagos). Multa{data ? ` ${percent(data.rules.finePercent)}%` : ''}, mora{data ? ` ${percent(data.rules.dailyInterestPercent)}% a.d.` : ''} e total são sempre recalculados pelo sistema — os valores dessas colunas na planilha são ignorados.</Text>
                      {Platform.OS === 'web' ? (
                        <View>
                          {React.createElement('input' as any, { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', onChange: selectLegacyImportFile, disabled: legacyImporting, style: { display: 'block', marginTop: 10, marginBottom: 10, width: '100%' } })}
                          {legacyImportFile ? <Text style={styles.legacyPersonMeta}>Selecionado: {legacyImportFile.name}</Text> : <Text style={styles.legacyPersonMeta}>Nenhum arquivo selecionado.</Text>}
                        </View>
                      ) : (
                        <View>
                          <Pressable onPress={selectLegacyImportFileNative} disabled={legacyImporting} style={styles.legacyImportPicker}>
                            <Text style={styles.legacyImportPickerText}>Selecionar planilha no aparelho</Text>
                          </Pressable>
                          {legacyImportFile ? <Text style={styles.legacyPersonMeta}>Selecionado: {legacyImportFile.name}</Text> : <Text style={styles.legacyPersonMeta}>Nenhum arquivo selecionado.</Text>}
                        </View>
                      )}
                      <View style={styles.modalActions}>
                        <Pressable onPress={resetLegacyForm} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
                        <Pressable onPress={importLegacyDebts} disabled={legacyImporting || !legacyImportFile} style={[styles.submitButton, (legacyImporting || !legacyImportFile) && styles.submitButtonDisabled]}>
                          <Text style={styles.submitButtonText}>{legacyImporting ? 'Importando...' : 'Importar planilha'}</Text>
                        </Pressable>
                      </View>
                      {legacyImportResult ? (
                        <View style={styles.legacyImportResult}>
                          <Text style={styles.legacyPersonName}>{legacyImportResult.total} linha(s) processada(s)</Text>
                          <Text style={styles.legacyPersonMeta}>{legacyImportResult.created} importado(s) · {legacyImportResult.paid} já pago(s) · {legacyImportResult.duplicates} duplicado(s) · {legacyImportResult.invalid} inválido(s)</Text>
                          {legacyImportResult.issues.map(issue => <Text key={`${issue.row}-${issue.message}`} style={styles.legacyImportIssue}>Linha {issue.row}: {issue.message}</Text>)}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}

              {legacyMode === 'manual' ? (
                <>
                  <Text style={styles.fieldLabel}>Valor do débito</Text>
                  <TextInput value={legacyAmount} onChangeText={value => setLegacyAmount(maskCurrency(value))} placeholder="R$ 0,00" keyboardType="number-pad" style={styles.input} />

                  <Text style={styles.fieldLabel}>Data de vencimento original</Text>
                  <TextInput value={legacyDueDate} onChangeText={value => setLegacyDueDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input} />

                  <Text style={styles.fieldLabel}>Tipo de negociação</Text>
                  <View style={styles.legacyChips}>
                    <Pressable onPress={() => setLegacyNegotiationType('none')} style={[styles.legacyChip, legacyNegotiationType === 'none' && styles.legacyChipOn]}><Text style={[styles.legacyChipText, legacyNegotiationType === 'none' && styles.legacyChipTextOn]}>Nenhuma</Text></Pressable>
                    <Pressable onPress={() => setLegacyNegotiationType('private')} style={[styles.legacyChip, legacyNegotiationType === 'private' && styles.legacyChipOn]}><Text style={[styles.legacyChipText, legacyNegotiationType === 'private' && styles.legacyChipTextOn]}>Negociado entre as partes</Text></Pressable>
                    <Pressable onPress={() => setLegacyNegotiationType('judicial')} style={[styles.legacyChip, legacyNegotiationType === 'judicial' && styles.legacyChipOn]}><Text style={[styles.legacyChipText, legacyNegotiationType === 'judicial' && styles.legacyChipTextOn]}>Negociado judicialmente</Text></Pressable>
                  </View>

                  {legacyNegotiationType === 'judicial' ? (
                    <>
                      <Text style={styles.fieldLabel}>Número do processo</Text>
                      <TextInput value={legacyProcessNumber} onChangeText={setLegacyProcessNumber} placeholder="0000000-00.0000.0.00.0000" style={styles.input} />
                    </>
                  ) : null}

                  <Text style={styles.fieldLabel}>Observação (opcional)</Text>
                  <TextInput value={legacyNotes} onChangeText={setLegacyNotes} placeholder="Detalhes adicionais sobre o débito" multiline numberOfLines={3} style={styles.justificationInput} />

                  <Pressable onPress={() => setLegacyAlreadyNegotiated(current => !current)} style={styles.checkboxRow}>
                    <View style={styles.checkbox}><Text style={legacyAlreadyNegotiated ? styles.checkboxChecked : styles.checkboxUnchecked}>{legacyAlreadyNegotiated ? '☑' : '☐'}</Text></View>
                    <Text style={styles.checkboxLabel}>Este débito já foi negociado (congelar valor). Se a negociação for cancelada futuramente, o sistema retoma o cálculo diário de multa e mora.</Text>
                  </Pressable>

                  {legacyAlreadyNegotiated ? (
                    <>
                      <Text style={styles.fieldLabel}>Valor negociado</Text>
                      <TextInput value={legacyNegotiatedTotal} onChangeText={value => setLegacyNegotiatedTotal(maskCurrency(value))} placeholder="R$ 0,00" keyboardType="number-pad" style={styles.input} />
                      <View style={styles.formRow}>
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>Quantidade de parcelas</Text>
                          <TextInput value={legacyInstallments} onChangeText={setLegacyInstallments} keyboardType="number-pad" style={styles.input} />
                        </View>
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>Primeira parcela</Text>
                          <TextInput value={legacyFirstDueDate} onChangeText={value => setLegacyFirstDueDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input} />
                        </View>
                      </View>
                    </>
                  ) : null}

                  <View style={styles.modalActions}>
                    <Pressable onPress={resetLegacyForm} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancelar</Text></Pressable>
                    <Pressable
                      onPress={createLegacyDebt}
                      disabled={
                        legacySubmitting || !legacySelectedPersonId || currencyToCents(legacyAmount) <= 0 || !brazilianDateToIso(legacyDueDate) ||
                        (legacyNegotiationType === 'judicial' && !legacyProcessNumber.trim()) ||
                        (legacyAlreadyNegotiated && (currencyToCents(legacyNegotiatedTotal) <= 0 || !brazilianDateToIso(legacyFirstDueDate)))
                      }
                      style={[styles.submitButton, (legacySubmitting || !legacySelectedPersonId) && styles.submitButtonDisabled]}
                    >
                      <Text style={styles.submitButtonText}>{legacySubmitting ? 'Salvando...' : 'Cadastrar débito antigo'}</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>;
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 50, gap: 14 },
  containerMobile:{paddingHorizontal:14,paddingTop:18,paddingBottom:34},
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, lineHeight: 22 },
  updateBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#b8d6c1', backgroundColor: colors.softGreen, borderRadius: 10, padding: 14 },
  updateCopy: { flex: 1, minWidth: 240 }, updateAction: { minWidth: 170 },
  updateTitle: { color: colors.green, fontWeight: '900' }, updateText: { color: colors.muted, lineHeight: 20, marginTop: 3 }, updateDate: { color: colors.ink, fontWeight: '800', marginTop: 5 },
  error: { color: colors.red, fontWeight: '800' },
  notice: { color: colors.green, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summary: { flex: 1, minWidth: 140, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#fff', padding: 12 },
  summaryValue: { color: colors.ink, fontSize: 18, fontWeight: '900' }, summaryLabel: { color: colors.muted, marginTop: 2, fontSize: 13 },
  summaryTotal: { flex: 1, minWidth: 140, borderRadius: 8, backgroundColor: colors.red, padding: 12 },
  summaryTotalValue: { color: '#fff', fontSize: 21, fontWeight: '900' }, summaryTotalLabel: { color: '#fff', marginTop: 3 },
  agreements:{gap:8},sectionTitle:{color:colors.ink,fontSize:20,fontWeight:'900'},sectionHint:{color:colors.muted,lineHeight:20,marginBottom:3},agreementCard:{gap:13,borderWidth:1,borderColor:colors.border,borderRadius:11,backgroundColor:'#fff',padding:16},agreementCardDanger:{borderColor:colors.red,backgroundColor:'#fffafa'},agreementHeader:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10},grow:{flex:1,minWidth:220},agreementCode:{color:colors.primary,fontSize:12,fontWeight:'900'},agreementTitle:{color:colors.ink,fontSize:18,fontWeight:'900',marginTop:3},agreementStatus:{color:colors.primaryDark,backgroundColor:colors.softBlue,paddingHorizontal:10,paddingVertical:6,borderRadius:9,overflow:'hidden',fontWeight:'900'},agreementStatusDanger:{color:'#fff',backgroundColor:colors.red},agreementStatusSuccess:{color:'#fff',backgroundColor:colors.green},agreementValues:{flexDirection:'row',flexWrap:'wrap',gap:8},agreementValueBox:{flexGrow:1,minWidth:165,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#f8fafc',padding:11},valueLabel:{color:colors.muted,fontSize:13,fontWeight:'800'},valueText:{color:colors.ink,fontSize:17,fontWeight:'900',marginTop:4},valueStrong:{color:colors.primaryDark,fontSize:19,fontWeight:'900',marginTop:4},discountValue:{color:colors.green,fontSize:17,fontWeight:'900',marginTop:4},agreementInfo:{gap:5,borderLeftWidth:3,borderLeftColor:colors.primary,paddingLeft:11},infoText:{color:colors.muted,lineHeight:20},infoStrong:{color:colors.ink,fontWeight:'800'},agreementSection:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:11,gap:7},agreementSectionTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},detailRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,padding:10},detailTitle:{color:colors.ink,fontWeight:'900'},detailMeta:{color:colors.muted,fontSize:13,marginTop:3},detailAmounts:{minWidth:210,alignItems:'flex-end'},detailTotal:{color:colors.red,fontWeight:'900',marginTop:3},installmentTrigger:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8,borderTopWidth:1,borderTopColor:colors.border,paddingTop:11},installmentHeader:{flex:1,flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},installmentModalList:{gap:8},progress:{color:colors.primaryDark,fontWeight:'900'},installmentValue:{color:colors.ink,fontWeight:'900',minWidth:95,textAlign:'right'},installmentStatus:{color:colors.primaryDark,backgroundColor:colors.softBlue,paddingHorizontal:8,paddingVertical:5,borderRadius:8,overflow:'hidden',fontSize:12,fontWeight:'900',minWidth:120,textAlign:'center'},installmentPaid:{color:colors.green,backgroundColor:colors.softGreen},installmentOverdue:{color:'#fff',backgroundColor:colors.red},installmentCanceled:{color:'#fff',backgroundColor:colors.red},breachBox:{borderWidth:1,borderColor:colors.red,borderRadius:8,backgroundColor:'#fff1f1',padding:11},breachTitle:{color:colors.red,fontWeight:'900'},breachText:{color:colors.ink,lineHeight:20,marginTop:4},agreementActions:{flexDirection:'row',justifyContent:'flex-end',flexWrap:'wrap',gap:8},smallAction:{minWidth:170},acceptAction:{flexGrow:1,minWidth:260},
  ownedElsewhereSection: { gap: 10, marginTop: 22, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 },
  unitCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff', overflow: 'hidden' },
  unitHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#dbeaf7' },
  unitIdentity: { flex: 1, minWidth: 190 }, unitLabel: { color: colors.primary, fontSize: 12, fontWeight: '900' }, unitTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', marginTop: 2 },
  unitTotalBox: { minWidth: 190, alignItems: 'flex-end' }, openBadge: { color: '#fff', backgroundColor: colors.red, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, overflow: 'hidden', marginBottom: 7 }, unitTotalLabel: { color: colors.muted, fontWeight: '800' }, unitTotal: { color: colors.red, fontSize: 22, fontWeight: '900', marginTop: 2 },
  personCard: { borderTopWidth: 1, borderTopColor: colors.border },
  personHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 14, backgroundColor: '#f7f9fc' },
  personRole: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  personName: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 2 },
  personTotalBox: { alignItems: 'flex-end' },
  personOpenBadge: { color: '#fff', backgroundColor: colors.red, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden', marginBottom: 5, fontSize: 12 },
  personTotal: { color: colors.red, fontSize: 17, fontWeight: '900' },
  unitActions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:8,padding:12,borderTopWidth:1,borderTopColor:colors.border},secondaryAction:{minHeight:42,justifyContent:'center',paddingHorizontal:14,borderWidth:1,borderColor:colors.primary,borderRadius:8},secondaryActionText:{color:colors.primary,fontWeight:'900'},primaryAction:{minHeight:42,justifyContent:'center',paddingHorizontal:14,backgroundColor:colors.primary,borderRadius:8},primaryActionText:{color:'#fff',fontWeight:'900'},proposalForm:{padding:14,backgroundColor:'#f8fafc',borderTopWidth:1,borderTopColor:colors.border},proposalTitle:{color:colors.ink,fontSize:17,fontWeight:'900'},formRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'flex-end',gap:10,marginTop:10},field:{flex:1,minWidth:180},fieldLabel:{color:colors.ink,fontWeight:'800',marginBottom:5},input:{minHeight:50,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#fff',paddingHorizontal:11},formButton:{minWidth:170},formHint:{color:colors.muted,marginTop:9},
  debtTableTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.border },
  debtTableTriggerText: { color: colors.primary, fontWeight: '800' },
  debtChevron: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  legacyTag: { color: '#7a4d00', backgroundColor: '#fff3d6', alignSelf: 'flex-start', fontSize: 10, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', marginTop: 4 },
  legacyTagJudicial: { color: '#fff', backgroundColor: colors.lilac },
  lateRow: { backgroundColor: '#fff4f4' }, paidRow: { backgroundColor: '#f3faf5' }, statusLate: { color: colors.red }, statusPaid: { color: colors.green },
  tableScroll: { flexGrow: 1, justifyContent: 'center' },
  table: { minWidth: 1480 }, tableRow: { flexDirection: 'row', minHeight: 54, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  tableHeader: { minHeight: 46, backgroundColor: '#f5f7fa' }, headerCell: { width: 148, paddingHorizontal: 10, color: colors.muted, fontSize: 12, fontWeight: '900' },
  cell: { width: 148, paddingHorizontal: 10, color: colors.ink, fontWeight: '700' }, referenceCell: { width: 170 }, reference: { fontWeight: '900' }, amount: { color: colors.red, fontWeight: '900' },
  cellText: { color: colors.ink, fontWeight: '700' },
  referenceCellWrap: { width: 170, paddingHorizontal: 10 },
  alignRight: { textAlign: 'right' }, alignCenter: { textAlign: 'center' },
  status: { color: colors.primaryDark },
  actionsCell: { width: 260 }, actionsCellRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  rowActionBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  rowActionText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  rowActionBtnDanger: { borderWidth: 1, borderColor: colors.red, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  rowActionTextDanger: { color: colors.red, fontWeight: '800', fontSize: 12 },
  adjustmentsList: { marginTop: 4, gap: 2 },
  adjustmentText: { color: colors.muted, fontSize: 11, lineHeight: 14 },
  inputDisabled: { backgroundColor: '#f1f3f6', color: colors.muted },
  personTableModalContent: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '95%', maxWidth: 1000, maxHeight: '85%', gap: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '90%', maxWidth: 400, gap: 14 },
  installmentsModalContent: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '90%', maxWidth: 460, maxHeight: '85%', gap: 14 },
  modalScrollBody: { flexShrink: 1 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  modalTitleFlex: { flex: 1 },
  modalCloseButton: { minWidth: 30, minHeight: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f3f6' },
  modalCloseButtonText: { color: colors.ink, fontSize: 15, fontWeight: '900', lineHeight: 15 },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  justificationInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, minHeight: 100, color: colors.ink, textAlignVertical: 'top' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { padding: 4 },
  checkboxUnchecked: { fontSize: 18, color: colors.muted },
  checkboxChecked: { fontSize: 18, color: colors.green },
  checkboxLabel: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelButton: { flex: 1, minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  cancelButtonText: { color: colors.ink, fontWeight: '900', textAlign: 'center' },
  submitButton: { flex: 1, minHeight: 42, justifyContent: 'center', backgroundColor: colors.green, borderRadius: 8 },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
  legacyTrigger: { alignSelf: 'flex-start', minWidth: 220 },
  legacyModalContent: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '92%', maxWidth: 480, maxHeight: '88%' },
  legacyHint: { color: colors.muted, lineHeight: 20 },
  legacyPersonSelected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.softBlue, borderRadius: 8, padding: 11 },
  legacyPeopleList: { gap: 7, maxHeight: 220 },
  legacyPersonOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, backgroundColor: '#fff' },
  legacyPersonName: { color: colors.ink, fontWeight: '900' },
  legacyPersonMeta: { color: colors.muted, fontSize: 13, marginTop: 3 },
  legacyChangePerson: { color: colors.primary, fontWeight: '900' },
  legacyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  legacyChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' },
  legacyChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  legacyChipText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  legacyChipTextOn: { color: '#fff' },
  legacyImportBox: { gap: 8, padding: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  legacyImportTitle: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  legacyImportPicker: { minHeight: 46, marginTop: 6, marginBottom: 8, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.softBlue },
  legacyImportPickerText: { color: colors.primary, fontWeight: '900' },
  legacyImportResult: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 4 },
  legacyImportIssue: { color: colors.red, fontSize: 13 },
});
