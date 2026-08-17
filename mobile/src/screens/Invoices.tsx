import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest, downloadAuthenticated, openAuthenticatedPdf } from '../api/client';
import * as Clipboard from 'expo-clipboard';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel, summaryLabelProps, summaryValueProps } from '../ui/components';
import { colors } from '../ui/theme';
import { brazilianMonthToIso, formatBrazilianDate, formatBrazilianMonth, maskBrazilianMonth } from '../utils/date';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type InvoiceStatus = 'pending_provider' | 'issued' | 'paid' | 'overdue' | 'canceled';
type Invoice = {
  id:string; user_id?:string; amount_cents:number; due_date:string; reference_month:string|null; status:InvoiceStatus;
  provider:string; external_id:string|null; digitable_line:string|null; paid_at?:string|null;
  pix_copy_paste?:string|null;
  paid_amount_cents?:number|null; user_username?:string; user_full_name?:string|null;
  invoice_type?:'regular'|'agreement'; agreement_id?:string|null;
  cancellation_reason?:string|null;
  provider_situation?:string|null;
  debt_excluded_at?:string|null; debt_exclusion_reason?:string|null; debt_excluded_by_name?:string|null;
  condo_fee_percent?:number|null; condo_fee_cents?:number|null;
  improvement_fee_percent?:number|null; improvement_fee_cents?:number|null;
  condo_base_fee_cents?:number|null;
  extra_charge_items?:Array<{description:string;amount_cents:number}>;
  consumption_items?:Array<{utility_type:string;quantity:number;unit_price_cents:number;amount_cents:number}>;
};
const utilityLabel:Record<string,string>={agua:'Água',gas:'Gás',energia:'Energia'};
type Person={id:string;full_name:string|null;username:string;unit:string|null;unit_type_name?:string|null;condominium_fee_cents?:number|null;billing_exempt?:boolean;preferred_due_day?:number};
// Boleto que existe no Banco Inter e não tem morador correspondente no sistema.
type UnmatchedBankCharge={id:string;externalId:string;payerDocument:string;payerName:string|null;dueDate:string;amountCents:number;providerSituation:string|null};

const statusLabel:Record<InvoiceStatus,string>={pending_provider:'Aguardando Inter',issued:'Em aberto',paid:'Pago',overdue:'Vencido',canceled:'Cancelado'};

