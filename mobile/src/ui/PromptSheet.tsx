import React, { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { colors, shadow } from './theme';

// Moldura dos convites do app nativo (ativar biometria, avaliar na loja):
// ícone em destaque, título, subtítulo, lista de vantagens e ações. Cada
// convite só fornece o conteúdo, para todos terem a mesma cara.
type Tone = 'primary' | 'success' | 'amber';

// border: para ícone colorido (emoji ⭐) que sumiria num círculo da mesma cor.
const toneColors: Record<Tone, { halo: string; circle: string; eyebrow: string; border?: string }> = {
  primary: { halo: colors.softBlue, circle: colors.primary, eyebrow: colors.primary },
  success: { halo: colors.softGreen, circle: colors.green, eyebrow: colors.green },
  amber: { halo: '#fdf3e1', circle: colors.surface, eyebrow: '#b7791f', border: colors.amber },
};

export function PromptSheet({ visible, onClose, icon, tone = 'primary', eyebrow, title, subtitle, children }: {
  visible: boolean;
  onClose: () => void;
  icon: string;
  tone?: Tone;
  eyebrow?: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const palette = toneColors[tone];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={[styles.iconHalo, { backgroundColor: palette.halo }]}>
            <View style={[styles.iconCircle, { backgroundColor: palette.circle, shadowColor: palette.border ?? palette.circle }, palette.border ? { borderWidth: 2, borderColor: palette.border } : null]}>
              <Text style={styles.iconText}>{icon}</Text>
            </View>
          </View>
          {eyebrow ? <Text style={[styles.eyebrow, { color: palette.eyebrow }]}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export const PromptBenefits = ({ items }: { items: string[] }) => (
  <View style={styles.benefits}>
    {items.map(text => (
      <View key={text} style={styles.benefit}>
        <View style={styles.benefitCheck}><Text style={styles.benefitCheckText}>✓</Text></View>
        <Text style={styles.benefitText}>{text}</Text>
      </View>
    ))}
  </View>
);

export const PromptError = ({ message }: { message: string }) => (
  <View style={styles.errorBox}><Text style={styles.errorText}>{message}</Text></View>
);

export const PromptLink = ({ label, onPress, disabled, muted }: { label: string; onPress: () => void; disabled?: boolean; muted?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={styles.link}>
    <Text style={[styles.linkLabel, muted && styles.linkLabelMuted]}>{label}</Text>
  </Pressable>
);

// Links lado a lado ("Agora não" · "Já avaliei"), para o card não crescer.
export const PromptLinks = ({ children }: { children: ReactNode }) => <View style={styles.links}>{children}</View>;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 8, alignItems: 'stretch', ...shadow },
  iconHalo: { alignSelf: 'center', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  iconText: { fontSize: 20, color: '#fff', fontWeight: '900' },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  benefits: { backgroundColor: colors.background, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 12, marginBottom: 14 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  benefitCheck: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.softGreen, alignItems: 'center', justifyContent: 'center' },
  benefitCheckText: { color: colors.green, fontSize: 11, fontWeight: '900' },
  benefitText: { flex: 1, color: colors.ink, fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  errorBox: { backgroundColor: '#fdecec', borderRadius: 10, padding: 8, marginBottom: 10 },
  errorText: { color: colors.red, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  link: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  linkLabel: { color: colors.primary, fontSize: 14.5, fontWeight: '800' },
  linkLabelMuted: { color: colors.muted, fontSize: 14, fontWeight: '700' },
});
