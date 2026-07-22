import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState } from '../ui/components';
import ResponsiveShell from '../ui/ResponsiveShell';
import { colors } from '../ui/theme';
import { brazilianDateToIso, formatBrazilianDate, formatBrazilianMonth, maskBrazilianDate } from '../utils/date';

type Person = { id: string; full_name: string | null; username: string; unit: string | null };
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
  frozenByAgreement?: boolean;
};
type Agreement = { id:string;status:string;debtor_name:string;apartment:string;original_total_cents:number;negotiated_total_cents:number;installment_count:number;first_due_date:string;valid_until:string|null;sent_at:string|null;accepted_at:string|null;breached_at:string|null;breach_reason:string|null;notes:string|null;items:Array<{invoiceId:string;referenceMonth:string;dueDate:string;principalCents:number;fineCents:number;interestCents:number;frozenTotalCents:number;frozenAt:string}>;installments:Array<{id:string;number:number;amountCents:number;dueDate:string;invoiceId:string|null;status:string|null}> };
type DebtData = {
  scope: 'person' | 'condominium';
  person: Person & { cpf: string };
  asOf: string;
  rules: { finePercent: number; dailyInterestPercent: number; legalBasis: string };
  rows: DebtRow[];
  totals: { principalCents: number; fineCents: number; interestCents: number; updatedTotalCents: number; openCount: number };
};
type UnitGroup = {
  unit: string;
  rows: DebtRow[];
  openCount: number;
  updatedTotalCents: number;
};

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const situation = (row: DebtRow) => row.status === 'paid' ? 'Pago' : row.daysLate > 0 ? 'Em atraso' : 'Em aberto';
const agreementStatus:Record<string,string>={draft:'Rascunho',sent:'Aguardando seu aceite',accepted:'Aceito · aguardando boletos',active:'Acordo ativo',at_risk:'Acordo sob risco',breached:'Acordo rompido',settled:'Acordo quitado',rejected:'Proposta recusada',expired:'Proposta expirada',canceled:'Proposta cancelada'};
const installmentStatus=(status:string|null,invoiceId:string|null)=>!invoiceId?'Aguardando emissão':status==='paid'?'Pago':status==='overdue'?'Vencido':status==='canceled'?'Cancelado':'Em aberto';

