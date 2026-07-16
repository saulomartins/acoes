import React, { useContext, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { colors, layout } from './theme';
import { apiRequest } from '../api/client';
import { syncNotificationBadge } from '../services/pushNotifications';

type Item = { label: string; route: string; symbol: string; roles: string[] };

const items: Item[] = [
  { label: 'Relatos e solicitações', route: 'Reports', symbol: '!', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Avisos e comunicação', route: 'Communications', symbol: '●', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Início', route: 'Home', symbol: '⌂', roles: ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Condomínios', route: 'Condominiums', symbol: '▦', roles: ['admin_geral'] },
  { label: 'Pessoas', route: 'Users', symbol: '♙', roles: ['admin_geral', 'sindico', 'subsindico'] },
  { label: 'Cadastro de bancos', route: 'Banks', symbol: '▣', roles: ['admin_geral'] },
  { label: 'Configurações bancárias', route: 'BankConfigurations', symbol: '⚙', roles: ['admin_geral'] },
  { label: 'Vincular banco ao condomínio', route: 'BankLink', symbol: '↔', roles: ['admin_geral'] },
  { label: 'Tipologias', route: 'UnitTypes', symbol: '▧', roles: ['sindico', 'subsindico'] },
  { label: 'Blocos e unidades', route: 'Units', symbol: '▦', roles: ['sindico', 'subsindico'] },
  { label: 'Prestação de contas', route: 'Accountability', symbol: '$', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Gestão de cobranças', route: 'Invoices', symbol: '▤', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Gestão de débitos', route: 'Debts', symbol: '≋', roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { label: 'Config. cobranças', route: 'BillingSettings', symbol: '⚙', roles: ['sindico', 'subsindico'] },
];

const roleLabels: Record<string, string> = { admin_geral: 'Administrador geral', sindico: 'Síndico', subsindico: 'Subsíndico', proprietario: 'Proprietário', inquilino: 'Inquilino' };
const billingRoutes = ['Invoices', 'Debts', 'BillingSettings'];
const noticeRoutes = ['Communications', 'Reports'];
const bankRoutes = ['Banks', 'BankConfigurations', 'BankLink', 'BankIntegration'];

export default function ResponsiveShell({ activeRoute, navigation, children }: { activeRoute: string; navigation: any; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const { user, userToken, signOut } = useContext(AuthContext);
  const [condominiumName, setCondominiumName] = useState(user?.condominiumName || '');
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [unreadReports, setUnreadReports] = useState(0);
  const visible = items.filter((item) => item.roles.includes(user?.role || ''));
  const mainItems = visible.filter((item) => !billingRoutes.includes(item.route) && !noticeRoutes.includes(item.route) && !bankRoutes.includes(item.route));
  const bankItems = visible.filter((item) => bankRoutes.includes(item.route));
  const billingItems = visible.filter((item) => billingRoutes.includes(item.route));
  const noticeItems = visible.filter((item) => noticeRoutes.includes(item.route)).sort((a, b) => noticeRoutes.indexOf(a.route) - noticeRoutes.indexOf(b.route));
  const billingActive = billingRoutes.includes(activeRoute);
  const noticeActive = noticeRoutes.includes(activeRoute);
  const bankActive = bankRoutes.includes(activeRoute);
  const [billingOpen, setBillingOpen] = useState(billingActive);
  const [noticeOpen, setNoticeOpen] = useState(noticeActive);
  const [bankOpen, setBankOpen] = useState(bankActive);
  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();
  const activeLabel = items.find((item) => item.route === activeRoute)?.label || 'Lar em Dia';
  const preferredMobileRoutes = ['Home', 'Communications', 'Reports', 'Invoices', 'Accountability'];
  const mobileBaseItems = preferredMobileRoutes
    .map((route) => visible.find((item) => item.route === route))
    .filter(Boolean) as Item[];
  const activeMobileItem = visible.find((item) => item.route === activeRoute && !mobileBaseItems.some((base) => base.route === item.route));
  const mobileItems = (activeMobileItem ? [...mobileBaseItems.slice(0, 4), activeMobileItem] : mobileBaseItems).slice(0, 5);
  const totalAttention = unreadNotices + unreadReports;

  useEffect(() => {
    setBillingOpen(billingActive);
  }, [billingActive]);
  useEffect(() => {
    setNoticeOpen(noticeActive);
  }, [noticeActive]);
  useEffect(() => { setBankOpen(bankActive); }, [bankActive]);

  useEffect(() => {
    setCondominiumName(user?.condominiumName || '');
    if (!userToken || user?.role === 'admin_geral' || user?.condominiumName) return;
    apiRequest<{user:{condominiumName?:string|null}}>('/auth/me',userToken)
      .then(response=>setCondominiumName(response.user.condominiumName || 'Meu condomínio'))
      .catch(()=>setCondominiumName('Meu condomínio'));
  }, [user?.condominiumName,user?.role,userToken]);

  useEffect(() => {
    if (!userToken || user?.role === 'admin_geral') return;
    const update = async () => {
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
    };
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, [activeRoute, user?.role, userToken]);

  useEffect(() => {
    syncNotificationBadge(unreadNotices + unreadReports);
  }, [unreadNotices, unreadReports]);

  return (
    <View style={styles.shell}>
      {desktop ? (
        <View style={styles.sidebar}>
          <View style={styles.brand}><Image source={require('../../assets/lar-em-dia-logo.png')} style={styles.brandLogo} resizeMode="contain" /><View><Text style={styles.brandName}>Lar em Dia</Text><Text style={styles.brandCaption}>Gestão condominial</Text></View></View>
          <View style={styles.context}><View style={styles.contextIcon}><Text style={styles.contextIconText}>▦</Text></View><View style={styles.grow}><Text style={styles.contextLabel}>{user?.role === 'admin_geral' ? 'AMBIENTE ATUAL' : 'CONDOMÍNIO ATUAL'}</Text><Text numberOfLines={2} style={styles.contextName}>{user?.role === 'admin_geral' ? 'Administração geral' : condominiumName || 'Carregando condomínio...'}</Text></View></View>
          <Text style={styles.navLabel}>GESTÃO</Text>
          <View style={styles.navList}>
            {mainItems.map((item) => <Pressable key={item.route} onPress={() => navigation.navigate(item.route)} style={[styles.navItem, activeRoute === item.route && styles.navItemActive]}><Text style={[styles.navSymbol, activeRoute === item.route && styles.navActive]}>{item.symbol}</Text><Text style={[styles.navText, activeRoute === item.route && styles.navActive]}>{item.label}</Text>{item.route === 'Communications' && unreadNotices > 0 ? <Text style={styles.unreadBadge}>{unreadNotices > 99 ? '99+' : unreadNotices}</Text> : null}</Pressable>)}
            {bankItems.length ? <><Pressable onPress={()=>setBankOpen(open=>!open)} style={[styles.navItem,bankActive&&styles.navItemActive]}><Text style={[styles.navSymbol,bankActive&&styles.navActive]}>↔</Text><Text style={[styles.navText,styles.grow,bankActive&&styles.navActive]}>Bancos</Text><Text style={[styles.navChevron,bankActive&&styles.navActive]}>{bankOpen?'⌃':'⌄'}</Text></Pressable>{bankOpen?<View style={styles.subnav}>{bankItems.map(item=><Pressable key={item.route} onPress={()=>navigation.navigate(item.route)} style={[styles.subnavItem,activeRoute===item.route&&styles.subnavItemActive]}><View style={[styles.subnavDot,activeRoute===item.route&&styles.subnavDotActive]}/><Text style={[styles.subnavText,activeRoute===item.route&&styles.navActive]}>{item.label}</Text></Pressable>)}</View>:null}</>:null}
            {billingItems.length ? <>
              <Pressable onPress={() => setBillingOpen((open) => !open)} style={[styles.navItem, billingActive && styles.navItemActive]}>
                <Text style={[styles.navSymbol, billingActive && styles.navActive]}>▤</Text>
                <Text style={[styles.navText, styles.grow, billingActive && styles.navActive]}>Boletos</Text>
                <Text style={[styles.navChevron, billingActive && styles.navActive]}>{billingOpen ? '⌃' : '⌄'}</Text>
              </Pressable>
              {billingOpen ? <View style={styles.subnav}>{billingItems.map((item) => (
                <Pressable key={item.route} onPress={() => navigation.navigate(item.route)} style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}>
                  <View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} />
                  <Text style={[styles.subnavText, activeRoute === item.route && styles.navActive]}>{item.label}</Text>
                </Pressable>
              ))}</View> : null}
            </> : null}
            {noticeItems.length ? <>
              <Pressable onPress={() => setNoticeOpen((open) => !open)} style={[styles.navItem, noticeActive && styles.navItemActive]}><Text style={[styles.navSymbol, noticeActive && styles.navActive]}>●</Text><Text style={[styles.navText, styles.grow, noticeActive && styles.navActive]}>Avisos</Text>{unreadNotices > 0 ? <Text style={styles.unreadBadge}>{unreadNotices > 99 ? '99+' : unreadNotices}</Text> : null}<Text style={[styles.navChevron, noticeActive && styles.navActive]}>{noticeOpen ? '⌃' : '⌄'}</Text></Pressable>
              {noticeOpen ? <View style={styles.subnav}>{noticeItems.map((item) => <Pressable key={item.route} onPress={() => navigation.navigate(item.route)} style={[styles.subnavItem, activeRoute === item.route && styles.subnavItemActive]}><View style={[styles.subnavDot, activeRoute === item.route && styles.subnavDotActive]} /><Text style={[styles.subnavText, activeRoute === item.route && styles.navActive]}>{item.route === 'Communications' ? 'Comunicação' : item.label}</Text></Pressable>)}</View> : null}
            </> : null}
          </View>
          <View style={styles.profile}><View style={styles.avatarLight}><Text style={styles.avatarLightText}>{initials}</Text></View><View style={styles.grow}><Text style={styles.profileName}>{user?.username}</Text><Text style={styles.profileRole}>{roleLabels[user?.role || '']}</Text></View><Pressable onPress={() => signOut()}><Text style={styles.exit}>Sair</Text></Pressable></View>
        </View>
      ) : null}

      <View style={[styles.main, desktop && styles.mainDesktop]}>
        <View style={styles.topbar}>
          {desktop ? <Text style={styles.breadcrumb}>Painel  /  <Text style={styles.breadcrumbStrong}>{activeLabel}</Text></Text> : <View style={styles.brand}><Image source={require('../../assets/lar-em-dia-logo.png')} style={styles.mobileBrandLogo} resizeMode="contain" /><Text style={styles.mobileTitle}>{activeLabel}</Text></View>}
          <View style={styles.topActions}><View style={styles.online}><View style={styles.dot}/><Text style={styles.onlineText}>Tudo certo</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View></View>
        </View>
        <View style={[styles.body, !desktop && styles.bodyMobile]}>{!desktop && bankActive ? <View style={styles.noticeTabs}>{bankItems.map(item=><Pressable key={item.route} onPress={()=>navigation.navigate(item.route)} style={[styles.noticeTab,activeRoute===item.route&&styles.noticeTabActive]}><Text style={[styles.noticeTabText,activeRoute===item.route&&styles.noticeTabTextActive]}>{item.route==='BankLink'?'Vincular':item.route==='BankConfigurations'?'Configurações':'Bancos'}</Text></Pressable>)}</View>:null}{!desktop && noticeActive ? <View style={styles.noticeTabs}><Pressable onPress={() => navigation.navigate('Communications')} style={[styles.noticeTab, activeRoute === 'Communications' && styles.noticeTabActive]}><Text style={[styles.noticeTabText, activeRoute === 'Communications' && styles.noticeTabTextActive]}>Comunicação</Text></Pressable><Pressable onPress={() => navigation.navigate('Reports')} style={[styles.noticeTab, activeRoute === 'Reports' && styles.noticeTabActive]}><Text style={[styles.noticeTabText, activeRoute === 'Reports' && styles.noticeTabTextActive]}>Relatos e solicitações</Text></Pressable></View> : null}{totalAttention > 0 ? <View style={styles.attentionBanner}><View style={styles.grow}><Text style={styles.attentionTitle}>Você tem atualizações pendentes</Text><Text style={styles.attentionText}>{unreadNotices > 0 ? `${unreadNotices} aviso${unreadNotices === 1 ? '' : 's'} não lido${unreadNotices === 1 ? '' : 's'}` : null}{unreadNotices > 0 && unreadReports > 0 ? ' · ' : ''}{unreadReports > 0 ? `${unreadReports} resposta${unreadReports === 1 ? '' : 's'} ou relato${unreadReports === 1 ? '' : 's'} com novidades` : null}</Text></View>{unreadNotices > 0 ? <Pressable onPress={() => navigation.navigate('Communications')} style={styles.attentionAction}><Text style={styles.attentionActionText}>Avisos</Text></Pressable> : null}{unreadReports > 0 ? <Pressable onPress={() => navigation.navigate('Reports')} style={styles.attentionAction}><Text style={styles.attentionActionText}>Relatos</Text></Pressable> : null}</View> : null}{children}</View>
        {!desktop ? <View style={styles.mobileNavShell}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileNav}>{mobileItems.map((item) => {const active=item.route==='Communications'?noticeActive:activeRoute===item.route;const badge=item.route==='Communications'?unreadNotices:item.route==='Reports'?unreadReports:0;return <Pressable key={item.route} onPress={() => navigation.navigate(item.route)} style={[styles.mobileItem, active && styles.mobileItemActive]}><View style={styles.mobileIconWrap}><Text style={[styles.mobileIcon, active && styles.mobileActive]}>{item.symbol}</Text>{badge > 0 ? <Text style={styles.mobileBadge}>{badge > 99 ? '99+' : badge}</Text> : null}</View><Text numberOfLines={2} style={[styles.mobileText, active && styles.mobileActive]}>{item.label}</Text></Pressable>})}</ScrollView></View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background }, grow: { flex: 1 }, main: { flex: 1 }, mainDesktop: { marginLeft: layout.sidebarWidth },
  sidebar: { position: 'absolute', zIndex: 5, left: 0, top: 0, bottom: 0, width: layout.sidebarWidth, backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: 18, paddingTop: 27, paddingBottom: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 }, brandLogo: { width: 42, height: 42 }, mobileBrandLogo: { width: 32, height: 32 }, brandName: { color: colors.navy, fontSize: 18, fontWeight: '900', letterSpacing: .2 }, brandCaption: { color: '#8190a0', fontSize: 14, marginTop: 2 }, mobileTitle: { color: colors.navy, fontSize: 17, fontWeight: '900' },
  context: { marginTop: 28, marginBottom: 22, padding: 12, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f6f8fa', borderWidth: 1, borderColor: '#e9edf1', borderRadius: 12 }, contextIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' }, contextIconText: { color: colors.primary, fontSize: 19 }, contextLabel: { color: '#8794a2', fontSize: 12 }, contextName: { color: colors.ink, fontSize: 14, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  navLabel: { marginHorizontal: 12, marginBottom: 9, color: '#7e8b98', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 }, navList: { gap: 4 }, navItem: { minHeight: 54, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14 }, navItemActive: { backgroundColor: '#eaf1fb' }, navSymbol: { width: 32, textAlign: 'center', color: '#536474', fontSize: 26, fontWeight: '800' }, navText: { color: '#536474', fontSize: 16, fontWeight: '700' }, navActive: { color: colors.primaryDark, fontWeight: '900' },
  navChevron: { color: '#8b98a5', fontSize: 17, fontWeight: '900' },
  unreadBadge: { marginLeft: 'auto', minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', textAlign: 'center', lineHeight: 22, color: '#fff', backgroundColor: colors.red, fontSize: 13, fontWeight: '900' },
  subnav: { marginLeft: 23, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: '#dce4ed', gap: 2, marginBottom: 3 },
  subnavItem: { minHeight: 36, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  subnavItemActive: { backgroundColor: '#f1f5fb' },
  subnavDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a8b2bd' },
  subnavDotActive: { backgroundColor: colors.primary },
  subnavText: { color: '#6e7b88', fontSize: 14, fontWeight: '700' },
  profile: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatarLight: { width: 33, height: 33, borderRadius: 17, backgroundColor: '#dfe9f6', alignItems: 'center', justifyContent: 'center' }, avatarLightText: { color: colors.primary, fontSize: 14, fontWeight: '800' }, profileName: { color: colors.ink, fontSize: 14, fontWeight: '800' }, profileRole: { color: '#8190a0', fontSize: 12, marginTop: 2 }, exit: { color: colors.red, fontSize: 13, fontWeight: '800' },
  topbar: { height: 68, paddingHorizontal: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.border }, breadcrumb: { color: '#8794a2', fontSize: 14 }, breadcrumbStrong: { color: '#34475c', fontWeight: '800' }, topActions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 13 }, online: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#dce8e5', backgroundColor: '#f6fbf9', borderRadius: 15, paddingHorizontal: 9, paddingVertical: 6 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2bb596', marginRight: 5 }, onlineText: { color: '#497067', fontSize: 13 }, avatar: { width: 33, height: 33, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  body: { flex: 1 }, bodyMobile: { paddingBottom: 114 }, attentionBanner: { marginHorizontal: 14, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#fff4db', borderWidth: 1, borderColor: '#f1d28b', flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, attentionTitle: { color: '#7a4a00', fontSize: 15, fontWeight: '900' }, attentionText: { color: '#8d6517', fontSize: 13, marginTop: 3 }, attentionAction: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6bf68', alignItems: 'center', justifyContent: 'center' }, attentionActionText: { color: '#7a4a00', fontSize: 13, fontWeight: '900' }, mobileNavShell: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingBottom: 8, paddingTop: 6, backgroundColor: 'transparent' }, mobileNav: { gap: 10, paddingHorizontal: 2 }, mobileItem: { minWidth: 92, maxWidth: 110, minHeight: 82, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border }, mobileItemActive: { backgroundColor: '#eaf1fb', borderColor: '#b9d0ef' }, mobileIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 30 }, mobileIcon: { color: '#657585', fontSize: 25, fontWeight: '800' }, mobileBadge: { position: 'absolute', top: -6, right: -10, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, overflow: 'hidden', textAlign: 'center', lineHeight: 22, color: '#fff', backgroundColor: colors.red, fontSize: 12, fontWeight: '900' }, mobileText: { color: '#657585', fontSize: 13, fontWeight: '800', textAlign: 'center' }, mobileActive: { color: colors.primary, fontWeight: '900' },
  noticeTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 12, backgroundColor: colors.background }, noticeTab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#fff', paddingHorizontal: 8 }, noticeTabActive: { backgroundColor: colors.primary, borderColor: colors.primary }, noticeTabText: { color: colors.ink, fontSize: 15, fontWeight: '800', textAlign: 'center' }, noticeTabTextActive: { color: '#fff', fontWeight: '900' },
});
