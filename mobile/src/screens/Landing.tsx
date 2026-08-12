import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../ui/text';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '../api/client';
import { useBreakpoint } from '../ui/responsive';
import { shadow } from '../ui/theme';
import { CardGrid } from '../ui/grid';

// Sistema visual próprio da landing: paleta sofisticada (índigo/violeta),
// cantos arredondados generosos e sombra suave discreta — deliberadamente
// mais "SaaS premium" do que o restante do app (ui/theme.ts), que segue um
// tom mais utilitário para as telas internas do sistema.
const C = {
  bg: '#F6F8FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1FA',
  ink: '#0F172A',
  muted: '#5B6472',
  border: '#E4E9F3',
  primary: '#4F46E5',
  primaryDark: '#372FA6',
  violet: '#7C3AED',
  emerald: '#0EA57A',
  amber: '#F0A028',
  red: '#E5484D',
  sky: '#0EA5E9',
};

// ---------- Componentes reutilizáveis ----------

const PillButton = ({ title, onPress, tone = 'primary', small }: { title: string; onPress: () => void; tone?: 'primary' | 'outline' | 'ghostLight'; small?: boolean }) => {
  if (tone === 'primary') {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressedShrink]}>
        <LinearGradient colors={[C.primary, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.btnPrimary, small && styles.btnSmall]}>
          <Text style={[styles.btnPrimaryText, small && styles.btnTextSmall]}>{title}</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  if (tone === 'ghostLight') {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.btnGhostLight, small && styles.btnSmall, pressed && styles.pressedShrink]}>
        <Text style={[styles.btnGhostLightText, small && styles.btnTextSmall]}>{title}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btnOutline, small && styles.btnSmall, pressed && styles.pressedShrink]}>
      <Text style={[styles.btnOutlineText, small && styles.btnTextSmall]}>{title}</Text>
    </Pressable>
  );
};

const SoftCard = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={[styles.softCard, style]}>{children}</View>
);

