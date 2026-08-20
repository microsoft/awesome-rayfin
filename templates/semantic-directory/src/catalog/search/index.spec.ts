//-----------------------------------------------------------------------
// Semantic Directory — spec for fuzzy identifier search.
//
// Documents the boundary-aware tokenizer and substring fallback using
// synthetic, model-agnostic sample fields. These fixtures are invented to read
// as a specification of the feature — they are NOT a snapshot of any real model.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { buildSearchIndex, search, splitIdentifier } from "./index";
import { catalog, col } from "../test-fixtures";
import type { ColumnMeta } from "../model/types";

/** Build a search index over a handful of sample columns. */
function indexWithColumns(...columns: ColumnMeta[]) {
    return buildSearchIndex(catalog({ columns }));
}

/** Column names returned for a query, for concise assertions. */
function hitNames(index: ReturnType<typeof buildSearchIndex>, query: string): string[] {
    return search(index, query).map((h) => h.name);
}

describe("splitIdentifier", () => {
    it("splits camelCase into whole token plus sub-parts", () => {
        const parts = splitIdentifier("isActiveCustomer");
        expect(parts).toContain("isactivecustomer");
        expect(parts).toContain("is");
        expect(parts).toContain("active");
        expect(parts).toContain("customer");
    });

    it("splits an embedded acronym and keeps the whole token", () => {
        const parts = splitIdentifier("NetRevenueUSD");
        expect(parts).toContain("netrevenueusd");
        expect(parts).toContain("net");
        expect(parts).toContain("revenue");
        expect(parts).toContain("usd");
    });

    it("keeps a letter+digit token intact (does not split ME5 into me + 5)", () => {
        const parts = splitIdentifier("ME5Flag");
        expect(parts).toContain("me5");
        expect(parts).toContain("flag");
        expect(parts).not.toContain("5");
        expect(parts).not.toContain("me");
    });

    it("leaves a plain single word unchanged (aside from lowercasing)", () => {
        expect(splitIdentifier("Region")).toEqual(["region"]);
    });
});

describe("search — fuzzy identifier matching", () => {
    it("finds a camelCase field by an inner word", () => {
        const index = indexWithColumns(col("Customer", "isActiveCustomer"));
        expect(hitNames(index, "Active")).toContain("isActiveCustomer");
    });

    it("finds an acronym field by either the word or the acronym", () => {
        const index = indexWithColumns(col("Sales", "NetRevenueUSD"));
        expect(hitNames(index, "Revenue")).toContain("NetRevenueUSD");
        expect(hitNames(index, "USD")).toContain("NetRevenueUSD");
    });

    it("finds a letter+digit field by its whole token", () => {
        const index = indexWithColumns(col("Flags", "ME5Flag"));
        expect(hitNames(index, "ME5")).toContain("ME5Flag");
    });

    it("still matches an ordinary whole-word field (regression guard)", () => {
        const index = indexWithColumns(col("Geography", "Region"));
        expect(hitNames(index, "Region")).toContain("Region");
    });

    it("falls back to a substring scan for a mid-token fragment", () => {
        // "smargi" spans the gross|margin boundary as a single lowercase token,
        // so it is neither a prefix nor a fuzzy match of any indexed sub-term —
        // only the substring scan over the field text can reach it.
        const index = indexWithColumns(col("Profitability", "GrossMarginRatio"));
        expect(hitNames(index, "smargi")).toContain("GrossMarginRatio");
    });
});
