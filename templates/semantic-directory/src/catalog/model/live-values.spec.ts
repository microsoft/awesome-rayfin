import { describe, expect, it } from "vitest";
import type { QueryTable } from "@microsoft/fabric-app-data";
import type { ValueColumnRef } from "@/queries/metadata";
import {
    capValueRefs,
    collectValueBatchResults,
    parseCardinalities,
} from "./live-values";

/** Minimal QueryTable factory (positional rows keyed by column defs). */
function table(columns: string[], rows: unknown[][]): QueryTable {
    return {
        columns: columns.map((name) => ({ name })),
        rows,
    } as unknown as QueryTable;
}

const ref = (t: string, c: string): ValueColumnRef => ({ table: t, column: c });

describe("parseCardinalities", () => {
    it("maps lowercased table[column] -> distinct count", () => {
        const t = table(
            ["[Ref]", "[N]"],
            [
                ["Product[Category]", 12],
                ["Customer[Email]", 480_000],
            ],
        );
        const counts = parseCardinalities([t]);
        expect(counts.get("product[category]")).toBe(12);
        expect(counts.get("customer[email]")).toBe(480_000);
    });

    it("ignores rows with missing ref or non-finite count", () => {
        const t = table(
            ["[Ref]", "[N]"],
            [
                ["", 5],
                ["Sales[Region]", null],
                ["Sales[Channel]", 4],
            ],
        );
        const counts = parseCardinalities([t]);
        expect(counts.size).toBe(1);
        expect(counts.get("sales[channel]")).toBe(4);
    });
});

describe("capValueRefs", () => {
    const refs = [ref("Product", "Category"), ref("Customer", "Email")];

    it("drops columns above the cardinality cap", () => {
        const counts = new Map([
            ["product[category]", 12],
            ["customer[email]", 480_000],
        ]);
        const kept = capValueRefs(refs, counts, 50_000);
        expect(kept).toEqual([ref("Product", "Category")]);
    });

    it("keeps columns with no probed count (unknown -> include)", () => {
        const counts = new Map([["product[category]", 12]]);
        const kept = capValueRefs(refs, counts, 50_000);
        expect(kept).toEqual(refs);
    });

    it("returns every ref when no cardinalities were probed", () => {
        expect(capValueRefs(refs, new Map(), 50_000)).toEqual(refs);
    });
});

describe("collectValueBatchResults", () => {
    const t1 = table(["[Ref]", "[Val]"], []);
    const batches = [
        { refs: [ref("A", "x"), ref("A", "y")] }, // multi-column
        { refs: [ref("B", "z")] }, // single-column
    ];

    it("collects resolved tables and retries only failed multi-column batches", () => {
        const settled: PromiseSettledResult<QueryTable>[] = [
            { status: "rejected", reason: new Error("Access Denied") },
            { status: "fulfilled", value: t1 },
        ];
        const { tables, retryRefs } = collectValueBatchResults(batches, settled);
        expect(tables).toEqual([t1]);
        expect(retryRefs).toEqual([ref("A", "x"), ref("A", "y")]);
    });

    it("does not retry a failed single-column batch (nothing to isolate)", () => {
        const settled: PromiseSettledResult<QueryTable>[] = [
            { status: "fulfilled", value: t1 },
            { status: "rejected", reason: new Error("Access Denied") },
        ];
        const { tables, retryRefs } = collectValueBatchResults(batches, settled);
        expect(tables).toEqual([t1]);
        expect(retryRefs).toEqual([]);
    });
});
