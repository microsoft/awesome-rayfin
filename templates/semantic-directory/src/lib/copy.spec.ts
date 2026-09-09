//-----------------------------------------------------------------------
// Semantic Directory — tests for the copy helpers.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { pluralize, countNoun, pathSummary } from "./copy";

describe("pluralize", () => {
    it("uses the singular only for exactly one", () => {
        expect(pluralize(1, "hop")).toBe("hop");
        expect(pluralize(0, "hop")).toBe("hops");
        expect(pluralize(2, "hop")).toBe("hops");
    });

    it("honours an explicit plural form", () => {
        expect(pluralize(3, "index", "indexes")).toBe("indexes");
        expect(pluralize(1, "index", "indexes")).toBe("index");
    });
});

describe("countNoun", () => {
    it("pairs the number with the correct noun form", () => {
        expect(countNoun(0, "measure")).toBe("0 measures");
        expect(countNoun(1, "measure")).toBe("1 measure");
        expect(countNoun(5, "measure")).toBe("5 measures");
    });
});

describe("pathSummary", () => {
    it("reads correctly at zero, one, and many hops", () => {
        expect(pathSummary(0, 1)).toBe("0 hops · 1 table");
        expect(pathSummary(1, 2)).toBe("1 hop · 2 tables");
        expect(pathSummary(2, 3)).toBe("2 hops · 3 tables");
    });
});
