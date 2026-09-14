import {
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type IPublicClientApplication,
} from '@azure/msal-browser';

/**
 * Direct Power BI `executeQueries` access.
 *
 * The Rayfin `fabric-semanticmodel` connector is the intended data path, but the service-side
 * feature is not enabled everywhere yet ("ConnectorFunction invocation is not enabled for this
 * workspace"). This module is the fallback: acquire a delegated Power BI token with MSAL and call
 * the REST API straight from the browser. Power BI sends CORS headers, so no proxy is needed - and
 * unlike a function proxy there is no response-size ceiling, which matters because the live layer
 * returns ~1000 rows every couple of seconds.
 */

/**
 * Configure these in `.env.local` - see `.env.example`. They are only needed for the standalone
 * sign-in path; embedded in the Fabric portal the app uses the host bridge and acquires no token
 * of its own, so a deployment that only ever runs in the portal can leave them unset.
 */
const CLIENT_ID = (import.meta.env.VITE_PBI_CLIENT_ID as string | undefined) ?? '';
const TENANT_ID = (import.meta.env.VITE_PBI_TENANT_ID as string | undefined) ?? 'common';
const DATASET_ID = (import.meta.env.VITE_PBI_DATASET_ID as string | undefined) ?? '';

const SCOPES = ['https://analysis.windows.net/powerbi/api/.default'];

/**
 * True when the app is running inside the Fabric portal's iframe rather than standing alone.
 *
 * ⚠️ This decides whether an interactive sign-in is possible AT ALL.
 * - `acquireTokenRedirect` throws `redirect_in_iframe` - navigating the frame would destroy the
 *   host page.
 * - `acquireTokenPopup` *appears* viable but cannot work either: the portal frame is sandboxed
 *   with **`allow-popups-to-escape-sandbox`**, so the popup becomes a normal top-level context.
 *   Its storage partition - and therefore MSAL's BroadcastChannel response and token cache - is
 *   not the one the framed app is listening on. Measured: the popup completed and closed, and
 *   `acquireTokenPopup` never settled. The button sat on "Connecting..." for ever.
 *
 * So embedded cannot sign in; it has to be done in the app's own tab.
 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access throws, which itself means we are framed.
    return true;
  }
}

let msalPromise: Promise<IPublicClientApplication> | null = null;
/** Result of a sign-in the user was redirected back from, consumed once on the next load. */
let redirectResult: AuthenticationResult | null = null;

function getMsal(): Promise<IPublicClientApplication> {
  msalPromise ??= (async () => {
    const app = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
      system: {
        // MSAL waits for the popup's response over a BroadcastChannel and gives up after 60 s by
        // default. A two-step account chooser plus MFA can easily outlast that, and the failure
        // reads as `timed_out` *after* a successful sign-in, which is thoroughly confusing.
        popupBridgeTimeout: 180_000,
      },
    });
    await app.initialize();
    // Must run before any other MSAL call. In the *opened popup* this is also what publishes the
    // response back to the opener, so it has to run on every page load - see initPowerBiAuth().
    redirectResult = await app.handleRedirectPromise();
    return app;
  })();
  return msalPromise;
}

/**
 * Complete any MSAL handshake as early as possible on every page load.
 *
 * ⚠️ THIS IS WHAT MAKES THE POPUP FLOW WORK. MSAL v5 hands the popup's result to the opener over
 * a BroadcastChannel, and only `handleRedirectPromise()` running *inside the popup* posts it. The
 * popup loads this same app, so unless something calls into MSAL immediately the message is never
 * sent, the opener waits out `popupBridgeTimeout`, and the popup sits there on a blank page while
 * the app shows "Connecting..." for ever.
 *
 * (A script-less redirect page cannot work for the same reason - v5 does not poll the popup URL.)
 */
export function initPowerBiAuth(): void {
  void getMsal().catch(() => {
    /* surfaced later by acquirePowerBiToken; never block app start on it */
  });
}

