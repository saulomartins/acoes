import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Home from '../screens/Home';
import Login from '../screens/Login';
import Register from '../screens/Register';
import Condominiums from '../screens/Condominiums';
import Users from '../screens/Users';
import Invoices from '../screens/Invoices';
import BankIntegration from '../screens/BankIntegration';
import UnitTypes from '../screens/UnitTypes';
import BillingSettings from '../screens/BillingSettings';
import Units from '../screens/Units';
import Debts from '../screens/Debts';
import Communications from '../screens/Communications';
import Reports from '../screens/Reports';
import Accountability from '../screens/Accountability';
import ForgotPassword from '../screens/ForgotPassword';
import ResetPassword from '../screens/ResetPassword';
import { AuthContext } from '../context/AuthContext';

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: undefined;
  Home: undefined;
  Condominiums: undefined;
  Users: undefined;
  BankIntegration: undefined;
  BankLink: undefined;
  BankConfigurations: undefined;
  Banks: undefined;
  UnitTypes: undefined;
  Units: undefined;
  Invoices: undefined;
  BillingSettings: undefined;
  Debts: undefined;
  Communications: undefined;
  Reports: undefined;
  Accountability: undefined;
};

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

type InAppNotification = {
  title: string;
  body: string;
  screen?: 'Communications' | 'Reports';
};

const resolveNotificationScreen = (payload: unknown): 'Communications' | 'Reports' | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const screen = 'screen' in payload ? payload.screen : undefined;
  return screen === 'Communications' || screen === 'Reports' ? screen : undefined;
};

export default function AppNavigator() {
  const { userToken, isLoading } = useContext(AuthContext);
  const [inAppNotification, setInAppNotification] = useState<InAppNotification | null>(null);

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
      <NavigationContainer ref={navigationRef} linking={{ prefixes: ['laremdia://', 'appcond://'], config: { screens: { Login: 'login', ForgotPassword: 'esqueci-senha', ResetPassword: 'redefinir-senha' } } }}>
        <Stack.Navigator>
          {userToken ? (
            <>
              <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
              <Stack.Screen name="Condominiums" component={Condominiums} options={{ headerShown: false }} />
              <Stack.Screen name="Users" component={Users} options={{ headerShown: false }} />
              <Stack.Screen name="BankIntegration" component={BankIntegration} options={{ headerShown: false }} />
              <Stack.Screen name="BankLink" component={BankIntegration} initialParams={{ section: 'link' }} options={{ headerShown: false }} />
              <Stack.Screen name="BankConfigurations" component={BankIntegration} initialParams={{ section: 'configurations' }} options={{ headerShown: false }} />
              <Stack.Screen name="Banks" component={BankIntegration} initialParams={{ section: 'banks' }} options={{ headerShown: false }} />
              <Stack.Screen name="UnitTypes" component={UnitTypes} options={{ headerShown: false }} />
              <Stack.Screen name="Units" component={Units} options={{ headerShown: false }} />
              <Stack.Screen name="Invoices" component={Invoices} options={{ headerShown: false }} />
              <Stack.Screen name="BillingSettings" component={BillingSettings} options={{ headerShown: false }} />
              <Stack.Screen name="Debts" component={Debts} options={{ headerShown: false }} />
              <Stack.Screen name="Communications" component={Communications} options={{ headerShown: false }} />
              <Stack.Screen name="Reports" component={Reports} options={{ headerShown: false }} />
              <Stack.Screen name="Accountability" component={Accountability} options={{ headerShown: false }} />
            </>
          ) : (
            <>
              <Stack.Screen name="Login" component={Login} options={{ headerShown: false }} />
              <Stack.Screen name="Register" component={Register} options={{ headerShown: false }} />
              <Stack.Screen name="ForgotPassword" component={ForgotPassword} options={{ headerShown: false }} />
              <Stack.Screen name="ResetPassword" component={ResetPassword} options={{ headerShown: false }} />
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
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#12314f',
    borderWidth: 1,
    borderColor: '#2f5f8f',
  },
  inAppEyebrow: { color: '#9fd2ff', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  inAppTitle: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 4 },
  inAppBody: { color: '#d8e8f8', fontSize: 14, marginTop: 4 },
});
