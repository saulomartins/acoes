export type UserRole = 'admin_geral' | 'sindico' | 'subsindico' | 'proprietario' | 'inquilino';

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumName?: string | null;
};

export type AccessTokenPayload = AuthenticatedUser & {
  sub: string;
};
