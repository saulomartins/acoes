import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, TextField } from '../ui/components';
import { colors } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type Condominium = { id: string; name: string; cnpj: string | null; address: string | null };
type UnitType = { id: string; name: string; fee_cents: number; description: string | null; active: boolean };

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const maskCurrency = (value: string) => formatCurrency(Number(value.replace(/\D/g, '') || 0));
const currencyToCents = (value: string) => {
  const amount = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

export default function UnitTypes({ navigation }: any) {
  const { user, userToken } = useContext(AuthContext);
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [condominiumId, setCondominiumId] = useState('');
  const [items, setItems] = useState<UnitType[]>([]);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [dialog, setDialog] = useState<{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void } | null>(null);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const tourSteps: TourStep[] = [
    { key: 'types', title: 'Tipologias cadastradas', description: 'Cada card é um tipo de apartamento (ex.: "2 quartos", "Cobertura") com o valor mensal padrão cobrado das unidades daquele tipo. "Editar" troca o card por campos de nome, valor e descrição pra ajustar na hora. "Excluir" só funciona se nenhuma unidade ou morador estiver usando essa tipologia no momento — se estiver em uso, a exclusão é bloqueada.' },
    { key: 'form', title: 'Nova tipologia', description: 'Cadastre o nome do tipo de apartamento e o valor mensal padrão (a taxa condominial que será usada nos boletos das unidades desse tipo). A descrição é opcional. Esse valor é o que alimenta automaticamente a tela de Configuração e emissão de cobranças ao montar os boletos de cada unidade.' },
  ];

  const loadTypes = useCallback(async (targetId?: string) => {
    if (!userToken) return;
    if (user?.role === 'admin_geral' && !targetId) { setItems([]); return; }
    const path = user?.role === 'admin_geral' ? `/unit-types?condominiumId=${encodeURIComponent(targetId || '')}` : '/unit-types';
    const response = await apiRequest<{ unitTypes: UnitType[] }>(path, userToken);
    setItems(response.unitTypes);
  }, [user?.role, userToken]);

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true); setError(null);
    try {
      if (user?.role === 'admin_geral') {
        const response = await apiRequest<{ condominiums: Condominium[] }>('/condominiums', userToken);
        setCondominiums(response.condominiums);
        const target = condominiumId || (response.condominiums.length === 1 ? response.condominiums[0].id : '');
        if (target) { setCondominiumId(target); await loadTypes(target); }
      } else {
        await loadTypes();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar tipologias'); }
    finally { setIsLoading(false); }
  }, [condominiumId, loadTypes, user?.role, userToken]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const feeCents = currencyToCents(fee);
    if (!userToken || !name.trim() || feeCents <= 0) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      await apiRequest('/unit-types', userToken, { method: 'POST', body: JSON.stringify({ condominiumId: user?.role === 'admin_geral' ? condominiumId : undefined, name: name.trim(), feeCents, description: description.trim() || null }) });
      setName(''); setFee(''); setDescription(''); setSuccess('Tipologia e valor salvos.');
      await loadTypes(condominiumId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao cadastrar tipologia'); }
    finally { setIsLoading(false); }
  };

  const startEdit = (item: UnitType) => {
    setEditingId(item.id); setEditName(item.name); setEditFee(formatCurrency(item.fee_cents)); setEditDescription(item.description || '');
    setError(null); setSuccess(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditName(''); setEditFee(''); setEditDescription(''); };

  const saveEdit = async () => {
    const feeCents = currencyToCents(editFee);
    if (!userToken || !editingId || !editName.trim() || feeCents <= 0) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      await apiRequest(`/unit-types/${editingId}`, userToken, { method: 'PATCH', body: JSON.stringify({ name: editName.trim(), feeCents, description: editDescription.trim() || null }) });
      setSuccess('Tipologia atualizada.'); cancelEdit();
      await loadTypes(condominiumId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao atualizar tipologia'); }
    finally { setIsLoading(false); }
  };

  const removeType = async (item: UnitType) => {
    if (!userToken) return;
    setIsLoading(true); setError(null); setSuccess(null);
    try {
      await apiRequest(`/unit-types/${item.id}`, userToken, { method: 'DELETE' });
      setSuccess('Tipologia excluída.');
      await loadTypes(condominiumId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao excluir tipologia'); }
    finally { setIsLoading(false); }
  };

  const confirmDelete = (item: UnitType) => {
    setDialog({
      title: 'Excluir tipologia',
      message: `Excluir "${item.name}"? Só é possível excluir tipologias que não estejam em uso por nenhuma unidade ou morador.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Cancelar',
      onConfirm: () => { setDialog(null); removeType(item); },
    });
  };

  return <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Configuração de cobranças</Text>
          <Text style={styles.title}>Tipologias e valores</Text>
          <Text style={styles.subtitle}>Defina os tipos de apartamento e o valor mensal padrão cobrado de cada unidade.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      {user?.role === 'admin_geral' ? <FormFieldFull><View style={styles.panel}><Text style={styles.panelTitle}>Condomínio</Text>{condominiums.map((item) => <Pressable key={item.id} onPress={async () => { setCondominiumId(item.id); await loadTypes(item.id); }} style={[styles.option, condominiumId === item.id && styles.optionActive]}><Text style={[styles.optionText, condominiumId === item.id && styles.optionTextActive]}>{item.name}</Text></Pressable>)}</View></FormFieldFull> : null}

      <View ref={registerSection('types')} style={[isActive('types') && styles.tourHighlight]}>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Tipologias cadastradas</Text><Text style={styles.counter}>{items.length}</Text></View>
      {items.length === 0 ? <EmptyState title="Nenhuma tipologia" description="Cadastre o primeiro tipo de apartamento e seu valor mensal." /> : <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>{items.map((item) => editingId === item.id ? (
        <View key={item.id} style={[styles.card, styles.cardEditing]}>
          <TextField label="Nome da tipologia" required placeholder="Ex.: Área privativa" value={editName} onChangeText={setEditName} />
          <TextField label="Valor mensal" required placeholder="R$ 0,00" value={editFee} onChangeText={(value) => setEditFee(maskCurrency(value))} keyboardType="number-pad" />
          <TextField label="Descrição" placeholder="Opcional" value={editDescription} onChangeText={setEditDescription} />
          <View style={styles.cardActions}>
            <Pressable onPress={cancelEdit} style={styles.linkButton}><Text style={styles.linkButtonText}>Cancelar</Text></Pressable>
            <AppButton title="Salvar" onPress={saveEdit} disabled={isLoading || !editName.trim() || currencyToCents(editFee) <= 0} />
          </View>
        </View>
      ) : (
        <View key={item.id} style={[styles.card, styles.cardStacked]}>
          <View style={styles.cardRow}>
            <View style={styles.grow}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardDescription}>{item.description || 'Sem descrição'}</Text></View>
            <Text style={styles.value}>{formatCurrency(item.fee_cents)}</Text>
          </View>
          <View style={styles.cardActions}>
            <Pressable onPress={() => startEdit(item)} style={styles.linkButton}><Text style={styles.linkButtonText}>Editar</Text></Pressable>
            <Pressable onPress={() => confirmDelete(item)} style={styles.linkButton}><Text style={styles.linkButtonTextDanger}>Excluir</Text></Pressable>
          </View>
        </View>
      ))}</CardGrid>}
      </View>

      <View ref={registerSection('form')} style={[styles.panel, styles.formPanel, isActive('form') && styles.tourHighlight]}>
        <Text style={styles.panelTitle}>Nova tipologia</Text>
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <TextField label="Nome da tipologia" required placeholder="Ex.: Apartamento com área privativa" value={name} onChangeText={setName} />
          <TextField label="Valor mensal" required placeholder="R$ 0,00" hint="Taxa condominial padrão das unidades deste tipo." value={fee} onChangeText={(value) => setFee(maskCurrency(value))} keyboardType="number-pad" />
          <TextField label="Descrição" placeholder="Opcional" value={description} onChangeText={setDescription} />
        </FormGrid>
        {error ? <Text style={styles.error}>{error}</Text> : null}{success ? <Text style={styles.success}>{success}</Text> : null}
        <AppButton title="Salvar tipologia e valor" onPress={create} disabled={isLoading || (user?.role === 'admin_geral' && !condominiumId) || !name.trim() || currencyToCents(fee) <= 0} />
      </View>

      <AppDialog visible={Boolean(dialog)} title={dialog?.title || ''} message={dialog?.message || ''} tone="error" confirmLabel={dialog?.confirmLabel} cancelLabel={dialog?.cancelLabel} onConfirm={dialog?.onConfirm} onClose={() => setDialog(null)} />
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
  </>;
}

const styles = StyleSheet.create({
  container: { width: '100%', marginLeft: 'auto', marginRight: 'auto', padding: 24, paddingBottom: 40, backgroundColor: colors.background }, grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' }, subtitle: { color: colors.muted, fontSize: 17, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  panel: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, marginBottom: 16 }, panelTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: 12 },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, marginBottom: 8 }, optionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue }, optionText: { color: colors.ink, fontWeight: '800' }, optionTextActive: { color: colors.primaryDark },
  error: { color: colors.red, marginBottom: 10 }, success: { color: colors.green, marginBottom: 10, fontWeight: '800' }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, counter: { color: colors.primary, fontWeight: '900' }, list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16 }, cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, cardDescription: { color: colors.muted, fontSize: 15, marginTop: 4 }, value: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  cardStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 }, cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardEditing: { flexDirection: 'column', alignItems: 'stretch' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  linkButton: { paddingVertical: 6, paddingHorizontal: 4 }, linkButtonText: { color: colors.primaryDark, fontWeight: '800' }, linkButtonTextDanger: { color: colors.red, fontWeight: '800' },
  formPanel: { marginTop: 18 },
});
