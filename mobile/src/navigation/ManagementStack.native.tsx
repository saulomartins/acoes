// Contraparte nativa de ManagementStack.web.tsx — sem nenhum import de tela
// de gestão, de propósito: o Metro resolve este arquivo (por causa do sufixo
// .native) para os builds Android/iOS, então Dashboard.tsx, Users.tsx,
// BankIntegration.tsx e as demais telas de gestão nunca entram no bundle
// nativo. No app instalado, essas rotas simplesmente não existem — Home.tsx
// e ResponsiveShell.tsx tratam isso mostrando "disponível na versão web" ao
// invés de tentar navegar (ver MANAGEMENT_ROUTES em routeRoles.ts).
export function ManagementStackScreens() {
  return null;
}
