import { describe, it, expect } from "vitest";
import { computeVariance, formatCompact } from "@/finance";
import { sampleData } from "@/data/sampleFinance";

// Smoke test: proves the finance library barrel resolves through the `@/finance`
// alias and that a couple of its pure utilities behave, so `npm test` has a
// green suite out of the box (a required signal for the gallery).
describe("finance library barrel", () => {
  it("formats compact currency", () => {
    expect(formatCompact(1_500_000_000, "$")).toMatch(/^\$1\.5B$/);
  });

  it("computes a variance table from labelled rows", () => {
    const rows = computeVariance([
      { label: "Cloud", actual: 120, priorYear: 100 },
      { label: "Gaming", actual: 90, priorYear: 100 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("Cloud");
  });

  it("ships a non-empty sample dataset", () => {
    expect(sampleData.rows.length).toBeGreaterThan(0);
    expect(sampleData.columns.some((c) => c.key === "revenue")).toBe(true);
  });
});
