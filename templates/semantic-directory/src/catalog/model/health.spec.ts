//-----------------------------------------------------------------------
// Semantic Directory — tests for the model health scorecard.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { analyzeHealth } from "./health";
import { catalog, col, meas, rel, tbl } from "../test-fixtures";

describe("analyzeHealth", () => {
    it("gives a clean, fully-documented model a perfect A", () => {
        const model = catalog({
            measures: [
                meas("Total Sales", {
                    description: "Sum of sales.",
                    formatString: "#,0",
                }),
            ],
            columns: [col("Product", "Category")],
            tables: [tbl("Sales"), tbl("Product")],
            relationships: [rel("Sales", "ProductKey", "Product", "ProductKey")],
        });
        const report = analyzeHealth(model);
        expect(report.score).toBe(100);
        expect(report.grade).toBe("A");
        expect(report.rules.every((r) => r.offenderCount === 0)).toBe(true);
    });

    it("penalizes measures missing descriptions (heaviest rule)", () => {
        const model = catalog({
            measures: [
                meas("A", { formatString: "#,0" }),
                meas("B", { formatString: "#,0" }),
            ],
            tables: [tbl("Measures")],
        });
        const report = analyzeHealth(model);
        // Both measures undescribed → ratio 1.0 × weight 30 = 30 penalty.
        expect(report.score).toBe(70);
        const rule = report.rules.find((r) => r.id === "measure-no-description")!;
        expect(rule.offenderCount).toBe(2);
        expect(rule.penalty).toBeCloseTo(30);
    });

    it("flags an island table with dimension columns but no relationships", () => {
        const model = catalog({
            measures: [meas("M", { description: "x", formatString: "#,0" })],
            columns: [col("Orphan", "Label"), col("Product", "Category")],
            tables: [tbl("Orphan"), tbl("Product"), tbl("Sales")],
            relationships: [rel("Sales", "ProductKey", "Product", "ProductKey")],
        });
        const report = analyzeHealth(model);
        const rule = report.rules.find((r) => r.id === "island-table")!;
        expect(rule.offenders).toContain("Orphan");
        // Product is joined; Sales has no dimension columns → neither flagged.
        expect(rule.offenders).not.toContain("Product");
        expect(rule.offenders).not.toContain("Sales");
    });

    it("does not flag a role-playing dimension joined only via an inactive relationship", () => {
        // Date joins Sales on OrderDate (active) and ShipDate (inactive). A
        // date table used ONLY via USERELATIONSHIP is correctly modelled.
        const model = catalog({
            measures: [meas("M", { description: "x", formatString: "#,0" })],
            columns: [col("Date", "Year"), col("Sales", "Amount", { isDimensionLike: false })],
            tables: [tbl("Sales"), tbl("Date")],
            relationships: [
                rel("Sales", "ShipDate", "Date", "DateKey", { isActive: false }),
            ],
        });
        const report = analyzeHealth(model);
        const rule = report.rules.find((r) => r.id === "island-table")!;
        expect(rule.offenders).not.toContain("Date");
        expect(rule.offenderCount).toBe(0);
    });

    it("does not flag a measure-host table (no dimension columns) as an island", () => {
        const model = catalog({
            measures: [meas("Total", { description: "x", formatString: "#,0" })],
            columns: [], // measure host has no dimension columns
            tables: [tbl("Measures")],
        });
        const report = analyzeHealth(model);
        const rule = report.rules.find((r) => r.id === "island-table")!;
        expect(rule.offenderCount).toBe(0);
    });

    it("detects measure/column name collisions", () => {
        const model = catalog({
            measures: [meas("Margin", { description: "x", formatString: "#,0" })],
            columns: [col("Sales", "Margin")], // same name as the measure
            tables: [tbl("Sales")],
            relationships: [],
        });
        const report = analyzeHealth(model);
        const rule = report.rules.find((r) => r.id === "measure-column-collision")!;
        expect(rule.offenders).toEqual(["Margin"]);
    });

    it("surfaces inactive relationships as informational (no score impact)", () => {
        const clean = catalog({
            measures: [meas("M", { description: "x", formatString: "#,0" })],
            columns: [col("Product", "Category")],
            tables: [tbl("Sales"), tbl("Product")],
            relationships: [rel("Sales", "ProductKey", "Product", "ProductKey")],
        });
        const withInactive = catalog({
            ...clean,
            relationships: [
                rel("Sales", "ProductKey", "Product", "ProductKey"),
                rel("Sales", "AltKey", "Product", "AltKey", { isActive: false }),
            ],
        });
        const report = analyzeHealth(withInactive);
        expect(report.score).toBe(100); // informational rule doesn't dock points
        const info = report.rules.find((r) => r.id === "inactive-relationship")!;
        expect(info.weight).toBe(0);
        expect(info.offenderCount).toBe(1);
        // Informational rule sinks to the bottom of the list.
        expect(report.rules[report.rules.length - 1].id).toBe("inactive-relationship");
    });

    it("ignores hidden measures and columns", () => {
        const model = catalog({
            measures: [
                meas("Visible", { description: "x", formatString: "#,0" }),
                meas("Internal", { isHidden: true }), // no desc/format but hidden
            ],
            columns: [col("Product", "Key", { isHidden: true, isDimensionLike: true })],
            tables: [tbl("Product")],
        });
        const report = analyzeHealth(model);
        expect(report.score).toBe(100);
    });
});
