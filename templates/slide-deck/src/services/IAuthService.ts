export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface IAuthService {
  readonly fabricAuthEnabled: boolean;
  signIn(): Promise<AuthUser>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
  initEmbeddedAuth(): Promise<AuthUser | null>;
}

export function toAuthUser(user: {
  id: string;
  email: string;
  name?: string;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email.split('@')[0],
  };
}
