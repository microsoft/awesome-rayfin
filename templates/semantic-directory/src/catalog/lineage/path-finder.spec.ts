//-----------------------------------------------------------------------
// Semantic Directory — tests for the relationship path-finder.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
    findRelationshipPath,
    pathTableOptions,
} from "./path-finder";
import { catalog, rel, tbl } from "../test-fixtures";

// A small star + snowflake: Sales(fact) → Product → Category, Sales → Date.
// City is an island (no relationships).
const model = catalog({
    tables: [
        tbl("Sales"),
        tbl("Product"),
        tbl("Category"),
        tbl("Date"),
        tbl("City"),
    ],
    relationships: [
        rel("Sales", "ProductKey", "Product", "ProductKey"),
        rel("Product", "CategoryKey", "Category", "CategoryKey"),
        rel("Sales", "DateKey", "Date", "DateKey"),
        rel("Sales", "OldKey", "Date", "OldKey", { isActive: false }),
    ],
});

describe("findRelationshipPath", () => {
    it("returns an empty-hop path when source and target are the same table", () => {
        const path = findRelationshipPath(model, "Sales", "Sales");
        expect(path).toEqual({ tables: ["Sales"], hops: [], length: 0, pathCount: 1 });
    });

    it("finds a direct one-hop join and orients columns by travel direction", () => {
        const path = findRelationshipPath(model, "Sales", "Product")!;
        expect(path.length).toBe(1);
        expect(path.tables).toEqual(["Sales", "Product"]);
        expect(path.hops[0]).toMatchObject({
            fromTable: "Sales",
            toTable: "Product",
            fromColumn: "ProductKey",
            toColumn: "ProductKey",
            fromCardinality: "Many",
            toCardinality: "One",
        });
    });

    it("swaps column/cardinality orientation when traversing a relationship backwards", () => {
        const path = findRelationshipPath(model, "Product", "Sales")!;
        expect(path.hops[0]).toMatchObject({
            fromTable: "Product",
            toTable: "Sales",
            fromCardinality: "One",
            toCardinality: "Many",
        });
    });

    it("finds a multi-hop snowflake path (Sales → Product → Category)", () => {
        const path = findRelationshipPath(model, "Sales", "Category")!;
        expect(path.tables).toEqual(["Sales", "Product", "Category"]);
        expect(path.length).toBe(2);
    });

    it("returns null when no active path connects the tables (island)", () => {
        expect(findRelationshipPath(model, "Sales", "City")).toBeNull();
    });

    it("ignores inactive relationships when pathing", () => {
        // Date is reachable via the ACTIVE DateKey join, not the inactive OldKey.
        const path = findRelationshipPath(model, "Sales", "Date")!;
        expect(path.hops[0].fromColumn).toBe("DateKey");
    });

    it("returns null for an unknown table", () => {
        expect(findRelationshipPath(model, "Sales", "Nope")).toBeNull();
    });

    it("flags a hop as bidirectional only when the relationship filters both ways", () => {
        const biModel = catalog({
            tables: [tbl("A"), tbl("B"), tbl("C")],
            relationships: [
                rel("A", "k", "B", "k", { crossFilter: "BothDirections" }),
                rel("B", "k", "C", "k", { crossFilter: "OneDirection" }),
            ],
        });
        const path = findRelationshipPath(biModel, "A", "C")!;
        expect(path.hops[0].bidirectional).toBe(true);
        expect(path.hops[1].bidirectional).toBe(false);
    });

    it("reports a single shortest path (pathCount 1) when the route is unique", () => {
        const path = findRelationshipPath(model, "Sales", "Category")!;
        expect(path.pathCount).toBe(1);
    });
});

describe("findRelationshipPath — equal-length alternates + determinism", () => {
    // Diamond: A→B→D and A→C→D are both 2-hop shortest paths.
    const diamond = catalog({
        tables: [tbl("A"), tbl("B"), tbl("C"), tbl("D")],
        relationships: [
            rel("A", "k", "B", "k"),
            rel("A", "k", "C", "k"),
            rel("B", "k", "D", "k"),
            rel("C", "k", "D", "k"),
        ],
    });

    it("counts equal-length alternate paths", () => {
        const path = findRelationshipPath(diamond, "A", "D")!;
        expect(path.length).toBe(2);
        expect(path.pathCount).toBe(2);
    });

    it("picks a deterministic path via the tie-break (dest name asc → B before C)", () => {
        const path = findRelationshipPath(diamond, "A", "D")!;
        expect(path.tables).toEqual(["A", "B", "D"]);
    });

    it("yields the same displayed path regardless of relationship insertion order", () => {
        const reordered = catalog({
            tables: [tbl("A"), tbl("B"), tbl("C"), tbl("D")],
            relationships: [
                rel("C", "k", "D", "k"),
                rel("A", "k", "C", "k"),
                rel("B", "k", "D", "k"),
                rel("A", "k", "B", "k"),
            ],
        });
        expect(findRelationshipPath(reordered, "A", "D")!.tables).toEqual(["A", "B", "D"]);
    });
});

describe("pathTableOptions", () => {
    it("lists visible tables and flags island tables as unconnected", () => {
        const options = pathTableOptions(model);
        expect(options.map((o) => o.name)).toEqual([
            "Category",
            "City",
            "Date",
            "Product",
            "Sales",
        ]);
        expect(options.find((o) => o.name === "City")!.connected).toBe(false);
        expect(options.find((o) => o.name === "Sales")!.connected).toBe(true);
    });
});
