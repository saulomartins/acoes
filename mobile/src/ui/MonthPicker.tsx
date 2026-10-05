import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { colors, shadow } from './theme';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SHORT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const ALL_MONTHS = 'all';

const keyOf = (year: number, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
export const currentMonthKey = () => { const now = new Date(); return keyOf(now.getFullYear(), now.getMonth()); };
const parse = (key: string) => ({ year: Number(key.slice(0, 4)), monthIndex: Number(key.slice(5, 7)) - 1 });
const shift = (key: string, delta: number) => { const { year, monthIndex } = parse(key); const date = new Date(year, monthIndex + delta, 1); return keyOf(date.getFullYear(), date.getMonth()); };
const longLabel = (key: string) => { const { year, monthIndex } = parse(key); return `${MONTHS[monthIndex]} de ${year}`; };

type Props = {
  // 'AAAA-MM' ou ALL_MONTHS.
  value: string;
  onChange: (value: string) => void;
  // Meses que têm registros: ganham um ponto na grade, para o usuário saber
  // onde há dados antes de escolher.
  monthsWithData?: string[];
  // Oferece "Todo o histórico" (value = ALL_MONTHS).
  allowAll?: boolean;
  title?: string;
};

// Seletor de mês/ano. Fechado, mostra o mês escolhido com setas para o mês
// anterior e o seguinte — o caso mais comum, ir de um mês ao vizinho, sai em
// um toque. Aberto, mostra o ano inteiro em grade, com o mês atual e os meses
// com dados marcados. Substitui a fila de chips rolável, que crescia sem fim
// e escondia os meses antigos fora da tela.
export const MonthPicker = ({ value, onChange, monthsWithData = [], allowAll = false, title = 'Mês de referência' }: Props) => {
  const today = currentMonthKey();
  const isAll = value === ALL_MONTHS;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => parse(isAll ? today : value).year);

  const openPicker = () => { setYear(parse(isAll ? today : value).year); setOpen(true); };
  const choose = (next: string) => { onChange(next); setOpen(false); };
  const step = (delta: number) => onChange(shift(isAll ? today : value, delta));

  return (
    <View>
      <View style={styles.control}>
        <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="Mês anterior" hitSlop={6} style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Pressable onPress={openPicker} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}: ${isAll ? 'Todo o histórico' : longLabel(value)}`} style={({ pressed }) => [styles.controlMain, pressed && styles.pressed]}>
          <View style={styles.controlText}>
            <Text style={styles.controlValue} numberOfLines={1}>{isAll ? 'Todo o histórico' : longLabel(value)}</Text>
            <Text style={[styles.controlMeta, value === today && styles.controlMetaCurrent]} numberOfLines={1}>
              {isAll ? 'Todos os meses' : value === today ? 'Mês atual' : 'Toque para escolher outro mês'}
            </Text>
          </View>
          <Text style={styles.chevron}>▾</Text>
        </Pressable>
        <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel="Próximo mês" hitSlop={6} style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Pressable interno sem ação: clicar dentro do cartão não fecha pelo fundo. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Fechar" style={styles.close}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            <View style={styles.yearRow}>
              <Pressable onPress={() => setYear(current => current - 1)} accessibilityRole="button" accessibilityLabel="Ano anterior" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
                <Text style={styles.arrowText}>‹</Text>
              </Pressable>
              <Text style={styles.yearText}>{year}</Text>
              <Pressable onPress={() => setYear(current => current + 1)} accessibilityRole="button" accessibilityLabel="Próximo ano" style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
                <Text style={styles.arrowText}>›</Text>
              </Pressable>
            </View>

            <View style={styles.grid}>
              {SHORT_MONTHS.map((label, monthIndex) => {
                const key = keyOf(year, monthIndex);
                const selected = key === value;
                const current = key === today;
                const hasData = monthsWithData.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => choose(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${MONTHS[monthIndex]} de ${year}${current ? ', mês atual' : ''}${hasData ? ', com registros' : ''}`}
                    style={({ pressed }) => [styles.month, current && styles.monthCurrent, selected && styles.monthSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.monthText, selected && styles.monthTextSelected]}>{label}</Text>
                    <Text style={[styles.monthTag, selected && styles.monthTextSelected]}>{current ? 'atual' : ' '}</Text>
                    <View style={[styles.dot, hasData && (selected ? styles.dotOnSelected : styles.dotOn)]} />
                  </Pressable>
                );
              })}
            </View>

            {monthsWithData.length ? (
              <View style={styles.legend}><View style={[styles.dot, styles.dotOn]} /><Text style={styles.legendText}>mês com registros</Text></View>
            ) : null}

            <View style={styles.footer}>
              <Pressable onPress={() => choose(today)} accessibilityRole="button" style={({ pressed }) => [styles.footerButton, value === today && styles.footerButtonOn, pressed && styles.pressed]}>
                <Text style={[styles.footerText, value === today && styles.footerTextOn]}>Mês atual</Text>
              </Pressable>
              {allowAll ? (
                <Pressable onPress={() => choose(ALL_MONTHS)} accessibilityRole="button" style={({ pressed }) => [styles.footerButton, isAll && styles.footerButtonOn, pressed && styles.pressed]}>
                  <Text style={[styles.footerText, isAll && styles.footerTextOn]}>Todo o histórico</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  control: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: '#fff', padding: 6, maxWidth: 460 },
  controlMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  controlText: { flex: 1, minWidth: 0 },
  controlValue: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  controlMeta: { color: colors.muted, fontSize: 12.5, marginTop: 2, fontWeight: '700' },
  controlMetaCurrent: { color: colors.green },
  chevron: { color: colors.muted, fontSize: 15, fontWeight: '900' },
  arrow: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.softBlue },
  arrowText: { color: colors.primaryDark, fontSize: 24, fontWeight: '900', lineHeight: 26 },
  pressed: { opacity: 0.7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, borderRadius: 18, backgroundColor: '#fff', padding: 18, gap: 14, ...shadow },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sheetTitle: { flex: 1, color: colors.ink, fontSize: 18, fontWeight: '900' },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2f4f8' },
  closeText: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yearText: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  month: { flexGrow: 1, flexBasis: '22%', minHeight: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: '#fff', paddingVertical: 8 },
  monthCurrent: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  monthSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  monthText: { color: colors.ink, fontSize: 15.5, fontWeight: '900' },
  monthTag: { color: colors.primaryDark, fontSize: 10.5, fontWeight: '800', lineHeight: 13 },
  monthTextSelected: { color: '#fff' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 3, backgroundColor: 'transparent' },
  dotOn: { backgroundColor: colors.green },
  dotOnSelected: { backgroundColor: '#fff' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: colors.muted, fontSize: 12.5 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footerButton: { flexGrow: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff' },
  footerButtonOn: { borderColor: colors.primary, backgroundColor: colors.softBlue },
  footerText: { color: colors.primary, fontWeight: '900', fontSize: 14 },
  footerTextOn: { color: colors.primaryDark },
});
