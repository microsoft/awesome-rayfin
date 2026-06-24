/**
 * MSAL helper that acquires a Power BI service token for the signed-in user.
 *
 * The same token is used to (a) authenticate the Fabric User Data Functions
 * invocation (Authorization header — requires the `UserDataFunction.Execute.All`
 * delegated permission) and (b) call the Fabric REST API from inside the
 * function (passed in the request body as `fabric_token`).
 *
 * Scope `https://analysis.windows.net/powerbi/api/.default` yields a Power BI
 * service token that the Fabric REST endpoints under api.fabric.microsoft.com
 * also accept, so a single token covers both hops — no service principal.
 */
import {
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';

import { getUdfConfig } from '@/config/udfConfig';

const PBI_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';

/**
 * Storage-audience scope. OneLake's DFS endpoint only accepts tokens in the
 * `Storage` audience (the Power BI token above is rejected), so the team-shared
 * guideline-conventions read/write acquires this scope separately. Requires the
 * SPA app registration to be granted the Azure Storage `user_impersonation`
 * delegated permission (one-time admin consent).
 */
const STORAGE_SCOPE = 'https://storage.azure.com/.default';

/**
 * Thrown when a Power BI token cannot be obtained silently and an interactive
 * sign-in is required. Interactive sign-in opens a popup, which browsers block
 * unless it is started from a user gesture — and which is also blocked inside
 * the Fabric portal iframe when triggered automatically. Callers should catch
 * this and surface a "Sign in to Power BI" button that calls
 * {@link signInToPbi} from the click handler.
 */
export class PbiSignInRequiredError extends Error {
  constructor() {
    super('Power BI sign-in required');
    this.name = 'PbiSignInRequiredError';
  }
}

let pcaPromise: Promise<PublicClientApplication> | null = null;
let account: AccountInfo | null = null;

async function getPca(): Promise<PublicClientApplication> {
  if (!pcaPromise) {
    const { tenantId, clientId } = getUdfConfig();
    const pca = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    pcaPromise = pca.initialize().then(() => {
      const accounts = pca.getAllAccounts();
      if (accounts.length > 0) account = accounts[0];
      return pca;
    });
  }
  return pcaPromise;
}

/**
 * Acquire a Power BI service access token.
 *
 * Silent by default: refreshes from the cached account and throws
 * {@link PbiSignInRequiredError} when an interactive prompt would be needed.
 * Pass `{ interactive: true }` ONLY from a user-gesture handler (button click)
 * — see {@link signInToPbi}.
 */
export async function getFabricToken(
  opts: { interactive?: boolean; loginHint?: string } = {}
): Promise<string> {
  const pca = await getPca();
  const request = { scopes: [PBI_SCOPE], account: account ?? undefined };

  try {
    const result = await pca.acquireTokenSilent(request);
    account = result.account;
    return result.accessToken;
  } catch {
    if (!opts.interactive) throw new PbiSignInRequiredError();
    const result = await pca.acquireTokenPopup({
      scopes: [PBI_SCOPE],
      loginHint: opts.loginHint,
      // Always let the user pick: the Fabric portal identity (which owns the
      // workspace permissions) often differs from other signed-in accounts,
      // and the wrong one yields a 401 when invoking the function.
      prompt: 'select_account',
    });
    account = result.account;
    return result.accessToken;
  }
}

/**
 * Start an interactive Power BI sign-in. MUST be called from a user-gesture
 * handler (e.g. a button click) so the auth popup is not blocked — this is the
 * only reliable interactive path when the app is embedded in the Fabric portal
 * iframe (AAD cannot be loaded via a same-frame redirect).
 *
 * `loginHint` should be the Fabric portal account email so the correct
 * (permissioned) identity is pre-selected.
 */
export async function signInToPbi(loginHint?: string): Promise<void> {
  await getFabricToken({ interactive: true, loginHint });
}

/**
 * Acquire a Storage-audience access token for OneLake DFS calls.
 *
 * Same pattern as {@link getFabricToken}: silent by default (throws
 * {@link PbiSignInRequiredError} when an interactive consent would be needed),
 * and an interactive popup fallback that MUST be triggered from a user gesture.
 * The first acquisition needs the Azure Storage delegated permission consented
 * on the SPA app registration.
 */
export async function getStorageToken(
  opts: { interactive?: boolean; loginHint?: string } = {}
): Promise<string> {
  const pca = await getPca();
  const request = { scopes: [STORAGE_SCOPE], account: account ?? undefined };

  try {
    const result = await pca.acquireTokenSilent(request);
    account = result.account;
    return result.accessToken;
  } catch {
    if (!opts.interactive) throw new PbiSignInRequiredError();
    const result = await pca.acquireTokenPopup({
      scopes: [STORAGE_SCOPE],
      loginHint: opts.loginHint,
      prompt: 'select_account',
    });
    account = result.account;
    return result.accessToken;
  }
}
