/**
 * Thin client for the standalone Python Fabric User Data Functions backend.
 *
 * Each function is invoked via its public REST endpoint. The user's Power BI
 * token is sent both as the `Authorization` bearer (invocation auth) and in
 * the JSON body as `fabricToken` (so the function can call Fabric REST on the
 * user's behalf). Body keys match the Python function parameter names, which
 * must be camelCase.
 *
 * Response envelope (per the UDF REST contract):
 *   { functionName, invocationId, status, output, errors }
 */
import { getUdfConfig } from '@/config/udfConfig';

import { getFabricToken, getStorageToken, PbiSignInRequiredError } from './fabricAuth';

/**
 * Raised when a Fabric call fails because the backing capacity is paused /
 * inactive. Surfaced as a friendly, actionable message instead of a raw
 * `CapacityNotActive` / "Premium capacity connection health" error.
 */
export class CapacityPausedError extends Error {
  constructor(detail?: string) {
    super(
      'The Fabric capacity backing this workspace is paused. Resume the capacity in the Fabric portal (or Azure), then try again.' +
        (detail ? `\n\nDetails: ${detail}` : '')
    );
    this.name = 'CapacityPausedError';
  }
}

/** Heuristic: does this error text describe a paused / inactive capacity? */
function isCapacityPaused(text: string): boolean {
  const t = (text || '').toLowerCase();
  return (
    t.includes('capacitynotactive') ||
    t.includes('capacity is not active') ||
    t.includes('capacity not active') ||
    (t.includes('premium capacity') && t.includes('health')) ||
    (t.includes('capacity') && t.includes('paused')) ||
    (t.includes('capacity') && t.includes('suspended'))
  );
}


export interface NamedItem {
  id: string;
  displayName: string;
}

export interface FixerResult {
  fixerId: string;
  scanOnly: boolean;
  matched: number;
  changed: number;
  findings: { path: string; detail: string }[];
  applied: boolean;
}

/** Terminal state of a Fabric `RunNotebook` job instance (see `udf.runNotebook`). */
export interface NotebookRunResult {
  /** Job-instance id. */
  id: string;
  /** Completed | Failed | Cancelled | InProgress | NotStarted | Deduped | Unknown. */
  status: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  failureReason?: { errorCode?: string; message?: string } | null;
  /**
   * Value passed to `notebookutils.notebook.exit(...)` by the run, surfaced in
   * the job-instance `exitValue` field. `null` when the notebook didn't call
   * `exit` (older notebooks or a hard failure before the exit cell ran).
   */
  exitValue?: string | null;
}

interface UdfEnvelope<T> {
  functionName: string;
  invocationId: string;
  status: string;
  output: T;
  errors?: { name: string; message: string }[];
}

async function invoke<T>(url: string, params: Record<string, unknown>): Promise<T> {
  const token = await getFabricToken();
  return invokeWithBody<T>(url, { ...params, fabricToken: token }, token);
}

/**
 * Like `invoke`, but does not inject `fabricToken` into the body. Used for the
 * GitHub functions (device-flow + Copilot translate) which authenticate to
 * GitHub with their own token, not the Fabric one — though the Power BI token
 * is still sent as the bearer because invoking any UDF requires the
 * `UserDataFunction.Execute.All` delegated permission.
 */
async function invokeRaw<T>(url: string, params: Record<string, unknown>): Promise<T> {
  const token = await getFabricToken();
  return invokeWithBody<T>(url, params, token);
}

/**
 * Like `invoke`, but injects a Storage-audience token as `onelakeToken` in the
 * body (for OneLake DFS calls, which reject the Power BI token) while still
 * using the Power BI token as the invocation bearer. Both tokens are acquired
 * silently; a first-time Storage consent surfaces as `PbiSignInRequiredError`
 * so the caller can retry from a user gesture.
 */
async function invokeWithStorage<T>(
  url: string,
  params: Record<string, unknown>
): Promise<T> {
  const [bearer, onelakeToken] = await Promise.all([getFabricToken(), getStorageToken()]);
  return invokeWithBody<T>(url, { ...params, onelakeToken }, bearer);
}

