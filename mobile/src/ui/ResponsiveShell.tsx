import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { startSystemTour } from '../services/tourEvents';
import { colors, layout, MAX_FONT_SCALE } from './theme';
import { useBreakpoint } from './responsive';
import { apiRequest, API_BASE_URL } from '../api/client';
import { syncNotificationBadge } from '../services/pushNotifications';
import { subscribeNotificationsChanged } from '../services/notificationEvents';
import type { FeatureKey } from '../context/AuthContext';
import { MANAGEMENT_ROUTES } from '../navigation/routeRoles';
import { useBiometricSetting } from './BiometricLock';
import { isStoreReviewEnabled, markReviewDone, openStoreReview, reviewStoreName } from '../services/storeReview';

// webOnly: item que só aparece no menu da versão web (nenhum hoje).
// residentLabel: nome do item para proprietário/inquilino, quando o da gestão
// não faz sentido para quem só tem a própria unidade.
type Item = { label: string; residentLabel?: string; route: string; symbol: string; roles: string[]; feature?: FeatureKey; webOnly?: boolean };

const items: Item[] = [
  { label: 'Relatos', route: 'Reports', symbol: '!', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'relatos_solicitacoes' },
  { label: 'Avisos', route: 'Communications', symbol: '●', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'avisos_comunicacao' },
  { label: 'Enquetes', route: 'Polls', symbol: '✓', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'enquetes' },
  { label: 'Reservas', route: 'SpaceReservations', symbol: '⌑', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'reserva_espacos' },
  { label: 'Início', route: 'Home', symbol: '⌂', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Painel', route: 'Dashboard', symbol: '◆', roles: ['sindico', 'subsindico'], feature: 'painel' },
  { label: 'Painel de usuários', route: 'UserStats', symbol: '☰', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'painel_usuarios' },
  { label: 'Minhas faturas', route: 'PlatformInvoices', symbol: '🧾', roles: ['sindico', 'subsindico'] },
  { label: 'Indicadores', route: 'BillingAnalytics', symbol: '📈', roles: ['sindico', 'subsindico'], feature: 'indicadores_boletos' },
  { label: 'Condomínios', route: 'Condominiums', symbol: '▦', roles: ['admin_geral'] },
  { label: 'Pessoas', route: 'Users', symbol: '♙', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
  { label: 'Cadastro de bancos', route: 'Banks', symbol: '▣', roles: ['admin_geral'] },
  { label: 'Configurações bancárias', route: 'BankConfigurations', symbol: '⚙', roles: ['admin_geral'] },
  { label: 'Vincular banco ao condomínio', route: 'BankLink', symbol: '↔', roles: ['admin_geral'] },
  { label: 'Guia de expansão bancária', route: 'BankIntegrationGuide', symbol: '📘', roles: ['admin_geral'] },
  { label: 'Planos da plataforma', route: 'PlatformPlans', symbol: '◆', roles: ['admin_geral'] },
  { label: 'Faturamento da plataforma', route: 'PlatformRevenue', symbol: '$', roles: ['admin_geral'] },
  { label: 'Recebimentos da plataforma', route: 'PlatformReceipts', symbol: '✓', roles: ['admin_geral'] },
  { label: 'Auditoria', route: 'AuditLog', symbol: '🛡', roles: ['admin_geral'] },
  { label: 'Google Drive', route: 'GoogleDriveIntegrationGuide', symbol: '📁', roles: ['admin_geral'] },
  { label: 'Suporte', route: 'Support', symbol: '🛠', roles: ['admin_geral', 'sindico', 'subsindico'], feature: 'pessoas' },
  { label: 'Tipologias', route: 'UnitTypes', symbol: '▧', roles: ['sindico', 'subsindico'], feature: 'tipologias' },
  { label: 'Blocos e unidades', route: 'Units', symbol: '▦', roles: ['sindico', 'subsindico'], feature: 'blocos_unidades' },
  { label: 'Nada consta', route: 'Clearances', symbol: '✓', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'nada_consta' },
  { label: 'Prestação de contas', route: 'Accountability', symbol: '$', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'prestacao_contas' },
  { label: 'Cobranças', residentLabel: 'Meus boletos', route: 'Invoices', symbol: '▤', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_cobrancas' },
  { label: 'Débitos', residentLabel: 'Meus débitos', route: 'Debts', symbol: '≋', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'gestao_debitos' },
  { label: 'Acordos', route: 'AgreementHistory', symbol: '📋', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'historico_acordos' },
  { label: 'Configurar e enviar', route: 'BillingSettings', symbol: '⚙', roles: ['sindico', 'subsindico'], feature: 'config_enviar_cobrancas' },
  { label: 'Cobranças adicionais', route: 'UnitExtraCharges', symbol: '➕', roles: ['sindico', 'subsindico'], feature: 'cobrancas_adicionais' },
  { label: 'Consumo', route: 'UnitConsumption', symbol: '💧', roles: ['sindico', 'subsindico'], feature: 'consumo_individualizado' },
  // Regimento e ocorrências são de UM condomínio: as regras, os artigos e as
  // notificações pertencem à gestão local, e admin_geral não tem condomínio
  // (condominium_id nulo). Por isso ele fica de fora — o catálogo de rotas em
  // AppNavigator já o excluía, era só o menu que continuava mostrando.
  { label: 'Artigos', route: 'RegulationArticles', symbol: '📖', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  // Mesma seção para o morador, em modo leitura (e presente no app nativo).
  { label: 'Regimento', route: 'Regulation', symbol: '📖', roles: ['proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { label: 'Ocorrências', route: 'Occurrences', symbol: '⚑', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
  { label: 'Emitir notificação', route: 'InfractionNoticeIssue', symbol: '✎', roles: ['sindico', 'subsindico'], feature: 'regimento_ocorrencias' },
  { label: 'Notificações', route: 'InfractionNotices', symbol: '⚠', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'], feature: 'regimento_ocorrencias' },
];

const roleLabels: Record<string, string> = { admin_geral: 'Administrador geral', sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };

// Manual do usuário: uma página por dupla de cargo (gestão x moradores). Não
// existe versão para admin_geral — quem administra a plataforma não usa manual.
const manualPathByRole: Record<string, string> = { sindico: '/help/sindico', subsindico: '/help/sindico', proprietario: '/help/morador', inquilino: '/help/morador' };
const manualUrlForRole = (role: string | undefined) => role && manualPathByRole[role] ? `${API_BASE_URL}${manualPathByRole[role]}` : null;
// Menu: Início solto no topo e, abaixo, seções recolhíveis. Abre só a da tela
// atual; as outras ficam só com o título e o total de pendências. A ordem das rotas
// dentro da seção é a ordem do menu; cada perfil só vê as rotas que `items`
// libera para ele (filtro pelo papel do perfil ativo, mais as funcionalidades).
const sections: Array<{ key: string; label: string; routes: string[] }> = [
  { key: 'panels', label: 'Painéis', routes: ['Dashboard', 'BillingAnalytics', 'UserStats', 'PlatformInvoices'] },
  { key: 'finance', label: 'Financeiro', routes: ['Invoices', 'Debts', 'AgreementHistory', 'Accountability', 'Clearances', 'BillingSettings', 'UnitExtraCharges', 'UnitConsumption'] },
  { key: 'records', label: 'Cadastros', routes: ['Users', 'Units', 'UnitTypes', 'Support'] },
  { key: 'community', label: 'Comunidade', routes: ['Communications', 'Reports', 'Polls', 'SpaceReservations'] },
  { key: 'regulation', label: 'Regimento', routes: ['Regulation', 'Occurrences', 'InfractionNotices', 'InfractionNoticeIssue', 'RegulationArticles'] },
  { key: 'platform', label: 'Plataforma', routes: ['Condominiums', 'PlatformPlans', 'PlatformRevenue', 'PlatformReceipts', 'AuditLog', 'GoogleDriveIntegrationGuide'] },
  { key: 'banks', label: 'Bancos', routes: ['Banks', 'BankConfigurations', 'BankLink', 'BankIntegrationGuide'] },
];
// Busca do "Ir para" ignora acento e caixa: "notificacao" acha "Notificações".
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
  const biometric = useBiometricSetting();
  const biometricLabel = `Desbloqueio por biometria: ${biometric.enabled ? 'ativado' : 'desativado'}`;
  // Atalho permanente para avaliar, além do convite automático de
  // StoreReviewPrompt — quem usa o atalho também não recebe mais o convite.
  const canReview = Platform.OS !== 'web' && isStoreReviewEnabled();
  const rateApp = () => { openStoreReview().then(opened => { if (opened) void markReviewDone(); }).catch(() => {}); };
  // No app nativo, rotas de gestão nem existem no Stack (ver ManagementStack
  // .web/.native.tsx) — tocar num item de menu dessas mostra este aviso em vez
  // de tentar navegar para uma tela que não foi empacotada no binário.
  const goTo = useCallback((route: string) => {
    if (Platform.OS !== 'web' && MANAGEMENT_ROUTES.has(route)) {
      Alert.alert('Disponível na versão web', 'Esta função está disponível apenas na versão web. Abra app.laremdia.com.br no navegador do seu celular ou computador para usá-la.');
      return;
    }
    navigation.navigate(route);
  }, [navigation]);
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
  // condominiumFeatures === null (admin_geral ou ainda carregando) nunca
  // esconde nada por funcionalidade, só o papel filtra nesse caso.
  const visible = items.filter((item) => item.roles.includes(user?.role || '') && (Platform.OS === 'web' || !item.webOnly) && (!item.feature || user?.role === 'admin_geral' || condominiumFeatures?.[item.feature] === true));
  const resident = user?.role === 'proprietario' || user?.role === 'inquilino';
  const labelFor = (item: Item) => (resident && item.residentLabel) || item.label;
  const menuSections = sections
    .map(section => ({ ...section, items: section.routes.map(route => visible.find(item => item.route === route)).filter((item): item is Item => Boolean(item)) }))
    .filter(section => section.items.length > 0);
  const badgeFor = (route: string) => route === 'Communications' ? unreadNotices : route === 'Reports' ? unreadReports : 0;
  const activeSection = sections.find(section => section.routes.includes(activeRoute) || (activeRoute === 'BankIntegration' && section.key === 'banks'))?.key;
  const [openSections, setOpenSections] = useState<string[]>(() => activeSection ? [activeSection] : []);
  useEffect(() => { if (activeSection) setOpenSections(current => current.includes(activeSection) ? current : [...current, activeSection]); }, [activeSection]);
  const toggleSection = (key: string) => setOpenSections(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const displayName = (user?.fullName || '').trim() || user?.username || '';
  const initials = (displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2) || 'U').toUpperCase();
  const activeItem = items.find((item) => item.route === activeRoute);
  const activeLabel = activeItem ? labelFor(activeItem) : activeRoute === 'Sessions' ? 'Dispositivos conectados' : 'Lar em Dia';
  // "Ir para…" (Ctrl+K na web): procura entre as telas do menu deste perfil.
  const searchRef = useRef<any>(null);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchResults = search.trim() ? visible.filter(item => normalize(labelFor(item)).includes(normalize(search.trim()))).slice(0, 8) : [];
  const goToResult = (route: string) => { setSearch(''); searchRef.current?.blur?.(); goTo(route); };
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus?.(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Barra inferior do celular: Início, as três áreas que o morador mais usa
  // (quando ativas no condomínio) e o menu completo.
  const tabs = [
    { route: 'Home', label: 'Início', symbol: '⌂' },
    { route: 'Invoices', label: 'Boletos', symbol: '▤' },
    { route: 'Communications', label: 'Avisos', symbol: '◉' },
    { route: 'SpaceReservations', label: 'Reservas', symbol: '▦' },
  ].filter(tab => visible.some(item => item.route === tab.route));
  useEffect(() => {
    setCondominiumName(user?.condominiumName || '');
    if (!userToken || user?.role === 'admin_geral' || user?.condominiumName) return;
    apiRequest<{user:{condominiumName?:string|null}}>('/auth/me',userToken)
      .then(response=>setCondominiumName(response.user.condominiumName || 'Meu condomínio'))
      .catch(()=>setCondominiumName('Meu condomínio'));
  }, [user?.condominiumName,user?.role,userToken]);

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
                {condominiumName ? <Text style={styles.brandCondominiumName}>{condominiumName}</Text> : null}
              </View>
            </View>

            <ScrollView>
              <Pressable
                accessibilityRole="link"
                style={({ hovered }: any) => [styles.navItem, styles.navTopItem, hovered && activeRoute !== 'Home' && styles.navItemHover, activeRoute === 'Home' && styles.navItemActive]}
                onPress={() => goTo('Home')}
              >
                <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.navTopIcon} resizeMode="contain" accessibilityIgnoresInvertColors />
                <Text style={[styles.navTopText, activeRoute === 'Home' && styles.navActive]}>Início</Text>
              </Pressable>
              {menuSections.map((section) => (
                <View key={section.key} style={styles.navSection}>
                  {(() => {
                    const open = openSections.includes(section.key);
                    const sectionBadge = section.items.reduce((sum, item) => sum + badgeFor(item.route), 0);
                    return (
                      <>
                        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggleSection(section.key)} style={({ hovered }: any) => [styles.navHeader, hovered && styles.navItemHover]}>
                          <Text style={[styles.navLabel, styles.grow]}>{section.label.toUpperCase()}</Text>
                          {!open && sectionBadge > 0 ? <Text style={styles.countBadge}>{sectionBadge}</Text> : null}
                          <Text style={styles.navChevron}>{open ? '⌃' : '⌄'}</Text>
                        </Pressable>
                        {open ? (
                          <View style={styles.navList}>
                            {section.items.map((item) => {
                              const active = activeRoute === item.route || (item.route === 'BankConfigurations' && activeRoute === 'BankIntegration');
                              const badge = badgeFor(item.route);
                              return (
                                <Pressable
                                  key={item.route}
                                  accessibilityRole="link"
                                  style={({ hovered }: any) => [styles.navItem, hovered && !active && styles.navItemHover, active && styles.navItemActive]}
                                  onPress={() => goTo(item.route)}
                                >
                                  <Text numberOfLines={1} style={[styles.navText, active && styles.navActive]}>{labelFor(item)}</Text>
                                  {badge > 0 ? <Text style={styles.countBadge}>{badge}</Text> : null}
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : null}
                      </>
                    );
                  })()}
                </View>
              ))}
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
                  <Text numberOfLines={1} style={styles.profileName}>{displayName}</Text>
                  {profiles.length > 1 ? (
                    <Pressable onPress={() => setProfileMenuOpen(current => !current)}>
                      <Text style={styles.profileRole}>{roleLabels[user?.role || '']} ▾</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.profileRole}>{roleLabels[user?.role || '']}</Text>
                  )}
                </View>
                {manualUrl ? <Pressable onPress={openManual} accessibilityLabel="Manual do usuário" style={[styles.profileTourButton, styles.profileManualButton]}><Text style={styles.profileTourIcon}>📘</Text></Pressable> : null}
                {biometric.available ? <Pressable onPress={() => void biometric.toggle()} accessibilityLabel={biometricLabel} style={[styles.profileTourButton, !biometric.enabled && styles.profileBiometricOff]}><Text style={styles.profileTourIcon}>{biometric.enabled ? '🔒' : '🔓'}</Text></Pressable> : null}
                <Pressable onPress={() => goTo('Sessions')} accessibilityLabel="Dispositivos conectados" style={styles.profileTourButton}><Text style={styles.profileTourIcon}>🛡</Text></Pressable>
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
                  <Text numberOfLines={1} style={styles.breadcrumbStrong}>{activeLabel}</Text>
                  <View style={styles.searchWrap}>
                    <View style={[styles.searchBox, searchFocused && styles.searchBoxFocused]}>
                      <Text style={styles.searchIcon}>⌕</Text>
                      <TextInput
                        ref={searchRef}
                        value={search}
                        onChangeText={setSearch}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                        onSubmitEditing={() => { if (searchResults[0]) goToResult(searchResults[0].route); }}
                        placeholder="Ir para uma tela…"
                        placeholderTextColor={colors.placeholder}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                        accessibilityLabel="Ir para uma tela"
                        style={styles.searchInput}
                      />
                      {Platform.OS === 'web' ? <Text style={styles.searchKey}>Ctrl K</Text> : null}
                    </View>
                    {searchFocused && searchResults.length > 0 ? (
                      <View style={styles.searchResults}>
                        {searchResults.map(item => (
                          <Pressable key={item.route} onPress={() => goToResult(item.route)} style={({ hovered }: any) => [styles.searchResult, hovered && styles.navItemHover]}>
                            <Text style={styles.searchResultText}>{labelFor(item)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.topActions}>
                    <Pressable onPress={startSystemTour} accessibilityRole="button" accessibilityLabel="Tour guiado do sistema" style={styles.topHelp}><Text style={styles.topHelpText}>?</Text></Pressable>
                    <View style={styles.topUser}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials}</Text>
                        <View accessibilityLabel="Online" style={styles.onlineDot} />
                      </View>
                      {isWide ? (
                        <View>
                          <Text numberOfLines={1} style={styles.topUserName}>{displayName}</Text>
                          <Text style={styles.topUserRole}>{roleLabels[user?.role || '']}</Text>
                        </View>
                      ) : null}
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
            {children}
          </ScrollView>

          <View style={[styles.mobileNav, { height: styles.mobileNav.height + insets.bottom, paddingBottom: insets.bottom }]}>
            {tabs.map(tab => {
              const active = activeRoute === tab.route;
              const badge = badgeFor(tab.route);
              return (
                <Pressable key={tab.route} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.mobileNavItem} onPress={() => goTo(tab.route)}>
                  <Text style={[styles.mobileNavIcon, active && styles.mobileNavActive]}>{tab.symbol}</Text>
                  <Text numberOfLines={1} style={[styles.mobileNavText, active && styles.mobileNavActive]}>{tab.label}</Text>
                  {badge > 0 ? <Text style={styles.mobileNavBadge}>{badge}</Text> : null}
                </Pressable>
              );
            })}
            <Pressable accessibilityRole="button" style={styles.mobileNavItem} onPress={() => setMobileMenuOpen(true)}>
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
                  <Pressable style={[styles.mobileMenuSectionHeader, activeRoute === 'Home' && styles.navItemActive]} onPress={() => { goTo('Home'); setMobileMenuOpen(false); }}>
                    <Image source={require('../../assets/lar-em-dia-icon.png')} style={styles.navTopIcon} resizeMode="contain" accessibilityIgnoresInvertColors />
                    <Text style={[styles.navTopText, activeRoute === 'Home' && styles.navActive]}>Início</Text>
                  </Pressable>
                  {menuSections.map(section => (
                    <View key={section.key} style={styles.mobileMenuSection}>
                      <Pressable accessibilityRole="button" accessibilityState={{ expanded: openSections.includes(section.key) }} onPress={() => toggleSection(section.key)} style={styles.mobileMenuSectionHeader}>
                        <Text style={[styles.mobileMenuSectionLabel, styles.grow]}>{section.label.toUpperCase()}</Text>
                        {!openSections.includes(section.key) && section.items.some(item => badgeFor(item.route) > 0) ? <Text style={styles.countBadge}>{section.items.reduce((sum, item) => sum + badgeFor(item.route), 0)}</Text> : null}
                        <Text style={styles.navChevron}>{openSections.includes(section.key) ? '⌃' : '⌄'}</Text>
                      </Pressable>
                      {openSections.includes(section.key) && section.items.map(item => {
                        const active = activeRoute === item.route;
                        const badge = badgeFor(item.route);
                        return (
                          <Pressable
                            key={item.route}
                            style={[styles.mobileMenuItem, active && styles.navItemActive]}
                            onPress={() => { goTo(item.route); setMobileMenuOpen(false); }}
                          >
                            <Text style={[styles.mobileMenuItemText, styles.grow, active && styles.navActive]}>{labelFor(item)}</Text>
                            {badge > 0 ? <Text style={styles.countBadge}>{badge}</Text> : null}
                          </Pressable>
                        );
                      })}
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
                {canReview ? <Pressable style={styles.mobileTourFooter} onPress={() => { setMobileMenuOpen(false); rateApp(); }}><Text style={styles.mobileTourText}>⭐ Avaliar o app na {reviewStoreName}</Text></Pressable> : null}
                {biometric.available ? <Pressable style={styles.mobileTourFooter} onPress={() => void biometric.toggle()}><Text style={styles.mobileTourText}>{biometric.enabled ? '🔒' : '🔓'} {biometricLabel}</Text></Pressable> : null}
                <Pressable style={styles.mobileTourFooter} onPress={() => { setMobileMenuOpen(false); goTo('Sessions'); }}><Text style={styles.mobileTourText}>🛡 Dispositivos conectados</Text></Pressable>
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
  navLabel: { marginHorizontal: 10, color: '#3f4a5e', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 }, navList: { gap: 1, marginLeft: 14, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#dfe5ee', marginBottom: 4 }, navSection: { marginTop: 10 }, navItem: { minHeight: 38, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 }, navItemHover: { backgroundColor: '#f3f6fb' }, navItemActive: { backgroundColor: '#eaf1fb' }, navSymbol: { width: 32, textAlign: 'center', color: '#536474', fontSize: 26, fontWeight: '800' }, navText: { flex: 1, color: '#33405a', fontSize: 14, fontWeight: '600' }, navActive: { color: colors.primaryDark, fontWeight: '900' },
  countBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, overflow: 'hidden', textAlign: 'center', lineHeight: 20, color: '#fff', backgroundColor: colors.primary, fontSize: 12, fontWeight: '900' },
  navChevron: { color: '#8b98a5', fontSize: 14, fontWeight: '900' },
  unreadBadge: { marginLeft: 'auto', minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', textAlign: 'center', lineHeight: 22, color: '#fff', backgroundColor: colors.red, fontSize: 13, fontWeight: '900' },
  subnav: { marginLeft: 23, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: '#dce4ed', gap: 2, marginBottom: 3 },
  subnavItem: { minHeight: 36, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  subnavItemActive: { backgroundColor: '#f1f5fb' },
  subnavDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a8b2bd' },
  subnavDotActive: { backgroundColor: colors.primary },
  subnavText: { color: '#6e7b88', fontSize: 14, fontWeight: '700' },
  profileAnchor: { marginTop: 'auto' },
  profile: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatarLight: { width: 33, height: 33, borderRadius: 17, backgroundColor: '#dfe9f6', alignItems: 'center', justifyContent: 'center' }, avatarLightText: { color: colors.primary, fontSize: 14, fontWeight: '800' }, profileName: { color: colors.ink, fontSize: 14, fontWeight: '800' }, profileRole: { color: '#8190a0', fontSize: 12, marginTop: 2 },profileTourButton:{width:34,height:34,borderRadius:17,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center',shadowColor:colors.primary,shadowOpacity:.22,shadowRadius:6,elevation:2},profileManualButton:{backgroundColor:colors.teal,shadowColor:colors.teal},profileBiometricOff:{backgroundColor:colors.muted,shadowColor:colors.muted},profileTourIcon:{color:'#fff',fontSize:17,fontWeight:'900'}, exit: { color: colors.red, fontSize: 13, fontWeight: '800' },
  profileSwitcher: { paddingHorizontal: 8, paddingVertical: 8, marginBottom: 8, gap: 4, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  mobileProfileSwitcher: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: '#f9f9fa', gap: 4 },
  profileSwitcherTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', marginBottom: 2 },
  profileSwitcherItem: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: 'transparent' },
  profileSwitcherItemActive: { backgroundColor: colors.softBlue },
  profileSwitcherItemText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  topbar: { height: 72, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 5 },
  topbarInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 20 },
  searchWrap: { flex: 1, maxWidth: 460, position: 'relative' },
  searchBox: { height: 42, borderWidth: 1, borderColor: '#d5dbe6', borderRadius: 12, backgroundColor: '#f8fafd', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  searchBoxFocused: { borderColor: colors.primary, backgroundColor: '#fff' },
  searchIcon: { color: '#5b6577', fontSize: 18 },
  searchInput: { flex: 1, height: 40, fontSize: 15, color: colors.ink, outlineStyle: 'none' } as any,
  searchKey: { color: '#5b6577', fontSize: 12, fontWeight: '800', borderWidth: 1, borderColor: '#d5dbe6', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#fff' },
  searchResults: { position: 'absolute', top: 46, left: 0, right: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 6, shadowColor: '#14243a', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  searchResult: { paddingHorizontal: 14, paddingVertical: 10 },
  searchResultText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  topHelp: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  topHelpText: { color: colors.primaryDark, fontSize: 16, fontWeight: '900' },
  topUser: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  onlineDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: '#12a389', borderWidth: 2, borderColor: '#fff' },
  topUserName: { color: colors.ink, fontSize: 14, fontWeight: '800', maxWidth: 180 },
  topUserRole: { color: '#5b6577', fontSize: 12 },
  breadcrumb: { color: '#8794a2', fontSize: 16 }, breadcrumbStrong: { color: '#34475c', fontWeight: '800', fontSize: 18, flexShrink: 1, minWidth: 140 }, topActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 14 }, online: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#dce8e5', backgroundColor: '#f6fbf9', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2bb596', marginRight: 6 }, onlineText: { color: '#497067', fontSize: 15, fontWeight: '600' }, avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  topTourButton:{minHeight:40,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,borderRadius:20,backgroundColor:colors.primary,shadowColor:colors.primary,shadowOpacity:.18,shadowRadius:8,elevation:2},topTourIcon:{width:22,height:22,borderRadius:11,overflow:'hidden',backgroundColor:'rgba(255,255,255,.18)',color:'#fff',textAlign:'center',lineHeight:22,fontWeight:'900'},topTourText:{color:'#fff',fontSize:14,fontWeight:'900'},
  body: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: colors.background }, bodyContainer: { width: '100%', paddingHorizontal: 24 }, bodyMobile: { paddingBottom: 70 }, mobileContentContainer: { flexGrow: 1, alignItems: 'stretch', padding: 16, paddingBottom: 90, backgroundColor: colors.background }, attentionBanner: { marginHorizontal: 14, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#fff4db', borderWidth: 1, borderColor: '#f1d28b', flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, attentionTitle: { color: '#7a4a00', fontSize: 15, fontWeight: '900' }, attentionText: { color: '#8d6517', fontSize: 13, marginTop: 3 }, attentionAction: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6bf68', alignItems: 'center', justifyContent: 'center' }, attentionActionText: { color: '#7a4a00', fontSize: 13, fontWeight: '900' },
  noticeTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, backgroundColor: colors.background }, noticeTab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff', paddingHorizontal: 8 }, noticeTabActive: { backgroundColor: colors.primary, borderColor: colors.primary }, noticeTabText: { color: colors.ink, fontSize: 15, fontWeight: '800', textAlign: 'center' }, noticeTabTextActive: { color: '#fff', fontWeight: '900' },
  mobileNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', justifyContent: 'center', gap: 0, zIndex: 10 },
  mobileNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6, position: 'relative' },
  mobileNavIcon: { fontSize: 22, fontWeight: '800', color: '#5b6577' },
  mobileNavText: { fontSize: 11, fontWeight: '700', color: '#5b6577', textAlign: 'center' },
  mobileNavActive: { color: colors.primary, fontWeight: '900' },
  mobileNavBadge: { position: 'absolute', top: 4, left: '55%', minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, overflow: 'hidden', textAlign: 'center', lineHeight: 17, color: '#fff', backgroundColor: colors.red, fontSize: 10, fontWeight: '900' },
  mobileMenuSection: { paddingTop: 10, paddingBottom: 4 },
  mobileMenuSectionLabel: { color: '#3f4a5e', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  navTopItem: { marginBottom: 6 },
  navTopText: { color: '#3f4a5e', fontSize: 14, fontWeight: '900' },
  navTopIcon: { width: 20, height: 20 },
  mobileMenuSectionHeader: { minHeight: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  navHeader: { minHeight: 32, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8, marginBottom: 2 },
  mobileMenuItem: { marginLeft: 26, marginRight: 8, paddingHorizontal: 10, borderLeftWidth: 1, borderLeftColor: '#dfe5ee', borderRadius: 0, borderTopRightRadius: 9, borderBottomRightRadius: 9, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
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
});
