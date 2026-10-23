/**
 * Sign-in to Microsoft Graph for the Fabric User Manager.
 *
 * Its own sign-in, separate from the Rayfin one:
 *
 * - no dependency on the shared proxy configuration,
 * - tokens live in session storage, not local storage,
 * - the account is chosen by login hint from the app session instead of
 *   "whichever account is cached first",
 * - scopes are requested per need, never all at once,
 * - **one account per tab**: the first token pins its account, and every
 *   later token must belong to that same account or it is thrown away.
 *
 * The pin is what keeps the acting identity (Graph `/me`, read once) and the
 * tokens used afterwards from drifting apart: without it a person could pick
 * a second account in a later popup and act as one person while the app shows
 * and logs another.
 *
 * A deployment gives it its own app registration (`VITE_UM_CLIENT_ID`), so the
 * permissions consented here are not on the Rayfin sign-in registration. Without
 * that value it falls back to the Rayfin one.
 *
 * All sets are read-only except `memberChange`, which is requested only at
 * the moment a person starts a member change.
 */
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

import { getUmEnv, missingForGraph } from '@/um/config/umEnv';

const GRAPH = 'https://graph.microsoft.com/';
const FABRIC = 'https://api.fabric.microsoft.com/';

export const SCOPE_SETS = {
  /** Own profile, own memberships, own owned groups, app admin check. */
  base: [`${GRAPH}User.Read`],
  /** Group properties, owners and members; resolving users. Owners and admins only. */
  directory: [`${GRAPH}GroupMember.Read.All`, `${GRAPH}User.ReadBasic.All`],
  /** Workspaces, their role assignments and their items. App admins, for discovery. */
  fabric: [`${FABRIC}Workspace.Read.All`],
  /** Who an item is shared with. Works only for a Fabric administrator. */
  fabricAdmin: [`${FABRIC}Tenant.Read.All`],
  /**
   * Changing members: the membership write permission, plus the user read
   * that tells a guest or a disabled account from an ordinary one. One set,
   * so one sign-in window, asked for only when someone starts a change.
   */
  memberChange: [`${GRAPH}GroupMember.ReadWrite.All`, `${GRAPH}User.Read.All`],
  /** Changing which group holds which workspace role. App admins, at the moment of the change. */
  fabricWrite: [`${FABRIC}Workspace.ReadWrite.All`],
  /** Sending the request notice from the requester's own mailbox. */
  mail: [`${GRAPH}Mail.Send`],
  /**
   * Creating a security group. Graph has no narrower delegated permission for
   * it. App admins, at the moment a group is created.
   */
  groupCreate: [`${GRAPH}Group.ReadWrite.All`],
} as const;
export type ScopeSet = keyof typeof SCOPE_SETS;

/** A token needs a user gesture (popup). Callers show a button. */
export class GraphSignInRequiredError extends Error {
  constructor(readonly scopeSet: ScopeSet) {
    super('Graph sign-in required');
    this.name = 'GraphSignInRequiredError';
  }
}

/** Build values are missing. Reported to the operator, never thrown at a user. */
export class GraphNotConfiguredError extends Error {
  constructor(readonly missing: string[]) {
    super(`Graph sign-in is not configured: ${missing.join(', ')}`);
    this.name = 'GraphNotConfiguredError';
  }
}

/** A token came back for a different account than the one this tab acts as. It was discarded. */
export class GraphAccountMismatchError extends Error {
  constructor() {
    super('The Microsoft account differs from the one this tab is acting as.');
    this.name = 'GraphAccountMismatchError';
  }
}

let pcaPromise: Promise<PublicClientApplication> | null = null;
/** The one account of this tab, pinned by the first successful token. */
let pinned: AccountInfo | null = null;

