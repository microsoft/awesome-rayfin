import type { DaxRow } from '@/data/model';

/**
 * DAX over the Fabric portal's postMessage bridge - how a Fabric App reads a semantic model while
 * embedded in the portal, with **no sign-in of its own**.
 *
 * Why this exists
 * ---------------
 * Inside the portal iframe an interactive MSAL sign-in cannot complete: a redirect cannot render
 * (AAD sends `X-Frame-Options: DENY`) and a popup lands in a different storage partition, so
 * MSAL's response never arrives. That is a browser/AAD constraint, not something an app can code
 * around.
 *
 * The portal solves it host-side instead: its app-backend extension registers a
 * `SemanticModelPlugin` that runs the DAX **as the portal's already-signed-in user** and posts the
 * result back. So while embedded the app needs no token at all.
 *
 * This transport is modelled on the shipped reference app in the MSIT tenant
 * (`appbackends/4939b9e8-…`), which uses exactly this channel - and neither a Rayfin connector nor
 * MSAL. The published `@microsoft/fabric-app-data` package provides the *client* half of this
 * (`FabricClient` / `SemanticModelClient`) but requires the caller to supply the
 * `IFabricApiProxy` transport, which is what this module is.
 *
 * Protocol
 * --------
 *   channel : 'fabric-app-data-semantic-model'
 *   method  : 'semanticModel.executeDaxJson'  -> Power BI `executeQueries` JSON
 *             'semanticModel.executeDax'      -> Arrow IPC buffer (not used here)
 *   payload : { workspaceId, modelId, query } - GUIDs, or 'me' for the workspace
 *
 * ⚠️ The host reads `method` off the **envelope**, not out of `payload`, and
 * `sendBridgeRequest()` from `@microsoft/fabric-embedded-host` sends no `method` field (it only
 * knows the auth channel's `kind` discriminator). So the envelope is built here instead.
 */

const CHANNEL = 'fabric-app-data-semantic-model';
const METHOD_JSON = 'semanticModel.executeDaxJson';
const TIMEOUT_MS = 30_000;

/** Thrown when the host bridge is unavailable, times out, or the host rejects the request. */
export class HostBridgeError extends Error {
  readonly code: string;

  constructor(message: string, code = 'BRIDGE_ERROR') {
    super(message);
    this.name = 'HostBridgeError';
    this.code = code;
  }
}

/** True when this page is running inside a Fabric host frame. */
export function hasFabricHost(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

interface HostResponse {
  channel?: string;
  requestId?: string;
  kind?: string;
  success?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

interface Pending {
  channel: string;
  resolve: (value: unknown) => void;
  reject: (reason: HostBridgeError) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * One listener and one pending-request map for the whole page, rather than an
 * `addEventListener`/`removeEventListener` pair per call. At a 2 s poll across several queries the
 * per-call variant churns listeners constantly; this also mirrors the reference implementation.
 */
class HostTransport {
  private readonly pending = new Map<string, Pending>();
  private hostOrigin: string | null = null;
  private listening = false;

  send(channel: string, method: string, payload: unknown): Promise<unknown> {
    const host = typeof window === 'undefined' ? null : window.parent;
    if (!host || host === window) {
      return Promise.reject(
        new HostBridgeError('Not running inside a Fabric frame.', 'NOT_IN_FABRIC'),
      );
    }

    if (!this.listening) {
      window.addEventListener('message', this.handleMessage);
      this.listening = true;
    }

    const requestId = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new HostBridgeError(`Fabric host did not respond in ${TIMEOUT_MS}ms.`, 'BRIDGE_TIMEOUT'),
        );
      }, TIMEOUT_MS);
      this.pending.set(requestId, { channel, resolve, reject, timeoutId });
    });

    // The first message must go to '*': a cross-origin frame cannot read `parent.origin`. The
    // payload holds no secret (ids and a DAX string). Once the host has answered once its origin
    // is known, and every later message and reply is pinned to it.
    try {
      host.postMessage(
        { channel, version: 1, kind: 'request', method, requestId, payload },
        this.hostOrigin ?? '*',
      );
    } catch (error) {
      const entry = this.pending.get(requestId);
      if (entry) {
        this.pending.delete(requestId);
        clearTimeout(entry.timeoutId);
        entry.reject(
          new HostBridgeError(`Failed to post to the Fabric host: ${error}`, 'POST_MESSAGE_FAILED'),
        );
      }
    }

    return result;
  }

  private readonly handleMessage = (event: MessageEvent) => {
    // Only the host window may answer, and once its origin is known, only that origin.
    if (event.source !== window.parent) return;
    if (this.hostOrigin && event.origin !== this.hostOrigin) return;

    const data = event.data as HostResponse | null;
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string') return;

    const entry = this.pending.get(data.requestId);
    if (!entry || entry.channel !== data.channel) return;

    this.hostOrigin ??= event.origin;
    this.pending.delete(data.requestId);
    clearTimeout(entry.timeoutId);

    if (data.error || data.success === false) {
      entry.reject(
        new HostBridgeError(
          data.error?.message ?? 'Unknown error from the Fabric host.',
          data.error?.code ?? 'PLUGIN_ERROR',
        ),
      );
    } else {
      entry.resolve(data.result);
    }
  };
}

let transport: HostTransport | null = null;

interface ExecuteQueriesJson {
  results?: { tables?: { rows?: DaxRow[] }[] }[];
  error?: { message?: string; code?: string };
}

/** Run one DAX query through the Fabric host. Resolves to the first table's rows. */
export async function executeDaxViaHost(
  workspaceId: string,
  modelId: string,
  query: string,
): Promise<DaxRow[]> {
  transport ??= new HostTransport();

  const result = (await transport.send(CHANNEL, METHOD_JSON, {
    workspaceId,
    modelId,
    query,
  })) as { data?: ExecuteQueriesJson } | undefined;

  const body = result?.data;
  if (body?.error) {
    throw new HostBridgeError(body.error.message ?? 'Power BI rejected the query.', 'DAX_ERROR');
  }
  return body?.results?.[0]?.tables?.[0]?.rows ?? [];
}
