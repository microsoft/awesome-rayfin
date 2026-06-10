import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { AppConfigService } from './services/app-config.service';
import { AuthState } from './services/auth-state';

// Generous timeout: Fabric cold-starts on the GraphQL/DAB path can take
// 15–25 s. Anything longer than 45 s is almost certainly a real hang.
const LOAD_TIMEOUT_MS = 45000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    p.then(
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

/**
 * Redirects between `/setup` and `/` based on the effective sync mode:
 * - `pending`  → must be on `/setup`
 * - `scratch`/`github` → must NOT be on `/setup`
 *
 * Loads the AppConfig singleton once if not yet loaded. Runs after `authGuard`.
 *
 * Wrapped in a long timeout so a misbehaving backend can't hang the UI
 * forever. On failure we log the real GraphQL error, sign the user out,
 * and route to `/auth` (which will surface the error so the user knows
 * to redeploy / check connectivity rather than just looping).
 */
export const setupGuard: CanActivateFn = async (route) => {
  const appConfig = inject(AppConfigService);
  const authState = inject(AuthState);
  const router = inject(Router);
  try {
    await withTimeout(appConfig.load(), LOAD_TIMEOUT_MS, 'AppConfig.load');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[setupGuard] AppConfig load failed:', message);
    const hint = message.includes('GraphQL errors')
      ? `${message}\n\nTip: the schema may not be deployed to your Fabric backend. Run \`npx rayfin up\` and refresh.`
      : message;
    authState.error.set(hint);
    await authState.signOut();
    return router.createUrlTree(['/auth']);
  }
  const onSetupPage = route.routeConfig?.path === 'setup';
  const mode = appConfig.mode();
  if (mode === 'pending' && !onSetupPage) {
    return router.createUrlTree(['/setup']);
  }
  if (mode !== 'pending' && onSetupPage) {
    return router.createUrlTree(['/']);
  }
  return true;
};
