/**
 * Committing a sensor plan to Fabric.
 *
 * 🔴 **Why this exists, in one sentence:** a GIS or a radar-planning tool also draws a viewshed —
 * what none of them does is let a planner *commit* the decision into a governed store the rest of
 * the customer's estate can read. Until now every configuration this app produced lived in browser
 * memory and died with the tab: the A/B variants, the optimiser's answer, the hand-placed network.
 * A demo that cannot keep its own output is a demo. This is the seam where it stops being one, and
 * it is the part a co-sell customer extends rather than admires.
 *
 * **What is written, and why that shape.** The document is the *annex model* (`reportData()`) with
 * a commit envelope around it. Not a new summary — the same model the exported HTML annex renders
 * from. That is deliberate and it is the rule §13 already established: a second assembly of the
 * same figures is a second thing to drift. So a committed plan and a forwarded annex cannot
 * disagree, by construction.
 *
 * **Two artefacts per commit**, because two different readers want different shapes:
 *   * `Files/sensor-plans/<aoi>/<id>.json` — the whole document, enough to restore the app exactly;
 *   * one line appended to `Files/sensor-plans/index.ndjson` — a flat ledger a notebook, a Spark
 *     job or a Direct Lake model can read without opening every document.
 *
 * ⚠️ **Everything here is a claim by the client.** The browser sends who it says the author is; this
 * service cannot verify it, because the app's Entra gate authenticates the *user to the app*, not
 * the user to this backend. The field is therefore named and documented as asserted, not proven —
 * an audit trail that quietly implies verification it never performed would be worse than none.
 */

/** Where committed plans live inside the lakehouse. */
export const PLANS_ROOT = "Files/sensor-plans";
export const LEDGER_PATH = `${PLANS_ROOT}/index.ndjson`;

/** Plans are small; this is a guard against a client sending something that is not a plan. */
const MAX_DOCUMENT_BYTES = 512 * 1024;

class PlanError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * A stable, sortable id.
 *
 * Time-ordered on purpose: the ledger is append-only and the folder listing is lexical, so an id
 * that sorts by commit time means "most recent plans" costs nothing to answer.
 */
export function planId(nowMs = Date.now(), random = Math.random) {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const suffix = Math.floor(random() * 0xfffff).toString(16).padStart(5, "0");
  return `${stamp}-${suffix}`;
}

/**
 * Reject anything that could escape the plans folder or address another item.
 *
 * 🔴 The id reaches a storage path, so it is the one field an attacker controls that turns into a
 * filesystem location. Allow-list rather than deny-list: everything that is not the shape we mint
 * is refused, so `..`, slashes, absolute paths and URL-encoded variants are all covered without
 * having to enumerate them.
 */
export function safePlanId(id) {
  if (typeof id !== "string" || !/^[0-9]{8}T[0-9]{6}-[0-9a-f]{5}$/.test(id)) {
    throw new PlanError("plan id is not in the expected form");
  }
  return id;
}

/** Same rule for the AOI segment, which also becomes a folder name. */
export function safeAoiId(aoi) {
  if (typeof aoi !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(aoi)) {
    throw new PlanError("aoi id is not in the expected form");
  }
  return aoi;
}

export function planPath(aoi, id) {
  return `${PLANS_ROOT}/${safeAoiId(aoi)}/${safePlanId(id)}.json`;
}

function text(value, max, field) {
  if (value == null) return "";
  if (typeof value !== "string") throw new PlanError(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new PlanError(`${field} is longer than ${max} characters`);
  return trimmed;
}

/**
 * Turn a client request into the document that gets stored.
 *
 * Pure: no clock, no network, no randomness that is not injected. The caller supplies `nowMs` and
 * `id` so a test can assert the whole document rather than the parts that happen to be stable.
 */
export function buildPlanDocument({ body, id, nowMs }) {
  if (!body || typeof body !== "object") throw new PlanError("no plan in the request");
  const report = body.report;
  if (!report || typeof report !== "object") {
    throw new PlanError("a plan must carry the report model — commit from a placed network");
  }
  if (!Array.isArray(report.sites) || report.sites.length === 0) {
    throw new PlanError("a plan with no sites is not a plan");
  }

  const aoi = safeAoiId(body.aoi);
  const document = {
    schema: "maritime-insights/sensor-plan@1",
    id: safePlanId(id),
    committedUtc: new Date(nowMs).toISOString(),
    aoi,
    name: text(body.name, 120, "name") || `Plan ${id}`,
    note: text(body.note, 2000, "note"),
    /**
     * ⚠️ Asserted by the browser, not verified here. See the module header: the app's Entra gate
     * authenticates the user to the *app*, and this service never sees that token. Naming the
     * field for what it is keeps the audit trail honest.
     */
    authorAsserted: text(body.author, 200, "author") || "unbekannt",
    /**
     * 🔴 The annex model, stored verbatim. The same object the exported HTML renders from, so a
     * committed plan and a forwarded annex cannot describe the same network differently.
     */
    report,
  };

  const bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw new PlanError(`plan is ${Math.round(bytes / 1024)} kB, over the limit`, 413);
  }
  return document;
}

/**
 * The flat row for the ledger.
 *
 * 🔴 Carries the **caveats alongside the figures**, not just the figures. A percentage that travels
 * without the definition it was measured under is exactly what the annex work concluded must never
 * circulate — and a ledger is far more likely to be read out of context than a document is, since
 * the whole point of it is to be queried in bulk.
 */
export function ledgerRow(document) {
  const r = document.report;
  return {
    id: document.id,
    committedUtc: document.committedUtc,
    aoi: document.aoi,
    name: document.name,
    authorAsserted: document.authorAsserted,
    scenario: r.scenario ?? null,
    trackDate: r.trackDate ?? null,
    sites: r.sites.length,
    /** Total mast metres — the quantity a price list is applied to. This app never prints a price. */
    mastMetres: r.sites.reduce((sum, s) => sum + (Number(s.mastM) || 0), 0),
    targetM: r.targetM ?? null,
    transits: r.traffic?.passages ?? null,
    observedTransits: r.traffic?.observedPassages ?? null,
    observedShare: r.traffic?.passageShare ?? null,
    visibleKm2: r.areaVisibleKm2 ?? null,
    worstCaseLossTransits: r.network?.worstCaseLossPassages ?? null,
    // The caveats that make the numbers above readable.
    excludedStationary: r.excludedStationary ?? null,
    stationaryBelowKm: r.stationaryBelowKm ?? null,
    includesVegetation: r.surface?.includesVegetation ?? null,
    geometryOnly: true,
  };
}

/** Parse the ledger back into rows, tolerating a partial last line. */
export function parseLedger(ndjson) {
  if (!ndjson) return [];
  const rows = [];
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // ⚠️ A truncated final line is an expected state, not a fault: appends are not atomic across
      // readers. Skipping it is right; failing the whole listing because of it would not be.
    }
  }
  return rows;
}

export { PlanError };
