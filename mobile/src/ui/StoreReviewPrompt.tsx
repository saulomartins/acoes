import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { AppButton } from './components';
import { PromptBenefits, PromptError, PromptLink, PromptLinks, PromptSheet } from './PromptSheet';
import { AuthContext } from '../context/AuthContext';
import { CURRENT_TERMS_VERSION } from '../screens/TermsAcceptance';
import {
  isStoreReviewEnabled,
  markReviewDeclined,
  markReviewDone,
  openStoreReview,
  recordFirstUse,
  reviewStoreName,
  shouldPromptReview,
} from '../services/storeReview';

// Espera após abrir o app antes de convidar — ninguém quer um modal na cara
// no primeiro segundo, antes mesmo de ver o painel.
const SETTLE_MS = 4000;
const RECHECK_EVERY_MS = 60 * 1000;

// Só no app nativo (renderizado por NativeBiometricGate). `blocked` segura o
// convite enquanto a trava ou o convite da biometria estão na tela.
export default function StoreReviewPrompt({ blocked }: { blocked: boolean }) {
  const { userToken, user, needsProfileSelection, nativeAccessBlocked, platformSuspendedMessage } = useContext(AuthContext);
  const [visible, setVisible] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const checking = useRef(false);

  // Só convida quem já está no painel: fora das telas de bloqueio (trocar
  // senha, aceitar termos, escolher perfil, acesso bloqueado/suspenso).
  const inMainApp = !!userToken && !!user && !user.mustChangePassword && user.termsAcceptedVersion === CURRENT_TERMS_VERSION
    && !needsProfileSelection && !nativeAccessBlocked && !platformSuspendedMessage;
  const ready = inMainApp && !blocked && isStoreReviewEnabled();

  useEffect(() => { if (inMainApp) void recordFirstUse(); }, [inMainApp]);

  const check = useCallback(async () => {
    if (checking.current || visible) return;
    checking.current = true;
    try {
      if (await shouldPromptReview()) { setOpenFailed(false); setVisible(true); }
    } finally {
      checking.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!ready) return;
    const settle = setTimeout(() => void check(), SETTLE_MS);
    const interval = setInterval(() => void check(), RECHECK_EVERY_MS);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') setTimeout(() => void check(), SETTLE_MS); });
    return () => { clearTimeout(settle); clearInterval(interval); subscription.remove(); };
  }, [ready, check]);

  // Saiu da conta / caiu numa tela de bloqueio com o convite aberto.
  useEffect(() => { if (!ready) setVisible(false); }, [ready]);

  const rate = async () => {
    const opened = await openStoreReview().catch(() => false);
    if (!opened) { setOpenFailed(true); return; }
    await markReviewDone();
    setVisible(false);
  };

  const later = async () => {
    await markReviewDeclined();
    setVisible(false);
  };

  const alreadyRated = async () => {
    await markReviewDone();
    setVisible(false);
  };

  return (
    <PromptSheet
      visible={visible}
      onClose={() => void later()}
      icon="⭐"
      tone="amber"
      eyebrow="SUA OPINIÃO CONTA"
      title="Avalie o Lar em Dia"
      subtitle="Leva menos de 1 minuto e ajuda a melhorar o app para todos os moradores."
    >
      <PromptBenefits items={['Ajuda outros condomínios a conhecer o app', 'Suas sugestões guiam as próximas melhorias']} />
      {openFailed ? <PromptError message={`Não foi possível abrir a ${reviewStoreName} agora. Tente de novo mais tarde.`} /> : null}
      <AppButton title={`Avaliar na ${reviewStoreName}`} onPress={() => void rate()} />
      <PromptLinks>
        <PromptLink label="Agora não" onPress={() => void later()} />
        <PromptLink label="Já avaliei" muted onPress={() => void alreadyRated()} />
      </PromptLinks>
    </PromptSheet>
  );
}
