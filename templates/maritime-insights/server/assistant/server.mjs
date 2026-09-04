/**
 * Maritime-Insights assistant backend.
 *
 * A small HTTP service in front of Azure OpenAI. It exists for two reasons that are not
 * negotiable from the browser: the model needs a credential that must never reach a bundle, and
 * the tools need to read the shipped AIS assets server-side so answers are grounded in the same
 * data the app draws.
 *
 * Chat only — no voice. Node's built-in http server is enough, and keeping the dependency list at
 * one package (`@azure/identity`) means the image is small and there is nothing to patch weekly.
 *
 * Run locally:
 *   node server/assistant/server.mjs --terrain public/terrain
 */

import { createServer } from "node:http";
import { config, openAiConfigured } from "./config.mjs";
import { areaIds, getArea, loadAreas } from "./lib/data.mjs";
import { buildInstructions } from "./lib/instructions.mjs";
import { executeTool, toolDefinitions } from "./lib/tools.mjs";
import { streamAnswer } from "./lib/foundry.mjs";
import {
  buildPlanDocument, LEDGER_PATH, ledgerRow, parseLedger, planId, planPath, PlanError, safeAoiId,
  safePlanId,
} from "./lib/plans.mjs";
import {
  appendLedgerLine, deleteFile, fabricConfigured, putFile, readFile, removeLedgerRows,
  targetDescription,
} from "./lib/onelake.mjs";

const terrainDir = (() => {
  const flag = process.argv.indexOf("--terrain");
  return flag !== -1 ? process.argv[flag + 1] : config.terrainDir;
})();

function corsHeaders(origin) {
  const allowAll = config.corsOrigins.includes("*");
  const allowed = allowAll ? "*" : (config.corsOrigins.includes(origin) ? origin : "");
  return {
    "Access-Control-Allow-Origin": allowed || "null",
    "Access-Control-Allow-Headers": "content-type, x-app-key",
    // ⚠️ DELETE must be listed or the browser's preflight refuses the withdraw before it is sent,
    // and the failure surfaces as a bare network error with no status to explain it.
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}

function sendJson(res, status, body, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(origin),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A view snapshot is a few kB. Anything past this is not a legitimate client.
    if (size > 256 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * The app-key gate.
 *
 * ⚠️ An abuse gate, not authentication — the key ships in the browser bundle, so anyone who opens
 * dev tools has it. What it stops is a stranger who finds the URL spending the token budget, which
 * is the real exposure for a public endpoint in front of a paid model. Real authorisation is the
 * Entra gate in front of the app.
 */
function authorised(req) {
  if (!config.appKey) return true;
  return req.headers["x-app-key"] === config.appKey;
}

async function handleChat(req, res, origin) {
  if (!openAiConfigured()) {
    return sendJson(res, 503, {
      error: "assistant_not_configured",
      message: "AZURE_OPENAI_ENDPOINT is not set on the assistant backend.",
    }, origin);
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: "bad_request", message: error.message }, origin);
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return sendJson(res, 400, { error: "empty_prompt" }, origin);

  const view = body.view && typeof body.view === "object" ? body.view : null;
  const area = getArea(view?.aoi);

  // NDJSON rather than SSE: one JSON object per line is trivial to parse incrementally in the
  // browser and survives a proxy that would otherwise buffer an event stream.
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    ...corsHeaders(origin),
  });

  const write = (frame) => res.write(`${JSON.stringify(frame)}\n`);

  try {
    write({ type: "status", message: "Denke nach …" });
    const stream = streamAnswer({
      prompt,
      instructions: buildInstructions(area, view),
      tools: toolDefinitions(),
      executeTool,
      context: { view },
    });
    for await (const frame of stream) write(frame);
    write({ type: "done" });
  } catch (error) {
    // The stream has already started, so the only honest way to report a failure is as a frame.
    // A thrown 500 here would leave the browser with a half-written answer and no explanation.
    console.error("assistant: stream failed", error);
    write({ type: "error", message: error.message ?? "unknown error" });
  } finally {
    res.end();
  }
}

