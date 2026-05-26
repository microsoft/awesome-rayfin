import {
  ensureSignedInWithFabric,
  initEmbeddedAuth as sdkInitEmbeddedAuth,
  type FabricAuthOptions,
} from '@microsoft/rayfin-auth-provider-fabric';
import type { RayfinClient } from '@microsoft/rayfin-client';
import type { SlideDeckSchema } from '../../rayfin/data/schema';
import { type AuthUser, type IAuthService, toAuthUser } from './IAuthService';

export class RayfinAuthService implements IAuthService {
  readonly fabricAuthEnabled = true;

  constructor(
    private readonly client: RayfinClient<SlideDeckSchema>,
    private readonly fabricOptions: FabricAuthOptions
  ) {}

  async signIn(): Promise<AuthUser> {
    const session = await ensureSignedInWithFabric(this.client.auth, this.fabricOptions);
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Fabric authentication completed but no session was established.');
    }
    return toAuthUser(session.user);
  }

  async signOut(): Promise<void> { await this.client.auth.signOut(); }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = this.client.auth.getSession();
    if (!session.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    const session = await sdkInitEmbeddedAuth(this.client.auth, this.fabricOptions);
    if (!session?.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }
}
