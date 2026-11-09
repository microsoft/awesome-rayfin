import { type AuthUser, type IAuthService } from '@/services/IAuthService';

import { MOCK_SESSION_USER, readMockPersona } from './mock';

/**
 * App session for the offline demo (`VITE_UM_MOCK=true`): already signed in
 * as the fixture persona, no backend involved. Never used in a deployment.
 */
export class OfflineAuthService implements IAuthService {
  readonly fabricAuthEnabled = false;
  private user: AuthUser | null;

  constructor(search = typeof window !== 'undefined' ? window.location.search : '') {
    this.user = MOCK_SESSION_USER(readMockPersona(search));
  }

  async signIn(): Promise<AuthUser> {
    this.user = this.user ?? MOCK_SESSION_USER('admin');
    return this.user;
  }

  async signOut(): Promise<void> {
    this.user = null;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.user;
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    return null;
  }
}
