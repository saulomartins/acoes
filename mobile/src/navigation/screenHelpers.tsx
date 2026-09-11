import React from 'react';
import ResponsiveShell from '../ui/ResponsiveShell';
import RequireRole from './RequireRole';
import { ROLES_BY_ROUTE } from './routeRoles';

// HOC to wrap screens with ResponsiveShell
export const withResponsiveShell = (Component: React.ComponentType<any>, routeName: string) => {
  return (props: any) => (
    <ResponsiveShell activeRoute={routeName} navigation={props.navigation}>
      <Component {...props} />
    </ResponsiveShell>
  );
};

// Bloqueia a tela pelo papel do usuário logado (ver ROLES_BY_ROUTE em
// routeRoles.ts). Rota sem entrada em ROLES_BY_ROUTE fica sem restrição.
export const withRoleGuard = (Component: React.ComponentType<any>, route: string) => {
  const allowedRoles = ROLES_BY_ROUTE[route];
  if (!allowedRoles) return Component;
  return (props: any) => (
    <RequireRole allowedRoles={allowedRoles} navigation={props.navigation}>
      <Component {...props} />
    </RequireRole>
  );
};