/**
 * Commit a sensor plan to Fabric.
 *
 * 🔴 This is the endpoint that turns the app from something you look at into something a customer's
 * estate can read. Everything the app produced before this lived in browser memory and died with
 * the tab.
 *
 * Two artefacts, because two readers want different shapes: the whole document (enough to restore
 * the app exactly) and one flat ledger row (queryable in bulk without opening every document).
 *
 * ⚠️ The document is written **first**. If the ledger append then fails, the plan still exists and
 * is still loadable by id — a missing index row is recoverable, a missing plan is not.
 */
async function handleCommitPlan(req, res, origin) {
  if (!fabricConfigured()) {
    return sendJson(res, 503, {
      error: "fabric_not_configured",
      message: "FABRIC_WORKSPACE_ID and FABRIC_LAKEHOUSE_ID are not set on the backend.",
    }, origin);
  }
  const body = await readBody(req);
  const id = planId();
  const document = buildPlanDocument({ body, id, nowMs: Date.now() });
  const path = planPath(document.aoi, document.id);

  await putFile(path, JSON.stringify(document, null, 2));
  let ledger = "written";
  try {
    await appendLedgerLine(LEDGER_PATH, JSON.stringify(ledgerRow(document)));
  } catch (error) {
    // Reported, not swallowed and not fatal: the plan is safe either way, and a caller told the
    // index is stale can do something about it.
    console.error("plan committed but the ledger append failed:", error.message);
    ledger = `failed: ${error.message}`;
  }

  return sendJson(res, 201, {
    id: document.id,
    committedUtc: document.committedUtc,
    path,
    ledger,
    target: targetDescription(),
  }, origin);
}

/** The committed plans, newest first, from the flat ledger. */
async function handleListPlans(req, res, origin, url) {
  if (!fabricConfigured()) {
    return sendJson(res, 503, { error: "fabric_not_configured", plans: [] }, origin);
  }
  const aoi = url.searchParams.get("aoi");
  const rows = parseLedger(await readFile(LEDGER_PATH));
  const filtered = aoi ? rows.filter((r) => r.aoi === safeAoiId(aoi)) : rows;
  filtered.sort((a, b) => String(b.committedUtc).localeCompare(String(a.committedUtc)));
  return sendJson(res, 200, { plans: filtered.slice(0, 50), target: targetDescription() }, origin);
}

/** One plan in full, enough to put the app back exactly where it was. */
async function handleGetPlan(req, res, origin, aoi, id) {
  if (!fabricConfigured()) {
    return sendJson(res, 503, { error: "fabric_not_configured" }, origin);
  }
  const body = await readFile(planPath(safeAoiId(aoi), safePlanId(id)));
  if (body == null) return sendJson(res, 404, { error: "plan_not_found" }, origin);
  return sendJson(res, 200, JSON.parse(body), origin);
}

/**
 * Withdraw a committed plan: the document AND its ledger row.
 *
 * 🔴 **This exists because "committed" was accidentally "permanent".** The store is append-only by
 * construction, which was a deliberate audit property — but nobody decided that a plan committed by
 * mistake could never be withdrawn, and the first person to discover that would have been a
 * customer. Removing test rows already required a hand-written script against OneLake, which is not
 * a capability anyone should need.
 *
 * ⚠️ **Order matters, and it is document-then-ledger.** The ledger is an index over documents. Drop
 * the row first and a failure halfway leaves a document nothing points at — invisible, undeletable
 * through this API, and still occupying the id. Dropping the document first leaves at worst a
 * ledger row pointing at nothing, which the list can show as broken and a retry can clear.
 *
 * ⚠️ The Delta tables Power BI reads are a **projection** of this ledger, not this store. They are
 * refreshed by `tools/fabric/publish_plans.py`; until that runs, a deleted plan is gone from the
 * app and still counted in the semantic model. The response says so rather than letting the caller
 * assume otherwise.
 */
