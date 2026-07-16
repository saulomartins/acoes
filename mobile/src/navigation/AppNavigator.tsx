import React, { useContext } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
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

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { userToken, isLoading } = useContext(AuthContext);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer linking={{ prefixes: ['laremdia://', 'appcond://'], config: { screens: { Login: 'login', ForgotPassword: 'esqueci-senha', ResetPassword: 'redefinir-senha' } } }}>
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
  );
}