const TabRow = ({ tabs, active, onChange, scrollable }: { tabs: Array<{ key: string; label: string }>; active: string; onChange: (key: string) => void; scrollable?: boolean }) => {
  const row = (
    <View style={styles.tabRow}>
      {tabs.map((tab) => (
        <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={[styles.tabPill, active === tab.key && styles.tabPillOn]}>
          <Text style={[styles.tabPillText, active === tab.key && styles.tabPillTextOn]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return scrollable ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>{row}</ScrollView> : row;
};

type Kpi = { label: string; value: string };
type Row = { label: string; value: string };

const DashboardPreview = ({ kpis, rows }: { kpis: Kpi[]; rows: Row[] }) => (
  <View style={{ gap: 14 }}>
    <View style={styles.previewKpiRow}>
      {kpis.map((kpi) => (
        <View key={kpi.label} style={styles.previewKpi}>
          <Text style={styles.previewKpiValue}>{kpi.value}</Text>
          <Text style={styles.previewKpiLabel}>{kpi.label}</Text>
        </View>
      ))}
    </View>
    <View style={styles.previewRows}>
      {rows.map((row) => (
        <View key={row.label} style={styles.previewRow}>
          <Text style={styles.previewRowLabel}>{row.label}</Text>
          <Text style={styles.previewRowValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  </View>
);

const MockupFrame = ({ device, children, style }: { device: 'desktop' | 'phone'; children: React.ReactNode; style?: any }) =>
  device === 'desktop' ? (
    <View style={[styles.frameDesktop, style]}>
      <View style={styles.frameDesktopBar}>
        <View style={styles.frameDot} /><View style={styles.frameDot} /><View style={styles.frameDot} />
        <View style={styles.frameUrl}><Text style={styles.frameUrlText}>app.laremdia.com.br</Text></View>
      </View>
      <View style={styles.frameDesktopBody}>{children}</View>
    </View>
  ) : (
    <View style={[styles.framePhone, style]}>
      <View style={styles.framePhoneNotch} />
      <View style={styles.framePhoneBody}>{children}</View>
    </View>
  );

// Emblemas de seção — um selo próprio por bloco de conteúdo, no lugar de um
// emoji solto, pra reforçar a identidade visual do sistema.
const SECTION_MARKS = {
  problema: { glyph: '✕', tone: C.red },
  funcionalidades: { glyph: '▦', tone: C.primary },
  resultados: { glyph: '↗', tone: C.emerald },
  demo: { glyph: '▶', tone: C.sky },
  seguranca: { glyph: '🛡', tone: C.ink },
} as const;

const SectionMark = ({ id }: { id: keyof typeof SECTION_MARKS }) => {
  const mark = SECTION_MARKS[id];
  return <View style={[styles.sectionMark, { backgroundColor: mark.tone }]}><Text style={styles.sectionMarkGlyph}>{mark.glyph}</Text></View>;
};

// Duas bolhas sobrepostas representando "pessoas" — selo da seção "Para quem é".
const PeopleMark = () => (
  <View style={styles.peopleMarkWrap}>
    <View style={[styles.peopleMarkCircle, styles.peopleMarkCircleBack]} />
    <View style={[styles.peopleMarkCircle, styles.peopleMarkCircleFront]} />
  </View>
);

// Ilustração de condôminos: um "stack" de avatares com iniciais, cada um de
// uma cor da marca — representa a comunidade de moradores sem usar fotos
// (não há banco de fotos reais de moradores para usar aqui).
const RESIDENT_AVATARS = [
  { initials: 'MC', tone: C.primary },
  { initials: 'RS', tone: C.emerald },
  { initials: 'AP', tone: C.amber },
  { initials: 'JT', tone: C.violet },
  { initials: 'LF', tone: C.sky },
];

const ResidentsCluster = () => (
  <View style={styles.residentsCluster}>
    {RESIDENT_AVATARS.map((person, index) => (
      <View key={person.initials} style={[styles.residentAvatar, { backgroundColor: person.tone, marginLeft: index === 0 ? 0 : -14, zIndex: RESIDENT_AVATARS.length - index }]}>
        <Text style={styles.residentAvatarText}>{person.initials}</Text>
      </View>
    ))}
    <Text style={styles.residentsMoreText}>+ moradores usando o sistema</Text>
  </View>
);

// Ilustração de "gestão do condomínio": um pequeno skyline com janelas,
// nas cores da marca — usado como imagem de apoio na chamada final.
const BUILDING_BARS = [
  { height: 40, tone: C.primary }, { height: 62, tone: C.violet }, { height: 48, tone: C.emerald }, { height: 76, tone: C.sky }, { height: 54, tone: C.amber },
];

const BuildingGlyph = ({ style }: { style?: any }) => (
  <View style={[styles.buildingGlyph, style]} pointerEvents="none">
    {BUILDING_BARS.map((bar, index) => (
      <View key={index} style={[styles.buildingBar, { height: bar.height, backgroundColor: bar.tone }]}>
        {Array.from({ length: Math.max(2, Math.round(bar.height / 20)) }).map((_, row) => <View key={row} style={styles.buildingWindow} />)}
      </View>
    ))}
  </View>
);

// ---------- Conteúdo ----------

const NAV_ITEMS = [
  { key: 'inicio', label: 'Início' },
  { key: 'solucoes', label: 'Soluções' },
  { key: 'funcionalidades', label: 'Funcionalidades' },
  { key: 'paraQuemE', label: 'Para quem é' },
  { key: 'planos', label: 'Planos' },
  { key: 'conteudos', label: 'Conteúdos' },
  { key: 'contato', label: 'Contato' },
];

const HERO_KPIS: Kpi[] = [{ label: 'saldo do mês', value: 'R$ 42.380' }, { label: 'inadimplência', value: '6%' }];
const HERO_ROWS: Row[] = [{ label: 'Boletos emitidos', value: '48' }, { label: 'Pagos', value: '42' }, { label: 'Assembleia geral', value: '22/09' }];
const HERO_PHONE_KPIS: Kpi[] = [{ label: 'meu boleto', value: 'R$ 412' }];
const HERO_PHONE_ROWS: Row[] = [{ label: 'Aviso novo', value: 'Elevador' }, { label: 'Reserva', value: 'Salão · sáb' }];

const PAIN_POINTS = [
  'Informações espalhadas em diferentes canais',
  'Dificuldade para controlar receitas e despesas',
  'Falta de transparência com os moradores',
  'Comunicação falha com os moradores',
  'Reservas e ocorrências administradas manualmente',
  'Documentos difíceis de localizar',
  'Inadimplência sem acompanhamento eficiente',
];

type Feature = { title: string; icon: string; description: string; highlight?: string };

// Só o que realmente existe no sistema hoje — nada de módulo genérico de
// template (sem reserva de áreas comuns, assembleias, portaria ou
// fornecedores: isso não está implementado, então não entra aqui).
const FEATURES: Feature[] = [
  { title: 'Gestão financeira', icon: '$', description: 'Receitas, despesas e saldo do condomínio, sempre atualizados e no automático.', highlight: 'Economia de tempo' },
  { title: 'Cobrança por Pix e boleto', icon: '▤', description: 'Boleto e Pix emitidos direto pelo Banco Inter, com multa e juros configurados uma vez.' },
  { title: 'Prestação de contas', icon: '◍', description: 'Relatório mensal com comprovantes anexados, claro e disponível para todos os moradores.', highlight: 'Transparência financeira' },
  { title: 'Gestão de débitos', icon: '↓', description: 'Acordo, parcelamento e edição de débitos antigos para reduzir a inadimplência.', highlight: 'Redução da inadimplência' },
  { title: 'Avisos e comunicação', icon: '◉', description: 'Avisos com confirmação de leitura — sem se perder no grupo de WhatsApp.', highlight: 'Comunicação centralizada' },
  { title: 'Relatos e solicitações', icon: '!', description: 'Morador abre um relato, acompanha e conversa com a administração até resolver.' },
  { title: 'Unidades e moradores', icon: '▦', description: 'Blocos, unidades e moradores cadastrados uma vez, usados no sistema inteiro.' },
  { title: 'APP do Morador', icon: '📱', description: 'Cada morador entra com o próprio login e só vê o que é seu.', highlight: 'Segurança das informações' },
  { title: 'Painel com indicadores', icon: '📊', description: 'Boletos emitidos, pagos e em aberto, sempre visíveis num único painel.' },
  { title: 'Enquetes', icon: '✓', description: 'Síndico e subsíndico publicam consultas e os moradores ativos respondem pelo aplicativo.' },
  { title: 'Reserva de espaços', icon: '⌑', description: 'Agenda visual, horários disponíveis, bloqueios administrativos e aprovação das solicitações.' },
  { title: 'Regimento e ocorrências', icon: '⚑', description: 'Artigos do regimento, registro de ocorrências, respostas e acompanhamento até a resolução.' },
  { title: 'Notificações de infração', icon: '⚠', description: 'Emissão, defesa, confirmação e acompanhamento das notificações do condomínio.' },
  { title: 'Cobranças adicionais', icon: '+', description: 'Cobranças extraordinárias por unidade, com parcelas e acompanhamento integrado.' },
  { title: 'Histórico de acordos', icon: '≋', description: 'Acordos e parcelamentos organizados com situação e histórico de pagamentos.' },
];

const FEATURE_GROUPS = [
  { title: 'Financeiro e cobranças', description: 'Controle, arrecadação e transparência financeira.', items: ['Gestão financeira','Cobrança por Pix e boleto','Prestação de contas','Gestão de débitos','Cobranças adicionais','Histórico de acordos'] },
  { title: 'Comunicação e participação', description: 'Moradores informados e participando das decisões.', items: ['Avisos e comunicação','Relatos e solicitações','Enquetes','Regimento e ocorrências','Notificações de infração'] },
  { title: 'Operação e experiência', description: 'Rotina administrativa organizada para gestão e moradores.', items: ['Unidades e moradores','Reserva de espaços','APP do Morador','Painel com indicadores'] },
];

const BENEFITS = [
  { title: 'Menos tarefas manuais. Mais tempo para administrar.', description: 'Cobrança, comunicados e relatórios no automático, liberando sua agenda.', icon: '⏱' },
  { title: 'Todas as informações do condomínio em um só lugar.', description: 'Financeiro, documentos, ocorrências e comunicação, sem sistemas espalhados.', icon: '🗂' },
  { title: 'Mais transparência para o síndico e mais confiança para os moradores.', description: 'Prestação de contas sempre visível, sem precisar pedir satisfação.', icon: '◎' },
  { title: 'Decisões mais rápidas com dados atualizados.', description: 'Indicadores em tempo real, sem esperar o fechamento do mês.', icon: '⚡' },
  { title: 'Uma gestão acessível de qualquer lugar.', description: 'Painel completo no computador e no aplicativo, onde você estiver.', icon: '🌐' },
];

// Os únicos dois perfis com permissões reais e distintas no sistema hoje
// (o papel "admin_geral" é uso interno da Lar em Dia, não um perfil vendido
// ao condomínio) — nada de "administradora", "conselheiro" ou "portaria",
// que não existem como papel no sistema.
const PROFILES = [
  { key: 'sindicos', label: 'Síndicos e subsíndicos', icon: '🏢', bullets: ['Painel único com financeiro, comunicação e relatos dos moradores', 'Prestação de contas pronta todo mês, sem planilha', 'Edite, negocie ou quite débitos antigos direto pelo sistema'] },
  { key: 'moradores', label: 'Moradores', icon: '🏠', bullets: ['Acompanham os próprios boletos e o histórico de pagamentos', 'Recebem avisos com confirmação de leitura, sem grupo lotado', 'Abrem relatos e acompanham a resposta da administração'] },
];

const DEMO_TABS = [
  { key: 'painel', label: 'Painel administrativo', device: 'desktop' as const, kpis: [{ label: 'saldo do mês', value: 'R$ 42.380' }, { label: 'inadimplência', value: '6%' }], rows: [{ label: 'Boletos emitidos', value: '48' }, { label: 'Pagos', value: '42' }, { label: 'Em aberto', value: '6' }], note: 'Visão geral financeira e operacional em um único painel.' },
  { key: 'prestacao', label: 'Prestação de contas', device: 'desktop' as const, kpis: [{ label: 'receitas', value: 'R$ 51.200' }, { label: 'despesas', value: 'R$ 38.900' }], rows: [{ label: 'Água e luz', value: 'R$ 6.400' }, { label: 'Manutenção', value: 'R$ 4.100' }, { label: 'Folha de pagamento', value: 'R$ 12.300' }], note: 'Relatório mensal pronto, com comprovante anexado por categoria.' },
  { key: 'debitos', label: 'Gestão de débitos', device: 'desktop' as const, kpis: [{ label: 'em negociação', value: '5' }, { label: 'inadimplência', value: '6%' }], rows: [{ label: 'Acordo apto 302', value: '3/6 parcelas pagas' }, { label: 'Débito antigo apto 108', value: 'Pagamento parcial' }, { label: 'Apto 415', value: 'Quitado' }], note: 'Acorde, edite ou registre pagamento parcial de um débito antigo.' },
  { key: 'comunicacao', label: 'Comunicação', device: 'desktop' as const, kpis: [{ label: 'avisos enviados', value: '14' }, { label: 'confirmação de leitura', value: '92%' }], rows: [{ label: 'Manutenção do elevador', value: 'Lido por 118' }, { label: 'Assembleia geral', value: 'Lido por 132' }, { label: 'Dedetização', value: 'Lido por 96' }], note: 'Avisos organizados, com confirmação de leitura por morador.' },
  { key: 'relatos', label: 'Relatos e solicitações', device: 'desktop' as const, kpis: [{ label: 'relatos abertos', value: '9' }, { label: 'resolvidos no mês', value: '34' }], rows: [{ label: 'Vazamento garagem', value: 'Em andamento' }, { label: 'Portão da entrada', value: 'Resolvido' }, { label: 'Luz do corredor', value: 'Resolvido' }], note: 'Relato aberto pelo morador, com conversa e status até resolver.' },
  { key: 'app', label: 'Experiência no app', device: 'phone' as const, kpis: [{ label: 'meu boleto', value: 'R$ 412' }, { label: 'vencimento', value: '10/09' }], rows: [{ label: 'Aviso novo', value: 'Elevador' }, { label: 'Relato', value: 'Em andamento' }], note: 'Tudo que o morador precisa, direto do próprio login no celular.' },
];

// Cada item aqui corresponde a algo real e verificável no código — nada de
// promessa genérica de "backup" ou "compliance" que não dá pra sustentar.
const SECURITY_ITEMS = [
  { icon: '🔑', title: 'Controle de acessos e permissões', description: 'Cada perfil (síndico, subsíndico ou morador) vê e faz só o que pode, por função.' },
  { icon: '🕓', title: 'Histórico de alterações', description: 'Edição, pagamento parcial e exclusão de débito registrados com data, motivo e responsável.' },
  { icon: '🔒', title: 'Autenticação segura', description: 'Login com sessão protegida e senha criptografada — sem acesso indevido.' },
  { icon: '📁', title: 'Comprovantes protegidos', description: 'Anexos da prestação de contas guardados com acesso controlado, organizados por mês.' },
  { icon: '📋', title: 'Boas práticas de LGPD', description: 'Tratamento dos dados dos moradores alinhado aos princípios da lei.' },
  { icon: '🎧', title: 'Suporte direto', description: 'Fala com quem desenvolve o sistema, sem central de atendimento terceirizada.' },
];

const QUOTE_PROFILES = ['Síndico(a)', 'Subsíndico(a)', 'Morador(a)'];
const QUOTE_FEATURES = FEATURES.map((feature) => feature.title);

const FOOTER_COLUMNS = [
  { title: 'Institucional', links: ['Início', 'Soluções', 'Planos', 'Conteúdos'] },
  { title: 'Funcionalidades', links: ['Gestão financeira', 'Cobrança Pix e boleto', 'Enquetes', 'Reserva de espaços', 'APP do Morador'] },
  { title: 'Soluções por perfil', links: PROFILES.map((p) => p.label) },
  { title: 'Suporte', links: ['Política de privacidade', 'Termos de uso', 'Contato'] },
];

const onlyPersonName = (value: string) => value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, '').replace(/\s{2,}/g, ' ').slice(0, 100);
const onlyCity = (value: string) => value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' .-]/g, '').replace(/\s{2,}/g, ' ').slice(0, 100);
const onlyEmail = (value: string) => value.toLowerCase().replace(/\s/g, '').replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, '').slice(0, 160);
const onlyDigits = (value: string, maximum = 6) => value.replace(/\D/g, '').slice(0, maximum);
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
const validPhone = (value: string) => /^\d{10,11}$/.test(value.replace(/\D/g, ''));

export default function Landing({ navigation }: any) {
  const { isDesktop: desktop, isTablet: tablet } = useBreakpoint();
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({}).current;
  const registerSection = (key: string) => (event: any) => { sectionOffsets[key] = event.nativeEvent.layout.y; };
  const scrollToSection = (key: string) => {
    if (key === 'inicio') { scrollRef.current?.scrollTo({ y: 0, animated: true }); return; }
    const y = sectionOffsets[key];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(y - 84, 0), animated: true });
  };

  const [profileTab, setProfileTab] = useState(PROFILES[0].key);
  const activeProfile = PROFILES.find((p) => p.key === profileTab) || PROFILES[0];
  const [demoTab, setDemoTab] = useState(DEMO_TABS[0].key);
  const activeDemo = DEMO_TABS.find((d) => d.key === demoTab) || DEMO_TABS[0];

  const phoneFloat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(phoneFloat, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(phoneFloat, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phoneFloat]);
  const phoneTranslateY = phoneFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  // Quote form ("formulário inteligente")
  const [qName, setQName] = useState('');
  const [qCondominium, setQCondominium] = useState('');
  const [qEmail, setQEmail] = useState('');
  const [qPhone, setQPhone] = useState('');
  const [qCity, setQCity] = useState('');
  const [qProfile, setQProfile] = useState('');
  const [qCondoCount, setQCondoCount] = useState('');
  const [qUnitCount, setQUnitCount] = useState('');
  const [qFeatures, setQFeatures] = useState<string[]>([]);
  const [qSent, setQSent] = useState(false);
  const [qSubmitting, setQSubmitting] = useState(false);
  const [qError, setQError] = useState('');
  const qValid = Boolean(qName.trim().length >= 2 && qCondominium.trim().length >= 2 && validEmail(qEmail) && validPhone(qPhone) && qCity.trim().length >= 2 && qProfile && Number(qCondoCount) > 0 && Number(qUnitCount) > 0 && qFeatures.length > 0);

  const toggleQuoteFeature = (feature: string) => setQFeatures((current) => current.includes(feature) ? current.filter((f) => f !== feature) : [...current, feature]);

  const submitQuote = async () => {
    if (qSubmitting) return;
    if (!qValid) {
      setQError('Preencha todos os campos com dados válidos e selecione ao menos uma funcionalidade.');
      return;
    }
    setQSubmitting(true);
    setQError('');
    try {
      const response = await fetch(`${API_BASE_URL}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: qName.trim(),
          condominiumName: qCondominium.trim(),
          email: qEmail.trim(),
          phone: qPhone.trim(),
          city: qCity.trim(),
          profile: qProfile,
          condominiumCount: qCondoCount.trim(),
          unitCount: qUnitCount.trim(),
          featuresOfInterest: qFeatures,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || 'Falha ao enviar contato.');
      setQSent(true);
    } catch (e) {
      setQError(e instanceof Error ? e.message : 'Falha ao enviar contato. Tente novamente.');
    } finally {
      setQSubmitting(false);
    }
  };

  const goToLogin = () => navigation.navigate('Login');
  const handleFooterLink = (link: string) => {
    const sectionByLabel: Record<string,string> = { 'Início':'inicio', 'Soluções':'solucoes', 'Planos':'planos', 'Conteúdos':'conteudos' };
    if (sectionByLabel[link]) { scrollToSection(sectionByLabel[link]); return; }
    if (link === 'Política de privacidade') { navigation.navigate('LegalDocument',{document:'privacy'}); return; }
    if (link === 'Termos de uso') { navigation.navigate('LegalDocument',{document:'terms'}); return; }
    if (link === 'Contato') Linking.openURL('mailto:laremdia.condominio@gmail.com?subject=Contato%20pelo%20site%20Lar%20em%20Dia');
    else if (FEATURES.some((feature) => feature.title === link) || link === 'Cobrança Pix e boleto') scrollToSection('funcionalidades');
    else if (PROFILES.some((profile) => profile.label === link)) scrollToSection('paraQuemE');
  };
  const hPad = { paddingHorizontal: desktop ? 60 : tablet ? 32 : 20 };

  return (
    <View style={styles.root}>
      {/* 1. CABEÇALHO — fica fora do ScrollView, então permanece visível durante a rolagem */}
      <View style={[styles.topBar, hPad]}>
        <Pressable style={styles.brand} onPress={() => scrollToSection('inicio')}>
          <Image source={require('../../assets/lar-em-dia-wordmark.png')} style={styles.brandWordmark} resizeMode="contain" />
        </Pressable>

        {desktop ? (
          <View style={styles.navLinks}>
            {NAV_ITEMS.map((item) => (
              <Pressable key={item.key} onPress={() => scrollToSection(item.key)} style={styles.navLink}>
                <Text style={styles.navLinkText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : tablet ? (
          <View style={styles.navLinks}>
            {['funcionalidades', 'planos', 'contato'].map((key) => {
              const item = NAV_ITEMS.find((n) => n.key === key)!;
              return (
                <Pressable key={item.key} onPress={() => scrollToSection(item.key)} style={styles.navLink}>
                  <Text style={styles.navLinkText}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.headerActions}>
          <Pressable onPress={goToLogin} style={styles.headerLoginBtn}><Text style={styles.headerLoginText}>Entrar</Text></Pressable>
          <PillButton title={desktop ? 'Solicitar demonstração' : 'Demo'} onPress={() => scrollToSection('planos')} small />
        </View>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.page}>

        {/* 2. HERO */}
        <View style={[styles.hero, hPad]}>
          <View style={[styles.heroBody, desktop && styles.heroBodyDesktop]}>
            <View style={[styles.heroContent, desktop && styles.heroContentDesktop]}>
              <View style={styles.eyebrowPill}><Text style={styles.eyebrowPillText}>GESTÃO CONDOMINIAL INTELIGENTE</Text></View>
              <Text style={[styles.heroTitle, desktop && styles.heroTitleDesktop]}>Gestão condominial inteligente, transparente e sem complicação.</Text>
              <Text style={styles.heroSubtitle}>Centralize finanças, comunicação, ocorrências, reservas, documentos e atividades administrativas em uma única plataforma.</Text>

              <View style={styles.heroActions}>
                <PillButton title="Solicitar demonstração" onPress={() => scrollToSection('planos')} />
                <PillButton title="Conhecer funcionalidades" onPress={() => scrollToSection('funcionalidades')} tone="outline" />
              </View>

              <View style={styles.trustRow}>
                <Text style={styles.trustItem}>✓ Implantação simplificada</Text>
                <Text style={styles.trustItem}>✓ Suporte especializado</Text>
                <Text style={styles.trustItem}>✓ Dados protegidos</Text>
                <Text style={styles.trustItem}>✓ Acesso pelo celular</Text>
              </View>
            </View>

            {desktop || tablet ? (
              <View style={styles.heroDevices}>
                <MockupFrame device="desktop"><DashboardPreview kpis={HERO_KPIS} rows={HERO_ROWS} /></MockupFrame>
                <Animated.View style={[styles.heroPhoneOverlay, { transform: [{ translateY: phoneTranslateY }] }]}>
                  <MockupFrame device="phone"><DashboardPreview kpis={HERO_PHONE_KPIS} rows={HERO_PHONE_ROWS} /></MockupFrame>
                </Animated.View>
                <View style={styles.brandStamp}>
                  <Image source={require('../../assets/lar-em-dia-wordmark.png')} style={styles.brandStampLogo} resizeMode="contain" />
                  <Text style={styles.brandStampTag}>gestão condominial</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* 3. PROVA SOCIAL */}
        <View style={[styles.socialProof, hPad]}>
          <Text style={styles.moduleStripLabel}>MÓDULOS JÁ PRONTOS NO SISTEMA</Text>
          <View style={styles.logoRow}>
            {FEATURES.slice(0, 6).map((feature) => (
              <View key={feature.title} style={styles.moduleBadge}>
                <Text style={styles.moduleBadgeIcon}>{feature.icon}</Text>
                <Text style={styles.moduleBadgeText}>{feature.title}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 4. PRINCIPAIS PROBLEMAS */}
        <View style={[styles.section, hPad]}>
          <SectionMark id="problema" />
          <Text style={styles.sectionEyebrow}>O PROBLEMA</Text>
          <Text style={styles.sectionTitle}>Administrar um condomínio não precisa ser tão complicado.</Text>
          <View style={styles.problemGrid}>
            {PAIN_POINTS.map((item) => (
              <View key={item} style={styles.problemRow}>
                <View style={styles.problemIcon}><Text style={styles.problemIconText}>✕</Text></View>
                <Text style={styles.problemText}>{item}</Text>
              </View>
            ))}
          </View>
          <View style={styles.problemArrow}><Text style={styles.problemArrowText}>↓ é para isso que o Lar em Dia existe</Text></View>
        </View>

        {/* 5. FUNCIONALIDADES */}
        <View style={[styles.section, styles.sectionAlt, hPad]} onLayout={registerSection('funcionalidades')}>
          <SectionMark id="funcionalidades" />
          <Text style={styles.sectionEyebrow}>FUNCIONALIDADES</Text>
          <Text style={styles.sectionTitle}>Tudo que a rotina do condomínio precisa, em um só sistema</Text>
          <View style={styles.featureIntroRow}><Text style={styles.sectionSubtitle}>Recursos organizados por área para você encontrar rapidamente o que precisa.</Text><View style={styles.featureCount}><Text style={styles.featureCountValue}>{FEATURES.length}</Text><Text style={styles.featureCountLabel}>recursos disponíveis</Text></View></View>

          <View style={styles.featureGroups}>
            {FEATURE_GROUPS.map((group) => (
              <View key={group.title} style={styles.featureGroup}>
                <View style={styles.featureGroupHeading}><View style={styles.featureGroupLine}/><View><Text style={styles.featureGroupTitle}>{group.title}</Text><Text style={styles.featureGroupDescription}>{group.description}</Text></View></View>
                <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 4 }} gap={12}>
                  {group.items.map((title) => FEATURES.find((feature) => feature.title === title)).filter((feature): feature is Feature => Boolean(feature)).map((feature) => (
                    <SoftCard key={feature.title} style={[styles.featureCard, feature.highlight && styles.featureCardHighlight]}>
                      <View style={styles.featureCardTop}><View style={styles.featureIcon}><Text style={styles.featureIconText}>{feature.icon}</Text></View>{feature.highlight ? <Text style={styles.featureStar}>★</Text> : null}</View>
                      <Text style={styles.featureTitle}>{feature.title}</Text>
                      <Text style={styles.featureDescription}>{feature.description}</Text>
                      {feature.highlight ? <Text style={styles.featureHighlightText}>{feature.highlight}</Text> : null}
                    </SoftCard>
                  ))}
                </CardGrid>
              </View>
            ))}
          </View>
        </View>

        {/* 6. BENEFÍCIOS */}
        <View style={[styles.section, hPad]} onLayout={registerSection('solucoes')}>
          <SectionMark id="resultados" />
          <Text style={styles.sectionEyebrow}>RESULTADOS</Text>
          <Text style={styles.sectionTitle}>O que muda na prática pra quem administra</Text>

          <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }} gap={16}>
            {BENEFITS.map((benefit) => (
              <SoftCard key={benefit.title} style={styles.benefitCard}>
                <Text style={styles.benefitIcon}>{benefit.icon}</Text>
                <Text style={styles.benefitTitle}>{benefit.title}</Text>
                <Text style={styles.benefitDescription}>{benefit.description}</Text>
              </SoftCard>
            ))}
          </CardGrid>

          <View style={[styles.compareRow, desktop && styles.compareRowDesktop]}>
            <SoftCard style={[styles.compareCard, styles.compareCardOld]}>
              <Text style={styles.compareTitle}>Do jeito antigo</Text>
              {PAIN_POINTS.slice(0, 4).map((item) => <View key={item} style={styles.compareItem}><Text style={styles.compareBulletOld}>✕</Text><Text style={styles.compareText}>{item}</Text></View>)}
            </SoftCard>
            <SoftCard style={[styles.compareCard, styles.compareCardNew]}>
              <Text style={styles.compareTitle}>Com o Lar em Dia</Text>
              {['Painel único, sempre atualizado', 'Boleto e Pix automáticos', 'Avisos com confirmação de leitura', 'Prestação de contas pronta todo mês'].map((item) => <View key={item} style={styles.compareItem}><Text style={styles.compareBulletNew}>✓</Text><Text style={styles.compareText}>{item}</Text></View>)}
            </SoftCard>
          </View>
        </View>

        {/* 7. SOLUÇÕES POR PERFIL */}
        <View style={[styles.section, styles.sectionAlt, hPad]} onLayout={registerSection('paraQuemE')}>
          <PeopleMark />
          <Text style={styles.sectionEyebrow}>PARA QUEM É</Text>
          <Text style={styles.sectionTitle}>Uma plataforma, benefícios diferentes para cada perfil</Text>
          <Text style={styles.sectionSubtitle}>Selecione o seu perfil e veja o que muda para você.</Text>

          <ResidentsCluster />

          <TabRow tabs={PROFILES.map((p) => ({ key: p.key, label: p.label }))} active={profileTab} onChange={setProfileTab} scrollable={!desktop} />

          <SoftCard style={styles.profilePanel}>
            <Text style={styles.profileIcon}>{activeProfile.icon}</Text>
            <Text style={styles.profileHeadline}>{activeProfile.label}</Text>
            <View style={styles.profileBullets}>
              {activeProfile.bullets.map((bullet) => (
                <View key={bullet} style={styles.profileBulletRow}><Text style={styles.profileBulletMark}>✓</Text><Text style={styles.profileBulletText}>{bullet}</Text></View>
              ))}
            </View>
          </SoftCard>
        </View>

        {/* 8. DEMONSTRAÇÃO DO SISTEMA */}
        <View style={[styles.section, hPad]} onLayout={registerSection('conteudos')}>
          <SectionMark id="demo" />
          <Text style={styles.sectionEyebrow}>VEJA POR DENTRO</Text>
          <Text style={styles.sectionTitle}>A plataforma na prática</Text>
          <Text style={styles.sectionSubtitle}>Navegue pelas abas e veja como cada rotina funciona no sistema.</Text>

          <TabRow tabs={DEMO_TABS.map((d) => ({ key: d.key, label: d.label }))} active={demoTab} onChange={setDemoTab} scrollable />

          <View style={[styles.demoStage, desktop && styles.demoStageDesktop]}>
            <MockupFrame device={activeDemo.device} style={styles.demoFrame}>
              <DashboardPreview kpis={activeDemo.kpis} rows={activeDemo.rows} />
            </MockupFrame>
            <Text style={styles.demoNote}>{activeDemo.note}</Text>
          </View>
        </View>

        {/* 10. SEGURANÇA E CONFIANÇA */}
        <View style={[styles.section, hPad]}>
          <SectionMark id="seguranca" />
          <Text style={styles.sectionEyebrow}>SEGURANÇA</Text>
          <Text style={styles.sectionTitle}>Suas informações protegidas, do jeito certo</Text>

          <CardGrid columns={{ mobile: 1, tablet: 2, desktop: 4 }} gap={14}>
            {SECURITY_ITEMS.map((item) => (
              <View key={item.title} style={styles.securityItem}>
                <Text style={styles.securityIcon}>{item.icon}</Text>
                <Text style={styles.securityTitle}>{item.title}</Text>
                <Text style={styles.securityDescription}>{item.description}</Text>
              </View>
            ))}
          </CardGrid>
        </View>

        {/* 11. PLANOS / ORÇAMENTO — formulário inteligente */}
        <View style={[styles.section, styles.sectionAlt, hPad]} onLayout={registerSection('planos')}>
          <Text style={styles.sectionEyebrow}>PLANOS</Text>
          <Text style={styles.sectionTitle}>Receba uma proposta feita sob medida</Text>
          <Text style={styles.sectionSubtitle}>O valor depende do número de unidades e das funcionalidades contratadas. Conte pra gente o seu cenário.</Text>

          <SoftCard style={styles.quoteForm}>
            {qSent ? (
              <Text style={styles.formSentText}>Recebemos seu contato — alguém da equipe vai falar com você em breve.</Text>
            ) : (
              <>
                <View style={[styles.formRow, desktop && styles.formRowDesktop]}>
                  <TextInput value={qName} onChangeText={(value) => setQName(onlyPersonName(value))} placeholder="Seu nome" placeholderTextColor={C.muted} autoCapitalize="words" maxLength={100} style={styles.formField} />
                  <TextInput value={qCondominium} onChangeText={(value) => setQCondominium(value.replace(/[<>]/g, '').slice(0, 140))} placeholder="Nome do condomínio" placeholderTextColor={C.muted} maxLength={140} style={styles.formField} />
                </View>
                <View style={[styles.formRow, desktop && styles.formRowDesktop]}>
                  <TextInput value={qEmail} onChangeText={(value) => setQEmail(onlyEmail(value))} placeholder="E-mail (ex.: nome@dominio.com.br)" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={160} style={styles.formField} />
                  <TextInput value={qPhone} onChangeText={(value) => setQPhone(maskPhone(value))} placeholder="Telefone / WhatsApp" placeholderTextColor={C.muted} keyboardType="phone-pad" maxLength={15} style={styles.formField} />
                </View>
                <View style={[styles.formRow, desktop && styles.formRowDesktop]}>
                  <TextInput value={qCity} onChangeText={(value) => setQCity(onlyCity(value))} placeholder="Cidade" placeholderTextColor={C.muted} autoCapitalize="words" maxLength={100} style={styles.formField} />
                </View>

                <Text style={styles.formLabel}>Perfil do interessado</Text>
                <View style={styles.chipRow}>
                  {QUOTE_PROFILES.map((profile) => (
                    <Pressable key={profile} onPress={() => setQProfile(profile)} style={[styles.chip, qProfile === profile && styles.chipOn]}>
                      <Text style={[styles.chipText, qProfile === profile && styles.chipTextOn]}>{profile}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={[styles.formRow, desktop && styles.formRowDesktop]}>
                  <TextInput value={qCondoCount} onChangeText={(value) => setQCondoCount(onlyDigits(value, 4))} placeholder="Nº de condomínios" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={4} style={styles.formField} />
                  <TextInput value={qUnitCount} onChangeText={(value) => setQUnitCount(onlyDigits(value, 6))} placeholder="Qtd. aproximada de unidades" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={6} style={styles.formField} />
                </View>

                <Text style={styles.formLabel}>Funcionalidades de interesse</Text>
                <View style={styles.chipRow}>
                  {QUOTE_FEATURES.map((feature) => (
                    <Pressable key={feature} onPress={() => toggleQuoteFeature(feature)} style={[styles.chip, qFeatures.includes(feature) && styles.chipOn]}>
                      <Text style={[styles.chipText, qFeatures.includes(feature) && styles.chipTextOn]}>{feature}</Text>
                    </Pressable>
                  ))}
                </View>

                {qError ? <Text style={styles.formError}>{qError}</Text> : null}
                <View style={styles.formSubmitWrap}>
                  <PillButton title={qSubmitting ? 'Enviando...' : 'Receber proposta personalizada'} onPress={submitQuote} />
                </View>
              </>
            )}
          </SoftCard>
        </View>

        {/* 12. CHAMADA FINAL */}
        <LinearGradient colors={[C.primary, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.finalCta, hPad]}>
          <BuildingGlyph style={styles.finalCtaBuilding} />
          <Text style={styles.finalCtaTitle}>Pronto para transformar a gestão do seu condomínio?</Text>
          <Text style={styles.finalCtaText}>Conheça uma maneira mais simples, transparente e eficiente de cuidar de todas as rotinas condominiais.</Text>
          <View style={styles.finalCtaActions}>
            <PillButton title="Solicitar demonstração" onPress={() => scrollToSection('planos')} tone="ghostLight" />
          </View>
        </LinearGradient>

        {/* 13. RODAPÉ */}
        <View style={[styles.footer, hPad]} onLayout={registerSection('contato')}>
          <View style={[styles.footerTop, desktop && styles.footerTopDesktop]}>
            <View style={styles.footerBrandCol}>
              <View style={styles.footerBrand}>
                <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.footerLogo} resizeMode="contain" />
                <Text style={styles.footerBrandName}>Lar em Dia</Text>
              </View>
              <Text style={styles.footerDescription}>Plataforma completa de gestão condominial — financeiro, comunicação e rotina administrativa em um só lugar.</Text>
              <Pressable onPress={goToLogin} style={styles.footerPlatformBtn}><Text style={styles.footerPlatformBtnText}>Acessar plataforma →</Text></Pressable>
            </View>

            <View style={[styles.footerColumns, desktop && styles.footerColumnsDesktop]}>
              {FOOTER_COLUMNS.map((column) => (
                <View key={column.title} style={styles.footerColumn}>
                  <Text style={styles.footerColumnTitle}>{column.title}</Text>
                  {column.links.map((link) => <Pressable key={link} onPress={() => handleFooterLink(link)}><Text style={styles.footerLink}>{link}</Text></Pressable>)}
                  {column.title === 'Suporte' ? <Pressable onPress={() => handleFooterLink('Contato')}><Text style={styles.footerEmail}>laremdia.condominio@gmail.com</Text></Pressable> : null}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.footerBottom}>
            <Text style={styles.footerLegal}>Lar em Dia Tecnologia Ltda. · Todos os direitos reservados · {new Date().getFullYear()}</Text>
            <View style={styles.footerSocial}>
              <Text style={styles.footerSocialIcon}>◎</Text>
              <Text style={styles.footerSocialIcon}>▤</Text>
              <Text style={styles.footerSocialIcon}>✉</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  page: { flexGrow: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, zIndex: 20, gap: 12, ...shadow, shadowOpacity: 0.04 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandLogo: { width: 30, height: 30 },
  // Lockup completo (casa + "LAR EM DIA") na barra branca do topo. A arte é
  // quase quadrada (900x961), então a altura é que manda: 62px preenche a
  // barra de 72 e deixa a faixa de texto legível.
  brandWordmark: { width: 58, height: 62 },
  brandName: { color: C.ink, fontSize: 16.5, fontWeight: '900' },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: 22, flexShrink: 1 },
  navLink: { paddingVertical: 8 },
  navLinkText: { color: C.muted, fontWeight: '700', fontSize: 13.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLoginBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  headerLoginText: { color: C.ink, fontWeight: '800', fontSize: 14 },

  btnPrimary: { minHeight: 50, paddingHorizontal: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center', ...shadow, shadowColor: C.primary, shadowOpacity: 0.28 },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnOutline: { minHeight: 50, paddingHorizontal: 26, borderRadius: 999, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  btnOutlineText: { color: C.ink, fontWeight: '800', fontSize: 15 },
  btnGhostLight: { minHeight: 50, paddingHorizontal: 26, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  btnGhostLightText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnSmall: { minHeight: 40, paddingHorizontal: 16 },
  btnTextSmall: { fontSize: 13 },
  pressedShrink: { opacity: 0.9 },

  softCard: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, ...shadow },

  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22, marginBottom: 28 },
  tabPill: { borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  tabPillOn: { backgroundColor: C.ink, borderColor: C.ink },
  tabPillText: { color: C.muted, fontWeight: '800', fontSize: 13.5 },
  tabPillTextOn: { color: '#fff' },

  previewKpiRow: { flexDirection: 'row', gap: 10 },
  previewKpi: { flex: 1, backgroundColor: C.surfaceAlt, borderRadius: 12, padding: 12 },
  previewKpiValue: { color: C.ink, fontSize: 17, fontWeight: '900' },
  previewKpiLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 2, textTransform: 'uppercase' },
  previewRows: { gap: 8 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 8 },
  previewRowLabel: { color: C.muted, fontSize: 12.5, fontWeight: '700' },
  previewRowValue: { color: C.ink, fontSize: 13, fontWeight: '900' },

  frameDesktop: { width: 340, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, overflow: 'hidden', ...shadow, shadowOpacity: 0.14, shadowRadius: 26 },
  frameDesktopBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.surfaceAlt, borderBottomWidth: 1, borderBottomColor: C.border },
  frameDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  frameUrl: { flex: 1, marginLeft: 8, backgroundColor: C.surface, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  frameUrlText: { color: C.muted, fontSize: 10.5, fontWeight: '700' },
  frameDesktopBody: { padding: 18 },
  framePhone: { width: 168, borderRadius: 26, backgroundColor: C.surface, borderWidth: 6, borderColor: C.ink, overflow: 'hidden', ...shadow, shadowOpacity: 0.2, shadowRadius: 22 },
  framePhoneNotch: { alignSelf: 'center', width: 54, height: 16, backgroundColor: C.ink, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, marginTop: -1 },
  framePhoneBody: { padding: 12 },

  hero: { paddingTop: 48, paddingBottom: 52 },
  heroBody: { flexDirection: 'column' },
  heroBodyDesktop: { flexDirection: 'row', alignItems: 'center', gap: 48 },
  heroContent: { maxWidth: 760 },
  heroContentDesktop: { flex: 1.05, maxWidth: 600 },
  eyebrowPill: { alignSelf: 'flex-start', backgroundColor: '#EEF0FE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 20 },
  eyebrowPillText: { color: C.primary, fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
  heroTitle: { color: C.ink, fontSize: 32, lineHeight: 39, fontWeight: '900', letterSpacing: -0.5 },
  heroTitleDesktop: { fontSize: 44, lineHeight: 51 },
  heroSubtitle: { color: C.muted, fontSize: 16.5, lineHeight: 24, marginTop: 18, maxWidth: 540, fontWeight: '500' },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 30 },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 28 },
  trustItem: { color: C.muted, fontSize: 13, fontWeight: '700' },

  heroDevices: { flex: 1, minWidth: 320, alignItems: 'center', justifyContent: 'center', position: 'relative', paddingRight: 40, paddingBottom: 30 },
  heroPhoneOverlay: { position: 'absolute', right: 0, bottom: -6 },
  brandStamp: { position: 'absolute', left: -6, bottom: -16, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 4, transform: [{ rotate: '-4deg' }], ...shadow, shadowOpacity: 0.18 },
  // Proporção do arquivo é 900x961 (~0.94:1), quase quadrada.
  brandStampLogo: { width: 104, height: 111 },
  brandStampTag: { color: C.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },

  socialProof: { paddingVertical: 36, backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border },
  moduleStripLabel: { color: C.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  logoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  moduleBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.surfaceAlt },
  moduleBadgeIcon: { color: C.primary, fontSize: 13, fontWeight: '900' },
  moduleBadgeText: { color: C.ink, fontSize: 12.5, fontWeight: '800' },

  section: { paddingVertical: 64 },
  sectionAlt: { backgroundColor: C.surfaceAlt },
  sectionEyebrow: { color: C.primary, fontSize: 13, fontWeight: '900', letterSpacing: 1.2, marginBottom: 10 },
  sectionTitle: { color: C.ink, fontSize: 27, fontWeight: '900', maxWidth: 680, letterSpacing: -0.3 },
  sectionSubtitle: { color: C.muted, fontSize: 16, lineHeight: 22, marginTop: 10, marginBottom: 26, maxWidth: 580, fontWeight: '500' },
  sectionMark: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  sectionMarkGlyph: { color: '#fff', fontSize: 17, fontWeight: '900' },
  peopleMarkWrap: { width: 40, height: 34, position: 'relative', marginBottom: 14 },
  peopleMarkCircle: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.surfaceAlt },
  peopleMarkCircleBack: { backgroundColor: C.violet, top: 0, left: 10 },
  peopleMarkCircleFront: { backgroundColor: C.primary, bottom: 0, left: 0 },
  residentsCluster: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 24 },
  residentAvatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  residentAvatarText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  residentsMoreText: { color: C.muted, fontWeight: '700', fontSize: 13, marginLeft: 14 },

  problemGrid: { gap: 14, marginTop: 28, maxWidth: 640 },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  problemIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FDEDED', alignItems: 'center', justifyContent: 'center' },
  problemIconText: { color: C.red, fontWeight: '900', fontSize: 13 },
  problemText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
  problemArrow: { marginTop: 26 },
  problemArrowText: { color: C.primary, fontWeight: '900', fontSize: 14 },

  featureIntroRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 30 },
  featureCount: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E8EAFE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  featureCountValue: { color: C.primary, fontSize: 18, fontWeight: '900' },
  featureCountLabel: { color: C.primaryDark, fontSize: 12, fontWeight: '800' },
  featureGroups: { gap: 34 },
  featureGroup: { gap: 15 },
  featureGroupHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureGroupLine: { width: 5, height: 38, borderRadius: 4, backgroundColor: C.primary },
  featureGroupTitle: { color: C.ink, fontSize: 19, fontWeight: '900' },
  featureGroupDescription: { color: C.muted, fontSize: 13, marginTop: 3 },
  featureCard: { padding: 17, minHeight: 174, position: 'relative' },
  featureCardHighlight: { borderColor: '#B9BDF8', borderWidth: 1.5, backgroundColor: '#FCFCFF' },
  featureCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  featureStar: { color: C.amber, fontSize: 16, fontWeight: '900' },
  featureHighlightText: { color: C.primary, fontSize: 11.5, fontWeight: '900', marginTop: 'auto', paddingTop: 8 },
  featureBadge: { position: 'absolute', top: -12, left: 18, backgroundColor: C.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  featureBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  featureIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#EEF0FE', alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  featureIconText: { fontSize: 17, fontWeight: '900', color: C.primary },
  featureTitle: { color: C.ink, fontSize: 15, lineHeight: 19, fontWeight: '900', marginBottom: 6 },
  featureDescription: { color: C.muted, fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
  featureLink: { color: C.primary, fontWeight: '800', fontSize: 13 },

  benefitCard: { padding: 22, minHeight: 170 },
  benefitIcon: { fontSize: 24, marginBottom: 12 },
  benefitTitle: { color: C.ink, fontSize: 16, fontWeight: '900', marginBottom: 8, lineHeight: 21 },
  benefitDescription: { color: C.muted, fontSize: 13.5, lineHeight: 19, fontWeight: '500' },

  compareRow: { gap: 16, marginTop: 30 },
  compareRowDesktop: { flexDirection: 'row' },
  compareCard: { flex: 1, padding: 24 },
  compareCardOld: { backgroundColor: '#FEF7F7' },
  compareCardNew: { backgroundColor: '#F1FBF7' },
  compareTitle: { color: C.ink, fontSize: 16, fontWeight: '900', marginBottom: 16 },
  compareItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  compareBulletOld: { color: C.red, fontWeight: '900' },
  compareBulletNew: { color: C.emerald, fontWeight: '900' },
  compareText: { flex: 1, color: C.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },

  profilePanel: { marginTop: 4, padding: 28, maxWidth: 560 },
  profileIcon: { fontSize: 30, marginBottom: 10 },
  profileHeadline: { color: C.ink, fontSize: 19, fontWeight: '900', marginBottom: 16 },
  profileBullets: { gap: 12 },
  profileBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  profileBulletMark: { color: C.emerald, fontWeight: '900' },
  profileBulletText: { flex: 1, color: C.ink, fontSize: 14.5, lineHeight: 21, fontWeight: '600' },

  demoStage: { alignItems: 'center', marginTop: 8 },
  demoStageDesktop: { alignItems: 'flex-start' },
  demoFrame: { width: '100%', maxWidth: 460 },
  demoNote: { color: C.muted, fontSize: 14, fontWeight: '600', marginTop: 16, maxWidth: 460 },

  testimonialCard: { padding: 26 },
  testimonialTag: { alignSelf: 'flex-start', backgroundColor: '#FFF3DE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 14 },
  testimonialTagText: { color: C.amber, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  testimonialQuote: { color: C.ink, fontSize: 15.5, lineHeight: 23, fontWeight: '600' },
  testimonialPerson: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  testimonialAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  testimonialAvatarText: { color: C.primary, fontWeight: '900', fontSize: 13 },
  testimonialName: { color: C.ink, fontSize: 13.5, fontWeight: '900' },
  testimonialRole: { color: C.muted, fontSize: 12, marginTop: 1, fontWeight: '600' },

  securityItem: { padding: 4 },
  securityIcon: { fontSize: 22, marginBottom: 10 },
  securityTitle: { color: C.ink, fontSize: 14.5, fontWeight: '900', marginBottom: 6 },
  securityDescription: { color: C.muted, fontSize: 12.5, lineHeight: 18, fontWeight: '500' },

  quoteForm: { padding: 28, marginTop: 6, maxWidth: 720 },
  formLabel: { color: C.ink, fontWeight: '800', fontSize: 13.5, marginTop: 4, marginBottom: 10 },
  formRow: { gap: 10, marginBottom: 10 },
  formRowDesktop: { flexDirection: 'row' },
  formField: { flex: 1, minHeight: 50, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, backgroundColor: C.bg, color: C.ink, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: { borderWidth: 1.5, borderColor: C.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.surface },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  formError: { color: C.red, fontWeight: '700', fontSize: 13, marginBottom: 14 },
  formSubmitWrap: { alignItems: 'flex-start', marginTop: 6 },
  formSentText: { color: C.emerald, fontSize: 15, fontWeight: '800', lineHeight: 22, textAlign: 'center', paddingVertical: 20 },

  finalCta: { paddingVertical: 60, alignItems: 'center' },
  finalCtaTitle: { color: '#fff', fontSize: 27, fontWeight: '900', textAlign: 'center', maxWidth: 640, marginBottom: 12 },
  finalCtaText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, lineHeight: 23, textAlign: 'center', maxWidth: 540, fontWeight: '500', marginBottom: 30 },
  finalCtaActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  finalCtaBuilding: { marginBottom: 24, opacity: 0.9 },
  buildingGlyph: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  buildingBar: { width: 28, borderTopLeftRadius: 8, borderTopRightRadius: 8, alignItems: 'center', paddingTop: 8, gap: 5 },
  buildingWindow: { width: 13, height: 5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)' },

  footer: { paddingTop: 56, paddingBottom: 30, backgroundColor: C.ink },
  footerTop: { gap: 36 },
  footerTopDesktop: { flexDirection: 'row', justifyContent: 'space-between' },
  footerBrandCol: { flex: 1.1, maxWidth: 320, gap: 14 },
  footerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerLogo: { width: 28, height: 28 },
  footerBrandName: { color: '#fff', fontWeight: '900', fontSize: 16 },
  footerDescription: { color: '#9AA3B5', fontSize: 13.5, lineHeight: 20, fontWeight: '500' },
  footerPlatformBtn: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  footerPlatformBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  footerColumns: { flex: 1.4, gap: 28 },
  footerColumnsDesktop: { flexDirection: 'row' },
  footerColumn: { flex: 1, minWidth: 140, gap: 10 },
  footerColumnTitle: { color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 0.3, marginBottom: 4 },
  footerLink: { color: '#9AA3B5', fontSize: 13, fontWeight: '500' },
  footerEmail: { color: '#C7CCFF', fontSize: 12.5, lineHeight: 18, fontWeight: '800', textDecorationLine: 'underline', marginTop: 4 },
  footerBottom: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 44, paddingTop: 22, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  footerLegal: { color: '#7A8296', fontSize: 12, fontWeight: '500' },
  footerSocial: { flexDirection: 'row', gap: 14 },
  footerSocialIcon: { color: '#9AA3B5', fontSize: 15 },
});