export default function Debts({ navigation }: any) {
  const {width}=useWindowDimensions();const compact=width<760;
  const { userToken, user } = useContext(AuthContext);
  const manager = ['sindico', 'subsindico'].includes(user?.role || '');
  const [data, setData] = useState<DebtData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreements,setAgreements]=useState<Agreement[]>([]);
  const [negotiating,setNegotiating]=useState<string|null>(null);
  const [installments,setInstallments]=useState('3');
  const [firstDueDate,setFirstDueDate]=useState(()=>{const date=new Date();date.setDate(date.getDate()+10);return date.toLocaleDateString('pt-BR')});

  const load = useCallback(async () => {
    if (!userToken) return;
    setLoading(true);
    setError('');
    try {
      const [debts,agreementData]=await Promise.all([apiRequest<DebtData>(`/debts?asOf=${todayIso()}`, userToken),apiRequest<{agreements:Agreement[]}>('/agreements',userToken)]);
      setData(debts);setAgreements(agreementData.agreements);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os débitos.');
    } finally {
      setLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const units = useMemo<UnitGroup[]>(() => {
    if (!data) return [];
    const grouped = new Map<string, DebtRow[]>();
    data.rows.forEach(row => {
      const unit = row.payerUnit?.trim() || data.person.unit?.trim() || 'Sem apartamento';
      grouped.set(unit, [...(grouped.get(unit) || []), row]);
    });
    return Array.from(grouped, ([unit, rows]) => {
      const orderedRows = [...rows].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth) || b.dueDate.localeCompare(a.dueDate));
      const openRows = orderedRows.filter(row => row.open);
      return {
        unit,
        rows: orderedRows,
        openCount: openRows.length,
        updatedTotalCents: openRows.reduce((sum, row) => sum + row.updatedTotalCents, 0),
      };
    }).sort((a, b) => a.unit.localeCompare(b.unit, 'pt-BR', { numeric: true }));
  }, [data]);

  const communicate=async(group:UnitGroup)=>{if(!userToken)return;const open=group.rows.filter(row=>row.open);const payerId=open[0]?.payerId;if(!payerId)return;setLoading(true);try{const result=await apiRequest<{whatsappUrl:string}>('/agreements/communicate-debt',userToken,{method:'POST',body:JSON.stringify({userId:payerId,invoiceIds:open.filter(row=>row.payerId===payerId).map(row=>row.id)})});await Linking.openURL(result.whatsappUrl);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao preparar a comunicação.')}finally{setLoading(false)}};
  const createAgreement=async(group:UnitGroup)=>{if(!userToken)return;const dueDateIso=brazilianDateToIso(firstDueDate);if(!dueDateIso){setError('Informe o primeiro vencimento no formato DD/MM/AAAA.');return}const open=group.rows.filter(row=>row.open);const payerId=open[0]?.payerId;if(!payerId)return;setLoading(true);try{await apiRequest('/agreements',userToken,{method:'POST',body:JSON.stringify({debtorUserId:payerId,invoiceIds:open.filter(row=>row.payerId===payerId).map(row=>row.id),installmentCount:Number(installments),firstDueDate:dueDateIso,notes:`Negociação dos débitos do apartamento ${group.unit}`})});setNegotiating(null);await load()}catch(reason){setError(reason instanceof Error?reason.message:'Falha ao criar a proposta.')}finally{setLoading(false)}};
  const agreementAction=async(agreement:Agreement,action:'send'|'accept'|'issue')=>{if(!userToken)return;setLoading(true);try{await apiRequest(`/agreements/${agreement.id}/${action}`,userToken,{method:'POST'});await load()}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar o acordo.')}finally{setLoading(false)}};

  return <ResponsiveShell activeRoute="Debts" navigation={navigation}>
    <ScrollView contentContainerStyle={[styles.container,compact&&styles.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={styles.eyebrow}>FINANCEIRO</Text>
      <Text style={styles.title}>Gestão de débitos por apartamento</Text>
      <Text style={styles.subtitle}>Cada apartamento apresenta suas referências mensais, encargos e total atualizado diariamente.</Text>

      <View style={styles.updateBox}>
        <View style={styles.updateCopy}>
          <Text style={styles.updateTitle}>Atualização automática</Text>
          <Text style={styles.updateText}>Multa de 2% e mora de 0,0333% ao dia, recalculadas pela data atual a cada atualização.</Text>
          {data ? <Text style={styles.updateDate}>Posição em {formatBrazilianDate(data.asOf)}</Text> : null}
        </View>
        <View style={styles.updateAction}><AppButton title={loading ? 'Atualizando...' : 'Atualizar agora'} onPress={load} disabled={loading} /></View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
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
          <View style={styles.agreementSection}><View style={styles.installmentHeader}><Text style={styles.agreementSectionTitle}>Parcelas do acordo</Text><Text style={styles.progress}>{paid}/{agreement.installment_count} paga(s)</Text></View>{orderedInstallments.map(item=><View key={item.id} style={styles.detailRow}><View style={styles.grow}><Text style={styles.detailTitle}>Parcela {item.number} de {agreement.installment_count}</Text><Text style={styles.detailMeta}>Vencimento {formatBrazilianDate(item.dueDate)}</Text></View><Text style={styles.installmentValue}>{money(item.amountCents)}</Text><Text style={[styles.installmentStatus,item.status==='paid'&&styles.installmentPaid,item.status==='overdue'&&styles.installmentOverdue]}>{installmentStatus(item.status,item.invoiceId)}</Text></View>)}</View>
          {agreement.status==='breached'?<View style={styles.breachBox}><Text style={styles.breachTitle}>Acordo rompido</Text><Text style={styles.breachText}>{agreement.breach_reason||'As condições do acordo não foram cumpridas.'} Os débitos originais voltaram a receber atualização de multa e mora.</Text></View>:null}
          <View style={styles.agreementActions}>{manager&&agreement.status==='draft'?<View style={styles.smallAction}><AppButton title="Enviar proposta" onPress={()=>agreementAction(agreement,'send')} disabled={loading}/></View>:null}{!manager&&agreement.status==='sent'?<View style={styles.acceptAction}><AppButton title="Li as condições e aceito o acordo" onPress={()=>agreementAction(agreement,'accept')} disabled={loading}/></View>:null}{manager&&agreement.status==='accepted'?<View style={styles.smallAction}><AppButton title="Gerar boletos" onPress={()=>agreementAction(agreement,'issue')} disabled={loading}/></View>:null}</View>
        </View>})}</View>:null}

        {units.length ? units.map(group => <View key={group.unit} style={styles.unitCard}>
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

          {manager&&group.openCount>0?<View style={styles.unitActions}><Pressable onPress={()=>communicate(group)} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Comunicar por WhatsApp</Text></Pressable><Pressable onPress={()=>setNegotiating(current=>current===group.unit?null:group.unit)} style={styles.primaryAction}><Text style={styles.primaryActionText}>Criar proposta de acordo</Text></Pressable></View>:null}
          {manager&&negotiating===group.unit?<View style={styles.proposalForm}><Text style={styles.proposalTitle}>Nova proposta · {money(group.updatedTotalCents)}</Text><View style={styles.formRow}><View style={styles.field}><Text style={styles.fieldLabel}>Quantidade de parcelas</Text><TextInput value={installments} onChangeText={setInstallments} keyboardType="number-pad" style={styles.input}/></View><View style={styles.field}><Text style={styles.fieldLabel}>Primeiro vencimento</Text><TextInput value={firstDueDate} onChangeText={value=>setFirstDueDate(maskBrazilianDate(value))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={styles.input}/></View><View style={styles.formButton}><AppButton title="Salvar proposta" onPress={()=>createAgreement(group)} disabled={loading||!brazilianDateToIso(firstDueDate)}/></View></View><Text style={styles.formHint}>A dívida será congelada somente depois que o responsável aceitar a proposta.</Text></View>:null}

          {compact?<View style={styles.mobileDebtList}>{group.rows.map(row=><View key={row.id} style={[styles.mobileDebt,row.daysLate>0&&row.open&&styles.lateRow,!row.open&&styles.paidRow]}><View style={styles.mobileDebtHead}><View><Text style={styles.mobileDebtLabel}>REFERÊNCIA</Text><Text style={styles.mobileDebtMonth}>{formatBrazilianMonth(row.referenceMonth)}</Text></View><Text style={[styles.mobileStatus,row.daysLate>0&&row.open&&styles.mobileStatusLate,!row.open&&styles.mobileStatusPaid]}>{row.frozenByAgreement?'Em acordo':situation(row)}</Text></View><View style={styles.mobileDebtGrid}><View style={styles.mobileMetric}><Text style={styles.mobileMetricLabel}>Taxa</Text><Text style={styles.mobileMetricValue}>{money(row.principalCents)}</Text></View><View style={styles.mobileMetric}><Text style={styles.mobileMetricLabel}>Vencimento</Text><Text style={styles.mobileMetricValue}>{formatBrazilianDate(row.dueDate)}</Text></View><View style={styles.mobileMetric}><Text style={styles.mobileMetricLabel}>Dias em atraso</Text><Text style={styles.mobileMetricValue}>{row.daysLate}</Text></View><View style={styles.mobileMetric}><Text style={styles.mobileMetricLabel}>Multa 2%</Text><Text style={styles.mobileMetricValue}>{money(row.fineCents)}</Text></View><View style={styles.mobileMetric}><Text style={styles.mobileMetricLabel}>Mora diária</Text><Text style={styles.mobileMetricValue}>{money(row.interestCents)}</Text></View></View><View style={styles.mobileDebtTotal}><Text style={styles.mobileTotalLabel}>Total atualizado</Text><Text style={styles.mobileTotalValue}>{money(row.updatedTotalCents)}</Text></View></View>)}</View>:<ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.headerCell, styles.referenceCell]}>Referência</Text>
                <Text style={styles.headerCell}>Taxa</Text>
                <Text style={styles.headerCell}>Vencimento</Text>
                <Text style={styles.headerCell}>Dias de atraso</Text>
                <Text style={styles.headerCell}>Multa 2%</Text>
                <Text style={styles.headerCell}>Mora 0,0333% a.d.</Text>
                <Text style={styles.headerCell}>Total atualizado</Text>
                <Text style={styles.headerCell}>Situação</Text>
              </View>
              {group.rows.map(row => <View key={row.id} style={[styles.tableRow, row.daysLate > 0 && row.open && styles.lateRow, !row.open && styles.paidRow]}>
                <Text style={[styles.cell, styles.referenceCell, styles.reference]}>{formatBrazilianMonth(row.referenceMonth)}</Text>
                <Text style={styles.cell}>{money(row.principalCents)}</Text>
                <Text style={styles.cell}>{formatBrazilianDate(row.dueDate)}</Text>
                <Text style={styles.cell}>{row.daysLate}</Text>
                <Text style={styles.cell}>{money(row.fineCents)}</Text>
                <Text style={styles.cell}>{money(row.interestCents)}</Text>
                <Text style={[styles.cell, styles.amount]}>{money(row.updatedTotalCents)}</Text>
                <Text style={[styles.cell, styles.status, row.daysLate > 0 && row.open && styles.statusLate, !row.open && styles.statusPaid]}>{row.frozenByAgreement?'Em acordo':situation(row)}</Text>
              </View>)}
            </View>
          </ScrollView>}
        </View>) : <EmptyState title="Nenhum débito encontrado" description={manager ? 'Não há cobranças registradas para os apartamentos.' : 'Não há cobranças registradas para o seu apartamento.'} />}
      </> : null}
    </ScrollView>
  </ResponsiveShell>;
}

