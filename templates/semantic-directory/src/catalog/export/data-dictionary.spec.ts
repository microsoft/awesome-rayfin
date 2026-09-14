//-----------------------------------------------------------------------
// Semantic Directory — tests for the data dictionary export.
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
    buildDataDictionary,
    dictionaryToCsv,
    dictionaryToMarkdown,
} from "./data-dictionary";
import { catalog, col, meas, tbl } from "../test-fixtures";

const model = catalog({
    tables: [
        tbl("Sales", { columnCount: 2, measureCount: 1 }),
        tbl("Secret", { isHidden: true }),
    ],
    measures: [
        meas("Total Sales", {
            table: "Sales",
            description: "Sum of the, comma value",
            formatString: "#,0",
            dataType: "Decimal",
        }),
        meas("Hidden Measure", { isHidden: true }),
    ],
    columns: [
        col("Sales", "Amount", { dataType: "Decimal", description: 'Has "quotes"' }),
        col("Sales", "Key", { isHidden: true }),
    ],
});

describe("buildDataDictionary", () => {
    it("excludes hidden entities by default", () => {
        const dict = buildDataDictionary(model, { modelName: "Contoso" });
        expect(dict.tables.map((t) => t.name)).toEqual(["Sales"]);
        expect(dict.measures.map((m) => m.name)).toEqual(["Total Sales"]);
        expect(dict.columns.map((c) => c.name)).toEqual(["Amount"]);
        expect(dict.modelName).toBe("Contoso");
    });

    it("includes hidden entities when asked", () => {
        const dict = buildDataDictionary(model, { includeHidden: true });
        expect(dict.tables.map((t) => t.name).sort()).toEqual(["Sales", "Secret"]);
        expect(dict.columns).toHaveLength(2);
        expect(dict.modelName).toBe("Semantic model"); // default when unnamed
    });
});

describe("dictionaryToCsv", () => {
    it("emits an RFC-4180 CSV with a header and CRLF rows", () => {
        const csv = dictionaryToCsv(buildDataDictionary(model));
        const lines = csv.split("\r\n");
        expect(lines[0]).toBe(
            "Kind,Name,Display Name,Table,Description,Data Type,Format String,Hidden",
        );
        // Table row first, then measure, then column.
        expect(lines[1].startsWith("Table,Sales,")).toBe(true);
        expect(lines).toHaveLength(4); // header + 1 table + 1 measure + 1 column
    });

    it("escapes commas and quotes per RFC 4180", () => {
        const csv = dictionaryToCsv(buildDataDictionary(model));
        // Comma in a description forces quoting.
        expect(csv).toContain('"Sum of the, comma value"');
        // Embedded double-quotes are doubled.
        expect(csv).toContain('"Has ""quotes"""');
    });

    it("escapes a field containing both a comma and a quote together", () => {
        const combo = catalog({
            measures: [meas("M", { table: "T", description: 'Sum, "x"' })],
            tables: [tbl("T")],
        });
        const csv = dictionaryToCsv(buildDataDictionary(combo));
        expect(csv).toContain('"Sum, ""x"""');
    });

    it("quotes a field with an embedded line ending", () => {
        const nl = catalog({
            measures: [meas("M", { table: "T", description: "line one\nline two" })],
            tables: [tbl("T")],
        });
        const csv = dictionaryToCsv(buildDataDictionary(nl));
        expect(csv).toContain('"line one\nline two"');
    });

    it("neutralizes CSV formula injection in string fields", () => {
        const evil = catalog({
            measures: [
                meas("M", { table: "T", description: "=HYPERLINK(\"http://x\")" }),
            ],
            tables: [tbl("T")],
        });
        const csv = dictionaryToCsv(buildDataDictionary(evil));
        expect(csv).toContain("'=HYPERLINK");
    });
});

describe("dictionaryToMarkdown", () => {
    it("renders sectioned tables and escapes pipes", () => {
        const withPipe = catalog({
            tables: [tbl("T", { description: "a | b" })],
            measures: [],
            columns: [],
        });
        const md = dictionaryToMarkdown(buildDataDictionary(withPipe));
        expect(md).toContain("## Tables");
        expect(md).toContain("## Measures");
        expect(md).toContain("## Columns");
        expect(md).toContain("a \\| b"); // pipe escaped so the table survives
    });

    it("uses an em dash for empty descriptions/formats", () => {
        const bare = catalog({
            measures: [meas("Bare", { table: "M" })],
            tables: [tbl("M")],
        });
        const md = dictionaryToMarkdown(buildDataDictionary(bare));
        expect(md).toContain("| Bare | M | — | — |");
    });
});
