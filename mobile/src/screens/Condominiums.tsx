import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext, type FeatureKey } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Condominium = {
  id: string;
  name: string;
  cnpj: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  google_drive_folder_id: string | null;
};

type CondominiumResponse = {
  condominiums: Condominium[];
};

type WhatsAppIntegration = {
  condominium_id: string;
  phone_number_id: string;
  business_account_id: string | null;
  template_name: string;
  template_language: string;
  enabled: boolean;
} | null;

// Mesmo catálogo de externals/api/src/services/featureCatalog.ts — rótulos
// e dependências mantidos em sincronia manualmente.
const FEATURE_CATALOG: Record<FeatureKey, { label: string; dependsOn: FeatureKey[] }> = {
  pessoas: { label: 'Pessoas', dependsOn: [] },
  tipologias: { label: 'Tipologias', dependsOn: [] },
  blocos_unidades: { label: 'Blocos e unidades', dependsOn: [] },
  prestacao_contas: { label: 'Prestação de contas', dependsOn: [] },
  avisos_comunicacao: { label: 'Avisos e comunicação', dependsOn: [] },
  relatos_solicitacoes: { label: 'Relatos e solicitações', dependsOn: [] },
  enquetes: { label: 'Enquetes', dependsOn: ['pessoas', 'blocos_unidades'] },
  reserva_espacos: { label: 'Reserva de espaços', dependsOn: ['pessoas', 'blocos_unidades'] },
  gestao_cobrancas: { label: 'Gestão de cobranças', dependsOn: ['tipologias', 'blocos_unidades'] },
  gestao_debitos: { label: 'Gestão de débitos', dependsOn: ['gestao_cobrancas'] },
  config_enviar_cobrancas: { label: 'Config. e enviar cobranças', dependsOn: ['gestao_cobrancas'] },
  regimento_ocorrencias: { label: 'Regimento e Ocorrências', dependsOn: ['gestao_cobrancas', 'tipologias', 'blocos_unidades'] },
  historico_acordos: { label: 'Histórico de acordos', dependsOn: ['gestao_debitos'] },
  cobrancas_adicionais: { label: 'Cobranças adicionais', dependsOn: ['config_enviar_cobrancas'] },
  painel: { label: 'Painel financeiro', dependsOn: ['gestao_cobrancas'] },
  indicadores_boletos: { label: 'Indicadores de boletos', dependsOn: ['gestao_cobrancas'] },
  nada_consta: { label: 'Nada consta (quitação)', dependsOn: ['gestao_cobrancas'] },
};
const FEATURE_LABELS: Record<FeatureKey, string> = Object.fromEntries(
  Object.entries(FEATURE_CATALOG).map(([key, value]) => [key, value.label]),
) as Record<FeatureKey, string>;

// Nível 0 = não depende de nada; nível N = depende de algo do nível N-1 (no
// máximo). Só serve pra ordenar/indentar a lista por hierarquia — a
// validação de verdade continua sendo feita pela API.
const featureLevel = (key: FeatureKey): number => {
  const deps = FEATURE_CATALOG[key].dependsOn;
  if (!deps.length) return 0;
  return 1 + Math.max(...deps.map(featureLevel));
};

// Pra exibir como árvore (não só agrupado por nível, que deixava itens sem
// relação nenhuma lado a lado): cada item recua embaixo do seu "pai
// principal" — a dependência mais profunda dele. As demais dependências
// (quando existem mais de uma) continuam listadas em "Depende de".
const declaredKeys = Object.keys(FEATURE_CATALOG) as FeatureKey[];
const primaryParent = (key: FeatureKey): FeatureKey | null => {
  const deps = FEATURE_CATALOG[key].dependsOn;
  if (!deps.length) return null;
  return deps.reduce((best, dep) => (featureLevel(dep) > featureLevel(best) ? dep : best), deps[0]);
};
const childrenOf = (key: FeatureKey): FeatureKey[] => declaredKeys.filter(candidate => primaryParent(candidate) === key);

const FEATURE_KEYS: FeatureKey[] = (() => {
  const order: FeatureKey[] = [];
  const visit = (key: FeatureKey) => { order.push(key); childrenOf(key).forEach(visit); };
  declaredKeys.filter(key => !FEATURE_CATALOG[key].dependsOn.length).forEach(visit);
  return order;
})();

