import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { apiRequest, downloadAuthenticated } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { brazilianDateToIso, brazilianMonthToIso, formatBrazilianDate, formatBrazilianMonth, maskBrazilianDate, maskBrazilianMonth } from '../utils/date';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Person={id:string;full_name:string|null;username:string;role:string;unit:string|null;unit_type_name?:string|null;condominium_fee_cents?:number|null;billing_exempt?:boolean;preferred_due_day?:number};
type Preview={referenceMonth:string;validCount:number;totalAmountCents:number;items:Array<Person&{valid:boolean;issues:string[];due_date:string}>};
type Batch={id:string;reference_month:string|null;due_date:string|null;status:string;total_items:number;total_amount_cents:number};
type ConsumptionItem={utilityType:string;quantity:number;unitPriceCents:number;amountCents:number};
type BatchItem={id:string;user_id:string|null;unit_label:string|null;payer_name:string;amount_cents:number;baseFeeCents?:number;extraChargeCents?:number;extraChargeDescriptions?:string[];consumptionChargeCents?:number;consumptionChargeDescriptions?:string[];consumptionItems?:ConsumptionItem[];condoFeePercent?:number|null;condoFeeCents?:number|null;improvementFeePercent?:number|null;improvementFeeCents?:number|null;manualOverride?:boolean;due_date:string;status:string;issues:string[];invoice_id:string|null};
type Dialog={title:string;message:string;tone:'info'|'success'|'error';confirmLabel?:string;cancelLabel?:string;onConfirm?:()=>void};
const money=(c:number)=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const utilityLabel:Record<string,string>={agua:'Água',gas:'Gás',energia:'Energia'};
// Prefixo "Taxa condominial X + Cobrança adicional Y + Consumo Z = " mostrado
// antes do valor total do item, só quando há mais de uma parcela compondo o
// valor (senão o total já fala por si).
const amountBreakdownPrefix=(item:BatchItem)=>{
  if(item.manualOverride) return 'Valor manual · ';
  // Quando as duas taxas estão configuradas, decompõe a taxa condominial em
  // vez de mostrar o valor da tipologia como uma linha só — mesmo
  // detalhamento que já aparece no boleto e no card de Gestão de cobranças.
  const condoFeeParts=[
    item.condoFeeCents!=null?`Taxa de condomínio (${item.condoFeePercent}%) ${money(item.condoFeeCents)}`:null,
    item.improvementFeeCents!=null?`Taxa de melhoria (${item.improvementFeePercent}%) ${money(item.improvementFeeCents)}`:null,
  ].filter((part):part is string=>Boolean(part));
  const consumptionParts=(item.consumptionItems||[]).map(consumptionItem=>`${utilityLabel[consumptionItem.utilityType]||consumptionItem.utilityType} (${consumptionItem.quantity} × ${money(consumptionItem.unitPriceCents)}) ${money(consumptionItem.amountCents)}`);
  const parts=[
    condoFeeParts.length?condoFeeParts.join(' + '):`Taxa condominial ${money(item.baseFeeCents||0)}`,
    item.extraChargeCents?`Cobrança adicional (${item.extraChargeDescriptions?.join(', ')}) ${money(item.extraChargeCents)}`:null,
    ...consumptionParts,
  ].filter((part):part is string=>Boolean(part));
  return parts.length>1||condoFeeParts.length?`${parts.join(' + ')} = `:'';
};

