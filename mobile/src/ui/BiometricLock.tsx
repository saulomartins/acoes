import React, { ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { AppButton } from './components';
import { PromptBenefits, PromptError, PromptLink, PromptSheet } from './PromptSheet';
import StoreReviewPrompt from './StoreReviewPrompt';
import { colors, layout, shadow } from './theme';
import { AuthContext } from '../context/AuthContext';
import {
  authenticateWithBiometrics,
  BiometricKind,
  getBiometricKind,
  getLastActiveAt,
  isBiometricAvailable,
  isBiometricEnabled,
  markBiometricAsked,
  recordLastActive,
  setBiometricEnabled,
  wasBiometricAsked,
} from '../services/biometricAuth';

// Tempo fora do app (minimizado ou fechado) a partir do qual a biometria é
// pedida de novo. Curto demais irritaria quem sai para copiar um código Pix
// e volta.
const RELOCK_AFTER_MS = 5 * 60 * 1000;

type GateState = 'checking' | 'locked' | 'open';

const kindCopy: Record<BiometricKind, { noun: string }> = {
  fingerprint: { noun: 'sua digital' },
  face: { noun: 'o reconhecimento facial' },
  generic: { noun: 'sua digital ou rosto' },
};

// Trava do app nativo: cobre a navegação (sem desmontá-la) enquanto a
// biometria não for confirmada. Entra quando a pessoa passou RELOCK_AFTER_MS
// ou mais fora do app, seja voltando do segundo plano, seja reabrindo o app
// do zero com a sessão salva.
// Login explícito com senha nunca trava — em vez disso, oferece ativar a
// biometria uma única vez por usuário neste aparelho.
export default function BiometricGate({ children }: { children: ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <NativeBiometricGate>{children}</NativeBiometricGate>;
}

function NativeBiometricGate({ children }: { children: ReactNode }) {
  const { userToken, user, isLoading, signOut } = useContext(AuthContext);
  // Começa em 'checking' para a tela do app não aparecer nem por um frame
  // antes de sabermos se a sessão restaurada precisa de biometria.
  const [state, setState] = useState<GateState>('checking');
  const [kind, setKind] = useState<BiometricKind>('generic');
  const [offerVisible, setOfferVisible] = useState(false);
  const restoreChecked = useRef(false);
  const previousToken = useRef<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);
  const userId = user?.id ?? null;

  useEffect(() => { void getBiometricKind().then(setKind); }, []);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticateWithBiometrics()) setState('open');
    } finally {
      prompting.current = false;
    }
  }, []);

  const lockIfEnabled = useCallback(async (id: string) => {
    const shouldLock = (await isBiometricEnabled(id)) && (await isBiometricAvailable());
    if (!shouldLock) { setState('open'); return; }
    setState('locked');
    void unlock();
  }, [unlock]);

  // Primeira vez que o AuthProvider termina de restaurar a sessão.
  useEffect(() => {
    if (isLoading || restoreChecked.current) return;
    restoreChecked.current = true;
    previousToken.current = userToken;
    if (!userToken || !userId) { setState('open'); return; }
    void (async () => {
      const lastActiveAt = await getLastActiveAt();
      if (lastActiveAt && Date.now() - lastActiveAt < RELOCK_AFTER_MS) setState('open');
      else await lockIfEnabled(userId);
    })();
  }, [isLoading, userToken, userId, lockIfEnabled]);

  // Depois da restauração: sessão que surge do nada é login explícito
  // (senha ou cadastro) — oferece a biometria. Sessão que some (sair, sessão
  // expirada) destrava, porque a tela de login já protege o app.
  useEffect(() => {
    if (!restoreChecked.current) return;
    const hadToken = previousToken.current;
    previousToken.current = userToken;
    if (!userToken) { setState('open'); setOfferVisible(false); return; }
    if (hadToken || !userId) return;
    setState('open');
    void (async () => {
      if ((await wasBiometricAsked(userId)) || !(await isBiometricAvailable())) return;
      await markBiometricAsked(userId);
      setOfferVisible(true);
    })();
  }, [userToken, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') {
        backgroundedAt.current = Date.now();
        // Só com o app destravado: sair da tela de bloqueio e reabrir em
        // seguida não pode contar como "estava em uso" e pular a digital.
        if (userToken && state === 'open') void recordLastActive();
        return;
      }
      if (next !== 'active' || backgroundedAt.current === null) return;
      const away = Date.now() - backgroundedAt.current;
      backgroundedAt.current = null;
      if (away >= RELOCK_AFTER_MS && userToken && userId && state === 'open') void lockIfEnabled(userId);
    });
    return () => subscription.remove();
  }, [userToken, userId, state, lockIfEnabled]);

  const covered = !!userToken && state !== 'open';
  const copy = kindCopy[kind];

  return (
    <View style={styles.root}>
      {children}
      {covered ? (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.logo} resizeMode="contain" />
            {state === 'checking' ? (
              <ActivityIndicator size="large" color={colors.primary} />
            ) : (
              <>
                <Text style={styles.title}>App bloqueado</Text>
                <Text style={styles.subtitle}>Use {copy.noun} para continuar{user?.username ? ` como ${user.username}` : ''}.</Text>
                <AppButton title="Desbloquear" onPress={() => void unlock()} />
                <PromptLink label="Entrar com senha" onPress={() => void signOut()} />
              </>
            )}
          </View>
        </View>
      ) : null}
      {userId ? <BiometricOfferModal visible={offerVisible} kind={kind} userId={userId} onClose={() => setOfferVisible(false)} /> : null}
      {/* Mora aqui para nunca abrir por cima da trava nem do convite da
          biometria — um convite por vez. */}
      <StoreReviewPrompt blocked={covered || offerVisible} />
    </View>
  );
}

