import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from './text';
import { colors } from './theme';

// Botão "?" do tour de cada tela. Redondo e pequeno para não disputar espaço
// com o título — o texto "Tour desta tela" ficava ao lado do título e, no
// celular, quebrava palavras no meio ("Ocorrência / s").
export default function TourButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Tour desta tela"
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.text}>?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  text: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
});
