import { describe, it, expect } from "vitest";
import {
  applyFilters,
  encodeFilters,
  decodeFilters,
  countActive,
  distinctValues,
  tableToTsv,
  formatCell,
} from "@/finance";
import type { DataTable } from "@/finance";

// Breadth coverage over the adoption-critical pure utilities an adopter relies
// on directly: URL filter round-trips, client-side filtering, clipboard TSV,
// and the model-format-string renderer.

const table: DataTable = {
  columns: [
    { key: "segment", label: "Segment" },
    { key: "region", label: "Region" },
    { key: "revenue", label: "Revenue" },
  ],
  rows: [
    { segment: "Cloud", region: "Americas", revenue: 120 },
    { segment: "Cloud", region: "EMEA", revenue: 80 },
    { segment: "Gaming", region: "Americas", revenue: 40 },
  ],
};

describe("filters", () => {
  it("filters rows with AND across columns", () => {
    const out = applyFilters(table, { segment: "Cloud", region: "Americas" });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].revenue).toBe(120);
  });

  it("returns the same table when no filters are active", () => {
    expect(applyFilters(table, {}).rows).toHaveLength(3);
  });

  it("lists distinct column values in first-seen order", () => {
    expect(distinctValues(table, "segment")).toEqual(["Cloud", "Gaming"]);
  });

  it("counts only non-empty filters", () => {
    expect(countActive({ segment: "Cloud", region: "" })).toBe(1);
  });
});

describe("filter URL codec", () => {
  it("round-trips through encode/decode", () => {
    const state = { segment: "Cloud", region: "Americas" };
    expect(decodeFilters(encodeFilters(state))).toEqual(state);
  });

  it("preserves tilde-containing values (the delimiter-collision guard)", () => {
    const state = { note: "a~b" };
    const encoded = encodeFilters(state);
    expect(encoded).not.toContain("a~b"); // tilde must be escaped, not literal
    expect(decodeFilters(encoded)).toEqual(state);
  });

  it("decodes empty param to an empty state", () => {
    expect(decodeFilters("")).toEqual({});
  });
});

describe("clipboard TSV", () => {
  it("emits a header row plus one row per record, tab-delimited", () => {
    const tsv = tableToTsv(table);
    const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines[0]).toBe("Segment\tRegion\tRevenue");
    expect(lines).toHaveLength(4);
    expect(lines[1].split("\t")[0]).toBe("Cloud");
  });
});

describe("formatCell (model format strings)", () => {
  it("applies currency grouping", () => {
    expect(formatCell(1234.5, "$#,##0")).toBe("$1,235");
  });

  it("scales ratios to percent", () => {
    expect(formatCell(0.156, "0.0%")).toBe("15.6%");
  });

  it("returns empty string for null/blank", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell("")).toBe("");
  });
});