const columnWidth = 148;
const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1240, alignSelf: 'center', padding: 24, paddingBottom: 50, gap: 14 },
  containerMobile:{paddingHorizontal:14,paddingTop:18,paddingBottom:34},
  eyebrow: { color: colors.primary, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, lineHeight: 22 },
  updateBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#b8d6c1', backgroundColor: colors.softGreen, borderRadius: 10, padding: 14 },
  updateCopy: { flex: 1, minWidth: 240 }, updateAction: { minWidth: 170 },
  updateTitle: { color: colors.green, fontWeight: '900' }, updateText: { color: colors.muted, lineHeight: 20, marginTop: 3 }, updateDate: { color: colors.ink, fontWeight: '800', marginTop: 5 },
  error: { color: colors.red, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summary: { flexGrow: 1, minWidth: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: '#fff', padding: 13 },
  summaryValue: { color: colors.ink, fontSize: 20, fontWeight: '900' }, summaryLabel: { color: colors.muted, marginTop: 3 },
  summaryTotal: { flexGrow: 1, minWidth: 250, borderRadius: 8, backgroundColor: colors.red, padding: 13 },
  summaryTotalValue: { color: '#fff', fontSize: 21, fontWeight: '900' }, summaryTotalLabel: { color: '#fff', marginTop: 3 },
  agreements:{gap:8},sectionTitle:{color:colors.ink,fontSize:20,fontWeight:'900'},sectionHint:{color:colors.muted,lineHeight:20,marginBottom:3},agreementCard:{gap:13,borderWidth:1,borderColor:colors.border,borderRadius:11,backgroundColor:'#fff',padding:16},agreementCardDanger:{borderColor:colors.red,backgroundColor:'#fffafa'},agreementHeader:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10},grow:{flex:1,minWidth:220},agreementCode:{color:colors.primary,fontSize:12,fontWeight:'900'},agreementTitle:{color:colors.ink,fontSize:18,fontWeight:'900',marginTop:3},agreementStatus:{color:colors.primaryDark,backgroundColor:colors.softBlue,paddingHorizontal:10,paddingVertical:6,borderRadius:9,overflow:'hidden',fontWeight:'900'},agreementStatusDanger:{color:'#fff',backgroundColor:colors.red},agreementStatusSuccess:{color:'#fff',backgroundColor:colors.green},agreementValues:{flexDirection:'row',flexWrap:'wrap',gap:8},agreementValueBox:{flexGrow:1,minWidth:165,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#f8fafc',padding:11},valueLabel:{color:colors.muted,fontSize:13,fontWeight:'800'},valueText:{color:colors.ink,fontSize:17,fontWeight:'900',marginTop:4},valueStrong:{color:colors.primaryDark,fontSize:19,fontWeight:'900',marginTop:4},discountValue:{color:colors.green,fontSize:17,fontWeight:'900',marginTop:4},agreementInfo:{gap:5,borderLeftWidth:3,borderLeftColor:colors.primary,paddingLeft:11},infoText:{color:colors.muted,lineHeight:20},infoStrong:{color:colors.ink,fontWeight:'800'},agreementSection:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:11,gap:7},agreementSectionTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},detailRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,padding:10},detailTitle:{color:colors.ink,fontWeight:'900'},detailMeta:{color:colors.muted,fontSize:13,marginTop:3},detailAmounts:{minWidth:210,alignItems:'flex-end'},detailTotal:{color:colors.red,fontWeight:'900',marginTop:3},installmentHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},progress:{color:colors.primaryDark,fontWeight:'900'},installmentValue:{color:colors.ink,fontWeight:'900',minWidth:95,textAlign:'right'},installmentStatus:{color:colors.primaryDark,backgroundColor:colors.softBlue,paddingHorizontal:8,paddingVertical:5,borderRadius:8,overflow:'hidden',fontSize:12,fontWeight:'900',minWidth:120,textAlign:'center'},installmentPaid:{color:colors.green,backgroundColor:colors.softGreen},installmentOverdue:{color:'#fff',backgroundColor:colors.red},breachBox:{borderWidth:1,borderColor:colors.red,borderRadius:8,backgroundColor:'#fff1f1',padding:11},breachTitle:{color:colors.red,fontWeight:'900'},breachText:{color:colors.ink,lineHeight:20,marginTop:4},agreementActions:{flexDirection:'row',justifyContent:'flex-end',flexWrap:'wrap',gap:8},smallAction:{minWidth:170},acceptAction:{flexGrow:1,minWidth:260},
  unitCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff', overflow: 'hidden' },
  unitHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#dbeaf7' },
  unitIdentity: { flex: 1, minWidth: 190 }, unitLabel: { color: colors.primary, fontSize: 12, fontWeight: '900' }, unitTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', marginTop: 2 },
  unitTotalBox: { minWidth: 190, alignItems: 'flex-end' }, openBadge: { color: '#fff', backgroundColor: colors.red, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, overflow: 'hidden', marginBottom: 7 }, unitTotalLabel: { color: colors.muted, fontWeight: '800' }, unitTotal: { color: colors.red, fontSize: 22, fontWeight: '900', marginTop: 2 },
  mobileDebtList:{padding:12,gap:10,backgroundColor:'#f7f9fc'},mobileDebt:{borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:'#fff',padding:14},mobileDebtHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},mobileDebtLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.7},mobileDebtMonth:{color:colors.ink,fontSize:18,fontWeight:'900',marginTop:3},mobileStatus:{color:colors.primaryDark,backgroundColor:colors.softBlue,paddingHorizontal:9,paddingVertical:5,borderRadius:10,overflow:'hidden',fontSize:12,fontWeight:'900'},mobileStatusLate:{color:'#fff',backgroundColor:colors.red},mobileStatusPaid:{color:colors.green,backgroundColor:colors.softGreen},mobileDebtGrid:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:13},mobileMetric:{width:'47%',flexGrow:1,borderRadius:9,backgroundColor:'#f7f9fc',padding:9},mobileMetricLabel:{color:colors.muted,fontSize:12,fontWeight:'800'},mobileMetricValue:{color:colors.ink,fontWeight:'900',marginTop:3},mobileDebtTotal:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderTopColor:colors.border,marginTop:12,paddingTop:11},mobileTotalLabel:{color:colors.ink,fontWeight:'900'},mobileTotalValue:{color:colors.red,fontSize:19,fontWeight:'900'},
  unitActions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:8,padding:12,borderTopWidth:1,borderTopColor:colors.border},secondaryAction:{minHeight:42,justifyContent:'center',paddingHorizontal:14,borderWidth:1,borderColor:colors.primary,borderRadius:8},secondaryActionText:{color:colors.primary,fontWeight:'900'},primaryAction:{minHeight:42,justifyContent:'center',paddingHorizontal:14,backgroundColor:colors.primary,borderRadius:8},primaryActionText:{color:'#fff',fontWeight:'900'},proposalForm:{padding:14,backgroundColor:'#f8fafc',borderTopWidth:1,borderTopColor:colors.border},proposalTitle:{color:colors.ink,fontSize:17,fontWeight:'900'},formRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'flex-end',gap:10,marginTop:10},field:{flex:1,minWidth:180},fieldLabel:{color:colors.ink,fontWeight:'800',marginBottom:5},input:{minHeight:50,borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#fff',paddingHorizontal:11},formButton:{minWidth:170},formHint:{color:colors.muted,marginTop:9},
  table: { minWidth: 1220 }, tableRow: { flexDirection: 'row', minHeight: 54, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  tableHeader: { minHeight: 46, backgroundColor: '#f5f7fa' }, headerCell: { width: columnWidth, paddingHorizontal: 10, color: colors.muted, fontSize: 12, fontWeight: '900' },
  cell: { width: columnWidth, paddingHorizontal: 10, color: colors.ink, fontWeight: '700' }, referenceCell: { width: 170 }, reference: { fontWeight: '900' }, amount: { color: colors.red, fontWeight: '900' },
  lateRow: { backgroundColor: '#fff4f4' }, paidRow: { backgroundColor: '#f3faf5' }, status: { color: colors.primaryDark }, statusLate: { color: colors.red }, statusPaid: { color: colors.green },
});
