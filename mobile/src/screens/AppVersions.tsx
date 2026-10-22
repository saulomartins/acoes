import React, { useCallback, useContext, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, Panel, TextField } from '../ui/components';
import { colors } from '../ui/theme';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';
import TourButton from '../ui/TourButton';

// Versões do app nas lojas (admin_geral). O app Android/iOS lê estes valores
// ao abrir (GET /app-version/:plataforma) e mostra "Nova versão disponível"
// ou exige a atualização — ver mobile/src/ui/AppUpdateNotice.tsx.

type Platform = 'android' | 'ios';
type StoreVersion = { platform: Platform; latestVersion: string | null; minVersion: string | null; storeUrl: string | null; releaseNotes: string | null; updatedAt: string };
type Form = { latestVersion: string; minVersion: string; storeUrl: string; releaseNotes: string };

const platformLabel: Record<Platform, string> = { android: 'Android (Google Play)', ios: 'iPhone (App Store)' };
const emptyForm: Form = { latestVersion: '', minVersion: '', storeUrl: '', releaseNotes: '' };
const toForm = (version?: StoreVersion): Form => version
  ? { latestVersion: version.latestVersion || '', minVersion: version.minVersion || '', storeUrl: version.storeUrl || '', releaseNotes: version.releaseNotes || '' }
  : emptyForm;

export default function AppVersions() {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [forms, setForms] = useState<Record<Platform, Form>>({ android: emptyForm, ios: emptyForm });
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Platform, string>>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true); setError(null);
    try {
      const response = await apiRequest<{ versions: StoreVersion[] }>('/app-version', userToken);
      const byPlatform = (platform: Platform) => response.versions.find(item => item.platform === platform);
      setForms({ android: toForm(byPlatform('android')), ios: toForm(byPlatform('ios')) });
      setUpdatedAt({ android: byPlatform('android')?.updatedAt, ios: byPlatform('ios')?.updatedAt });
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar as versões'); }
    finally { setIsLoading(false); }
  }, [userToken]);

  useEffect(() => { void load(); }, [load]);

  const setField = (platform: Platform, field: keyof Form, value: string) => setForms(current => ({ ...current, [platform]: { ...current[platform], [field]: value } }));

  const save = async (platform: Platform) => {
    if (!userToken) return;
    setSaving(platform);
    try {
      const response = await apiRequest<{ version: StoreVersion }>(`/app-version/${platform}`, userToken, { method: 'PUT', body: JSON.stringify(forms[platform]) });
      setForms(current => ({ ...current, [platform]: toForm(response.version) }));
      setUpdatedAt(current => ({ ...current, [platform]: response.version.updatedAt }));
      setDialog({ title: 'Versão salva', message: response.version.latestVersion ? `Quem estiver com uma versão anterior à ${response.version.latestVersion} no ${platformLabel[platform]} verá o aviso ao abrir o app.` : 'Sem versão informada, o app não mostra nenhum aviso nesta plataforma.', tone: 'success' });
    } catch (e) {
      setDialog({ title: 'Não foi possível salvar', message: e instanceof Error ? e.message : 'Tente novamente.', tone: 'error' });
    } finally { setSaving(null); }
  };

  const tourSteps: TourStep[] = [
    { key: 'android', title: 'Versão mais recente', description: 'Depois que a nova versão for aprovada e estiver disponível na loja, informe o número dela (ex.: 1.7.4). Quem tiver uma versão anterior vê "Nova versão disponível" ao abrir o app e pode adiar — o aviso volta depois de 3 dias.' },
    { key: 'ios', title: 'Versão mínima obrigatória', description: 'Use só quando uma versão antiga não puder mais ser usada. Abaixo dela, o aviso não fecha até o morador atualizar. Deixe vazio para nunca obrigar.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>ADMINISTRAÇÃO</Text>
          <Text style={styles.title}>Versões do app</Text>
          <Text style={styles.subtitle}>Avise os moradores quando houver versão nova do aplicativo na Play Store ou na App Store. Atualize aqui só depois que a versão já estiver disponível na loja.</Text>
        </View>
        <TourButton onPress={openTour} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(['android', 'ios'] as Platform[]).map(platform => (
        <View key={platform} ref={registerSection(platform)} style={[styles.section, isActive(platform) && styles.tourHighlight]}>
          <Panel>
            <Text style={styles.panelTitle}>{platformLabel[platform]}</Text>
            {updatedAt[platform] ? <Text style={styles.meta}>Atualizado em {new Date(updatedAt[platform]!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</Text> : null}
            <View style={styles.row}>
              <View style={styles.col}>
                <TextField label="Versão mais recente na loja" hint="Ex.: 1.7.4. Vazio = nenhum aviso." value={forms[platform].latestVersion} onChangeText={value => setField(platform, 'latestVersion', value)} placeholder="1.7.4" autoCapitalize="none" />
              </View>
              <View style={styles.col}>
                <TextField label="Versão mínima obrigatória" hint="Abaixo dela o app exige atualizar. Vazio = nunca obrigar." value={forms[platform].minVersion} onChangeText={value => setField(platform, 'minVersion', value)} placeholder="opcional" autoCapitalize="none" />
              </View>
            </View>
            <TextField label="Link do app na loja" hint="Para onde o botão Atualizar leva." value={forms[platform].storeUrl} onChangeText={value => setField(platform, 'storeUrl', value)} placeholder="https://" autoCapitalize="none" />
            <TextField label="Novidades (opcional)" hint="Aparece no aviso. Até 500 caracteres." value={forms[platform].releaseNotes} onChangeText={value => setField(platform, 'releaseNotes', value)} multiline maxLength={500} style={styles.notes} />
            <AppButton title={saving === platform ? 'Salvando...' : 'Salvar'} loading={saving === platform} onPress={() => save(platform)} />
          </Panel>
        </View>
      ))}
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone={dialog?.tone} onClose={() => setDialog(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', marginLeft: 'auto', marginRight: 'auto', padding: 24, paddingBottom: 40, backgroundColor: colors.background, maxWidth: 900 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  error: { color: colors.red, marginBottom: 16, fontWeight: '800' },
  section: { marginBottom: 18 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  col: { flexGrow: 1, flexBasis: 240 },
  notes: { minHeight: 70, textAlignVertical: 'top' },
});
