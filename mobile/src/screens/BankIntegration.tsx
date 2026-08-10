import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Field, Panel, TextField } from '../ui/components';
import { ComboBox } from '../ui/ComboBox';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import { maskBrazilianMonth, brazilianMonthToIso, formatBrazilianMonth } from '../utils/date';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Provider = { id:string; code:string; name:string; adapterKey:string|null; active:boolean; operational:boolean; requiredFields:string[] };
type Condominium = { id:string; name:string; cnpj:string|null; bank_configuration_id:string|null; bank_configuration_name:string|null; bank_provider:string|null; boleto_sync_mode:'all'|'from_period'|null; boleto_sync_start_period:string|null };
type BankConfiguration = {
  id:string; name:string; provider:string; bank_id:string; bank_name:string; adapter_key:string|null; client_id:string|null; cert_path:string|null; key_path:string|null;
  base_url:string|null; token_path:string|null; scopes:string|null; extra_config:Record<string,unknown>;
  enabled:boolean; condominiums:Array<{id:string;name:string}>;
};

const defaults:Record<string,{baseUrl:string;tokenPath:string;scopes:string}> = {
  inter: { baseUrl:'https://cdpj.partners.bancointer.com.br', tokenPath:'/oauth/v2/token', scopes:'boleto-cobranca.write boleto-cobranca.read' },
  banco_do_brasil: { baseUrl:'https://api.bb.com.br', tokenPath:'', scopes:'' },
  bradesco: { baseUrl:'', tokenPath:'', scopes:'' },
  outro: { baseUrl:'', tokenPath:'', scopes:'' },
};

