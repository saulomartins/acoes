import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Home from '../screens/Home';
import Clearances from '../screens/Clearances';
import ClearanceVerify from '../screens/ClearanceVerify';
import Landing from '../screens/Landing';
import Login from '../screens/Login';
import Register from '../screens/Register';
import Invoices from '../screens/Invoices';
import Debts from '../screens/Debts';
import AgreementHistory from '../screens/AgreementHistory';
import Communications from '../screens/Communications';
import Reports from '../screens/Reports';
import Accountability from '../screens/Accountability';
import MobileReleases from '../screens/MobileReleases';
import Occurrences from '../screens/Occurrences';
import InfractionNotices from '../screens/InfractionNotices';
import Polls from '../screens/Polls';
import LegalDocument from '../screens/LegalDocument';
import TermsAcceptance,{CURRENT_TERMS_VERSION} from '../screens/TermsAcceptance';
import SpaceReservations from '../screens/SpaceReservations';
import ForgotPassword from '../screens/ForgotPassword';
import ResetPassword from '../screens/ResetPassword';
import ForcePasswordChange from '../screens/ForcePasswordChange';
import SelectProfile from '../screens/SelectProfile';
import NativeAccessBlocked from '../screens/NativeAccessBlocked';
import { AuthContext, storage } from '../context/AuthContext';
import { apiRequest } from '../api/client';
import { subscribeSystemTour } from '../services/tourEvents';
import { Stack } from './stack';
import { TOUR_STEPS, MANAGEMENT_ROUTES } from './routeRoles';
import { withResponsiveShell, withRoleGuard } from './screenHelpers';
import { ManagementStackScreens } from './ManagementStack';

