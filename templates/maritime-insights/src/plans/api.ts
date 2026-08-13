/**
 * Committing a sensor plan to Fabric, from the browser.
 *
 * 🔴 Why this is the feature that matters commercially: a GIS or a radar-planning tool also draws a
 * viewshed. What none of them does is let a planner **commit** the decision — the sites, the mast
 * heights, the chosen variant, who decided and when — into a governed store the rest of the
 * customer's estate can read. Everything this app produced before this lived in browser memory and
 * died with the tab.
 *
 * The transport reuses the assistant backend: it already holds a managed identity, already has the
 * CORS and app-key handling, and is already deployed. A second service to write one JSON file would
 * be a second thing to keep alive.
 */

import { ASSISTANT_BASE, assistantConfigured, assistantHeaders } from "../assistant/api";
import type { ReportModel } from "../twin3d/report";

/** One row of the flat ledger — what a listing shows without opening a document. */
export interface PlanSummary {
  id: string;
  committedUtc: string;
  aoi: string;
  name: string;
  authorAsserted: string;
  scenario: string | null;
  trackDate: string | null;
  sites: number;
  /** Total mast metres. The quantity a price list is applied to — this app never prints a price. */
  mastMetres: number;
  targetM: number | null;
  transits: number | null;
  observedTransits: number | null;
  observedShare: number | null;
  visibleKm2: number | null;
  worstCaseLossTransits: number | null;
  excludedStationary: number | null;
  stationaryBelowKm: number | null;
  includesVegetation: boolean | null;
  geometryOnly: boolean;
}

export interface PlanDocument {
  schema: string;
  id: string;
  committedUtc: string;
  aoi: string;
  name: string;
  note: string;
  authorAsserted: string;
  report: ReportModel;
}

export interface CommitResult {
  id: string;
  committedUtc: string;
  path: string;
  ledger: string;
  target: { workspaceId: string; lakehouseId: string; endpoint: string };
}

export interface DeleteResult {
  id: string;
  /** False when the ledger held a row but the document was already gone. */
  documentDeleted: boolean;
  ledgerRowsRemoved: number;
  /** What is NOT yet deleted — the Delta projection. Shown to the reader, not swallowed. */
  note?: string;
}

/** Writeback rides on the assistant backend, so it exists exactly when that one does. */
export function writebackConfigured(): boolean {
  return assistantConfigured();
}

async function parse<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${what}: server sent ${res.status} and something that is not JSON`);
  }
  if (!res.ok) {
    const detail = body as { message?: string; hint?: string } | null;
    // 🔴 Surface the backend's hint. The one failure an operator will actually hit is a missing
    // workspace role, and "forbidden" alone sends them looking in the wrong place.
    throw new Error([detail?.message ?? `HTTP ${res.status}`, detail?.hint]
      .filter(Boolean).join(" — "));
  }
  return body as T;
}

export async function commitPlan(input: {
  aoi: string;
  name: string;
  note: string;
  author: string;
  report: ReportModel;
}): Promise<CommitResult> {
  const res = await fetch(`${ASSISTANT_BASE}/api/plans`, {
    method: "POST",
    headers: assistantHeaders(),
    body: JSON.stringify(input),
  });
  return await parse<CommitResult>(res, "Plan sichern");
}

export async function listPlans(aoi: string): Promise<PlanSummary[]> {
  const res = await fetch(`${ASSISTANT_BASE}/api/plans?aoi=${encodeURIComponent(aoi)}`, {
    headers: assistantHeaders(),
  });
  const body = await parse<{ plans: PlanSummary[] }>(res, "Pläne laden");
  return body.plans ?? [];
}

export async function loadPlan(aoi: string, id: string): Promise<PlanDocument> {
  const res = await fetch(
    `${ASSISTANT_BASE}/api/plans/${encodeURIComponent(aoi)}/${encodeURIComponent(id)}`,
    { headers: assistantHeaders() },
  );
  return await parse<PlanDocument>(res, "Plan laden");
}

/**
 * Withdraw a committed plan.
 *
 * ⚠️ The Delta tables the semantic model reads are a **projection** of the ledger, refreshed by
 * `tools/fabric/publish_plans.py`. Until that runs, a plan deleted here is gone from the app and
 * still counted in Power BI. The backend returns that caveat with the result; the panel repeats it
 * rather than reporting a clean "deleted" that is only true of one of the two stores.
 */
export async function deletePlan(aoi: string, id: string): Promise<DeleteResult> {
  const res = await fetch(
    `${ASSISTANT_BASE}/api/plans/${encodeURIComponent(aoi)}/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: assistantHeaders() },
  );
  return await parse<DeleteResult>(res, "Plan löschen");
}

/**
 * The sites a committed plan restores, in the form `applySites` wants.
 *
 * ⚠️ Restores from **grid cells**, not from lat/lon. The document carries both, but the cell is
 * what the solver addresses and what the app placed; re-deriving a cell from a rounded coordinate
 * would move the mast by up to half a cell and change every figure that follows from it.
 */
export function planSites(doc: PlanDocument): { col: number; row: number; mastM: number }[] {
  return doc.report.sites
    .filter((s) => Number.isFinite(s.col) && Number.isFinite(s.row))
    .map((s) => ({ col: s.col as number, row: s.row as number, mastM: s.mastM }));
}

/** A short, human line for a listing row. */
export function planLine(plan: PlanSummary): string {
  const share = plan.observedShare == null
    ? "—"
    : `${(plan.observedShare * 100).toFixed(0)} %`;
  const masts = plan.sites === 1 ? "1 Mast" : `${plan.sites} Masten`;
  return `${masts} · ${plan.mastMetres} m · ${share} der Durchfahrten`;
}
