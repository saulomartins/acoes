import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { colors } from './theme';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (value: Date) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day; };

type Props = { from: Date; to: Date; onChange: (from: Date, to: Date) => void; maxDate?: Date };

// Seletor de intervalo sem nenhuma lib externa (mesmo padrão de grid de mês
// já usado em ReservationCalendar.tsx) — evita puxar uma dependência nativa
// nova só pra isso, o que exigiria rebuild EAS pro app nativo.
export default function DateRangeCalendar({ from, to, onChange, maxDate }: Props) {
  const [month, setMonth] = useState(() => new Date(from.getFullYear(), from.getMonth(), 1));
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);

  const firstOffset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstOffset + daysInMonth }, (_, index) => index < firstOffset ? null : new Date(month.getFullYear(), month.getMonth(), index - firstOffset + 1));
  while (cells.length % 7) cells.push(null);

  const rangeStart = pendingFrom ?? from;
  const rangeEnd = pendingFrom ? pendingFrom : to;
  const inRange = (day: Date) => {
    const lo = startOfDay(rangeStart < rangeEnd ? rangeStart : rangeEnd);
    const hi = startOfDay(rangeStart < rangeEnd ? rangeEnd : rangeStart);
    return day >= lo && day <= hi;
  };

  const maxDay = maxDate ? startOfDay(maxDate) : null;

  const handlePress = (day: Date) => {
    if (maxDay && day > maxDay) return;
    if (!pendingFrom) { setPendingFrom(day); return; }
    const [lo, hi] = pendingFrom <= day ? [pendingFrom, day] : [day, pendingFrom];
    setPendingFrom(null);
    onChange(lo, hi);
  };

  const changeMonth = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable onPress={() => changeMonth(-1)} style={styles.nav}><Text style={styles.navText}>‹</Text></Pressable>
        <Text style={styles.month}>{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</Text>
        <Pressable onPress={() => changeMonth(1)} style={styles.nav}><Text style={styles.navText}>›</Text></Pressable>
      </View>
      <View style={styles.week}>{WEEK.map(day => <Text key={day} style={styles.weekText}>{day}</Text>)}</View>
      <View style={styles.grid}>
        {cells.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={styles.day} />;
          const disabled = Boolean(maxDay && day > maxDay);
          const isEdge = pendingFrom ? sameDay(day, pendingFrom) : (sameDay(day, from) || sameDay(day, to));
          const within = !disabled && inRange(day);
          return (
            <Pressable key={day.toISOString()} disabled={disabled} onPress={() => handlePress(day)} style={[styles.day, within && styles.dayInRange, isEdge && styles.dayEdge, disabled && styles.dayDisabled]}>
              <Text style={[styles.dayNumber, isEdge && styles.dayNumberEdge, disabled && styles.dayNumberDisabled]}>{day.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{pendingFrom ? 'Toque na data final do período.' : 'Toque numa data para começar um novo período.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: '#fff', padding: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.softBlue, alignItems: 'center', justifyContent: 'center' },
  navText: { color: colors.primary, fontSize: 22, fontWeight: '800', lineHeight: 24 },
  month: { color: colors.ink, fontSize: 15, fontWeight: '900', textTransform: 'capitalize' },
  week: { flexDirection: 'row', marginTop: 12, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 6 },
  weekText: { width: '14.285%', textAlign: 'center', color: colors.muted, fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.285%', minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  dayInRange: { backgroundColor: colors.softBlue },
  dayEdge: { backgroundColor: colors.primary },
  dayDisabled: { opacity: 0.3 },
  dayNumber: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  dayNumberEdge: { color: '#fff', fontWeight: '900' },
  dayNumberDisabled: { color: colors.muted },
  hint: { color: colors.muted, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
