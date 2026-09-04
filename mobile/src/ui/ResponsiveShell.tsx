import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { AuthContext } from '../context/AuthContext';
import { startSystemTour } from '../services/tourEvents';
import { colors, layout } from './theme';
import { useBreakpoint } from './responsive';
import { apiRequest, API_BASE_URL } from '../api/client';
import { syncNotificationBadge } from '../services/pushNotifications';
import { subscribeNotificationsChanged } from '../services/notificationEvents';
import type { FeatureKey } from '../context/AuthContext';

type Item = { label: string; route: string; symbol: string; roles: string[]; feature?: FeatureKey };
type AndroidRelease = { id:string; version:string; buildNumber:string; releaseNotes:string|null; hasFile:boolean };

const items: Item[] = [
  { label: 'Relatos e solicitações', route: 'Reports', symbol: '!', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'relatos_solicitacoes' },
  { label: 'Avisos e comunicação', route: 'Communications', symbol: '●', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'avisos_comunicacao' },
  { label: 'Enquetes', route: 'Polls', symbol: '✓', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'enquetes' },
  { label: 'Reserva de espaços', route: 'SpaceReservations', symbol: '⌑', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'reserva_espacos' },
  { label: 'Início', route: 'Home', symbol: '⌂', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Painel', route: 'Dashboard', symbol: '◆', roles: ['sindico', 'subsindico'], feature: 'painel' },
  { label: 'Painel de usuários', route: 'UserStats', symbol: '☰', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'painel_usuarios' },
  { label: 'Indicadores de boletos', route: 'BillingAnalytics', symbol: '📈', roles: ['sindico', 'subsindico'], feature: 'indicadores_boletos' },
  { label: 'Condomínios', route: 'Condominiums', symbol: '▦', roles: ['admin_geral'] },
  { label: 'Pessoas', route: 'Users', symbol: '♙', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
  { label: 'Cadastro de bancos', route: 'Banks', symbol: '▣', roles: ['admin_geral'] },
  { label: 'Configurações bancárias', route: 'BankConfigurations', symbol: '⚙', roles: ['admin_geral'] },
  { label: 'Vincular banco ao condomínio', route: 'BankLink', symbol: '↔', roles: ['admin_geral'] },
  { label: 'Guia de expansão bancária', route: 'BankIntegrationGuide', symbol: '📘', roles: ['admin_geral'] },
  { label: 'Planos da plataforma', route: 'PlatformPlans', symbol: '◆', roles: ['admin_geral'] },
  { label: 'Faturamento da plataforma', route: 'PlatformRevenue', symbol: '$', roles: ['admin_geral'] },
  { label: 'Auditoria', route: 'AuditLog', symbol: '🛡', roles: ['admin_geral'] },
  { label: 'Tipologias', route: 'UnitTypes', symbol: '▧', roles: ['sindico', 'subsindico'], feature: 'tipologias' },
  { label: 'Blocos e unidades', route: 'Units', symbol: '▦', roles: ['sindico', 'subsindico'], feature: 'blocos_unidades' },
  { label: 'Nada consta', route: 'Clearances', symbol: '✓', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'nada_consta' },
  { label: 'Prestação de contas', route: 'Accountability', symbol: '$', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'prestacao_contas' },
  { label: 'Gestão de cobranças', route: 'Invoices', symbol: '▤', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_cobrancas' },
  { label: 'Gestão de débitos', route: 'Debts', symbol: '≋', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_debitos' },
  { label: 'Histórico de acordos', route: 'AgreementHistory', symbol: '📋', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'historico_acordos' },
  { label: 'Config. e Enviar cobranças', route: 'BillingSettings', symbol: '⚙', roles: ['sindico', 'subsindico'], feature: 'config_enviar_cobrancas' },
  { label: 'Cobranças adicionais', route: 'UnitExtraCharges', symbol: '➕', roles: ['sindico', 'subsindico'], feature: 'cobrancas_adicionais' },
  { label: 'Consumo (água/gás/energia)', route: 'UnitConsumption', symbol: '💧', roles: ['sindico', 'subsindico'], feature: 'consumo_individualizado' },
  // Regimento e ocorrências são de UM condomínio: as regras, os artigos e as
  // notificações pertencem à gestão local, e admin_geral não tem condomínio
  // (condominium_id nulo). Por isso ele fica de fora — o catálogo de rotas em
  // AppNavigator já o excluía, era só o menu que continuava mostrando.
  { label: 'Artigos do regimento', route: 'RegulationArticles', symbol: '📖', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  { label: 'Ocorrências', route: 'Occurrences', symbol: '⚑', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { label: 'Emitir notificação', route: 'InfractionNoticeIssue', symbol: '✎', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  { label: 'Notificações de infração', route: 'InfractionNotices', symbol: '⚠', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { label: 'Instalar aplicativo', route: 'MobileReleases', symbol: '↓', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
];

const roleLabels: Record<string, string> = { admin_geral: 'Administrador geral', sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };

// Manual do usuário: uma página por dupla de cargo (gestão x moradores). Não
// existe versão para admin_geral — quem administra a plataforma não usa manual.
const manualPathByRole: Record<string, string> = { sindico: '/help/sindico', subsindico: '/help/sindico', proprietario: '/help/morador', inquilino: '/help/morador' };
const manualUrlForRole = (role: string | undefined) => role && manualPathByRole[role] ? `${API_BASE_URL}${manualPathByRole[role]}` : null;
const billingRoutes = ['Invoices', 'Debts', 'AgreementHistory', 'BillingSettings', 'UnitExtraCharges', 'UnitConsumption'];
const noticeRoutes = ['Communications', 'Reports'];
const bankRoutes = ['Banks', 'BankConfigurations', 'BankLink', 'BankIntegration', 'BankIntegrationGuide'];
const regulationRoutes = ['RegulationArticles', 'Occurrences', 'InfractionNoticeIssue', 'InfractionNotices'];
const participationRoutes = ['Polls', 'SpaceReservations'];
const platformRoutes = ['Condominiums', 'PlatformPlans', 'PlatformRevenue', 'AuditLog'];

export default function ResponsiveShell({ activeRoute, navigation, children }: { activeRoute: string; navigation: any; children: React.ReactNode }) {
  const { atLeastTablet: desktop, isDesktop: isWide, isTablet } = useBreakpoint();
  // Android 15 desenha o app por baixo da status bar e da barra de gestos. Sem
  // reservar os insets, o título de cada tela nasce colado no relógio do sistema
  // e a barra inferior fica por baixo da barra de navegação do aparelho.
  const insets = useSafeAreaInsets();
  const { user, userToken, signOut, condominiumFeatures, profiles, switchProfile } = useContext(AuthContext);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const manualUrl = manualUrlForRole(user?.role);
  const openManual = useCallback(() => { if (manualUrl) Linking.openURL(manualUrl).catch(() => {}); }, [manualUrl]);
  const handleSwitchProfile = async (profileId: string | null) => {
    if (profileId === (user?.activeProfileId ?? null)) { setProfileMenuOpen(false); return; }
    setSwitchingProfile(true);
    try {
      await switchProfile(profileId);
      setProfileMenuOpen(false);
      setMobileMenuOpen(false);
    } catch {
      // O erro já fica em authError; o seletor continua aberto pra tentar de novo.
    } finally {
      setSwitchingProfile(false);
    }
  };
  const [condominiumName, setCondominiumName] = useState(user?.condominiumName || '');
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [unreadReports, setUnreadReports] = useState(0);
  const [androidRelease, setAndroidRelease] = useState<AndroidRelease | null>(null);
  // condominiumFeatures === null (admin_geral ou ainda carregando) nunca
  // esconde nada por funcionalidade, só o papel filtra nesse caso.
  const visible = items.filter((item) => item.roles.includes(user?.role || '') && (!item.feature || user?.role === 'admin_geral' || condominiumFeatures?.[item.feature] === true));
  const mainItems = visible.filter((item) => !billingRoutes.includes(item.route) && !noticeRoutes.includes(item.route) && !bankRoutes.includes(item.route) && !regulationRoutes.includes(item.route) && !participationRoutes.includes(item.route) && !platformRoutes.includes(item.route));
  const bankItems = visible.filter((item) => bankRoutes.includes(item.route));
  const billingItems = visible.filter((item) => billingRoutes.includes(item.route));
  const noticeItems = visible.filter((item) => noticeRoutes.includes(item.route)).sort((a, b) => noticeRoutes.indexOf(a.route) - noticeRoutes.indexOf(b.route));
  const regulationItems = visible.filter((item) => regulationRoutes.includes(item.route)).sort((a, b) => regulationRoutes.indexOf(a.route) - regulationRoutes.indexOf(b.route));
  const participationItems = visible.filter((item) => participationRoutes.includes(item.route)).sort((a, b) => participationRoutes.indexOf(a.route) - participationRoutes.indexOf(b.route));
  const platformItems = visible.filter((item) => platformRoutes.includes(item.route)).sort((a, b) => platformRoutes.indexOf(a.route) - platformRoutes.indexOf(b.route));
  const billingActive = billingRoutes.includes(activeRoute);
  const noticeActive = noticeRoutes.includes(activeRoute);
  const bankActive = bankRoutes.includes(activeRoute);
  const regulationActive = regulationRoutes.includes(activeRoute);
  const participationActive = participationRoutes.includes(activeRoute);
  const platformActive = platformRoutes.includes(activeRoute);
  const [billingOpen, setBillingOpen] = useState(billingActive);
  const [noticeOpen, setNoticeOpen] = useState(noticeActive);
  const [bankOpen, setBankOpen] = useState(bankActive);
  const [regulationOpen, setRegulationOpen] = useState(regulationActive);
  const [participationOpen, setParticipationOpen] = useState(participationActive);
  const [platformOpen, setPlatformOpen] = useState(platformActive);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();
  const activeLabel = items.find((item) => item.route === activeRoute)?.label || 'Lar em Dia';
  const totalAttention = unreadNotices + unreadReports;
  const installedVersion = Constants.expoConfig?.version || '0.0.0';
  const versionParts = (value:string) => value.split('.').map(part=>Number(part)||0);
  const isNewerVersion = (candidate:string,current:string) => {
    const next=versionParts(candidate); const active=versionParts(current);
    for(let index=0;index<Math.max(next.length,active.length);index++){if((next[index]||0)!==(active[index]||0))return (next[index]||0)>(active[index]||0)}
    return false;
  };
  const showReleaseNotice = Boolean(androidRelease) && (Platform.OS === 'web' || isNewerVersion(androidRelease?.version || '0', installedVersion));

  useEffect(() => {
    setBillingOpen(billingActive);
  }, [billingActive]);
  useEffect(() => {
    setNoticeOpen(noticeActive);
  }, [noticeActive]);
  useEffect(() => { setBankOpen(bankActive); }, [bankActive]);
  useEffect(() => { setRegulationOpen(regulationActive); }, [regulationActive]);
  useEffect(() => { setParticipationOpen(participationActive); }, [participationActive]);
  useEffect(() => { setPlatformOpen(platformActive); }, [platformActive]);

  useEffect(() => {
    setCondominiumName(user?.condominiumName || '');
    if (!userToken || user?.role === 'admin_geral' || user?.condominiumName) return;
    apiRequest<{user:{condominiumName?:string|null}}>('/auth/me',userToken)
      .then(response=>setCondominiumName(response.user.condominiumName || 'Meu condomínio'))
      .catch(()=>setCondominiumName('Meu condomínio'));
  }, [user?.condominiumName,user?.role,userToken]);

  useEffect(() => {
    if (!userToken) return;
    apiRequest<{android:AndroidRelease|null}>('/mobile-releases/latest',userToken)
      .then(response=>setAndroidRelease(response.android))
      .catch(()=>setAndroidRelease(null));
  }, [userToken]);

  const releaseBanner = showReleaseNotice && androidRelease ? (
    <Pressable style={styles.releaseBanner} onPress={()=>navigation.navigate('MobileReleases')}>
      <View style={styles.releaseBadge}><Text style={styles.releaseBadgeText}>NOVA VERSÃO</Text></View>
      <View style={styles.grow}>
        <Text style={styles.releaseTitle}>Lar em Dia {androidRelease.version} disponível</Text>
        <Text style={styles.releaseText}>{androidRelease.hasFile?'Baixe agora a atualização oficial para Android.':'O novo APK está em processamento. Acompanhe a disponibilidade.'}</Text>
      </View>
      <Text style={styles.releaseAction}>Ver versão →</Text>
    </Pressable>
  ) : null;

  const refreshAttention = useCallback(async () => {
    if (!userToken || user?.role === 'admin_geral') return;
    try {
      const [noticeData, reportData] = await Promise.all([
        apiRequest<{count:number}>('/notifications/unread-count', userToken),
        apiRequest<{reports:Array<{unread_count:number}>}>('/reports', userToken),
      ]);
      setUnreadNotices(noticeData.count);
      setUnreadReports(reportData.reports.reduce((sum, report) => sum + Number(report.unread_count || 0), 0));
    } catch {
      return null;
    }
  }, [user?.role, userToken]);

  useEffect(() => {
    refreshAttention();
    const timer = setInterval(refreshAttention, 30000);
    return () => clearInterval(timer);
  }, [activeRoute, refreshAttention]);

  useEffect(() => subscribeNotificationsChanged(() => { void refreshAttention(); }), [refreshAttention]);

  useEffect(() => {
    syncNotificationBadge(unreadNotices + unreadReports);
  }, [unreadNotices, unreadReports]);

  return (
    // No mobile os insets vão no ScrollView e na barra inferior, para o conteúdo
    // continuar rolando por baixo da status bar em vez de ganhar uma faixa fixa.
    <View style={[styles.shell, !desktop && styles.shellMobile, desktop && { paddingTop: insets.top }]}>
      {desktop && (
        <>
          <View style={styles.sidebar}>
            <View style={styles.brand}>
              <View style={styles.brandIconBox}>
                <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.brandLogo} resizeMode="contain" />
              </View>
              <View style={styles.brandInfo}>
                <Text style={styles.brandName}>Lar em Dia</Text>
                {condominiumName && <Text style={styles.brandCondominiumName}>{condominiumName}</Text>}
              </View>
            </View>

            <ScrollView>
              {mainItems.length > 0 && (
                <>
                  <Text style={styles.navLabel}>NAVEGAÇÃO</Text>
                  <View style={styles.navList}>
                    {mainItems.map((item) => (
                      <Pressable
                        key={item.route}
                        style={[styles.navItem, activeRoute === item.route && styles.navItemActive]}
                        onPress={() => navigation.navigate(item.route)}
                      >
                        <Text style={styles.navSymbol}>{item.symbol}</Text>
                        <Text style={[styles.navText, activeRoute === item.route && styles.navActive]}>{item.label}</Text>
                        {totalAttention > 0 && (item.route === 'Communications' || item.route === 'Reports') && (
                          <Text style={styles.unreadBadge}>{totalAttention}</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {bankItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>BANCOS</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, bankActive && styles.navItemActive]}
                      onPress={() => setBankOpen(!bankOpen)}
                    >
                      <Text style={styles.navSymbol}>⚙</Text>
                      <Text style={[styles.navText, bankActive && styles.navActive]}>Gestão bancária</Text>
                      <Text style={styles.navChevron}>{bankOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {bankOpen && (
                      <View style={styles.subnav}>
                        {bankItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {billingItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>COBRANÇAS</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, billingActive && styles.navItemActive]}
                      onPress={() => setBillingOpen(!billingOpen)}
                    >
                      <Text style={styles.navSymbol}>▤</Text>
                      <Text style={[styles.navText, billingActive && styles.navActive]}>Gestão de cobranças</Text>
                      <Text style={styles.navChevron}>{billingOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {billingOpen && (
                      <View style={styles.subnav}>
                        {billingItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {noticeItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>AVISOS</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, noticeActive && styles.navItemActive]}
                      onPress={() => setNoticeOpen(!noticeOpen)}
                    >
                      <Text style={styles.navSymbol}>●</Text>
                      <Text style={[styles.navText, noticeActive && styles.navActive]}>Avisos e comunicação</Text>
                      <Text style={styles.navChevron}>{noticeOpen ? '⌃' : '⌄'}</Text>
                      {totalAttention > 0 && <Text style={styles.unreadBadge}>{totalAttention}</Text>}
                    </Pressable>
                    {noticeOpen && (
                      <View style={styles.subnav}>
                        {noticeItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.route === 'Communications' ? 'Comunicação' : item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {regulationItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>REGIMENTO</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, regulationActive && styles.navItemActive]}
                      onPress={() => setRegulationOpen(!regulationOpen)}
                    >
                      <Text style={styles.navSymbol}>📖</Text>
                      <Text style={[styles.navText, regulationActive && styles.navActive]}>Regimento e Ocorrências</Text>
                      <Text style={styles.navChevron}>{regulationOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {regulationOpen && (
                      <View style={styles.subnav}>
                        {regulationItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {participationItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>PARTICIPAÇÃO</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, participationActive && styles.navItemActive]}
                      onPress={() => setParticipationOpen(!participationOpen)}
                    >
                      <Text style={styles.navSymbol}>✓</Text>
                      <Text style={[styles.navText, participationActive && styles.navActive]}>Participação</Text>
                      <Text style={styles.navChevron}>{participationOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {participationOpen && (
                      <View style={styles.subnav}>
                        {participationItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {platformItems.length > 0 && (
                <>
                  <Text style={[styles.navLabel, { marginTop: 28 }]}>PLATAFORMA</Text>
                  <View style={styles.navList}>
                    <Pressable
                      style={[styles.navItem, platformActive && styles.navItemActive]}
                      onPress={() => setPlatformOpen(!platformOpen)}
                    >
                      <Text style={styles.navSymbol}>▦</Text>
                      <Text style={[styles.navText, platformActive && styles.navActive]}>Plataforma</Text>
                      <Text style={styles.navChevron}>{platformOpen ? '⌃' : '⌄'}</Text>
                    </Pressable>
                    {platformOpen && (
                      <View style={styles.subnav}>
                        {platformItems.map((item) => (
                          <Pressable
                            key={item.route}
                            style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}
                            onPress={() => navigation.navigate(item.route)}
                          >
                            <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                            <Text style={styles.subnavText}>{item.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.profileAnchor}>
              {profiles.length > 1 && profileMenuOpen ? (
                <View style={styles.profileSwitcher}>
                  <Text style={styles.profileSwitcherTitle}>Trocar perfil</Text>
                  {profiles.map(profile => (
                    <Pressable
                      key={profile.id ?? 'default'}
                      onPress={() => handleSwitchProfile(profile.id)}
                      disabled={switchingProfile}
                      style={[styles.profileSwitcherItem, (user?.activeProfileId ?? null) === profile.id && styles.profileSwitcherItemActive]}
                    >
                      <Text style={styles.profileSwitcherItemText}>{roleLabels[profile.role]}{profile.condominiumName ? ` · ${profile.condominiumName}` : ''}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.profile}>
                <View style={styles.avatarLight}>
                  <Text style={styles.avatarLightText}>{initials}</Text>
                </View>
                <View style={styles.grow}>
                  <Text style={styles.profileName}>{user?.username}</Text>
                  {profiles.length > 1 ? (
                    <Pressable onPress={() => setProfileMenuOpen(current => !current)}>
                      <Text style={styles.profileRole}>{roleLabels[user?.role || '']} ▾</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.profileRole}>{roleLabels[user?.role || '']}</Text>
                  )}
                </View>
                {manualUrl ? <Pressable onPress={openManual} accessibilityLabel="Manual do usuário" style={[styles.profileTourButton, styles.profileManualButton]}><Text style={styles.profileTourIcon}>📘</Text></Pressable> : null}
                <Pressable onPress={startSystemTour} accessibilityLabel="Refazer tour" style={styles.profileTourButton}><Text style={styles.profileTourIcon}>?</Text></Pressable>
                <Pressable onPress={() => signOut()}>
                  <Text style={styles.exit}>↪</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.mainDesktop}>
            <View style={styles.topbar}>
                <View style={[styles.topbarInner, {
                  width: '100%',
                  paddingHorizontal: isTablet ? 20 : isWide ? 60 : 16,
                  maxWidth: isWide ? 1440 : isTablet ? 980 : '100%',
                  alignSelf: 'center'
                }]}>
                  <Text style={styles.breadcrumb}>
                    <Text style={styles.breadcrumbStrong}>{activeLabel}</Text>
                  </Text>
                  <View style={styles.topActions}>
                    <Pressable onPress={startSystemTour} style={styles.topTourButton}><Text style={styles.topTourIcon}>?</Text><Text style={styles.topTourText}>Tour guiado</Text></Pressable>
                    <View style={styles.online}>
                      <View style={styles.dot} />
                      <Text style={styles.onlineText}>Online</Text>
                    </View>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                  </View>
                </View>
              </View>
            <View style={[styles.body, Platform.OS === 'web' && webScrollableStyle]}>
              <View style={[styles.bodyContainer, {
                  width: '100%',
                  paddingHorizontal: isTablet ? 20 : isWide ? 60 : 16,
                  maxWidth: isWide ? 1440 : isTablet ? 980 : '100%',
                  alignSelf: 'center',
                  overflow: 'hidden'
                }]}>
                {releaseBanner}
                {children}
              </View>
            </View>
          </View>
        </>
      )}

      {!desktop ? (
        <>
          <ScrollView contentContainerStyle={[styles.mobileContentContainer, {
            paddingTop: styles.mobileContentContainer.padding + insets.top,
            paddingBottom: styles.mobileContentContainer.paddingBottom + insets.bottom,
          }]}>
            {releaseBanner}
            {children}
          </ScrollView>

          <View style={[styles.mobileNav, { height: styles.mobileNav.height + insets.bottom, paddingBottom: insets.bottom }]}>
            <Pressable style={styles.mobileNavItem} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.mobileNavIcon}>⌂</Text>
              <Text numberOfLines={1} style={styles.mobileNavText}>Início</Text>
            </Pressable>
            
            <Pressable style={styles.mobileNavItem} onPress={() => setMobileMenuOpen(true)}>
              <Text style={styles.mobileNavIcon}>☰</Text>
              <Text numberOfLines={1} style={styles.mobileNavText}>Menu</Text>
            </Pressable>
          </View>

          {mobileMenuOpen && (
            <>
              <Pressable 
                style={styles.mobileMenuOverlay}
                onPress={() => setMobileMenuOpen(false)}
              />
              <View style={[styles.mobileMenuDrawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                <View style={styles.mobileMenuHeader}>
                  <Text style={styles.mobileMenuTitle}>Menu de Navegação</Text>
                  <Pressable onPress={() => setMobileMenuOpen(false)}>
                    <Text style={styles.mobileMenuClose}>✕</Text>
                  </Pressable>
                </View>

                <ScrollView style={styles.mobileMenuContent}>
                  {mainItems.map((item) => (
                    <Pressable
                      key={item.route}
                      style={styles.mobileMenuItemParent}
                      onPress={() => { navigation.navigate(item.route); setMobileMenuOpen(false); }}
                    >
                      <Text style={styles.mobileMenuItemIcon}>{item.symbol}</Text>
                      <Text style={[styles.mobileMenuItemText, styles.grow]}>{item.label}</Text>
                      {totalAttention > 0 && (item.route === 'Communications' || item.route === 'Reports') && (
                        <Text style={styles.unreadBadge}>{totalAttention}</Text>
                      )}
                    </Pressable>
                  ))}

                  {[
                    { key: 'bank', label: 'Gestão bancária', symbol: '⚙', items: bankItems, open: bankOpen, setOpen: setBankOpen, badge: false },
                    { key: 'billing', label: 'Gestão de cobranças', symbol: '▤', items: billingItems, open: billingOpen, setOpen: setBillingOpen, badge: false },
                    { key: 'notice', label: 'Avisos e comunicação', symbol: '●', items: noticeItems, open: noticeOpen, setOpen: setNoticeOpen, badge: true },
                    { key: 'regulation', label: 'Regimento e Ocorrências', symbol: '📖', items: regulationItems, open: regulationOpen, setOpen: setRegulationOpen, badge: false },
                    { key: 'participation', label: 'Participação', symbol: '✓', items: participationItems, open: participationOpen, setOpen: setParticipationOpen, badge: false },
                    { key: 'platform', label: 'Plataforma', symbol: '▦', items: platformItems, open: platformOpen, setOpen: setPlatformOpen, badge: false },
                  ].map((group) => group.items.length === 0 ? null : (
                    <View key={group.key}>
                      <Pressable style={styles.mobileMenuItemParent} onPress={() => group.setOpen(!group.open)}>
                        <Text style={styles.mobileMenuItemIcon}>{group.symbol}</Text>
                        <Text style={[styles.mobileMenuItemText, styles.grow]}>{group.label}</Text>
                        {group.badge && totalAttention > 0 && <Text style={styles.unreadBadge}>{totalAttention}</Text>}
                        <Text style={styles.mobileMenuChevron}>{group.open ? '⌃' : '⌄'}</Text>
                      </Pressable>
                      {group.open && (
                        <View style={styles.mobileMenuSubmenu}>
                          {group.items.map((subitem) => (
                            <Pressable
                              key={subitem.route}
                              style={styles.mobileMenuItemChild}
                              onPress={() => { navigation.navigate(subitem.route); setMobileMenuOpen(false); }}
                            >
                              <View style={styles.mobileMenuSubmenuDot} />
                              <Text style={styles.mobileMenuItemChildText}>{subitem.route === 'Communications' ? 'Comunicação' : subitem.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </ScrollView>

                {profiles.length > 1 ? (
                  <View style={styles.mobileProfileSwitcher}>
                    <Text style={styles.profileSwitcherTitle}>Trocar perfil</Text>
                    {profiles.map(profile => (
                      <Pressable
                        key={profile.id ?? 'default'}
                        onPress={() => handleSwitchProfile(profile.id)}
                        disabled={switchingProfile}
                        style={[styles.profileSwitcherItem, (user?.activeProfileId ?? null) === profile.id && styles.profileSwitcherItemActive]}
                      >
                        <Text style={styles.profileSwitcherItemText}>{roleLabels[profile.role]}{profile.condominiumName ? ` · ${profile.condominiumName}` : ''}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {manualUrl ? <Pressable style={styles.mobileTourFooter} onPress={() => { setMobileMenuOpen(false); openManual(); }}><Text style={styles.mobileTourText}>📘 Manual do usuário</Text></Pressable> : null}
                <Pressable style={styles.mobileTourFooter} onPress={() => { setMobileMenuOpen(false); startSystemTour(); }}><Text style={styles.mobileTourText}>? Refazer tour do sistema</Text></Pressable>
                <Pressable style={styles.mobileMenuFooter} onPress={() => { setMobileMenuOpen(false); signOut(); }}>
                  <Text style={styles.mobileMenuLogout}>Sair da conta</Text>
                </Pressable>
              </View>
            </>
          )}
        </>
      ) : null}
    </View>
  );
}

// `overflowY` existe no React Native Web, mas não faz parte de ViewStyle no
// React Native nativo. Mantê-lo separado preserva a rolagem no navegador sem
// enviar uma propriedade web para Android/iOS.
const webScrollableStyle = { overflowY: 'auto' } as any;

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background, overflow: 'hidden' },
  shellMobile: { position: 'relative' },
  grow: { flex: 1 }, main: { flex: 1 }, mainDesktop: { flex: 1, minWidth: 0 },
  sidebar: { width: layout.sidebarWidth, flexShrink: 0, backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: 18, paddingTop: 27, paddingBottom: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 18, marginBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.border }, 
  brandIconBox: { width: 42, height: 42, borderRadius: 8, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' }, 
  brandIconText: { fontSize: 24 },
  brandLogo: { width: 32, height: 32 },
  brandInfo: { flex: 1 }, 
  brandName: { color: colors.navy, fontSize: 18, fontWeight: '900', letterSpacing: .2 }, 
  brandCondominiumName: { color: '#8190a0', fontSize: 13, marginTop: 2, fontWeight: '600' }, 
  mobileTitle: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  navLabel: { marginHorizontal: 12, marginBottom: 9, color: '#7e8b98', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 }, navList: { gap: 4 }, navItem: { minHeight: 54, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14 }, navItemActive: { backgroundColor: '#eaf1fb' }, navSymbol: { width: 32, textAlign: 'center', color: '#536474', fontSize: 26, fontWeight: '800' }, navText: { color: '#536474', fontSize: 16, fontWeight: '700' }, navActive: { color: colors.primaryDark, fontWeight: '900' },
  navChevron: { color: '#8b98a5', fontSize: 17, fontWeight: '900' },
  unreadBadge: { marginLeft: 'auto', minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', textAlign: 'center', lineHeight: 22, color: '#fff', backgroundColor: colors.red, fontSize: 13, fontWeight: '900' },
  subnav: { marginLeft: 23, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: '#dce4ed', gap: 2, marginBottom: 3 },
  subnavItem: { minHeight: 36, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  subnavItemActive: { backgroundColor: '#f1f5fb' },
  subnavDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a8b2bd' },
  subnavDotActive: { backgroundColor: colors.primary },
  subnavText: { color: '#6e7b88', fontSize: 14, fontWeight: '700' },
  profileAnchor: { marginTop: 'auto' },
  profile: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatarLight: { width: 33, height: 33, borderRadius: 17, backgroundColor: '#dfe9f6', alignItems: 'center', justifyContent: 'center' }, avatarLightText: { color: colors.primary, fontSize: 14, fontWeight: '800' }, profileName: { color: colors.ink, fontSize: 14, fontWeight: '800' }, profileRole: { color: '#8190a0', fontSize: 12, marginTop: 2 },profileTourButton:{width:34,height:34,borderRadius:17,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center',shadowColor:colors.primary,shadowOpacity:.22,shadowRadius:6,elevation:2},profileManualButton:{backgroundColor:colors.teal,shadowColor:colors.teal},profileTourIcon:{color:'#fff',fontSize:17,fontWeight:'900'}, exit: { color: colors.red, fontSize: 13, fontWeight: '800' },
  profileSwitcher: { paddingHorizontal: 8, paddingVertical: 8, marginBottom: 8, gap: 4, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  mobileProfileSwitcher: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: '#f9f9fa', gap: 4 },
  profileSwitcherTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', marginBottom: 2 },
  profileSwitcherItem: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: 'transparent' },
  profileSwitcherItemActive: { backgroundColor: colors.softBlue },
  profileSwitcherItemText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  topbar: { height: 90, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border },
  topbarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  breadcrumb: { color: '#8794a2', fontSize: 16 }, breadcrumbStrong: { color: '#34475c', fontWeight: '800', fontSize: 18 }, topActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 20 }, online: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#dce8e5', backgroundColor: '#f6fbf9', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2bb596', marginRight: 6 }, onlineText: { color: '#497067', fontSize: 15, fontWeight: '600' }, avatar: { width: 45, height: 45, borderRadius: 23, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  topTourButton:{minHeight:40,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,borderRadius:20,backgroundColor:colors.primary,shadowColor:colors.primary,shadowOpacity:.18,shadowRadius:8,elevation:2},topTourIcon:{width:22,height:22,borderRadius:11,overflow:'hidden',backgroundColor:'rgba(255,255,255,.18)',color:'#fff',textAlign:'center',lineHeight:22,fontWeight:'900'},topTourText:{color:'#fff',fontSize:14,fontWeight:'900'},
  body: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: colors.background }, bodyContainer: { width: '100%', paddingHorizontal: 24 }, bodyMobile: { paddingBottom: 70 }, mobileContentContainer: { flexGrow: 1, alignItems: 'stretch', padding: 16, paddingBottom: 90, backgroundColor: colors.background }, attentionBanner: { marginHorizontal: 14, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#fff4db', borderWidth: 1, borderColor: '#f1d28b', flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, attentionTitle: { color: '#7a4a00', fontSize: 15, fontWeight: '900' }, attentionText: { color: '#8d6517', fontSize: 13, marginTop: 3 }, attentionAction: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6bf68', alignItems: 'center', justifyContent: 'center' }, attentionActionText: { color: '#7a4a00', fontSize: 13, fontWeight: '900' },
  noticeTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, backgroundColor: colors.background }, noticeTab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff', paddingHorizontal: 8 }, noticeTabActive: { backgroundColor: colors.primary, borderColor: colors.primary }, noticeTabText: { color: colors.ink, fontSize: 15, fontWeight: '800', textAlign: 'center' }, noticeTabTextActive: { color: '#fff', fontWeight: '900' },
  mobileNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'center', gap: 0, zIndex: 10 },
  mobileNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 },
  mobileNavIcon: { fontSize: 24, fontWeight: '800', color: '#667085' },
  mobileNavText: { fontSize: 11, fontWeight: '800', color: '#667085', textAlign: 'center' },
  mobileMenuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 11 },
  mobileMenuDrawer: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '80%', maxWidth: 320, backgroundColor: '#fff', zIndex: 12, flexDirection: 'column' },
  mobileMenuHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mobileMenuTitle: { fontSize: 16, fontWeight: '900', color: colors.ink },
  mobileMenuClose: { fontSize: 20, fontWeight: '800', color: colors.muted },
  mobileMenuContent: { flex: 1, paddingVertical: 8 },
  mobileMenuItemParent: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  mobileMenuItemIcon: { fontSize: 18, fontWeight: '800', color: colors.primary, minWidth: 24 },
  mobileMenuItemText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  mobileMenuChevron: { fontSize: 16, fontWeight: '900', color: colors.muted },
  mobileMenuSubmenu: { backgroundColor: '#f9f9fa', paddingLeft: 16 },
  mobileMenuItemChild: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mobileMenuSubmenuDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  mobileMenuItemChildText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  mobileMenuFooter: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: '#fee2e2', alignItems: 'center' },
  mobileTourFooter:{paddingHorizontal:16,paddingVertical:12,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.softBlue,alignItems:'center'},mobileTourText:{fontSize:14,fontWeight:'900',color:colors.primary},
  mobileMenuLogout: { fontSize: 14, fontWeight: '900', color: colors.red },
  releaseBanner:{width:'100%',marginTop:14,marginBottom:4,borderWidth:1,borderColor:'#9fc5f8',borderRadius:13,backgroundColor:'#eaf4ff',padding:14,flexDirection:'row',alignItems:'center',gap:12,flexWrap:'wrap'},
  releaseBadge:{backgroundColor:colors.primary,borderRadius:99,paddingHorizontal:9,paddingVertical:5},releaseBadgeText:{color:'#fff',fontSize:11,fontWeight:'900',letterSpacing:.5},
  releaseTitle:{color:colors.primaryDark,fontSize:16,fontWeight:'900'},releaseText:{color:'#496985',fontSize:13,marginTop:3},releaseAction:{color:colors.primaryDark,fontWeight:'900'},
});
