import {
  ensureSignedInWithFabric,
  initEmbeddedAuth as sdkInitEmbeddedAuth,
  type FabricAuthOptions,
} from '@microsoft/rayfin-auth-provider-fabric';
import { type RayfinClient } from '@microsoft/rayfin-client';

import type { ApiKeyAppSchema } from '../../rayfin/data/schema';

import {
  type AuthMode,
  type AuthUser,
  type Credentials,
  type IAuthService,
  toAuthUser,
} from './IAuthService';

interface PasswordModeConfig {
  mode: 'password';
}

interface FabricModeConfig {
  mode: 'fabric';
  fabricOptions: FabricAuthOptions;
}

type AuthConfig = PasswordModeConfig | FabricModeConfig;

/**
 * Unified auth service that supports both authentication modes:
 *
 * - `'password'` — email/password sign-in/sign-up via the Rayfin auth
 *   API. Used for local development and standalone deployments.
 * - `'fabric'`  — Fabric brokered authentication via
 *   `@microsoft/rayfin-auth-provider-fabric`. Used when deployed to a
 *   Fabric workspace.
 */
export class RayfinAuthService implements IAuthService {
  readonly authMode: AuthMode;

  constructor(
    private readonly client: RayfinClient<ApiKeyAppSchema>,
    private readonly config: AuthConfig
  ) {
    this.authMode = config.mode;
  }

  async signIn(credentials?: Credentials): Promise<AuthUser> {
    if (this.config.mode === 'fabric') {
      const session = await ensureSignedInWithFabric(
        this.client.auth,
        this.config.fabricOptions
      );
      if (!session.isAuthenticated || !session.user) {
        throw new Error(
          'Fabric authentication completed but no session was established.'
        );
      }
      return toAuthUser(session.user);
    }

    // Password mode
    if (!credentials) {
      throw new Error('Email and password are required.');
    }

    const auth = this.client.auth;
    await auth.signIn({ email: credentials.email, password: credentials.password });

    const session = auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Sign-in succeeded but no session was established.');
    }
    return toAuthUser(session.user);
  }

  async signUp(credentials: Credentials): Promise<AuthUser> {
    if (this.config.mode === 'fabric') {
      throw new Error('Sign-up is not supported in Fabric mode.');
    }

    const auth = this.client.auth;

    await auth.signUp({ email: credentials.email, password: credentials.password });
    await auth.signIn({ email: credentials.email, password: credentials.password });

    const session = auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Sign-up succeeded but no session was established.');
    }
    return toAuthUser(session.user);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = this.client.auth.getSession();
    if (!session.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    if (this.config.mode !== 'fabric') return null;

    const session = await sdkInitEmbeddedAuth(
      this.client.auth,
      this.config.fabricOptions
    );
    if (!session?.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }
}