type RootStackParamList = {
  Landing: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: undefined;
  ForcePasswordChange: undefined;
  SelectProfile: undefined;
  NativeAccessBlocked: undefined;
  Home: undefined;
  Dashboard: undefined;
  UserStats: undefined;
  BillingAnalytics: undefined;
  Clearances: undefined;
  ClearanceVerify: { code?: string } | undefined;
  Condominiums: undefined;
  Users: undefined;
  BankIntegration: undefined;
  BankLink: undefined;
  BankConfigurations: undefined;
  Banks: undefined;
  BankIntegrationGuide: undefined;
  UnitTypes: undefined;
  UnitExtraCharges: undefined;
  UnitConsumption: undefined;
  Units: undefined;
  Invoices: undefined;
  BillingSettings: undefined;
  Debts: undefined;
  AgreementHistory: undefined;
  Communications: undefined;
  Reports: undefined;
  Accountability: undefined;
  MobileReleases: undefined;
  PlatformPlans: undefined;
  PlatformRevenue: undefined;
  PlatformReceipts: undefined;
  AuditLog: undefined;
  GoogleDriveIntegrationGuide: undefined;
  Support: undefined;
  RegulationArticles: undefined;
  Occurrences: undefined;
  InfractionNoticeIssue: { occurrenceId?: string; unitId?: string } | undefined;
  InfractionNotices: undefined;
  Polls: undefined;
  SpaceReservations: undefined;
  LegalDocument: { document: 'privacy' | 'terms' };
  TermsAcceptance: undefined;
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();
// A landing page de marketing só existe no build web (app.laremdia.com.br).
// No app nativo instalado (Android/iOS) o usuário já decidiu usar o app —
// a primeira tela deve ser sempre o Login, nunca a landing de vendas.
const isWeb = Platform.OS === 'web';
export const CURRENT_TOUR_VERSION='2026-08-17-1';

type InAppNotification = {
  title: string;
  body: string;
  screen?: 'Communications' | 'Reports' | 'Debts' | 'Occurrences' | 'InfractionNotices' | 'Invoices' | 'Polls' | 'SpaceReservations';
};

// Telas fora do ResponsiveShell (login, termos, troca de perfil) não têm quem
// reserve o espaço da status bar — no Android 15, com edge-to-edge obrigatório,
// elas nasceriam por baixo do relógio do sistema. Este HOC faz o mesmo papel que
// o shell faz para as telas autenticadas.
const withSafeArea = (Component: React.ComponentType<any>) => {
  return (props: any) => {
    const insets = useSafeAreaInsets();
    return (
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Component {...props} />
      </View>
    );
  };
};

// Chamado uma única vez aqui em cima (não dentro de AppNavigator) de propósito:
// withResponsiveShell(...) cria uma função de componente nova a cada chamada, e
// <Stack.Screen component={...}> usa essa identidade pra decidir se é "a mesma"
// tela. Chamar isso dentro do render de AppNavigator (que re-renderiza sempre
// que o AuthContext muda, ex. o polling de condominiumFeatures a cada 60s)
// gerava um componente "novo" a cada vez — o React Navigation via isso como uma
// tela diferente e desmontava/remontava a tela ativa, apagando qualquer
// formulário em preenchimento. Pré-computar aqui mantém a mesma identidade de
// função entre renders.
const HomeScreen = withRoleGuard(withResponsiveShell(Home, 'Home'), 'Home');
const ClearancesScreen = withRoleGuard(withResponsiveShell(Clearances, 'Clearances'), 'Clearances');
const InvoicesScreen = withRoleGuard(withResponsiveShell(Invoices, 'Invoices'), 'Invoices');
const DebtsScreen = withRoleGuard(withResponsiveShell(Debts, 'Debts'), 'Debts');
const AgreementHistoryScreen = withRoleGuard(withResponsiveShell(AgreementHistory, 'AgreementHistory'), 'AgreementHistory');
const CommunicationsScreen = withRoleGuard(withResponsiveShell(Communications, 'Communications'), 'Communications');
const ReportsScreen = withRoleGuard(withResponsiveShell(Reports, 'Reports'), 'Reports');
const AccountabilityScreen = withRoleGuard(withResponsiveShell(Accountability, 'Accountability'), 'Accountability');
const MobileReleasesScreen = withRoleGuard(withResponsiveShell(MobileReleases, 'MobileReleases'), 'MobileReleases');
const OccurrencesScreen = withRoleGuard(withResponsiveShell(Occurrences, 'Occurrences'), 'Occurrences');
const InfractionNoticesScreen = withRoleGuard(withResponsiveShell(InfractionNotices, 'InfractionNotices'), 'InfractionNotices');
const PollsScreen = withRoleGuard(withResponsiveShell(Polls, 'Polls'), 'Polls');
const SpaceReservationsScreen = withRoleGuard(withResponsiveShell(SpaceReservations, 'SpaceReservations'), 'SpaceReservations');

// Pré-computadas pelo mesmo motivo das de cima: manter a identidade da função
// estável entre renders para o React Navigation não remontar a tela ativa.
const LoginScreen = withSafeArea(Login);
const RegisterScreen = withSafeArea(Register);
const LandingScreen = withSafeArea(Landing);
const ForgotPasswordScreen = withSafeArea(ForgotPassword);
const ResetPasswordScreen = withSafeArea(ResetPassword);
const LegalDocumentScreen = withSafeArea(LegalDocument);
const SelectProfileScreen = withSafeArea(SelectProfile);
const NativeAccessBlockedScreen = withSafeArea(NativeAccessBlocked);
const TermsAcceptanceScreen = withSafeArea(TermsAcceptance);
const ForcePasswordChangeScreen = withSafeArea(ForcePasswordChange);
const ClearanceVerifyStandaloneScreen = withSafeArea(ClearanceVerify);

const resolveNotificationScreen = (payload: unknown): 'Communications' | 'Reports' | 'Debts' | 'Occurrences' | 'InfractionNotices' | 'Invoices' | 'Polls' | 'SpaceReservations' | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const screen = 'screen' in payload ? payload.screen : undefined;
  return screen === 'Communications' || screen === 'Reports' || screen === 'Debts' || screen === 'Occurrences' || screen === 'InfractionNotices' || screen === 'Invoices' || screen === 'Polls' || screen === 'SpaceReservations' ? screen : undefined;
};

