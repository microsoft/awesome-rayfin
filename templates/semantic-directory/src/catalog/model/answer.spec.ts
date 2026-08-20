//-----------------------------------------------------------------------
// Semantic Directory — tests for the derived "at a glance" answer model.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildAnswer, type AnswerCard } from "./answer";
import { catalog, col, meas, tbl } from "../test-fixtures";

const ids = (cards: AnswerCard[]) => cards.map((c) => c.id);
const byId = (cards: AnswerCard[], id: string) => cards.find((c) => c.id === id);

describe("buildAnswer — measure", () => {
    it("derives behavior, reach, built-from and a risk check", () => {
        const total = meas("Total Sales", {
            dax: "SUM('Sales'[Amount])",
            dependsOnColumns: ["'Sales'[Amount]"],
            usedByMeasures: ["margin"],
        });
        const margin = meas("Margin", {});
        const model = catalog({ measures: [total, margin] });

        const cards = buildAnswer(model, total);
        expect(ids(cards)).toEqual(["behavior", "reach", "built", "check"]);
        expect(byId(cards, "behavior")?.value).toBe("Sums a column");
        expect(byId(cards, "reach")?.value).toBe("Feeds 1 measure · 1 hop deep");
        expect(byId(cards, "reach")?.tone).toBe("reach");
        expect(byId(cards, "built")?.value).toBe("1 table");
        expect(byId(cards, "check")?.value).toBe("No description");
    });

    it("reports nothing downstream when the graph is present but empty", () => {
        const leaf = meas("Leaf", {
            dax: "SUM('X'[a])",
            dependsOnColumns: ["'X'[a]"],
            usedByMeasures: [],
            description: "A described leaf measure.",
        });
        const cards = buildAnswer(catalog({ measures: [leaf] }), leaf);
        expect(ids(cards)).toEqual(["behavior", "reach", "built"]);
        expect(byId(cards, "reach")?.value).toBe("Nothing downstream depends on it");
        expect(byId(cards, "reach")?.tone).toBe("neutral");
    });

    it("omits reach entirely on a thin live measure (no dependency graph)", () => {
        const thin = meas("Thin", {}); // no dax, usedByMeasures undefined
        const cards = buildAnswer(catalog({ measures: [thin] }), thin);
        expect(ids(cards)).toEqual(["check"]);
        expect(byId(cards, "check")?.value).toBe("No description · No formula available");
    });

    it("surfaces a trust signal with its match rate", () => {
        const m = meas("Trusted", {
            dax: "SUM('X'[a])",
            usedByMeasures: [],
            description: "d",
            trust: { level: "high", hasStaleSource: false, qaPassRate: 0.98 },
        });
        const trust = byId(buildAnswer(catalog({ measures: [m] }), m), "trust");
        expect(trust?.value).toBe("Trusted · 98% match");
        expect(trust?.tone).toBe("trust-high");
    });
});

describe("buildAnswer — column", () => {
    it("derives role and reach from the measures that read it", () => {
        const cat = catalog({ measures: [meas("Total Sales", {})] });
        const c = col("Product", "Category", { usedByMeasures: ["total sales"] });
        const cards = buildAnswer(cat, c);
        expect(ids(cards)).toEqual(["role", "reach"]);
        expect(byId(cards, "role")?.value).toBe("Slice / grouping field");
        expect(byId(cards, "reach")?.value).toBe("Read by 1 measure");
    });

    it("shows live value count and skips reach without a graph", () => {
        const c = col("Date", "Month", {
            liveValues: ["Jan", "Feb", "Mar"],
            usedByMeasures: undefined,
        });
        const cards = buildAnswer(catalog({ columns: [c] }), c);
        expect(ids(cards)).toEqual(["role", "values"]);
        expect(byId(cards, "values")?.value).toBe("3 distinct values");
    });

    it("labels a non-dimension column a detail field", () => {
        const c = col("Sales", "RowId", { isDimensionLike: false, usedByMeasures: undefined });
        expect(byId(buildAnswer(catalog({ columns: [c] }), c), "role")?.value).toBe("Detail field");
    });
});

describe("buildAnswer — table", () => {
    it("derives role, shape and source for a fact table", () => {
        const t = tbl("Sales", {
            ontology: "fact",
            columnCount: 8,
            measureCount: 12,
            sourceSystem: "ERP",
            trust: { level: "watch", hasStaleSource: true, note: "Loaded 5d ago" },
        });
        const cards = buildAnswer(catalog({ tables: [t] }), t);
        expect(ids(cards)).toEqual(["role", "shape", "source", "trust"]);
        expect(byId(cards, "role")?.value).toBe("Fact table");
        expect(byId(cards, "shape")?.value).toBe("8 columns · 12 measures");
        expect(byId(cards, "trust")?.tone).toBe("trust-watch");
    });

    it("shows the hub rank for a dimension many facts join", () => {
        const t = tbl("Product", { ontology: "dimension", columnCount: 5, measureCount: 0, hubRank: 3 });
        const hub = byId(buildAnswer(catalog({ tables: [t] }), t), "hub");
        expect(hub?.value).toBe("3 facts join here");
        expect(hub?.tone).toBe("reach");
    });
});
