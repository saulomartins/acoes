import React, { useContext, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { colors, layout, shadow } from '../ui/theme';
import { apiRequest } from '../api/client';

type Module = {
  title: string;
  shortTitle: string;
  description: string;
  route?: string;
  symbol: string;
  accent: string;
  roles: string[];
};

const modules: Module[] = [
  { title: 'Condomínios', shortTitle: 'Condomínios', description: 'Dados cadastrais e configuração dos condomínios.', route: 'Condominiums', symbol: '▦', accent: colors.lilac, roles: ['admin_geral'] },
  { title: 'Pessoas', shortTitle: 'Pessoas', description: 'Síndicos, subsíndicos, proprietários e inquilinos.', route: 'Users', symbol: '♙', accent: colors.sky, roles: ['admin_geral', 'sindico', 'subsindico'] },
  { title: 'Gestão de bancos', shortTitle: 'Bancos', description: 'Conexões bancárias e vínculos com condomínios.', route: 'BankConfigurations', symbol: '↔', accent: '#ff7a24', roles: ['admin_geral'] },
  { title: 'Tipologias', shortTitle: 'Tipologias', description: 'Tipos de apartamento e valores mensais de cobrança.', route: 'UnitTypes', symbol: '▧', accent: colors.amber, roles: ['sindico', 'subsindico'] },
  { title: 'Blocos e unidades', shortTitle: 'Unidades', description: 'Apartamentos, moradores atuais e representantes.', route: 'Units', symbol: '▦', accent: colors.teal, roles: ['sindico', 'subsindico'] },
  { title: 'Prestação de contas', shortTitle: 'Prestação', description: 'Receitas, despesas e saldo mensal do condomínio.', route: 'Accountability', symbol: '$', accent: colors.green, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { title: 'Relatos e solicitações', shortTitle: 'Relatos', description: 'Canal privado para reclamações, incômodos e solicitações.', route: 'Reports', symbol: '!', accent: colors.amber, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { title: 'Boletos', shortTitle: 'Boletos', description: 'Cobranças, vencimentos e acompanhamento de pagamentos.', route: 'Invoices', symbol: '▤', accent: colors.green, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
  { title: 'Comunicados', shortTitle: 'Avisos', description: 'Notificações para moradores e administração.', symbol: '◉', accent: colors.teal, roles: ['sindico', 'subsindico', 'proprietario', 'inquilino'] },
];

const communicationsModule = modules.find((item) => item.title === 'Comunicados');
if (communicationsModule) communicationsModule.route = 'Communications';

const roleLabels: Record<string, string> = {
  admin_geral: 'Administrador geral',
  sindico: 'Síndico',
  subsindico: 'Subsíndico',
  proprietario: 'Proprietário',
  inquilino: 'Inquilino',
};

export default function Home({ navigation }: any) {
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const { signOut, user, userToken } = useContext(AuthContext);
  const [condominiumName, setCondominiumName] = useState(user?.condominiumName || '');
  const [noticesOpen, setNoticesOpen] = useState(true);
  const visibleModules = modules.filter((item) => item.roles.includes(user?.role || ''));
  const noticeModules = visibleModules.filter((item) => item.route === 'Communications' || item.route === 'Reports').sort((a, b) => (a.route === 'Communications' ? 0 : 1) - (b.route === 'Communications' ? 0 : 1));
  const mainMenuModules = visibleModules.filter((item) => item.route !== 'Communications' && item.route !== 'Reports');
  const mobileModules = [{ title: 'Avisos', shortTitle: 'Avisos', description: '', route: 'Communications', symbol: '●', accent: colors.teal, roles: [] }, ...mainMenuModules.filter((item) => item.route)];
  const initials = (user?.username || 'U').slice(0, 2).toUpperCase();
  const admin = user?.role === 'admin_geral';
  const manager = user?.role === 'sindico' || user?.role === 'subsindico';

  useEffect(() => {
    setCondominiumName(user?.condominiumName || '');
    if (!userToken || admin || user?.condominiumName) return;
    apiRequest<{user:{condominiumName?:string|null}}>('/auth/me',userToken)
      .then(response=>setCondominiumName(response.user.condominiumName || ''))
      .catch(()=>setCondominiumName(''));
  }, [admin,user?.condominiumName,userToken]);

  const open = (route?: string) => route && navigation.navigate(route);

  return (
    <View style={styles.shell}>
      {desktop ? (
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <Image source={require('../../assets/lar-em-dia-logo.png')} style={styles.brandLogo} resizeMode="contain" />
            <View><Text style={styles.brandName}>Lar em Dia</Text><Text style={styles.brandSubtitle}>Gestão condominial</Text></View>
          </View>

          <View style={styles.condoCard}>
            <View style={styles.condoIcon}><Text style={styles.condoIconText}>▦</Text></View>
            <View style={styles.grow}><Text style={styles.condoLabel}>{admin ? 'AMBIENTE' : 'CONDOMÍNIO ATUAL'}</Text><Text numberOfLines={2} style={styles.condoName}>{admin ? 'Administração geral' : condominiumName || 'Carregando condomínio...'}</Text></View>
          </View>

          <Text style={styles.navLabel}>GESTÃO</Text>
          <View style={styles.navList}>
            <View style={[styles.navButton, styles.navButtonActive]}><Text style={styles.navSymbolActive}>⌂</Text><Text style={styles.navTextActive}>Início</Text></View>
            {mainMenuModules.map((item) => (
              <Pressable key={item.title} disabled={!item.route} onPress={() => open(item.route)} style={styles.navButton}>
                <Text style={styles.navSymbol}>{item.symbol}</Text><Text style={styles.navText}>{item.shortTitle}</Text>
                {!item.route ? <Text style={styles.soonBadge}>EM BREVE</Text> : null}
              </Pressable>
            ))}
            {noticeModules.length ? <><Pressable onPress={() => setNoticesOpen((open) => !open)} style={styles.navButton}><Text style={styles.navSymbol}>●</Text><Text style={[styles.navText, styles.grow]}>Avisos</Text><Text style={styles.navChevron}>{noticesOpen ? '⌃' : '⌄'}</Text></Pressable>{noticesOpen ? <View style={styles.noticeSubnav}>{noticeModules.map((item) => <Pressable key={item.route} onPress={() => open(item.route)} style={styles.noticeSubnavItem}><View style={styles.noticeDot}/><Text style={styles.noticeSubnavText}>{item.route === 'Communications' ? 'Comunicação' : 'Relatos e solicitações'}</Text></Pressable>)}</View> : null}</> : null}
          </View>

          <Pressable style={styles.helpCard}><Text style={styles.helpIcon}>?</Text><View style={styles.grow}><Text style={styles.helpTitle}>Precisa de ajuda?</Text><Text style={styles.helpText}>Acesse a central de suporte</Text></View><Text style={styles.helpArrow}>↗</Text></Pressable>
          <View style={styles.userMini}><View style={styles.avatarLight}><Text style={styles.avatarLightText}>{initials}</Text></View><View style={styles.grow}><Text style={styles.userName}>{user?.username}</Text><Text style={styles.userRole}>{roleLabels[user?.role || '']}</Text></View><Pressable onPress={() => signOut()}><Text style={styles.exit}>Sair</Text></Pressable></View>
        </View>
      ) : null}

      <View style={[styles.main, desktop && styles.mainDesktop]}>
        <View style={styles.topbar}>
          {!desktop ? <View style={styles.brand}><Image source={require('../../assets/lar-em-dia-logo.png')} style={styles.mobileBrandLogo} resizeMode="contain" /><Text style={styles.brandName}>Lar em Dia</Text></View> : <Text style={styles.breadcrumb}>Painel  /  <Text style={styles.breadcrumbStrong}>Início</Text></Text>}
          <View style={styles.topActions}><View style={styles.online}><View style={styles.onlineDot}/><Text style={styles.onlineText}>Tudo certo</Text></View><View style={styles.avatarDark}><Text style={styles.avatarDarkText}>{initials}</Text></View></View>
        </View>

        <ScrollView contentContainerStyle={[styles.content, !desktop && styles.contentMobile]}>
          <View style={styles.welcome}>
            <View><Text style={styles.eyebrow}>VISÃO GERAL</Text><Text style={styles.welcomeTitle}>Olá, {user?.username}! 👋</Text><Text style={styles.welcomeText}>{admin ? 'Acompanhe e administre os condomínios da Administração geral.' : manager ? <>Acompanhe e administre o seu condomínio <Text style={styles.condominiumHighlight}>“{condominiumName || 'Carregando...'}”</Text>.</> : <>Acompanhe as informações do seu condomínio <Text style={styles.condominiumHighlight}>“{condominiumName || 'Carregando...'}”</Text>.</>}</Text></View>
          </View>

          <View style={[styles.statGrid, !desktop && styles.horizontalCards]}>
            <View style={[styles.stat, styles.profileStat]}><View style={styles.statHead}><View style={[styles.statIcon, { backgroundColor: '#fff3de' }]}><Text style={{ color: colors.amber }}>♙</Text></View><Text style={styles.statLabel}>SEU PERFIL</Text></View><Text numberOfLines={1} style={[styles.statValue, styles.roleValue]}>{roleLabels[user?.role || ''] || 'Usuário'}</Text><Text style={styles.statDescription}>acesso personalizado por permissão</Text></View>
          </View>

          <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Acesso rápido</Text><Text style={styles.sectionSubtitle}>Escolha uma área para continuar</Text></View></View>
          <View style={[styles.moduleGrid, desktop && styles.moduleGridDesktop]}>
            {visibleModules.map((item) => (
              <Pressable key={item.title} disabled={!item.route} onPress={() => open(item.route)} style={({ pressed }) => [styles.moduleCard, pressed && item.route && styles.pressed, !item.route && styles.disabled]}>
                <View style={[styles.moduleIcon, { backgroundColor: `${item.accent}18` }]}><Text style={[styles.moduleSymbol, { color: item.accent }]}>{item.symbol}</Text></View>
                <View style={styles.grow}><View style={styles.moduleTitleRow}><Text style={styles.moduleTitle}>{item.title}</Text>{!item.route ? <Text style={styles.planned}>EM BREVE</Text> : <Text style={styles.arrow}>→</Text>}</View><Text style={styles.moduleDescription}>{item.description}</Text></View>
              </Pressable>
            ))}
          </View>

          <View style={styles.securityCard}><View style={styles.securityIcon}><Text>🔒</Text></View><View style={styles.grow}><Text style={styles.securityTitle}>Ambiente seguro</Text><Text style={styles.securityText}>Seus dados e credenciais são protegidos e exibidos somente para perfis autorizados.</Text></View></View>
          {!desktop ? <Pressable onPress={() => signOut()} style={styles.mobileExit}><Text style={styles.mobileExitText}>Sair da conta</Text></Pressable> : null}
        </ScrollView>

        {!desktop ? (
          <View style={styles.mobileNav}>
            <View style={styles.mobileNavItem}><Text style={styles.mobileNavIconActive}>⌂</Text><Text style={styles.mobileNavTextActive}>Início</Text></View>
            {mobileModules.slice(0, 4).map((item) => <Pressable key={item.title} onPress={() => open(item.route)} style={styles.mobileNavItem}><Text style={styles.mobileNavIcon}>{item.symbol}</Text><Text numberOfLines={1} style={styles.mobileNavText}>{item.shortTitle}</Text></Pressable>)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  sidebar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: layout.sidebarWidth, zIndex: 5, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: 18, paddingTop: 27, paddingBottom: 20 },
  main: { flex: 1 }, mainDesktop: { marginLeft: layout.sidebarWidth }, grow: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 }, brandLogo: { width: 42, height: 42 }, mobileBrandLogo: { width: 32, height: 32 }, brandName: { color: colors.navy, fontSize: 18, fontWeight: '900', letterSpacing: .2 }, brandSubtitle: { color: '#8190a0', fontSize: 14, marginTop: 2 },
  condoCard: { marginTop: 28, marginBottom: 22, padding: 12, minHeight: 68, backgroundColor: '#f6f8fa', borderWidth: 1, borderColor: '#e9edf1', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, condoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' }, condoIconText: { color: colors.primary, fontSize: 19 }, condoLabel: { color: '#8794a2', fontSize: 13, marginBottom: 3 }, condoName: { color: colors.ink, fontSize: 14, lineHeight: 17, fontWeight: '800' },
  navLabel: { fontSize: 13, color: '#9aa6b2', fontWeight: '900', letterSpacing: 1.2, marginHorizontal: 12, marginBottom: 9 }, navList: { gap: 3 }, navButton: { minHeight: 52, borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 13 }, navButtonActive: { backgroundColor: '#eaf1fb' }, navSymbol: { width: 26, textAlign: 'center', color: '#637180', fontSize: 22 }, navSymbolActive: { width: 26, textAlign: 'center', color: colors.primaryDark, fontSize: 22 }, navText: { color: '#637180', fontSize: 15, fontWeight: '700' }, navTextActive: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' }, soonBadge: { marginLeft: 'auto', color: colors.muted, fontSize: 11, fontWeight: '900' }, navChevron: { color: colors.muted, fontSize: 18, fontWeight: '900' }, noticeSubnav: { marginLeft: 26, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: colors.border, gap: 3 }, noticeSubnavItem: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 9 }, noticeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }, noticeSubnavText: { color: '#596979', fontSize: 14, fontWeight: '800' },
  helpCard: { marginTop: 'auto', backgroundColor: '#f0f6fc', borderRadius: 11, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, helpIcon: { width: 25, height: 25, borderWidth: 1, borderColor: '#b9cce4', borderRadius: 13, textAlign: 'center', lineHeight: 23, color: colors.primary, fontWeight: '800' }, helpTitle: { color: colors.primaryDark, fontSize: 14, fontWeight: '800' }, helpText: { color: '#7c8b9a', fontSize: 12, marginTop: 2 }, helpArrow: { color: colors.primary },
  userMini: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 8, paddingTop: 16, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border }, avatarLight: { width: 33, height: 33, borderRadius: 17, backgroundColor: '#dfe9f6', alignItems: 'center', justifyContent: 'center' }, avatarLightText: { color: colors.primary, fontSize: 14, fontWeight: '800' }, userName: { color: colors.ink, fontSize: 14, fontWeight: '800' }, userRole: { color: '#8190a0', fontSize: 13, marginTop: 2 }, exit: { color: colors.red, fontSize: 13, fontWeight: '800' },
  topbar: { height: 68, paddingHorizontal: 34, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, breadcrumb: { color: '#8794a2', fontSize: 14 }, breadcrumbStrong: { color: '#34475c', fontWeight: '800' }, topActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginLeft: 'auto' }, online: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#dce8e5', borderRadius: 15, backgroundColor: '#f6fbf9', paddingHorizontal: 9, paddingVertical: 6 }, onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2bb596', marginRight: 5 }, onlineText: { color: '#497067', fontSize: 13 }, avatarDark: { width: 33, height: 33, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, avatarDarkText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: 34, paddingTop: 31, paddingBottom: 60 }, contentMobile: { paddingHorizontal: 15, paddingTop: 23, paddingBottom: 100 }, welcome: { marginBottom: 25 }, eyebrow: { color: '#8b98a6', fontSize: 13, letterSpacing: 1.1, fontWeight: '800', marginBottom: 7 }, welcomeTitle: { color: '#15263a', fontSize: 26, fontWeight: '900' }, welcomeText: { color: '#718091', fontSize: 15, lineHeight: 22, marginTop: 7 }, condominiumHighlight: { color: colors.primaryDark, fontWeight: '900' },
  statGrid: { flexDirection: 'row', gap: 14, marginBottom: 26 }, horizontalCards: { flexWrap: 'wrap' }, stat: { flex: 1, minWidth: 210, minHeight: 151, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 17 }, profileStat: { maxWidth: 420 }, statFeatured: { borderTopWidth: 3, borderTopColor: colors.teal }, statHead: { flexDirection: 'row', alignItems: 'center', gap: 8 }, statIcon: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }, statLabel: { color: '#788796', fontSize: 12, fontWeight: '900', letterSpacing: .7 }, statValue: { color: colors.ink, fontSize: 23, fontWeight: '900', marginTop: 13, marginBottom: 5 }, roleValue: { fontSize: 19 }, statDescription: { color: '#83909e', fontSize: 13 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 13 }, sectionTitle: { color: '#25374b', fontSize: 18, fontWeight: '900' }, sectionSubtitle: { color: '#8b97a3', fontSize: 14, marginTop: 4 }, moduleGrid: { gap: 12 }, moduleGridDesktop: { flexDirection: 'row', flexWrap: 'wrap' }, moduleCard: { minHeight: 112, flexBasis: '31%', flexGrow: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: layout.radius, padding: 16, ...shadow }, moduleIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, moduleSymbol: { fontSize: 20, fontWeight: '800' }, moduleTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, moduleTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, moduleDescription: { color: colors.muted, fontSize: 14, lineHeight: 19, marginTop: 7 }, arrow: { color: colors.primary, fontSize: 19 }, planned: { color: colors.muted, fontSize: 11, fontWeight: '900' }, pressed: { opacity: .88, transform: [{ scale: .995 }] }, disabled: { opacity: .65 },
  securityCard: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f3f7fb', borderRadius: layout.radius, padding: 15 }, securityIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#e5edf7', alignItems: 'center', justifyContent: 'center' }, securityTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, securityText: { color: colors.muted, fontSize: 13, lineHeight: 16, marginTop: 3 }, mobileExit: { marginTop: 16, height: 44, alignItems: 'center', justifyContent: 'center' }, mobileExitText: { color: colors.red, fontSize: 15, fontWeight: '800' },
  mobileNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 88, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', paddingHorizontal: 5, paddingVertical: 8 }, mobileNavItem: { flex: 1, minHeight: 70, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 3 }, mobileNavIcon: { color: '#657585', fontSize: 29, fontWeight: '800' }, mobileNavIconActive: { color: colors.primary, fontSize: 29, fontWeight: '900' }, mobileNavText: { color: '#657585', fontSize: 13, fontWeight: '700', textAlign: 'center' }, mobileNavTextActive: { color: colors.primary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
});
