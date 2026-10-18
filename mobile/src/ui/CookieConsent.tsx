import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { getConsent, initPublicTracking, setConsent, subscribeCookiePreferences } from '../utils/analytics';

// Altura do aviso enquanto ele está aberto (0 fechado). No celular o aviso
// ocupa a largura toda e cobriria o botão da Lari; o ChatAssistant usa isto
// para subir o botão acima dele.
let bannerHeight = 0;
const heightListeners = new Set<(height: number) => void>();
const setBannerHeight = (height: number) => { bannerHeight = height; heightListeners.forEach((listener) => listener(height)); };
export const useCookieBannerHeight = () => {
  const [height, setHeight] = useState(bannerHeight);
  useEffect(() => { heightListeners.add(setHeight); return () => { heightListeners.delete(setHeight); }; }, []);
  return height;
};

// Aviso de cookies das páginas públicas (landing, pílulas, login). Aparece
// enquanto o visitante não escolheu, e de novo quando ele abre "Preferências
// de cookies" no rodapé. Montar este componente também é o que inicia a
// medição nas páginas públicas (se já houver aceite) — ver utils/analytics.
export default function CookieConsent({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    initPublicTracking();
    setVisible(getConsent() === null);
    return subscribeCookiePreferences(() => setVisible(true));
  }, []);

  useEffect(() => { if (!visible) setBannerHeight(0); }, [visible]);
  useEffect(() => () => setBannerHeight(0), []);

  if (!visible) return null;
  const choose = (choice: 'granted' | 'denied') => { setConsent(choice); setVisible(false); };

  return (
    <View style={styles.wrap} pointerEvents="box-none" onLayout={(event) => setBannerHeight(event.nativeEvent.layout.height)}>
      <View style={styles.banner} accessibilityRole="alert">
        <Text style={styles.title}>🍪 Cookies e privacidade</Text>
        <Text style={styles.text}>
          Usamos cookies do Google (Google Ads e Google Analytics) para medir as visitas e o resultado dos nossos anúncios. Eles só são ativados se você aceitar, e nunca nas áreas internas da plataforma.{' '}
          <Text style={styles.link} onPress={onOpenPrivacy}>Política de Privacidade</Text>
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={() => choose('denied')} style={({ pressed }) => [styles.button, styles.buttonGhost, pressed && styles.pressed]}><Text style={styles.buttonGhostText}>Recusar</Text></Pressable>
          <Pressable onPress={() => choose('granted')} style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && styles.pressed]}><Text style={styles.buttonPrimaryText}>Aceitar</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, alignItems: 'flex-start', zIndex: 60 },
  banner: { width: '100%', maxWidth: 520, backgroundColor: '#0F172A', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  title: { color: '#fff', fontWeight: '900', fontSize: 15, marginBottom: 6 },
  text: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19 },
  link: { color: '#C7CCFF', fontWeight: '800', textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  button: { minHeight: 40, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  buttonGhost: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  buttonGhostText: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
  buttonPrimary: { backgroundColor: '#4F46E5' },
  buttonPrimaryText: { color: '#fff', fontWeight: '900', fontSize: 13.5 },
  pressed: { opacity: 0.85 },
});
