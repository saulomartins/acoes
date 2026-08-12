import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './text';
import { colors, shadow } from './theme';

export type ComboBoxOption = {
  value: string;
  label: string;
  // Linha secundária da opção (ex.: a tipologia da unidade). Também entra na
  // busca, então dá para achar "Cobertura" sem saber o número do apartamento.
  description?: string;
};

type Props = {
  options: ComboBoxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  title?: string;
  emptyText?: string;
  disabled?: boolean;
  // Abaixo disso a lista cabe na tela e o campo de busca só atrapalha.
  searchThreshold?: number;
};

// Combobox único para web e nativo: fechado mostra só o valor escolhido e
// abre em modal com busca. Substitui o par "<select> no web / lista de busca
// sempre aberta no app" — a lista aberta empurrava o resto do formulário para
// baixo no celular, e o <select> nativo não tem busca, o que é ruim em
// condomínio com dezenas de apartamentos.
export const ComboBox = ({
  options,
  value,
  onChange,
  placeholder = 'Selecione',
  searchPlaceholder = 'Buscar',
  title,
  emptyText = 'Nenhuma opção encontrada.',
  disabled = false,
  searchThreshold = 8,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find(option => option.value === value) || null;
  const showSearch = options.length > searchThreshold;

  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return options;
    return options.filter(option =>
      `${option.label} ${option.description || ''}`.toLocaleLowerCase('pt-BR').includes(term),
    );
  }, [options, search]);

  // A busca começa limpa a cada abertura: reabrir e ver a lista filtrada de
  // uma escolha anterior passa a impressão de que faltam opções.
  const openList = () => {
    if (disabled) return;
    setSearch('');
    setOpen(true);
  };

  const select = (option: ComboBoxOption) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <View>
      <Pressable
        onPress={openList}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        accessibilityLabel={selected ? selected.label : placeholder}
        style={[styles.control, disabled && styles.controlDisabled]}
      >
        <View style={styles.controlText}>
          <Text style={selected ? styles.controlValue : styles.controlPlaceholder} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </Text>
          {selected?.description ? (
            <Text style={styles.controlMeta} numberOfLines={1}>{selected.description}</Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Pressable interno sem onPress: absorve o toque para que clicar
              dentro do cartão não feche pelo backdrop. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title || placeholder}</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Fechar" style={styles.close}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            {showSearch ? (
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
              />
            ) : null}

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {matches.length === 0 ? (
                <Text style={styles.empty}>{emptyText}</Text>
              ) : (
                matches.map(option => {
                  const active = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => select(option)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.option, active && styles.optionActive]}
                    >
                      <View style={styles.grow}>
                        <Text style={[styles.optionLabel, active && styles.optionLabelActive]} numberOfLines={2}>{option.label}</Text>
                        {option.description ? <Text style={styles.optionMeta} numberOfLines={2}>{option.description}</Text> : null}
                      </View>
                      {active ? <Text style={styles.check}>✓</Text> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  control: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  controlDisabled: { backgroundColor: '#f2f4f8' },
  controlText: { flex: 1, minWidth: 0 },
  controlValue: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  controlPlaceholder: { color: colors.placeholder, fontSize: 16 },
  controlMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 15, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 460, maxHeight: '80%', borderRadius: 16, backgroundColor: '#fff', padding: 16, ...shadow },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  sheetTitle: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f4f8' },
  closeText: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  search: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, fontSize: 16, backgroundColor: '#fff', color: colors.ink, marginBottom: 10 },
  list: { alignSelf: 'stretch' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8, backgroundColor: '#fff' },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  optionLabel: { color: colors.ink, fontSize: 15.5, fontWeight: '800' },
  optionLabelActive: { color: colors.primaryDark },
  optionMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  check: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  empty: { color: colors.muted, padding: 12, textAlign: 'center' },
  grow: { flex: 1, minWidth: 0 },
});
