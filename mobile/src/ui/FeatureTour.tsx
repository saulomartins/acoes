import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export type TourStep = { key: string; title: string; description: string };

type Props = { steps: TourStep[]; visible: boolean; onClose: () => void; onStepChange?: (step: TourStep) => void };

// Tour guiado de UMA tela (diferente do tour geral do sistema, que navega
// entre telas — este fica parado na tela atual e só explica as seções dela
// em mais detalhe). Nunca abre sozinho: só quando o usuário clica no botão
// da tela pedindo o tour.
//
// Usa Modal (mesmo padrão de AppDialog e do seletor de mês do Painel
// financeiro) em vez de uma View com position:absolute — a tela que chama
// isso fica aninhada fundo dentro de ResponsiveShell, e absolute ali
// resolve contra um ancestral incerto, podendo renderizar fora da área
// visível. Modal sempre monta no topo da árvore, sem essa ambiguidade.
export default function FeatureTour({ steps, visible, onClose, onStepChange }: Props) {
  const [index, setIndex] = useState(0);
  useEffect(() => { if (visible) setIndex(0); }, [visible]);
  // O passo ativo muda o campo em destaque na tela por trás (rolagem +
  // realce) — repassa pro dono da tela toda vez que abre ou avança/volta.
  useEffect(() => { if (visible && steps[index]) onStepChange?.(steps[index]); }, [visible, index]);

  if (steps.length === 0) return null;
  const step = steps[index] ?? steps[0];
  const isLast = index === steps.length - 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.top}>
            <Text style={styles.eyebrow}>TOUR DESTA TELA</Text>
            <Text style={styles.progress}>{index + 1} de {steps.length}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Fechar tour" style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable>
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.description}>{step.description}</Text>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${((index + 1) / steps.length) * 100}%` as any }]} /></View>
          <View style={styles.actions}>
            {index > 0 ? (
              <Pressable onPress={() => setIndex(current => current - 1)} style={styles.secondary}><Text style={styles.secondaryText}>Voltar</Text></Pressable>
            ) : null}
            <Pressable onPress={() => (isLast ? onClose() : setIndex(current => current + 1))} style={styles.next}>
              <Text style={styles.nextText}>{isLast ? 'Concluir' : 'Próxima'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.22)', justifyContent: 'flex-end', padding: 16 },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', borderRadius: 16, backgroundColor: '#fff', padding: 18, borderWidth: 1, borderColor: colors.border },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  progress: { color: colors.muted, fontSize: 12, fontWeight: '800', marginLeft: 'auto' },
  close: { paddingHorizontal: 4, paddingVertical: 2 },
  closeText: { color: colors.muted, fontSize: 15, fontWeight: '900' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 8 },
  description: { color: '#445466', fontSize: 14, lineHeight: 20, marginTop: 6 },
  bar: { height: 5, borderRadius: 3, backgroundColor: '#e7ebf1', overflow: 'hidden', marginTop: 14 },
  barFill: { height: 5, backgroundColor: colors.primary },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 14 },
  secondary: { paddingHorizontal: 16, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 9 },
  secondaryText: { color: colors.ink, fontWeight: '900' },
  next: { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.primary, borderRadius: 9 },
  nextText: { color: '#fff', fontWeight: '900' },
});