const formatCnpj = (value: string) => value.replace(/\D/g, '').slice(0,14).replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\/\d{4})(\d)/,'$1-$2');
const formatCep = (value:string) => value.replace(/\D/g,'').slice(0,8).replace(/^(\d{5})(\d)/,'$1-$2');
const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return digits.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

export default function Condominiums({ navigation }: any) {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [items, setItems] = useState<Condominium[]>([]);
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [postalCode,setPostalCode]=useState('');
  const [isLookingUpPostalCode,setIsLookingUpPostalCode]=useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState('');
  const [googleDriveFolderUrl, setGoogleDriveFolderUrl] = useState('');
  const [driveTesting, setDriveTesting] = useState(false);
  const [driveNotice, setDriveNotice] = useState('');
  const [driveError, setDriveError] = useState('');

  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState('');
  const [whatsappAccessToken, setWhatsappAccessToken] = useState('');
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] = useState('');
  const [whatsappTemplateName, setWhatsappTemplateName] = useState('aviso_condominio');
  const [whatsappTemplateLanguage, setWhatsappTemplateLanguage] = useState('pt_BR');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [whatsappHasStoredToken, setWhatsappHasStoredToken] = useState(false);
  const [whatsappTestPhone, setWhatsappTestPhone] = useState('');
  const [whatsappTesting, setWhatsappTesting] = useState(false);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappNotice, setWhatsappNotice] = useState('');
  const [whatsappError, setWhatsappError] = useState('');

  const [features, setFeatures] = useState<Record<FeatureKey, boolean> | null>(null);
  const [featuresError, setFeaturesError] = useState('');
  const [togglingFeature, setTogglingFeature] = useState<FeatureKey | ''>('');

  const [deleteTarget, setDeleteTarget] = useState<Condominium | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!userToken) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<CondominiumResponse>('/condominiums', userToken);
      setItems(response.condominiums);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar condominios');
    } finally {
      setIsLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
  }, [load]);

  const lookupPostalCode=async()=>{const digits=postalCode.replace(/\D/g,'');if(digits.length!==8){setError('Informe um CEP com 8 dígitos.');return}setIsLookingUpPostalCode(true);setError(null);try{const response=await fetch(`https://viacep.com.br/ws/${digits}/json/`);const data=await response.json();if(!response.ok||data.erro)throw new Error('CEP não encontrado.');setAddress([data.logradouro,data.bairro,data.localidade&&data.uf?`${data.localidade} - ${data.uf}`:data.localidade].filter(Boolean).join(', '))}catch(e){setError(e instanceof Error?e.message:'Não foi possível buscar o CEP.')}finally{setIsLookingUpPostalCode(false)}};

  const save = async () => {
    if (!userToken || !name.trim()) return;
    const wasCreating = !editingId;

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<{ condominium: Condominium }>(editingId ? `/condominiums/${editingId}` : '/condominiums', userToken, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: name.trim(),
          cnpj: cnpj.replace(/\D/g, '') || null,
          address: address.trim() || null,
          phone: phone.replace(/\D/g, '') || null,
          email: email.trim() || null,
          googleDriveFolderUrl: googleDriveFolderUrl.trim() || null,
        }),
      });
      await load();
      if (wasCreating) {
        // Entra direto no modo de edição do condomínio recém-criado, pra
        // revelar os painéis de WhatsApp e Funcionalidades ativas sem
        // precisar procurar o card na lista e clicar em "Editar".
        await editCondominium(response.condominium);
        setSuccess('Condomínio cadastrado. Configure abaixo o WhatsApp e as funcionalidades ativas, se precisar — por padrão, tudo já vem ativado.');
      } else {
        setName('');
        setCnpj('');
        setAddress('');
        setPhone('');
        setEmail('');
        setPostalCode('');
        setGoogleDriveFolderUrl('');
        setEditingId('');
        setSuccess('Condominio atualizado.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar condominio');
    } finally {
      setIsLoading(false);
    }
  };

  const resetWhatsappForm = () => {
    setWhatsappPhoneNumberId('');
    setWhatsappAccessToken('');
    setWhatsappBusinessAccountId('');
    setWhatsappTemplateName('aviso_condominio');
    setWhatsappTemplateLanguage('pt_BR');
    setWhatsappEnabled(true);
    setWhatsappHasStoredToken(false);
    setWhatsappTestPhone('');
    setWhatsappNotice('');
    setWhatsappError('');
  };

  const editCondominium = async (item: Condominium) => {
    setEditingId(item.id);
    setName(item.name);
    setCnpj(item.cnpj ? formatCnpj(item.cnpj) : '');
    setAddress(item.address || '');
    setPhone(item.phone ? formatPhone(item.phone) : '');
    setEmail(item.email || '');
    setGoogleDriveFolderUrl(item.google_drive_folder_id || '');
    setDriveNotice('');
    setDriveError('');
    setError(null);
    setSuccess(null);
    resetWhatsappForm();
    setFeatures(null);
    setFeaturesError('');
    if (!userToken) return;
    try {
      const response = await apiRequest<{ integration: WhatsAppIntegration }>(`/condominiums/${item.id}/whatsapp-integration`, userToken);
      if (response.integration) {
        setWhatsappPhoneNumberId(response.integration.phone_number_id);
        setWhatsappBusinessAccountId(response.integration.business_account_id || '');
        setWhatsappTemplateName(response.integration.template_name);
        setWhatsappTemplateLanguage(response.integration.template_language);
        setWhatsappEnabled(response.integration.enabled);
        setWhatsappHasStoredToken(true);
      }
    } catch {
      // Integração do WhatsApp Business ainda não configurada para este condomínio.
    }
    try {
      const response = await apiRequest<{ features: Record<FeatureKey, boolean> }>(`/condominiums/${item.id}/features`, userToken);
      setFeatures(response.features);
    } catch (e) {
      setFeaturesError(e instanceof Error ? e.message : 'Falha ao carregar as funcionalidades ativas.');
    }
  };

  const toggleFeature = async (feature: FeatureKey, enabled: boolean) => {
    if (!userToken || !editingId || !features) return;
    setTogglingFeature(feature);
    setFeaturesError('');
    try {
      const response = await apiRequest<{ features: Record<FeatureKey, boolean> }>(`/condominiums/${editingId}/features`, userToken, {
        method: 'PATCH',
        body: JSON.stringify({ feature, enabled }),
      });
      setFeatures(response.features);
    } catch (e) {
      setFeaturesError(e instanceof Error ? e.message : 'Falha ao alterar a funcionalidade.');
    } finally {
      setTogglingFeature('');
    }
  };

  const executeDelete = async () => {
    if (!userToken || !deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiRequest(`/condominiums/${deleteTarget.id}`, userToken, { method: 'DELETE' });
      if (editingId === deleteTarget.id) cancelEdit();
      setDeleteTarget(null);
      setSuccess('Condomínio excluído.');
      await load();
    } catch (e) {
      // A API recusa com 409 e explica o que precisa ser removido antes —
      // mantém o diálogo aberto mostrando esse motivo em vez de fechar.
      setDeleteError(e instanceof Error ? e.message : 'Falha ao excluir o condomínio.');
    } finally {
      setDeleting(false);
    }
  };

  const cancelEdit = () => {
    setEditingId('');
    setName('');
    setCnpj('');
    setAddress('');
    setPhone('');
    setEmail('');
    setPostalCode('');
    setGoogleDriveFolderUrl('');
    setDriveNotice('');
    setDriveError('');
    resetWhatsappForm();
    setFeatures(null);
    setFeaturesError('');
  };

  const testGoogleDrive = async () => {
    if (!userToken || !editingId) return;
    setDriveTesting(true);
    setDriveError('');
    setDriveNotice('');
    try {
      const response = await apiRequest<{ ok: boolean; folderName: string }>(`/condominiums/${editingId}/google-drive/test`, userToken, { method: 'POST' });
      setDriveNotice(`Pasta acessível: "${response.folderName}".`);
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : 'Falha ao testar a pasta do Google Drive.');
    } finally {
      setDriveTesting(false);
    }
  };

  const saveWhatsappIntegration = async () => {
    if (!userToken || !editingId || !whatsappPhoneNumberId.trim()) return;
    setWhatsappSaving(true);
    setWhatsappError('');
    setWhatsappNotice('');
    try {
      await apiRequest(`/condominiums/${editingId}/whatsapp-integration`, userToken, {
        method: 'PUT',
        body: JSON.stringify({
          phoneNumberId: whatsappPhoneNumberId.trim(),
          accessToken: whatsappAccessToken.trim() || undefined,
          businessAccountId: whatsappBusinessAccountId.trim() || null,
          templateName: whatsappTemplateName.trim(),
          templateLanguage: whatsappTemplateLanguage.trim(),
          enabled: whatsappEnabled,
        }),
      });
      setWhatsappHasStoredToken(true);
      setWhatsappAccessToken('');
      setWhatsappNotice('Integração do WhatsApp Business salva.');
    } catch (e) {
      setWhatsappError(e instanceof Error ? e.message : 'Falha ao salvar a integração do WhatsApp Business.');
    } finally {
      setWhatsappSaving(false);
    }
  };

  const testWhatsappIntegration = async () => {
    if (!userToken || !editingId || !whatsappTestPhone.trim()) return;
    setWhatsappTesting(true);
    setWhatsappError('');
    setWhatsappNotice('');
    try {
      await apiRequest(`/condominiums/${editingId}/whatsapp-integration/test`, userToken, {
        method: 'POST',
        body: JSON.stringify({ phone: whatsappTestPhone.replace(/\D/g, '') }),
      });
      setWhatsappNotice('Mensagem de teste enviada com sucesso.');
    } catch (e) {
      setWhatsappError(e instanceof Error ? e.message : 'Falha ao enviar a mensagem de teste.');
    } finally {
      setWhatsappTesting(false);
    }
  };

  const tourSteps: TourStep[] = [
    { key: 'form', title: 'Cadastrar ou editar condomínio', description: 'Nome é o único campo obrigatório pra salvar. CNPJ, telefone/WhatsApp e e-mail são opcionais. Preencha o CEP e toque em "Buscar CEP" pra autocompletar o endereço pelo ViaCEP (só preenche se o campo de endereço ainda estiver vazio). O link da pasta do Google Drive é usado na Prestação de Contas: compartilhe a pasta como Editor com laremdia.condominio@gmail.com e cole o link aqui — deixando em branco, os anexos continuam sendo guardados no próprio sistema.' },
    { key: 'whatsapp', title: 'Integração WhatsApp Business', description: 'Só aparece depois de salvar o condomínio (cadastre primeiro, configure depois, ao editar). Liga o envio automático dos comunicados de débito pelo número oficial do condomínio via API oficial da Meta (Cloud API), em vez de abrir o WhatsApp pessoal de quem está operando. Exige Phone Number ID, token de acesso (fica oculto depois de salvo — só digite um novo se quiser trocar), nome e idioma do template já aprovado na Meta, e o toggle "Integração ativa". Depois de salvar, use "Enviar mensagem de teste" pra confirmar que está funcionando.' },
    { key: 'features', title: 'Funcionalidades ativas', description: 'Liga e desliga o que este condomínio pode usar no app — por padrão tudo vem ativado ao cadastrar. Desligar uma funcionalidade some do menu e bloqueia o acesso pra síndico, subsíndico, proprietário e inquilino daquele condomínio. Itens recuados com "↳" dependem da funcionalidade indicada em "Depende de" (ex.: "Gestão de débitos" depende de "Gestão de cobranças"): pra desligar uma funcionalidade de nível mais alto, desligue antes as que dependem dela.' },
    { key: 'list', title: 'Condomínios cadastrados', description: 'Cada card mostra CNPJ, endereço, telefone e e-mail. "Editar" abre o formulário acima já preenchido — e libera os painéis de WhatsApp e Funcionalidades. "Excluir" só funciona se o condomínio não tiver nenhuma pessoa ou registro vinculado; caso contrário a API recusa e explica o que precisa ser removido antes.' },
  ];

  return (
    <>
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}
    >
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Gestao</Text>
          <Text style={styles.title}>Configuracao inicial</Text>
          <Text style={styles.subtitle}>Cadastre os condomínios e depois defina os gestores responsáveis.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('form')} style={[isActive('form') && styles.tourHighlight]}>
      <Panel>
        <Text style={styles.panelTitle}>{editingId ? 'Editar condominio' : 'Novo condominio'}</Text>
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <View>
            <TextInput placeholder="Nome do condominio" value={name} onChangeText={setName} style={styles.input} />
          </View>
          <View>
            <TextInput placeholder="CNPJ (00.000.000/0000-00)" value={cnpj} onChangeText={(value)=>setCnpj(formatCnpj(value))} style={styles.input} keyboardType="number-pad" maxLength={18} />
          </View>
        </FormGrid>
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <View>
            <TextInput placeholder="Telefone / WhatsApp" value={phone} onChangeText={(value)=>setPhone(formatPhone(value))} style={styles.input} keyboardType="phone-pad" maxLength={15} />
          </View>
          <View>
            <TextInput placeholder="E-mail" value={email} onChangeText={setEmail} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
          </View>
        </FormGrid>
        <FormFieldFull>
          <View style={styles.cepRow}><TextInput placeholder="CEP (00000-000)" value={postalCode} onChangeText={(value)=>setPostalCode(formatCep(value))} onBlur={()=>{if(postalCode.replace(/\D/g,'').length===8&&!address)lookupPostalCode()}} style={[styles.input,styles.cepInput]} keyboardType="number-pad" maxLength={9}/><Pressable onPress={lookupPostalCode} disabled={isLookingUpPostalCode} style={[styles.cepButton,isLookingUpPostalCode&&styles.cepButtonDisabled]}><Text style={styles.cepButtonText}>{isLookingUpPostalCode?'Buscando...':'Buscar CEP'}</Text></Pressable></View>
          <TextInput placeholder="Endereço (rua, número, bairro, cidade e UF)" value={address} onChangeText={setAddress} style={styles.input} />
        </FormFieldFull>
        <FormFieldFull>
          <View style={styles.cepRow}>
            <TextInput placeholder="Link da pasta do Google Drive (Prestação de Contas)" value={googleDriveFolderUrl} onChangeText={setGoogleDriveFolderUrl} style={[styles.input,styles.cepInput]} autoCapitalize="none" />
            {editingId && googleDriveFolderUrl.trim() ? (
              <Pressable onPress={testGoogleDrive} disabled={driveTesting} style={[styles.cepButton,driveTesting&&styles.cepButtonDisabled]}><Text style={styles.cepButtonText}>{driveTesting?'Testando...':'Testar pasta'}</Text></Pressable>
            ) : null}
          </View>
          <Text style={styles.whatsappHint}>Cole o link da pasta do Drive do condomínio, compartilhada como Editor com laremdia.condominio@gmail.com. Deixe em branco para continuar guardando os anexos no sistema.</Text>
          {driveError ? <Text style={styles.error}>{driveError}</Text> : null}
          {driveNotice ? <Text style={styles.success}>{driveNotice}</Text> : null}
        </FormFieldFull>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}
        <View style={styles.formActions}>
          <AppButton title={editingId ? 'Salvar condominio' : 'Cadastrar condominio'} onPress={save} disabled={isLoading || !name.trim()} />
          {editingId ? (
            <Pressable onPress={cancelEdit} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancelar edição</Text>
            </Pressable>
          ) : null}
        </View>
      </Panel>
      </View>

      <View ref={registerSection('whatsapp')} style={[isActive('whatsapp') && styles.tourHighlight]}>
      {editingId ? (
        <Panel>
          <Text style={styles.panelTitle}>WhatsApp Business (API oficial)</Text>
          <Text style={styles.whatsappHint}>
            Configure aqui a integração com a API oficial do WhatsApp Business (Meta Cloud API) para que os comunicados de débito sejam enviados automaticamente pelo número oficial do condomínio, em vez de abrir o WhatsApp pessoal de quem está operando o painel. Requer conta Meta Business verificada, número aprovado e um modelo de mensagem (template) homologado.
          </Text>
          <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
            <View>
              <TextInput placeholder="Phone Number ID" value={whatsappPhoneNumberId} onChangeText={setWhatsappPhoneNumberId} style={styles.input} autoCapitalize="none" />
            </View>
            <View>
              <TextInput placeholder={whatsappHasStoredToken ? 'Novo token de acesso (vazio mantém o atual)' : 'Token de acesso (access token)'} value={whatsappAccessToken} onChangeText={setWhatsappAccessToken} style={styles.input} secureTextEntry autoCapitalize="none" />
            </View>
          </FormGrid>
          <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
            <View>
              <TextInput placeholder="Business Account ID (opcional)" value={whatsappBusinessAccountId} onChangeText={setWhatsappBusinessAccountId} style={styles.input} autoCapitalize="none" />
            </View>
            <View>
              <TextInput placeholder="Nome do template aprovado" value={whatsappTemplateName} onChangeText={setWhatsappTemplateName} style={styles.input} autoCapitalize="none" />
            </View>
          </FormGrid>
          <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
            <View>
              <TextInput placeholder="Idioma do template (ex.: pt_BR)" value={whatsappTemplateLanguage} onChangeText={setWhatsappTemplateLanguage} style={styles.input} autoCapitalize="none" />
            </View>
          </FormGrid>
          <Pressable onPress={() => setWhatsappEnabled((current) => !current)} style={styles.whatsappToggleRow}>
            <View style={[styles.checkbox, whatsappEnabled && styles.checkboxChecked]}>
              {whatsappEnabled && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.whatsappToggleLabel}>Integração ativa</Text>
          </Pressable>
          {whatsappError ? <Text style={styles.error}>{whatsappError}</Text> : null}
          {whatsappNotice ? <Text style={styles.success}>{whatsappNotice}</Text> : null}
          <View style={styles.formActions}>
            <AppButton title={whatsappSaving ? 'Salvando...' : 'Salvar integração'} onPress={saveWhatsappIntegration} disabled={whatsappSaving || !whatsappPhoneNumberId.trim()} />
          </View>

          <View style={styles.whatsappTestRow}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <TextInput placeholder="Telefone para teste (com DDD)" value={whatsappTestPhone} onChangeText={(value) => setWhatsappTestPhone(formatPhone(value))} style={styles.input} keyboardType="phone-pad" maxLength={15} />
            </View>
            <AppButton title={whatsappTesting ? 'Enviando teste...' : 'Enviar mensagem de teste'} onPress={testWhatsappIntegration} disabled={whatsappTesting || !whatsappHasStoredToken || !whatsappTestPhone.trim()} variant="secondary" />
          </View>
          {!whatsappHasStoredToken ? <Text style={styles.whatsappHint}>Salve a integração antes de enviar uma mensagem de teste.</Text> : null}
        </Panel>
      ) : null}
      </View>

      <View ref={registerSection('features')} style={[isActive('features') && styles.tourHighlight]}>
      {editingId ? (
        <Panel>
          <Text style={styles.panelTitle}>Funcionalidades ativas</Text>
          <Text style={styles.whatsappHint}>
            Escolha o que este condomínio pode usar no aplicativo. Desligar uma funcionalidade some do menu e bloqueia o acesso pra síndico, subsíndico, proprietário e inquilino desse condomínio. As funcionalidades recuadas abaixo dependem da(s) que aparece(m) em "Depende de" — pra desligar uma funcionalidade de nível mais alto (menos recuada), desligue antes as que dependem dela.
          </Text>
          {featuresError ? <Text style={styles.error}>{featuresError}</Text> : null}
          {!features ? (
            <Text style={styles.whatsappHint}>Carregando...</Text>
          ) : (
            <View style={styles.featuresList}>
              {FEATURE_KEYS.map(key => {
                const enabled = features[key] !== false;
                const deps = FEATURE_CATALOG[key].dependsOn;
                const level = featureLevel(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => toggleFeature(key, !enabled)}
                    disabled={togglingFeature !== ''}
                    style={[
                      styles.featureRow,
                      !enabled && styles.featureRowOff,
                      level > 0 && styles.featureRowNested,
                      { marginLeft: level * 22 },
                    ]}
                  >
                    <View style={styles.featureRowMain}>
                      <Text style={[styles.featureLabel, !enabled && styles.featureLabelOff]}>
                        {level > 0 ? `↳ ${FEATURE_LABELS[key]}` : FEATURE_LABELS[key]}
                      </Text>
                      {deps.length ? (
                        <Text style={styles.featureDeps}>Depende de: {deps.map(dep => FEATURE_LABELS[dep]).join(', ')}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.featureStatus, enabled ? styles.featureStatusOn : styles.featureStatusOff]}>
                      {togglingFeature === key ? '...' : enabled ? 'Ativa' : 'Inativa'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Panel>
      ) : null}
      </View>

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Cadastrados</Text>
        <Text style={styles.counter}>{items.length}</Text>
      </View>

      {items.length === 0 ? (
        <EmptyState title="Nenhum condominio ainda" description="Quando voce cadastrar, ele aparecera nesta lista." />
      ) : (
        <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardAccent} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <View style={styles.cardActions}>
                    <Pressable onPress={() => editCondominium(item)} disabled={isLoading} style={styles.editButton}>
                      <Text style={styles.editText}>Editar</Text>
                    </Pressable>
                    <Pressable onPress={() => { setDeleteError(''); setDeleteTarget(item); }} disabled={isLoading} style={styles.deleteButton}>
                      <Text style={styles.deleteButtonText}>Excluir</Text>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.cardId}>ID: {item.id}</Text>
                <Text style={styles.cardLine}>{item.cnpj ? formatCnpj(item.cnpj) : 'CNPJ não informado'}</Text>
                <Text style={styles.cardLine}>{item.address || 'Endereco nao informado'}</Text>
                <Text style={styles.cardLine}>{item.phone ? formatPhone(item.phone) : 'Telefone/WhatsApp não informado'}</Text>
                <Text style={styles.cardLine}>{item.email || 'E-mail não informado'}</Text>
              </View>
            </View>
          ))}
        </CardGrid>
      )}
      </View>
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    <AppDialog
      visible={!!deleteTarget}
      title="Excluir condomínio"
      message={deleteError || `Excluir "${deleteTarget?.name}" definitivamente? Só é possível quando o condomínio não tem nenhuma pessoa ou registro cadastrado.`}
      tone={deleteError ? 'error' : 'info'}
      confirmLabel={deleteError ? 'Entendi' : deleting ? 'Excluindo...' : 'Sim, excluir'}
      cancelLabel={deleteError ? undefined : 'Cancelar'}
      onConfirm={deleteError ? () => { setDeleteTarget(null); setDeleteError(''); } : executeDelete}
      onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(''); } }}
      scrollable
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', letterSpacing: 0, marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginBottom: 12 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    backgroundColor: '#fff',
    color: colors.ink,
  },
  cepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cepInput: { flex: 1 },
  cepButton: { minHeight: 52, borderRadius: 8, backgroundColor: colors.primary, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  cepButtonDisabled: { opacity: .6 },
  cepButtonText: { color: '#fff', fontWeight: '900' },
  error: { color: colors.red, marginBottom: 10 },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  cancelButton: { paddingVertical: 10 },
  cancelText: { color: colors.muted, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  counter: { color: colors.primary, fontWeight: '900' },
  list: {},
  card: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardAccent: { width: 5, backgroundColor: colors.green },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900' },
  cardActions: { flexDirection: 'row', gap: 8 },
  editButton: { borderWidth: 1, borderColor: '#bfd1ea', backgroundColor: colors.softBlue, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  editText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  deleteButton: { borderWidth: 1, borderColor: '#f0b8b8', backgroundColor: '#fff3f3', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  deleteButtonText: { color: colors.red, fontSize: 14, fontWeight: '900' },
  cardId: { color: colors.primaryDark, marginTop: 4, fontSize: 15, fontWeight: '800' },
  cardLine: { color: colors.muted, marginTop: 4, lineHeight: 21 },
  bankBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  bankTitle: { color: colors.ink, fontWeight: '900', marginBottom: 5 },
  bankLinked: { color: colors.green, fontWeight: '800', marginBottom: 9 },
  bankMissing: { color: colors.amber, fontWeight: '800', marginBottom: 9 },
  bankHelp: { color: colors.muted, lineHeight: 20 },
  bankOptions: { gap: 6, marginBottom: 10 },
  bankOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  bankOptionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  bankOptionText: { color: colors.ink, fontWeight: '700' },
  bankOptionTextActive: { color: colors.primaryDark, fontWeight: '900' },
  success: { color: colors.green, marginBottom: 10, fontWeight: '800' },
  whatsappHint: { color: colors.muted, lineHeight: 20, marginBottom: 14 },
  whatsappToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  whatsappToggleLabel: { color: colors.ink, fontWeight: '800' },
  whatsappTestRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: colors.border, borderRadius: 5, justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: '#fff', fontWeight: '900', fontSize: 13 },
  featuresList: { gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.softGreen },
  featureRowOff: { backgroundColor: '#f7f7f8' },
  featureRowNested: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  featureRowMain: { flex: 1, gap: 3 },
  featureLabel: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  featureLabelOff: { color: colors.muted },
  featureDeps: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  featureStatus: { fontSize: 13, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  featureStatusOn: { color: colors.green, backgroundColor: '#fff' },
  featureStatusOff: { color: colors.muted, backgroundColor: '#eee' },
});
