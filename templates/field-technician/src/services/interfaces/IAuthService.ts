export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface SignUpResult {
  emailVerified: boolean;
}

export interface IUsernameAuthService {
  signUp(email: string, password: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<AuthUser>;
}

export interface IFabricAuthService {
  initEmbeddedAuth(): Promise<AuthUser | null>;
  initiateFabricLogin(): Promise<void>;
  ensureSignedInWithFabric(): Promise<AuthUser>;
}

export interface IAuthService {
  readonly usernameAuthEnabled: boolean;
  readonly fabricAuthEnabled: boolean;

  signUp(email: string, password: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
  isAuthenticated(): Promise<boolean>;
  initEmbeddedAuth(): Promise<AuthUser | null>;
  initiateFabricLogin(): Promise<void>;
  ensureSignedInWithFabric(): Promise<AuthUser>;
}
