import {
  AuthUser,
  IAuthService,
  SignUpResult,
} from '../interfaces/IAuthService';

import { getRayfinClient } from './RayfinClientService';
import {
  FabricAuthConfig,
  RayfinFabricAuthService,
} from './RayfinFabricAuthService';
import { RayfinUsernameAuthService } from './RayfinUsernameAuthService';

interface RayfinAuthServiceOptions {
  usernameAuth?: RayfinUsernameAuthService;
  fabricAuth?: RayfinFabricAuthService;
}

/**
 * Composite auth service that delegates to username/password and/or Fabric
 * sub-services based on what was enabled via the builder.
 */
export class RayfinAuthService implements IAuthService {
  private readonly usernameAuth?: RayfinUsernameAuthService;
  private readonly fabricAuth?: RayfinFabricAuthService;

  constructor(options: RayfinAuthServiceOptions) {
    this.usernameAuth = options.usernameAuth;
    this.fabricAuth = options.fabricAuth;
  }

  get usernameAuthEnabled(): boolean {
    return !!this.usernameAuth;
  }

  get fabricAuthEnabled(): boolean {
    return !!this.fabricAuth;
  }

  static builder(): RayfinAuthServiceBuilder {
    return new RayfinAuthServiceBuilder();
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    if (!this.usernameAuth) {
      throw new Error('Username/password authentication is not configured.');
    }
    return this.usernameAuth.signUp(email, password);
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    if (!this.usernameAuth) {
      throw new Error('Username/password authentication is not configured.');
    }
    return this.usernameAuth.signIn(email, password);
  }

  async signOut(): Promise<void> {
    try {
      const client = getRayfinClient();
      await client.auth.signOut();
    } catch (error) {
      console.error('RayfinAuthService signOut error:', error);
      throw new Error('Logout failed.');
    }
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      const client = getRayfinClient();
      const session = client.auth.getSession();

      if (!session.isAuthenticated || !session.user) {
        return null;
      }

      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.email.split('@')[0],
      };
    } catch {
      return null;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const client = getRayfinClient();
      const session = client.auth.getSession();
      return session.isAuthenticated;
    } catch {
      return false;
    }
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    if (!this.fabricAuth) {
      return null;
    }
    return this.fabricAuth.initEmbeddedAuth();
  }

  async initiateFabricLogin(): Promise<void> {
    if (!this.fabricAuth) {
      throw new Error('Fabric authentication is not configured.');
    }
    return this.fabricAuth.initiateFabricLogin();
  }

  async ensureSignedInWithFabric(): Promise<AuthUser> {
    if (!this.fabricAuth) {
      throw new Error('Fabric authentication is not configured.');
    }
    return this.fabricAuth.ensureSignedInWithFabric();
  }
}

export class RayfinAuthServiceBuilder {
  private usernameAuth?: RayfinUsernameAuthService;
  private fabricAuth?: RayfinFabricAuthService;

  withUsernameAuth(): this {
    this.usernameAuth = new RayfinUsernameAuthService();
    return this;
  }

  withFabricAuth(config: FabricAuthConfig): this {
    this.fabricAuth = new RayfinFabricAuthService(config);
    return this;
  }

  build(): RayfinAuthService {
    return new RayfinAuthService({
      usernameAuth: this.usernameAuth,
      fabricAuth: this.fabricAuth,
    });
  }
}
