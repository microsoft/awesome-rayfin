import { Injectable, inject, signal } from '@angular/core';

import type { AuthUser } from '../../services/IAuthService';

import { AUTH_SERVICE } from './auth.token';

const RESTORE_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

@Injectable({ providedIn: 'root' })
export class AuthState {
  private readonly auth = inject(AUTH_SERVICE);

  readonly user = signal<AuthUser | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  readonly fabricAuthEnabled = this.auth.fabricAuthEnabled;

  /**
   * Best-effort session restore. Resolves once we know whether there is an
   * existing session — never throws, never hangs the app bootstrap.
   *
   * Wrapped in an aggressive timeout so a misbehaving auth provider can't
   * leave the user staring at a blank screen forever.
   */
  async restoreSession(): Promise<void> {
    this.loading.set(true);
    try {
      const embedded = await withTimeout(
        this.auth.initEmbeddedAuth(),
        RESTORE_TIMEOUT_MS,
        'initEmbeddedAuth'
      );
      const current =
        embedded ??
        (await withTimeout(
          this.auth.getCurrentUser(),
          RESTORE_TIMEOUT_MS,
          'getCurrentUser'
        ));
      this.user.set(current);
    } catch (err) {
      if (err instanceof Error) console.warn('restoreSession failed:', err.message);
      this.user.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async signIn(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const user = await this.auth.signIn();
      this.user.set(user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign in.';
      this.error.set(message);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async signOut(): Promise<void> {
    try {
      // Never let a hanging sign-out wedge the UI.
      await withTimeout(this.auth.signOut(), RESTORE_TIMEOUT_MS, 'signOut');
    } catch (err) {
      console.warn('Sign-out error:', err);
    } finally {
      this.user.set(null);
      this.error.set(null);
    }
  }

  isAuthenticated(): boolean {
    return this.user() !== null;
  }
}
