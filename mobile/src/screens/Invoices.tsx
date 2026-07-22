import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { apiRequest, openAuthenticatedPdf } from '../api/client';
import * as Clipboard from 'expo-clipboard';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import ResponsiveShell from '../ui/ResponsiveShell';
import { colors } from '../ui/theme';
import { brazilianMonthToIso, formatBrazilianDate, formatBrazilianMonth, maskBrazilianMonth } from '../utils/date';

type InvoiceStatus = 'pending_provider' | 'issued' | 'paid' | 'overdue' | 'canceled';
type Invoice = {
  id:string; amount_cents:number; due_date:string; reference_month:string|null; status:InvoiceStatus;
  provider:string; external_id:string|null; digitable_line:string|null; paid_at?:string|null;
  pix_copy_paste?:string|null;
  paid_amount_cents?:number|null; user_username?:string; user_full_name?:string|null;
  invoice_type?:'regular'|'agreement'; agreement_id?:string|null;
};
type Person={id:string;full_name:string|null;username:string;unit:string|null;unit_type_name?:string|null;condominium_fee_cents?:number|null;billing_exempt?:boolean;preferred_due_day?:number};

const statusLabel:Record<InvoiceStatus,string>={pending_provider:'Aguardando Inter',issued:'Em aberto',paid:'Pago',overdue:'Vencido',canceled:'Cancelado'};
const money=(c:number)=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const monthKey=(item:Invoice)=>(item.reference_month||item.due_date).slice(0,7);
const currentMonth=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`};
const currentBrazilianMonth=()=>formatBrazilianMonth(currentMonth());

export default function Invoices({navigation}:any){
  const {width}=useWindowDimensions();const compact=width<760;
  const {userToken,user}=useContext(AuthContext);
  const [items,setItems]=useState<Invoice[]>([]);
  const [referenceFilter,setReferenceFilter]=useState(currentMonth());
  const [statusFilter,setStatusFilter]=useState<'all'|InvoiceStatus>('all');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [dialog,setDialog]=useState<{title:string;message:string;tone:'info'|'success'|'error';confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void}|null>(null);
  const [people,setPeople]=useState<Person[]>([]);const [selectedPersonId,setSelectedPersonId]=useState('');const [personSearch,setPersonSearch]=useState('');
  const [beneficiaryName,setBeneficiaryName]=useState('');const [beneficiaryDocument,setBeneficiaryDocument]=useState('');
  const [description,setDescription]=useState('Taxa condominial');const [emissionMonth,setEmissionMonth]=useState(currentBrazilianMonth());
  const canManage=user?.role==='sindico'||user?.role==='subsindico';

  const load=useCallback(async()=>{
    if(!userToken)return;setLoading(true);setError(null);
    try{const requests:Promise<any>[]=[apiRequest<{invoices:Invoice[]}>('/invoices',userToken)];if(canManage)requests.push(apiRequest('/users',userToken),apiRequest('/billing/settings',userToken));const [response,usersResponse,settingsResponse]=await Promise.all(requests);setItems(response.invoices);if(canManage){setPeople(usersResponse.users.filter((person:any)=>['proprietario','inquilino'].includes(person.role)&&!person.billing_exempt));setBeneficiaryName(settingsResponse.condominium?.name||'');setBeneficiaryDocument(settingsResponse.condominium?.cnpj||'');if(settingsResponse.settings?.description_template)setDescription(settingsResponse.settings.description_template)}}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível carregar as cobranças.')}
    finally{setLoading(false)}
  },[canManage,userToken]);
  useEffect(()=>{load()},[load]);

  const references=useMemo(()=>Array.from(new Set([currentMonth(),...items.map(monthKey)])).sort().reverse(),[items]);
  const referenceItems=useMemo(()=>items.filter(item=>referenceFilter==='all'||monthKey(item)===referenceFilter),[items,referenceFilter]);
  const visibleItems=useMemo(()=>referenceItems.filter(item=>{
    const matchesStatus=statusFilter==='all'||item.status===statusFilter;
    const name=(item.user_full_name||item.user_username||'').toLocaleLowerCase('pt-BR');
    return matchesStatus&&name.includes(search.trim().toLocaleLowerCase('pt-BR'));
  }),[referenceItems,statusFilter,search]);
  const groups=useMemo(()=>Array.from(new Set(visibleItems.map(monthKey))).sort().reverse().map(reference=>({reference,items:visibleItems.filter(item=>monthKey(item)===reference)})),[visibleItems]);
  const received=referenceItems.filter(i=>i.status==='paid').reduce((sum,i)=>sum+Number(i.paid_amount_cents||i.amount_cents),0);
  const open=referenceItems.filter(i=>!['paid','canceled'].includes(i.status)).reduce((sum,i)=>sum+i.amount_cents,0);
  const overdue=referenceItems.filter(i=>i.status==='overdue');
  const selectedPerson=people.find(person=>person.id===selectedPersonId);
  const filteredPeople=useMemo(()=>{const term=personSearch.trim().toLocaleLowerCase('pt-BR');if(term.length<2)return[];return people.filter(person=>(person.full_name||person.username).toLocaleLowerCase('pt-BR').includes(term)).slice(0,8)},[people,personSearch]);

  const syncAll=async()=>{if(!userToken)return;setLoading(true);setError(null);try{const result=await apiRequest<{message:string;failed:number}>('/invoices/sync-all',userToken,{method:'POST'});setDialog({title:result.failed?'Atualização concluída com pendências':'Cobranças atualizadas',message:result.message,tone:result.failed?'error':'success'});await load()}catch(e){setDialog({title:'Não foi possível atualizar',message:e instanceof Error?e.message:'Falha ao consultar o Banco Inter.',tone:'error'})}finally{setLoading(false)}};
  const openPdf=async(id:string)=>{if(!userToken)return;try{await openAuthenticatedPdf(`/invoices/${id}/pdf`,userToken)}catch(e){setDialog({title:'Não foi possível abrir o PDF',message:e instanceof Error?e.message:'Falha ao buscar o boleto no Banco Inter.',tone:'error'})}};
  const payWithPix=async(id:string)=>{if(!userToken)return;try{const data=await apiRequest<{pixCopyPaste:string}>(`/invoices/${id}/pix`,userToken);await Clipboard.setStringAsync(data.pixCopyPaste);setDialog({title:'Código Pix copiado',message:'Abra o aplicativo do seu banco, escolha pagar via Pix Copia e Cola e cole o código.',tone:'success'})}catch(e){setDialog({title:'Pix indisponível',message:e instanceof Error?e.message:'Não foi possível consultar o Pix no Banco Inter.',tone:'error'})}};
  const executeIndividualEmission=async()=>{const referenceMonth=brazilianMonthToIso(emissionMonth);if(!userToken||!selectedPersonId||!referenceMonth)return;setDialog(null);setLoading(true);setError(null);try{const preview=await apiRequest<any>('/billing/batches/preview',userToken,{method:'POST',body:JSON.stringify({referenceMonth,userIds:[selectedPersonId]})});const candidate=preview.items[0];if(!candidate?.valid)throw new Error(candidate?.issues?.join(' · ')||'A pessoa selecionada não está apta para emissão.');const created=await apiRequest<any>('/billing/batches',userToken,{method:'POST',body:JSON.stringify({referenceMonth,description:description.trim(),userIds:[selectedPersonId]})});await apiRequest(`/billing/batches/${created.batch.id}/confirm`,userToken,{method:'POST'});const result=await apiRequest<any>(`/billing/batches/${created.batch.id}/issue`,userToken,{method:'POST'});setDialog({title:result.failed?'Boleto não emitido':'Boleto emitido',message:result.message,tone:result.failed?'error':'success'});if(!result.failed)setSelectedPersonId('');await load()}catch(e){setDialog({title:'Não foi possível emitir o boleto',message:e instanceof Error?e.message:'Falha durante a emissão.',tone:'error'})}finally{setLoading(false)}};
  const confirmIndividualEmission=()=>{setDialog({title:'Confirmar emissão individual?',message:`O boleto de ${selectedPerson?.full_name||selectedPerson?.username||'morador selecionado'} será enviado ao Banco Inter para a referência ${emissionMonth}.`,tone:'info',confirmLabel:'Sim, emitir boleto',cancelLabel:'Revisar dados',onConfirm:executeIndividualEmission})};

  return <ResponsiveShell activeRoute="Invoices" navigation={navigation}><ScrollView contentContainerStyle={[s.container,compact&&s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
    <Text style={s.eyebrow}>COBRANÇAS</Text><Text style={s.title}>Gestão de cobranças</Text>
    <Text style={s.subtitle}>Acompanhe recebimentos, valores em aberto e atrasos por mês de referência.</Text>
    {canManage?<View style={s.generalAction}><AppButton title={loading?'Atualizando cobranças...':'Atualizar todos os boletos'} onPress={syncAll} disabled={loading} variant="secondary"/></View>:null}

    <View style={s.summaryRow}>
      <View style={s.summary}><Text style={s.summaryValue}>{money(received)}</Text><Text style={s.summaryLabel}>recebido na referência</Text></View>
      <View style={s.summary}><Text style={s.summaryValue}>{money(open)}</Text><Text style={s.summaryLabel}>em aberto na referência</Text></View>
      <View style={[s.summary,overdue.length>0&&s.summaryDanger]}><Text style={[s.summaryValue,overdue.length>0&&s.dangerText]}>{overdue.length}</Text><Text style={s.summaryLabel}>boletos vencidos</Text></View>
      <View style={s.summary}><Text style={s.summaryValue}>{referenceItems.length}</Text><Text style={s.summaryLabel}>boletos na referência</Text></View>
    </View>

    {canManage?<Panel><Text style={s.panelTitle}>Nova emissão individual</Text><Text style={s.panelText}>Pesquise pelo nome e selecione uma única pessoa. Valor, endereço, regras e vencimento serão carregados do cadastro.</Text><Text style={s.label}>Pesquisar pessoa</Text>{selectedPerson?<View style={[s.person,s.personOn]}><View style={s.personInfo}><Text style={[s.personName,s.personNameOn]}>✓ {selectedPerson.full_name||selectedPerson.username}</Text><Text style={s.personMeta}>{selectedPerson.unit||'Sem unidade'} · {selectedPerson.unit_type_name||'Sem tipologia'} · vence dia {selectedPerson.preferred_due_day||10}</Text></View><Text style={s.personValue}>{selectedPerson.condominium_fee_cents?money(selectedPerson.condominium_fee_cents):'Sem valor'}</Text><Pressable onPress={()=>{setSelectedPersonId('');setPersonSearch('')}} style={s.changePerson}><Text style={s.changePersonText}>Trocar</Text></Pressable></View>:<><TextInput value={personSearch} onChangeText={setPersonSearch} placeholder="Digite ao menos 2 letras do nome" autoCapitalize="words" style={s.input}/>{personSearch.trim().length>=2?<View style={s.peopleList}>{filteredPeople.length?filteredPeople.map(person=><Pressable key={person.id} onPress={()=>{setSelectedPersonId(person.id);setPersonSearch(person.full_name||person.username)}} style={s.person}><View style={s.personInfo}><Text style={s.personName}>{person.full_name||person.username}</Text><Text style={s.personMeta}>{person.unit||'Sem unidade'} · {person.unit_type_name||'Sem tipologia'}</Text></View><Text style={s.personValue}>{person.condominium_fee_cents?money(person.condominium_fee_cents):'Sem valor'}</Text></Pressable>):<Text style={s.noResult}>Nenhuma pessoa encontrada.</Text>}</View>:null}</>}<Text style={s.label}>Nome do beneficiário final</Text><TextInput value={beneficiaryName} editable={false} style={[s.input,s.readonly]}/><Text style={s.label}>CPF ou CNPJ do beneficiário</Text><TextInput value={beneficiaryDocument} editable={false} style={[s.input,s.readonly]}/><Text style={s.label}>Descrição na observação do boleto</Text><TextInput value={description} onChangeText={value=>setDescription(value.slice(0,100))} maxLength={100} placeholder="Descrição da cobrança" style={s.input}/><Text style={s.label}>Mês de referência</Text><TextInput value={emissionMonth} onChangeText={value=>setEmissionMonth(maskBrazilianMonth(value))} maxLength={7} keyboardType="number-pad" placeholder="MM/AAAA" style={s.input}/><AppButton title="Emitir boleto para a pessoa selecionada" onPress={confirmIndividualEmission} disabled={loading||!selectedPersonId||!beneficiaryName||!beneficiaryDocument||!description.trim()||!brazilianMonthToIso(emissionMonth)}/></Panel>:null}

    <Panel><Text style={s.panelTitle}>Filtros</Text><Text style={s.label}>Mês de referência</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}><Pressable onPress={()=>setReferenceFilter('all')} style={[s.chip,referenceFilter==='all'&&s.chipOn]}><Text style={[s.chipText,referenceFilter==='all'&&s.chipTextOn]}>Todo o histórico</Text></Pressable>{references.map(value=><Pressable key={value} onPress={()=>setReferenceFilter(value)} style={[s.chip,referenceFilter===value&&s.chipOn]}><Text style={[s.chipText,referenceFilter===value&&s.chipTextOn]}>{formatBrazilianMonth(value)}{value===currentMonth()?' · atual':''}</Text></Pressable>)}</ScrollView>
      <Text style={s.label}>Buscar pessoa</Text><TextInput value={search} onChangeText={setSearch} placeholder="Digite o nome do morador" style={s.input}/>
      <Text style={s.label}>Situação</Text><View style={s.filters}>{(['all','pending_provider','issued','paid','overdue','canceled'] as const).map(value=><Pressable key={value} onPress={()=>setStatusFilter(value)} style={[s.chip,statusFilter===value&&s.chipOn]}><Text style={[s.chipText,statusFilter===value&&s.chipTextOn]}>{value==='all'?'Todas':statusLabel[value]}</Text></Pressable>)}</View>
    </Panel>

    {error?<Text style={s.error}>{error}</Text>:null}
    {groups.length===0?<EmptyState title="Nenhuma cobrança encontrada" description={referenceFilter===currentMonth()?'Ainda não há boletos emitidos para a referência atual.':'Altere os filtros para consultar outras cobranças.'}/>:groups.map(group=><View key={group.reference} style={s.group}>
      <View style={s.groupHeader}><View><Text style={s.groupTitle}>Referência {formatBrazilianMonth(group.reference)}</Text><Text style={s.groupMeta}>{group.items.length} cobrança(s)</Text></View><Text style={s.groupTotal}>{money(group.items.reduce((sum,item)=>sum+item.amount_cents,0))}</Text></View>
      {group.items.map(item=><View key={item.id} style={[s.card,item.status==='overdue'&&s.overdueCard]}><View style={s.cardTop}><View style={s.nameArea}><Text style={s.cardTitle}>{item.user_full_name||item.user_username||'Morador'}</Text>{item.invoice_type==='agreement'?<Text style={s.agreementTag}>PARCELA DE ACORDO · {item.agreement_id?.slice(0,8).toUpperCase()}</Text>:null}<Text style={s.cardValue}>{money(item.amount_cents)}</Text></View><Text style={[s.badge,item.status==='paid'&&s.badgePaid,item.status==='overdue'&&s.badgeOverdue]}>{statusLabel[item.status]}</Text></View>
        {item.status==='overdue'?<Text style={s.overdueAlert}>Pagamento atrasado — vencimento enviado ao banco: {formatBrazilianDate(item.due_date)}</Text>:<Text style={s.line}>Vencimento enviado ao banco: {formatBrazilianDate(item.due_date)}</Text>}
        <Text style={s.line}>Banco: {item.provider}</Text>{item.paid_at?<Text style={s.paidLine}>Pagamento identificado em {formatBrazilianDate(item.paid_at)} · {money(Number(item.paid_amount_cents||item.amount_cents))}</Text>:null}
        {item.status==='canceled'?<View style={s.canceledWarning}><Text style={s.canceledWarningTitle}>Boleto cancelado — não utilizar para pagamento</Text><Text style={s.canceledLine}>{item.digitable_line||'Linha digitável indisponível'}</Text></View>:<><Text style={s.digitable}>{item.digitable_line||'Linha digitável aguardando atualização do banco'}</Text>{item.external_id?<View style={s.paymentActions}><View style={s.paymentButton}><AppButton title="Abrir / imprimir PDF" onPress={()=>openPdf(item.id)} variant="secondary"/></View>{['issued','overdue'].includes(item.status)?<View style={s.paymentButton}><AppButton title="Pagar via Pix" onPress={()=>payWithPix(item.id)}/></View>:null}</View>:null}</>}
      </View>)}
    </View>)}
  </ScrollView><AppDialog visible={Boolean(dialog)} title={dialog?.title||''} message={dialog?.message||''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={()=>setDialog(null)}/></ResponsiveShell>;
}

const s=StyleSheet.create({
  containerMobile:{paddingHorizontal:14,paddingTop:18,paddingBottom:34},
  container:{width:'100%',maxWidth:1180,alignSelf:'center',padding:24,paddingBottom:50,gap:14,backgroundColor:colors.background},eyebrow:{color:colors.primary,fontWeight:'900'},title:{color:colors.ink,fontSize: 28,fontWeight:'900'},subtitle:{color:colors.muted,lineHeight: 22,marginBottom:4},
  summaryRow:{flexDirection:'row',flexWrap:'wrap',gap:10},summary:{flexGrow:1,minWidth:190,borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:'#fff',padding:14},summaryDanger:{borderColor:'#ef9a9a',backgroundColor:'#fff5f5'},summaryValue:{color:colors.ink,fontSize: 20,fontWeight:'900'},summaryLabel:{color:colors.muted,marginTop:3},dangerText:{color:colors.red},
  panelTitle:{color:colors.ink,fontSize: 19,fontWeight:'900',marginBottom:8},panelText:{color:colors.muted,lineHeight: 21,marginBottom:14},label:{color:colors.ink,fontWeight:'800',fontSize: 16,marginBottom:7},input:{minHeight: 52,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:12,backgroundColor:'#fff',color:colors.ink,marginBottom:12},readonly:{backgroundColor:'#f2f4f7',color:colors.primaryDark,fontWeight:'800'},peopleList:{gap:7,marginBottom:14,maxHeight:300},person:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,padding:11,backgroundColor:'#fff'},personOn:{borderColor:colors.primary,backgroundColor:colors.softBlue},personInfo:{flex:1},personName:{color:colors.ink,fontWeight:'900'},personNameOn:{color:colors.primaryDark},personMeta:{color:colors.muted,fontSize: 15,marginTop:3},personValue:{color:colors.primaryDark,fontWeight:'900'},filterScroll:{gap:7,paddingBottom:13},filters:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{borderWidth:1,borderColor:colors.border,borderRadius:20,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#fff'},chipOn:{backgroundColor:colors.primary,borderColor:colors.primary},chipText:{color:colors.muted,fontWeight:'800',fontSize: 15},chipTextOn:{color:'#fff'},
  changePerson:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:'#fff'},changePersonText:{color:colors.primary,fontWeight:'900'},noResult:{color:colors.muted,padding:12,textAlign:'center'},generalAction:{alignSelf:'flex-start',minWidth:240},error:{color:colors.red,fontWeight:'800'},group:{gap:8},groupHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:8},groupTitle:{color:colors.ink,fontSize: 19,fontWeight:'900'},groupMeta:{color:colors.muted,marginTop:2},groupTotal:{color:colors.primaryDark,fontSize: 19,fontWeight:'900'},card:{borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:'#fff',padding:14},overdueCard:{borderWidth:2,borderColor:colors.red,backgroundColor:'#fff8f8'},cardTop:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},nameArea:{flex:1},cardTitle:{color:colors.ink,fontSize: 18,fontWeight:'900'},agreementTag:{color:'#7a4d00',backgroundColor:'#fff3d6',alignSelf:'flex-start',fontSize:12,fontWeight:'900',paddingHorizontal:7,paddingVertical:4,borderRadius:7,overflow:'hidden',marginTop:5},cardValue:{color:colors.primaryDark,fontSize: 19,fontWeight:'900',marginTop:5},badge:{color:colors.primaryDark,backgroundColor:colors.softBlue,borderRadius:12,overflow:'hidden',paddingHorizontal:9,paddingVertical:5,fontSize: 15,fontWeight:'900'},badgePaid:{color:colors.green,backgroundColor:colors.softGreen},badgeOverdue:{color:'#fff',backgroundColor:colors.red},line:{color:colors.muted,marginTop:6},overdueAlert:{color:colors.red,fontWeight:'900',marginTop:10},paidLine:{color:colors.green,fontWeight:'800',marginTop:7},digitable:{color:colors.ink,backgroundColor:'#f7f9fc',borderRadius:8,padding:10,marginTop:10,lineHeight: 21},pdfAction:{marginTop:10},paymentActions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},paymentButton:{flexGrow:1,minWidth:180},canceledWarning:{backgroundColor:'#fff2f2',borderWidth:1,borderColor:'#efb2b2',borderRadius:8,padding:10,marginTop:10},canceledWarningTitle:{color:colors.red,fontWeight:'900'},canceledLine:{color:colors.muted,textDecorationLine:'line-through',marginTop:5}
});
