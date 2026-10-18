import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, TextInput } from './text';
import { API_BASE_URL } from '../api/client';
import { useBreakpoint } from './responsive';
import { BENEFITS, FEATURE_GROUPS, PROFILES } from '../content/landingContent';
import LiaMascot from './LiaMascot';

// "Lia", a atendente virtual do site. Balão flutuante que abre um chat por
// cima da landing e da página de pílulas (só web). Não é IA: as respostas
// vêm da busca das Pílulas do Condomínio (GET /pills/search), sempre com a
// base legal da pílula, e o que a busca não encontra vira pergunta para a
// equipe (POST /pills/questions) — custo zero e sem risco de inventar lei.
// A própria Lia se apresenta como assistente virtual, sem fingir ser gente.
// Perguntas sobre o próprio Lar em Dia ("o que faz?", "como me ajuda?", "como
// contratar?", "vocês administram?") não vão para a busca: têm resposta fixa
// em <AboutCard>, montada com o mesmo conteúdo da landing.

type PillSummary = { slug: string; title: string; category: string; summary: string };
type PillDetail = PillSummary & { sources: Array<{ label: string; url?: string }> };
type Message =
  | { id: number; from: 'bot' | 'user'; kind: 'text'; text: string }
  | { id: number; from: 'bot'; kind: 'answer'; pill: PillDetail; related: PillSummary[] }
  | { id: number; from: 'bot'; kind: 'about'; topic: AboutTopic; profile?: Profile };
// Omit "distributivo": aplica o Omit em cada variante da união, senão o TS
// achata a união e perde os campos específicos de cada tipo de mensagem.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type NewMessage = WithoutId<Message>;

const C = { primary: '#4F46E5', violet: '#7C3AED', ink: '#0F172A', muted: '#5B6472', border: '#E4E9F3', surface: '#FFFFFF', soft: '#F3F4FE', green: '#0EA57A' };

const TOPICS = [
  { label: 'Inadimplência', query: 'cobrar condômino inadimplente' },
  { label: 'Assembleias', query: 'convocação quórum assembleia' },
  { label: 'Obras e melhorias', query: 'custo da obra rateio extra' },
  { label: 'Inquilino x proprietário', query: 'inquilino proprietário quem paga' },
  { label: 'Valor do condomínio', query: 'calcular valor taxa condominial' },
];

// Só o que a landing já promete — nada de condição comercial inventada aqui.
const HIRING_STEPS = [
  'Preencha o formulário "Receber proposta personalizada" com o número de unidades e as funcionalidades que interessam.',
  'Nossa equipe entra em contato com a proposta. O valor depende do número de unidades e das funcionalidades contratadas.',
  'Implantação simplificada: o condomínio é configurado, o síndico recebe o acesso e cada morador entra com o próprio login.',
];
const CONTACT_EMAIL = 'laremdia.condominio@gmail.com';

export type AboutTopic = 'hiring' | 'features' | 'benefits' | 'independence';
type Profile = (typeof PROFILES)[number]['key'];

const ABOUT_LABELS: Record<Exclude<AboutTopic, 'independence'>, string> = {
  features: 'O que o sistema faz',
  benefits: 'Como ele pode me ajudar',
  hiring: 'Como contratar',
};

