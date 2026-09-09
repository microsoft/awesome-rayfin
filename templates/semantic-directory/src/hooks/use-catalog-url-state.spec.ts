import { describe, expect, it } from "vitest";
import {
    parseCatalogHash,
    serializeCatalogHash,
    type CatalogUrlState,
} from "./use-catalog-url-state";

describe("parseCatalogHash", () => {
    it("returns defaults for an empty hash", () => {
        expect(parseCatalogHash("")).toEqual({ query: "", filter: "all" });
        expect(parseCatalogHash("#")).toEqual({ query: "", filter: "all" });
    });

    it("reads every field", () => {
        const s = parseCatalogHash(
            "#q=total+sales&filter=measure&sel=measure:total+sales&topic=Sales&theme=geo&tool=health",
        );
        expect(s).toEqual({
            query: "total sales",
            filter: "measure",
            selectedKey: "measure:total sales",
            browseTopic: "Sales",
            browseThemeId: "geo",
            tool: "health",
        });
    });

    it("rejects unknown filter and tool values", () => {
        const s = parseCatalogHash("#filter=bogus&tool=wat");
        expect(s.filter).toBe("all");
        expect(s.tool).toBeUndefined();
    });

    it("round-trips an entity key with brackets and spaces", () => {
        const key = "column:sales_fact[unit price]";
        const hash = serializeCatalogHash({
            query: "",
            filter: "all",
            selectedKey: key,
        });
        expect(parseCatalogHash(`#${hash}`).selectedKey).toBe(key);
    });
});

describe("serializeCatalogHash", () => {
    it("omits default and empty values", () => {
        expect(serializeCatalogHash({ query: "", filter: "all" })).toBe("");
        expect(serializeCatalogHash({ query: "   ", filter: "all" })).toBe("");
    });

    it("emits only the set fields", () => {
        const state: CatalogUrlState = {
            query: "revenue",
            filter: "all",
            tool: "pathfinder",
        };
        const parsed = parseCatalogHash(`#${serializeCatalogHash(state)}`);
        expect(parsed.query).toBe("revenue");
        expect(parsed.filter).toBe("all");
        expect(parsed.tool).toBe("pathfinder");
        expect(parsed.selectedKey).toBeUndefined();
    });

    it("is a stable round-trip for a full state", () => {
        const state: CatalogUrlState = {
            query: "gross margin",
            filter: "column",
            selectedKey: "table:date",
            browseTopic: "Finance",
            browseThemeId: "time",
            tool: "pathfinder",
        };
        expect(parseCatalogHash(`#${serializeCatalogHash(state)}`)).toEqual(state);
    });

    it("round-trips the impact root only with the impact tool", () => {
        const key = "measure:total sales";
        const withTool: CatalogUrlState = { query: "", filter: "all", tool: "impact", impactKey: key };
        expect(parseCatalogHash(`#${serializeCatalogHash(withTool)}`)).toEqual(withTool);

        // The impact key is dropped when another tool is active — it only
        // travels with its own view.
        const otherTool: CatalogUrlState = { query: "", filter: "all", tool: "health", impactKey: key };
        expect(parseCatalogHash(`#${serializeCatalogHash(otherTool)}`).impactKey).toBeUndefined();
    });
});
