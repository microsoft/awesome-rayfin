import { describe, expect, it } from "vitest";
import {
  compareVariants,
  observedShare,
  ppPerMastMetre,
  variantCost,
  worstCaseLossShare,
  type Variant,
} from "./variants";

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: "A",
    sites: [{ col: 10, row: 10, mastM: 25 }],
    targetM: 2,
    transits: 137,
    observedTransits: 99,
    redundantTransits: 0,
    worstCaseLossTransits: 99,
    visibleKm2: 55.5,
    ...overrides,
  };
}

describe("variantCost", () => {
  it("sums mast metres and reports the tallest", () => {
    const cost = variantCost(variant({
      sites: [
        { col: 1, row: 1, mastM: 25 },
        { col: 2, row: 2, mastM: 40 },
        { col: 3, row: 3, mastM: 10 },
      ],
    }));
    expect(cost).toEqual({ siteCount: 3, totalMastM: 75, tallestMastM: 40 });
  });

  it("is all zeroes for an empty network", () => {
    expect(variantCost(variant({ sites: [] })))
      .toEqual({ siteCount: 0, totalMastM: 0, tallestMastM: 0 });
  });
});

describe("compareVariants", () => {
  it("reports share differences in PERCENTAGE POINTS, not percent", () => {
    // 🔴 72 % → 90 % is +18 pp and +25 %. Quoting the second as the first is the classic way a
    // comparison table misleads, so it is pinned here.
    const base = variant({ observedTransits: 99 });            // 72.3 %
    const other = variant({ id: "B", observedTransits: 123 }); // 89.8 %
    const delta = compareVariants(base, other);
    expect(delta.observedPp).toBeCloseTo(17.5, 1);
    expect(delta.observedPp).not.toBeCloseTo(24.2, 1);
  });

  it("makes a worse configuration read as negative", () => {
    const base = variant({ observedTransits: 123, visibleKm2: 132.2 });
    const other = variant({ id: "B", observedTransits: 99, visibleKm2: 55.5 });
    const delta = compareVariants(base, other);
    expect(delta.observedPp).toBeLessThan(0);
    expect(delta.visibleKm2).toBeCloseTo(-76.7, 1);
  });

  it("counts the structural difference, which is what a price list is applied to", () => {
    const base = variant({ sites: [{ col: 1, row: 1, mastM: 25 }] });
    const other = variant({
      id: "B",
      sites: [{ col: 1, row: 1, mastM: 25 }, { col: 2, row: 2, mastM: 40 }],
    });
    const delta = compareVariants(base, other);
    expect(delta.siteCount).toBe(1);
    expect(delta.totalMastM).toBe(40);
  });

  it("treats a rise in worst-case loss as a rise, not an improvement", () => {
    // The sign has to mean "the bad number got bigger", or the table reads backwards.
    const base = variant({ worstCaseLossTransits: 10 });
    const other = variant({ id: "B", worstCaseLossTransits: 38 });
    expect(compareVariants(base, other).worstCaseLossPp).toBeGreaterThan(0);
  });

  it("is antisymmetric: comparing the other way flips every sign", () => {
    const a = variant({ observedTransits: 99, visibleKm2: 55.5 });
    const b = variant({ id: "B", observedTransits: 128, visibleKm2: 176.8,
                        sites: [{ col: 1, row: 1, mastM: 25 }, { col: 2, row: 2, mastM: 25 }] });
    const ab = compareVariants(a, b);
    const ba = compareVariants(b, a);
    expect(ab.observedPp).toBeCloseTo(-ba.observedPp, 6);
    expect(ab.visibleKm2).toBeCloseTo(-ba.visibleKm2, 6);
    expect(ab.siteCount).toBe(-ba.siteCount);
    expect(ab.totalMastM).toBe(-ba.totalMastM);
  });

  it("does not divide by zero when nothing entered the area", () => {
    const empty = variant({ transits: 0, observedTransits: 0, worstCaseLossTransits: 0 });
    expect(observedShare(empty)).toBe(0);
    expect(worstCaseLossShare(empty)).toBe(0);
    expect(compareVariants(empty, empty).observedPp).toBe(0);
  });
});

describe("ppPerMastMetre", () => {
  it("prefers the configuration that buys more traffic per metre of structure", () => {
    // One 25 m mast seeing 72 % against two 60 m masts seeing 93 %: the tall pair covers more,
    // the single mast is better value per metre. Both facts belong in a purchasing conversation.
    const lean = variant({ observedTransits: 99, sites: [{ col: 1, row: 1, mastM: 25 }] });
    const heavy = variant({
      id: "B", observedTransits: 128,
      sites: [{ col: 1, row: 1, mastM: 60 }, { col: 2, row: 2, mastM: 60 }],
    });
    expect(ppPerMastMetre(lean)).toBeGreaterThan(ppPerMastMetre(heavy));
  });

  it("is zero rather than infinite for a network with no mast", () => {
    expect(ppPerMastMetre(variant({ sites: [] }))).toBe(0);
  });
});
