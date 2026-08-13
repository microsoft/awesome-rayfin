import { RayfinClient } from "@microsoft/rayfin-client";
import {
  bridgeFabricCallback,
  ensureSignedInWithFabric,
  initEmbeddedAuth,
  type FabricAuthOptions,
} from "@microsoft/rayfin-auth-provider-fabric";

/**
 * Entra ID sign-in, via the Fabric broker.
 *
 * 🔴 **Be precise about what this protects.** It gates the *application*: nothing renders, no
 * terrain is fetched and no analysis is reachable until a Microsoft Entra identity from this
 * tenant has signed in. It does **not** gate the bytes. Fabric static hosting serves the files
 * themselves without authentication, so anyone holding a direct asset URL can still fetch it —
 * measured, not assumed, on both this app and the sibling wind-farm app it is modelled on:
 * `GET /index.html` returns 200 with no credentials on either. If the requirement is that the
 * *content* is unreachable rather than the *app*, static hosting is the wrong tier and the answer
 * is a gateway that authenticates before serving (App Service / Container Apps with Entra
 * "Easy Auth", or Front Door in front of the origin).
 *
 * What it does buy is real: the URL stops being a working demo for anyone who happens upon it.
 * Everything the app serves is openly licensed geodata, so the exposure that remains is a set of
 * public terrain rasters, not customer material — which is why this tier is a defensible stopping
 * point rather than a fig leaf.
 */

/** The one place the callback path is written down; the SDK defaults to this too. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
}

interface FabricEnv {
  apiUrl: string;
  publishableKey: string;
  workspaceId: string;
  itemId: string;
  portalUrl: string;
  tenantId?: string;
}

/**
 * Read the Rayfin/Fabric configuration `rayfin env` writes into `.env.local`.
 *
 * Returns null when the configuration is absent, which is the normal state of a fresh clone and
 * of a plain `vite` run before `rayfin env` has been executed. ⚠️ Absent config means the gate
 * **cannot** be enforced, and the caller decides what to do about that — see `authRequired`.
 */
function readEnv(): FabricEnv | null {
  const env = import.meta.env;
  const apiUrl = env.VITE_RAYFIN_API_URL as string | undefined;
  const publishableKey = env.VITE_RAYFIN_PUBLISHABLE_KEY as string | undefined;
  const workspaceId = env.VITE_FABRIC_WORKSPACE_ID as string | undefined;
  const itemId = env.VITE_FABRIC_ITEM_ID as string | undefined;
  const portalUrl = env.VITE_FABRIC_PORTAL_URL as string | undefined;
  const tenantId = env.VITE_FABRIC_TENANT_ID as string | undefined;
  if (!apiUrl || !publishableKey || !workspaceId || !itemId || !portalUrl) return null;
  return { apiUrl, publishableKey, workspaceId, itemId, portalUrl, tenantId };
}

/**
 * Pin the broker to a specific tenant.
 *
 * 🔴 Without `ctid` the broker opens the Fabric portal in whatever tenant the browser is already
 * signed into, and asks *that* one for a token. Measured on the first deployed attempt: the
 * handshake completed against `msitpbiabd.powerbi.com` — a different tenant entirely — and died
 * with `TOKEN_ACQUISITION_FAILED`. The app would then have appeared broken to anyone whose browser
 * happened to hold another Microsoft session first, which is most people.
 *
 * The SDK preserves any query string already on the portal URL, so this is the supported way to
 * say which directory is being asked.
 */
function portalUrlForTenant(env: FabricEnv): string {
  if (!env.tenantId) return env.portalUrl;
  const separator = env.portalUrl.includes("?") ? "&" : "?";
  return `${env.portalUrl}${separator}ctid=${encodeURIComponent(env.tenantId)}`;
}

/**
 * Is this a build that must be signed into?
 *
 * 🔴 **Fails closed everywhere except a local dev server.** A deployed build with missing config
 * refuses to render rather than quietly serving itself to everyone — a gate that disappears when
 * its configuration does is not a gate. Localhost is exempt so `npm run dev` still works on a
 * fresh clone with no Fabric project attached.
 */
export function authRequired(): boolean {
  const host = window.location.hostname;
  return !(host === "localhost" || host === "127.0.0.1");
}

let client: RayfinClient<Record<string, never>> | null = null;
let options: FabricAuthOptions | null = null;

function ensureClient(): { client: RayfinClient<Record<string, never>>;
                           options: FabricAuthOptions } | null {
  const env = readEnv();
  if (!env) return null;
  if (!client) {
    client = new RayfinClient<Record<string, never>>({
      baseUrl: env.apiUrl.endsWith("/") ? env.apiUrl : `${env.apiUrl}/`,
      publishableKey: env.publishableKey,
      useProxy: false,
      authStorage: true,
    });
    options = {
      workspaceId: env.workspaceId,
      projectId: env.itemId,
      fabricPortalUrl: portalUrlForTenant(env),
      returnOrigin: window.location.origin,
    };
  }
  return { client: client!, options: options! };
}

/** True when the configuration needed to sign in is present. */
export function authConfigured(): boolean {
  return readEnv() !== null;
}

/** The broker URL this build will use, tenant included. Exposed so a test can pin it. */
export function brokerPortalUrl(): string | null {
  const env = readEnv();
  return env ? portalUrlForTenant(env) : null;
}

function toUser(session: { user?: { id: string; email: string; name?: string } | null }):
  SignedInUser | null {
  const user = session.user;
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name || user.email.split("@")[0] };
}

/** The session already in hand, if any. Never opens a window. */
export function currentUser(): SignedInUser | null {
  const bundle = ensureClient();
  if (!bundle) return null;
  const session = bundle.client.auth.getSession();
  return session.isAuthenticated ? toUser(session) : null;
}

/**
 * Try to establish a session without any interaction.
 *
 * Covers the two cases where a prompt would be wrong: an existing/refreshable session, and the
 * app running embedded in a Fabric iframe, where the host hands a token over by postMessage.
 */
export async function trySilentSignIn(): Promise<SignedInUser | null> {
  const bundle = ensureClient();
  if (!bundle) return null;
  try {
    const embedded = await initEmbeddedAuth(bundle.client.auth, bundle.options);
    if (embedded?.isAuthenticated) return toUser(embedded);
  } catch {
    // Not embedded, or the host declined. Fall through to the stored session.
  }
  return currentUser();
}

/**
 * Interactive sign-in.
 *
 * ⚠️ Opens the Fabric broker in a new tab, so it **must** be called straight from a click
 * handler; anything asynchronous before it and the browser blocks the window.
 */
export async function signIn(): Promise<SignedInUser> {
  const bundle = ensureClient();
  if (!bundle) throw new Error("Fabric configuration is missing — run `rayfin env`.");
  const session = await ensureSignedInWithFabric(bundle.client.auth, bundle.options);
  const user = session.isAuthenticated ? toUser(session) : null;
  if (!user) throw new Error("Sign-in completed but no session was established.");
  return user;
}

export async function signOut(): Promise<void> {
  const bundle = ensureClient();
  if (!bundle) return;
  await bundle.client.auth.signOut();
}

/**
 * Handle the broker's callback tab.
 *
 * 🔴 Returns true when this page load *is* the callback, and the caller must then render nothing
 * else. The callback lands on this same origin, and static hosting answers every path with
 * `index.html` — so without this check the callback tab would boot the whole application and
 * download ninety megabytes of terrain just to hand back a token and close itself.
 */
export function handleCallbackTab(): boolean {
  if (!window.location.pathname.endsWith(AUTH_CALLBACK_PATH)) return false;
  bridgeFabricCallback();
  return true;
}
