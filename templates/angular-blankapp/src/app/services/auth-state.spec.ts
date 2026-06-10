import { TestBed } from '@angular/core/testing';

import type { IAuthService } from '../../services/IAuthService';

import { AuthState } from './auth-state';
import { AUTH_SERVICE } from './auth.token';

function stubAuthService(): IAuthService {
  return {
    fabricAuthEnabled: false,
    async signIn() {
      return { id: 'u1', email: 'dev@contoso.com', name: 'dev' };
    },
    async signOut() {},
    async getCurrentUser() {
      return null;
    },
    async initEmbeddedAuth() {
      return null;
    },
  };
}

describe('AuthState', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_SERVICE, useValue: stubAuthService() }],
    });
  });

  it('starts in a loading, unauthenticated state', () => {
    const authState = TestBed.inject(AuthState);
    expect(authState.user()).toBeNull();
    expect(authState.loading()).toBeTrue();
    expect(authState.isAuthenticated()).toBeFalse();
  });

  it('reflects user after sign-in and clears it on sign-out', async () => {
    const authState = TestBed.inject(AuthState);
    await authState.signIn();
    expect(authState.user()?.email).toBe('dev@contoso.com');
    expect(authState.isAuthenticated()).toBeTrue();

    await authState.signOut();
    expect(authState.user()).toBeNull();
    expect(authState.isAuthenticated()).toBeFalse();
  });
});
