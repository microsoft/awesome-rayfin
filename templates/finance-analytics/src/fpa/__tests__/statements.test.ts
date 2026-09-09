import { describe, it, expect } from "vitest";
import {
  buildStatement,
  monthlySeries,
  actualOf,
} from "@/fpa/lib/statement-model";
import { resolveWindow, priorYearWindow, shiftPeriod, fiscalYearOf } from "@/fpa/lib/time-aggregation";
import { decomposePvm } from "@/fpa/lib/drivers";
import { buildCashflow } from "@/fpa/lib/cashflow";
import { translationFactor } from "@/fpa/lib/currency";
import { hatchPatternId, SCENARIO_STYLES } from "@/fpa/lib/ibcs";
import { AS_OF, PERIODS, pnlFacts, productFacts } from "@/fpa/data/statementFacts";

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

describe("time aggregation (anchored)", () => {
  it("YTD covers Jan..AS_OF of the reporting year", () => {
    const w = resolveWindow("ytd");
    expect(w[0]).toBe("2024-01");
    expect(w[w.length - 1]).toBe(AS_OF);
  });

  it("QTD stops at AS_OF and starts on a quarter boundary", () => {
    const w = resolveWindow("qtd");
    expect(w[w.length - 1]).toBe(AS_OF); // 2024-08 → Q3 starts Jul
    expect(w[0]).toBe("2024-07");
  });

  it("FY returns 12 months including forward periods", () => {
    const w = resolveWindow("fy");
    expect(w).toHaveLength(12);
    expect(w[0]).toBe("2024-01");
    expect(w[11]).toBe("2024-12");
  });

  it("prior-year window is shifted back exactly 12 months", () => {
    const w = resolveWindow("ytd");
    expect(priorYearWindow(w)).toEqual(w.map((p) => shiftPeriod(p, -12)));
  });

  it("shiftPeriod wraps years", () => {
    expect(shiftPeriod("2024-01", -1)).toBe("2023-12");
    expect(shiftPeriod("2023-12", 1)).toBe("2024-01");
  });

  it("fiscalYearOf is calendar-aligned here", () => {
    expect(fiscalYearOf("2024-08")).toBe(2024);
  });
});

describe("statement model reconciliation", () => {
  const lines = buildStatement({ preset: "ytd", compares: ["BU", "FC", "PY"] });
  const byId = (id: string) => lines.find((l) => l.id === id)!;

  it("subtotals reconcile to their components", () => {
    const gp = byId("gross_profit").actual!;
    const rev = byId("revenue").actual!;
    const cogs = byId("cogs").actual!; // signed negative
    expect(near(gp, rev + cogs)).toBe(true);
  });

  it("EBIT = EBITDA + D&A (signed)", () => {
    const ebit = byId("ebit").actual!;
    const ebitda = byId("ebitda").actual!;
    const da = byId("da").actual!; // negative
    expect(near(ebit, ebitda + da)).toBe(true);
  });

  it("revenue equals the sum of its product leaves", () => {
    const rev = byId("revenue").actual!;
    const leaves = ["rev_platform", "rev_analytics", "rev_services"].reduce((s, id) => s + byId(id).actual!, 0);
    expect(near(rev, leaves)).toBe(true);
  });

  it("variance favorability follows signed direction", () => {
    for (const l of lines) {
      const v = l.variance.BU;
      if (!v) continue;
      if (v.abs > 0.5) expect(v.favorability).toBe("favorable");
      if (v.abs < -0.5) expect(v.favorability).toBe("unfavorable");
    }
  });

  it("PY comparison uses actuals one year earlier", () => {
    const revPy = byId("revenue").compare.PY;
    expect(revPy).not.toBeNull();
    expect(revPy!).toBeGreaterThan(0);
  });

  it("monthlySeries yields nulls after AS_OF for actuals", () => {
    const ac = monthlySeries("revenue", "AC");
    const idx = PERIODS.indexOf("2024-09");
    expect(ac[idx]).toBeNull();
    expect(ac[PERIODS.indexOf(AS_OF)]).not.toBeNull();
  });
});

describe("PVM decomposition", () => {
  it("Volume + Mix + Price reconciles to ΔRevenue", () => {
    const w = resolveWindow("ytd");
    const r = decomposePvm(w, w, "BU");
    const delta = r.actual - r.base;
    expect(near(r.volume + r.mix + r.price, delta, 2)).toBe(true);
  });

  it("per-product effects sum to the totals", () => {
    const w = resolveWindow("ytd");
    const r = decomposePvm(w, w, "BU");
    const pv = r.drivers.reduce((s, d) => s + d.volume, 0);
    const mx = r.drivers.reduce((s, d) => s + d.mix, 0);
    const pr = r.drivers.reduce((s, d) => s + d.price, 0);
    expect(near(pv, r.volume, 2)).toBe(true);
    expect(near(mx, r.mix, 2)).toBe(true);
    expect(near(pr, r.price, 2)).toBe(true);
  });
});

describe("indirect cash flow", () => {
  it("free cash flow = CFO − capex and CFO includes D&A addback", () => {
    const rows = buildCashflow("ytd");
    const get = (id: string) => rows.find((r) => r.id === id)!.value;
    const cfo = get("cfo");
    const fcf = get("fcf");
    const capex = get("capex"); // negative
    expect(near(fcf, cfo + capex)).toBe(true);
    // D&A addback is positive.
    expect(get("da")).toBeGreaterThan(0);
    // EBIT line matches the statement EBIT actual.
    expect(near(get("ni"), actualOf("ebit", "ytd")!)).toBe(true);
  });
});

describe("currency translation", () => {
  it("USD factor is exactly 1", () => {
    expect(translationFactor(resolveWindow("ytd"), "USD")).toBe(1);
  });
  it("EUR/GBP factors are positive and not 1", () => {
    const w = resolveWindow("ytd");
    expect(translationFactor(w, "EUR")).toBeGreaterThan(0);
    expect(translationFactor(w, "GBP")).toBeGreaterThan(0);
    expect(translationFactor(w, "EUR")).not.toBe(1);
  });
});

describe("IBCS notation", () => {
  it("assigns distinct fill kinds per scenario", () => {
    const kinds = new Set(Object.values(SCENARIO_STYLES).map((s) => s.fillKind));
    expect(kinds.size).toBe(4);
  });
  it("derives a stable, prefixed pattern id", () => {
    expect(hatchPatternId("abc")).toBe("ibcs-hatch-abc");
  });
});

describe("fixture integrity", () => {
  it("is deterministic and non-empty", () => {
    expect(pnlFacts.length).toBeGreaterThan(0);
    expect(productFacts.length).toBeGreaterThan(0);
  });
  it("revenue product facts reconcile to stored revenue leaf facts", () => {
    const p = "2024-03";
    const fromProducts = productFacts
      .filter((f) => f.period === p && f.scenario === "AC" && f.line === "rev_platform")
      .reduce((s, f) => s + f.units * f.price, 0);
    const stored = pnlFacts.find((f) => f.period === p && f.scenario === "AC" && f.line === "rev_platform")!.value;
    expect(near(fromProducts, stored)).toBe(true);
  });
});
