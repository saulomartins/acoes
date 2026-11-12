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
  // Preenchido só no token de "Ver como este usuário" (Suporte, admin_geral):
  // o admin vê o app exatamente como esta pessoa, SOMENTE LEITURA. O
  // middleware authenticate recusa qualquer escrita com esse token. Ver
  // view_as_sessions em schema.sql.
  viewAs?: ViewAsInfo | null;
};

export type ViewAsInfo = {
  sessionId: string;
  adminId: string;
  adminName: string | null;
  expiresAt: string;
};

export type AccessTokenPayload = AuthenticatedUser & {
  sub: string;
  sid?: string;
  va?: { sid: string; by: string; byName: string | null; exp: string };
};
