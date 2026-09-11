import React, { useContext, useEffect } from 'react';
import { AuthContext } from '../context/AuthContext';

// A navegação hoje registra todas as telas para qualquer usuário autenticado
// e só esconde os atalhos de gestão no menu (Home.tsx) — nada impedia um
// morador de chegar em Dashboard/Users/BankIntegration via navigate() direto
// ou deep link. Este guard bloqueia de fato o acesso pelo papel do usuário.
// A barreira real fica na API (authorize() nas rotas); isto é apenas UX —
// evita a tela renderizar e devolve o usuário para Home.
export default function RequireRole({
  allowedRoles,
  navigation,
  children,
}: {
  allowedRoles: string[];
  navigation: { replace: (route: string) => void };
  children: React.ReactNode;
}) {
  const { user } = useContext(AuthContext);
  const allowed = !!user && allowedRoles.includes(user.role);

  useEffect(() => {
    if (!allowed) {
      navigation.replace('Home');
    }
  }, [allowed, navigation]);

  if (!allowed) return null;
  return <>{children}</>;
}
