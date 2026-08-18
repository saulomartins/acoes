// @ts-nocheck
import React,{useCallback,useContext,useEffect,useMemo,useState} from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import * as DocumentPicker from 'expo-document-picker';
import {apiRequest,apiUpload,openAuthenticatedFile,downloadAuthenticated} from '../api/client';
import {AuthContext} from '../context/AuthContext';
import {AppButton,AppDialog,EmptyState,Panel} from '../ui/components';
import {colors} from '../ui/theme';
import AccountabilityReportView from './AccountabilityReportView';
import FeatureTour, {type TourStep} from '../ui/FeatureTour';
import {useSectionTour} from '../ui/useSectionTour';

const PRINT_AREA_ID='accountability-print-area';
// A área de impressão vive dentro de um ScrollView (overflow:scroll na web), que
// recorta para o que está visível na rolagem atual. Um portal direto para
// document.body escapa desse recorte para a impressão sair completa.
const PrintPortal=({children}:{children:React.ReactNode})=>{
 if(Platform.OS!=='web'||typeof document==='undefined')return null;
 const{createPortal}=require('react-dom');
 return createPortal(children,document.body);
};

type Expense={id?:string;provider:string;purpose:string;serviceDate:string;amountCents:number;has_receipt?:boolean;receipt_file_name?:string;receipt_mime_type?:string;has_proof?:boolean;proof_file_name?:string;proof_mime_type?:string};
type Draft={referenceMonth:string;periodStart:string;periodEnd:string;paidUnits:number;exemptUnits:number;unpaidUnits:number;receivedAmountCents:number;bankBalanceCents:number;expenses:Expense[];sourceFileName?:string;city:string;sindicoName:string;subsindicoName:string;fiscalCouncil1Name:string;fiscalCouncil2Name:string};
type Report={id:string;reference_month:string;period_start:string;period_end:string;origin:string;received_amount_cents:number;bank_balance_cents?:number|null;total_expenses_cents:number;balance_cents:number;paid_units:number;exempt_units:number;unpaid_units:number;source:string;city?:string|null;sindico_name?:string|null;subsindico_name?:string|null;fiscal_council_1_name?:string|null;fiscal_council_2_name?:string|null};
const blankExpense=():Expense=>({provider:'',purpose:'',serviceDate:'',amountCents:0});
type Council={fiscalCouncil1:{fullName:string|null}|null;fiscalCouncil2:{fullName:string|null}|null};
// Síndico/subsíndico vêm do próprio usuário logado (só faz sentido pré-preencher
// quando quem está criando o relatório é um deles); Conselho Fiscal 1/2 vêm do
// cadastro do condomínio (council), já que não têm relação com quem está logado.
const empty=(user?:any,council?:Council):Draft=>({referenceMonth:'',periodStart:'',periodEnd:'',paidUnits:0,exemptUnits:0,unpaidUnits:0,receivedAmountCents:0,bankBalanceCents:0,expenses:[blankExpense()],city:'',sindicoName:user?.role==='sindico'?(user?.fullName||''):'',subsindicoName:user?.role==='subsindico'?(user?.fullName||''):'',fiscalCouncil1Name:council?.fiscalCouncil1?.fullName||'',fiscalCouncil2Name:council?.fiscalCouncil2?.fullName||''});
const brl=(n:number)=>(Number(n)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
// Máscara "estilo calculadora": cada dígito digitado entra pela direita como
// centavo, ignorando tudo mais no texto (mesmo padrão de maskCurrency em
// Invoices.tsx). Reinterpretar o texto já formatado como decimal a cada tecla
// (jeito antigo) trava a edição, porque "45,0" e "45,00" viram o mesmo valor.
const cents=(value:string)=>Number(value.replace(/\D/g,''))||0;
const signedCents=(value:string)=>{const negative=value.includes('-');const amount=Number(value.replace(/\D/g,''))||0;return negative?-amount:amount};
const money=(n:number)=>brl(Number(n||0));
const displayMonth=(value:string)=>{const match=String(value||'').match(/^(\d{4})-(\d{2})/);return match?`${match[2]}/${match[1]}`:value};
const apiMonth=(value:string)=>{const match=String(value||'').match(/^(\d{2})\/(\d{4})$/);return match?`${match[2]}-${match[1]}`:value};
const displayDate=(value:string)=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return match?`${match[3]}/${match[2]}/${match[1]}`:value};

