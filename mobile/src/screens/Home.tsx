import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
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
import { MANAGEMENT_ROUTES } from '../navigation/routeRoles';

// No app nativo, rotas de gestão nem existem no Stack (ver ManagementStack
// .web/.native.tsx) — tocar num atalho dessas mostra este aviso em vez de
// tentar navegar para uma tela que não foi empacotada no binário.
const WEB_ONLY_MESSAGE = 'Esta função está disponível apenas na versão web. Abra app.laremdia.com.br no navegador do seu celular ou computador para usá-la.';
const goToRoute = (navigation: any, route?: string) => {
  if (!route) return;
  if (Platform.OS !== 'web' && MANAGEMENT_ROUTES.has(route)) {
    Alert.alert('Disponível na versão web', WEB_ONLY_MESSAGE);
    return;
  }
  navigation.navigate(route);
};

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
  { title: 'Recebimentos da plataforma', shortTitle: 'Recebimentos', description: 'Faturas cobradas dos condomínios, pagamentos via Pix e confirmações.', route: 'PlatformReceipts', symbol: '✓', accent: colors.teal, roles: ['admin_geral'] },
  { title: 'Auditoria', shortTitle: 'Auditoria', description: 'Ações de síndicos e subsíndicos por condomínio.', route: 'AuditLog', symbol: '🛡', accent: colors.primary, roles: ['admin_geral'] },
  { title: 'Suporte', shortTitle: 'Suporte', description: 'Localize uma pessoa e corrija problemas de acesso: sessão travada, login bloqueado, senha e aceite de termos.', route: 'Support', symbol: '🛠', accent: colors.primary, roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
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

const formatCurrency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const roleLabels: Record<string, string> = {
  admin_geral: 'Administrador geral',
  sindico: 'Síndico',
  subsindico: 'Subsíndico',
  proprietario: 'Proprietário',
  inquilino: 'Inquilino',
};

const tourSteps: TourStep[] = [
  { key: 'profile', title: 'Seu perfil', description: 'Mostra o cargo com que você está logado (Síndico, Subsíndico, Proprietário, Inquilino ou Administrador geral) — é esse cargo que define quais áreas aparecem no "Acesso rápido" logo abaixo e o que você pode fazer em cada uma. Síndico/subsíndico também veem, ao lado, o plano de cobrança da plataforma contratado pelo condomínio e quanto o mês está dando até agora — inclusive quantos usuários excedentes e o quanto isso já soma, quando o plano é do tipo "base + incluídos" (quando a funcionalidade "Painel de usuários" está ativa). Toque no card pra ver o detalhamento completo.' },
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
  const [planUsage, setPlanUsage] = useState<{
    hasPlan: boolean; planName?: string; planType?: string;
    basePriceCents?: number | null; includedQuantity?: number | null; overagePriceCents?: number | null;
    overageUnits?: number | null; overageAmountCents?: number | null; estimatedMonthlyAmountCents?: number | null;
  } | null>(null);

  // Fatura da plataforma em aberto do condomínio (cobrança do sistema, com
  // Pix) — só síndico/subsíndico veem.
  const [platformInvoice, setPlatformInvoice] = useState<{
    id: string; reference_month: string; amount_cents: number; plan_name: string; due_date: string | null; overdue: boolean;
    pix_copy_paste: string | null; pix_qr_code_base64: string | null;
  } | null>(null);
  const [paidInvoice, setPaidInvoice] = useState<{ reference_month: string; amount_cents: number; plan_name: string; paid_at: string; receipt_sent_at: string | null } | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const admin = user?.role === 'admin_geral';
  const manager = user?.role === 'sindico' || user?.role === 'subsindico';
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

  // Plano da plataforma contratado pelo condomínio — só síndico/subsíndico
  // administram isso (moradores não precisam ver, admin_geral não tem um
  // condomínio próprio). Mesmo endpoint que Pessoas e Painel de usuários já
  // usam, pra nome/valor/excedente aqui baterem exatamente com as outras telas.
  useEffect(() => {
    if (!userToken || !manager) { setPlanUsage(null); return; }
    apiRequest<{
      hasPlan: boolean; planName?: string; planType?: string;
      basePriceCents?: number | null; includedQuantity?: number | null; overagePriceCents?: number | null;
      overageUnits?: number | null; overageAmountCents?: number | null; estimatedMonthlyAmountCents?: number | null;
    }>('/condominiums/plan-usage', userToken)
      .then(response => setPlanUsage(response))
      .catch(() => setPlanUsage(null));
  }, [manager, userToken]);

  // Carrega a fatura da plataforma e atualiza sozinho a cada 30 s — assim, assim
  // que o pagamento é confirmado (webhook, job de 15 min ou "Verificar"), o
  // cartão vira "Fatura paga" sem precisar recarregar a tela.
  const loadPlatformInvoice = useCallback(async () => {
    if (!userToken || !manager) { setPlatformInvoice(null); setPaidInvoice(null); return; }
    try {
      const response = await apiRequest<{ invoice: typeof platformInvoice; paidInvoice: typeof paidInvoice }>('/condominiums/platform-invoice', userToken);
      setPlatformInvoice(response.invoice);
      setPaidInvoice(response.paidInvoice);
    } catch {
      setPlatformInvoice(null);
      setPaidInvoice(null);
    }
  }, [manager, userToken]);

  useEffect(() => {
    loadPlatformInvoice();
    if (!manager) return;
    const timer = setInterval(loadPlatformInvoice, 30000);
    return () => clearInterval(timer);
  }, [loadPlatformInvoice, manager]);

  const verifyPlatformPayment = async () => {
    if (!userToken) return;
    setVerifying(true);
    setVerifyMessage(null);
    try {
      const response = await apiRequest<{ invoice: typeof platformInvoice; paidInvoice: typeof paidInvoice; paid: number }>('/condominiums/platform-invoice/verify', userToken, { method: 'POST' });
      setPlatformInvoice(response.invoice);
      setPaidInvoice(response.paidInvoice);
      setVerifyMessage(response.paid > 0 ? 'Pagamento confirmado! Obrigado.' : 'Ainda não identificamos o pagamento. O Pix pode levar alguns instantes — tente de novo em um minuto.');
    } catch {
      setVerifyMessage('Não foi possível verificar agora. Tente novamente em instantes.');
    } finally {
      setVerifying(false);
    }
  };

  const copyPlatformPix = async () => {
    if (!platformInvoice?.pix_copy_paste) return;
    try {
      await Clipboard.setStringAsync(platformInvoice.pix_copy_paste);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
    } catch {
      Alert.alert('Não foi possível copiar', 'Selecione o código e copie manualmente.');
    }
  };

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

      {manager && platformInvoice ? (
        <View style={[styles.invoiceCard, platformInvoice.overdue && styles.invoiceCardOverdue, tablet && { marginHorizontal: 20 }, !desktop && { marginHorizontal: 16 }]}>
          <Text style={[styles.invoiceEyebrow, platformInvoice.overdue && { color: colors.red }]}>{platformInvoice.overdue ? 'FATURA DA PLATAFORMA EM ATRASO' : 'FATURA DA PLATAFORMA EM ABERTO'}</Text>
          <Text style={styles.invoiceAmount}>{formatCurrency(platformInvoice.amount_cents)}</Text>
          <Text style={styles.invoiceMeta}>
            Plano {platformInvoice.plan_name} · competência {new Date(platformInvoice.reference_month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            {platformInvoice.due_date ? ` · vence em ${new Date(`${platformInvoice.due_date}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}
          </Text>
          {platformInvoice.pix_copy_paste ? (
            <>
              <View style={styles.invoicePixRow}>
                {platformInvoice.pix_qr_code_base64 ? <Image source={{ uri: `data:image/png;base64,${platformInvoice.pix_qr_code_base64}` }} style={styles.invoiceQr} /> : null}
                <View style={styles.grow}>
                  <Text style={styles.invoicePixLabel}>Pix Copia e Cola</Text>
                  <Text selectable numberOfLines={3} style={styles.invoicePixCode}>{platformInvoice.pix_copy_paste}</Text>
                  <Pressable onPress={copyPlatformPix} style={styles.invoiceCopy}><Text style={styles.invoiceCopyText}>{pixCopied ? 'Código copiado ✓' : 'Copiar código Pix'}</Text></Pressable>
                </View>
              </View>
              <Pressable onPress={verifyPlatformPayment} disabled={verifying} style={[styles.invoiceVerify, verifying && { opacity: 0.6 }]}><Text style={styles.invoiceVerifyText}>{verifying ? 'Verificando...' : 'Já paguei — verificar pagamento'}</Text></Pressable>
              {verifyMessage ? <Text style={styles.invoiceHint}>{verifyMessage}</Text> : null}
              <Text style={styles.invoiceHint}>A confirmação também é automática (a tela atualiza sozinha) e o recibo chega por e-mail.</Text>
            </>
          ) : (
            <Text style={styles.invoiceHint}>O código Pix desta fatura ainda está sendo gerado — a administração da plataforma enviará por e-mail.</Text>
          )}
        </View>
      ) : null}

      {manager && !platformInvoice && paidInvoice ? (
        <View style={[styles.invoiceCard, styles.invoiceCardPaid, tablet && { marginHorizontal: 20 }, !desktop && { marginHorizontal: 16 }]}>
          <Text style={[styles.invoiceEyebrow, { color: colors.green }]}>✓ FATURA DA PLATAFORMA PAGA</Text>
          <Text style={styles.invoiceAmount}>{formatCurrency(paidInvoice.amount_cents)}</Text>
          <Text style={styles.invoiceMeta}>
            Plano {paidInvoice.plan_name} · competência {new Date(paidInvoice.reference_month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · pago em {new Date(paidInvoice.paid_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </Text>
          <Text style={styles.invoiceHint}>{paidInvoice.receipt_sent_at ? 'O recibo foi enviado por e-mail — guarde-o para a prestação de contas do condomínio.' : 'O recibo será enviado por e-mail.'}</Text>
        </View>
      ) : null}

      <View ref={registerSection('profile')} style={[isActive('profile') && styles.tourHighlight]}>
      <View style={[styles.statGrid, tablet && { paddingHorizontal: 20, gap: 12 }, !desktop && { paddingHorizontal: 16, gap: 10 }, (tablet || !desktop) && styles.horizontalCards]}>
        <View style={[styles.stat, styles.profileStat, tablet && { minHeight: 140, padding: 16 }, !desktop && { minHeight: 120, padding: 14 }]}><View style={styles.statHead}><View style={[styles.statIcon, { backgroundColor: '#fff3de' }]}><Text style={{ color: colors.amber }}>♙</Text></View><Text style={styles.statLabel}>SEU PERFIL</Text></View><Text numberOfLines={1} style={[styles.statValue, styles.roleValue, tablet && { fontSize: 18 }, !desktop && { fontSize: 16 }]}>{roleLabels[user?.role || ''] || 'Usuário'}</Text><Text style={styles.statDescription}>acesso personalizado por permissão</Text></View>
        {manager && planUsage?.hasPlan && planUsage.planName && condominiumFeatures?.painel_usuarios === true ? (
          <Pressable onPress={() => goToRoute(navigation, 'UserStats')} style={[styles.stat, styles.profileStat, tablet && { minHeight: 140, padding: 16 }, !desktop && { minHeight: 120, padding: 14 }]}>
            <View style={styles.statHead}><View style={[styles.statIcon, { backgroundColor: '#eaf1fb' }]}><Text style={{ color: colors.primary }}>◆</Text></View><Text style={styles.statLabel}>PLANO DA PLATAFORMA</Text></View>
            <Text numberOfLines={1} style={[styles.statValue, styles.roleValue, tablet && { fontSize: 18 }, !desktop && { fontSize: 16 }]}>{planUsage.planName}</Text>
            {planUsage.planType === 'included_overage' && planUsage.includedQuantity != null ? (
              <Text style={styles.statDescription}>
                {formatCurrency(planUsage.basePriceCents || 0)}/mês · até {planUsage.includedQuantity} incluído{planUsage.includedQuantity === 1 ? '' : 's'} · excedente: {formatCurrency(planUsage.overagePriceCents || 0)}/usuário
              </Text>
            ) : null}
            <Text style={styles.statDescription}>
              {planUsage.estimatedMonthlyAmountCents != null ? `até o momento, o valor está em ${formatCurrency(planUsage.estimatedMonthlyAmountCents)}` : 'toque para ver o uso e o valor'}
              {(planUsage.overageUnits || 0) > 0
                ? ` (${planUsage.overageUnits} excedente${planUsage.overageUnits === 1 ? '' : 's'} × ${formatCurrency(planUsage.overagePriceCents || 0)} = ${formatCurrency(planUsage.overageAmountCents || 0)})`
                : ''}
            </Text>
          </Pressable>
        ) : null}
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
          
          const webOnly = Platform.OS !== 'web' && !!item.route && MANAGEMENT_ROUTES.has(item.route);
          return (
          <Pressable key={item.title} disabled={!item.route && !item.submenu} onPress={() => goToRoute(navigation, item.route)} style={({ pressed }) => [
            styles.moduleCard,
            cardStyle,
            pressed && (item.route || item.submenu) && styles.pressed,
            !item.route && !item.submenu && styles.disabled
          ]}>
            <View style={[styles.moduleIcon, { backgroundColor: `${item.accent}18` }]}><Text style={[styles.moduleSymbol, { color: item.accent }]}>{item.symbol}</Text></View>
            <View style={styles.grow}><View style={styles.moduleTitleRow}><Text style={styles.moduleTitle}>{item.title}</Text>{!item.route && !item.submenu ? <Text style={styles.planned}>EM BREVE</Text> : webOnly ? <Text style={styles.planned}>🌐 WEB</Text> : <Text style={styles.arrow}>→</Text>}</View><Text style={styles.moduleDescription}>{item.description}</Text></View>
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

  invoiceCard: { marginHorizontal: 0, marginBottom: 20, borderWidth: 1, borderColor: '#f0d9a8', backgroundColor: '#fdf7ea', borderRadius: layout.radius, padding: 18, gap: 6 },
  invoiceCardPaid: { borderColor: '#a8ddd0', backgroundColor: colors.softGreen },
  invoiceVerify: { alignSelf: 'flex-start', marginTop: 10, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  invoiceVerifyText: { color: colors.primaryDark, fontWeight: '900', fontSize: 13 },
  invoiceCardOverdue: { borderColor: colors.red, backgroundColor: '#fbeaea' },
  invoiceEyebrow: { color: '#9b6a00', fontSize: 12, fontWeight: '900', letterSpacing: .8 },
  invoiceAmount: { color: colors.ink, fontSize: 26, fontWeight: '900' },
  invoiceMeta: { color: colors.muted, fontSize: 13 },
  invoicePixRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 10 },
  invoiceQr: { width: 132, height: 132, borderRadius: 8, backgroundColor: '#fff' },
  invoicePixLabel: { color: colors.ink, fontWeight: '900', fontSize: 13 },
  invoicePixCode: { color: colors.muted, fontSize: 11, marginTop: 4 },
  invoiceCopy: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  invoiceCopyText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  invoiceHint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  securityCard: { marginTop: 20, marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#f3f7fb', borderRadius: layout.radius, padding: 18 },
  securityIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' },
  securityTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  securityText: { color: colors.muted, fontSize: 14, lineHeight: 18, marginTop: 4 },
  mobileExit: { marginTop: 16, marginHorizontal: 16, height: 44, alignItems: 'center', justifyContent: 'center' },
  mobileExitText: { color: colors.red, fontSize: 16, fontWeight: '800' },
});
