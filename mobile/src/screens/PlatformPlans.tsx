import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, EmptyState, Panel , TextField} from '../ui/components';
import { colors } from '../ui/theme';
import { FormGrid, FormFieldFull, CardGrid } from '../ui/grid';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type PlanType = 'per_active_user' | 'tiered_bracket';
type ActiveUserMetric = 'login_enabled' | 'registered';

type PlanTier = { id?: string; min_active_users: number; max_active_users: number | null; price_cents: number };

type PlatformPlan = {
  id: string;
  name: string;
  plan_type: PlanType;
  price_per_active_user_cents: number | null;
  minimum_price_cents: number;
  active: boolean;
  active_user_metric: ActiveUserMetric;
  tiers: PlanTier[];
};

type TierForm = { minActiveUsers: string; maxActiveUsers: string; price: string };

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const maskCurrency = (value: string) => formatCurrency(Number(value.replace(/\D/g, '') || 0));
const currencyToCents = (value: string) => {
  const amount = Number(value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

const emptyTier = (minActiveUsers = 0): TierForm => ({ minActiveUsers: String(minActiveUsers), maxActiveUsers: '', price: '' });

export default function PlatformPlans() {
  const { userToken } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const [items, setItems] = useState<PlatformPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState('');
  const [name, setName] = useState('');
  const [planType, setPlanType] = useState<PlanType>('per_active_user');
  const [pricePerActiveUser, setPricePerActiveUser] = useState('');
  const [minimumPrice, setMinimumPrice] = useState('');
  const [tiers, setTiers] = useState<TierForm[]>([emptyTier()]);
  const [active, setActive] = useState(true);
  const [activeUserMetric, setActiveUserMetric] = useState<ActiveUserMetric>('registered');

  const load = useCallback(async () => {
    if (!userToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ plans: PlatformPlan[] }>('/platform-plans', userToken);
      setItems(response.plans);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar planos.');
    } finally {
      setIsLoading(false);
    }
  }, [userToken]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEditingId('');
    setName('');
    setPlanType('per_active_user');
    setPricePerActiveUser('');
    setMinimumPrice('');
    setTiers([emptyTier()]);
    setActive(true);
    setActiveUserMetric('registered');
    setError(null);
    setSuccess(null);
  };

  const editPlan = (plan: PlatformPlan) => {
    setEditingId(plan.id);
    setName(plan.name);
    setPlanType(plan.plan_type);
    setPricePerActiveUser(plan.price_per_active_user_cents ? formatCurrency(plan.price_per_active_user_cents) : '');
    setMinimumPrice(plan.minimum_price_cents ? formatCurrency(plan.minimum_price_cents) : '');
    setActive(plan.active);
    setActiveUserMetric(plan.active_user_metric);
    setTiers(
      plan.tiers.length
        ? plan.tiers.map((tier) => ({
            minActiveUsers: String(tier.min_active_users),
            maxActiveUsers: tier.max_active_users === null ? '' : String(tier.max_active_users),
            price: formatCurrency(tier.price_cents),
          }))
        : [emptyTier()],
    );
    setError(null);
    setSuccess(null);
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const nextMin = last?.maxActiveUsers ? Number(last.maxActiveUsers) + 1 : 0;
    setTiers([...tiers, emptyTier(nextMin)]);
  };

  const removeTier = (index: number) => {
    if (tiers.length <= 1) return;
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const updateTier = (index: number, patch: Partial<TierForm>) => {
    setTiers(tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };

  const isValid =
    name.trim().length >= 2 &&
    (planType === 'per_active_user'
      ? currencyToCents(pricePerActiveUser) > 0
      : tiers.every((tier) => tier.minActiveUsers !== '' && currencyToCents(tier.price) > 0));

  const save = async () => {
    if (!userToken || !isValid) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), planType, active, activeUserMetric };
      if (planType === 'per_active_user') {
        body.pricePerActiveUserCents = currencyToCents(pricePerActiveUser);
        body.minimumPriceCents = currencyToCents(minimumPrice);
      } else {
        body.tiers = tiers.map((tier) => ({
          minActiveUsers: Number(tier.minActiveUsers),
          maxActiveUsers: tier.maxActiveUsers === '' ? null : Number(tier.maxActiveUsers),
          priceCents: currencyToCents(tier.price),
        }));
      }
      await apiRequest(editingId ? `/platform-plans/${editingId}` : '/platform-plans', userToken, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setSuccess(editingId ? 'Plano atualizado.' : 'Plano cadastrado.');
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar plano.');
    } finally {
      setIsLoading(false);
    }
  };

  const metricLabel = (metric: ActiveUserMetric) => (metric === 'login_enabled' ? 'login habilitado' : 'cadastrado');

  const planSummary = (plan: PlatformPlan) => {
    const metric = metricLabel(plan.active_user_metric);
    if (plan.plan_type === 'per_active_user') {
      const base = `${formatCurrency(plan.price_per_active_user_cents || 0)} por usuário ativo`;
      const withMinimum = plan.minimum_price_cents > 0 ? `${base} (mínimo ${formatCurrency(plan.minimum_price_cents)})` : base;
      return `${withMinimum} · ${metric}`;
    }
    return `${plan.tiers.length} faixa${plan.tiers.length === 1 ? '' : 's'} · ${metric}`;
  };

  const tourSteps: TourStep[] = [
    { key: 'form', title: 'Cadastrar ou editar plano', description: '"Por usuário ativo" cobra um valor fixo multiplicado pela quantidade de usuários ativos do condomínio, com um valor mínimo mensal opcional pra garantir um piso mesmo com poucos usuários. "Faixa fechada" cobra um valor mensal fixo conforme a faixa de usuários ativos — as faixas precisam ser contínuas, sem sobreposição nem lacuna (ex.: 0–50 seguida exatamente de 51–100). O "Critério de usuário ativo" também é configurável: "Usuário cadastrado" conta todo cadastro do condomínio não excluído; "Login habilitado" conta só quem também tem o acesso liberado no sistema. Desmarcar "Plano ativo" impede vincular o plano a novos condomínios, mas não desvincula quem já está usando.' },
    { key: 'list', title: 'Planos cadastrados', description: 'Cada card mostra o tipo do plano (por usuário ativo ou faixa fechada), um resumo do valor cobrado e o critério de usuário ativo configurado. Planos inativos aparecem marcados como "Inativo" e não podem ser vinculados a condomínios em "Faturamento da plataforma". Toque em "Editar" pra carregar o plano no formulário acima e ajustar preço, faixas ou critério.' },
  ];

  return (
    <>
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Modelo de negocio</Text>
          <Text style={styles.title}>Planos da plataforma</Text>
          <Text style={styles.subtitle}>Cadastre como a plataforma cobra cada condominio: por usuário ativo ou por faixa fechada de usuários ativos.</Text>
        </View>
        <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
      </View>

      <View ref={registerSection('form')} style={[isActive('form') && styles.tourHighlight]}>
      <Panel>
        <Text style={styles.panelTitle}>{editingId ? 'Editar plano' : 'Novo plano'}</Text>
        <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
          <View>
            <TextField label="Nome do plano" required placeholder="Ex.: Plano Essencial" value={name} onChangeText={setName} />
          </View>
        </FormGrid>

        <Text style={styles.fieldLabel}>Tipo de cobrança</Text>
        <View style={styles.typeRow}>
          <Pressable onPress={() => setPlanType('per_active_user')} style={[styles.typeOption, planType === 'per_active_user' && styles.typeOptionActive]}>
            <Text style={[styles.typeOptionText, planType === 'per_active_user' && styles.typeOptionTextActive]}>Por usuário ativo</Text>
          </Pressable>
          <Pressable onPress={() => setPlanType('tiered_bracket')} style={[styles.typeOption, planType === 'tiered_bracket' && styles.typeOptionActive]}>
            <Text style={[styles.typeOptionText, planType === 'tiered_bracket' && styles.typeOptionTextActive]}>Faixa fechada</Text>
          </Pressable>
        </View>

        <Text style={styles.fieldLabel}>Critério de usuário ativo</Text>
        <View style={styles.typeRow}>
          <Pressable onPress={() => setActiveUserMetric('registered')} style={[styles.typeOption, activeUserMetric === 'registered' && styles.typeOptionActive]}>
            <Text style={[styles.typeOptionText, activeUserMetric === 'registered' && styles.typeOptionTextActive]}>Usuário cadastrado</Text>
          </Pressable>
          <Pressable onPress={() => setActiveUserMetric('login_enabled')} style={[styles.typeOption, activeUserMetric === 'login_enabled' && styles.typeOptionActive]}>
            <Text style={[styles.typeOptionText, activeUserMetric === 'login_enabled' && styles.typeOptionTextActive]}>Login habilitado</Text>
          </Pressable>
        </View>
        <Text style={styles.metricHint}>
          {activeUserMetric === 'registered'
            ? 'Conta todo cadastro do condomínio que não foi excluído.'
            : 'Conta só quem também tem o acesso habilitado (login_enabled).'}
        </Text>

        {planType === 'per_active_user' ? (
          <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 2 }}>
            <View>
              <TextField label="Preço por usuário ativo" required placeholder="Ex.: R$ 4,90" value={pricePerActiveUser} onChangeText={(value) => setPricePerActiveUser(maskCurrency(value))} keyboardType="number-pad" />
            </View>
            <View>
              <TextField label="Valor mínimo mensal" hint="Opcional. Cobrado quando o cálculo por usuário fica abaixo deste valor." placeholder="Opcional" value={minimumPrice} onChangeText={(value) => setMinimumPrice(maskCurrency(value))} keyboardType="number-pad" />
            </View>
          </FormGrid>
        ) : (
          <FormFieldFull>
            <Text style={styles.fieldLabel}>Faixas de preço</Text>
            <Text style={styles.metricHint}>Cada linha é uma faixa: de quantos usuários, até quantos (vazio = sem limite) e o valor mensal cobrado.</Text>
            {tiers.map((tier, index) => (
              <View key={index} style={styles.tierRow}>
                <TextInput placeholder="De (usuários)" value={tier.minActiveUsers} onChangeText={(value) => updateTier(index, { minActiveUsers: value.replace(/\D/g, '') })} keyboardType="number-pad" style={[styles.input, styles.tierInput]} />
                <TextInput placeholder="Ate (vazio = sem limite)" value={tier.maxActiveUsers} onChangeText={(value) => updateTier(index, { maxActiveUsers: value.replace(/\D/g, '') })} keyboardType="number-pad" style={[styles.input, styles.tierInput]} />
                <TextInput placeholder="Valor mensal" value={tier.price} onChangeText={(value) => updateTier(index, { price: maskCurrency(value) })} keyboardType="number-pad" style={[styles.input, styles.tierInput]} />
                <Pressable onPress={() => removeTier(index)} disabled={tiers.length <= 1} style={[styles.removeTier, tiers.length <= 1 && styles.removeTierDisabled]}>
                  <Text style={styles.removeTierText}>Remover</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addTier} style={styles.addTier}>
              <Text style={styles.addTierText}>+ Adicionar faixa</Text>
            </Pressable>
          </FormFieldFull>
        )}

        <Pressable onPress={() => setActive((current) => !current)} style={styles.activeRow}>
          <View style={[styles.checkbox, active && styles.checkboxChecked]}>
            {active && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.activeLabel}>Plano ativo (disponivel para vincular a condominios)</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}
        <View style={styles.formActions}>
          <AppButton title={editingId ? 'Salvar plano' : 'Cadastrar plano'} onPress={save} disabled={isLoading || !isValid} />
          {editingId ? (
            <Pressable onPress={resetForm} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancelar edicao</Text>
            </Pressable>
          ) : null}
        </View>
      </Panel>
      </View>

      <View ref={registerSection('list')} style={[isActive('list') && styles.tourHighlight]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Planos cadastrados</Text>
        <Text style={styles.counter}>{items.length}</Text>
      </View>

      {items.length === 0 ? (
        <EmptyState title="Nenhum plano ainda" description="Cadastre o primeiro plano para comecar a projetar a receita da plataforma." />
      ) : (
        <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
          {items.map((plan) => (
            <View key={plan.id} style={styles.card}>
              <View style={[styles.cardAccent, !plan.active && styles.cardAccentInactive]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{plan.name}</Text>
                  <Pressable onPress={() => editPlan(plan)} disabled={isLoading} style={styles.editButton}>
                    <Text style={styles.editText}>Editar</Text>
                  </Pressable>
                </View>
                <Text style={styles.cardBadge}>{plan.plan_type === 'per_active_user' ? 'Por usuário ativo' : 'Faixa fechada'}</Text>
                <Text style={styles.cardLine}>{planSummary(plan)}</Text>
                {!plan.active ? <Text style={styles.cardInactive}>Inativo</Text> : null}
              </View>
            </View>
          ))}
        </CardGrid>
      )}
      </View>
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, paddingBottom: 40, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  grow: { flex: 1 },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  eyebrow: { color: colors.teal, fontWeight: '800', marginBottom: 6 },
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
  fieldLabel: { color: colors.ink, fontWeight: '800', marginBottom: 8 },
  metricHint: { color: colors.muted, fontSize: 13, marginTop: -6, marginBottom: 14 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  typeOption: { flex: 1, minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  typeOptionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  typeOptionText: { color: colors.ink, fontWeight: '800' },
  typeOptionTextActive: { color: colors.primaryDark },
  tierRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' },
  tierInput: { flex: 1, minWidth: 110 },
  removeTier: { minHeight: 52, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  removeTierDisabled: { opacity: 0.4 },
  removeTierText: { color: colors.red, fontWeight: '800' },
  addTier: { alignSelf: 'flex-start', paddingVertical: 8 },
  addTierText: { color: colors.primary, fontWeight: '900' },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: 4 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: colors.border, borderRadius: 5, justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: '#fff', fontWeight: '900', fontSize: 13 },
  activeLabel: { color: colors.ink, fontWeight: '700' },
  error: { color: colors.red, marginBottom: 10 },
  success: { color: colors.green, marginBottom: 10, fontWeight: '800' },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  cancelButton: { paddingVertical: 10 },
  cancelText: { color: colors.muted, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  counter: { color: colors.primary, fontWeight: '900' },
  card: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  cardAccent: { width: 5, backgroundColor: colors.green },
  cardAccentInactive: { backgroundColor: colors.border },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cardTitle: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900' },
  editButton: { borderWidth: 1, borderColor: '#bfd1ea', backgroundColor: colors.softBlue, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  editText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  cardBadge: { color: colors.primaryDark, marginTop: 6, fontSize: 13, fontWeight: '900' },
  cardLine: { color: colors.muted, marginTop: 4, lineHeight: 21 },
  cardInactive: { color: colors.red, marginTop: 6, fontWeight: '800' },
});
