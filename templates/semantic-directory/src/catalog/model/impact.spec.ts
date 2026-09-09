//-----------------------------------------------------------------------
// Semantic Directory — tests for impact analysis (reverse lineage).
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { impactOf, visibleImpact, topImpactRoot } from "./impact";
import { catalog, col, meas } from "../test-fixtures";

// Dependency chain (who reads whom):
//   [Base] ← [Wrap] ← [Top]
//   [Base] ← [Sibling]
// So Base's downstream: depth1 = Sibling, Wrap; depth2 = Top.
const base = meas("Base", { usedByMeasures: ["wrap", "sibling"] });
const wrap = meas("Wrap", { usedByMeasures: ["top"] });
const sibling = meas("Sibling", {});
const top = meas("Top", {});
const lonely = meas("Lonely", {});

// A column read directly by [Base] and [Sibling].
const dim = col("Product", "Category", { usedByMeasures: ["base", "sibling"] });

const model = catalog({
    measures: [base, wrap, sibling, top, lonely],
    columns: [dim],
});

describe("impactOf (measure)", () => {
    it("groups transitive downstream measures by depth", () => {
        const result = impactOf(model, base);
        expect(result.total).toBe(3);
        expect(result.maxDepth).toBe(2);
        expect(result.levels[0].depth).toBe(1);
        expect(result.levels[0].measures.map((m) => m.displayName)).toEqual([
            "Sibling",
            "Wrap",
        ]);
        expect(result.levels[1].measures.map((m) => m.displayName)).toEqual([
            "Top",
        ]);
    });

    it("returns an empty blast radius for a measure nothing references", () => {
        const result = impactOf(model, lonely);
        expect(result.total).toBe(0);
        expect(result.levels).toEqual([]);
        expect(result.maxDepth).toBe(0);
    });

    it("never includes the root measure in its own downstream (cycle guard)", () => {
        const a = meas("A", { usedByMeasures: ["b"] });
        const b = meas("B", { usedByMeasures: ["a"] }); // A ↔ B cycle
        const cyclic = catalog({ measures: [a, b] });
        const result = impactOf(cyclic, a);
        expect(result.total).toBe(1);
        expect(result.levels[0].measures.map((m) => m.displayName)).toEqual(["B"]);
    });

    it("assigns a diamond-reachable measure to its shallowest depth", () => {
        // Root ← Mid; Root ← End; Mid ← End. End is reachable at depth 1 AND
        // depth 2, but must land at depth 1 with no double count.
        const root = meas("Root", { usedByMeasures: ["mid", "end"] });
        const mid = meas("Mid", { usedByMeasures: ["end"] });
        const end = meas("End", {});
        const diamond = catalog({ measures: [root, mid, end] });
        const result = impactOf(diamond, root);
        expect(result.total).toBe(2);
        expect(result.levels[0].measures.map((m) => m.displayName)).toEqual([
            "End",
            "Mid",
        ]);
        expect(result.maxDepth).toBe(1);
    });

    it("returns an empty radius for a self-referencing measure", () => {
        const self = meas("Self", { usedByMeasures: ["self"] });
        const result = impactOf(catalog({ measures: [self] }), self);
        expect(result.total).toBe(0);
        expect(result.levels).toEqual([]);
    });
});

describe("impactOf (column)", () => {
    it("traces downstream from a column through the measures that read it", () => {
        const result = impactOf(model, dim);
        // depth1 = Base, Sibling; depth2 = Wrap; depth3 = Top.
        expect(result.total).toBe(4);
        expect(result.levels[0].measures.map((m) => m.displayName)).toEqual([
            "Base",
            "Sibling",
        ]);
        expect(result.levels[1].measures.map((m) => m.displayName)).toEqual([
            "Wrap",
        ]);
        expect(result.levels[2].measures.map((m) => m.displayName)).toEqual([
            "Top",
        ]);
    });
});

describe("visibleImpact", () => {
    it("drops hidden measures and recomputes the total", () => {
        const src = meas("Src", { usedByMeasures: ["shown", "secret"] });
        const shown = meas("Shown", {});
        const secret = meas("Secret", { isHidden: true });
        const model2 = catalog({ measures: [src, shown, secret] });
        const view = visibleImpact(impactOf(model2, src));
        expect(view.total).toBe(1);
        expect(view.levels).toHaveLength(1);
        expect(view.levels[0].measures.map((m) => m.displayName)).toEqual(["Shown"]);
    });

    it("removes a level that empties out and recomputes reach", () => {
        // Src ← Hidden(depth1) ← Deep(depth2). Hiding depth1 must not orphan
        // depth2: the empty level is dropped and maxDepth stays 2.
        const src = meas("Src", { usedByMeasures: ["hidden"] });
        const hidden = meas("Hidden", { isHidden: true, usedByMeasures: ["deep"] });
        const deep = meas("Deep", {});
        const model2 = catalog({ measures: [src, hidden, deep] });
        const view = visibleImpact(impactOf(model2, src));
        expect(view.total).toBe(1);
        expect(view.levels).toHaveLength(1);
        expect(view.levels[0].depth).toBe(2);
        expect(view.levels[0].measures.map((m) => m.displayName)).toEqual(["Deep"]);
        expect(view.maxDepth).toBe(2);
    });

    it("returns an empty view when every dependent is hidden", () => {
        const src = meas("Src", { usedByMeasures: ["secret"] });
        const secret = meas("Secret", { isHidden: true });
        const view = visibleImpact(impactOf(catalog({ measures: [src, secret] }), src));
        expect(view.total).toBe(0);
        expect(view.levels).toEqual([]);
        expect(view.maxDepth).toBe(0);
    });
});

describe("topImpactRoot", () => {
    it("picks the entity with the largest visible blast radius", () => {
        // Big drives two downstream; Small drives one; Idle drives none.
        const big = meas("Big", { usedByMeasures: ["a", "b"] });
        const a = meas("A", {});
        const b = meas("B", {});
        const small = meas("Small", { usedByMeasures: ["c"] });
        const c = meas("C", {});
        const idle = meas("Idle", {});
        const model2 = catalog({ measures: [small, big, a, b, c, idle] });
        expect(topImpactRoot(model2)?.displayName).toBe("Big");
    });

    it("breaks ties alphabetically by display name", () => {
        // Zebra and Alpha both drive exactly one downstream measure.
        const zebra = meas("Zebra", { usedByMeasures: ["z1"] });
        const alpha = meas("Alpha", { usedByMeasures: ["a1"] });
        const model2 = catalog({ measures: [zebra, alpha, meas("Z1", {}), meas("A1", {})] });
        expect(topImpactRoot(model2)?.displayName).toBe("Alpha");
    });

    it("never returns a hidden entity as the default root", () => {
        const hiddenBig = meas("HiddenBig", { isHidden: true, usedByMeasures: ["x", "y"] });
        const visibleSmall = meas("VisibleSmall", { usedByMeasures: ["z"] });
        const model2 = catalog({
            measures: [hiddenBig, visibleSmall, meas("X", {}), meas("Y", {}), meas("Z", {})],
        });
        expect(topImpactRoot(model2)?.displayName).toBe("VisibleSmall");
    });
});
