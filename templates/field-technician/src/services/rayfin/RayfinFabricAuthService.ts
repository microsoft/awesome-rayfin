import { AuthUser, IFabricAuthService } from '../interfaces/IAuthService';

import { getRayfinClient } from './RayfinClientService';

export interface FabricAuthConfig {
  workspaceId: string;
  projectId: string;
  fabricPortalUrl: string;
}

export class RayfinFabricAuthService implements IFabricAuthService {
  private readonly config: FabricAuthConfig;

  constructor(config: FabricAuthConfig) {
    this.config = config;
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    const { initEmbeddedAuth: sdkInitEmbeddedAuth } =
      await import('@microsoft/rayfin-auth-provider-fabric');

    const client = getRayfinClient();

    const session = await sdkInitEmbeddedAuth(client.auth, {
      workspaceId: this.config.workspaceId,
      projectId: this.config.projectId,
      fabricPortalUrl: this.config.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });

    if (!session?.isAuthenticated || !session.user) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.email.split('@')[0],
    };
  }

  async initiateFabricLogin(): Promise<void> {
    const { initiateFabricLogin: sdkInitiateFabricLogin } =
      await import('@microsoft/rayfin-auth-provider-fabric');

    const client = getRayfinClient();

    await sdkInitiateFabricLogin(client.auth, {
      workspaceId: this.config.workspaceId,
      projectId: this.config.projectId,
      fabricPortalUrl: this.config.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });
  }

  async ensureSignedInWithFabric(): Promise<AuthUser> {
    const { ensureSignedInWithFabric: sdkEnsureSignedIn } =
      await import('@microsoft/rayfin-auth-provider-fabric');

    const client = getRayfinClient();

    const session = await sdkEnsureSignedIn(client.auth, {
      workspaceId: this.config.workspaceId,
      projectId: this.config.projectId,
      fabricPortalUrl: this.config.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });

    if (!session.isAuthenticated || !session.user) {
      throw new Error(
        'Fabric authentication completed but no session was established.'
      );
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.email.split('@')[0],
    };
  }
}
