import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { apiFormUpload, apiRequest, downloadAuthenticated } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel } from '../ui/components';
import { CardGrid, FormGrid } from '../ui/grid';
import { colors } from '../ui/theme';

type MobileRelease = {
  id:string; platform:'android'|'ios'; version:string; buildNumber:string; releaseNotes:string|null;
  externalUrl:string|null; hasFile:boolean; fileSize:number|null; publishedAt:string;
};
type Latest = { android:MobileRelease|null; ios:MobileRelease|null };
const platformName = (value:'android'|'ios') => value === 'android' ? 'Android' : 'iPhone e iPad';
const formatBytes = (value:number|null) => value ? `${(value / 1024 / 1024).toFixed(1)} MB` : 'Link externo';
const formatDate = (value:string) => new Date(value).toLocaleString('pt-BR');

export default function MobileReleases() {
  const { user, userToken } = useContext(AuthContext);
  const admin = user?.role === 'admin_geral';
  const [latest,setLatest]=useState<Latest>({android:null,ios:null});
  const [history,setHistory]=useState<MobileRelease[]>([]);
  const [platform,setPlatform]=useState<'android'|'ios'>('android');
  const [version,setVersion]=useState(''); const [buildNumber,setBuildNumber]=useState('');
  const [releaseNotes,setReleaseNotes]=useState(''); const [externalUrl,setExternalUrl]=useState('');
  const [file,setFile]=useState<DocumentPicker.DocumentPickerAsset|null>(null);
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');

  const load=useCallback(async()=>{if(!userToken)return;setLoading(true);setError('');try{
    const current=await apiRequest<Latest>('/mobile-releases/latest',userToken);setLatest(current);
    if(admin){const all=await apiRequest<{releases:MobileRelease[]}>('/mobile-releases',userToken);setHistory(all.releases)}
  }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao carregar versões.')}finally{setLoading(false)}},[admin,userToken]);
  useEffect(()=>{load()},[load]);

  const chooseApk=async()=>{const result=await DocumentPicker.getDocumentAsync({type:'application/vnd.android.package-archive',copyToCacheDirectory:true});if(!result.canceled)setFile(result.assets[0])};
  const publish=async()=>{if(!userToken)return;setLoading(true);setError('');setNotice('');try{
    const webFile = file && 'file' in file ? file.file as File | undefined : undefined;
    await apiFormUpload('/mobile-releases',userToken,{platform,version:version.trim(),buildNumber:buildNumber.trim(),releaseNotes:releaseNotes.trim(),externalUrl:externalUrl.trim()},webFile||file||undefined);
    setNotice(`${platformName(platform)} ${version.trim()} publicado como versão atual.`);
    setVersion('');setBuildNumber('');setReleaseNotes('');setExternalUrl('');setFile(null);await load();
  }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao publicar versão.')}finally{setLoading(false)}};
  const install=async(item:MobileRelease)=>{if(!userToken)return;setError('');try{
    if(item.platform==='ios'){if(!item.externalUrl)throw new Error('Link para iOS indisponível.');await Linking.openURL(item.externalUrl);return}
    if(item.hasFile){await downloadAuthenticated(`/mobile-releases/${item.id}/download`,userToken,`lar-em-dia-${item.version}.apk`);return}
    if(item.externalUrl)await Linking.openURL(item.externalUrl);
  }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível baixar o instalador.')}};
  const activate=async(id:string)=>{if(!userToken)return;await apiRequest(`/mobile-releases/${id}/activate`,userToken,{method:'PATCH'});setNotice('Versão definida como atual.');await load()};
  const remove=async(id:string)=>{if(!userToken)return;await apiRequest(`/mobile-releases/${id}`,userToken,{method:'DELETE'});setNotice('Versão removida.');await load()};

  const releaseCard=(item:MobileRelease|null,kind:'android'|'ios')=><View style={s.releaseCard}>
    <View style={s.platformBadge}><Text style={s.platformBadgeText}>{kind==='android'?'ANDROID':'iOS'}</Text></View>
    <Text style={s.releaseTitle}>{item?`Lar em Dia ${item.version}`:'Ainda não publicado'}</Text>
    {item?<><Text style={s.meta}>Build {item.buildNumber} · {formatBytes(item.fileSize)}</Text><Text style={s.meta}>Publicado em {formatDate(item.publishedAt)}</Text>{item.releaseNotes?<Text style={s.notes}>{item.releaseNotes}</Text>:null}<AppButton title={kind==='android'?'Baixar APK':'Abrir instalação iOS'} onPress={()=>install(item)}/></>:<Text style={s.notes}>A versão atual aparecerá aqui assim que for publicada.</Text>}
  </View>;

  return <ScrollView contentContainerStyle={s.container}>
    <Text style={s.eyebrow}>Aplicativo móvel</Text><Text style={s.title}>Instalar Lar em Dia</Text>
    <Text style={s.subtitle}>Baixe sempre a versão mais recente e oficial para seu aparelho.</Text>
    {error?<Text style={s.error}>{error}</Text>:null}{notice?<Text style={s.success}>{notice}</Text>:null}
    <CardGrid columns={{mobile:1,tablet:2,desktop:2}}>{releaseCard(latest.android,'android')}{releaseCard(latest.ios,'ios')}</CardGrid>
    {admin?<><Text style={s.section}>Publicar nova versão</Text><Panel>
      <View style={s.platforms}>{(['android','ios'] as const).map(item=><Pressable key={item} onPress={()=>{setPlatform(item);setFile(null)}} style={[s.platformOption,platform===item&&s.platformOptionActive]}><Text style={platform===item?s.platformTextActive:s.platformText}>{platformName(item)}</Text></Pressable>)}</View>
      <FormGrid columns={{mobile:1,tablet:2,desktop:2}}>
        <View><Text style={s.label}>Versão</Text><TextInput value={version} onChangeText={setVersion} placeholder="Ex.: 1.1.0" style={s.input}/></View>
        <View><Text style={s.label}>Número do build</Text><TextInput value={buildNumber} onChangeText={setBuildNumber} placeholder="Ex.: 4" keyboardType="number-pad" style={s.input}/></View>
      </FormGrid>
      <Text style={s.label}>Notas da versão</Text><TextInput value={releaseNotes} onChangeText={setReleaseNotes} placeholder="Principais melhorias desta versão" multiline style={[s.input,s.textarea]}/>
      <Text style={s.label}>{platform==='ios'?'Link da App Store ou TestFlight':'Link externo opcional'}</Text><TextInput value={externalUrl} onChangeText={setExternalUrl} placeholder="https://..." autoCapitalize="none" style={s.input}/>
      {platform==='android'?<><AppButton title={file?`APK selecionado: ${file.name}`:'Selecionar arquivo APK'} onPress={chooseApk} variant="secondary"/><Text style={s.hint}>O APK fica armazenado no volume persistente de produção (máximo 150 MB).</Text></>:<Text style={s.hint}>No iOS, publique pelo TestFlight/App Store e informe o link oficial.</Text>}
      <AppButton title={loading?'Publicando...':'Publicar como versão atual'} onPress={publish} disabled={loading||!version.trim()||!buildNumber.trim()||(platform==='android'&&!file&&!externalUrl.trim())||(platform==='ios'&&!externalUrl.trim())}/>
    </Panel>
    <Text style={s.section}>Histórico de versões</Text>{history.length?<CardGrid columns={{mobile:1,tablet:2,desktop:3}}>{history.map(item=><View key={item.id} style={s.historyCard}><Text style={s.historyTitle}>{platformName(item.platform)} {item.version}</Text><Text style={s.meta}>Build {item.buildNumber} · {formatDate(item.publishedAt)}</Text><Text style={s.notes}>{item.releaseNotes||'Sem notas de versão.'}</Text><View style={s.actions}><AppButton title="Definir como atual" onPress={()=>activate(item.id)} variant="secondary"/><AppButton title="Excluir" onPress={()=>remove(item.id)} variant="secondary"/></View></View>)}</CardGrid>:<EmptyState title="Nenhuma versão cadastrada" description="Publique a primeira versão acima."/>}</>:null}
    {Platform.OS!=='web'?<Text style={s.hint}>Esta central também pode ser acessada pela versão web.</Text>:null}
  </ScrollView>;
}

const s=StyleSheet.create({
  container:{width:'100%',alignSelf:'center',padding:24,paddingBottom:60,backgroundColor:colors.background},eyebrow:{color:colors.green,fontWeight:'900',textTransform:'uppercase',letterSpacing:.8},
  title:{fontSize:30,fontWeight:'900',color:colors.ink,marginTop:5},subtitle:{color:colors.muted,fontSize:17,lineHeight:24,marginTop:7,marginBottom:20},section:{fontSize:21,fontWeight:'900',color:colors.ink,marginTop:28,marginBottom:12},
  releaseCard:{borderWidth:1,borderColor:colors.border,borderRadius:16,backgroundColor:'#fff',padding:20,gap:9},platformBadge:{alignSelf:'flex-start',backgroundColor:colors.softBlue,borderRadius:99,paddingHorizontal:10,paddingVertical:5},
  platformBadgeText:{color:colors.primaryDark,fontWeight:'900',fontSize:12},releaseTitle:{fontSize:22,fontWeight:'900',color:colors.ink},meta:{color:colors.muted,fontSize:13},notes:{color:colors.ink,lineHeight:20,marginVertical:5},
  platforms:{flexDirection:'row',gap:8,marginBottom:16},platformOption:{flex:1,borderWidth:1,borderColor:colors.border,borderRadius:10,padding:13,backgroundColor:'#fff'},platformOptionActive:{borderColor:colors.primary,backgroundColor:colors.softBlue},
  platformText:{textAlign:'center',fontWeight:'800',color:colors.ink},platformTextActive:{textAlign:'center',fontWeight:'900',color:colors.primaryDark},label:{fontWeight:'800',color:colors.ink,marginBottom:7},
  input:{minHeight:50,borderWidth:1,borderColor:colors.border,borderRadius:9,paddingHorizontal:12,backgroundColor:'#fff',marginBottom:12,color:colors.ink},textarea:{minHeight:95,paddingTop:12,textAlignVertical:'top'},
  hint:{color:colors.muted,fontSize:13,lineHeight:19,marginVertical:8},historyCard:{borderWidth:1,borderColor:colors.border,borderRadius:12,backgroundColor:'#fff',padding:15},historyTitle:{fontSize:17,fontWeight:'900',color:colors.ink},
  actions:{gap:8,marginTop:8},error:{color:colors.red,fontWeight:'800',marginBottom:10},success:{color:colors.green,fontWeight:'800',marginBottom:10},
});
