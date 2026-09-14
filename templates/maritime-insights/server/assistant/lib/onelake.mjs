/**
 * OneLake, over the ADLS Gen2 REST API.
 *
 * 🔴 No SDK, and that is a decision rather than laziness. This service's entire dependency list is
 * `@azure/identity` — one package to patch, a small image, and nothing that can pull a transitive
 * surprise into a container that holds a credential. The file API here is four verbs (create,
 * append, flush, read) and a listing; a storage SDK would be several megabytes to spell them.
 *
 * The token is a **managed identity** token for `https://storage.azure.com`. The identity is granted
 * a role on the Fabric *workspace*, which is what makes the write governed: the same permission
 * model that decides who may read the lakehouse decides who may write into it, rather than a
 * connection string living in an environment variable.
 *
 * Verified against the live endpoint before any of this was written: create → 201, append → 202,
 * flush → 200, read → 200, list → 200, delete → 200.
 */

import { DefaultAzureCredential, AzureCliCredential } from "@azure/identity";
import { config } from "../config.mjs";
import { removeLedgerRows as removeRows } from "./onelakeLedger.mjs";

const DFS = "https://onelake.dfs.fabric.microsoft.com";
const SCOPE = "https://storage.azure.com/.default";

let credential = null;
let cached = null;

async function token() {
  const now = Date.now();
  if (cached && cached.expiresOnTimestamp - now > 120_000) return cached.token;
  if (!credential) {
    // 🔴 Same trap as the OpenAI client: inside a container the CLI credential looks for an `az`
    // binary that is not installed, and reports it as an opaque auth failure rather than as a
    // missing tool. Managed identity is the default; the CLI path is for a laptop.
    credential = config.fabric.useCliToken ? new AzureCliCredential() : new DefaultAzureCredential();
  }
  cached = await credential.getToken(SCOPE);
  if (!cached) throw new Error("could not obtain a OneLake token");
  return cached.token;
}

/** `<workspace>/<lakehouse>/<path>` — the address of one file inside the lakehouse. */
function url(path, query = "") {
  const { workspaceId, lakehouseId } = config.fabric;
  return `${DFS}/${workspaceId}/${lakehouseId}/${path}${query}`;
}

async function call(method, target, { body, headers } = {}) {
  const res = await fetch(target, {
    method,
    headers: { authorization: `Bearer ${await token()}`, ...(headers ?? {}) },
    body,
  });
  return res;
}

async function expectOk(res, what) {
  if (res.ok) return res;
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  const error = new Error(`${what}: ${res.status} ${detail}`);
  // 403 here almost always means the workspace role assignment is missing, which is an operator
  // action and not something a retry will fix. Saying so beats a bare "forbidden".
  error.status = res.status === 403 ? 403 : 502;
  error.hint = res.status === 403
    ? "the backend's managed identity needs a Contributor role on the Fabric workspace"
    : undefined;
  throw error;
}

/** Write a whole file, replacing anything already there. */
export async function putFile(path, content) {
  const data = Buffer.from(content, "utf8");
  await expectOk(await call("PUT", url(path, "?resource=file")), `create ${path}`);
  if (data.length) {
    await expectOk(await call("PATCH", url(path, "?action=append&position=0"), {
      body: data, headers: { "content-type": "application/json" },
    }), `append ${path}`);
  }
  await expectOk(await call("PATCH", url(path, `?action=flush&position=${data.length}`)),
                 `flush ${path}`);
  return data.length;
}

/** Read a file, or null when it does not exist. */
export async function readFile(path) {
  const res = await call("GET", url(path));
  if (res.status === 404) return null;
  await expectOk(res, `read ${path}`);
  return await res.text();
}

/**
 * Append one line to the ledger.
 *
 * ⚠️ Read-modify-write, not a true append, because the DFS append needs the current length and two
 * writers racing would corrupt it either way. The ledger is a convenience index over documents that
 * are each written separately — so the worst case of a lost race is a missing *row*, never a
 * missing plan. Stated here because the shape invites the assumption that it is transactional.
 */
export async function appendLedgerLine(path, line) {
  const existing = (await readFile(path)) ?? "";
  const next = existing.endsWith("\n") || existing === ""
    ? `${existing}${line}\n`
    : `${existing}\n${line}\n`;
  await putFile(path, next);
}

/** Remove a file. Answers false when it was not there, rather than throwing. */
export async function deleteFile(path) {
  const res = await call("DELETE", url(path));
  if (res.status === 404) return false;
  await expectOk(res, `delete ${path}`);
  return true;
}

/**
 * Drop every ledger row the predicate rejects, and report how many went.
 *
 * The decision lives in `onelakeLedger.mjs` so it can be tested without a token or an endpoint;
 * this binds it to the real store. See there for why an unparseable line is kept and why a delete
 * that matches nothing writes nothing.
 */
export async function removeLedgerRows(path, shouldKeep) {
  return await removeRows(path, shouldKeep, readFile, putFile);
}

export function fabricConfigured() {
  return Boolean(config.fabric.workspaceId && config.fabric.lakehouseId);
}

export function targetDescription() {
  const { workspaceId, lakehouseId } = config.fabric;
  return { workspaceId, lakehouseId, endpoint: DFS };
}