/**
 * Prefer an account homed in the target tenant, but accept any signed-in account.
 *
 * ⚠️ Do NOT try to exclude B2B guests. Measured against this very model: a guest
 * (a corporate account homed in another tenant, `idp` claim pointing at its home tenant) got
 * **HTTP 200 and byte-identical
 * results** to the tenant-native account. Guests with workspace access read semantic models
 * perfectly well, so refusing them only breaks legitimate users. Two earlier attempts here were
 * wrong in different ways: `account.tenantId` cannot identify a guest (a tenant-specific authority
 * makes a guest's token claim `tid` = that tenant), and a `#EXT#` UPN test never fires for such an
 * account either - its UPN is simply its home-tenant address.
 */
function pickAccount(app: IPublicClientApplication): AccountInfo | null {
  const accounts = app.getAllAccounts();
  return accounts.find((a) => a.tenantId === TENANT_ID) ?? accounts[0] ?? null;
}

/**
 * Acquire a Power BI token.
 *
 * @param interactive - when false, only silent acquisition is attempted (safe on page load).
 */
/**
 * Acquire a Power BI token.
 *
 * @param interactive - when false, only cached/silent acquisition is attempted (safe on load).
 *   When true and running top-level this NAVIGATES AWAY and never resolves. Embedded it throws,
 *   because no interactive flow can complete inside the portal frame - see {@link isEmbedded}.
 * @param forceAccountPicker - ask AAD to show the account chooser.
 *
 * ⚠️ DO NOT pass `prompt: 'select_account'` by default. It forces a **full re-authentication**,
 * so the user is asked for a password even though the browser already holds a valid session for
 * this tenant - measured on two separate browser profiles that were already signed in. Without it
 * the existing session cookie satisfies the request silently. The picker is only worth the friction
 * when the account we land on turns out to be unusable (a guest), and then the user asks for it.
 */
export async function acquirePowerBiToken(
  interactive: boolean,
  forceAccountPicker = false,
): Promise<string | null> {
  const app = await getMsal();

  // Returning from a redirect sign-in: the token is already in hand.
  if (redirectResult?.accessToken) {
    const token = redirectResult.accessToken;
    redirectResult = null;
    return token;
  }

  const account = pickAccount(app);

  if (account) {
    try {
      const result = await app.acquireTokenSilent({ scopes: SCOPES, account });
      return result.accessToken;
    } catch {
      /* fall through */
    }
  }

  // No cached account, but the browser may still have a session for this tenant. ssoSilent rides
  // that cookie in a hidden iframe, so a signed-in user never sees a sign-in screen at all.
  if (!account) {
    try {
      const result = await app.ssoSilent({ scopes: SCOPES });
      return result.accessToken;
    } catch {
      /* expected when there is no session, or third-party cookies are blocked */
    }
  }

  if (!interactive) return null;

  if (isEmbedded()) {
    // See isEmbedded(): neither redirect nor popup can complete inside the portal frame.
    throw new Error(
      'Sign-in cannot be completed inside the Fabric portal. Open the app in its own tab.',
    );
  }

  await app.acquireTokenRedirect({
    scopes: SCOPES,
    ...(forceAccountPicker ? { prompt: 'select_account' as const } : {}),
  });
  return null; // unreachable: the line above navigates away
}

export function hasPowerBiSession(): boolean {
  // Cheap synchronous probe used to decide whether to bother with a silent attempt.
  return Object.keys(sessionStorage).some((k) => k.includes('login.windows.net') || k.includes('msal'));
}

export interface DaxResponse {
  rows: Array<Record<string, unknown>>;
}

/** Run a DAX query against the semantic model with a delegated user token. */
export async function executeQueriesDirect(query: string, token: string): Promise<DaxResponse> {
  const response = await fetch(
    `https://api.powerbi.com/v1.0/myorg/datasets/${DATASET_ID}/executeQueries`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        queries: [{ query }],
        serializerSettings: { includeNulls: true },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Power BI executeQueries failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  return { rows: payload?.results?.[0]?.tables?.[0]?.rows ?? [] };
}

export async function signOutPowerBi(): Promise<void> {
  const app = await getMsal();
  const account = pickAccount(app);
  if (account) await app.clearCache({ account });
}