async function getPca(): Promise<PublicClientApplication> {
  const env = getUmEnv();
  const missing = missingForGraph(env);
  if (missing.length > 0) throw new GraphNotConfiguredError(missing);

  if (!pcaPromise) {
    const pca = new PublicClientApplication({
      auth: {
        clientId: env.clientId!,
        authority: `https://login.microsoftonline.com/${env.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    pcaPromise = pca.initialize().then(() => pca);
  }
  return pcaPromise;
}

function sameAccount(a: AccountInfo, b: AccountInfo): boolean {
  return !!a.localAccountId && a.localAccountId.toLowerCase() === b.localAccountId.toLowerCase() && a.tenantId === b.tenantId;
}

/** The cached account for the hint. Never "the first cached account". */
function accountForHint(pca: PublicClientApplication, loginHint?: string): AccountInfo | null {
  const hint = loginHint?.trim().toLowerCase();
  if (!hint) return null;
  return pca.getAllAccounts().find((a) => a.username.toLowerCase() === hint) ?? null;
}

/** Accept a token only for the pinned account; the first one sets the pin. */
function accept(result: { account: AccountInfo | null; accessToken: string }): string {
  if (!result.account) throw new GraphAccountMismatchError();
  if (pinned && !sameAccount(pinned, result.account)) throw new GraphAccountMismatchError();
  pinned = result.account;
  return result.accessToken;
}

export interface TokenOptions {
  /** Pass `true` only from a click handler; popups are blocked otherwise. */
  interactive?: boolean;
  /** The app session's e-mail. Pre-selects the account, proves nothing. */
  loginHint?: string;
}

export async function getGraphToken(scopeSet: ScopeSet, options: TokenOptions = {}): Promise<string> {
  const pca = await getPca();
  const scopes = [...SCOPE_SETS[scopeSet]];
  const known = pinned ?? accountForHint(pca, options.loginHint);

  if (known) {
    let silent: Awaited<ReturnType<PublicClientApplication['acquireTokenSilent']>> | null = null;
    try {
      silent = await pca.acquireTokenSilent({ scopes, account: known });
    } catch {
      /* fall through to the interactive path */
    }
    // Outside the try on purpose: a mismatch must not turn into a popup.
    if (silent) return accept(silent);
  }

  if (!options.interactive) throw new GraphSignInRequiredError(scopeSet);
  // Once pinned, the popup is asked for that account. The person can still
  // pick another one in the dialog, so the result is checked either way.
  const result = await pca.acquireTokenPopup(pinned ? { scopes, account: pinned } : { scopes, loginHint: options.loginHint });
  return accept(result);
}

export type Probe = 'held' | 'not-held' | 'unknown';

/**
 * Is a token for this set available without a sign-in window? Never opens
 * one. "Not held" only when Entra said that interaction is needed; anything
 * else (no account yet, another account, no network, no configuration) is
 * "unknown", so that a failed look is not shown as a missing permission.
 */
export async function probeGraphToken(scopeSet: ScopeSet, options: Pick<TokenOptions, 'loginHint'> = {}): Promise<Probe> {
  try {
    const pca = await getPca();
    const known = pinned ?? accountForHint(pca, options.loginHint);
    if (!known) return 'unknown';
    accept(await pca.acquireTokenSilent({ scopes: [...SCOPE_SETS[scopeSet]], account: known }));
    return 'held';
  } catch (error) {
    return error instanceof InteractionRequiredAuthError ? 'not-held' : 'unknown';
  }
}

export type GrantFailure = 'closed' | 'denied' | 'other';

/**
 * Why asking for a permission did not end with a token. Entra's answer does
 * not say whether an administrator is needed: declining a consent page and
 * leaving the "administrator approval required" page both come back as
 * "access denied". A closed or blocked window can be told apart.
 */
export function grantFailureOf(error: unknown): GrantFailure {
  const code = typeof error === 'object' && error !== null && 'errorCode' in error ? String((error as { errorCode: unknown }).errorCode) : '';
  if (['user_cancelled', 'popup_window_error', 'empty_window_error', 'monitor_window_timeout', 'monitor_popup_timeout'].includes(code)) return 'closed';
  if (['access_denied', 'consent_required', 'interaction_required'].includes(code)) return 'denied';
  return 'other';
}

/** Entra object id of the account this tab acts as, once a token was accepted. */
export function getPinnedObjectId(): string | null {
  return pinned?.localAccountId?.toLowerCase() ?? null;
}

/** Forget the account of this tab: on sign-out and before a deliberate reconnect. */
export function resetGraphAccount(): void {
  pinned = null;
}