export default function BillingSettings({navigation}:any){
 const {isMobile:mobile}=useBreakpoint();
 const {userToken}=useContext(AuthContext); const [people,setPeople]=useState<Person[]>([]); const [selected,setSelected]=useState<string[]>([]); const [batches,setBatches]=useState<Batch[]>([]);
 const [referenceMonth,setReferenceMonth]=useState(''); const [description,setDescription]=useState(''); const [days,setDays]=useState('30');
 const [beneficiaryName,setBeneficiaryName]=useState(''); const [beneficiaryDocument,setBeneficiaryDocument]=useState('');
 const [boleto,setBoleto]=useState(true); const [pix,setPix]=useState(true); const [afterDue,setAfterDue]=useState(true); const [fineType,setFineType]=useState('NONE'); const [fineValue,setFineValue]=useState('0'); const [interestType,setInterestType]=useState('NONE'); const [interestValue,setInterestValue]=useState('0'); const [discountType,setDiscountType]=useState('NONE'); const [discountValue,setDiscountValue]=useState('0'); const [discountDays,setDiscountDays]=useState('0');
 const [condoFeePercent,setCondoFeePercent]=useState(''); const [improvementFeePercent,setImprovementFeePercent]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null); const [notice,setNotice]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 const [dialog,setDialog]=useState<Dialog|null>(null);
 const [batchItems,setBatchItems]=useState<Record<string,BatchItem[]>>({}); const [correctedDates,setCorrectedDates]=useState<Record<string,string>>({});
 const [viewingBatchId,setViewingBatchId]=useState<string|null>(null); const [viewingItems,setViewingItems]=useState<BatchItem[]>([]); const [addPersonId,setAddPersonId]=useState('');
 const viewingBatch=batches.find(b=>b.id===viewingBatchId)||null;
 const validateDisabledReasons=[
   !selected.length?'Selecione ao menos uma pessoa':null,
   !beneficiaryName||!beneficiaryDocument?'Cadastro do condomínio incompleto (nome/CNPJ)':null,
   !brazilianMonthToIso(referenceMonth)?'Informe o mês de referência (MM/AAAA)':null,
 ].filter((reason):reason is string=>Boolean(reason));
 const {scrollRef,tourOpen,registerSection,scrollToSection,openTour,closeTour,isActive}=useSectionTour();
 const tourSteps:TourStep[]=[
   {key:'rules',title:'Regras padrão de cobrança',description:'Boleto e Pix definem as formas de recebimento aceitas. "Permitir após vencimento" mais os dias informados controla se o boleto continua pagável (e por quantos dias) depois do vencimento. Multa, Juros e Desconto antecipado podem ser percentuais, valor fixo (ou % ao mês no caso dos juros) ou "Não aplicar" — o desconto antecipado ainda pede quantos dias antes do vencimento ele deixa de valer. "Taxa de condomínio (%)" e "Taxa de melhoria (%)" são opcionais: quando preenchidas, o valor da tipologia passa a ser detalhado nessas duas partes no card de Gestão de cobranças e na observação do boleto. Essas regras valem como padrão para os próximos boletos e ficam salvas ao tocar em "Salvar configuração".'},
   {key:'batch',title:'Novo lote mensal',description:'Nome e CPF/CNPJ do beneficiário vêm do cadastro do condomínio e não são editáveis aqui. A descrição é opcional (até 100 caracteres, pode usar {tipologia} como marcador) — a observação do boleto é sempre composta automaticamente com o que você digitar (se digitar algo) mais Taxa de condomínio/Taxa de melhoria, cobranças adicionais e consumo de água/gás/energia, quando existirem. O vencimento de cada boleto é calculado automaticamente pelo dia 10 ou 20 configurado no cadastro de cada morador, não por uma data única do lote. Selecione uma ou mais pessoas, informe o mês de referência (MM/AAAA) e toque em "Validar competência": isso só gera uma prévia, mostrando quem está válido (✓) e quem tem pendência, sem emitir nada. Só depois de conferir a prévia é que "Criar lote mensal" grava o lote de fato.'},
   {key:'history',title:'Histórico de competências',description:'Cada card é uma referência mensal já criada, com o status atual (rascunho, validado, confirmado ou parcial). "Confirmar seleção para o banco" e "Gerar boletos no Banco Inter" avançam o lote até a emissão real — um lote "partial" teve boletos que falharam e pode tentar emitir as pendências de novo. "Ver boletos desta referência" abre o detalhe de cada cobrança, permitindo corrigir vencimento, excluir um item ou adicionar uma pessoa que ficou de fora. "Excluir referência" remove o lote inteiro, mas só funciona enquanto nenhum boleto dele já foi emitido no banco.'},
 ];
 const load=useCallback(async()=>{if(!userToken)return;try{const [u,c,b]=await Promise.all([apiRequest<any>('/users',userToken),apiRequest<any>('/billing/settings',userToken),apiRequest<any>('/billing/batches',userToken)]);setPeople(u.users.filter((x:Person)=>['proprietario','inquilino'].includes(x.role)&&!x.billing_exempt));setBatches(b.batches);const partials=(b.batches as Batch[]).filter(batch=>batch.status==='partial');const details=await Promise.all(partials.map(async batch=>[batch.id,(await apiRequest<any>(`/billing/batches/${batch.id}/items`,userToken)).items.filter((item:BatchItem)=>item.status==='failed')] as const));const nextItems=Object.fromEntries(details);setBatchItems(nextItems);setCorrectedDates(current=>{const next={...current};details.forEach(([,items])=>items.forEach((item:BatchItem)=>{if(!next[item.id])next[item.id]=formatBrazilianDate(item.due_date)}));return next});setBeneficiaryName(c.condominium?.name||'');setBeneficiaryDocument(c.condominium?.cnpj||'');const x=c.settings;if(x){setDescription(x.description_template);setBoleto(x.receive_boleto);setPix(x.receive_pix);setAfterDue(x.allow_after_due);setDays(String(x.days_after_due));setFineType(x.fine_type);setFineValue(String(x.fine_value));setInterestType(x.interest_type);setInterestValue(String(x.interest_value));setDiscountType(x.discount_type);setDiscountValue(String(x.discount_value));setDiscountDays(String(x.discount_days));setCondoFeePercent(x.condo_fee_percent!=null?String(x.condo_fee_percent):'');setImprovementFeePercent(x.improvement_fee_percent!=null?String(x.improvement_fee_percent):'');}}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar');}},[userToken]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{if(notice)setDialog({title:'Tudo certo',message:notice,tone:'success'})},[notice]);
 useEffect(()=>{if(error)setDialog({title:'Não foi possível concluir',message:error,tone:'error'})},[error]);
 const save=async()=>{if(!userToken)return;setLoading(true);setError('');try{await apiRequest('/billing/settings',userToken,{method:'PUT',body:JSON.stringify({descriptionTemplate:description,receiveBoleto:boleto,receivePix:pix,allowAfterDue:afterDue,daysAfterDue:+days,fineType,fineValue:+fineValue.replace(',','.'),interestType,interestValue:+interestValue.replace(',','.'),discountType,discountValue:+discountValue.replace(',','.'),discountDays:+discountDays,condoFeePercent:condoFeePercent.trim()?+condoFeePercent.replace(',','.'):null,improvementFeePercent:improvementFeePercent.trim()?+improvementFeePercent.replace(',','.'):null})});setNotice('Configuração salva.');}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar')}finally{setLoading(false)}};
 const validate=async()=>{const referenceMonthIso=brazilianMonthToIso(referenceMonth);if(!userToken||!referenceMonthIso)return;setLoading(true);try{setPreview(await apiRequest('/billing/batches/preview',userToken,{method:'POST',body:JSON.stringify({referenceMonth:referenceMonthIso,userIds:selected})}));}catch(e){setError(e instanceof Error?e.message:'Falha ao validar')}finally{setLoading(false)}};
 const draft=async()=>{const referenceMonthIso=brazilianMonthToIso(referenceMonth);if(!userToken||!preview||!referenceMonthIso)return;setLoading(true);try{const r=await apiRequest<any>('/billing/batches',userToken,{method:'POST',body:JSON.stringify({referenceMonth:referenceMonthIso,description,userIds:preview.items.filter(i=>i.valid).map(i=>i.id)})});setNotice(r.message);setPreview(null);setSelected([]);await load();}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar lote')}finally{setLoading(false)}};
 const toggle=(id:string)=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const confirmBatch=async(id:string)=>{if(!userToken)return;setLoading(true);try{const r=await apiRequest<any>(`/billing/batches/${id}/confirm`,userToken,{method:'POST'});setNotice(r.message);await load();}catch(e){setError(e instanceof Error?e.message:'Falha ao confirmar')}finally{setLoading(false)}};
 const executeIssueBatch=async(id:string)=>{if(!userToken)return;setDialog(null);setLoading(true);setError('');setNotice('');try{const r=await apiRequest<any>(`/billing/batches/${id}/issue`,userToken,{method:'POST'});if(r.failed>0)setDialog({title:r.issued>0?'Emissão concluída com pendências':'Boleto não emitido',message:r.message,tone:'error'});else setDialog({title:'Emissão concluída',message:r.message,tone:'success'});await load();}catch(e){setError(e instanceof Error?e.message:'Não foi possível gerar as cobranças no banco.')}finally{setLoading(false)}};
 const issueBatch=(id:string)=>setDialog({title:'Confirmar emissão dos boletos?',message:'As cobranças deste lote serão enviadas ao Banco Inter e poderão gerar boletos reais. Confira os dados antes de continuar.',tone:'info',confirmLabel:'Sim, emitir boletos',cancelLabel:'Revisar lote',onConfirm:()=>executeIssueBatch(id)});
 const openBatchView=useCallback(async(batchId:string)=>{if(!userToken)return;setLoading(true);setError('');try{const r=await apiRequest<any>(`/billing/batches/${batchId}/items`,userToken);setViewingItems(r.items);setCorrectedDates(current=>{const next={...current};r.items.forEach((item:BatchItem)=>{if(!next[item.id])next[item.id]=formatBrazilianDate(item.due_date)});return next});setViewingBatchId(batchId);setAddPersonId('');}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar os boletos do lote.')}finally{setLoading(false)}},[userToken]);
 const closeBatchView=()=>{setViewingBatchId(null);setViewingItems([]);setAddPersonId('');};
 const saveFailedDueDate=async(batchId:string,itemId:string)=>{const dueDate=brazilianDateToIso(correctedDates[itemId]||'');if(!userToken||!dueDate)return;setLoading(true);setError('');setNotice('');try{const r=await apiRequest<any>(`/billing/batches/${batchId}/items/${itemId}/due-date`,userToken,{method:'PATCH',body:JSON.stringify({dueDate})});setNotice(r.message);await load();if(viewingBatchId===batchId)await openBatchView(batchId);}catch(e){setError(e instanceof Error?e.message:'Não foi possível alterar o vencimento.')}finally{setLoading(false)}};
 const deleteBatchItem=async(batchId:string,item:BatchItem)=>{if(!userToken)return;setLoading(true);setError('');setNotice('');try{const r=await apiRequest<any>(`/billing/batches/${batchId}/items/${item.id}`,userToken,{method:'DELETE'});setNotice(r.message);await load();await openBatchView(batchId);}catch(e){setError(e instanceof Error?e.message:'Não foi possível remover esta cobrança.')}finally{setLoading(false)}};
 const confirmDeleteBatchItem=(batchId:string,item:BatchItem)=>setDialog({title:'Remover cobrança do lote',message:`Remover ${item.payer_name} deste lote? Só é possível remover cobranças que ainda não foram emitidas no banco.`,tone:'error',confirmLabel:'Remover',cancelLabel:'Voltar',onConfirm:()=>{setDialog(null);deleteBatchItem(batchId,item);}});
 const addPersonToBatch=async(batchId:string)=>{if(!userToken||!addPersonId)return;setLoading(true);setError('');setNotice('');try{const r=await apiRequest<any>(`/billing/batches/${batchId}/items`,userToken,{method:'POST',body:JSON.stringify({userId:addPersonId})});setNotice(r.message);setAddPersonId('');await load();await openBatchView(batchId);}catch(e){setError(e instanceof Error?e.message:'Não foi possível adicionar esta pessoa ao lote.')}finally{setLoading(false)}};
 const deleteBatch=async(id:string)=>{if(!userToken)return;setLoading(true);setError('');setNotice('');try{const r=await apiRequest<any>(`/billing/batches/${id}`,userToken,{method:'DELETE'});setNotice(r.message);if(viewingBatchId===id)closeBatchView();await load();}catch(e){setError(e instanceof Error?e.message:'Não foi possível excluir esta referência.')}finally{setLoading(false)}};
 const confirmDeleteBatch=(b:Batch)=>setDialog({title:'Excluir referência',message:`Excluir a referência ${b.reference_month?formatBrazilianMonth(b.reference_month):''} por completo? Isso remove o lote, os itens e o histórico deste registro. Só é possível quando nenhum boleto desta referência já foi emitido no banco.`,tone:'error',confirmLabel:'Excluir referência',cancelLabel:'Voltar',onConfirm:()=>{setDialog(null);deleteBatch(b.id);}});
 const exportBatch=async(id:string)=>{if(!userToken)return;try{await downloadAuthenticated(`/billing/batches/${id}/export`,userToken,`lote-${id}.xlsx`)}catch(e){setError(e instanceof Error?e.message:'Falha ao exportar')}};
 const options=(value:string,set:(v:string)=>void,items:string[])=><View style={s.row}>{items.map(v=><Pressable key={v} onPress={()=>set(v)} style={[s.option,value===v&&s.on]}><Text style={[s.optionText,value===v&&s.onText]}>{v==='NONE'?'Não aplicar':v==='PERCENT'?'Percentual':v==='FIXED'?'Valor fixo':'% ao mês'}</Text></Pressable>)}</View>;
 return (
  <>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.container,mobile&&s.containerMobile]}>
 <View style={s.headerRow}><View style={s.grow}><Text style={s.eyebrow}>COBRANÇAS</Text><Text style={s.title}>Configuração e emissão em massa</Text><Text style={s.subtitle}>Nome, documento e endereço vêm da pessoa; o valor vem da tipologia. A prévia nunca emite automaticamente.</Text></View><Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable></View>
 <View ref={registerSection('rules')} style={[isActive('rules')&&s.tourHighlight]}><Panel>
   <Text style={s.heading}>Regras padrão</Text>
   <Text style={s.label}>Recebimento</Text>
   <View style={s.row}><Pressable onPress={()=>setBoleto(!boleto)} style={[s.option,boleto&&s.on]}><Text style={[s.optionText,boleto&&s.onText]}>Boleto</Text></Pressable><Pressable onPress={()=>setPix(!pix)} style={[s.option,pix&&s.on]}><Text style={[s.optionText,pix&&s.onText]}>Pix</Text></Pressable></View>
   <FormFieldFull>
     <Pressable onPress={()=>setAfterDue(!afterDue)} style={[s.check,afterDue&&s.checkOn]}><Text style={s.optionText}>{afterDue?'✓ ':''}Permitir após vencimento</Text></Pressable>
   </FormFieldFull>
   <FormFieldFull>
     <TextInput value={days} onChangeText={setDays} placeholder="Dias após vencimento" keyboardType="number-pad" style={s.input}/>
   </FormFieldFull>
   <FormGrid columns={{mobile:1,tablet:2,desktop:3}}>
     <View>
       <Text style={s.label}>Multa</Text>
       {options(fineType,setFineType,['NONE','PERCENT','FIXED'])}
       {fineType!=='NONE'?<TextInput value={fineValue} onChangeText={setFineValue} style={s.input}/>:null}
     </View>
     <View>
       <Text style={s.label}>Juros</Text>
       {options(interestType,setInterestType,['NONE','PERCENT_MONTH','FIXED'])}
       {interestType!=='NONE'?<TextInput value={interestValue} onChangeText={setInterestValue} style={s.input}/>:null}
     </View>
     <View>
       <Text style={s.label}>Desconto antecipado</Text>
       {options(discountType,setDiscountType,['NONE','PERCENT','FIXED'])}
       {discountType!=='NONE'?<View><TextInput value={discountValue} onChangeText={setDiscountValue} style={s.input}/><TextInput value={discountDays} onChangeText={setDiscountDays} placeholder="Dias antes" style={s.input}/></View>:null}
     </View>
   </FormGrid>
   <Text style={s.label}>Detalhamento da cobrança (opcional)</Text>
   <Text style={s.subtitle}>Divide o valor da tipologia em duas partes só para exibição — não muda o valor cobrado nem é enviado ao Banco Inter como campo separado.</Text>
   <FormGrid columns={{mobile:1,tablet:2,desktop:2}}>
     <View><Text style={s.label}>Taxa de condomínio (%)</Text><TextInput value={condoFeePercent} onChangeText={setCondoFeePercent} placeholder="Ex.: 90" keyboardType="decimal-pad" style={s.input}/></View>
     <View><Text style={s.label}>Taxa de melhoria (%)</Text><TextInput value={improvementFeePercent} onChangeText={setImprovementFeePercent} placeholder="Ex.: 10" keyboardType="decimal-pad" style={s.input}/></View>
   </FormGrid>
   <AppButton title="Salvar configuração" onPress={save} disabled={loading}/>
 </Panel></View>
 <View ref={registerSection('batch')} style={[isActive('batch')&&s.tourHighlight]}><Panel><Text style={s.heading}>Novo lote mensal</Text><Text style={s.label}>Nome do beneficiário final</Text><TextInput value={beneficiaryName} editable={false} style={[s.input,s.readonly]}/><Text style={s.label}>CPF ou CNPJ do beneficiário</Text><TextInput value={beneficiaryDocument} editable={false} style={[s.input,s.readonly]}/><FormFieldFull><Text style={s.label}>Descrição na observação do boleto</Text><TextInput value={description} onChangeText={value=>setDescription(value.slice(0,100))} placeholder="Descrição da cobrança" maxLength={100} style={s.input}/><Text style={s.counter}>{description.length}/100 caracteres</Text></FormFieldFull><Text style={s.label}>Mês de referência</Text><TextInput value={referenceMonth} onChangeText={value=>setReferenceMonth(maskBrazilianMonth(value))} placeholder="MM/AAAA" keyboardType="number-pad" maxLength={7} style={s.input}/><Text style={s.subtitle}>O vencimento será calculado automaticamente pelo dia 10 ou 20 definido no cadastro de cada pessoa.</Text><Pressable onPress={()=>setSelected(selected.length===people.length?[]:people.map(p=>p.id))}><Text style={s.link}>{selected.length===people.length?'Limpar seleção':'Selecionar todas as pessoas'}</Text></Pressable>{people.map(p=><Pressable key={p.id} onPress={()=>toggle(p.id)} style={[s.person,mobile&&s.personMobile,selected.includes(p.id)&&s.personOn]}><View style={s.personContent}><Text style={s.name}>{selected.includes(p.id)?'✓ ':''}{p.full_name||p.username}</Text><Text style={s.meta}>{p.unit||'Sem unidade'} · {p.unit_type_name||'Sem tipologia'} · vence dia {p.preferred_due_day||10}</Text></View><Text style={[s.value,mobile&&s.valueMobile]}>{p.condominium_fee_cents?money(p.condominium_fee_cents):'Sem valor'}</Text></Pressable>)}<AppButton title="Validar competência" onPress={validate} disabled={loading||Boolean(validateDisabledReasons.length)}/>{validateDisabledReasons.length?<Text style={s.missingHint}>Falta: {validateDisabledReasons.join(' · ')}</Text>:null}{preview?<View style={s.preview}><Text style={s.heading}>Referência {formatBrazilianMonth(preview.referenceMonth)} · {preview.validCount} válidos · {money(preview.totalAmountCents)}</Text>{preview.items.map(i=><Text key={i.id} style={i.valid?s.ok:s.bad}>{i.valid?'✓':'!'} {i.full_name||i.username} · vencimento {formatBrazilianDate(i.due_date)}{i.issues.length?` — ${i.issues.join(', ')}`:''}</Text>)}<AppButton title="Criar lote mensal" onPress={draft} disabled={!preview.validCount||loading}/></View>:null}</Panel></View>
 <View ref={registerSection('history')} style={[isActive('history')&&s.tourHighlight]}><Text style={s.heading}>Histórico de competências</Text>
 <CardGrid columns={{mobile:1,tablet:2,desktop:3}}>
   {batches.map(b=><View key={b.id} style={s.batch}><Text style={s.name}>Referência {b.reference_month?formatBrazilianMonth(b.reference_month):'não informada'} · {b.status}</Text><Text style={s.meta}>Vencimento {b.due_date?formatBrazilianDate(b.due_date):'variado'} · {b.total_items} pessoas · {money(Number(b.total_amount_cents))}</Text>{b.status==='partial'?<View style={s.failedBox}><Text style={s.failedTitle}>Boletos não emitidos</Text>{(batchItems[b.id]||[]).map(item=><View key={item.id} style={s.failedItem}><Text style={s.failedName}>{item.payer_name}</Text><Text style={s.failedReason}>{item.issues?.join(' · ')||'A emissão não foi concluída.'}</Text><Text style={s.label}>Novo vencimento</Text><TextInput value={correctedDates[item.id]||''} onChangeText={value=>setCorrectedDates(current=>({...current,[item.id]:maskBrazilianDate(value)}))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={s.input}/><AppButton title="Salvar novo vencimento" onPress={()=>saveFailedDueDate(b.id,item.id)} disabled={loading||!brazilianDateToIso(correctedDates[item.id]||'')}/></View>)}</View>:null}<View style={s.row}>{['draft','validated'].includes(b.status)?<Pressable onPress={()=>confirmBatch(b.id)} style={s.smallButton}><Text style={s.link}>Confirmar seleção para o banco</Text></Pressable>:null}{['confirmed','partial'].includes(b.status)?<Pressable onPress={()=>issueBatch(b.id)} style={s.smallButton}><Text style={s.link}>{b.status==='partial'?'Tentar emitir pendências':'Gerar boletos no Banco Inter'}</Text></Pressable>:null}<Pressable onPress={()=>openBatchView(b.id)} style={s.smallButton}><Text style={s.link}>Ver boletos desta referência</Text></Pressable><Pressable onPress={()=>exportBatch(b.id)} style={s.smallButton}><Text style={s.link}>Exportar Excel</Text></Pressable><Pressable onPress={()=>confirmDeleteBatch(b)} style={s.smallButton}><Text style={s.deleteLink}>Excluir referência</Text></Pressable></View></View>)}
 </CardGrid></View>    </ScrollView>
    <AppDialog visible={Boolean(dialog)} title={dialog?.title||''} message={dialog?.message||''} tone={dialog?.tone} confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={()=>setDialog(null)}/>
    <Modal visible={Boolean(viewingBatch)} transparent animationType="fade" onRequestClose={closeBatchView}>
      <View style={s.modalOverlay}>
        <View style={s.modalContent}>
          <Pressable onPress={closeBatchView} style={s.modalCloseButton}><Text style={s.modalCloseButtonText}>×</Text></Pressable>
          <ScrollView contentContainerStyle={{gap:12}}>
            {viewingBatch?<>
              <Text style={s.heading}>Referência {viewingBatch.reference_month?formatBrazilianMonth(viewingBatch.reference_month):'não informada'} · {viewingBatch.status}</Text>
              <Text style={s.meta}>{viewingItems.length} boleto(s) · {money(viewingItems.reduce((sum,item)=>sum+Number(item.amount_cents||0),0))}</Text>
              <Pressable onPress={()=>confirmDeleteBatch(viewingBatch)} style={s.smallButton}><Text style={s.deleteLink}>Excluir esta referência inteira</Text></Pressable>
              {viewingItems.map(item=>{
                const editable=['valid','confirmed','failed'].includes(item.status)&&!item.invoice_id;
                return <View key={item.id} style={s.itemRow}>
                  <View style={s.personContent}>
                    <Text style={s.name}>{item.payer_name}</Text>
                    <Text style={s.meta}>{item.unit_label||'Sem unidade'} · vencimento {formatBrazilianDate(item.due_date)} · {item.status}</Text>
                    <Text style={s.meta}>{amountBreakdownPrefix(item)}{money(item.amount_cents)}</Text>
                    {editable?<View style={s.row}>
                      <TextInput value={correctedDates[item.id]||''} onChangeText={value=>setCorrectedDates(current=>({...current,[item.id]:maskBrazilianDate(value)}))} placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10} style={[s.input,s.inputInline]}/>
                      <Pressable onPress={()=>saveFailedDueDate(viewingBatch.id,item.id)} style={s.smallButton}><Text style={s.link}>Salvar vencimento</Text></Pressable>
                      <Pressable onPress={()=>confirmDeleteBatchItem(viewingBatch.id,item)} style={s.smallButton}><Text style={s.deleteLink}>Excluir</Text></Pressable>
                    </View>:null}
                  </View>
                </View>;
              })}
              <Text style={s.heading}>Adicionar unidade a esta referência</Text>
              <Text style={s.subtitle}>Só pessoas sem cobrança nesta referência e ainda fora deste lote aparecem aqui.</Text>
              {people.filter(p=>!viewingItems.some(item=>item.user_id===p.id)).map(p=>
                <Pressable key={p.id} onPress={()=>setAddPersonId(p.id)} style={[s.person,addPersonId===p.id&&s.personOn]}>
                  <View style={s.personContent}><Text style={s.name}>{addPersonId===p.id?'✓ ':''}{p.full_name||p.username}</Text><Text style={s.meta}>{p.unit||'Sem unidade'} · {p.unit_type_name||'Sem tipologia'}</Text></View>
                </Pressable>
              )}
              <AppButton title="Adicionar à referência" onPress={()=>addPersonToBatch(viewingBatch.id)} disabled={loading||!addPersonId}/>
            </>:null}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
  </>
 );
}
const s=StyleSheet.create({container:{width:'100%',alignSelf:'center',padding:20,paddingBottom:50,paddingHorizontal:12,gap:14},containerMobile:{paddingBottom:100},headerRow:{flexDirection:'row',alignItems:'flex-start',gap:12,flexWrap:'wrap'},grow:{flex:1},tourButton:{borderWidth:1,borderColor:colors.primary,borderRadius:20,paddingHorizontal:14,paddingVertical:9,backgroundColor:colors.softBlue},tourButtonText:{color:colors.primaryDark,fontWeight:'900',fontSize:13},tourHighlight:{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:6,margin:-6},eyebrow:{color:colors.primary,fontWeight:'900'},title:{color:colors.ink,fontSize: 24,fontWeight:'900'},subtitle:{color:colors.muted,lineHeight: 21},heading:{color:colors.ink,fontSize: 17,fontWeight:'900',marginBottom:10},label:{color:colors.ink,fontWeight:'800',marginBottom:7,fontSize:14},input:{minHeight: 48,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:12,marginBottom:10,backgroundColor:'#fff',fontSize:14},readonly:{backgroundColor:'#f2f4f7',color:colors.primaryDark,fontWeight:'800'},counter:{color:colors.muted,fontSize: 12,textAlign:'right',marginTop:-6,marginBottom:10},missingHint:{color:colors.red,fontSize: 13,fontWeight:'700',marginTop:8},row:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10},option:{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:10},on:{backgroundColor:colors.primary,borderColor:colors.primary},optionText:{color:colors.muted,fontWeight:'800',fontSize:13},onText:{color:'#fff'},check:{padding:10,marginBottom:8,borderRadius:8,backgroundColor:'#f4f6f8'},checkOn:{backgroundColor:colors.softBlue},link:{color:colors.primary,fontWeight:'900',marginBottom:10,fontSize:14},person:{flexDirection:'row',justifyContent:'space-between',borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,marginBottom:7},personMobile:{flexDirection:'column',alignItems:'flex-start'},personContent:{flex:1},personOn:{borderColor:colors.primary,backgroundColor:colors.softBlue},name:{color:colors.ink,fontWeight:'900',fontSize:14},meta:{color:colors.muted,marginTop:2,fontSize:12},value:{color:colors.primaryDark,fontWeight:'900',fontSize:14},valueMobile:{marginTop:8,alignSelf:'flex-start'},preview:{marginTop:14,borderTopWidth:1,borderTopColor:colors.border,paddingTop:14,gap:5},ok:{color:colors.green,fontWeight:'800',marginVertical:5},bad:{color:colors.red,fontWeight:'800',marginVertical:5},batch:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,marginBottom:8},failedBox:{marginTop:14,borderWidth:1,borderColor:'#efb2b2',backgroundColor:'#fff7f7',borderRadius:8,padding:12},failedTitle:{color:colors.red,fontSize: 17,fontWeight:'900',marginBottom:8},failedItem:{borderTopWidth:1,borderTopColor:'#f2cccc',paddingTop:10,marginTop:6},failedName:{color:colors.ink,fontWeight:'900'},failedReason:{color:colors.red,lineHeight: 21,marginTop:4,marginBottom:10},importLine:{borderBottomWidth:1,borderBottomColor:colors.border,paddingVertical:6},issue:{color:colors.muted,fontSize: 15,marginLeft:10},smallButton:{padding:8,backgroundColor:colors.softBlue,borderRadius:8,marginTop:10},fileReady:{borderWidth:1,borderColor:colors.primary,borderRadius:8,backgroundColor:colors.softBlue,padding:12,marginBottom:10},importErrorBox:{borderWidth:1,borderColor:'#efb2b2',borderRadius:8,backgroundColor:'#fff3f3',padding:12,marginTop:10},
modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.5)',justifyContent:'center',alignItems:'center',padding:20},modalContent:{backgroundColor:'#fff',borderRadius:12,padding:20,paddingTop:30,maxWidth:640,width:'100%',maxHeight:'85%'},
modalCloseButton:{position:'absolute',top:10,right:10,width:30,height:30,borderRadius:15,alignItems:'center',justifyContent:'center',zIndex:1},modalCloseButtonText:{color:colors.muted,fontSize:22,fontWeight:'900',lineHeight:24},
itemRow:{flexDirection:'row',borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,marginBottom:8},inputInline:{flex:1,minWidth:120,marginBottom:0},deleteLink:{color:colors.red,fontWeight:'900',fontSize:14}});