// invoice_status é grosso demais para a tela: EXPIRADO e ATRASADO no Banco
// Inter viram os dois 'overdue', e o morador via "Vencido — pague este boleto"
// num boleto que o banco não aceita mais receber. provider_situation guarda a
// situação real do banco e é ela que manda no rótulo.
const isExpiredAtBank=(item:Invoice)=>item.provider_situation==='EXPIRADO'&&item.status!=='paid'&&item.status!=='canceled';
const isProcessingAtBank=(item:Invoice)=>item.provider_situation==='EM_PROCESSAMENTO'&&item.status!=='paid'&&item.status!=='canceled';
const invoiceLabel=(item:Invoice)=>{
  // Pago/cancelado vêm antes da retirada da dívida: um boleto retirado que
  // depois é pago no banco continua com debt_excluded_at preenchido (nenhuma
  // rotina de sincronização limpa esse campo, de propósito — é registro do
  // síndico, não do banco), e mostrar "Fora da dívida" esconderia o fato mais
  // importante, que é o pagamento. O histórico da retirada segue visível no
  // bloco abaixo do card.
  if(item.status==='paid')return statusLabel.paid;
  if(item.status==='canceled')return statusLabel.canceled;
  if(item.debt_excluded_at)return 'Fora da dívida';
  if(isExpiredAtBank(item))return 'Expirado no banco';
  if(isProcessingAtBank(item))return 'Em processamento';
  return statusLabel[item.status];
};
// Um boleto retirado da dívida continua existindo e aparecendo, mas não soma
// mais em "Em aberto" nem em Gestão de débitos — igual ao que a API faz.
const countsAsDebt=(item:Invoice)=>!['paid','canceled'].includes(item.status)&&!item.debt_excluded_at;
const money=(c:number)=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const maskCurrency=(value:string)=>money(Number(value.replace(/\D/g,'')||0));
const currencyToCents=(value:string)=>{const amount=Number(value.replace(/\./g,'').replace(',','.').replace(/[^\d.]/g,''));return Number.isFinite(amount)&&amount>0?Math.round(amount*100):0};
const monthKey=(item:Invoice)=>(item.reference_month||item.due_date).slice(0,7);
const currentMonth=()=>{const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`};
const currentBrazilianMonth=()=>formatBrazilianMonth(currentMonth());

export default function Invoices({navigation}:any){
  const {isMobile:compact}=useBreakpoint();
  const {userToken,user}=useContext(AuthContext);
  const [items,setItems]=useState<Invoice[]>([]);
  const [referenceFilter,setReferenceFilter]=useState(currentMonth());
  const [statusFilter,setStatusFilter]=useState<'all'|InvoiceStatus>('all');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [dialog,setDialog]=useState<{title:string;message:string;tone:'info'|'success'|'error';confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void;scrollable?:boolean}|null>(null);
  const [people,setPeople]=useState<Person[]>([]);const [selectedPersonId,setSelectedPersonId]=useState('');const [personSearch,setPersonSearch]=useState('');
  const [beneficiaryName,setBeneficiaryName]=useState('');const [beneficiaryDocument,setBeneficiaryDocument]=useState('');
  const [description,setDescription]=useState('Taxa condominial');const [emissionMonth,setEmissionMonth]=useState(currentBrazilianMonth());const [manualAmount,setManualAmount]=useState('');
  const canManage=user?.role==='sindico'||user?.role==='subsindico';
  const {scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();
  const [reasonEditingId,setReasonEditingId]=useState('');const [reasonDraft,setReasonDraft]=useState('');const [reasonSettled,setReasonSettled]=useState(false);const [reasonSaving,setReasonSaving]=useState(false);
  const [downloadingZip,setDownloadingZip]=useState(false);
  const [debtEditingId,setDebtEditingId]=useState('');const [debtReasonDraft,setDebtReasonDraft]=useState('');const [debtSaving,setDebtSaving]=useState(false);const [debtSettledViaPix,setDebtSettledViaPix]=useState(false);
  const [unmatched,setUnmatched]=useState<UnmatchedBankCharge[]>([]);

  const load=useCallback(async()=>{
    if(!userToken)return;setLoading(true);setError(null);
    try{const requests:Promise<any>[]=[apiRequest<{invoices:Invoice[]}>('/invoices',userToken)];if(canManage)requests.push(apiRequest('/users',userToken),apiRequest('/billing/settings',userToken),apiRequest('/invoices/unmatched-bank-charges',userToken));const [response,usersResponse,settingsResponse,unmatchedResponse]=await Promise.all(requests);setItems(response.invoices);if(canManage){setPeople(usersResponse.users.filter((person:any)=>['proprietario','inquilino'].includes(person.role)&&!person.billing_exempt));setBeneficiaryName(settingsResponse.condominium?.name||'');setBeneficiaryDocument(settingsResponse.condominium?.cnpj||'');if(settingsResponse.settings?.description_template)setDescription(settingsResponse.settings.description_template);setUnmatched(unmatchedResponse?.charges||[])}}
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
  const received=referenceItems.filter(i=>Boolean(i.paid_at)).reduce((sum,i)=>sum+Number(i.paid_amount_cents||i.amount_cents),0);
  const open=referenceItems.filter(countsAsDebt).reduce((sum,i)=>sum+i.amount_cents,0);
  const overdue=referenceItems.filter(i=>i.status==='overdue'&&!i.debt_excluded_at);
  const expiredAtBank=referenceItems.filter(i=>isExpiredAtBank(i)&&!i.debt_excluded_at);
  const excludedFromDebt=referenceItems.filter(i=>Boolean(i.debt_excluded_at));
  const selectedPerson=people.find(person=>person.id===selectedPersonId);
  const filteredPeople=useMemo(()=>{const term=personSearch.trim().toLocaleLowerCase('pt-BR');if(term.length<2)return[];return people.filter(person=>(person.full_name||person.username).toLocaleLowerCase('pt-BR').includes(term)).slice(0,8)},[people,personSearch]);

  const syncAll=async()=>{if(!userToken)return;setLoading(true);setError(null);try{const result=await apiRequest<{message:string;failed:number;unmatched?:unknown[];conflicts?:unknown[]}>('/invoices/sync-all',userToken,{method:'POST'});setReferenceFilter('all');setStatusFilter('all');const hasPendencies=Boolean(result.failed||result.unmatched?.length||result.conflicts?.length);setDialog({title:hasPendencies?'Atualização concluída com pendências':'Cobranças atualizadas',message:result.message,tone:hasPendencies?'error':'success',scrollable:true});await load()}catch(e){setDialog({title:'Não foi possível atualizar',message:e instanceof Error?e.message:'Falha ao consultar o Banco Inter.',tone:'error'})}finally{setLoading(false)}};
  const openPdf=async(id:string)=>{if(!userToken)return;try{await openAuthenticatedPdf(`/invoices/${id}/pdf`,userToken)}catch(e){setDialog({title:'Não foi possível abrir o PDF',message:e instanceof Error?e.message:'Falha ao buscar o boleto no Banco Inter.',tone:'error'})}};
  const downloadPdfsZip=async()=>{if(!userToken||referenceFilter==='all')return;setDownloadingZip(true);try{await downloadAuthenticated(`/invoices/export-pdfs?referenceMonth=${referenceFilter}`,userToken,`boletos-${referenceFilter}.zip`,{awaitCompletion:true})}catch(e){setDialog({title:'Não foi possível baixar os boletos',message:e instanceof Error?e.message:'Falha ao gerar o arquivo com os boletos desta referência.',tone:'error'})}finally{setDownloadingZip(false)}};
  const startReasonEdit=(item:Invoice)=>{setReasonEditingId(item.id);setReasonDraft(item.cancellation_reason||'');setReasonSettled(Boolean(item.paid_at))};
  const cancelReasonEdit=()=>{setReasonEditingId('');setReasonDraft('');setReasonSettled(false)};
  const saveCancellationReason=async(id:string)=>{if(!userToken||!reasonDraft.trim())return;setReasonSaving(true);try{const response=await apiRequest<{cancellationReason:string|null;paidAmountCents:number|null;paidAt:string|null}>(`/invoices/${id}/cancellation-reason`,userToken,{method:'PATCH',body:JSON.stringify({reason:reasonDraft.trim(),settledExternally:reasonSettled})});setItems(current=>current.map(item=>item.id===id?{...item,cancellation_reason:response.cancellationReason,paid_amount_cents:response.paidAmountCents,paid_at:response.paidAt}:item));setReasonEditingId('');setReasonDraft('');setReasonSettled(false)}catch(e){setDialog({title:'Não foi possível salvar',message:e instanceof Error?e.message:'Falha ao registrar o motivo do cancelamento.',tone:'error'})}finally{setReasonSaving(false)}};
  const startDebtEdit=(item:Invoice)=>{setDebtEditingId(item.id);setDebtReasonDraft('');setDebtSettledViaPix(false)};
  const cancelDebtEdit=()=>{setDebtEditingId('');setDebtReasonDraft('');setDebtSettledViaPix(false)};
  // Retirar da dívida não apaga nem cancela o boleto: ele continua na tela, com
  // a justificativa registrada, e apenas deixa de contar em Gestão de débitos,
  // no painel e nos indicadores. Reversível pelo mesmo endpoint.
  const setDebtExclusion=async(id:string,excluded:boolean)=>{
    if(!userToken)return;if(excluded&&!debtReasonDraft.trim())return;
    setDebtSaving(true);
    try{
      const response=await apiRequest<{debtExcludedAt:string|null;debtExclusionReason:string|null;paidAmountCents:number|null;paidAt:string|null}>(`/invoices/${id}/debt-exclusion`,userToken,{method:'PATCH',body:JSON.stringify(excluded?{excluded:true,reason:debtReasonDraft.trim(),paidViaPix:debtSettledViaPix}:{excluded:false})});
      setItems(current=>current.map(item=>item.id===id?{...item,debt_excluded_at:response.debtExcludedAt,debt_exclusion_reason:response.debtExclusionReason,debt_excluded_by_name:excluded?(user?.fullName||user?.username||null):null,paid_amount_cents:response.paidAmountCents,paid_at:response.paidAt}:item));
      cancelDebtEdit();
      setDialog({title:excluded?'Boleto retirado da dívida':'Boleto devolvido à dívida',message:excluded?`Este boleto deixou de contar em Gestão de débitos, no painel e nos indicadores. A justificativa ficou registrada no histórico.${debtSettledViaPix?' O valor foi somado ao total recebido do mês.':''}`:'Este boleto voltou a contar como valor a receber.',tone:'success'});
    }catch(e){setDialog({title:'Não foi possível concluir',message:e instanceof Error?e.message:'Falha ao atualizar a dívida deste boleto.',tone:'error'})}
    finally{setDebtSaving(false)}
  };
  const dismissUnmatched=async(id:string)=>{
    if(!userToken)return;
    try{await apiRequest(`/invoices/unmatched-bank-charges/${id}/dismiss`,userToken,{method:'PATCH'});setUnmatched(current=>current.filter(item=>item.id!==id))}
    catch(e){setDialog({title:'Não foi possível dispensar',message:e instanceof Error?e.message:'Falha ao dispensar o aviso.',tone:'error'})}
  };
  const payWithPix=async(id:string)=>{if(!userToken)return;try{const data=await apiRequest<{pixCopyPaste:string}>(`/invoices/${id}/pix`,userToken);await Clipboard.setStringAsync(data.pixCopyPaste);setDialog({title:'Código Pix copiado',message:'Abra o aplicativo do seu banco, escolha pagar via Pix Copia e Cola e cole o código.',tone:'success'})}catch(e){setDialog({title:'Pix indisponível',message:e instanceof Error?e.message:'Não foi possível consultar o Pix no Banco Inter.',tone:'error'})}};
  const executeIndividualEmission=async()=>{const referenceMonth=brazilianMonthToIso(emissionMonth);if(!userToken||!selectedPersonId||!referenceMonth)return;setDialog(null);setLoading(true);setError(null);const manualAmountCents=currencyToCents(manualAmount);const amountOverrides=manualAmountCents>0?{[selectedPersonId]:manualAmountCents}:undefined;try{const preview=await apiRequest<any>('/billing/batches/preview',userToken,{method:'POST',body:JSON.stringify({referenceMonth,userIds:[selectedPersonId],amountOverrides})});const candidate=preview.items[0];if(!candidate?.valid)throw new Error(candidate?.issues?.join(' · ')||'A pessoa selecionada não está apta para emissão.');const created=await apiRequest<any>('/billing/batches',userToken,{method:'POST',body:JSON.stringify({referenceMonth,description:description.trim(),userIds:[selectedPersonId],amountOverrides})});await apiRequest(`/billing/batches/${created.batch.id}/confirm`,userToken,{method:'POST'});const result=await apiRequest<any>(`/billing/batches/${created.batch.id}/issue`,userToken,{method:'POST'});setDialog({title:result.failed?'Boleto não emitido':'Boleto emitido',message:result.message,tone:result.failed?'error':'success'});if(!result.failed){setSelectedPersonId('');setManualAmount('')}await load()}catch(e){setDialog({title:'Não foi possível emitir o boleto',message:e instanceof Error?e.message:'Falha durante a emissão.',tone:'error'})}finally{setLoading(false)}};
  const confirmIndividualEmission=async()=>{
    if(!selectedPersonId){setDialog({title:'Selecione uma pessoa',message:'Pesquise e selecione a pessoa que vai receber o boleto antes de emitir.',tone:'error'});return}
    if(!beneficiaryName||!beneficiaryDocument){setDialog({title:'Dados do condomínio incompletos',message:'Não foi possível carregar o nome ou o CNPJ do condomínio (usados como beneficiário do boleto). Recarregue a página e tente novamente.',tone:'error'});return}
    const referenceMonth=brazilianMonthToIso(emissionMonth);
    if(!referenceMonth){setDialog({title:'Mês de referência inválido',message:'Informe o mês de referência no formato MM/AAAA.',tone:'error'});return}
    if(!userToken)return;
    const manualAmountCents=currencyToCents(manualAmount);
    const personLabel=selectedPerson?.full_name||selectedPerson?.username||'morador selecionado';
    const amountLabel=manualAmountCents>0?` no valor de ${money(manualAmountCents)}`:'';
    setLoading(true);
    try{
      const amountOverrides=manualAmountCents>0?{[selectedPersonId]:manualAmountCents}:undefined;
      const preview=await apiRequest<any>('/billing/batches/preview',userToken,{method:'POST',body:JSON.stringify({referenceMonth,userIds:[selectedPersonId],amountOverrides})});
      const candidate=preview.items[0];
      if(!candidate?.valid){setDialog({title:'Não é possível emitir',message:candidate?.issues?.join(' · ')||'A pessoa selecionada não está apta para emissão.',tone:'error'});return}
      if(candidate.existingAmountCents){
        const existingLabel=statusLabel[candidate.existingStatus as InvoiceStatus]||candidate.existingStatus;
        setDialog({title:'Já existe boleto nesta referência',message:`${personLabel} já tem uma cobrança de ${money(Number(candidate.existingAmountCents))} (${existingLabel}) na referência ${emissionMonth}. Confirma a emissão de mais um boleto${amountLabel} para essa mesma referência?`,tone:'error',confirmLabel:'Sim, emitir mais um boleto',cancelLabel:'Cancelar',onConfirm:executeIndividualEmission});
        return;
      }
      setDialog({title:'Confirmar emissão individual?',message:`O boleto de ${personLabel}${amountLabel} será enviado ao Banco Inter para a referência ${emissionMonth}.`,tone:'info',confirmLabel:'Sim, emitir boleto',cancelLabel:'Revisar dados',onConfirm:executeIndividualEmission});
    }catch(e){setDialog({title:'Não foi possível validar',message:e instanceof Error?e.message:'Falha ao consultar a pessoa selecionada.',tone:'error'})}
    finally{setLoading(false)}
  };

  const managerTourSteps:TourStep[]=[
    {key:'summary',title:'Resumo e atualização automática',description:'O botão "Atualizar todos os boletos" consulta o Banco Inter e atualiza a situação (pago, vencido) de todos os boletos existentes — vale rodar com frequência, já que o sistema não recebe aviso automático do banco quando um boleto é pago. Os quatro números logo abaixo resumem só a referência selecionada no filtro: recebido, em aberto, vencidos e total de boletos.'},
    {key:'emission',title:'Emitir boleto individual',description:'Pesquise pelo nome (mínimo 2 letras) e selecione a pessoa. Nome do beneficiário e CNPJ vêm automaticamente do cadastro do condomínio e não são editáveis aqui. Se você preencher "Valor manual do boleto", esse valor substitui o valor da tipologia (e de cobranças adicionais) e é o que efetivamente vai pro Banco Inter. Antes de emitir, o sistema valida se a pessoa está apta e avisa se já existe boleto na mesma referência, pedindo confirmação extra pra evitar duplicidade.'},
    {key:'filters',title:'Filtros e boletos em lote',description:'Filtre por mês de referência, nome do morador ou situação (aguardando Inter, em aberto, pago, vencido, cancelado). Com um mês específico selecionado — não "Todo o histórico" — aparece o botão pra baixar todos os boletos daquela referência em um único arquivo .zip.'},
    {key:'invoices',title:'Lista de cobranças',description:'Cada card é um boleto, agrupado por mês de referência. Quando o boleto vem da tipologia, o card mostra "Composição da cobrança": Valor condomínio (com Taxa de condomínio/Taxa de melhoria, se configuradas em Config. e Enviar cobranças), cobranças adicionais e consumo de água/gás/energia, cada um com seu valor. Boletos vencidos ganham destaque em vermelho, e parcelas de acordo de renegociação mostram a etiqueta "PARCELA DE ACORDO". Num boleto cancelado, você pode registrar o motivo do cancelamento e marcar se o valor foi recebido por fora do sistema (ex.: Pix direto na chave) — isso passa a contar no total recebido da referência.'},
  ];
  const residentTourSteps:TourStep[]=[
    {key:'summary',title:'Resumo das suas cobranças',description:'O botão "Buscar boletos em aberto no banco" consulta o Banco Inter e atualiza a situação das suas cobranças (pago, vencido). Os números abaixo mostram quanto você já pagou, quanto está em aberto e quantos boletos seus estão vencidos, sempre considerando a referência selecionada no filtro.'},
    {key:'filters',title:'Filtrar suas cobranças',description:'Filtre suas cobranças por mês de referência ou por situação: aguardando o banco, em aberto, pago, vencido ou cancelado.'},
    {key:'invoices',title:'Seus boletos',description:'Cada card é uma cobrança sua, agrupada por mês de referência. Quando o boleto vem da taxa condominial, o card mostra "Composição da cobrança" com o detalhamento do valor (taxas, cobranças adicionais e consumo de água/gás/energia, se houver). Em boletos em aberto ou vencidos, dá pra abrir/imprimir o PDF ou copiar o código Pix Copia e Cola pra pagar direto pelo app do seu banco. Parcelas de um acordo de renegociação aparecem com a etiqueta "PARCELA DE ACORDO".'},
  ];
  const tourSteps=canManage?managerTourSteps:residentTourSteps;

  return <><ScrollView ref={scrollRef} contentContainerStyle={[s.container,compact&&s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/>}>
    <View style={s.headerRow}><View style={s.grow}><Text style={s.eyebrow}>COBRANÇAS</Text><Text style={s.title}>Gestão de cobranças</Text>
    <Text style={s.subtitle}>Acompanhe recebimentos, valores em aberto e atrasos por mês de referência.</Text></View><Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable></View>
    <View style={s.generalAction}><AppButton title={loading?'Buscando boletos...':canManage?'Atualizar todos os boletos':'Buscar boletos em aberto no banco'} onPress={syncAll} disabled={loading} variant="secondary"/></View>

    <View ref={registerSection('summary')} style={[s.summaryRow, compact && s.summaryRowMobile, isActive('summary')&&s.tourHighlight]}>
      <View style={[s.summary, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile]}>{money(received)}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>recebido na referência</Text></View>
      <View style={[s.summary, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile]}>{money(open)}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>em aberto na referência</Text></View>
      <View style={[s.summary,overdue.length>0&&s.summaryDanger, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile,overdue.length>0&&s.dangerText]}>{overdue.length}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>boletos vencidos</Text></View>
      {expiredAtBank.length>0?<View style={[s.summary, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile]}>{expiredAtBank.length}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>expirados no banco</Text></View>:null}
      {excludedFromDebt.length>0?<View style={[s.summary, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile]}>{excludedFromDebt.length}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>fora da dívida</Text></View>:null}
      <View style={[s.summary, compact && s.summaryMobile]}><Text {...summaryValueProps} style={[s.summaryValue, compact && s.summaryValueMobile]}>{referenceItems.length}</Text><Text {...summaryLabelProps} style={s.summaryLabel}>boletos na referência</Text></View>
    </View>

    {canManage?<View ref={registerSection('emission')} style={[isActive('emission')&&s.tourHighlight]}><Panel>
      <Text style={s.panelTitle}>Nova emissão individual</Text>
      <Text style={s.panelText}>Pesquise pelo nome e selecione uma única pessoa. Valor, endereço, regras e vencimento serão carregados do cadastro.</Text>
      <FormFieldFull>
        <Text style={s.label}>Pesquisar pessoa</Text>
        {selectedPerson?<View style={[s.person,s.personOn]}><View style={s.personInfo}><Text style={[s.personName,s.personNameOn]}>✓ {selectedPerson.full_name||selectedPerson.username}</Text><Text style={s.personMeta}>{selectedPerson.unit||'Sem unidade'} · {selectedPerson.unit_type_name||'Sem tipologia'} · vence dia {selectedPerson.preferred_due_day||10}</Text></View><Text style={s.personValue}>{selectedPerson.condominium_fee_cents?money(selectedPerson.condominium_fee_cents):'Sem valor'}</Text><Pressable onPress={()=>{setSelectedPersonId('');setPersonSearch('')}} style={s.changePerson}><Text style={s.changePersonText}>Trocar</Text></Pressable></View>:<><TextInput value={personSearch} onChangeText={setPersonSearch} placeholder="Digite ao menos 2 letras do nome" autoCapitalize="words" style={s.input}/>{personSearch.trim().length>=2?<View style={s.peopleList}>{filteredPeople.length?filteredPeople.map(person=><Pressable key={person.id} onPress={()=>{setSelectedPersonId(person.id);setPersonSearch(person.full_name||person.username)}} style={s.person}><View style={s.personInfo}><Text style={s.personName}>{person.full_name||person.username}</Text><Text style={s.personMeta}>{person.unit||'Sem unidade'} · {person.unit_type_name||'Sem tipologia'}</Text></View><Text style={s.personValue}>{person.condominium_fee_cents?money(person.condominium_fee_cents):'Sem valor'}</Text></Pressable>):<Text style={s.noResult}>Nenhuma pessoa encontrada.</Text>}</View>:null}</>}
      </FormFieldFull>
      <FormFieldFull>
        <Text style={s.label}>Nome do beneficiário final</Text>
        <TextInput value={beneficiaryName} editable={false} style={[s.input,s.readonly]}/>
        <Text style={s.label}>CPF ou CNPJ do beneficiário</Text>
        <TextInput value={beneficiaryDocument} editable={false} style={[s.input,s.readonly]}/>
      </FormFieldFull>
      <FormGrid columns={{mobile:1,tablet:2,desktop:2}}>
        <View>
          <Text style={s.label}>Descrição na observação do boleto</Text>
          <TextInput value={description} onChangeText={value=>setDescription(value.slice(0,100))} maxLength={100} placeholder="Descrição da cobrança" style={s.input}/>
        </View>
        <View>
          <Text style={s.label}>Mês de referência</Text>
          <TextInput value={emissionMonth} onChangeText={value=>setEmissionMonth(maskBrazilianMonth(value))} maxLength={7} keyboardType="number-pad" placeholder="MM/AAAA" style={s.input}/>
        </View>
        <View>
          <Text style={s.label}>Valor manual do boleto (opcional)</Text>
          <TextInput value={manualAmount} onChangeText={value=>setManualAmount(maskCurrency(value))} keyboardType="number-pad" placeholder="Deixe em branco para usar o valor do cadastro" style={s.input}/>
          <Text style={s.panelText}>Se preenchido, este valor substitui o valor da tipologia (e de cobranças adicionais) e é o que será enviado ao banco.</Text>
        </View>
      </FormGrid>
      <AppButton title="Emitir boleto para a pessoa selecionada" onPress={confirmIndividualEmission} disabled={loading}/>
    </Panel></View>:null}

    {canManage&&unmatched.length?<Panel><View style={s.unmatchedBox}>
      <Text style={s.unmatchedTitle}>{unmatched.length} boleto(s) no Banco Inter sem morador vinculado · {money(unmatched.reduce((sum,item)=>sum+Number(item.amountCents||0),0))}</Text>
      <Text style={s.unmatchedIntro}>Estes boletos existem no banco, mas o CPF do pagador não bate com nenhum morador cadastrado neste condomínio — por isso não aparecem nas cobranças nem na dívida. Cadastre a pessoa (ou corrija o CPF) e sincronize novamente; o aviso some sozinho.</Text>
      {unmatched.map(charge=><View key={charge.id} style={s.unmatchedRow}>
        <View style={s.grow}><Text style={s.unmatchedName}>{charge.payerName||'Pagador desconhecido'}</Text>
          <Text style={s.unmatchedMeta}>CPF/CNPJ {charge.payerDocument||'—'} · venc. {formatBrazilianDate(charge.dueDate)} · {money(Number(charge.amountCents||0))}{charge.providerSituation?` · ${charge.providerSituation}`:''}</Text></View>
        <Pressable onPress={()=>dismissUnmatched(charge.id)} style={s.changePerson}><Text style={s.changePersonText}>Dispensar</Text></Pressable>
      </View>)}
    </View></Panel>:null}

    <View ref={registerSection('filters')} style={[isActive('filters')&&s.tourHighlight]}><Panel><Text style={s.panelTitle}>Filtros</Text><Text style={s.label}>Mês de referência</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}><Pressable onPress={()=>setReferenceFilter('all')} style={[s.chip,referenceFilter==='all'&&s.chipOn]}><Text style={[s.chipText,referenceFilter==='all'&&s.chipTextOn]}>Todo o histórico</Text></Pressable>{references.map(value=><Pressable key={value} onPress={()=>setReferenceFilter(value)} style={[s.chip,referenceFilter===value&&s.chipOn]}><Text style={[s.chipText,referenceFilter===value&&s.chipTextOn]}>{formatBrazilianMonth(value)}{value===currentMonth()?' · atual':''}</Text></Pressable>)}</ScrollView>
      {canManage&&referenceFilter!=='all'?<View style={s.zipAction}><AppButton title={downloadingZip?'Baixando boletos...':`Baixar boletos de ${formatBrazilianMonth(referenceFilter)} em .zip`} onPress={downloadPdfsZip} loading={downloadingZip} variant="secondary"/></View>:null}
      <Text style={s.label}>Buscar pessoa</Text><TextInput value={search} onChangeText={setSearch} placeholder="Digite o nome do morador" style={s.input}/>
      <Text style={s.label}>Situação</Text><View style={s.filters}>{(['all','pending_provider','issued','paid','overdue','canceled'] as const).map(value=><Pressable key={value} onPress={()=>setStatusFilter(value)} style={[s.chip,statusFilter===value&&s.chipOn]}><Text style={[s.chipText,statusFilter===value&&s.chipTextOn]}>{value==='all'?'Todas':statusLabel[value]}</Text></Pressable>)}</View>
    </Panel></View>

    <View ref={registerSection('invoices')} style={[isActive('invoices')&&s.tourHighlight]}>
    {error?<Text style={s.error}>{error}</Text>:null}
    {groups.length===0?<EmptyState title="Nenhuma cobrança encontrada" description={referenceFilter===currentMonth()?'Ainda não há boletos emitidos para a referência atual.':'Altere os filtros para consultar outras cobranças.'}/>:groups.map(group=><View key={group.reference} style={s.group}>
      <View style={s.groupHeader}><View><Text style={s.groupTitle}>Referência {formatBrazilianMonth(group.reference)}</Text><Text style={s.groupMeta}>{group.items.length} cobrança(s)</Text></View><Text style={s.groupTotal}>{money(group.items.reduce((sum,item)=>sum+item.amount_cents,0))}</Text></View>
      <CardGrid columns={{mobile:1,tablet:2,desktop:2}}>
        {group.items.map(item=><View key={item.id} style={[s.card,item.status==='overdue'&&s.overdueCard]}><View style={s.cardTop}><View style={s.nameArea}><Text style={s.cardTitle}>{item.user_full_name||item.user_username||'Morador'}</Text>{item.invoice_type==='agreement'?<Text style={s.agreementTag}>PARCELA DE ACORDO · {item.agreement_id?.slice(0,8).toUpperCase()}</Text>:null}<Text style={s.cardValue}>{money(item.amount_cents)}</Text></View><Text style={[s.badge,item.status==='paid'&&s.badgePaid,item.status==='overdue'&&s.badgeOverdue,isExpiredAtBank(item)&&s.badgeExpired,Boolean(item.debt_excluded_at)&&!['paid','canceled'].includes(item.status)&&s.badgeExcluded]}>{invoiceLabel(item)}</Text></View>
          {item.condo_base_fee_cents!=null?<View style={s.breakdownBox}>
            <Text style={s.breakdownTitle}>Composição da cobrança</Text>
            <View style={s.breakdownRow}><Text style={s.breakdownLabel}>Valor condomínio</Text><Text style={s.breakdownValue}>{money(item.condo_base_fee_cents)}</Text></View>
            {item.condo_fee_cents!=null?<View style={s.breakdownRow}><Text style={[s.breakdownLabel,s.breakdownIndent]}>Taxa de condomínio ({item.condo_fee_percent}%)</Text><Text style={s.breakdownValue}>{money(item.condo_fee_cents)}</Text></View>:null}
            {item.improvement_fee_cents!=null?<View style={s.breakdownRow}><Text style={[s.breakdownLabel,s.breakdownIndent]}>Taxa de melhoria ({item.improvement_fee_percent}%)</Text><Text style={s.breakdownValue}>{money(item.improvement_fee_cents)}</Text></View>:null}
            {(item.extra_charge_items||[]).map((extra,index)=><View key={`extra-${index}`} style={s.breakdownRow}><Text style={s.breakdownLabel}>{extra.description}</Text><Text style={s.breakdownValue}>{money(extra.amount_cents)}</Text></View>)}
            {(item.consumption_items||[]).map((consumption,index)=><View key={`consumption-${index}`} style={s.breakdownRow}><Text style={s.breakdownLabel}>{utilityLabel[consumption.utility_type]||consumption.utility_type} ({consumption.quantity} × {money(consumption.unit_price_cents)})</Text><Text style={s.breakdownValue}>{money(consumption.amount_cents)}</Text></View>)}
            <View style={[s.breakdownRow,s.breakdownTotalRow]}><Text style={s.breakdownTotalLabel}>Valor total</Text><Text style={s.breakdownTotalValue}>{money(item.amount_cents)}</Text></View>
          </View>:null}
          {isExpiredAtBank(item)?<Text style={s.expiredAlert}>Boleto expirado no Banco Inter — não pode mais ser pago. Vencimento: {formatBrazilianDate(item.due_date)}. Reemita a cobrança ou, se a dívida já foi quitada por outro boleto, retire-a da dívida abaixo.</Text>
            :isProcessingAtBank(item)?<Text style={s.pendingBankHint}>O banco ainda está processando este boleto. Vencimento: {formatBrazilianDate(item.due_date)}.</Text>
            :item.status==='overdue'?<Text style={s.overdueAlert}>Pagamento atrasado — vencimento enviado ao banco: {formatBrazilianDate(item.due_date)}</Text>
            :<Text style={s.line}>Vencimento enviado ao banco: {formatBrazilianDate(item.due_date)}</Text>}
          {item.debt_excluded_at?<View style={s.excludedBox}>
            <Text style={s.excludedTitle}>Fora da dívida desde {formatBrazilianDate(item.debt_excluded_at)}</Text>
            <Text style={s.excludedLine}>Justificativa: {item.debt_exclusion_reason||'—'}</Text>
            {item.debt_excluded_by_name?<Text style={s.excludedLine}>Registrado por {item.debt_excluded_by_name}</Text>:null}
            <Text style={s.excludedLine}>Não conta em Gestão de débitos, no painel nem nos indicadores.</Text>
            {canManage?<Pressable onPress={()=>setDebtExclusion(item.id,false)} disabled={debtSaving} style={s.reasonButton}><Text style={s.reasonButtonText}>Devolver este boleto à dívida</Text></Pressable>:null}
          </View>:canManage&&countsAsDebt(item)?(debtEditingId===item.id?<View style={s.reasonForm}>
            <Text style={s.label}>Por que este boleto não deve contar como dívida?</Text>
            <TextInput value={debtReasonDraft} onChangeText={setDebtReasonDraft} placeholder="Ex.: dívida consolidada e quitada no boleto 07-2026, pago via Pix em 23/07" style={[s.input,s.reasonInput]} multiline/>
            {isExpiredAtBank(item)?<Pressable onPress={()=>setDebtSettledViaPix(current=>!current)} style={s.settledRow}><View style={[s.checkbox,debtSettledViaPix&&s.checkboxChecked]}>{debtSettledViaPix?<Text style={s.checkmark}>✓</Text>:null}</View><Text style={s.settledLabel}>Recebido via Pix, fora do boleto? Marque para contar no total recebido do mês.</Text></Pressable>:null}
            <View style={s.reasonActions}><View style={s.paymentButton}><AppButton title={debtSaving?'Salvando...':'Retirar da dívida'} onPress={()=>setDebtExclusion(item.id,true)} disabled={debtSaving||!debtReasonDraft.trim()}/></View><Pressable onPress={cancelDebtEdit} style={s.changePerson}><Text style={s.changePersonText}>Cancelar</Text></Pressable></View>
          </View>:<Pressable onPress={()=>startDebtEdit(item)} style={s.reasonButton}><Text style={s.reasonButtonText}>Retirar da dívida (com justificativa)</Text></Pressable>):null}
          <Text style={s.line}>Banco: {item.provider}</Text>{item.paid_at?<Text style={s.paidLine}>Pagamento identificado em {formatBrazilianDate(item.paid_at)} · {money(Number(item.paid_amount_cents||item.amount_cents))}</Text>:null}
          {item.status==='canceled'?<View style={s.canceledWarning}><Text style={s.canceledWarningTitle}>Boleto cancelado — não utilizar para pagamento</Text><Text style={s.canceledLine}>{item.digitable_line||'Linha digitável indisponível'}</Text>
            {item.cancellation_reason?<Text style={s.reasonLine}>Motivo: {item.cancellation_reason}</Text>:null}
            {canManage?(reasonEditingId===item.id?<View style={s.reasonForm}>
                <TextInput value={reasonDraft} onChangeText={setReasonDraft} placeholder="Ex.: cliente realizou o Pix direto pela chave, fora do boleto" style={[s.input,s.reasonInput]} multiline/>
                <Pressable onPress={()=>setReasonSettled(current=>!current)} style={s.settledRow}><View style={[s.checkbox,reasonSettled&&s.checkboxChecked]}>{reasonSettled?<Text style={s.checkmark}>✓</Text>:null}</View><Text style={s.settledLabel}>Esse valor foi recebido por fora (ex.: Pix direto)? Marque para contar no saldo recebido.</Text></Pressable>
                <View style={s.reasonActions}><View style={s.paymentButton}><AppButton title={reasonSaving?'Salvando...':'Salvar motivo'} onPress={()=>saveCancellationReason(item.id)} disabled={reasonSaving||!reasonDraft.trim()}/></View><Pressable onPress={cancelReasonEdit} style={s.changePerson}><Text style={s.changePersonText}>Cancelar</Text></Pressable></View>
              </View>:<Pressable onPress={()=>startReasonEdit(item)} style={s.reasonButton}><Text style={s.reasonButtonText}>{item.cancellation_reason?'Editar motivo':'+ Adicionar motivo do cancelamento'}</Text></Pressable>):null}
          </View>:<><Text style={s.digitable}>{item.digitable_line||'Linha digitável aguardando atualização do banco'}</Text>{item.status==='pending_provider'?<Text style={s.pendingBankHint}>O banco ainda não confirmou o registro deste boleto. O PDF e o Pix ficam disponíveis assim que a confirmação chegar.</Text>:item.external_id?<View style={s.paymentActions}><View style={s.paymentButton}><AppButton title="Abrir / imprimir PDF" onPress={()=>openPdf(item.id)} variant="secondary"/></View>{['issued','overdue'].includes(item.status)&&!isExpiredAtBank(item)?<View style={s.paymentButton}><AppButton title="Pagar via Pix" onPress={()=>payWithPix(item.id)}/></View>:null}</View>:null}</>}
        </View>)}
      </CardGrid>
    </View>)}
    </View>
    <AppDialog visible={Boolean(dialog)} title={dialog?.title||''} message={dialog?.message||''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={()=>setDialog(null)} scrollable={dialog?.scrollable}/>
  </ScrollView>
  <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
  </>;
}

const s=StyleSheet.create({
  containerMobile:{paddingHorizontal:12,paddingTop:16,paddingBottom:34},
  headerRow:{flexDirection:'row',alignItems:'flex-start',gap:12,flexWrap:'wrap'},grow:{flex:1},
  tourButton:{borderWidth:1,borderColor:colors.primary,borderRadius:20,paddingHorizontal:14,paddingVertical:9,backgroundColor:colors.softBlue},tourButtonText:{color:colors.primaryDark,fontWeight:'900',fontSize:13},tourHighlight:{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:6,margin:-6},
  container:{width:'100%',padding:24,paddingBottom:50,gap:14,backgroundColor:colors.background},eyebrow:{color:colors.primary,fontWeight:'900'},title:{color:colors.ink,fontSize: 28,fontWeight:'900'},subtitle:{color:colors.muted,lineHeight: 22,marginBottom:4},
  summaryRow:{flexDirection:'row',flexWrap:'wrap',gap:8},summaryRowMobile:{gap:8},summary:{flex:1,minWidth:140,borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:'#fff',padding:12},
  // No celular são 2 cartões por linha. O `flex:0.5,minWidth:70` anterior espremia
  // os 4 numa linha só (~55px úteis), o que quebrava "R$ 250,81" e "referência" no
  // meio da palavra. flexBasis 47% + minWidth 0 deixa o flexbox encolher sem estourar.
  summaryMobile:{flexBasis:'47%',minWidth:0,paddingHorizontal:10},
  summaryValue:{color:colors.ink,fontSize: 18,fontWeight:'900'},summaryValueMobile:{fontSize:17},summaryDanger:{borderColor:'#ef9a9a',backgroundColor:'#fff5f5'},summaryLabel:{color:colors.muted,marginTop:2,fontSize:13},dangerText:{color:colors.red},
  panelTitle:{color:colors.ink,fontSize: 19,fontWeight:'900',marginBottom:8},panelText:{color:colors.muted,lineHeight: 21,marginBottom:14},label:{color:colors.ink,fontWeight:'800',fontSize: 16,marginBottom:7},input:{minHeight: 52,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:12,backgroundColor:'#fff',color:colors.ink,marginBottom:12},readonly:{backgroundColor:'#f2f4f7',color:colors.primaryDark,fontWeight:'800'},peopleList:{gap:7,marginBottom:14,maxHeight:300},person:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,padding:11,backgroundColor:'#fff'},personOn:{borderColor:colors.primary,backgroundColor:colors.softBlue},personInfo:{flex:1},personName:{color:colors.ink,fontWeight:'900'},personNameOn:{color:colors.primaryDark},personMeta:{color:colors.muted,fontSize: 15,marginTop:3},personValue:{color:colors.primaryDark,fontWeight:'900'},filterScroll:{gap:7,paddingBottom:13},filters:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{borderWidth:1,borderColor:colors.border,borderRadius:20,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#fff'},chipOn:{backgroundColor:colors.primary,borderColor:colors.primary},chipText:{color:colors.muted,fontWeight:'800',fontSize: 15},chipTextOn:{color:'#fff'},
  changePerson:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:'#fff'},changePersonText:{color:colors.primary,fontWeight:'900'},noResult:{color:colors.muted,padding:12,textAlign:'center'},generalAction:{alignSelf:'flex-start',minWidth:240},zipAction:{alignSelf:'flex-start',minWidth:240,marginTop:14,marginBottom:4},error:{color:colors.red,fontWeight:'800'},group:{gap:8},groupHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:8},groupTitle:{color:colors.ink,fontSize: 19,fontWeight:'900'},groupMeta:{color:colors.muted,marginTop:2},groupTotal:{color:colors.primaryDark,fontSize: 19,fontWeight:'900'},card:{borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:'#fff',padding:14,minWidth:0},overdueCard:{borderWidth:2,borderColor:colors.red,backgroundColor:'#fff8f8'},cardTop:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},nameArea:{flex:1,minWidth:0},cardTitle:{color:colors.ink,fontSize: 18,fontWeight:'900'},agreementTag:{color:'#7a4d00',backgroundColor:'#fff3d6',alignSelf:'flex-start',fontSize:12,fontWeight:'900',paddingHorizontal:7,paddingVertical:4,borderRadius:7,overflow:'hidden',marginTop:5},cardValue:{color:colors.primaryDark,fontSize: 19,fontWeight:'900',marginTop:5},badge:{color:colors.primaryDark,backgroundColor:colors.softBlue,borderRadius:12,overflow:'hidden',paddingHorizontal:9,paddingVertical:5,fontSize: 15,fontWeight:'900'},badgePaid:{color:colors.green,backgroundColor:colors.softGreen},badgeOverdue:{color:'#fff',backgroundColor:colors.red},badgeExpired:{color:'#fff',backgroundColor:'#8a5a00'},badgeExcluded:{color:'#41474f',backgroundColor:'#e6e9ee'},line:{color:colors.muted,marginTop:6},overdueAlert:{color:colors.red,fontWeight:'900',marginTop:10},expiredAlert:{color:'#7a4d00',backgroundColor:'#fff3d6',borderWidth:1,borderColor:'#e6c98a',borderRadius:8,padding:10,marginTop:10,lineHeight:19,fontWeight:'700'},excludedBox:{backgroundColor:'#f2f4f7',borderWidth:1,borderColor:'#d6dae1',borderRadius:8,padding:10,marginTop:10},excludedTitle:{color:'#41474f',fontWeight:'900'},excludedLine:{color:colors.muted,marginTop:4,lineHeight:19},unmatchedBox:{gap:8},unmatchedTitle:{color:'#7a4d00',fontSize:17,fontWeight:'900'},unmatchedIntro:{color:colors.muted,lineHeight:20},unmatchedRow:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#fff3d6',borderRadius:8,padding:10},unmatchedName:{color:colors.ink,fontWeight:'900'},unmatchedMeta:{color:'#7a4d00',marginTop:3},paidLine:{color:colors.green,fontWeight:'800',marginTop:7},digitable:{color:colors.ink,backgroundColor:'#f7f9fc',borderRadius:8,padding:10,marginTop:10,lineHeight: 21,flexShrink:1,overflowWrap:'break-word',wordBreak:'break-all'} as any,pdfAction:{marginTop:10},pendingBankHint:{color:'#7a4d00',backgroundColor:'#fff3d6',borderRadius:8,padding:10,marginTop:10,lineHeight:19,fontWeight:'700'},paymentActions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},paymentButton:{flex:1,minWidth:140},canceledWarning:{backgroundColor:'#fff2f2',borderWidth:1,borderColor:'#efb2b2',borderRadius:8,padding:10,marginTop:10},canceledWarningTitle:{color:colors.red,fontWeight:'900'},canceledLine:{color:colors.muted,textDecorationLine:'line-through',marginTop:5,flexShrink:1,overflowWrap:'break-word',wordBreak:'break-all'} as any,
  reasonLine:{color:colors.ink,fontWeight:'700',marginTop:8},reasonButton:{marginTop:9},reasonButtonText:{color:colors.primary,fontWeight:'900'},reasonForm:{marginTop:9,gap:8},reasonInput:{minHeight:70,textAlignVertical:'top',paddingTop:12,marginBottom:0},reasonActions:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'},
  settledRow:{flexDirection:'row',alignItems:'flex-start',gap:10},checkbox:{width:22,height:22,borderWidth:2,borderColor:colors.border,borderRadius:5,justifyContent:'center',alignItems:'center',marginTop:2},checkboxChecked:{borderColor:colors.primary,backgroundColor:colors.primary},checkmark:{color:'#fff',fontWeight:'900',fontSize:13},settledLabel:{flex:1,color:colors.muted,lineHeight:20},
  breakdownBox:{borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#f7f9fc',padding:10,marginTop:10,gap:4},
  breakdownTitle:{color:colors.ink,fontWeight:'900',fontSize:13,marginBottom:2},
  breakdownRow:{flexDirection:'row',justifyContent:'space-between',gap:8},
  breakdownLabel:{color:colors.muted,fontSize:13,flexShrink:1},breakdownValue:{color:colors.primaryDark,fontWeight:'800',fontSize:13},
  breakdownIndent:{marginLeft:12},
  breakdownTotalRow:{borderTopWidth:1,borderTopColor:colors.border,marginTop:4,paddingTop:6},
  breakdownTotalLabel:{color:colors.ink,fontWeight:'900',fontSize:13},breakdownTotalValue:{color:colors.ink,fontWeight:'900',fontSize:13}
});