// Perguntas sobre o Lar em Dia em si (e não sobre direito condominial), e
// qual delas é: a ordem das regras importa. Termos que também aparecem em
// assunto de condomínio só contam junto com uma menção ao produto — "quanto
// custa uma obra" e "proposta de acordo" são pílulas, não contratação.
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const detectLarEmDiaIntent = (text: string): AboutTopic | null => {
  const value = normalize(text);
  if (/plano de reforma/.test(value)) return null;
  const mentionsProduct = /(lar ?em ?dia|\bsistema\b|aplicativo|\bapp\b|software|plataforma|\bvoces\b)/.test(value);
  if (/(contrat|assinatur|\bplanos?\b|demonstra|proposta(?! de acordo))/.test(value)) return 'hiring';
  if (mentionsProduct && /(\bpreco|quanto custa|\bvalor\b|mensalidade)/.test(value)) return 'hiring';
  if (/(administradora|\badministram\b|fazem a gestao|quem (faz|cuida) da gestao)/.test(value)) return 'independence';
  if (/(vantage|benefici|vale a pena)/.test(value) || (mentionsProduct && /(ajud|por ?que usar|melhora)/.test(value))) return 'benefits';
  if (mentionsProduct || /funcionalidade/.test(value)) return 'features';
  return null;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LiaAvatar = ({ size = 40 }: { size?: number }) => (
  <View style={{ width: size, height: size }}>
    <View style={[styles.avatarRing, { borderRadius: size / 2 }]}><LiaMascot size={size - 4} /></View>
    <View style={[styles.onlineDot, { width: size * 0.26, height: size * 0.26, borderRadius: size * 0.13 }]} />
  </View>
);

const TypingDots = () => {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(progress, { toValue: 3, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [progress]);
  return (
    <View style={[styles.bubble, styles.bubbleBot, styles.typing]}>
      {[0, 1, 2].map((index) => (
        <Animated.View key={index} style={[styles.typingDot, { opacity: progress.interpolate({ inputRange: [0, index, index + 0.5, index + 1, 3], outputRange: [0.3, 0.3, 1, 0.3, 0.3], extrapolate: 'clamp' }) }]} />
      ))}
    </View>
  );
};

const IndependenceNote = () => (
  <View style={styles.independence}>
    <Text style={styles.independenceText}>O Lar em Dia <Text style={styles.bold}>não é uma administradora</Text> e não faz a gestão do seu condomínio. Nós oferecemos a plataforma para que o <Text style={styles.bold}>síndico e o subsíndico</Text> façam a gestão com <Text style={styles.bold}>independência</Text>, sem depender de terceiros.</Text>
  </View>
);

// Respostas fixas sobre o próprio Lar em Dia. Cada cartão termina com atalhos
// para os outros temas, para a conversa seguir sem a pessoa precisar digitar.
const AboutCard = ({ topic, profile, onFollowUp, onRequestProposal }: { topic: AboutTopic; profile?: Profile; onFollowUp: (topic: AboutTopic) => void; onRequestProposal?: () => void }) => {
  const followUps = (Object.keys(ABOUT_LABELS) as Array<keyof typeof ABOUT_LABELS>).filter((key) => key !== topic);
  const profileContent = PROFILES.find((item) => item.key === profile);
  const isManager = profile !== 'moradores';
  return (
    <View style={[styles.bubble, styles.bubbleBot, styles.answer]}>
      <Text style={styles.answerCategory}>SOBRE O LAR EM DIA</Text>

      {topic === 'features' ? (
        <>
          <Text style={styles.answerTitle}>O que o Lar em Dia faz</Text>
          <Text style={styles.answerText}>É uma plataforma completa de gestão condominial, no computador e no celular. Ela reúne:</Text>
          {FEATURE_GROUPS.map((group) => (
            <View key={group.title} style={styles.featureGroup}>
              <Text style={styles.featureGroupTitle}>{group.title}</Text>
              <Text style={styles.featureGroupItems}>{group.items.join(' · ')}</Text>
            </View>
          ))}
          <IndependenceNote />
        </>
      ) : null}

      {topic === 'benefits' ? (
        <>
          <Text style={styles.answerTitle}>Como o Lar em Dia ajuda {isManager ? 'síndicos e subsíndicos' : 'moradores'}</Text>
          {(profileContent?.bullets || []).map((bullet) => (
            <View key={bullet} style={styles.stepRow}><Text style={styles.check}>✓</Text><Text style={styles.stepText}>{bullet}</Text></View>
          ))}
          {isManager ? (
            <>
              {BENEFITS.slice(0, 4).map((benefit) => (
                <View key={benefit.title} style={styles.stepRow}><Text style={styles.check}>✓</Text><Text style={styles.stepText}>{benefit.title}</Text></View>
              ))}
              <IndependenceNote />
            </>
          ) : (
            <Text style={styles.answerText}>Quem contrata o Lar em Dia é o condomínio. Se você gostou, mostre para o seu síndico. 😉</Text>
          )}
        </>
      ) : null}

      {topic === 'hiring' ? (
        <>
          <Text style={styles.answerTitle}>Como contratar o Lar em Dia</Text>
          <IndependenceNote />
          {HIRING_STEPS.map((step, index) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
          <Text style={styles.answerText}>E, se precisar, o suporte é direto com quem desenvolve o sistema.</Text>
          <View style={styles.salesActions}>
            {onRequestProposal ? <Pressable onPress={onRequestProposal} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, styles.chipStrongText]}>Pedir proposta</Text></Pressable> : null}
            <Pressable onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Quero conhecer o Lar em Dia')}`)} style={styles.chip}><Text style={styles.chipText}>Falar por e-mail</Text></Pressable>
          </View>
        </>
      ) : null}

      {topic === 'independence' ? (
        <>
          <Text style={styles.answerTitle}>Quem faz a gestão do condomínio?</Text>
          <IndependenceNote />
          <Text style={styles.answerText}>As decisões continuam com vocês. O Lar em Dia entrega as ferramentas (cobrança, prestação de contas, comunicação, ocorrências e reservas) e o suporte direto com quem desenvolve o sistema.</Text>
        </>
      ) : null}

      <Text style={styles.followUpLabel}>Quer saber mais?</Text>
      <View style={styles.salesActions}>
        {followUps.map((key) => <Pressable key={key} onPress={() => onFollowUp(key)} style={styles.chip}><Text style={styles.chipText}>{ABOUT_LABELS[key]}</Text></Pressable>)}
      </View>
    </View>
  );
};

export default function ChatAssistant({ onOpenPill, onRequestProposal }: { onOpenPill: (slug: string) => void; onRequestProposal?: () => void }) {
  const { isDesktop, isTablet } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  // Pergunta sem resposta aguardando o e-mail (opcional) antes de ir para a equipe.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // Quais botões aparecem abaixo da conversa: os assuntos de sempre, o menu
  // "Conhecer o Lar em Dia" ou a escolha de perfil antes de "como me ajuda".
  const [chipMode, setChipMode] = useState<'default' | 'about' | 'profile'>('default');
  const nextId = useRef(1);
  const scrollRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setTeaser(true), 5000);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { clearTimeout(timer); loop.stop(); };
  }, [pulse]);

  const push = (message: NewMessage) => setMessages((current) => [...current, { ...message, id: nextId.current++ } as Message]);
  const botSays = async (text: string, delay = 650) => {
    setTyping(true);
    await wait(delay);
    setTyping(false);
    push({ from: 'bot', kind: 'text', text });
  };

  const openChat = async () => {
    setOpen(true);
    setTeaser(false);
    if (messages.length) return;
    await botSays('Oi! Eu sou a Lia, assistente virtual do Lar em Dia. 👋', 500);
    await botSays('Posso ajudar com dúvidas de condomínio: cobrança, assembleias, obras, inquilinos e mais. Sempre mostro a lei de onde tirei a resposta. Também explico como funciona e como contratar o Lar em Dia.');
    await botSays('Escreva sua pergunta ou escolha um assunto abaixo.', 400);
  };

  const sendQuestionToTeam = async (question: string, email: string) => {
    setTyping(true);
    try {
      const response = await fetch(`${API_BASE_URL}/pills/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, email }) });
      const data = await response.json().catch(() => null);
      setTyping(false);
      if (!response.ok) { await botSays(data?.message || 'Não consegui registrar sua pergunta agora. Tente de novo em alguns minutos.', 200); return; }
      setPendingQuestion(null);
      await botSays(email ? 'Pronto! Sua pergunta foi para a nossa equipe, e eu aviso por e-mail quando a resposta virar uma pílula. 💜' : 'Pronto! Sua pergunta foi para a nossa equipe e pode virar uma nova pílula em breve. 💜', 200);
    } catch {
      setTyping(false);
      await botSays('Não consegui registrar sua pergunta agora. Verifique sua conexão e tente de novo.', 200);
    }
  };

  const explainAbout = async (question: string, topic: AboutTopic) => {
    push({ from: 'user', kind: 'text', text: question });
    setChipMode('default');
    if (topic === 'benefits') {
      await botSays('Para eu mostrar o que muda para você: você é síndico(a)/subsíndico(a) ou morador(a)?', 600);
      setChipMode('profile');
      return;
    }
    setTyping(true);
    await wait(700);
    setTyping(false);
    push({ from: 'bot', kind: 'about', topic });
  };

  const chooseProfile = async (profile: Profile) => {
    push({ from: 'user', kind: 'text', text: PROFILES.find((item) => item.key === profile)?.label || '' });
    setChipMode('default');
    setTyping(true);
    await wait(600);
    setTyping(false);
    push({ from: 'bot', kind: 'about', topic: 'benefits', profile });
  };

  const showAboutMenu = async () => {
    push({ from: 'user', kind: 'text', text: 'Quero conhecer o Lar em Dia' });
    await botSays('Claro! O que você quer saber?', 500);
    setChipMode('about');
  };

  const ask = async (question: string) => {
    setChipMode('default');
    const topic = detectLarEmDiaIntent(question);
    if (topic) { await explainAbout(question, topic); return; }
    push({ from: 'user', kind: 'text', text: question });
    setTyping(true);
    try {
      const [searchResponse] = await Promise.all([fetch(`${API_BASE_URL}/pills/search?q=${encodeURIComponent(question)}`), wait(700)]);
      const results: PillSummary[] = searchResponse.ok ? (await searchResponse.json()).pills : [];
      if (!results.length) {
        setTyping(false);
        if (question.trim().length < 10) { await botSays('Não achei nada sobre isso. Pode me contar a dúvida com um pouco mais de detalhe?', 200); return; }
        setPendingQuestion(question);
        await botSays('Ainda não tenho uma resposta com base legal para essa dúvida. 🤔', 200);
        await botSays('Posso enviar sua pergunta para a nossa equipe. Se quiser ser avisado(a) da resposta, digite seu e-mail abaixo, ou toque em "Enviar sem e-mail".', 500);
        return;
      }
      const detailResponse = await fetch(`${API_BASE_URL}/pills/${encodeURIComponent(results[0].slug)}`);
      const pill: PillDetail = detailResponse.ok ? (await detailResponse.json()).pill : { ...results[0], sources: [] };
      setTyping(false);
      push({ from: 'bot', kind: 'answer', pill, related: results.slice(1, 3) });
    } catch {
      setTyping(false);
      await botSays('Tive um problema para buscar agora. Tente de novo em instantes.', 200);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput('');
    if (pendingQuestion) {
      push({ from: 'user', kind: 'text', text });
      if (!isValidEmail(text.toLowerCase())) { botSays('Esse e-mail não parece válido. Confira, ou toque em "Enviar sem e-mail".', 300); return; }
      sendQuestionToTeam(pendingQuestion, text.toLowerCase());
      return;
    }
    ask(text);
  };

  // Resposta com pílula (ou o cartão de contratação) é longa: rolar até o fim esconderia o título.
  // Nesse caso quem rola é o onLayout da própria resposta (até o topo dela).
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!open || ((lastMessage?.kind === 'answer' || lastMessage?.kind === 'about') && !typing)) return;
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages, typing, open]);

  const panelStyle = isDesktop || isTablet ? styles.panelWide : styles.panelPhone;
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {open ? (
        <View style={[styles.panel, panelStyle]}>
          <LinearGradient colors={[C.primary, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
            <LiaAvatar size={38} />
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName}>Lia · Lar em Dia</Text>
              <Text style={styles.headerStatus}>Assistente virtual · responde com base na lei</Text>
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable>
          </LinearGradient>

          <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyContent}>
            {messages.map((message) => {
              if (message.kind === 'about') {
                return (
                  <View key={message.id} style={styles.botRow} onLayout={(event) => { if (message.id === lastMessage?.id) scrollRef.current?.scrollTo({ y: Math.max(event.nativeEvent.layout.y - 8, 0), animated: true }); }}>
                    <AboutCard topic={message.topic} profile={message.profile} onFollowUp={(topic) => explainAbout(ABOUT_LABELS[topic as keyof typeof ABOUT_LABELS], topic)} onRequestProposal={onRequestProposal ? () => { setOpen(false); onRequestProposal(); } : undefined} />
                  </View>
                );
              }
              if (message.kind === 'answer') {
                const { pill, related } = message;
                return (
                  <View key={message.id} style={styles.botRow} onLayout={(event) => { if (message.id === lastMessage?.id) scrollRef.current?.scrollTo({ y: Math.max(event.nativeEvent.layout.y - 8, 0), animated: true }); }}>
                    <View style={[styles.bubble, styles.bubbleBot, styles.answer]}>
                      <Text style={styles.answerCategory}>{pill.category.toUpperCase()}</Text>
                      <Text style={styles.answerTitle}>{pill.title}</Text>
                      <Text style={styles.answerText}>{pill.summary}</Text>
                      {pill.sources.length ? (
                        <View style={styles.answerSources}>
                          <Text style={styles.answerSourcesLabel}>📚 Base legal</Text>
                          {pill.sources.map((source) => <Text key={source.label} style={styles.answerSource}>• {source.label}</Text>)}
                        </View>
                      ) : null}
                      <Pressable onPress={() => onOpenPill(pill.slug)}><Text style={styles.answerLink}>Ler a resposta completa →</Text></Pressable>
                      {related.length ? <Text style={styles.relatedLabel}>Veja também:</Text> : null}
                      {related.map((item) => <Pressable key={item.slug} onPress={() => onOpenPill(item.slug)}><Text style={styles.relatedLink}>{item.title}</Text></Pressable>)}
                    </View>
                  </View>
                );
              }
              const fromBot = message.from === 'bot';
              return (
                <View key={message.id} style={fromBot ? styles.botRow : styles.userRow}>
                  <View style={[styles.bubble, fromBot ? styles.bubbleBot : styles.bubbleUser]}>
                    <Text style={fromBot ? styles.botText : styles.userText}>{message.text}</Text>
                  </View>
                </View>
              );
            })}
            {typing ? <View style={styles.botRow}><TypingDots /></View> : null}

            {!typing && messages.length ? (
              <View style={styles.chips}>
                {pendingQuestion ? (
                  <>
                    <Pressable onPress={() => { push({ from: 'user', kind: 'text', text: 'Enviar sem e-mail' }); sendQuestionToTeam(pendingQuestion, ''); }} style={styles.chip}><Text style={styles.chipText}>Enviar sem e-mail</Text></Pressable>
                    <Pressable onPress={() => { setPendingQuestion(null); botSays('Tudo bem! Se quiser, me pergunte outra coisa.', 300); }} style={styles.chip}><Text style={styles.chipText}>Não, obrigado(a)</Text></Pressable>
                  </>
                ) : chipMode === 'about' ? (
                  <>
                    {(Object.keys(ABOUT_LABELS) as Array<keyof typeof ABOUT_LABELS>).map((key) => <Pressable key={key} onPress={() => explainAbout(ABOUT_LABELS[key], key)} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, styles.chipStrongText]}>{ABOUT_LABELS[key]}</Text></Pressable>)}
                  </>
                ) : chipMode === 'profile' ? (
                  <>
                    <Pressable onPress={() => chooseProfile('sindicos')} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, styles.chipStrongText]}>Síndico(a) / subsíndico(a)</Text></Pressable>
                    <Pressable onPress={() => chooseProfile('moradores')} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, styles.chipStrongText]}>Morador(a)</Text></Pressable>
                  </>
                ) : (
                  <>
                    {TOPICS.map((topic) => <Pressable key={topic.label} onPress={() => ask(topic.query)} style={styles.chip}><Text style={styles.chipText}>{topic.label}</Text></Pressable>)}
                    <Pressable onPress={showAboutMenu} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, styles.chipStrongText]}>Conhecer o Lar em Dia</Text></Pressable>
                  </>
                )}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <TextInput
              value={input}
              onChangeText={(value) => setInput(value.slice(0, 1000))}
              onSubmitEditing={submit}
              returnKeyType="send"
              placeholder={pendingQuestion ? 'Seu e-mail (opcional)' : 'Digite sua dúvida...'}
              placeholderTextColor="#98A2B3"
              autoCapitalize={pendingQuestion ? 'none' : 'sentences'}
              keyboardType={pendingQuestion ? 'email-address' : 'default'}
              style={styles.input}
            />
            <Pressable onPress={submit} style={({ pressed }) => [styles.send, pressed && { opacity: 0.85 }]}><Text style={styles.sendText}>➤</Text></Pressable>
          </View>
          <Text style={styles.disclaimer}>Conteúdo informativo. Não substitui a orientação de um advogado.</Text>
        </View>
      ) : null}

      {!open && teaser ? (
        <Pressable onPress={openChat} style={styles.teaser}>
          <Text style={styles.teaserText}>Oi! Sou a Lia 👋 Tem alguma dúvida de condomínio?</Text>
          <Pressable onPress={() => setTeaser(false)} hitSlop={8}><Text style={styles.teaserClose}>✕</Text></Pressable>
        </Pressable>
      ) : null}

      {!open ? (
        <Pressable onPress={openChat} style={styles.launcher} accessibilityLabel="Abrir chat com a Lia, assistente virtual">
          <Animated.View style={[styles.pulse, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]} />
          <LiaAvatar size={60} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', right: 0, bottom: 0, left: 0, top: 0, zIndex: 50, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 16 },
  avatarRing: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', overflow: 'hidden' },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, backgroundColor: C.green, borderWidth: 2, borderColor: '#fff' },
  launcher: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  pulse: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: C.violet },
  teaser: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 280, backgroundColor: C.surface, borderRadius: 16, borderBottomRightRadius: 4, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, shadowColor: '#14243a', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  teaserText: { flex: 1, color: C.ink, fontWeight: '700', fontSize: 13.5, lineHeight: 19 },
  teaserClose: { color: C.muted, fontWeight: '900', fontSize: 12 },
  panel: { backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.border, shadowColor: '#14243a', shadowOpacity: 0.22, shadowRadius: 30, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  panelWide: { width: 380, height: 580, maxHeight: '90%' },
  panelPhone: { width: '100%', height: '88%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  headerName: { color: '#fff', fontWeight: '900', fontSize: 15.5 },
  headerStatus: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, fontWeight: '600', marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  body: { flex: 1, backgroundColor: '#F8F9FD' },
  bodyContent: { padding: 14, gap: 8 },
  botRow: { alignItems: 'flex-start' },
  userRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10 },
  bubbleBot: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleUser: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  botText: { color: C.ink, fontSize: 14, lineHeight: 20 },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: 14 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.violet },
  answer: { maxWidth: '94%' },
  answerCategory: { color: C.violet, fontSize: 10.5, fontWeight: '900', letterSpacing: 0.7 },
  answerTitle: { color: C.ink, fontSize: 14.5, fontWeight: '900', lineHeight: 19, marginTop: 4 },
  answerText: { color: C.ink, fontSize: 13.5, lineHeight: 19.5, marginTop: 6 },
  answerSources: { backgroundColor: '#EAF8F3', borderRadius: 10, padding: 10, marginTop: 10 },
  answerSourcesLabel: { color: C.ink, fontWeight: '900', fontSize: 12, marginBottom: 4 },
  answerSource: { color: C.ink, fontSize: 12, lineHeight: 17 },
  answerLink: { color: C.primary, fontWeight: '900', fontSize: 13, marginTop: 10 },
  relatedLabel: { color: C.muted, fontSize: 12, fontWeight: '800', marginTop: 10 },
  relatedLink: { color: C.primary, fontSize: 12.5, fontWeight: '700', marginTop: 4, textDecorationLine: 'underline' },
  independence: { backgroundColor: '#EEF0FE', borderLeftWidth: 3, borderLeftColor: C.primary, borderRadius: 8, padding: 10, marginTop: 8 },
  independenceText: { color: C.ink, fontSize: 13.5, lineHeight: 19.5 },
  bold: { fontWeight: '900' },
  stepsTitle: { color: C.ink, fontWeight: '900', fontSize: 13.5, marginTop: 12, marginBottom: 6 },
  stepRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  stepNumber: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumberText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  stepText: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 18.5 },
  salesActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  featureGroup: { marginTop: 10 },
  featureGroupTitle: { color: C.primary, fontWeight: '900', fontSize: 13 },
  featureGroupItems: { color: C.ink, fontSize: 13, lineHeight: 19, marginTop: 2 },
  check: { color: C.green, fontWeight: '900', fontSize: 13, marginTop: 1 },
  followUpLabel: { color: C.muted, fontSize: 12, fontWeight: '800', marginTop: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1.5, borderColor: '#D9DCFB', backgroundColor: C.soft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: C.primary, fontWeight: '800', fontSize: 12.5 },
  chipStrong: { backgroundColor: C.primary, borderColor: C.primary },
  chipStrongText: { color: '#fff' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface },
  input: { flex: 1, minHeight: 44, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 14, color: C.ink, fontSize: 14, backgroundColor: '#F8F9FD' },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  disclaimer: { color: C.muted, fontSize: 10.5, textAlign: 'center', paddingBottom: 8, backgroundColor: C.surface },
});
