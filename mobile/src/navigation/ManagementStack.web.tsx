import React from 'react';
import { Stack } from './stack';
import { withResponsiveShell, withRoleGuard } from './screenHelpers';
import Dashboard from '../screens/Dashboard';
import UserStats from '../screens/UserStats';
import BillingAnalytics from '../screens/BillingAnalytics';
import Condominiums from '../screens/Condominiums';
import Users from '../screens/Users';
import BankIntegration from '../screens/BankIntegration';
import BankIntegrationGuide from '../screens/BankIntegrationGuide';
import GoogleDriveIntegrationGuide from '../screens/GoogleDriveIntegrationGuide';
import UnitTypes from '../screens/UnitTypes';
import UnitExtraCharges from '../screens/UnitExtraCharges';
import UnitConsumption from '../screens/UnitConsumption';
import BillingSettings from '../screens/BillingSettings';
import Units from '../screens/Units';
import PlatformPlans from '../screens/PlatformPlans';
import PlatformRevenue from '../screens/PlatformRevenue';
import AuditLog from '../screens/AuditLog';
import Support from '../screens/Support';
import RegulationArticles from '../screens/RegulationArticles';
import InfractionNoticeIssue from '../screens/InfractionNoticeIssue';

// Telas de gestão (admin_geral e síndico/subsíndico) — só existem no build
// web. Este módulo é resolvido pelo Metro no lugar de ManagementStack.native.tsx
// quando o alvo é web; no Android/iOS, ManagementStack.native.tsx (sem nenhum
// destes imports) é o que entra no bundle.
const DashboardScreen = withRoleGuard(withResponsiveShell(Dashboard, 'Dashboard'), 'Dashboard');
const UserStatsScreen = withRoleGuard(withResponsiveShell(UserStats, 'UserStats'), 'UserStats');
const BillingAnalyticsScreen = withRoleGuard(withResponsiveShell(BillingAnalytics, 'BillingAnalytics'), 'BillingAnalytics');
const CondominiumsScreen = withRoleGuard(withResponsiveShell(Condominiums, 'Condominiums'), 'Condominiums');
const UsersScreen = withRoleGuard(withResponsiveShell(Users, 'Users'), 'Users');
const BankIntegrationScreen = withRoleGuard(withResponsiveShell(BankIntegration, 'BankIntegration'), 'BankIntegration');
const BankLinkScreen = withRoleGuard(withResponsiveShell(BankIntegration, 'BankLink'), 'BankLink');
const BankConfigurationsScreen = withRoleGuard(withResponsiveShell(BankIntegration, 'BankConfigurations'), 'BankConfigurations');
const BanksScreen = withRoleGuard(withResponsiveShell(BankIntegration, 'Banks'), 'Banks');
const BankIntegrationGuideScreen = withRoleGuard(withResponsiveShell(BankIntegrationGuide, 'BankIntegrationGuide'), 'BankIntegrationGuide');
const UnitTypesScreen = withRoleGuard(withResponsiveShell(UnitTypes, 'UnitTypes'), 'UnitTypes');
const UnitExtraChargesScreen = withRoleGuard(withResponsiveShell(UnitExtraCharges, 'UnitExtraCharges'), 'UnitExtraCharges');
const UnitConsumptionScreen = withRoleGuard(withResponsiveShell(UnitConsumption, 'UnitConsumption'), 'UnitConsumption');
const UnitsScreen = withRoleGuard(withResponsiveShell(Units, 'Units'), 'Units');
const BillingSettingsScreen = withRoleGuard(withResponsiveShell(BillingSettings, 'BillingSettings'), 'BillingSettings');
const PlatformPlansScreen = withRoleGuard(withResponsiveShell(PlatformPlans, 'PlatformPlans'), 'PlatformPlans');
const PlatformRevenueScreen = withRoleGuard(withResponsiveShell(PlatformRevenue, 'PlatformRevenue'), 'PlatformRevenue');
const AuditLogScreen = withRoleGuard(withResponsiveShell(AuditLog, 'AuditLog'), 'AuditLog');
const GoogleDriveIntegrationGuideScreen = withRoleGuard(withResponsiveShell(GoogleDriveIntegrationGuide, 'GoogleDriveIntegrationGuide'), 'GoogleDriveIntegrationGuide');
const SupportScreen = withRoleGuard(withResponsiveShell(Support, 'Support'), 'Support');
const RegulationArticlesScreen = withRoleGuard(withResponsiveShell(RegulationArticles, 'RegulationArticles'), 'RegulationArticles');
const InfractionNoticeIssueScreen = withRoleGuard(withResponsiveShell(InfractionNoticeIssue, 'InfractionNoticeIssue'), 'InfractionNoticeIssue');

export function ManagementStackScreens() {
  return (
    <>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="UserStats" component={UserStatsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="BillingAnalytics" component={BillingAnalyticsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Condominiums" component={CondominiumsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Users" component={UsersScreen} options={{ headerShown: false }} />
      <Stack.Screen name="BankIntegration" component={BankIntegrationScreen} options={{ headerShown: false }} />
      <Stack.Screen name="BankLink" component={BankLinkScreen} initialParams={{ section: 'link' }} options={{ headerShown: false }} />
      <Stack.Screen name="BankConfigurations" component={BankConfigurationsScreen} initialParams={{ section: 'configurations' }} options={{ headerShown: false }} />
      <Stack.Screen name="Banks" component={BanksScreen} initialParams={{ section: 'banks' }} options={{ headerShown: false }} />
      <Stack.Screen name="BankIntegrationGuide" component={BankIntegrationGuideScreen} options={{ headerShown: false }} />
      <Stack.Screen name="UnitTypes" component={UnitTypesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="UnitExtraCharges" component={UnitExtraChargesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="UnitConsumption" component={UnitConsumptionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Units" component={UnitsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="BillingSettings" component={BillingSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PlatformPlans" component={PlatformPlansScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PlatformRevenue" component={PlatformRevenueScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ headerShown: false }} />
      <Stack.Screen name="GoogleDriveIntegrationGuide" component={GoogleDriveIntegrationGuideScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ headerShown: false }} />
      <Stack.Screen name="RegulationArticles" component={RegulationArticlesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="InfractionNoticeIssue" component={InfractionNoticeIssueScreen} options={{ headerShown: false }} />
    </>
  );
}
