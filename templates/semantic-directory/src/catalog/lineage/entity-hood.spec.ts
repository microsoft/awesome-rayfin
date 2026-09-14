//-----------------------------------------------------------------------
// Semantic Directory — tests for entity neighborhood sector cap + ranking.
//
// The constellation is the app's heaviest render surface. buildEntityHood caps
// every sector at SECTOR_CAP (24) after deterministic ranking, so a hub entity
// in a LARGE model stays legible + performant while still reporting its true
// `total`. Small models must be untouched.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildEntityHood, type EntityHood } from "./entity-hood";
import type { MeasureFamily } from "../model/types";
import { catalog, meas, tbl, rel } from "../test-fixtures";

const CAP = 24;

function usedBySector(hood: EntityHood | null) {
    return hood?.sectors.find((s) => s.id === "usedby");
}

describe("buildEntityHood — sector cap", () => {
    it("caps a huge downstream sector at 24 while reporting the true total", () => {
        // A foundational measure read by 30 others.
        const feeders = Array.from({ length: 30 }, (_, i) => `Feeder ${String(i).padStart(2, "0")}`);
        const root = meas("Root", { usedByMeasures: feeders });
        const model = catalog({
            measures: [root, ...feeders.map((n) => meas(n, {}))],
        });

        const sector = usedBySector(buildEntityHood(model, root));
        expect(sector).toBeDefined();
        expect(sector!.total).toBe(30);
        expect(sector!.nodes).toHaveLength(CAP);
    });

    it("leaves a small sector uncapped (total === nodes.length)", () => {
        const feeders = ["Alpha", "Beta", "Gamma"];
        const root = meas("Root", { usedByMeasures: feeders });
        const model = catalog({ measures: [root, ...feeders.map((n) => meas(n, {}))] });

        const sector = usedBySector(buildEntityHood(model, root));
        expect(sector!.total).toBe(3);
        expect(sector!.nodes).toHaveLength(3);
    });
});

describe("buildEntityHood — deterministic ranking", () => {
    it("keeps the most-connected measures when a sector is capped", () => {
        // 30 feeders; one ("Zeta") is itself read by many, so despite sorting
        // last alphabetically it must survive the cap and lead the sector.
        const feeders = Array.from({ length: 30 }, (_, i) => `Feeder ${String(i).padStart(2, "0")}`);
        const important = meas("Zeta", { usedByMeasures: ["a", "b", "c", "d", "e"] });
        const root = meas("Root", { usedByMeasures: [...feeders, "Zeta"] });
        const model = catalog({
            measures: [root, important, ...feeders.map((n) => meas(n, {}))],
        });

        const sector = usedBySector(buildEntityHood(model, root));
        expect(sector!.total).toBe(31);
        expect(sector!.nodes[0].label).toBe("Zeta");
        expect(sector!.nodes).toHaveLength(CAP);
    });

    it("is stable across rebuilds (same order every time)", () => {
        const feeders = Array.from({ length: 30 }, (_, i) => `Feeder ${String(i).padStart(2, "0")}`);
        const root = meas("Root", { usedByMeasures: feeders });
        const model = catalog({ measures: [root, ...feeders.map((n) => meas(n, {}))] });

        const first = usedBySector(buildEntityHood(model, root))!.nodes.map((n) => n.key);
        // Rebuild against a fresh catalog with the feeders declared in reverse.
        const model2 = catalog({
            measures: [meas("Root", { usedByMeasures: feeders }), ...[...feeders].reverse().map((n) => meas(n, {}))],
        });
        const second = usedBySector(buildEntityHood(model2, model2.measures[0]))!.nodes.map((n) => n.key);
        expect(second).toEqual(first);
    });
});

describe("buildEntityHood — table hub cap", () => {
    it("caps 'Referenced by' at 24 and orders neighbours alphabetically", () => {
        const hub = tbl("Sales");
        const dims = Array.from({ length: 30 }, (_, i) => tbl(`Dim ${String(i).padStart(2, "0")}`));
        const rels = dims.map((d) => rel(d.name, "id", "Sales", "id"));
        const model = catalog({ tables: [hub, ...dims], relationships: rels });

        const sector = buildEntityHood(model, hub)?.sectors.find((s) => s.id === "refby");
        expect(sector).toBeDefined();
        expect(sector!.total).toBe(30);
        expect(sector!.nodes).toHaveLength(CAP);
        expect(sector!.nodes[0].label).toBe("Dim 00");
        expect(sector!.nodes[CAP - 1].label).toBe(`Dim ${String(CAP - 1).padStart(2, "0")}`);
    });

    it("reports the true total for a table's hosted measures (no hidden pre-cap)", () => {
        const host = tbl("Metrics");
        const measures = Array.from({ length: 30 }, (_, i) =>
            meas(`M ${String(i).padStart(2, "0")}`, { table: "Metrics" }),
        );
        const model = catalog({ tables: [host], measures });

        const hosted = buildEntityHood(model, host)?.sectors.find((s) => s.id === "hosted");
        expect(hosted!.total).toBe(30);
        expect(hosted!.nodes).toHaveLength(CAP);
    });

    it("dedupes multiple relationships between the same table pair", () => {
        const hub = tbl("Sales");
        const dim = tbl("Date");
        const rels = [
            rel("Date", "id", "Sales", "dateId"),
            rel("Date", "id", "Sales", "shipDateId"),
        ];
        const model = catalog({ tables: [hub, dim], relationships: rels });

        const hood = buildEntityHood(model, hub);
        const refby = hood?.sectors.find((s) => s.id === "refby");
        expect(refby!.total).toBe(1);
        expect(refby!.nodes).toHaveLength(1);
        expect(hood!.summary).toContain("1 table point here");
    });
});

describe("buildEntityHood — family siblings + input order", () => {
    it("resolves family siblings from memberKeys (entity keys, not names)", () => {
        const a = meas("Sales Amount", { familyId: "fam" });
        const b = meas("Sales Amount LY", { familyId: "fam" });
        const c = meas("Sales Amount YoY", { familyId: "fam" });
        const model = catalog({
            measures: [a, b, c],
            families: [
                {
                    id: "fam",
                    name: "Sales Amount",
                    memberKeys: [a.key, b.key, c.key],
                    members: [a.name, b.name, c.name],
                    sourceSystems: [],
                } as MeasureFamily,
            ],
        });

        const fam = buildEntityHood(model, a)?.sectors.find((s) => s.id === "family");
        expect(fam).toBeDefined();
        expect(fam!.total).toBe(2);
        expect(fam!.nodes.map((n) => n.key).sort()).toEqual([b.key, c.key].sort());
    });

    it("preserves input order for sectors that fit (no cap-time reshuffle)", () => {
        // "Third" is the heaviest (declared last) but the sector fits under the
        // cap, so it must NOT jump to the front — small models never reorder.
        const feeders = ["First", "Second", "Third"];
        const root = meas("Root", { usedByMeasures: feeders });
        const model = catalog({
            measures: [
                root,
                meas("First", {}),
                meas("Second", {}),
                meas("Third", { usedByMeasures: ["x", "y", "z"] }),
            ],
        });

        const sector = usedBySector(buildEntityHood(model, root));
        expect(sector!.nodes.map((n) => n.label)).toEqual(["First", "Second", "Third"]);
    });
});