export default function Accountability({navigation}:any){
 (styles as any).negative={color:colors.red};
 const{userToken,user,condominiumFeatures}=useContext(AuthContext);const manager=user?.role==='sindico'||user?.role==='subsindico';const councilEnabled=Boolean(condominiumFeatures?.conselho_fiscal);const{scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();const[items,setItems]=useState<Report[]>([]);const[draft,setDraft]=useState<Draft>(empty(user));const[editId,setEditId]=useState<string|null>(null);const[receiptFiles,setReceiptFiles]=useState<Array<any|null>>([]);const[proofFiles,setProofFiles]=useState<Array<any|null>>([]);const[selected,setSelected]=useState<(Report&{expenses:Expense[]})|null>(null);const[source,setSource]=useState<'manual'|'pdf'>('manual');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[dialog,setDialog]=useState<{title:string;message:string;tone:'info'|'success'|'error';confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void}|null>(null);
 const readingReport=Boolean(selected);
 const total=useMemo(()=>draft.expenses.reduce((sum,item)=>sum+Number(item.amountCents||0),0),[draft.expenses]);
 const load=useCallback(async()=>{if(!userToken)return;try{setItems((await apiRequest<{reports:Report[]}>('/accountability',userToken)).reports)}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar')}},[userToken]);
 useEffect(()=>{load()},[load]);
 // Homologação do relatório aberto: buscada uma única vez aqui (não dentro de
 // ApprovalsPanel) porque a mesma lista de assentos também alimenta a
 // assinatura impressa em AccountabilityReportView — assim "Imprimir" sempre
 // reflete a homologação mais recente, inclusive logo após salvar.
 const[reportApprovals,setReportApprovals]=useState<Array<{seat:string;label:string;holderId:string|null;holderName:string|null;approved:boolean;note:string|null}>>([]);
 const loadReportApprovals=useCallback(async(reportId:string)=>{
  if(!userToken)return;
  try{const response=await apiRequest<any>(`/accountability/${reportId}/approvals`,userToken);setReportApprovals(response.seats||[])}
  catch(e){setReportApprovals([])}
 },[userToken]);
 useEffect(()=>{if(selected)loadReportApprovals(selected.id);else setReportApprovals([])},[selected?.id,loadReportApprovals]);
 // Conselho Fiscal (opcional, feature `conselho_fiscal`): quem ocupa os dois
 // assentos, pra síndico/subsíndico escolherem entre proprietário/inquilino
 // já cadastrados no condomínio.
 const[council,setCouncil]=useState<{fiscalCouncil1:{id:string;fullName:string|null}|null;fiscalCouncil2:{id:string;fullName:string|null}|null}>({fiscalCouncil1:null,fiscalCouncil2:null});
 const[councilCandidates,setCouncilCandidates]=useState<Array<{id:string;full_name:string|null;username:string;role:string}>>([]);
 const[councilSearch1,setCouncilSearch1]=useState('');const[councilSearch2,setCouncilSearch2]=useState('');
 const[councilBusy,setCouncilBusy]=useState(false);const[councilError,setCouncilError]=useState('');
 const loadCouncil=useCallback(async()=>{
  if(!userToken||!manager||!councilEnabled)return;
  try{
   const[councilResponse,usersResponse]=await Promise.all([
    apiRequest<{fiscalCouncil1:{id:string;fullName:string|null}|null;fiscalCouncil2:{id:string;fullName:string|null}|null}>('/accountability/council',userToken),
    apiRequest<{users:Array<{id:string;full_name:string|null;username:string;role:string}>}>('/users',userToken),
   ]);
   setCouncil(councilResponse);
   setCouncilCandidates(usersResponse.users.filter(person=>['proprietario','inquilino'].includes(person.role)));
  }catch(e){/* painel opcional: falha ao carregar não deve travar o resto da tela */}
 },[userToken,manager,councilEnabled]);
 useEffect(()=>{loadCouncil()},[loadCouncil]);
 // O council só chega depois do primeiro render (busca assíncrona em
 // loadCouncil), então o rascunho inicial (useState(empty(user)) lá em cima)
 // nasce com os campos de Conselho Fiscal em branco. Preenche assim que os
 // dados chegam — só quando o campo ainda está vazio (não sobrescreve o que
 // a pessoa já digitou) e só fora de edição (editando um relatório salvo, os
 // nomes são os que foram gravados naquele mês, não os atuais).
 useEffect(()=>{
  if(editId||!councilEnabled)return;
  if(!council.fiscalCouncil1?.fullName&&!council.fiscalCouncil2?.fullName)return;
  setDraft(current=>({
   ...current,
   fiscalCouncil1Name:current.fiscalCouncil1Name||council.fiscalCouncil1?.fullName||'',
   fiscalCouncil2Name:current.fiscalCouncil2Name||council.fiscalCouncil2?.fullName||'',
  }));
 },[council,editId,councilEnabled]);
 const setCouncilMember=async(seat:1|2,personId:string)=>{
  if(!userToken)return;setCouncilBusy(true);setCouncilError('');
  try{
   const body=seat===1?{fiscalCouncil1UserId:personId,fiscalCouncil2UserId:council.fiscalCouncil2?.id||null}:{fiscalCouncil1UserId:council.fiscalCouncil1?.id||null,fiscalCouncil2UserId:personId};
   setCouncil(await apiRequest('/accountability/council',userToken,{method:'PUT',body:JSON.stringify(body)}));
   if(seat===1)setCouncilSearch1('');else setCouncilSearch2('');
  }catch(e){setCouncilError(e instanceof Error?e.message:'Falha ao atualizar o Conselho Fiscal')}
  finally{setCouncilBusy(false)}
 };
 const clearCouncilMember=async(seat:1|2)=>{
  if(!userToken)return;setCouncilBusy(true);setCouncilError('');
  try{
   const body=seat===1?{fiscalCouncil1UserId:null,fiscalCouncil2UserId:council.fiscalCouncil2?.id||null}:{fiscalCouncil1UserId:council.fiscalCouncil1?.id||null,fiscalCouncil2UserId:null};
   setCouncil(await apiRequest('/accountability/council',userToken,{method:'PUT',body:JSON.stringify(body)}));
  }catch(e){setCouncilError(e instanceof Error?e.message:'Falha ao atualizar o Conselho Fiscal')}
  finally{setCouncilBusy(false)}
 };
 // Print/captura de tela nativo (Android/iOS) é permitido em todo o app desde
 // 2026-08-18 (ver App.tsx). Este bloqueio de PrintScreen/Ctrl+P/Ctrl+S abaixo é
 // só para a versão web desta tela específica (Prestação de Contas), decisão à
 // parte por ser uma tela financeira sensível — não mexe em nada nativo.
 useEffect(()=>{if(Platform.OS!=='web')return;if(document.getElementById('accountability-print-style'))return;const style=document.createElement('style');style.id='accountability-print-style';style.textContent=`#${PRINT_AREA_ID}{display:none}@media print{body *{visibility:hidden}#${PRINT_AREA_ID}{display:block;position:absolute;left:0;top:0;width:100%}#${PRINT_AREA_ID} *{visibility:visible;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;document.head.appendChild(style)},[]);
 useEffect(()=>{if(Platform.OS!=='web')return;const stop=(event:KeyboardEvent)=>{if(readingReport)return;if(event.key==='PrintScreen'||(event.ctrlKey&&['p','s'].includes(event.key.toLowerCase()))){event.preventDefault();setError('Captura, impressão e salvamento desta tela não são permitidos.')}};document.addEventListener('keydown',stop);return()=>document.removeEventListener('keydown',stop)},[readingReport]);
 const field=(key:keyof Draft,value:any)=>setDraft(current=>({...current,[key]:value}));
 const expense=(index:number,key:keyof Expense,value:any)=>setDraft(current=>({...current,expenses:current.expenses.map((item,i)=>i===index?{...item,[key]:value}:item)}));
 const pick=async()=>{if(!userToken)return;const result=await DocumentPicker.getDocumentAsync({type:'application/pdf',copyToCacheDirectory:true});if(result.canceled)return;setBusy(true);setError('');try{const asset=result.assets[0];const uploadFile=Platform.OS==='web'&&asset.file?asset.file:{uri:asset.uri,name:asset.name,mimeType:asset.mimeType||'application/pdf'};const response=await apiUpload<{draft:Draft;warnings:string[]}>('/accountability/parse-pdf',userToken,uploadFile);setDraft({...response.draft,referenceMonth:displayMonth(response.draft.referenceMonth),periodStart:displayDate(response.draft.periodStart),periodEnd:displayDate(response.draft.periodEnd),bankBalanceCents:0,expenses:response.draft.expenses.length?response.draft.expenses:[blankExpense()]});setSource('pdf');if(response.warnings.length)setError(response.warnings.join(' '))}catch(e){setError(e instanceof Error?e.message:'Falha ao ler PDF')}finally{setBusy(false)}};
 const importMonthData=async()=>{
  if(!userToken)return;
  const referenceMonth=apiMonth(draft.referenceMonth);
  if(!/^\d{4}-\d{2}$/.test(referenceMonth)){setDialog({title:'Informe o mês',message:'Preencha o campo "Mês (MM/AAAA)" antes de importar os dados do período.',tone:'error'});return}
  setBusy(true);setError('');
  try{
   const response=await apiRequest<{draft:{periodStart:string;periodEnd:string;paidUnits:number;unpaidUnits:number;exemptUnits:number;receivedAmountCents:number;bankBalanceCents:number|null;city:string;sindicoName:string;expenses:Expense[]};warnings:string[]}>(`/accountability/autofill?referenceMonth=${referenceMonth}`,userToken);
   const d=response.draft;
   setDraft(current=>({...current,
    periodStart:displayDate(d.periodStart),
    periodEnd:displayDate(d.periodEnd),
    paidUnits:d.paidUnits,
    unpaidUnits:d.unpaidUnits,
    exemptUnits:d.exemptUnits,
    receivedAmountCents:d.receivedAmountCents,
    bankBalanceCents:d.bankBalanceCents==null?current.bankBalanceCents:d.bankBalanceCents,
    city:d.city||current.city,
    sindicoName:d.sindicoName||current.sindicoName,
    expenses:d.expenses.length?d.expenses.map(item=>({...item,serviceDate:displayDate(item.serviceDate)})):[blankExpense()],
   }));
   setDialog({title:response.warnings.length?'Dados importados com avisos':'Dados do mês importados',
    message:`${d.paidUnits} apartamento(s) pago(s), ${d.exemptUnits} isento(s), ${d.unpaidUnits} não pago(s), total recebido ${money(d.receivedAmountCents)}${d.bankBalanceCents!=null?`, saldo bancário ${money(d.bankBalanceCents)}`:''}, ${d.expenses.length} despesa(s) encontrada(s) no extrato bancário.${response.warnings.length?` ${response.warnings.join(' ')}`:''}`,
    tone:response.warnings.length?'info':'success'});
  }catch(e){setDialog({title:'Falha ao importar',message:e instanceof Error?e.message:'Falha ao importar dados do mês.',tone:'error'})}
  finally{setBusy(false)}
 };
 const downloadExtratoPdf=async()=>{
  if(!userToken)return;
  const referenceMonth=apiMonth(draft.referenceMonth);
  if(!/^\d{4}-\d{2}$/.test(referenceMonth)){setDialog({title:'Informe o mês',message:'Preencha o campo "Mês (MM/AAAA)" antes de baixar o extrato.',tone:'error'});return}
  setBusy(true);setError('');
  try{
   await downloadAuthenticated(`/accountability/extrato-pdf?referenceMonth=${referenceMonth}`,userToken,`extrato-${referenceMonth}.pdf`);
  }catch(e){setDialog({title:'Falha ao baixar extrato',message:e instanceof Error?e.message:'Falha ao baixar o extrato em PDF.',tone:'error'})}
  finally{setBusy(false)}
 };
 const pickExpenseFile=async(index:number,kind:'receipt'|'proof')=>{const result=await DocumentPicker.getDocumentAsync({type:['application/pdf','image/jpeg','image/png','image/webp'],copyToCacheDirectory:true});if(result.canceled)return;const setter=kind==='receipt'?setReceiptFiles:setProofFiles;setter(current=>{const next=[...current];next[index]=result.assets[0];return next})};
 const uploadExpenseFile=async(expenseId:string,kind:'receipt'|'proof',file:any)=>{const uploadFile=Platform.OS==='web'&&file.file?file.file:{uri:file.uri,name:file.name,mimeType:file.mimeType};await apiUpload(`/accountability-attachments/${expenseId}/${kind}`,userToken,uploadFile)};
 const save=async()=>{if(!userToken)return;setBusy(true);setError('');try{const path=editId?`/accountability/${editId}`:'/accountability';const response=await apiRequest<{report:{id:string;expenses:Expense[]}}>(path,userToken,{method:editId?'PUT':'POST',body:JSON.stringify({...draft,referenceMonth:apiMonth(draft.referenceMonth),source})});await apiRequest(`/accountability/${response.report.id}/bank-balance`,userToken,{method:'PATCH',body:JSON.stringify({bankBalanceCents:draft.bankBalanceCents})});for(let i=0;i<response.report.expenses.length;i++){const expenseId=response.report.expenses[i].id;if(!expenseId)continue;if(receiptFiles[i])await uploadExpenseFile(expenseId,'receipt',receiptFiles[i]);if(proofFiles[i])await uploadExpenseFile(expenseId,'proof',proofFiles[i])}setDraft(empty(user,council));setEditId(null);setSelected(null);setReceiptFiles([]);setProofFiles([]);setSource('manual');await load()}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar')}finally{setBusy(false)}};
 const view=async(id:string)=>{if(!userToken)return;setBusy(true);try{setSelected((await apiRequest<{report:Report&{expenses:Expense[]}}>(`/accountability/${id}`,userToken)).report)}catch(e){setError(e instanceof Error?e.message:'Falha ao abrir prestação')}finally{setBusy(false)}};
 const startEdit=()=>{if(!selected)return;const report=selected as any;setDraft({referenceMonth:displayMonth(report.reference_month),periodStart:displayDate(report.period_start),periodEnd:displayDate(report.period_end),paidUnits:report.paid_units,exemptUnits:report.exempt_units,unpaidUnits:report.unpaid_units,receivedAmountCents:Number(report.received_amount_cents),bankBalanceCents:Number(report.bank_balance_cents||0),expenses:report.expenses,city:report.city||'',sindicoName:report.sindico_name||(user?.role==='sindico'?(user?.fullName||''):''),subsindicoName:report.subsindico_name||(user?.role==='subsindico'?(user?.fullName||''):''),fiscalCouncil1Name:report.fiscal_council_1_name||'',fiscalCouncil2Name:report.fiscal_council_2_name||''});setEditId(report.id);setSource(report.source);setSelected(null)};
 const removeReport=()=>{if(!selected||!userToken)return;setDialog({title:'Confirmar exclusão',message:'Esta ação também excluirá as despesas e os anexos. Deseja continuar?',tone:'error',confirmLabel:'Excluir',cancelLabel:'Cancelar',onConfirm:async()=>{setDialog(null);try{await apiRequest(`/accountability/${selected.id}`,userToken,{method:'DELETE'});setSelected(null);await load()}catch(e){setError(e instanceof Error?e.message:'Falha ao excluir')}}})};
 const hasFile=(item:Expense,kind:'receipt'|'proof')=>Boolean(kind==='receipt'?item.has_receipt:item.has_proof);
 const fileNameFor=(item:Expense,kind:'receipt'|'proof')=>kind==='receipt'?item.receipt_file_name:item.proof_file_name;
 const mimeFor=(item:Expense,kind:'receipt'|'proof')=>kind==='receipt'?item.receipt_mime_type:item.proof_mime_type;
 const openFile=(item:Expense,kind:'receipt'|'proof')=>{const name=fileNameFor(item,kind);return userToken&&item.id&&name&&openAuthenticatedFile(`/accountability-attachments/${item.id}/${kind}`,userToken,name,mimeFor(item,kind)||'application/octet-stream')};
 const attachExisting=async(item:Expense,kind:'receipt'|'proof')=>{if(!userToken||!item.id)return;const result=await DocumentPicker.getDocumentAsync({type:['application/pdf','image/jpeg','image/png','image/webp'],copyToCacheDirectory:true});if(result.canceled)return;await uploadExpenseFile(item.id,kind,result.assets[0]);await view(selected!.id)};
 const removeFile=(item:Expense,kind:'receipt'|'proof',index?:number)=>{if(!userToken||!item.id)return;const label=kind==='receipt'?'recibo':'comprovante de pagamento';const fileName=kind==='receipt'?item.receipt_file_name:item.proof_file_name;setDialog({title:'Confirmar exclusão',message:`Excluir o ${label}${fileName?` "${fileName}"`:''} de "${item.provider}"? Essa ação não pode ser desfeita.`,tone:'error',confirmLabel:'Excluir',cancelLabel:'Cancelar',onConfirm:async()=>{setDialog(null);try{await apiRequest(`/accountability-attachments/${item.id}/${kind}`,userToken,{method:'DELETE'});if(typeof index==='number')setDraft(current=>({...current,expenses:current.expenses.map((e,i)=>i===index?{...e,[kind==='receipt'?'has_receipt':'has_proof']:false}:e)}));if(selected)await view(selected.id);setDialog({title:'Sucesso',message:`${kind==='receipt'?'Recibo':'Comprovante de pagamento'} excluído com sucesso.`,tone:'success'})}catch(e){setError(e instanceof Error?e.message:'Falha ao excluir anexo')}}})};
 const managerTourSteps:TourStep[]=[
  ...(councilEnabled?[{key:'council',title:'Conselho Fiscal',description:'Só aparece quando o admin_geral liga a funcionalidade "Conselho Fiscal" para este condomínio. Busque e escolha, entre os moradores já cadastrados, quem ocupa o assento de Conselho Fiscal 1 e Conselho Fiscal 2 — dá pra trocar a qualquer momento. Os dois passam a homologar (ou comentar) as prestações de contas junto com síndico e subsíndico, no painel "Homologação" de cada relatório aberto.'}]:[]),
  {key:'actions',title:'Importar PDF, preencher automaticamente ou começar do zero',description:'"Importar PDF" tenta extrair automaticamente mês, período, valores e despesas de um PDF de prestação de contas. "Preencher dados do mês" usa o mês já digitado no campo "Mês (MM/AAAA)" abaixo para buscar automaticamente: apartamentos pagos/isentos/não pagos e total recebido a partir dos boletos do sistema, cidade e nome do síndico do cadastro do condomínio, e as despesas a partir do extrato bancário do período (movimentações de saída) — tudo pra você revisar antes de salvar. "Novo preenchimento" limpa tudo pra digitar manualmente. O campo "Saldo bancário da competência" é o saldo real informado pelo banco naquele mês — fica separado do saldo calculado (recebido menos despesas) e só é exibido ao proprietário quando preenchido.'},
  {key:'form',title:'Dados da prestação',description:'Mês no formato MM/AAAA, período de início e fim, quantidade de apartamentos pagos/isentos/não pagos e total recebido no mês. Cidade e os nomes de síndico, subsíndico e dos dois membros do conselho fiscal são usados na formatação do relatório impresso/PDF gerado a partir dessa prestação — os campos de síndico/subsíndico já vêm preenchidos com quem está logado, e os do Conselho Fiscal (quando configurado) com quem ocupa os dois assentos; ainda dá pra editar manualmente.'},
  {key:'expenses',title:'Despesas do mês',description:'Cada linha é uma despesa: empresa ou pessoa, objetivo do serviço, data e valor. Recibo e comprovante de pagamento são opcionais e podem ser anexados em PDF, JPEG, PNG ou WEBP por despesa. O total das despesas e o saldo do mês (recebido menos despesas) são recalculados automaticamente conforme você edita.'},
  {key:'history',title:'Histórico',description:'Todas as prestações já salvas, com receita, despesas, saldo, quantidade de apartamentos pagos/isentos/não pagos e a origem de cada uma (PDF importado ou preenchimento manual).'},
  {key:'detail',title:'Relatório aberto',description:'Depois de tocar num card do histórico, o relatório completo aparece aqui, com opção de imprimir (na web), "Editar prestação" (recarrega os dados no formulário acima) ou "Excluir prestação" — excluir também apaga as despesas e os anexos dessa prestação, sem volta. Dá pra substituir ou excluir o recibo/comprovante de cada prestador individualmente. Logo abaixo, o painel "Homologação" lista síndico, subsíndico e (se configurado) os dois conselheiros fiscais: cada um marca "Homologar" e/ou deixa uma consideração em texto — não bloqueia nada, é só um registro ao lado do relatório. Ao imprimir/gerar o PDF, a assinatura de quem já homologou sai com o nome de quem homologou de fato, e quem ainda não homologou sai como "Ainda não Homologada".'},
  {key:'manage',title:'Gerenciar prestações e anexos',description:'Atalho pra reabrir rapidamente qualquer mês já salvo direto na visão de edição e gerenciamento de anexos, sem precisar rolar até o histórico.'},
 ];
 const residentTourSteps:TourStep[]=[
  {key:'reports',title:'Prestações de contas',description:'Cada card é um mês fechado, com receita, despesas e o saldo da prestação daquele período. Toque num card pra abrir o relatório completo. Se você é proprietário, também aparece o saldo bancário informado pela administração, quando preenchido.'},
  {key:'detail',title:'Relatório do mês',description:'Mostra o detalhamento completo da prestação escolhida, com opção de impressão na web. Em "Anexos por prestador" você pode visualizar o recibo e o comprovante de pagamento de cada despesa, quando a administração anexou — aqui é só consulta, não dá pra anexar ou excluir. O painel "Homologação" mostra se síndico, subsíndico e, quando o condomínio tem Conselho Fiscal, os dois conselheiros já homologaram esta prestação, com a consideração de cada um quando houver; se você for um dos conselheiros fiscais, também homologa e/ou comenta por aqui.'},
 ];
 const tourSteps=manager?managerTourSteps:residentTourSteps;
 if(!manager)return <><ScrollView ref={scrollRef} contentContainerStyle={styles.container}><View style={styles.headerRow}><View style={styles.grow}><Text style={styles.eyebrow}>FINANCEIRO</Text><Text style={styles.title}>Prestação de contas</Text><Text style={styles.subtitle}>Visualização protegida de {user?.condominiumName||'seu condomínio'}. Selecione o mês para consultar.</Text></View><Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable></View><View ref={registerSection('reports')} style={[isActive('reports')&&styles.tourHighlight]}>{error?<Text style={styles.error}>{error}</Text>:null}{items.map(item=><Pressable key={item.id} onPress={()=>view(item.id)} style={styles.card}><Text style={styles.cardTitle}>{item.reference_month.slice(0,7)} · {item.origin}</Text><Text>Receita: {brl(item.received_amount_cents)} · Despesas: {brl(item.total_expenses_cents)}</Text><Text style={[styles.balance,Number(item.balance_cents)<0&&styles.negative]}>Saldo da prestação: {brl(item.balance_cents)}</Text>{user?.role==='proprietario'&&item.bank_balance_cents!=null?<Text style={[styles.balance,Number(item.bank_balance_cents)<0&&styles.negative]}>Saldo bancário: {brl(item.bank_balance_cents)}</Text>:null}</Pressable>)}</View>{selected?<View ref={registerSection('detail')} style={[isActive('detail')&&styles.tourHighlight]}><AccountabilityReportView report={selected} approvals={reportApprovals}/>{Platform.OS==='web'?<PrintPortal><AccountabilityReportView report={selected} printId={PRINT_AREA_ID} approvals={reportApprovals}/></PrintPortal>:null}{Platform.OS==='web'?<AppButton title="Imprimir" onPress={()=>window.print()}/>:null}<ApprovalsPanel reportId={selected.id} userToken={userToken} user={user} seats={reportApprovals} onSaved={()=>loadReportApprovals(selected.id)}/>{user?.role==='proprietario'&&selected.bank_balance_cents!=null?<Panel><Text style={[styles.balance,Number(selected.bank_balance_cents)<0&&styles.negative]}>Saldo bancário: {brl(selected.bank_balance_cents)}</Text></Panel>:null}<Panel><Text style={styles.heading}>Anexos por prestador</Text>{selected.expenses.map(item=><View key={item.id} style={styles.expense}><Text style={styles.cardTitle}>{item.provider}</Text>{hasFile(item,'receipt')?<Pressable onPress={()=>openFile(item,'receipt')}><Text style={styles.add}>Visualizar recibo: {item.receipt_file_name}</Text></Pressable>:<Text>Sem recibo</Text>}{hasFile(item,'proof')?<Pressable onPress={()=>openFile(item,'proof')}><Text style={styles.add}>Visualizar comprovante: {item.proof_file_name}</Text></Pressable>:<Text>Sem comprovante</Text>}</View>)}</Panel></View>:null}</ScrollView><FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/></>;
 return <><ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
  <View style={styles.headerRow}><View style={styles.grow}><Text style={styles.eyebrow}>FINANCEIRO</Text><Text style={styles.title}>Prestação de contas</Text><Text style={styles.subtitle}>Dados exclusivos de {user?.condominiumName||'seu condomínio'}. Importe um PDF ou preencha manualmente e revise antes de salvar.</Text></View><Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable></View>
  {councilEnabled?<View ref={registerSection('council')} style={[isActive('council')&&styles.tourHighlight]}><CouncilPanel council={council} candidates={councilCandidates} search1={councilSearch1} search2={councilSearch2} onSearch1Change={setCouncilSearch1} onSearch2Change={setCouncilSearch2} onPick={setCouncilMember} onClear={clearCouncilMember} busy={councilBusy} error={councilError}/></View>:null}
  <Panel><View ref={registerSection('actions')} style={[isActive('actions')&&styles.tourHighlight]}><View style={styles.actions}><AppButton title="Importar PDF" onPress={pick} disabled={busy}/><AppButton title="Preencher dados do mês" onPress={importMonthData} disabled={busy}/><AppButton title="Baixar extrato em PDF" onPress={downloadExtratoPdf} disabled={busy} variant="secondary"/><AppButton title="Novo preenchimento" onPress={()=>{setDraft(empty(user,council));setEditId(null);setSource('manual');setError('')}} disabled={busy}/></View><Input label="Saldo bancário da competência (R$)" value={money(draft.bankBalanceCents)} onChange={v=>field('bankBalanceCents',signedCents(v))}/></View>
   <View ref={registerSection('form')} style={[isActive('form')&&styles.tourHighlight]}><Text style={styles.origin}>Origem: {user?.condominiumName||'Condomínio logado'}</Text><View style={styles.grid}><Input label="Mês (MM/AAAA)" value={draft.referenceMonth} onChange={v=>field('referenceMonth',v)}/><Input label="Início (DD/MM/AAAA)" value={draft.periodStart} onChange={v=>field('periodStart',v)}/><Input label="Fim (DD/MM/AAAA)" value={draft.periodEnd} onChange={v=>field('periodEnd',v)}/><Input label="Apartamentos pagos" value={String(draft.paidUnits)} onChange={v=>field('paidUnits',Number(v)||0)}/><Input label="Apartamentos isentos" value={String(draft.exemptUnits)} onChange={v=>field('exemptUnits',Number(v)||0)}/><Input label="Apartamentos não pagos" value={String(draft.unpaidUnits)} onChange={v=>field('unpaidUnits',Number(v)||0)}/><Input label="Total recebido (R$)" value={money(draft.receivedAmountCents)} onChange={v=>field('receivedAmountCents',cents(v))}/><Input label="Cidade" value={draft.city} onChange={v=>field('city',v)}/><Input label="Nome do Síndico" value={draft.sindicoName} onChange={v=>field('sindicoName',v)}/><Input label="Nome do Subsíndico" value={draft.subsindicoName} onChange={v=>field('subsindicoName',v)}/><Input label="Conselho Fiscal 1" value={draft.fiscalCouncil1Name} onChange={v=>field('fiscalCouncil1Name',v)}/><Input label="Conselho Fiscal 2" value={draft.fiscalCouncil2Name} onChange={v=>field('fiscalCouncil2Name',v)}/></View></View>
   <View ref={registerSection('expenses')} style={[isActive('expenses')&&styles.tourHighlight]}><Text style={styles.heading}>Despesas</Text>{draft.expenses.map((item,index)=><View key={index} style={styles.expense}><Input label="Empresa ou pessoa" value={item.provider} onChange={v=>expense(index,'provider',v)}/><Input label="Objetivo do serviço" value={item.purpose} onChange={v=>expense(index,'purpose',v)}/><Input label="Data (DD/MM/AAAA)" value={item.serviceDate} onChange={v=>expense(index,'serviceDate',v)}/><Input label="Valor (R$)" value={money(item.amountCents)} onChange={v=>expense(index,'amountCents',cents(v))}/><View style={styles.attachRow}><View style={styles.attachCol}><Pressable onPress={()=>pickExpenseFile(index,'receipt')}><Text style={styles.add}>{receiptFiles[index]?`Recibo selecionado: ${receiptFiles[index].name}`:item.has_receipt?`Recibo atual: ${item.receipt_file_name} (toque para substituir)`:'+ Anexar recibo (opcional)'}</Text></Pressable>{item.has_receipt&&!receiptFiles[index]?<Pressable onPress={()=>removeFile(item,'receipt',index)}><Text style={styles.remove}>Excluir recibo</Text></Pressable>:null}</View><View style={styles.attachCol}><Pressable onPress={()=>pickExpenseFile(index,'proof')}><Text style={styles.add}>{proofFiles[index]?`Comprovante selecionado: ${proofFiles[index].name}`:item.has_proof?`Comprovante atual: ${item.proof_file_name} (toque para substituir)`:'+ Anexar comprovante (opcional)'}</Text></Pressable>{item.has_proof&&!proofFiles[index]?<Pressable onPress={()=>removeFile(item,'proof',index)}><Text style={styles.remove}>Excluir comprovante</Text></Pressable>:null}</View></View><Pressable onPress={()=>{setDraft(current=>({...current,expenses:current.expenses.filter((_,i)=>i!==index)}));setReceiptFiles(current=>current.filter((_,i)=>i!==index));setProofFiles(current=>current.filter((_,i)=>i!==index))}}><Text style={styles.remove}>Remover</Text></Pressable></View>)}
   <Pressable onPress={()=>setDraft(current=>({...current,expenses:[...current.expenses,blankExpense()]}))}><Text style={styles.add}>+ Adicionar despesa</Text></Pressable><View style={styles.totals}><Text>Total das despesas: {brl(total)}</Text><Text style={[styles.balance,draft.receivedAmountCents-total<0&&styles.negative]}>Saldo do mês: {brl(draft.receivedAmountCents-total)}</Text><Text style={[styles.balance,draft.bankBalanceCents<0&&styles.negative]}>Saldo bancário: {brl(draft.bankBalanceCents)}</Text></View>{error?<Text style={styles.error}>{error}</Text>:null}<AppButton title={busy?'Aguarde...':'Salvar prestação de contas'} onPress={save} disabled={busy}/></View>
  </Panel><View ref={registerSection('history')} style={[isActive('history')&&styles.tourHighlight]}><Text style={styles.heading}>Histórico</Text>{items.length?items.map(item=><View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.reference_month.slice(0,7)} · {item.origin}</Text><Text>Receita: {brl(item.received_amount_cents)} | Despesas: {brl(item.total_expenses_cents)}</Text><Text style={[styles.balance,Number(item.balance_cents)<0&&styles.negative]}>Saldo: {brl(item.balance_cents)}</Text><Text>Pagos: {item.paid_units} · Isentos: {item.exempt_units} · Não pagos: {item.unpaid_units} · {item.source==='pdf'?'PDF':'Manual'}</Text></View>):<EmptyState title="Nenhuma prestação cadastrada" description="Os fechamentos mensais aparecerão aqui."/>}</View>
 {selected?<View ref={registerSection('detail')} style={[isActive('detail')&&styles.tourHighlight]}><AccountabilityReportView report={selected} approvals={reportApprovals}/>{Platform.OS==='web'?<PrintPortal><AccountabilityReportView report={selected} printId={PRINT_AREA_ID} approvals={reportApprovals}/></PrintPortal>:null}{Platform.OS==='web'?<AppButton title="Imprimir" onPress={()=>window.print()}/>:null}<ApprovalsPanel reportId={selected.id} userToken={userToken} user={user} seats={reportApprovals} onSaved={()=>loadReportApprovals(selected.id)}/><Panel><View style={styles.actions}><AppButton title="Editar prestação" onPress={startEdit}/><AppButton title="Excluir prestação" onPress={removeReport}/></View><Text style={styles.heading}>Anexos por prestador</Text>{selected.expenses.map(item=><View key={item.id} style={styles.expense}><Text style={styles.cardTitle}>{item.provider}</Text><View style={styles.attachRow}><View style={styles.attachCol}>{hasFile(item,'receipt')?<Pressable onPress={()=>openFile(item,'receipt')}><Text style={styles.add}>Visualizar recibo: {item.receipt_file_name}</Text></Pressable>:null}<Pressable onPress={()=>attachExisting(item,'receipt')}><Text style={styles.add}>{hasFile(item,'receipt')?'Substituir recibo':'+ Anexar recibo'}</Text></Pressable>{hasFile(item,'receipt')?<Pressable onPress={()=>removeFile(item,'receipt')}><Text style={styles.remove}>Excluir recibo</Text></Pressable>:null}</View><View style={styles.attachCol}>{hasFile(item,'proof')?<Pressable onPress={()=>openFile(item,'proof')}><Text style={styles.add}>Visualizar comprovante: {item.proof_file_name}</Text></Pressable>:null}<Pressable onPress={()=>attachExisting(item,'proof')}><Text style={styles.add}>{hasFile(item,'proof')?'Substituir comprovante':'+ Anexar comprovante'}</Text></Pressable>{hasFile(item,'proof')?<Pressable onPress={()=>removeFile(item,'proof')}><Text style={styles.remove}>Excluir comprovante</Text></Pressable>:null}</View></View></View>)}</Panel></View>:null}<View ref={registerSection('manage')} style={[isActive('manage')&&styles.tourHighlight]}><Text style={styles.heading}>Gerenciar prestações e anexos</Text>{items.map(item=><Pressable key={`attachment-${item.id}`} onPress={()=>view(item.id)} style={styles.card}><Text>{item.reference_month.slice(0,7)} · editar, excluir ou gerenciar anexos</Text></Pressable>)}</View>
 <AppDialog visible={Boolean(dialog)} title={dialog?.title||''} message={dialog?.message||''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={()=>setDialog(null)}/>
 </ScrollView><FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/></>;
}
function Input({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <View style={styles.inputBox}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChange} style={styles.input}/></View>}

// Painel de seleção do Conselho Fiscal (síndico/subsíndico, só quando a
// feature está ligada). Componente de topo (não definido dentro da tela)
// de propósito: se fosse recriado a cada render, o TextInput de busca
// perderia o foco a cada letra digitada.
function CouncilSeatPicker({label,current,search,onSearchChange,candidates,onPick,onClear,busy}:{
 label:string;current:{id:string;fullName:string|null}|null;search:string;onSearchChange:(value:string)=>void;
 candidates:Array<{id:string;full_name:string|null;username:string}>;onPick:(id:string)=>void;onClear:()=>void;busy:boolean;
}){
 const filtered=useMemo(()=>{const term=search.trim().toLocaleLowerCase('pt-BR');if(term.length<2)return[];return candidates.filter(person=>(person.full_name||person.username).toLocaleLowerCase('pt-BR').includes(term)).slice(0,8)},[search,candidates]);
 return <View style={styles.inputBox}>
  <Text style={styles.label}>{label}</Text>
  {current?<View style={styles.councilSelected}><Text style={styles.councilSelectedText}>{current.fullName||'Sem nome'}</Text><Pressable onPress={onClear} disabled={busy}><Text style={styles.remove}>Remover</Text></Pressable></View>:<>
   <TextInput value={search} onChangeText={onSearchChange} placeholder="Digite ao menos 2 letras do nome" style={styles.input}/>
   {search.trim().length>=2?<View style={styles.councilOptions}>{filtered.length?filtered.map(person=><Pressable key={person.id} onPress={()=>onPick(person.id)} disabled={busy}><Text style={styles.add}>{person.full_name||person.username}</Text></Pressable>):<Text style={styles.label}>Nenhuma pessoa encontrada.</Text>}</View>:null}
  </>}
 </View>;
}
function CouncilPanel({council,candidates,search1,search2,onSearch1Change,onSearch2Change,onPick,onClear,busy,error}:{
 council:{fiscalCouncil1:{id:string;fullName:string|null}|null;fiscalCouncil2:{id:string;fullName:string|null}|null};
 candidates:Array<{id:string;full_name:string|null;username:string}>;search1:string;search2:string;
 onSearch1Change:(value:string)=>void;onSearch2Change:(value:string)=>void;
 onPick:(seat:1|2,personId:string)=>void;onClear:(seat:1|2)=>void;busy:boolean;error:string;
}){
 return <Panel>
  <Text style={styles.heading}>Conselho Fiscal</Text>
  <Text style={styles.councilHint}>Escolha entre os moradores cadastrados quem ocupa cada assento. Os dois passam a homologar (ou comentar) as prestações de contas junto com síndico e subsíndico.</Text>
  {error?<Text style={styles.error}>{error}</Text>:null}
  <View style={styles.grid}>
   <CouncilSeatPicker label="Conselho Fiscal 1" current={council.fiscalCouncil1} search={search1} onSearchChange={onSearch1Change} candidates={candidates} onPick={id=>onPick(1,id)} onClear={()=>onClear(1)} busy={busy}/>
   <CouncilSeatPicker label="Conselho Fiscal 2" current={council.fiscalCouncil2} search={search2} onSearchChange={onSearch2Change} candidates={candidates} onPick={id=>onPick(2,id)} onClear={()=>onClear(2)} busy={busy}/>
  </View>
 </Panel>;
}

// Homologação de uma prestação de contas específica: síndico, subsíndico e,
// se o Conselho Fiscal estiver ligado, os dois conselheiros — cada um pode
// homologar e/ou deixar uma consideração, sem bloquear nada. Usado tanto na
// visão de gestor quanto na de morador (um conselheiro fiscal pode ser
// proprietário/inquilino).
// Recebe `seats` pronto (em vez de buscar sozinho) porque a mesma lista
// também alimenta a assinatura impressa em AccountabilityReportView — um
// único fetch no componente pai mantém as duas visões em sincronia, inclusive
// logo depois de salvar (via onSaved).
function ApprovalsPanel({reportId,userToken,user,seats,onSaved}:{reportId:string;userToken:string|null;user:any;seats:Array<{seat:string;label:string;holderId:string|null;holderName:string|null;approved:boolean;note:string|null}>;onSaved:()=>void}){
 const[saving,setSaving]=useState(false);
 const[approvedDraft,setApprovedDraft]=useState(false);const[noteDraft,setNoteDraft]=useState('');
 const mySeatKey=user?.role==='sindico'?'sindico':user?.role==='subsindico'?'subsindico':(seats.find(seat=>seat.holderId&&seat.holderId===user?.id)?.seat||null);
 const mySeat=seats.find(seat=>seat.seat===mySeatKey)||null;
 useEffect(()=>{if(mySeat){setApprovedDraft(mySeat.approved);setNoteDraft(mySeat.note||'')}},[mySeat?.seat,mySeat?.approved,mySeat?.note]);
 const save=async()=>{
  if(!userToken)return;setSaving(true);
  try{await apiRequest(`/accountability/${reportId}/approval`,userToken,{method:'PUT',body:JSON.stringify({approved:approvedDraft,note:noteDraft})});onSaved()}
  catch(e){}
  finally{setSaving(false)}
 };
 if(!seats.length)return null;
 return <Panel>
  <Text style={styles.heading}>Homologação</Text>
  {seats.map(seat=><View key={seat.seat} style={styles.approvalRow}>
   <View style={styles.grow}>
    <Text style={styles.approvalSeat}>{seat.label}{seat.holderName?` · ${seat.holderName}`:' · não definido'}</Text>
    {seat.note?<Text style={styles.approvalNote}>"{seat.note}"</Text>:null}
   </View>
   <Text style={[styles.approvalStatus,seat.approved&&styles.approvalStatusOk]}>{seat.approved?'Homologado':'Pendente'}</Text>
  </View>)}
  {mySeat?<View style={styles.approvalForm}>
   <Pressable onPress={()=>setApprovedDraft(current=>!current)} style={styles.checkboxRow}>
    <View style={[styles.checkbox,approvedDraft&&styles.checkboxOn]}>{approvedDraft?<Text style={styles.checkmark}>✓</Text>:null}</View>
    <Text style={styles.checkboxLabel}>Homologar esta prestação de contas como {mySeat.label}</Text>
   </Pressable>
   <Text style={styles.label}>Considerações (opcional)</Text>
   <TextInput value={noteDraft} onChangeText={setNoteDraft} placeholder="Ex.: aprovo, mas peço a nota fiscal do prestador X" multiline style={[styles.input,styles.noteInput]}/>
   {approvedDraft?<AppButton title={saving?'Salvando...':'Salvar homologação'} onPress={save} disabled={saving}/>:null}
  </View>:null}
 </Panel>;
}
const styles=StyleSheet.create({container:{width:'100%',alignSelf:'center',padding:24,paddingBottom:50},headerRow:{flexDirection:'row',alignItems:'flex-start',gap:12,flexWrap:'wrap'},grow:{flex:1},tourButton:{borderWidth:1,borderColor:colors.primary,borderRadius:20,paddingHorizontal:14,paddingVertical:9,backgroundColor:colors.softBlue},tourButtonText:{color:colors.primaryDark,fontWeight:'900',fontSize:13},tourHighlight:{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:6,margin:-6},eyebrow:{color:colors.primary,fontWeight:'900'},title:{fontSize:28,fontWeight:'900',color:colors.ink,marginTop:5},subtitle:{color:colors.muted,fontSize:16,marginVertical:10},actions:{flexDirection:'row',gap:10,flexWrap:'wrap',marginBottom:12},origin:{fontWeight:'800',color:colors.ink,marginBottom:12},grid:{flexDirection:'row',flexWrap:'wrap',gap:10},inputBox:{flexGrow:1,minWidth:190},label:{color:colors.muted,fontWeight:'700',marginBottom:4},input:{borderWidth:1,borderColor:colors.border,borderRadius:8,minHeight:46,paddingHorizontal:10,backgroundColor:'#fff'},heading:{fontSize:19,fontWeight:'900',color:colors.ink,marginTop:22,marginBottom:10},expense:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:12,marginTop:8,gap:8},attachRow:{flexDirection:'row',flexWrap:'wrap',gap:16},attachCol:{gap:4},remove:{color:colors.red,fontWeight:'800'},add:{color:colors.primary,fontWeight:'900',marginVertical:14},totals:{padding:14,backgroundColor:'#f1f5fb',borderRadius:8,gap:5},balance:{fontWeight:'900',color:colors.ink},error:{color:colors.red,marginVertical:10},card:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.border,borderRadius:8,padding:14,marginBottom:10,gap:5},cardTitle:{fontWeight:'900',fontSize:17,color:colors.ink},
councilHint:{color:colors.muted,fontSize:13,lineHeight:18,marginBottom:12},
councilSelected:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderWidth:1,borderColor:colors.border,borderRadius:8,minHeight:46,paddingHorizontal:10,backgroundColor:'#fff'},
councilSelectedText:{color:colors.ink,fontWeight:'800',flexShrink:1},
councilOptions:{gap:2,marginTop:4},
approvalRow:{flexDirection:'row',alignItems:'flex-start',gap:10,borderTopWidth:1,borderTopColor:colors.border,paddingTop:10,marginTop:8},
approvalSeat:{color:colors.ink,fontWeight:'800'},
approvalNote:{color:colors.muted,fontSize:13,marginTop:3,fontStyle:'italic'},
approvalStatus:{color:colors.muted,fontWeight:'900',fontSize:12.5},
approvalStatusOk:{color:colors.green},
approvalForm:{marginTop:16,paddingTop:14,borderTopWidth:1,borderTopColor:colors.border,gap:8},
checkboxRow:{flexDirection:'row',alignItems:'center',gap:10},
checkbox:{width:22,height:22,borderRadius:5,borderWidth:1,borderColor:colors.border,alignItems:'center',justifyContent:'center',backgroundColor:'#fff'},
checkboxOn:{backgroundColor:colors.primary,borderColor:colors.primary},
checkmark:{color:'#fff',fontWeight:'900',fontSize:14},
checkboxLabel:{color:colors.ink,fontWeight:'700',flexShrink:1},
noteInput:{minHeight:72,paddingTop:10,textAlignVertical:'top'},
});
