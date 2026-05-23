import { AuthUser } from '../../models/AuthUser';

export interface SignUpResult {
  emailVerified: boolean;
}

export interface MagicLinkSendResult {
  success: boolean;
  state: string;
  message?: string;
}

export interface MagicLinkCallbackResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export interface IAuthService {
  signUp(email: string, password: string): Promise<SignUpResult>;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<AuthUser | null>;
  isAuthenticated(): Promise<boolean>;
  verifyEmail(token: string): Promise<void>;
  resendVerificationEmail(
    email: string
  ): Promise<{ success: boolean; message: string }>;

  // Magic link / passwordless authentication
  sendMagicLink(
    email: string,
    redirectUri: string
  ): Promise<MagicLinkSendResult>;
  handleMagicLinkCallback(): Promise<MagicLinkCallbackResult>;
  isMagicLinkCallback(): boolean;

  // Fabric brokered authentication
  initiateFabricLogin(): Promise<void>;
  ensureSignedInWithFabric(): Promise<AuthUser>;
  /**
   * Auto-detects embedded mode (`?fabricEmbedded=true`) and silently
   * authenticates via the host's postMessage bridge. Returns the
   * authenticated user, or `null` if not in embedded mode.
   * Safe to call on page load — never opens a popup.
   */
  initEmbeddedAuth(): Promise<AuthUser | null>;
}
