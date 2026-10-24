export type UserRole = 'admin_geral' | 'sindico' | 'subsindico' | 'proprietario' | 'inquilino';

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumName?: string | null;
  fullName?: string | null;
  mustChangePassword: boolean;
  termsAcceptedVersion?: string | null;
  termsAcceptedAt?: string | null;
  tourCompletedVersion?: string | null;
  tourCompletedAt?: string | null;
  // null = perfil padrão (role/condominiumId direto da linha em `users`).
  // Setado = um dos perfis extras em `user_profiles` (ver authService.switchProfile).
  activeProfileId?: string | null;
  // Sessão (refresh_tokens.id) que emitiu o access token. null em tokens
  // emitidos antes de 24/10/2026, que não traziam `sid`.
  sessionId?: string | null;
};

export type AccessTokenPayload = AuthenticatedUser & {
  sub: string;
  sid?: string;
};
