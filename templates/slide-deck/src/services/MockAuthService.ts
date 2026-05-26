import { AuthError, type RayfinClient } from '@microsoft/rayfin-client';
import type { SlideDeckSchema } from '../../rayfin/data/schema';
import { type AuthUser, type IAuthService, toAuthUser } from './IAuthService';

const MOCK_EMAIL = 'dev@contoso.com';
const MOCK_PASSWORD = 'LocalDev!Pass123';

export class MockAuthService implements IAuthService {
  readonly fabricAuthEnabled = false;
  constructor(private readonly client: RayfinClient<SlideDeckSchema>) {}

  async signIn(): Promise<AuthUser> {
    const auth = this.client.auth;
    try {
      await auth.signIn({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
    } catch (err) {
      if (!(err instanceof AuthError) || err.code !== 'INVALID_GRANT') throw err;
      await auth.signUp({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
      await auth.signIn({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
    }
    const session = auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Local mock sign-in failed to establish a session.');
    }
    return toAuthUser(session.user);
  }

  async signOut(): Promise<void> { await this.client.auth.signOut(); }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = this.client.auth.getSession();
    if (!session.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> { return null; }
}
