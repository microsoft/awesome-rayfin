//-----------------------------------------------------------------------
// Semantic Directory — tests for deterministic search match evidence.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
    deriveMatchEvidence,
    highlightParts,
    queryTokens,
    type MatchEvidence,
} from "./evidence";
import { col, meas } from "../test-fixtures";

const kinds = (ev: MatchEvidence[]) => ev.map((e) => e.kind);
const labels = (ev: MatchEvidence[]) => ev.map((e) => e.label);

describe("queryTokens", () => {
    it("lowercases, splits on punctuation and drops 1-char noise + dupes", () => {
        expect(queryTokens("Total, Sales! total a")).toEqual(["total", "sales"]);
    });
    it("returns nothing for an empty query", () => {
        expect(queryTokens("   ")).toEqual([]);
    });
});

describe("deriveMatchEvidence", () => {
    it("reports a name match", () => {
        const ev = deriveMatchEvidence("sales", meas("Total Sales"));
        expect(kinds(ev)).toEqual(["name"]);
    });

    it("reports a business synonym with the matched phrase", () => {
        const ev = deriveMatchEvidence("revenue", meas("Total Sales", { synonyms: ["revenue", "net"] }));
        expect(labels(ev)).toEqual(["Synonym “revenue”"]);
    });

    it("reports a live data value match on a column", () => {
        const ev = deriveMatchEvidence(
            "contoso",
            col("Customer", "Customer Name", { liveValues: ["Contoso Ltd", "Fabrikam"] }),
        );
        expect(labels(ev)).toEqual(["Value “Contoso Ltd”"]);
    });

    it("reports the home table when only the table name matches", () => {
        const ev = deriveMatchEvidence("sales", col("Sales", "Amount"));
        expect(labels(ev)).toEqual(["Table Sales"]);
    });

    it("reports the business topic", () => {
        const ev = deriveMatchEvidence("profitability", meas("Gross X", { topic: "Profitability" }));
        expect(labels(ev)).toEqual(["Topic Profitability"]);
    });

    it("reports a tag", () => {
        const ev = deriveMatchEvidence("target", meas("Quota", { tags: ["YoY", "target"] }));
        expect(labels(ev)).toEqual(["Tag “target”"]);
    });

    it("reports a description mention as the least-specific reason", () => {
        const ev = deriveMatchEvidence("margin", meas("Gross X", { description: "Gross margin ratio." }));
        expect(labels(ev)).toEqual(["Description mentions “margin”"]);
    });

    it("falls back to a neutral truth when no field literally matches", () => {
        const ev = deriveMatchEvidence("revenue", meas("Units"));
        expect(ev).toEqual([{ kind: "text", label: "Matched searchable text" }]);
    });

    it("caps at two reasons, ordered by specificity", () => {
        const m = meas("Sales Amount", {
            synonyms: ["sales revenue"],
            topic: "Sales",
            tags: ["sales"],
        });
        const ev = deriveMatchEvidence("sales", m);
        expect(kinds(ev)).toEqual(["name", "synonym"]);
    });

    it("collects across multiple fields for a multi-token query", () => {
        const m = meas("Total Margin", { description: "Gross margin ratio." });
        expect(kinds(deriveMatchEvidence("total ratio", m))).toEqual(["name", "description"]);
    });

    it("prefers evidence covering distinct tokens over a duplicate-token match", () => {
        // "sales" hits both name and synonym; "margin" only hits the description.
        const m = meas("Total Sales", { synonyms: ["net sales"], description: "Gross margin ratio." });
        expect(kinds(deriveMatchEvidence("sales margin", m))).toEqual(["name", "description"]);
    });

    it("returns nothing for an empty query", () => {
        expect(deriveMatchEvidence("", meas("Total Sales"))).toEqual([]);
    });
});

describe("highlightParts", () => {
    it("flags the matched span, leaving surrounding text unflagged", () => {
        expect(highlightParts("Total Sales", ["sales"])).toEqual([
            { text: "Total ", hit: false },
            { text: "Sales", hit: true },
        ]);
    });

    it("matches case-insensitively", () => {
        expect(highlightParts("SALES report", ["sales"])).toEqual([
            { text: "SALES", hit: true },
            { text: " report", hit: false },
        ]);
    });

    it("returns the whole string unflagged when there are no tokens", () => {
        expect(highlightParts("Total Sales", [])).toEqual([{ text: "Total Sales", hit: false }]);
    });

    it("returns nothing for empty text", () => {
        expect(highlightParts("", ["sales"])).toEqual([]);
    });

    it("marks the fullest span when tokens overlap", () => {
        expect(highlightParts("Sales", ["sale", "sales"])).toEqual([{ text: "Sales", hit: true }]);
    });

    it("escapes regex-special characters in tokens", () => {
        expect(highlightParts("a+b c", ["a+b"])).toEqual([
            { text: "a+b", hit: true },
            { text: " c", hit: false },
        ]);
    });
});
