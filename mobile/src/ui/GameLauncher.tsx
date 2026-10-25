import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { useBreakpoint } from './responsive';
import { useCookieBannerHeight } from './CookieConsent';
import { trackEvent } from '../utils/analytics';

const C = { ink: '#0F172A', muted: '#5B6472', border: '#E4E9F3', primary: '#4F46E5', amber: '#F0A028', amberSoft: '#FFF3DE' };

// Convite aparece uma vez por visita, depois do balão da Lari (5s).
const INVITE_DELAY_MS = 12000;
const INVITE_SEEN_KEY = 'ldg-invite-seen';

const inviteSeen = () => { try { return window.sessionStorage.getItem(INVITE_SEEN_KEY) === '1'; } catch { return false; } };
const markInviteSeen = () => { try { window.sessionStorage.setItem(INVITE_SEEN_KEY, '1'); } catch { /* sem storage: só não lembra */ } };

// O jogo (public/plantao-do-sindico.html) está no mesmo domínio: a altura do
// iframe acompanha o conteúdo, e o botão de contato da tela final avisa a
// landing por postMessage.
const GameFrame = () => {
  const [height, setHeight] = useState(720);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const fitToContent = (frame: HTMLIFrameElement) => {
    const win = frame.contentWindow;
    const game = frame.contentDocument?.getElementById('ldg');
    if (!win || !game) return;
    const measure = () => setHeight(Math.ceil(game.getBoundingClientRect().bottom + win.scrollY + parseFloat(win.getComputedStyle(game).marginBottom || '0')));
    measure();
    observer.current?.disconnect();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(game);
  };
  return (
    <iframe src="/plantao-do-sindico.html" title="Jogo Plantão do Síndico" onLoad={(event) => fitToContent(event.currentTarget)}
      style={{ width: '100%', height, border: 0, display: 'block' }} />
  );
};

// Minijogo "Plantão do Síndico" da landing: convite flutuante no centro da
// tela, botão fixo para reabrir e o jogo num modal. Só existe na web.
export default function GameLauncher({ openRequest, onRequestContact }: { openRequest?: number; onRequestContact: () => void }) {
  const { isMobile } = useBreakpoint();
  const cookieBannerHeight = useCookieBannerHeight();
  const [invite, setInvite] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Espera o aviso de cookies sair da frente antes de convidar.
  useEffect(() => {
    if (Platform.OS !== 'web' || inviteSeen() || cookieBannerHeight > 0) return undefined;
    const timer = setTimeout(() => { if (!inviteSeen()) { markInviteSeen(); setInvite(true); trackEvent('game_invite_shown'); } }, INVITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cookieBannerHeight]);

  const openGame = (origin: string) => { markInviteSeen(); setInvite(false); setPlaying(true); trackEvent('game_open', { origin }); };
  const closeGame = () => setPlaying(false);

  // Aberto pelo menu ("Jogue").
  useEffect(() => { if (openRequest) openGame('menu'); }, [openRequest]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.source !== 'ldg' || event.data?.type !== 'contact') return;
      trackEvent('game_contact', { score: event.data.score });
      setPlaying(false);
      onRequestContact();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPlaying(false); setInvite(false); } };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('message', onMessage); window.removeEventListener('keydown', onKey); };
  }, [onRequestContact]);

  if (Platform.OS !== 'web') return null;

  return (
    <>
      {!playing && !invite ? (
        <View pointerEvents="box-none" style={[styles.pillLayer, { bottom: (isMobile ? 16 : 22) + cookieBannerHeight }]}>
          <Pressable onPress={() => openGame('pill')} style={({ pressed }) => [styles.pill, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Abrir o jogo Plantão do Síndico">
            <Text style={styles.pillIcon}>🎮</Text>
            <Text style={styles.pillText}>{isMobile ? 'Jogue 60s' : 'Teste seu lado síndico · 60s'}</Text>
          </Pressable>
        </View>
      ) : null}

      {invite ? (
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setInvite(false)} accessibilityLabel="Fechar convite" />
          <View style={styles.inviteCard} accessibilityRole="alert">
            <Pressable onPress={() => setInvite(false)} style={styles.close} hitSlop={10} accessibilityLabel="Fechar"><Text style={styles.closeText}>✕</Text></Pressable>
            <View style={styles.inviteBadge}><Text style={styles.inviteBadgeText}>🏢</Text></View>
            <Text style={styles.inviteEyebrow}>MINIJOGO · 60 SEGUNDOS</Text>
            <Text style={styles.inviteTitle}>Teste seu lado síndico</Text>
            <Text style={styles.inviteText}>Boleto atrasado, briga pelo salão, som alto às 23h… Aguenta 60 segundos cuidando de um condomínio sem sistema?</Text>
            <Pressable onPress={() => openGame('invite')} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}><Text style={styles.primaryBtnText}>Jogar agora</Text></Pressable>
            <Pressable onPress={() => setInvite(false)} style={styles.laterBtn}><Text style={styles.laterBtnText}>Agora não</Text></Pressable>
          </View>
        </View>
      ) : null}

      {playing ? (
        <View style={[styles.backdrop, isMobile && styles.backdropMobile]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeGame} accessibilityLabel="Fechar jogo" />
          <View style={[styles.gameSheet, isMobile && styles.gameSheetMobile]} accessibilityViewIsModal>
            <Pressable onPress={closeGame} style={[styles.close, styles.closeOnGame]} hitSlop={10} accessibilityLabel="Fechar jogo"><Text style={styles.closeText}>✕</Text></Pressable>
            <ScrollView contentContainerStyle={styles.gameScroll}><GameFrame /></ScrollView>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pillLayer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 45 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.ink, borderRadius: 999, paddingVertical: 11, paddingLeft: 14, paddingRight: 18, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, borderWidth: 2, borderColor: C.amber },
  pillIcon: { fontSize: 18 },
  pillText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 70, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  backdropMobile: { padding: 0 },
  inviteCard: { width: '100%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 26, paddingTop: 30, paddingBottom: 18, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 12 } },
  inviteBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.amberSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  inviteBadgeText: { fontSize: 32 },
  inviteEyebrow: { color: C.primary, fontSize: 11.5, fontWeight: '900', letterSpacing: 1 },
  inviteTitle: { color: C.ink, fontSize: 24, fontWeight: '900', marginTop: 6, textAlign: 'center' },
  inviteText: { color: C.muted, fontSize: 15, lineHeight: 21, fontWeight: '500', textAlign: 'center', marginTop: 8 },
  primaryBtn: { alignSelf: 'stretch', marginTop: 20, backgroundColor: C.primary, borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  laterBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 12 },
  laterBtnText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  close: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F4F9', zIndex: 2 },
  closeOnGame: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  closeText: { color: C.ink, fontSize: 15, fontWeight: '900' },
  gameSheet: { width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: '#F6F8FC', borderRadius: 22, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 12 } },
  gameSheetMobile: { maxWidth: '100%', height: '100%', borderRadius: 0 },
  gameScroll: { paddingTop: 8 },
  pressed: { opacity: 0.85 },
});