async function invokeWithBody<T>(
  url: string,
  body: Record<string, unknown>,
  bearer: string
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // A 401/403 means the Power BI token is for the wrong identity or lacks
    // permission — surface the sign-in gate so the user can re-pick the
    // correct (Fabric portal) account rather than seeing a raw error.
    if (res.status === 401 || res.status === 403) {
      throw new PbiSignInRequiredError();
    }
    const text = await res.text();
    if (isCapacityPaused(text)) throw new CapacityPausedError();
    throw new Error(`Function call failed (${res.status}): ${text}`);
  }

  const envelope = (await res.json()) as UdfEnvelope<T>;
  if (envelope.status !== 'Succeeded') {
    const detail = envelope.errors?.map((e) => e.message).join('; ') || envelope.status;
    if (isCapacityPaused(detail)) throw new CapacityPausedError();
    throw new Error(`${envelope.functionName} ${envelope.status}: ${detail}`);
  }
  return envelope.output;
}

export const udf = {
  listWorkspaces: (): Promise<NamedItem[]> =>
    invoke<NamedItem[]>(getUdfConfig().urls.listWorkspaces, {}),

  listReports: (workspaceId: string): Promise<NamedItem[]> =>
    invoke<NamedItem[]>(getUdfConfig().urls.listReports, {
      workspaceId,
    }),

  applyReportFixer: (
    workspaceId: string,
    reportId: string,
    fixerId: string,
    scanOnly: boolean
  ): Promise<FixerResult> =>
    invoke<FixerResult>(getUdfConfig().urls.applyReportFixer, {
      workspaceId,
      reportId,
      fixerId,
      scanOnly,
    }),

  /**
   * Generic Fabric / Power BI REST call routed through the server-side proxy.
   * `api` selects the host ("fabric" or "pbi"); 202 long-running operations are
   * resolved server-side. Returns the parsed response body.
   */
  fabricProxy: async <T>(
    api: 'fabric' | 'pbi',
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<T> => {
    const res = await invoke<{ status: number; body: T }>(
      getUdfConfig().urls.fabricProxy,
      { api, path, method, body: body === undefined ? '' : JSON.stringify(body) }
    );
    return res.body;
  },

  /**
   * Trigger an on-demand `RunNotebook` job for a notebook and wait for it to
   * finish. Fabric replies 202 + Location with the job-instance status
   * resource; the server-side proxy now polls that to a terminal job-instance
   * state (`Completed` / `Failed` / `Cancelled` / `Deduped`) and returns the
   * final instance body — so this single call blocks until the run ends.
   *
   * If the notebook called `notebookutils.notebook.exit(value)`, that value is
   * surfaced in `exitValue`. The terminal body usually carries it; when it
   * doesn't (depends on the tenant API version) we re-fetch the instance with
   * the `?beta=true` flag as a best-effort fallback.
   */
  runNotebook: async (workspaceId: string, notebookId: string): Promise<NotebookRunResult> => {
    let inst: {
      id?: string;
      status?: string;
      startTimeUtc?: string;
      endTimeUtc?: string;
      failureReason?: { errorCode?: string; message?: string } | null;
      exitValue?: string | null;
    };
    try {
      inst = await udf.fabricProxy<typeof inst>(
        'fabric',
        `/workspaces/${workspaceId}/items/${notebookId}/jobs/instances?jobType=RunNotebook`,
        'POST'
      );
    } catch (e) {
      // The server proxy raises when the RunNotebook LRO reaches a *Failed*
      // terminal state (it can't return a "failed" body), so it surfaces as a
      // raw 500. Convert that into a structured `Failed` result — with the
      // failure reason dug out of the error text — so the Runner renders a
      // clean warning instead of an opaque red 500 blob.
      if (e instanceof CapacityPausedError || e instanceof PbiSignInRequiredError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/LRO failed|RunNotebook|failureReason|Session_Statements/i.test(msg)) {
        const codeM = msg.match(/"errorCode"\s*:\s*"([^"]+)"/);
        const msgM = msg.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        return {
          id: '',
          status: 'Failed',
          failureReason: {
            errorCode: codeM?.[1],
            message: msgM ? msgM[1].replace(/\\"/g, '"') : 'The notebook run failed on Fabric.',
          },
          exitValue: null,
        };
      }
      throw e;
    }

    let exitValue: string | null = inst.exitValue ?? null;
    if (exitValue == null && inst.id) {
      try {
        // The generic `/items/{id}/jobs/instances` terminal body doesn't carry
        // the notebook exit value — only the notebook-specific Job Scheduler
        // path surfaces it, with `?beta=true`, and (in the current API version)
        // nested under `properties.exitValue` rather than top-level. See
        // https://learn.microsoft.com/fabric/data-engineering/notebook-public-api#exit-values-from-notebook-runs
        const refetch = await udf.fabricProxy<{
          exitValue?: string | null;
          properties?: { exitValue?: string | null };
        }>(
          'fabric',
          `/workspaces/${workspaceId}/notebooks/${notebookId}/jobs/execute/instances/${inst.id}?beta=true`
        );
        exitValue = refetch.properties?.exitValue ?? refetch.exitValue ?? null;
      } catch {
        // best-effort — the run result just won't be shown inline.
      }
    }

    return {
      id: inst.id ?? '',
      status: inst.status ?? 'Unknown',
      startTimeUtc: inst.startTimeUtc,
      endTimeUtc: inst.endTimeUtc,
      failureReason: inst.failureReason ?? null,
      exitValue,
    };
  },

  // --- GitHub device-flow + Copilot translate (Translations tab) ----------- //

  /** Start the GitHub device-authorisation flow. */
  githubDeviceStart: (): Promise<GithubDeviceStart> =>
    invokeRaw<GithubDeviceStart>(getUdfConfig().urls.githubDeviceStart, {}),

  /** Poll once for the device-flow result. */
  githubDevicePoll: (deviceCode: string): Promise<GithubDevicePoll> =>
    invokeRaw<GithubDevicePoll>(getUdfConfig().urls.githubDevicePoll, { deviceCode }),

  /** Translate a batch of captions into `culture` via GitHub Copilot. */
  githubTranslate: (
    githubToken: string,
    culture: string,
    sources: string[],
    glossary?: Record<string, string>
  ): Promise<{ translations: string[] }> =>
    invokeRaw<{ translations: string[] }>(getUdfConfig().urls.githubTranslate, {
      githubToken,
      culture,
      sources: JSON.stringify(sources),
      glossary: glossary && Object.keys(glossary).length ? JSON.stringify(glossary) : '',
    }),

  /** Generate one short inline comment per M (Power Query) step via GitHub
   *  Copilot. `steps` are the step code snippets; the response is aligned 1:1
   *  and contains only comment text (never M code). */
  githubCommentM: (
    githubToken: string,
    steps: string[]
  ): Promise<{ comments: string[] }> =>
    invokeRaw<{ comments: string[] }>(getUdfConfig().urls.githubCommentM, {
      githubToken,
      steps: JSON.stringify(steps),
    }),

  /** Generate a full landing-page HTML fragment for a report via GitHub
   *  Copilot. `context` carries the report title, page list, KPI tiles and the
   *  accent colour; the response is a single self-contained HTML string scoped
   *  under `.landing-root`. */
  githubLandingHtml: (
    githubToken: string,
    context: LandingHtmlContext
  ): Promise<{ html: string }> =>
    invokeRaw<{ html: string }>(getUdfConfig().urls.githubLandingHtml, {
      githubToken,
      pageContext: JSON.stringify(context),
    }),

  /** Propose a folder name per workspace item (workspace cleanup) via GitHub
   *  Copilot. `items` carry id + name + type; the response assigns each id to a
   *  short, human-readable folder name. */
  githubTidyWorkspace: (
    githubToken: string,
    items: TidyItem[]
  ): Promise<{ assignments: { id: string; folder: string }[] }> =>
    invokeRaw<{ assignments: { id: string; folder: string }[] }>(
      getUdfConfig().urls.githubTidyWorkspace,
      {
        githubToken,
        items: JSON.stringify(items),
      }
    ),

  /** Read the team's shared guideline conventions JSON blob from a lakehouse.
   *  Returns `{ found, payload }`; `found:false` means no file exists yet. */
  loadGuidelines: <T = unknown>(
    workspaceId: string,
    lakehouseId: string
  ): Promise<{ found: boolean; payload: T | null }> =>
    invokeWithStorage<{ found: boolean; payload: T | null }>(
      getUdfConfig().urls.loadGuidelines,
      { workspaceId, lakehouseId }
    ),

  /** Write the team's shared guideline conventions JSON blob to a lakehouse. */
  saveGuidelines: (
    workspaceId: string,
    lakehouseId: string,
    payload: unknown
  ): Promise<{ saved: boolean; bytes: number }> =>
    invokeWithStorage<{ saved: boolean; bytes: number }>(
      getUdfConfig().urls.saveGuidelines,
      { workspaceId, lakehouseId, payload: JSON.stringify(payload) }
    ),
};

export interface TidyItem {
  id: string;
  name: string;
  type: string;
}

export interface LandingHtmlContext {
  title: string;
  subtitle: string;
  pages: string[];
  kpis: { label: string; value: string }[];
  accent: string;
  ink: string;
}

export interface GithubDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export interface GithubDevicePoll {
  status: 'pending' | 'authorized' | 'error';
  accessToken?: string;
  error?: string;
}
