//-----------------------------------------------------------------------
// Semantic Directory — tests for the DAX dependency parser.
//
// The parser is the deterministic core behind "built from" / lineage, so its
// classification rules (bare bracket = measure, qualified bracket = column,
// bare identifier arg = table) are worth pinning down.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseDax } from "@/catalog/model/dax-parse";

const known = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));

describe("parseDax", () => {
    it("returns empty refs for null / empty DAX", () => {
        expect(parseDax(null, known([]))).toEqual({
            measures: [],
            columns: [],
            tables: [],
            unresolved: [],
        });
        expect(parseDax("", known([])).columns).toEqual([]);
    });

    it("classifies a bare bracket as a measure when it is known", () => {
        const refs = parseDax("[Total Sales] * 1.1", known(["total sales"]));
        expect(refs.measures).toEqual(["total sales"]);
        expect(refs.unresolved).toEqual([]);
    });

    it("classifies an unknown bare bracket as unresolved", () => {
        const refs = parseDax("[Mystery Metric]", known(["total sales"]));
        expect(refs.measures).toEqual([]);
        expect(refs.unresolved).toEqual(["Mystery Metric"]);
    });

    it("extracts qualified column refs and their tables", () => {
        const refs = parseDax("SUM('Sales Fact'[Amount]) + Product[Units]", known([]));
        expect(refs.columns).toContain("'Sales Fact'[Amount]");
        expect(refs.columns).toContain("'Product'[Units]");
        expect(refs.tables).toEqual(expect.arrayContaining(["Sales Fact", "Product"]));
    });

    it("does not treat a qualified column as a bare measure", () => {
        const refs = parseDax("CALCULATE(SUM(Product[Units]))", known(["units"]));
        expect(refs.measures).toEqual([]);
        expect(refs.columns).toEqual(["'Product'[Units]"]);
    });

    it("picks up bare table arguments to iterators when the table is known", () => {
        const refs = parseDax(
            "CALCULATE([Revenue], FILTER(Sales_Fact, Sales_Fact[Region] = \"NA\"))",
            known(["revenue"]),
            known(["sales_fact"]),
        );
        expect(refs.measures).toEqual(["revenue"]);
        expect(refs.tables).toContain("Sales_Fact");
    });

    it("produces sorted, de-duplicated output", () => {
        const refs = parseDax("[B] + [A] + [A]", known(["a", "b"]));
        expect(refs.measures).toEqual(["a", "b"]);
    });
});
