import { describe, expect, it } from "vitest";
import {
  buildPlanDocument, ledgerRow, LEDGER_PATH, parseLedger, planId, planPath, PlanError,
  safeAoiId, safePlanId,
} from "./plans.mjs";

const report = {
  generatedUtc: "2026-08-06T09:00:00.000Z",
  aoiName: "Kieler Förde",
  scenario: "maritime",
  trackDate: "2026-07-01",
  targetM: 2,
  sites: [
    { id: 1, index: 0, lat: 54.4, lon: 10.2, mastM: 25, groundM: 3, eyeM: 28,
      horizonKm: 26.4, observedPassages: 99, uniquePassages: 40 },
    { id: 2, index: 1, lat: 54.45, lon: 10.15, mastM: 40, groundM: 12, eyeM: 52,
      horizonKm: 31.0, observedPassages: 88, uniquePassages: 12 },
  ],
  traffic: { passages: 137, observedPassages: 128, missedPassages: 9,
             passageShare: 0.9343, positionShare: 0.81 },
  network: { worstCaseLossPassages: 10 },
  areaVisibleKm2: 55.5,
  areaShadowedKm2: 143.8,
  missed: [],
  missedShown: 0,
  excludedStationary: 108,
  stationaryBelowKm: 0.5,
  surface: { includesBuildings: true, includesVegetation: true },
};

const NOW = Date.UTC(2026, 7, 6, 9, 30, 0);
const ID = planId(NOW, () => 0.5);

describe("planId", () => {
  it("sorts by commit time, so 'the latest plans' is free", () => {
    // The ledger is append-only and the folder listing is lexical; a time-ordered id means the
    // newest plans can be found without opening any of them.
    const early = planId(Date.UTC(2026, 0, 1), () => 0.1);
    const late = planId(Date.UTC(2026, 11, 31), () => 0.1);
    expect([late, early].sort()).toEqual([early, late]);
  });

  it("mints ids that its own validator accepts", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(() => safePlanId(planId(NOW + i * 1000, Math.random))).not.toThrow();
    }
  });
});

describe("path safety", () => {
  /**
   * 🔴 The id and the AOI both become storage path segments, so they are the fields a caller
   * controls that turn into a filesystem location. Allow-list, not deny-list.
   */
  it("refuses anything that could climb out of the plans folder", () => {
    for (const bad of ["../../secrets", "..", "a/b", "/etc/passwd", "%2e%2e%2f", "",
                       "20260806T093000-0000g", "20260806T093000"]) {
      expect(() => safePlanId(bad), bad).toThrow(PlanError);
    }
  });

  it("refuses an AOI segment that is not a plain slug", () => {
    for (const bad of ["../kiel", "Kiel Förde", "a/b", "", "-leading", "A", "x".repeat(65)]) {
      expect(() => safeAoiId(bad), bad).toThrow(PlanError);
    }
    expect(safeAoiId("kieler-foerde")).toBe("kieler-foerde");
  });

  it("builds a path only from validated parts", () => {
    expect(planPath("kieler-foerde", ID)).toBe(`Files/sensor-plans/kieler-foerde/${ID}.json`);
    expect(LEDGER_PATH).toBe("Files/sensor-plans/index.ndjson");
  });
});