export default function AppNavigator() {
  const { userToken, user, isLoading, condominiumFeatures, updateUser, needsProfileSelection, nativeAccessBlocked } = useContext(AuthContext);
  const [inAppNotification, setInAppNotification] = useState<InAppNotification | null>(null);
  const [tourActive,setTourActive]=useState(false);const [tourIndex,setTourIndex]=useState(0);const autoTourStarted=useRef(false);
  // Guarda "tour já visto" também neste aparelho (fora do objeto `user`), pois
  // completeTour() grava no servidor de forma best-effort: numa rede instável
  // (comum em app mobile) a chamada pode falhar mesmo com o tour já concluído
  // na tela. Sem isso, o tourCompletedVersion do usuário nunca era persistido
  // e o tour reaparecia no próximo login explícito — mais perceptível em quem
  // tem dois perfis, porque aí o reaparecimento acontece logo após escolher
  // o perfil em "Entrar como", e não junto com o próprio login.
  const [deviceTourVersion,setDeviceTourVersion]=useState<string|null>(null);
  useEffect(()=>{let active=true;storage.get('tourSeenVersion').then(value=>{if(active)setDeviceTourVersion(value);});return()=>{active=false;};},[]);
  const tourSteps=useMemo(()=>TOUR_STEPS.filter(step=>step.roles.includes(user?.role||'')&&(!step.feature||condominiumFeatures?.[step.feature]===true)&&(isWeb||!MANAGEMENT_ROUTES.has(step.route))),[condominiumFeatures,user?.role]);
  const openTourStep=useCallback((index:number)=>{const step=tourSteps[index];if(step&&navigationRef.isReady())navigationRef.navigate(step.route as any);},[tourSteps]);
  const startTour=useCallback(()=>{if(!tourSteps.length)return;setTourIndex(0);setTourActive(true);setTimeout(()=>openTourStep(0),0);},[openTourStep,tourSteps.length]);
  const completeTour=useCallback(async()=>{
    setTourActive(false);
    // Grava local primeiro (síncrono para quem chama): garante que o tour não
    // reaparece neste aparelho mesmo que a sincronização com o servidor abaixo
    // falhe.
    await storage.set('tourSeenVersion',CURRENT_TOUR_VERSION);
    setDeviceTourVersion(CURRENT_TOUR_VERSION);
    if(!userToken)return;
    try{
      const data=await apiRequest<{user:any}>('/auth/tour/complete',userToken,{method:'POST',body:JSON.stringify({version:CURRENT_TOUR_VERSION})});
      await updateUser(data.user);
    }catch(error){
      console.warn('Failed to record tour completion on server (kept local so it will not reappear on this device)',error);
    }
  },[updateUser,userToken]);

  useEffect(()=>subscribeSystemTour(startTour),[startTour]);
  useEffect(()=>{if(!userToken)autoTourStarted.current=false;},[userToken]);
  // O tour só pode começar depois que a navegação principal existe. Cada passo
  // faz navigationRef.navigate(step.route), e enquanto uma tela de bloqueio
  // está no ar (trocar senha, aceitar termos, escolher perfil) o Stack só tem
  // aquela tela — o navigate não acha a rota e o tour aparecia sobreposto,
  // apontando para telas que não estão montadas. Foi o que acontecia com quem
  // tem mais de um perfil: o tour abria por cima de "Entrar como".
  // needsProfileSelection está nas dependências de propósito, para o tour
  // disparar sozinho assim que o perfil for escolhido; autoTourStarted só é
  // marcado quando o tour realmente começa, então nada é perdido no caminho.
  // deviceTourVersion complementa user.tourCompletedVersion: mesmo que a
  // confirmação do servidor tenha falhado numa sessão anterior, este aparelho
  // já registrou localmente que o tour foi concluído/pulado e não deve repetir.
  useEffect(()=>{if(!userToken||!user||user.mustChangePassword||needsProfileSelection||nativeAccessBlocked||user.termsAcceptedVersion!==CURRENT_TERMS_VERSION||user.tourCompletedVersion===CURRENT_TOUR_VERSION||deviceTourVersion===CURRENT_TOUR_VERSION||autoTourStarted.current)return;if(!['admin_geral','sindico','subsindico','proprietario','inquilino'].includes(user.role))return;autoTourStarted.current=true;const timer=setTimeout(startTour,500);return()=>clearTimeout(timer);},[startTour,user,userToken,needsProfileSelection,nativeAccessBlocked,deviceTourVersion]);

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((event) => {
      const screen = resolveNotificationScreen(event.request.content.data);
      setInAppNotification({
        title: event.request.content.title || 'Novo aviso',
        body: event.request.content.body || 'Você recebeu uma nova notificação.',
        screen,
      });
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((event) => {
      const screen = resolveNotificationScreen(event.notification.request.content.data);
      if (screen && navigationRef.isReady() && userToken) {
        navigationRef.navigate(screen);
      }
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [userToken]);

  useEffect(() => {
    if (!inAppNotification) return;
    const timer = setTimeout(() => setInAppNotification(null), 6000);
    return () => clearTimeout(timer);
  }, [inAppNotification]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NavigationContainer ref={navigationRef} linking={{ prefixes: ['laremdia://', 'appcond://'], config: { screens: isWeb ? { Landing: '', Login: 'login', ForgotPassword: 'esqueci-senha', ResetPassword: 'redefinir-senha', ClearanceVerify: 'verificar/:code?', LegalDocument: 'legal/:document' } : { Login: '', ForgotPassword: 'esqueci-senha', ResetPassword: 'redefinir-senha', ClearanceVerify: 'verificar/:code?' } } }}>
        <Stack.Navigator screenOptions={{ animation: 'fade', contentStyle: { backgroundColor: '#f5f7fb' } }}>
          {userToken && user?.mustChangePassword ? (
            <Stack.Screen name="ForcePasswordChange" component={ForcePasswordChangeScreen} options={{ headerShown: false }} />
          ) : userToken && user?.termsAcceptedVersion !== CURRENT_TERMS_VERSION ? (
            <>
              <Stack.Screen name="TermsAcceptance" component={TermsAcceptanceScreen} options={{ headerShown: false }} />
              <Stack.Screen name="LegalDocument" component={LegalDocumentScreen} options={{ headerShown: false }} />
            </>
          ) : userToken && needsProfileSelection ? (
            <Stack.Screen name="SelectProfile" component={SelectProfileScreen} options={{ headerShown: false }} />
          ) : userToken && nativeAccessBlocked ? (
            <Stack.Screen name="NativeAccessBlocked" component={NativeAccessBlockedScreen} options={{ headerShown: false }} />
          ) : userToken ? (
            <>
              <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Clearances" component={ClearancesScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ClearanceVerify" component={ClearanceVerifyStandaloneScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Invoices" component={InvoicesScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Debts" component={DebtsScreen} options={{ headerShown: false }} />
              <Stack.Screen name="AgreementHistory" component={AgreementHistoryScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Communications" component={CommunicationsScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Reports" component={ReportsScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Accountability" component={AccountabilityScreen} options={{ headerShown: false }} />
              <Stack.Screen name="MobileReleases" component={MobileReleasesScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Occurrences" component={OccurrencesScreen} options={{ headerShown: false }} />
              <Stack.Screen name="InfractionNotices" component={InfractionNoticesScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Polls" component={PollsScreen} options={{ headerShown: false }} />
              <Stack.Screen name="SpaceReservations" component={SpaceReservationsScreen} options={{ headerShown: false }} />
              {ManagementStackScreens()}
            </>
          ) : (
            <>
              {isWeb ? <Stack.Screen name="Landing" component={LandingScreen} options={{ headerShown: false }} /> : null}
              <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false }} />
              <Stack.Screen name="LegalDocument" component={LegalDocumentScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ headerShown: false }} />
              <Stack.Screen name="ClearanceVerify" component={ClearanceVerifyStandaloneScreen} options={{ headerShown: false }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {inAppNotification ? (
        <Pressable
          style={styles.inAppBanner}
          onPress={() => {
            if (inAppNotification.screen && navigationRef.isReady() && userToken) {
              navigationRef.navigate(inAppNotification.screen);
            }
            setInAppNotification(null);
          }}
        >
          <Text style={styles.inAppEyebrow}>Nova notificação</Text>
          <Text style={styles.inAppTitle}>{inAppNotification.title}</Text>
          <Text style={styles.inAppBody}>{inAppNotification.body}</Text>
        </Pressable>
      ) : null}
      {tourActive&&tourSteps[tourIndex]?<View style={styles.tourLayer} pointerEvents="box-none"><View style={styles.tourCard}><View style={styles.tourTop}><Text style={styles.tourEyebrow}>TOUR DO SISTEMA</Text><Text style={styles.tourProgress}>{tourIndex+1} de {tourSteps.length}</Text></View><Text style={styles.tourTitle}>{tourSteps[tourIndex].title}</Text><Text style={styles.tourDescription}>{tourSteps[tourIndex].description}</Text><Text style={styles.tourHint}>A tela desta funcionalidade está aberta ao fundo. Explore a localização e avance quando estiver pronto.</Text><View style={styles.tourBar}><View style={[styles.tourBarFill,{width:`${((tourIndex+1)/tourSteps.length)*100}%` as any}]}/></View><View style={styles.tourActions}><Pressable onPress={completeTour} style={styles.tourSkip}><Text style={styles.tourSkipText}>Pular tour</Text></Pressable>{tourIndex>0?<Pressable onPress={()=>{const next=tourIndex-1;setTourIndex(next);openTourStep(next);}} style={styles.tourSecondary}><Text style={styles.tourSecondaryText}>Voltar</Text></Pressable>:null}<Pressable onPress={()=>{if(tourIndex===tourSteps.length-1){completeTour();return;}const next=tourIndex+1;setTourIndex(next);openTourStep(next);}} style={styles.tourNext}><Text style={styles.tourNextText}>{tourIndex===tourSteps.length-1?'Concluir':'Próxima'}</Text></Pressable></View></View></View>:null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inAppBanner: {
    position: 'absolute',
    top: 18,
    left: 16,
    right: 16,
    zIndex: 40,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#101a2e',
    borderWidth: 1,
    borderColor: '#31588c',
    shadowColor: '#101a2e',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 10,
  },
  inAppEyebrow: { color: '#9fd2ff', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  inAppTitle: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 4 },
  inAppBody: { color: '#d8e8f8', fontSize: 14, marginTop: 4 },
  tourLayer:{position:'absolute',left:0,right:0,bottom:0,zIndex:60,alignItems:'center',padding:16,backgroundColor:'rgba(15,23,42,0.22)'},
  tourCard:{width:'100%',maxWidth:620,borderRadius:18,backgroundColor:'#fff',padding:21,borderWidth:1,borderColor:'#dbe3ee',shadowColor:'#101a2e',shadowOffset:{width:0,height:8},shadowOpacity:.2,shadowRadius:20,elevation:12},
  tourTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},tourEyebrow:{color:'#2563c5',fontSize:12,fontWeight:'900',letterSpacing:1},tourProgress:{color:'#667085',fontSize:12,fontWeight:'800'},tourTitle:{color:'#172033',fontSize:22,fontWeight:'900',marginTop:9},tourDescription:{color:'#445466',fontSize:15,lineHeight:22,marginTop:7},tourHint:{color:'#667085',fontSize:12.5,lineHeight:18,marginTop:10},tourBar:{height:5,borderRadius:3,backgroundColor:'#e7ebf1',overflow:'hidden',marginTop:16},tourBarFill:{height:5,backgroundColor:'#2563c5'},tourActions:{flexDirection:'row',justifyContent:'flex-end',alignItems:'center',gap:8,marginTop:16,flexWrap:'wrap'},tourSkip:{padding:11},tourSkipText:{color:'#667085',fontWeight:'800'},tourSecondary:{paddingHorizontal:16,paddingVertical:11,borderWidth:1,borderColor:'#dbe3ee',borderRadius:9},tourSecondaryText:{color:'#172033',fontWeight:'900'},tourNext:{paddingHorizontal:18,paddingVertical:12,backgroundColor:'#2563c5',borderRadius:9},tourNextText:{color:'#fff',fontWeight:'900'},
});
