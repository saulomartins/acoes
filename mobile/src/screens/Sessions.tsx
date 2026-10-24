import React, { useCallback, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { apiRequest } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { AppButton, AppDialog, EmptyState, Panel } from '../ui/components';
import { colors, layout } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { getBiometricLogin } from '../services/biometricAuth';

type Session = { id: string; startedAt: string; lastActiveAt: string; ipAddress: string | null; userAgent: string | null; current: boolean };

// Nome legível do aparelho a partir do user-agent gravado na sessão. O app
// nativo (Android) chega como okhttp e o de iPhone como CFNetwork/Darwin.
const deviceLabel = (userAgent: string | null) => {
  const ua = userAgent || '';
  if (!ua) return 'Aparelho desconhecido';
  if (/okhttp/i.test(ua)) return 'App Lar em Dia · Android';
  if (/CFNetwork|Darwin/i.test(ua)) return 'App Lar em Dia · iPhone';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} · ${system}` : browser;
};

const formatDateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Sessions() {
  const { isMobile: compact } = useBreakpoint();
  const { userToken } = useContext(AuthContext);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'one'; session: Session } | { kind: 'others' } | null>(null);
  const [dialog, setDialog] = useState({ visible: false, title: '', message: '', tone: 'info' as 'info' | 'success' | 'error' });
  const show = (title: string, message: string, tone: 'info' | 'success' | 'error' = 'info') => setDialog({ visible: true, title, message, tone });

  const load = useCallback(async (silent = false) => {
    if (!userToken) return;
    if (!silent) setLoading(true);
    try {
      const data = await apiRequest<{ sessions: Session[] }>('/auth/sessions', userToken);
      setSessions(data.sessions);
    } catch (e) {
      if (!silent) show('Não foi possível carregar', e instanceof Error ? e.message : 'Tente novamente.', 'error');
    } finally { setLoading(false); }
  }, [userToken]);
  useEffect(() => { load(); }, [load]);

  const revokeOne = async (session: Session) => {
    setConfirm(null);
    if (!userToken || busy) return;
    setBusy(session.id);
    try {
      await apiRequest(`/auth/sessions/${session.id}`, userToken, { method: 'DELETE' });
      await load(true);
      show('Aparelho desconectado', `${deviceLabel(session.userAgent)} precisará entrar de novo com a senha.`, 'success');
    } catch (e) { show('Não foi possível desconectar', e instanceof Error ? e.message : 'Tente novamente.', 'error'); }
    finally { setBusy(null); }
  };

  const revokeOthers = async () => {
    setConfirm(null);
    if (!userToken || busy) return;
    setBusy('others');
    try {
      // A credencial de biometria DESTE aparelho continua valendo; as dos
      // outros caem junto com as sessões.
      const biometric = await getBiometricLogin();
      const data = await apiRequest<{ revoked: number }>('/auth/sessions/revoke-others', userToken, {
        method: 'POST', body: JSON.stringify({ keepBiometricToken: biometric?.token || null }),
      });
      await load(true);
      show('Pronto', data.revoked ? `${data.revoked} outro(s) acesso(s) encerrado(s). Só este aparelho continua conectado.` : 'Não havia outros aparelhos conectados.', 'success');
    } catch (e) { show('Não foi possível encerrar', e instanceof Error ? e.message : 'Tente novamente.', 'error'); }
    finally { setBusy(null); }
  };

  const others = sessions.filter(session => !session.current);

  return <>
    <ScrollView contentContainerStyle={[s.container, compact && s.containerMobile]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />}>
      <View>
        <Text style={s.eyebrow}>SEGURANÇA</Text>
        <Text style={s.title}>Dispositivos conectados</Text>
        <Text style={s.subtitle}>Onde sua conta está aberta agora. Se não reconhecer algum acesso, desconecte e troque sua senha.</Text>
      </View>

      <Panel>
        <Text style={s.panelTitle}>Sair de todos os outros aparelhos</Text>
        <Text style={s.panelText}>Encerra o acesso em todos os aparelhos e navegadores, menos neste. A entrada por biometria dos outros aparelhos também é desligada.</Text>
        <View style={s.action}>
          <AppButton title="Sair dos outros aparelhos" variant="danger" loading={busy === 'others'} disabled={!others.length} onPress={() => setConfirm({ kind: 'others' })} />
        </View>
      </Panel>

      <Text style={s.section}>Acessos ativos</Text>
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : sessions.length === 0 ? (
        <EmptyState title="Nenhum acesso ativo" description="Puxe para atualizar." />
      ) : sessions.map(session => (
        <View key={session.id} style={[s.card, session.current && s.cardCurrent]}>
          <View style={s.cardTop}>
            <View style={s.grow}>
              <Text style={s.cardName}>{deviceLabel(session.userAgent)}</Text>
              <Text style={s.cardMeta}>Última atividade: {formatDateTime(session.lastActiveAt)}</Text>
              <Text style={s.cardMeta}>Entrou em: {formatDateTime(session.startedAt)}{session.ipAddress ? ` · IP ${session.ipAddress}` : ''}</Text>
            </View>
            {session.current ? <Text style={s.badge}>Este aparelho</Text> : null}
          </View>
          {!session.current ? (
            <View style={s.cardActions}>
              <AppButton title="Desconectar" variant="secondary" loading={busy === session.id} onPress={() => setConfirm({ kind: 'one', session })} />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
    <AppDialog {...dialog} onClose={() => setDialog(d => ({ ...d, visible: false }))} />
    <AppDialog
      visible={!!confirm}
      title={confirm?.kind === 'others' ? 'Sair dos outros aparelhos?' : 'Desconectar este acesso?'}
      message={confirm?.kind === 'others'
        ? 'Todos os outros aparelhos e navegadores precisarão entrar de novo com a senha.'
        : confirm?.kind === 'one' ? `${deviceLabel(confirm.session.userAgent)} precisará entrar de novo com a senha.` : ''}
      confirmLabel={confirm?.kind === 'others' ? 'Sair dos outros' : 'Desconectar'}
      cancelLabel="Cancelar"
      tone="error"
      onConfirm={() => { if (confirm?.kind === 'others') void revokeOthers(); else if (confirm?.kind === 'one') void revokeOne(confirm.session); }}
      onClose={() => setConfirm(null)}
    />
  </>;
}

const s = StyleSheet.create({
  container: { width: '100%', maxWidth: 950, alignSelf: 'center', padding: 24, paddingBottom: 50, backgroundColor: colors.background, gap: 16 },
  containerMobile: { padding: 16 },
  grow: { flex: 1 },
  eyebrow: { color: colors.teal, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 15.5, lineHeight: 21, marginTop: 5 },
  panelTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  panelText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  action: { alignSelf: 'flex-end', minWidth: 220, marginTop: 16 },
  section: { color: colors.ink, fontSize: 19, fontWeight: '900', marginBottom: -4 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 16 },
  cardCurrent: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardName: { color: colors.ink, fontSize: 15.5, fontWeight: '900' },
  cardMeta: { color: colors.muted, fontSize: 12.5, marginTop: 3 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11.5, fontWeight: '900', color: colors.primary, borderColor: colors.primary },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
});