type OfferStep = 'ask' | 'confirming' | 'failed' | 'done';

// Convite para ativar a biometria, mostrado uma vez logo após o login com
// senha. Substitui o Alert nativo, que não permitia explicar o que muda nem
// mostrar erro/sucesso da confirmação.
function BiometricOfferModal({ visible, kind, userId, onClose }: { visible: boolean; kind: BiometricKind; userId: string; onClose: () => void }) {
  const [step, setStep] = useState<OfferStep>('ask');
  const copy = kindCopy[kind];

  useEffect(() => { if (visible) setStep('ask'); }, [visible]);

  const activate = async () => {
    setStep('confirming');
    setStep((await enableBiometrics(userId)) ? 'done' : 'failed');
  };

  if (step === 'done') {
    return (
      <PromptSheet visible={visible} onClose={onClose} icon="✓" tone="success" title="Biometria ativada" subtitle={`Na próxima vez que abrir o Lar em Dia, é só usar ${copy.noun}.`}>
        <AppButton title="Continuar" onPress={onClose} />
      </PromptSheet>
    );
  }

  return (
    <PromptSheet visible={visible} onClose={onClose} icon="🔐" eyebrow="MAIS PRATICIDADE" title={`Entrar com ${copy.noun}?`} subtitle="Desbloqueie o app sem digitar a senha.">
      <PromptBenefits items={['Abre o app com um toque', 'Sua senha não fica salva no celular', 'Dá para desligar pelo menu']} />
      {step === 'failed' ? <PromptError message={`Não conseguimos confirmar ${copy.noun}. Tente de novo.`} /> : null}
      <AppButton title={step === 'failed' ? 'Tentar novamente' : 'Ativar biometria'} loading={step === 'confirming'} onPress={() => void activate()} />
      <PromptLink label="Agora não" onPress={onClose} disabled={step === 'confirming'} />
    </PromptSheet>
  );
}

// Confirma a biometria antes de ligar: garante que funciona neste aparelho e
// que quem está ativando é o dono da digital/rosto cadastrado.
export const enableBiometrics = async (userId: string) => {
  if (!(await authenticateWithBiometrics('Confirme para ativar a biometria'))) return false;
  await setBiometricEnabled(userId, true);
  return true;
};

// Estado do interruptor "Desbloqueio por biometria" do menu. available fica
// false na web e em aparelho sem biometria cadastrada — aí o item nem aparece.
export const useBiometricSetting = () => {
  const { user } = useContext(AuthContext);
  const userId = user?.id ?? null;
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!userId || Platform.OS === 'web') { setAvailable(false); return; }
    let active = true;
    Promise.all([isBiometricAvailable(), isBiometricEnabled(userId)]).then(([canUse, isOn]) => {
      if (!active) return;
      setAvailable(canUse);
      setEnabled(isOn);
    });
    return () => { active = false; };
  }, [userId]);

  const toggle = useCallback(async () => {
    if (!userId) return;
    if (enabled) {
      await setBiometricEnabled(userId, false);
      setEnabled(false);
      return;
    }
    if (await enableBiometrics(userId)) setEnabled(true);
  }, [enabled, userId]);

  return { available, enabled, toggle };
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 18 },
  card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 24, alignItems: 'stretch', ...shadow },
  logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: 16 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7, marginBottom: 20, textAlign: 'center' },

});