async function handleDeletePlan(req, res, origin, aoi, id) {
  if (!fabricConfigured()) {
    return sendJson(res, 503, { error: "fabric_not_configured" }, origin);
  }
  const safeAoi = safeAoiId(aoi);
  const safeId = safePlanId(id);

  const existed = await deleteFile(planPath(safeAoi, safeId));
  const rowsRemoved = await removeLedgerRows(
    LEDGER_PATH, (row) => !(row?.id === safeId && row?.aoi === safeAoi));

  // Neither the document nor a row: there is nothing here by that name. Say 404 rather than
  // reporting a cheerful success for a delete that deleted nothing.
  if (!existed && rowsRemoved === 0) {
    return sendJson(res, 404, { error: "plan_not_found", id: safeId }, origin);
  }

  return sendJson(res, 200, {
    id: safeId,
    documentDeleted: existed,
    ledgerRowsRemoved: rowsRemoved,
    note: "Die Delta-Tabellen im Semantikmodell sind eine Projektion dieses Registers und "
      + "werden erst durch tools/fabric/publish_plans.py nachgezogen.",
  }, origin);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? "";
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  if (url.pathname === "/healthz") {
    const areas = areaIds().map((id) => {
      const a = getArea(id);
      return {
        id,
        date: a.date,
        passages: a.trackCount,
        transits: a.transitCount,
        withIdentity: a.namedTrackCount,
        vegetationInSurface: a.los?.includesVegetation ?? null,
      };
    });
    return sendJson(res, 200, {
      status: "ok",
      chat: openAiConfigured() ? "configured" : "not configured",
      model: config.openai.chatDeployment,
      relay: config.relayUrl ? "configured" : "not configured",
      appKeyRequired: Boolean(config.appKey),
      writeback: fabricConfigured() ? "configured" : "not configured",
      writebackTarget: fabricConfigured() ? targetDescription() : null,
      areas,
      tools: toolDefinitions().map((t) => t.name),
    }, origin);
  }

  if (url.pathname.startsWith("/api/") && !authorised(req)) {
    return sendJson(res, 401, { error: "unauthorized" }, origin);
  }

  try {
    if (url.pathname === "/api/assistant/stream" && req.method === "POST") {
      return handleChat(req, res, origin);
    }
    if (url.pathname === "/api/plans" && req.method === "POST") {
      return await handleCommitPlan(req, res, origin);
    }
    if (url.pathname === "/api/plans" && req.method === "GET") {
      return await handleListPlans(req, res, origin, url);
    }
    // /api/plans/<aoi>/<id>
    const single = /^\/api\/plans\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (single && req.method === "GET") {
      return await handleGetPlan(req, res, origin, single[1], single[2]);
    }
    if (single && req.method === "DELETE") {
      return await handleDeletePlan(req, res, origin, single[1], single[2]);
    }
  } catch (error) {
    /*
      🔴 One place where a failed write becomes an answer.

      A rejected plan is a 400 the caller can act on; a missing workspace role is a 403 with the
      operator action spelled out. Anything else is a 502, because the interesting failures here are
      someone else's service and pretending otherwise sends the reader looking in the wrong place.
    */
    const status = error instanceof PlanError ? error.status : (error.status ?? 500);
    if (status >= 500) console.error("plans:", error);
    return sendJson(res, status, {
      error: status === 403 ? "forbidden" : status >= 500 ? "storage_failed" : "invalid_plan",
      message: error.message,
      hint: error.hint,
    }, origin);
  }

  sendJson(res, 404, { error: "not_found" }, origin);
});

const loaded = await loadAreas(terrainDir);
console.log(`assistant: loaded ${loaded.size} area(s) from ${terrainDir}: ${areaIds().join(", ")}`);
if (!openAiConfigured()) {
  console.warn("assistant: AZURE_OPENAI_ENDPOINT is unset — /api/assistant/stream will answer 503");
}
server.listen(config.port, () => {
  console.log(`assistant: listening on ${config.port}`);
});