export default function BankIntegration({ navigation, route }:any) {
  const section = route?.params?.section || 'configurations';
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [providers,setProviders]=useState<Provider[]>([]);
  const [configurations,setConfigurations]=useState<BankConfiguration[]>([]);
  const [condominiums,setCondominiums]=useState<Condominium[]>([]);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [name,setName]=useState(''); const [provider,setProvider]=useState('inter'); const [bankId,setBankId]=useState('');
  const [newBankName,setNewBankName]=useState('');
  const [clientId,setClientId]=useState(''); const [clientSecret,setClientSecret]=useState('');
  const [certPath,setCertPath]=useState('./certs/inter.crt'); const [keyPath,setKeyPath]=useState('./certs/inter.key');
  const [baseUrl,setBaseUrl]=useState(defaults.inter.baseUrl); const [tokenPath,setTokenPath]=useState(defaults.inter.tokenPath);
  const [scopes,setScopes]=useState(defaults.inter.scopes); const [enabled,setEnabled]=useState(true);
  const [selectedCondominiumId,setSelectedCondominiumId]=useState('');
  const [selectedConfigurationId,setSelectedConfigurationId]=useState('');
  const [syncMode,setSyncMode]=useState<'all'|'from_period'>('all');
  const [syncStartPeriod,setSyncStartPeriod]=useState('');
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  const [testingId,setTestingId]=useState<string|null>(null);
  const [testResults,setTestResults]=useState<Record<string,{ok:boolean;message:string}>>({});

  const load=useCallback(async()=>{if(!userToken)return;setLoading(true);setError('');try{
    const [p,b,c]=await Promise.all([
      apiRequest<{providers:Provider[]}>('/bank-configurations/providers',userToken),
      apiRequest<{configurations:BankConfiguration[]}>('/bank-configurations',userToken),
      apiRequest<{condominiums:Condominium[]}>('/condominiums',userToken),
    ]);setProviders(p.providers);setConfigurations(b.configurations);setCondominiums(c.condominiums);if(!bankId){const initial=p.providers.find(x=>x.code==='inter')||p.providers[0];if(initial){setBankId(initial.id);setProvider(initial.adapterKey||'outro')}}
  }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar gestão bancária.')}finally{setLoading(false)}},[userToken,bankId]);
  useEffect(()=>{load()},[load]);

  const reset=()=>{setEditingId(null);setName('');setProvider('inter');setClientId('');setClientSecret('');setCertPath('./certs/inter.crt');setKeyPath('./certs/inter.key');setBaseUrl(defaults.inter.baseUrl);setTokenPath(defaults.inter.tokenPath);setScopes(defaults.inter.scopes);setEnabled(true)};

  // Opções dos comboboxes. A segunda linha (description) repete o que os
  // cartões antigos mostravam, para não perder informação ao fechar a lista.
  const bankOptions=providers.filter(item=>item.active).map(item=>({value:item.id,label:item.name,description:item.operational?'Operacional':'Adaptador pendente'}));
  const condominiumOptions=condominiums.map(item=>({value:item.id,label:item.name,description:`Vínculo atual: ${item.bank_configuration_name||'nenhuma configuração'} · Busca: ${item.boleto_sync_mode==='from_period'&&item.boleto_sync_start_period?`a partir de ${formatBrazilianMonth(item.boleto_sync_start_period)}`:'todos'}`}));
  const configurationOptions=configurations.map(item=>({value:item.id,label:item.name,description:`${item.bank_name||item.provider} · ${item.enabled?'ativa':'desabilitada'} · Vínculos: ${item.condominiums.map(c=>c.name).join(', ')||'nenhum'}`}));

  // Escolher o condomínio também carrega o vínculo e o modo de busca atuais —
  // era o que o onPress do cartão fazia antes de virar combobox.
  const chooseCondominium=(id:string)=>{const item=condominiums.find(x=>x.id===id);if(!item)return;setSelectedCondominiumId(id);setSelectedConfigurationId(item.bank_configuration_id||'');setSyncMode(item.boleto_sync_mode==='from_period'?'from_period':'all');setSyncStartPeriod(formatBrazilianMonth(item.boleto_sync_start_period))};
  const chooseProvider=(id:string)=>{const bank=providers.find(x=>x.id===id);if(!bank)return;setBankId(id);const adapter=bank.adapterKey||'outro';setProvider(adapter);const value=defaults[adapter]||defaults.outro;setBaseUrl(value.baseUrl);setTokenPath(value.tokenPath);setScopes(value.scopes);if(adapter!=='inter'){setCertPath('');setKeyPath('')}};
  const edit=(item:BankConfiguration)=>{setEditingId(item.id);setName(item.name);setBankId(item.bank_id);setProvider(item.adapter_key||item.provider);setClientId(item.client_id||'');setClientSecret('');setCertPath(item.cert_path||'');setKeyPath(item.key_path||'');setBaseUrl(item.base_url||'');setTokenPath(item.token_path||'');setScopes(item.scopes||'');setEnabled(item.enabled);setNotice('');setError('')};
  const save=async()=>{if(!userToken||!name.trim())return;setLoading(true);setError('');setNotice('');try{
    const path=editingId?`/bank-configurations/${editingId}`:'/bank-configurations';
    await apiRequest(path,userToken,{method:editingId?'PUT':'POST',body:JSON.stringify({name:name.trim(),bankId,clientId:clientId.trim()||null,clientSecret:clientSecret.trim()||undefined,certPath:certPath.trim()||null,keyPath:keyPath.trim()||null,baseUrl:baseUrl.trim()||null,tokenPath:tokenPath.trim()||null,scopes:scopes.trim()||null,enabled,extraConfig:{}})});
    setNotice('Configuração bancária salva.');reset();await load();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao salvar configuração.')}finally{setLoading(false)}};
  const syncPeriodIso=syncMode==='from_period'?brazilianMonthToIso(syncStartPeriod):null;
  const link=async()=>{if(!userToken||!selectedCondominiumId||!selectedConfigurationId)return;if(syncMode==='from_period'&&!syncPeriodIso)return;setLoading(true);setError('');try{
    const response=await apiRequest<{ok:boolean;deleted:number;preserved:number}>(`/bank-configurations/condominiums/${selectedCondominiumId}/link`,userToken,{method:'PUT',body:JSON.stringify({configurationId:selectedConfigurationId,syncMode,syncStartPeriod:syncPeriodIso?`${syncPeriodIso}-01`:null})});
    const deletionNote=response.deleted?` ${response.deleted} boleto(s) anterior(es) ao período foram excluídos permanentemente do sistema${response.preserved?` (${response.preserved} preservado(s) por estarem vinculados a um acordo de débito)`:''}.`:'';
    setNotice(`Banco vinculado ao condomínio. As operações do síndico usarão esta configuração.${deletionNote}`);await load();
  }catch(e){setError(e instanceof Error?e.message:'Falha ao vincular banco.')}finally{setLoading(false)}};
  const createBank=async()=>{if(!userToken||!newBankName.trim())return;setLoading(true);setError('');try{await apiRequest('/bank-configurations/banks',userToken,{method:'POST',body:JSON.stringify({name:newBankName.trim()})});setNewBankName('');setNotice('Banco cadastrado.');await load()}catch(e){setError(e instanceof Error?e.message:'Falha ao cadastrar banco.')}finally{setLoading(false)}};
  const test=async(id:string)=>{if(!userToken)return;setTestingId(id);setError('');setNotice('');setTestResults(current=>({...current,[id]:{ok:false,message:'Testando conexão com o banco...'}}));try{await apiRequest(`/bank-configurations/${id}/test`,userToken,{method:'POST'});setTestResults(current=>({...current,[id]:{ok:true,message:'Conexão bancária validada com sucesso.'}}))}catch(e){const message=e instanceof Error?e.message:'Falha ao testar a conexão bancária.';setTestResults(current=>({...current,[id]:{ok:false,message}}))}finally{setTestingId(null)}};
  const selectedProvider=providers.find(item=>item.id===bankId);

  const pageTitle = section === 'banks' ? 'Cadastro de bancos' : section === 'link' ? 'Vincular banco ao condomínio' : 'Configurações bancárias';
  const activeRoute = section === 'banks' ? 'Banks' : section === 'link' ? 'BankLink' : 'BankConfigurations';

  const banksTourSteps: TourStep[] = [
    { key: 'banks', title: 'Cadastro de bancos', description: 'Cada banco cadastrado aqui fica disponível pra criar configurações bancárias e realizar vínculos com condomínios. O código do banco é gerado automaticamente a partir do nome. Bancos marcados como "Integração operacional" (hoje só o Banco Inter) permitem emitir e testar conexão de verdade; os demais ficam com "adaptador pendente" — dá pra cadastrar a configuração, mas testes e emissões continuam bloqueados até o adaptador ser implementado.' },
  ];
  const configurationsTourSteps: TourStep[] = [
    { key: 'configForm', title: editingId ? 'Editar configuração' : 'Nova configuração bancária', description: 'Escolha um banco cadastrado e dê um nome pra identificar a configuração (ex.: "Templum - Banco Inter"). Pro Banco Inter, Client ID, Client Secret, caminho do certificado e da chave privada são obrigatórios — o Client Secret só é exigido na criação; ao editar, deixar em branco mantém o valor já salvo. URL base, endpoint de autenticação e escopos já vêm preenchidos com os padrões do Inter, mas dá pra ajustar. O botão "Ativa/Desabilitada" controla se essa configuração pode ser escolhida na hora de vincular a um condomínio.' },
    { key: 'configList', title: 'Configurações cadastradas', description: 'Cada card mostra o banco, se a configuração está ativa e quais condomínios já estão vinculados a ela. "Editar" carrega os dados no formulário acima (o Client Secret nunca é reexibido, só substituído). "Testar conexão" só fica disponível pra configurações do Banco Inter que estejam ativas — ele tenta obter um token OAuth de verdade junto à API do banco.' },
  ];
  const linkTourSteps: TourStep[] = [
    { key: 'link', title: 'Vincular banco ao condomínio', description: '1) Escolha o condomínio. 2) Escolha a configuração bancária cadastrada que ele vai usar — é essa configuração que o síndico do condomínio passa a usar pra emitir e sincronizar boletos. 3) Defina o período de busca: "Buscar todos os boletos" traz todo o histórico disponível no banco; "Buscar a partir de um período" ignora o que veio antes do mês informado e, ao salvar, apaga permanentemente do sistema qualquer boleto já importado com vencimento anterior a esse mês (inclusive os já pagos) — exceto os que estão vinculados a um acordo de débito em andamento, que são preservados.' },
  ];
  const tourSteps = section === 'banks' ? banksTourSteps : section === 'link' ? linkTourSteps : configurationsTourSteps;

  return <><ScrollView ref={scrollRef} contentContainerStyle={s.container}>
    <View style={s.headerRow}>
      <View style={s.grow}>
        <Text style={s.eyebrow}>Admin geral</Text><Text style={s.title}>Gestão de bancos</Text>
        <Text style={s.subtitle}>{pageTitle}</Text>
      </View>
      <Pressable onPress={openTour} style={s.tourButton}><Text style={s.tourButtonText}>? Tour desta tela</Text></Pressable>
    </View>
    {error?<Text style={s.error}>{error}</Text>:null}{notice?<Text style={s.success}>{notice}</Text>:null}

    {section==='banks'?<View ref={registerSection('banks')} style={[isActive('banks')&&s.tourHighlight]}><Panel><Text style={s.heading}>Cadastro de bancos</Text><Text style={s.meta}>Bancos cadastrados ficam disponíveis para criar configurações e realizar vínculos.</Text><TextField label="Nome do banco" value={newBankName} onChangeText={setNewBankName} placeholder="Ex.: Banco Inter"/><AppButton title="Cadastrar banco" onPress={createBank} disabled={loading||!newBankName.trim()}/><CardGrid columns={{mobile:1,tablet:2,desktop:3}}>{providers.map(item=><View key={item.id} style={s.option}><Text style={s.optionText}>{item.name}</Text><Text style={s.small}>{item.operational?'Integração operacional':item.adapterKey?'Adaptador pendente':'Banco cadastrado — adaptador pendente'}</Text></View>)}</CardGrid></Panel></View>:null}

    {section==='configurations'?<><View ref={registerSection('configForm')} style={[isActive('configForm')&&s.tourHighlight]}><Panel><Text style={s.heading}>{editingId?'Editar configuração':'Nova configuração bancária'}</Text>
      <Field label="Banco cadastrado" required>
        <ComboBox options={bankOptions} value={bankId} onChange={chooseProvider} placeholder="Selecione o banco" title="Banco cadastrado" searchPlaceholder="Buscar banco" emptyText="Nenhum banco encontrado."/>
      </Field>
      <FormGrid columns={{mobile:1,tablet:2,desktop:2}}>
        <TextField label="Nome da configuração" value={name} onChangeText={setName} placeholder="Ex.: Templum - Banco Inter"/>
        <TextField label="Client ID" hint="Chave da aplicação fornecida pelo banco." value={clientId} onChangeText={setClientId} placeholder="Client ID / chave da aplicação" autoCapitalize="none"/>
        <TextField label="Client Secret" hint={editingId?'Deixe vazio para manter o segredo atual.':undefined} value={clientSecret} onChangeText={setClientSecret} placeholder={editingId?'Novo Client Secret (vazio mantém o atual)':'Client Secret'} secureTextEntry autoCapitalize="none"/>
        {provider==='inter'?<TextField label="Caminho do certificado" value={certPath} onChangeText={setCertPath} placeholder="./certs/inter.crt"/>:null}
        {provider==='inter'?<TextField label="Caminho da chave privada" value={keyPath} onChangeText={setKeyPath} placeholder="./certs/inter.key"/>:null}
        <TextField label="URL base da API" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://..." autoCapitalize="none"/>
        <TextField label="Endpoint de autenticação" value={tokenPath} onChangeText={setTokenPath} placeholder="/oauth/v2/token" autoCapitalize="none"/>
        <TextField label="Escopos da API" value={scopes} onChangeText={setScopes} placeholder="boleto-cobranca.write boleto-cobranca.read" autoCapitalize="none"/>
      </FormGrid>
      {selectedProvider&&!selectedProvider.operational?<Text style={s.warning}>Esta configuração poderá ser vinculada, mas emissões ficarão bloqueadas até o adaptador de {selectedProvider.name} ser implementado.</Text>:null}
      <View style={s.actions}><AppButton title={enabled?'Ativa — desabilitar':'Desabilitada — ativar'} onPress={()=>setEnabled(v=>!v)} variant="secondary"/><AppButton title={editingId?'Salvar alterações':'Cadastrar configuração'} onPress={save} disabled={loading||!name.trim()||!bankId}/>{editingId?<AppButton title="Cancelar" onPress={reset} variant="secondary"/>:null}</View>
    </Panel></View>

    <View ref={registerSection('configList')} style={[isActive('configList')&&s.tourHighlight]}><Text style={s.section}>Configurações cadastradas</Text>{configurations.length?<CardGrid columns={{mobile:1,tablet:2,desktop:3}}>{configurations.map(item=><View key={item.id} style={s.card}><Text style={s.cardTitle}>{item.name}</Text><Text style={s.meta}>{item.bank_name||item.provider} · {item.enabled?'Ativa':'Desabilitada'}</Text><Text style={s.meta}>Vínculos: {item.condominiums.map(c=>c.name).join(', ')||'nenhum condomínio'}</Text><View style={s.actions}><AppButton title="Editar" onPress={()=>edit(item)} variant="secondary"/><AppButton title={testingId===item.id?'Testando conexão...':'Testar conexão'} onPress={()=>test(item.id)} disabled={Boolean(testingId)||item.provider!=='inter'||!item.enabled}/></View>{testResults[item.id]?<Text style={testResults[item.id].ok?s.testSuccess:s.testError}>{testResults[item.id].message}</Text>:null}{item.provider!=='inter'?<Text style={s.warning}>Teste indisponível: o adaptador deste banco ainda não foi implementado.</Text>:null}</View>)}</CardGrid>:<EmptyState title="Nenhum banco configurado" description="Cadastre a primeira conexão bancária acima."/>}</View></>:null}

    {section==='link'?<View ref={registerSection('link')} style={[isActive('link')&&s.tourHighlight]}><Text style={s.section}>Vincular banco ao condomínio</Text><Panel><Text style={s.meta}>As opções abaixo vêm das configurações criadas em “Nova configuração bancária”.</Text><Field label="1. Condomínio" required>
        <ComboBox options={condominiumOptions} value={selectedCondominiumId} onChange={chooseCondominium} placeholder="Selecione o condomínio" title="Condomínio" searchPlaceholder="Buscar condomínio" emptyText="Nenhum condomínio encontrado."/>
      </Field>
      {configurations.length===0?<EmptyState title="Nenhuma configuração bancária" description="Acesse Configurações bancárias e cadastre uma configuração antes de realizar o vínculo."/>:<Field label="2. Configuração bancária cadastrada" required>
        <ComboBox options={configurationOptions} value={selectedConfigurationId} onChange={setSelectedConfigurationId} placeholder="Selecione a configuração" title="Configuração bancária" searchPlaceholder="Buscar configuração ou banco" emptyText="Nenhuma configuração encontrada."/>
      </Field>}
      <Text style={s.label}>3. Período de busca de boletos</Text>
      <Text style={s.meta}>Define quanto do histórico do banco entra no sistema quando o síndico clicar em "Atualizar todos os boletos". Boletos arquivados no banco nunca são importados, em nenhum dos dois modos.</Text>
      <CardGrid columns={{mobile:1,tablet:2,desktop:2}}>
        <Pressable onPress={()=>setSyncMode('all')} style={[s.option,syncMode==='all'&&s.optionActive]}><Text style={syncMode==='all'?s.optionTextActive:s.optionText}>Buscar todos os boletos</Text><Text style={s.small}>Traz todo o histórico disponível no banco.</Text></Pressable>
        <Pressable onPress={()=>setSyncMode('from_period')} style={[s.option,syncMode==='from_period'&&s.optionActive]}><Text style={syncMode==='from_period'?s.optionTextActive:s.optionText}>Buscar a partir de um período</Text><Text style={s.small}>Ignora boletos anteriores ao mês informado.</Text></Pressable>
      </CardGrid>
      {syncMode==='from_period'?<View><TextField label="Mês inicial da busca" value={syncStartPeriod} onChangeText={v=>setSyncStartPeriod(maskBrazilianMonth(v))} placeholder="MM/AAAA" keyboardType="number-pad"/><Text style={s.small}>A partir deste mês, os boletos emitidos no banco entram no sistema. Histórico anterior a esse mês não é buscado.</Text><Text style={s.warning}>Atenção: ao salvar, todo boleto já importado com vencimento anterior a este mês é excluído permanentemente do sistema (inclusive os já pagos), exceto boletos vinculados a um acordo de débito em andamento.</Text></View>:null}
      <AppButton title="Salvar vínculo" onPress={link} disabled={loading||!selectedCondominiumId||!selectedConfigurationId||(syncMode==='from_period'&&!syncPeriodIso)}/></Panel></View>:null}
  </ScrollView>
  <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step=>scrollToSection(step.key)}/>
  </>;
}

const s=StyleSheet.create({container:{width:'100%',alignSelf:'center',padding:24,paddingBottom:50,backgroundColor:colors.background},headerRow:{flexDirection:'row',alignItems:'flex-start',gap:12,flexWrap:'wrap'},grow:{flex:1},tourButton:{borderWidth:1,borderColor:colors.primary,borderRadius:20,paddingHorizontal:14,paddingVertical:9,backgroundColor:colors.softBlue},tourButtonText:{color:colors.primaryDark,fontWeight:'900',fontSize:13},tourHighlight:{borderWidth:2,borderColor:colors.primary,borderRadius:16,padding:6,margin:-6},eyebrow:{color:colors.green,fontWeight:'800'},title:{fontSize:28,fontWeight:'900',color:colors.ink,marginTop:5},subtitle:{color:colors.muted,fontSize:17,lineHeight:23,marginVertical:8,marginBottom:18},heading:{fontSize:19,fontWeight:'900',color:colors.ink,marginBottom:12},section:{fontSize:20,fontWeight:'900',color:colors.ink,marginTop:24,marginBottom:10},label:{fontWeight:'800',color:colors.ink,marginBottom:8,marginTop:6},input:{minHeight:50,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:12,backgroundColor:'#fff',marginBottom:10,color:colors.ink},options:{gap:8,marginBottom:12},option:{borderWidth:1,borderColor:colors.border,borderRadius:8,padding:11,backgroundColor:'#fff'},optionActive:{borderColor:colors.primary,backgroundColor:colors.softBlue},optionText:{fontWeight:'800',color:colors.ink},optionTextActive:{fontWeight:'900',color:colors.primaryDark},small:{fontSize:13,color:colors.muted,marginTop:3},warning:{color:colors.amber,fontWeight:'700',lineHeight:20,marginBottom:10},actions:{gap:8,marginTop:6},card:{borderWidth:1,borderColor:colors.border,borderRadius:8,backgroundColor:'#fff',padding:14,marginBottom:9},cardTitle:{fontSize:17,fontWeight:'900',color:colors.ink},meta:{color:colors.muted,marginTop:5},error:{color:colors.red,fontWeight:'700',marginBottom:10},success:{color:colors.green,fontWeight:'800',marginBottom:10},testSuccess:{color:colors.green,fontWeight:'900',marginTop:12},testError:{color:colors.red,fontWeight:'800',marginTop:12}});
