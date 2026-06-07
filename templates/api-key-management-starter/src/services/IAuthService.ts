/** Trimmed view of the authenticated user shown in the UI. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export type AuthMode = 'fabric' | 'password';

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Auth service contract used by the React layer.
 *
 * {@link RayfinAuthService} implements both modes:
 *
 * - `'password'` — email/password sign-in via `client.auth.signIn()`.
 * - `'fabric'`  — Fabric brokered auth via
 *   `@microsoft/rayfin-auth-provider-fabric`.
 *
 * `bootstrapAuth()` picks the mode from VITE_* env vars at startup.
 */
export interface IAuthService {
  /** Which authentication flow is active. */
  readonly authMode: AuthMode;

  /**
   * Acquire a session interactively.
   *
   * - In `password` mode, `credentials` must be supplied.
   * - In `fabric` mode, `credentials` is ignored and the Fabric broker
   *   popup opens (must be called from a user-gesture handler).
   */
  signIn(credentials?: Credentials): Promise<AuthUser>;

  /**
   * Create a new account. Only supported in `password` mode.
   */
  signUp(credentials: Credentials): Promise<AuthUser>;

  signOut(): Promise<void>;

  /** Return the current session's user, or `null` if not signed in. */
  getCurrentUser(): Promise<AuthUser | null>;

  /**
   * Try to acquire a session via the embedded (iframe) Fabric flow without
   * any UI. Returns `null` when not running inside a Fabric iframe or in
   * password mode.
   */
  initEmbeddedAuth(): Promise<AuthUser | null>;
}

/** Map the raw session user shape to the trimmed view used in the UI. */
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
