// GitHub device-flow sign-in for the Translations tab.
//
// Mirrors the Developer Hub experience: the user starts the flow, a short
// user-code + verification URL is shown, they authorise in a github.com tab,
// and we poll until a GitHub token is issued. All GitHub calls run server-side
// in the UDF (github.com / api.githubcopilot.com have no browser CORS); this
// module only orchestrates the start → open → poll loop and caches the
// resulting token so the user does not have to sign in again every session.

import { udf, type GithubDeviceStart } from './udfClient';

const STORAGE_KEY = 'pbi-fixer.githubToken';

let cachedToken: string | null = null;

/** The GitHub token held this session (memory first, then localStorage). */
export function getGithubToken(): string | null {
  if (cachedToken) return cachedToken;
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t) cachedToken = t;
  } catch {
    /* localStorage may be unavailable inside the Fabric iframe */
  }
  return cachedToken;
}

export function isGithubSignedIn(): boolean {
  return !!getGithubToken();
}

function setGithubToken(token: string): void {
  cachedToken = token;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* ignore */
  }
}

export function signOutGithub(): void {
  cachedToken = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface DeviceFlowHandle extends GithubDeviceStart {
  /** Resolves with the GitHub token once the user authorises, rejects on
   *  timeout / denial / explicit cancel. */
  completion: Promise<string>;
  /** Abort an in-progress flow (stops polling). */
  cancel: () => void;
}

/**
 * Begin a GitHub device-flow sign-in. Returns the user-facing code + URL
 * immediately, plus a `completion` promise that resolves with the token once
 * the user authorises. The caller shows `userCode` / `verificationUri` and may
 * open the URL in a new tab.
 */
export async function startGithubDeviceFlow(): Promise<DeviceFlowHandle> {
  const start = await udf.githubDeviceStart();

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  const completion = new Promise<string>((resolve, reject) => {
    const intervalMs = Math.max(2, start.interval) * 1000;
    const deadline = Date.now() + Math.max(60, start.expiresIn) * 1000;

    const poll = async () => {
      if (cancelled) {
        reject(new Error('Sign-in cancelled.'));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('Sign-in timed out — please try again.'));
        return;
      }
      try {
        const res = await udf.githubDevicePoll(start.deviceCode);
        if (res.status === 'authorized' && res.accessToken) {
          setGithubToken(res.accessToken);
          resolve(res.accessToken);
          return;
        }
        if (res.status === 'error' && res.error !== 'authorization_pending') {
          // `slow_down` is reported with status "pending"; a real error here
          // (access_denied, expired_token, …) stops the flow.
          reject(new Error(`GitHub sign-in failed: ${res.error}`));
          return;
        }
        // pending / slow_down → keep polling. Back off a little on slow_down.
        const wait = res.error === 'slow_down' ? intervalMs + 5000 : intervalMs;
        setTimeout(poll, wait);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    setTimeout(poll, intervalMs);
  });

  return { ...start, completion, cancel };
}
