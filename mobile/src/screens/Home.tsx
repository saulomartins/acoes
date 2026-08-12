import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AuthContext } from '../context/AuthContext';
import { colors, layout } from '../ui/theme';
import { useBreakpoint } from '../ui/responsive';
import { apiRequest } from '../api/client';
import { syncNotificationBadge } from '../services/pushNotifications';
import { subscribeNotificationsChanged } from '../services/notificationEvents';
import type { FeatureKey } from '../context/AuthContext';
import FeatureTour, { type TourStep } from '../ui/FeatureTour';
import { useSectionTour } from '../ui/useSectionTour';

type MenuItem = {
  title: string;
  shortTitle: string;
  description: string;
  symbol: string;
  accent: string;
  route?: string;
  roles: string[];
  feature?: FeatureKey;
  submenu?: MenuItem[];
};

// Menu hierárquico organizado por seções. `feature` só existe em itens que
// são de um condomínio específico — controlados pelo admin_geral em
// Condomínios > Funcionalidades ativas. Itens de plataforma (Condomínios,
// Bancos, Planos, Auditoria) não têm `feature`: são só role-gated.
const buildMenuStructure = (): MenuItem[] => [
  { title: 'Painel', shortTitle: 'Painel', description: 'Quanto foi arrecadado no mês atual, pela data do pagamento.', route: 'Dashboard', symbol: '◆', accent: colors.green, roles: ['sindico', 'subsindico'], feature: 'painel' },
  { title: 'Indicadores de boletos', shortTitle: 'Indicadores', description: 'Recebidos, não pagos e cancelados por período, com os motivos de cancelamento.', route: 'BillingAnalytics', symbol: '📈', accent: colors.teal, roles: ['sindico', 'subsindico'], feature: 'indicadores_boletos' },
  // Para Síndico/Subsíndico
  { title: 'Condomínios', shortTitle: 'Condomínios', description: 'Dados cadastrais e configuração dos condomínios.', route: 'Condominiums', symbol: '▦', accent: colors.lilac, roles: ['admin_geral'] },
  { title: 'Pessoas', shortTitle: 'Pessoas', description: 'Síndicos, subsíndicos, proprietários e inquilinos.', route: 'Users', symbol: '♙', accent: colors.sky, roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
  { title: 'Gestão de bancos', shortTitle: 'Bancos', description: 'Conexões bancárias e vínculos com condomínios.', route: 'BankConfigurations', symbol: '↔', accent: '#ff7a24', roles: ['admin_geral'] },
  { title: 'Planos da plataforma', shortTitle: 'Planos', description: 'Cadastre os planos de cobrança da plataforma aos condomínios.', route: 'PlatformPlans', symbol: '◆', accent: colors.lilac, roles: ['admin_geral'] },
  { title: 'Faturamento da plataforma', shortTitle: 'Faturamento', description: 'Projeção de receita por condomínio, unidades ativas e plano vinculado.', route: 'PlatformRevenue', symbol: '$', accent: colors.green, roles: ['admin_geral'] },
  { title: 'Auditoria', shortTitle: 'Auditoria', description: 'Ações de síndicos e subsíndicos por condomínio.', route: 'AuditLog', symbol: '🛡', accent: colors.primary, roles: ['admin_geral'] },
  { title: 'Tipologias', shortTitle: 'Tipologias', description: 'Tipos de apartamento e valores mensais de cobrança.', route: 'UnitTypes', symbol: '▧', accent: colors.amber, roles: ['sindico', 'subsindico'], feature: 'tipologias' },
  { title: 'Blocos e unidades', shortTitle: 'Unidades', description: 'Apartamentos, moradores atuais e representantes.', route: 'Units', symbol: '▦', accent: colors.teal, roles: ['sindico', 'subsindico'], feature: 'blocos_unidades' },
  { title: 'Prestação de contas', shortTitle: 'Prestação', description: 'Receitas, despesas e saldo mensal do condomínio.', route: 'Accountability', symbol: '$', accent: colors.green, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'prestacao_contas' },

  // Boletos (submenu)
  {
    title: 'Boletos',
    shortTitle: 'Boletos',
    description: 'Cobranças, vencimentos e acompanhamento de pagamentos.',
    symbol: '▤',
    accent: colors.green,
    route: 'Invoices',
    roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'],
    feature: 'gestao_cobrancas',
    submenu: [
      { title: 'Gestão de cobranças', shortTitle: 'Gestão de cobranças', description: '', route: 'Invoices', symbol: '▤', accent: colors.green, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_cobrancas' },
      { title: 'Gestão de débitos', shortTitle: 'Gestão de débitos', description: '', route: 'Debts', symbol: '↓', accent: colors.red, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_debitos' },
      { title: 'Config. e Enviar cobranças', shortTitle: 'Config. e Enviar cobranças', description: '', route: 'BillingSettings', symbol: '⚙', accent: '#ff7a24', roles: ['sindico', 'subsindico'], feature: 'config_enviar_cobrancas' },
    ]
  },

  // Avisos (submenu)
  {
    title: 'Avisos',
    shortTitle: 'Avisos',
    description: 'Notificações para moradores e administração.',
    symbol: '◉',
    accent: colors.teal,
    route: 'Communications',
    roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'],
    feature: 'avisos_comunicacao',
    submenu: [
      { title: 'Comunicação', shortTitle: 'Comunicação', description: '', route: 'Communications', symbol: '◉', accent: colors.teal, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'avisos_comunicacao' },
      { title: 'Relatos e solicitações', shortTitle: 'Relatos e solicitações', description: '', route: 'Reports', symbol: '!', accent: colors.amber, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'relatos_solicitacoes' },
    ]
  },

  // Regimento (submenu). Sem admin_geral: regimento, ocorrências e
  // notificações pertencem a um condomínio, e admin_geral não tem um.
  {
    title: 'Regimento e Ocorrências',
    shortTitle: 'Regimento',
    description: 'Artigos do regimento, ocorrências e notificações de infração.',
    symbol: '📖',
    accent: colors.amber,
    route: 'Occurrences',
    roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'],
    feature: 'regimento_ocorrencias',
    submenu: [
      { title: 'Artigos do regimento', shortTitle: 'Regimento', description: '', route: 'RegulationArticles', symbol: '📖', accent: colors.amber, roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
      { title: 'Ocorrências', shortTitle: 'Ocorrências', description: '', route: 'Occurrences', symbol: '⚑', accent: colors.teal, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
      { title: 'Emitir notificação', shortTitle: 'Emitir notificação', description: '', route: 'InfractionNoticeIssue', symbol: '✎', accent: colors.red, roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
      { title: 'Notificações de infração', shortTitle: 'Notificações', description: '', route: 'InfractionNotices', symbol: '⚠', accent: colors.primary, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
    ]
  },
];

const modules = buildMenuStructure();

const roleLabels: Record<string, string> = {
  admin_geral: 'Administrador geral',
  sindico: 'Síndico',
  subsindico: 'Subsíndico',
  proprietario: 'Proprietário',
  inquilino: 'Inquilino',
};

const tourSteps: TourStep[] = [
  { key: 'profile', title: 'Seu perfil', description: 'Mostra o cargo com que você está logado (Síndico, Subsíndico, Proprietário, Inquilino ou Administrador geral) — é esse cargo que define quais áreas aparecem no "Acesso rápido" logo abaixo e o que você pode fazer em cada uma.' },
  { key: 'quickAccess', title: 'Acesso rápido', description: 'Grade com as áreas liberadas pra você. Ela é montada automaticamente: primeiro filtra pelo seu cargo (ex.: só Síndico/Subsíndico veem "Prestação de contas" com formulário de lançamento, moradores só veem consulta) e depois pelas funcionalidades que o Administrador geral ativou pra esse condomínio em Condomínios > Funcionalidades ativas. Um card com "EM BREVE" ainda não tem tela associada.' },
  { key: 'security', title: 'Ambiente seguro', description: 'Lembrete de que os dados e credenciais do condomínio só são exibidos pra perfis autorizados — cada rota do menu é validada tanto na tela quanto na API antes de mostrar qualquer informação.' },
];
export default function Home({ navigation }: any) {
  const { user, userToken, signOut, condominiumFeatures } = useContext(AuthContext);
  const { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive } = useSectionTour();
  const { width, isDesktop: desktop, isTablet: tablet } = useBreakpoint();
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [unreadReports, setUnreadReports] = useState(0);
  const [condominiumName, setCondominiumName] = useState(user?.condominiumName || '');

  const admin = user?.role === 'admin_geral';
  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();

  // condominiumFeatures === null (admin_geral ou ainda carregando) nunca
  // esconde nada por funcionalidade, só o papel filtra nesse caso.
  const featureEnabled = (item: MenuItem) => !item.feature || admin || condominiumFeatures?.[item.feature] === true;

  // Todos os itens (para grid de acesso rápido)
  const allVisibleModules = modules.filter(item => item.roles.includes(user?.role || '') && featureEnabled(item));

  useEffect(() => {
    setCondominiumName(user?.condominiumName || '');
    if (!userToken || admin || user?.condominiumName) return;
    apiRequest<{user:{condominiumName?:string|null}}>('/auth/me',userToken)
      .then(response=>setCondominiumName(response.user.condominiumName || ''))
      .catch(()=>setCondominiumName(''));
  }, [admin,user?.condominiumName,userToken]);

  const loadAttention = useCallback(async () => {
    if (!userToken || admin) return;
    try {
      const [noticeData, reportData] = await Promise.all([
        apiRequest<{ count: number }>('/notifications/unread-count', userToken),
        apiRequest<{ reports: Array<{ unread_count: number }> }>('/reports', userToken),
      ]);
      setUnreadNotices(noticeData.count || 0);
      setUnreadReports(reportData.reports.reduce((sum, item) => sum + Number(item.unread_count || 0), 0));
    } catch {
      setUnreadNotices(0);
      setUnreadReports(0);
    }
  }, [admin, userToken]);

  useEffect(() => {
    loadAttention();
    const timer = setInterval(loadAttention, 30000);
    return () => clearInterval(timer);
  }, [loadAttention]);

  useEffect(() => subscribeNotificationsChanged(() => { void loadAttention(); }), [loadAttention]);

  return (
    <><ScrollView ref={scrollRef} contentContainerStyle={[styles.content, (tablet || !desktop) && styles.contentMobile]}>
      <View style={[styles.welcome, tablet && { paddingHorizontal: 20 }, !desktop && { paddingHorizontal: 16 }]}>
        <View style={styles.headerRow}>
          <View style={styles.grow}><Text style={styles.eyebrow}>VISÃO GERAL</Text><Text style={[styles.welcomeTitle, tablet && { fontSize: 24 }, !desktop && { fontSize: 22 }]}>Olá, {user?.username}! 👋</Text></View>
          <Pressable onPress={openTour} style={styles.tourButton}><Text style={styles.tourButtonText}>? Tour desta tela</Text></Pressable>
        </View>
        <Text style={[styles.welcomeText, tablet && { fontSize: 14 }, !desktop && { fontSize: 13 }]}>
          {admin ? 'Acompanhe e administre os condomínios da Administração geral.' : user?.role === 'sindico' || user?.role === 'subsindico' ? 'Acompanhe e administre o seu condomínio' : 'Acompanhe as informações do seu condomínio'}
          {!admin && <Text style={styles.condominiumHighlight}> "{condominiumName || 'Carregando...'}"</Text>}
          {!admin && '.'}
        </Text>
      </View>

      <View ref={registerSection('profile')} style={[isActive('profile') && styles.tourHighlight]}>
      <View style={[styles.statGrid, tablet && { paddingHorizontal: 20, gap: 12 }, !desktop && { paddingHorizontal: 16, gap: 10 }, (tablet || !desktop) && styles.horizontalCards]}>
        <View style={[styles.stat, styles.profileStat, tablet && { minHeight: 140, padding: 16 }, !desktop && { minHeight: 120, padding: 14 }]}><View style={styles.statHead}><View style={[styles.statIcon, { backgroundColor: '#fff3de' }]}><Text style={{ color: colors.amber }}>♙</Text></View><Text style={styles.statLabel}>SEU PERFIL</Text></View><Text numberOfLines={1} style={[styles.statValue, styles.roleValue, tablet && { fontSize: 18 }, !desktop && { fontSize: 16 }]}>{roleLabels[user?.role || ''] || 'Usuário'}</Text><Text style={styles.statDescription}>acesso personalizado por permissão</Text></View>
      </View>
      </View>

      <View ref={registerSection('quickAccess')} style={[isActive('quickAccess') && styles.tourHighlight]}>
      <View style={[styles.sectionHead, tablet && { paddingHorizontal: 20 }, !desktop && { paddingHorizontal: 16 }]}><View><Text style={[styles.sectionTitle, tablet && { fontSize: 18 }, !desktop && { fontSize: 16 }]}>Acesso rápido</Text><Text style={[styles.sectionSubtitle, tablet && { fontSize: 13 }, !desktop && { fontSize: 12 }]}>Escolha uma área para continuar</Text></View></View>
      <View style={[styles.moduleGrid, desktop ? styles.moduleGridDesktop : (tablet ? styles.moduleGridTablet : styles.moduleGridMobile)]}>
        {allVisibleModules.map((item) => {
          // Calcular flexBasis baseado na largura
          let cardStyle: any = {
            flexBasis: '100%',
            minHeight: 160,
            flexDirection: 'column',
            gap: 12,
            padding: 16,
          };
          
          if (desktop) {
            cardStyle = {
              flexGrow: 1,
              minHeight: 140,
              flexDirection: 'row',
              gap: 16,
              padding: 18,
              flexBasis: width > 1600 ? '24%' : '32%',
            };
          } else if (tablet) {
            cardStyle = {
              flexGrow: 1,
              minHeight: 120,
              flexDirection: 'row',
              gap: 12,
              padding: 14,
              flexBasis: '48%',
            };
          }
          
          return (
          <Pressable key={item.title} disabled={!item.route && !item.submenu} onPress={() => item.route ? navigation.navigate(item.route) : null} style={({ pressed }) => [
            styles.moduleCard,
            cardStyle,
            pressed && (item.route || item.submenu) && styles.pressed,
            !item.route && !item.submenu && styles.disabled
          ]}>
            <View style={[styles.moduleIcon, { backgroundColor: `${item.accent}18` }]}><Text style={[styles.moduleSymbol, { color: item.accent }]}>{item.symbol}</Text></View>
            <View style={styles.grow}><View style={styles.moduleTitleRow}><Text style={styles.moduleTitle}>{item.title}</Text>{!item.route && !item.submenu ? <Text style={styles.planned}>EM BREVE</Text> : <Text style={styles.arrow}>→</Text>}</View><Text style={styles.moduleDescription}>{item.description}</Text></View>
          </Pressable>
          );
        })}
      </View>
      </View>

      <View ref={registerSection('security')} style={[isActive('security') && styles.tourHighlight]}>
      <View style={[styles.securityCard, tablet && { marginHorizontal: 20, padding: 16 }, !desktop && { marginHorizontal: 16, padding: 14 }]}><View style={styles.securityIcon}><Text>🔒</Text></View><View style={styles.grow}><Text style={[styles.securityTitle, tablet && { fontSize: 14 }, !desktop && { fontSize: 13 }]}>Ambiente seguro</Text><Text style={[styles.securityText, tablet && { fontSize: 13 }, !desktop && { fontSize: 12 }]}>Seus dados e credenciais são protegidos e exibidos somente para perfis autorizados.</Text></View></View>
      </View>
      {(tablet || !desktop) ? <Pressable onPress={() => signOut()} style={[styles.mobileExit, tablet && { marginHorizontal: 20 }, !desktop && { marginHorizontal: 16 }]}><Text style={styles.mobileExitText}>Sair da conta</Text></Pressable> : null}
    </ScrollView>
    <FeatureTour steps={tourSteps} visible={tourOpen} onClose={closeTour} onStepChange={step => scrollToSection(step.key)} /></>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  tourButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.softBlue },
  tourButtonText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  tourHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: 16, padding: 6, margin: -6 },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: 0, paddingTop: 0, paddingBottom: 60 },
  contentMobile: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 100 },
  welcome: { marginBottom: 25, paddingHorizontal: 0, paddingTop: 31 },
  eyebrow: { color: '#8b98a6', fontSize: 13, letterSpacing: 1.1, fontWeight: '800', marginBottom: 7 },
  welcomeTitle: { color: '#15263a', fontSize: 28, fontWeight: '900' },
  welcomeText: { color: '#718091', fontSize: 16, lineHeight: 24, marginTop: 8 },
  condominiumHighlight: { color: colors.primaryDark, fontWeight: '900' },

  statGrid: { flexDirection: 'row', gap: 16, marginBottom: 28, paddingHorizontal: 0 },
  horizontalCards: { flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 240, minHeight: 160, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 20 },
  profileStat: { maxWidth: 480 },
  statFeatured: { borderTopWidth: 3, borderTopColor: colors.teal },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statLabel: { color: '#788796', fontSize: 12, fontWeight: '900', letterSpacing: .8 },
  statValue: { color: colors.ink, fontSize: 26, fontWeight: '900', marginTop: 14, marginBottom: 6 },
  roleValue: { fontSize: 20 },
  statDescription: { color: '#83909e', fontSize: 13 },

  attentionCard: { marginBottom: 26, marginHorizontal: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ecd598', borderRadius: layout.radius, padding: 16, gap: 10 },
  attentionHead: { marginBottom: 2 },
  attentionEyebrow: { color: '#9b6a00', fontSize: 12, fontWeight: '900', letterSpacing: .8 },
  attentionTitle: { color: '#5d3f00', fontSize: 20, fontWeight: '900', marginTop: 4 },
  attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#f1e4b7', borderRadius: 14, backgroundColor: '#fffaf0', paddingHorizontal: 12, paddingVertical: 12 },
  attentionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  attentionIconText: { color: '#7d5800', fontSize: 16, fontWeight: '900' },
  attentionRowTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  attentionRowText: { color: colors.muted, fontSize: 13, marginTop: 3 },
  attentionLink: { color: colors.primary, fontSize: 14, fontWeight: '900' },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 0 },
  sectionTitle: { color: '#25374b', fontSize: 20, fontWeight: '900' },
  sectionSubtitle: { color: '#8b97a3', fontSize: 15, marginTop: 5 },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 0, paddingBottom: 20 },
  moduleGridDesktop: { },
  moduleGridTablet: { gap: 12, paddingHorizontal: 20, paddingBottom: 16 },
  moduleGridMobile: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },

  /* Match profile card size and rhythm */
  moduleCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 18, alignItems: 'flex-start', gap: 16, minHeight: 160, flex: 1 },
  moduleCardTablet: { minHeight: 140, flex: 1 },
  moduleCardMobile: { minHeight: 150, flex: 1 },
  moduleIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  moduleSymbol: { fontSize: 20, fontWeight: '800' },
  moduleTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  moduleTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  moduleDescription: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  arrow: { color: colors.primary, fontSize: 20 },
  planned: { color: colors.muted, fontSize: 12, fontWeight: '900' },
  pressed: { opacity: .88, transform: [{ scale: .995 }] },
  disabled: { opacity: .65 },

  securityCard: { marginTop: 20, marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#f3f7fb', borderRadius: layout.radius, padding: 18 },
  securityIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' },
  securityTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  securityText: { color: colors.muted, fontSize: 14, lineHeight: 18, marginTop: 4 },
  mobileExit: { marginTop: 16, marginHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center' },
  mobileExitText: { color: colors.red, fontSize: 16, fontWeight: '800' },
});