describe("buildPlanDocument", () => {
  const body = { aoi: "kieler-foerde", name: "Variante B", note: "zwei Masten", author: "A. Korn",
                 report };

  it("stores the annex model verbatim, rather than a second summary of it", () => {
    // 🔴 The rule the annex work established: a second assembly of the same figures is a second
    // thing to drift. A committed plan and a forwarded annex must not be able to disagree.
    const doc = buildPlanDocument({ body, id: ID, nowMs: NOW });
    expect(doc.report).toBe(report);
    expect(doc.schema).toBe("maritime-insights/sensor-plan@1");
    expect(doc.committedUtc).toBe("2026-08-06T09:30:00.000Z");
    expect(doc.name).toBe("Variante B");
  });

  it("names the author field for what it is — asserted, not verified", () => {
    // ⚠️ This service never sees the app's Entra token, so it cannot prove who committed. An audit
    // trail that implies verification it never performed is worse than none.
    const doc = buildPlanDocument({ body, id: ID, nowMs: NOW });
    expect(doc.authorAsserted).toBe("A. Korn");
    expect(Object.keys(doc)).not.toContain("author");
  });

  it("refuses a plan with no sites, which is not a plan", () => {
    expect(() => buildPlanDocument({
      body: { ...body, report: { ...report, sites: [] } }, id: ID, nowMs: NOW,
    })).toThrow(/no sites/);
  });

  it("refuses a request with no report model at all", () => {
    expect(() => buildPlanDocument({ body: { aoi: "kieler-foerde" }, id: ID, nowMs: NOW }))
      .toThrow(/report model/);
  });

  it("falls back to a usable name rather than storing an empty one", () => {
    const doc = buildPlanDocument({ body: { ...body, name: "   " }, id: ID, nowMs: NOW });
    expect(doc.name).toContain(ID);
  });

  it("caps the free text fields", () => {
    expect(() => buildPlanDocument({
      body: { ...body, note: "x".repeat(2001) }, id: ID, nowMs: NOW,
    })).toThrow(/longer than/);
  });
});

describe("ledgerRow", () => {
  const doc = buildPlanDocument({
    body: { aoi: "kieler-foerde", name: "B", author: "A", report }, id: ID, nowMs: NOW,
  });

  it("flattens the figures a notebook would group by", () => {
    const row = ledgerRow(doc);
    expect(row.id).toBe(ID);
    expect(row.sites).toBe(2);
    expect(row.observedTransits).toBe(128);
    expect(row.observedShare).toBeCloseTo(0.9343, 4);
    expect(row.worstCaseLossTransits).toBe(10);
  });

  it("reports total mast metres, and never a price", () => {
    // PLAN §13.7: mast cost depends on civil works, site access and frame agreements, none of
    // which is in any dataset here. The app states the quantity a price list is applied to.
    const row = ledgerRow(doc);
    expect(row.mastMetres).toBe(65);
    expect(JSON.stringify(row)).not.toMatch(/[€$£]|euro|price|kosten/i);
  });

  it("carries the caveats ALONGSIDE the figures", () => {
    // 🔴 A ledger is read in bulk and out of context far more often than a document is, so a
    // percentage in it without its definition is the exact failure the annex work ruled out.
    const row = ledgerRow(doc);
    expect(row.excludedStationary).toBe(108);
    expect(row.stationaryBelowKm).toBe(0.5);
    expect(row.includesVegetation).toBe(true);
    expect(row.geometryOnly).toBe(true);
  });

  it("survives a report with no traffic or network figures", () => {
    const bare = buildPlanDocument({
      body: { aoi: "kieler-foerde", report: { ...report, traffic: null, network: null } },
      id: ID, nowMs: NOW,
    });
    const row = ledgerRow(bare);
    expect(row.observedTransits).toBeNull();
    expect(row.worstCaseLossTransits).toBeNull();
    expect(row.sites).toBe(2);
  });
});

describe("parseLedger", () => {
  it("reads back what it wrote", () => {
    const doc = buildPlanDocument({
      body: { aoi: "kieler-foerde", report }, id: ID, nowMs: NOW });
    const ndjson = `${JSON.stringify(ledgerRow(doc))}\n`;
    expect(parseLedger(ndjson)).toHaveLength(1);
    expect(parseLedger(ndjson)[0].id).toBe(ID);
  });

  it("skips a truncated final line instead of failing the whole listing", () => {
    // ⚠️ Appends are not atomic across readers, so a half-written last line is an expected state.
    const good = JSON.stringify({ id: "a" });
    expect(parseLedger(`${good}\n{"id":"b"`)).toEqual([{ id: "a" }]);
  });

  it("treats an absent ledger as empty, not as an error", () => {
    expect(parseLedger("")).toEqual([]);
    expect(parseLedger(null)).toEqual([]);
  });
});
