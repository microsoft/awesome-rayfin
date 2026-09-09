//-----------------------------------------------------------------------
// Semantic Directory — data dictionary export.
//
// Turns the live catalog into a portable data dictionary a steward can hand to
// anyone: every table, measure, and column with its description, type, and
// format. Two serializers — RFC-4180 CSV (spreadsheet-ready) and Markdown
// (wiki/PR-ready). Pure + deterministic; no AI.
//-----------------------------------------------------------------------

import type { CatalogModel } from "../model/types";

export interface DictTable {
    name: string;
    displayName: string;
    description: string;
    columnCount: number;
    measureCount: number;
    hidden: boolean;
}

export interface DictMeasure {
    name: string;
    displayName: string;
    table: string;
    description: string;
    formatString: string;
    dataType: string;
    hidden: boolean;
}

export interface DictColumn {
    table: string;
    name: string;
    displayName: string;
    description: string;
    dataType: string;
    hidden: boolean;
}

export interface DataDictionary {
    modelName: string;
    generatedAt: string;
    tables: DictTable[];
    measures: DictMeasure[];
    columns: DictColumn[];
}

export interface DictionaryOptions {
    /** Display name of the connected model (for titles/headers). */
    modelName?: string;
    /** Include hidden entities. Default false — dictionaries are for consumers. */
    includeHidden?: boolean;
}

const clean = (s: string | undefined): string => (s ?? "").trim();

function byTableThenName<T extends { table?: string; displayName: string }>(
    a: T,
    b: T,
): number {
    const t = (a.table ?? "").localeCompare(b.table ?? "");
    return t !== 0 ? t : a.displayName.localeCompare(b.displayName);
}

/** Assemble a structured data dictionary from the catalog. */
export function buildDataDictionary(
    catalog: CatalogModel,
    options: DictionaryOptions = {},
): DataDictionary {
    const includeHidden = options.includeHidden ?? false;
    const keep = (hidden: boolean) => includeHidden || !hidden;

    const tables: DictTable[] = catalog.tables
        .filter((t) => keep(t.isHidden))
        .map((t) => ({
            name: t.name,
            displayName: t.displayName,
            description: clean(t.description),
            columnCount: t.columnCount,
            measureCount: t.measureCount,
            hidden: t.isHidden,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const measures: DictMeasure[] = catalog.measures
        .filter((m) => keep(m.isHidden))
        .map((m) => ({
            name: m.name,
            displayName: m.displayName,
            table: m.table,
            description: clean(m.description),
            formatString: clean(m.formatString),
            dataType: clean(m.dataType),
            hidden: m.isHidden,
        }))
        .sort(byTableThenName);

    const columns: DictColumn[] = catalog.columns
        .filter((c) => keep(c.isHidden))
        .map((c) => ({
            table: c.table,
            name: c.name,
            displayName: c.displayName,
            description: clean(c.description),
            dataType: clean(c.dataType),
            hidden: c.isHidden,
        }))
        .sort(byTableThenName);

    return {
        modelName: clean(options.modelName) || "Semantic model",
        generatedAt: new Date().toISOString(),
        tables,
        measures,
        columns,
    };
}

// ---------- CSV (RFC 4180) ----------

/**
 * Escape a single CSV field: quote when it contains comma, quote, CR, or LF.
 * String fields that begin with a formula trigger (`= + - @`, tab, or CR) are
 * prefixed with a single quote to neutralize CSV/formula injection — a data
 * dictionary is meant to be opened in Excel/Sheets by end users.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
function csvField(value: string | number | boolean): string {
    let s = String(value);
    if (typeof value === "string" && FORMULA_LEAD.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number | boolean)[]): string {
    return cells.map(csvField).join(",");
}

/**
 * Flatten the dictionary to a single RFC-4180 CSV — one row per entity with a
 * unified column set. Uses CRLF line endings per the spec.
 */
export function dictionaryToCsv(dict: DataDictionary): string {
    const header = [
        "Kind",
        "Name",
        "Display Name",
        "Table",
        "Description",
        "Data Type",
        "Format String",
        "Hidden",
    ];
    const rows: string[] = [csvRow(header)];

    for (const t of dict.tables) {
        rows.push(csvRow(["Table", t.name, t.displayName, "", t.description, "", "", t.hidden]));
    }
    for (const m of dict.measures) {
        rows.push(
            csvRow([
                "Measure",
                m.name,
                m.displayName,
                m.table,
                m.description,
                m.dataType,
                m.formatString,
                m.hidden,
            ]),
        );
    }
    for (const c of dict.columns) {
        rows.push(
            csvRow(["Column", c.name, c.displayName, c.table, c.description, c.dataType, "", c.hidden]),
        );
    }
    return rows.join("\r\n");
}

// ---------- Markdown ----------

/** Escape a Markdown table cell: pipes and any line ending would break the table. */
function mdCell(value: string | number): string {
    return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function mdTable(headers: string[], rows: (string | number)[][]): string {
    const head = `| ${headers.join(" | ")} |`;
    const divider = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`).join("\n");
    return rows.length ? `${head}\n${divider}\n${body}` : `${head}\n${divider}`;
}

const dash = (s: string): string => (s ? s : "—");

/** Render the dictionary as sectioned Markdown (tables, measures, columns). */
export function dictionaryToMarkdown(dict: DataDictionary): string {
    const date = dict.generatedAt.slice(0, 10);
    const parts: string[] = [
        `# ${dict.modelName} — Data Dictionary`,
        `_Generated ${date} · ${dict.tables.length} tables · ${dict.measures.length} measures · ${dict.columns.length} columns_`,
    ];

    parts.push(
        "## Tables",
        mdTable(
            ["Name", "Description", "Columns", "Measures"],
            dict.tables.map((t) => [t.displayName, dash(t.description), t.columnCount, t.measureCount]),
        ),
    );

    parts.push(
        "## Measures",
        mdTable(
            ["Name", "Table", "Format", "Description"],
            dict.measures.map((m) => [
                m.displayName,
                m.table,
                dash(m.formatString),
                dash(m.description),
            ]),
        ),
    );

    parts.push(
        "## Columns",
        mdTable(
            ["Table", "Name", "Type", "Description"],
            dict.columns.map((c) => [c.table, c.displayName, dash(c.dataType), dash(c.description)]),
        ),
    );

    return parts.join("\n\n") + "\n";
}
