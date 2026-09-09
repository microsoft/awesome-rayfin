//-----------------------------------------------------------------------
// Semantic Directory — live dimension-value overlay.
//
// The bundled brain and the live metadata queries only carry SCHEMA (measure /
// column / table names). The actual member values of a dimension — the real
// list of product names in Product[ProductName], the brands, the regions —
// live only in the model's data. This module pulls those distinct values LIVE
// and folds them onto their column so a user can search by a value
// ("Contoso", "West") and land on the dimension that holds it.
//
// Fully dynamic: columns are auto-detected from the LIVE column metadata, so a
// brand-new dimension added to the model is covered with no code or file edits.
// Deterministic. No AI.
//-----------------------------------------------------------------------

import type { QueryTable } from "@microsoft/fabric-app-data";
import { rowsToObjects, str, bool } from "@/lib/rows-to-objects";
import type { ValueColumnRef } from "@/queries/metadata";
import type { CatalogModel, ColumnMeta, RawColumnRow } from "./types";
import { columnKey } from "./types";

/** Cap on how many columns we pull values for, to bound live query cost. */
const MAX_VALUE_COLUMNS = 80;

/** Column names that are technical keys, not business-searchable values. */
const KEY_NAME = /(?:^|[\s_])(?:key|id|guid|sk|hash|index)$|(?:key|guid)\b|\bsk\d*$/i;

/** Names that signal a high-value, human-facing dimension — kept first if capped. */
const PRIORITY_HINT =
    /(product|name|category|subcategory|segment|region|country|state|city|division|group|channel|brand|customer|store|department|type|status)/i;

function isStringType(dataType: string | undefined): boolean {
    if (!dataType) return false;
    const t = dataType.toLowerCase();
    return t.includes("string") || t.includes("text");
}

/**
 * Auto-detect the columns worth pulling member values for, straight from the
 * LIVE column metadata: visible string columns that look like a real dimension
 * (not a technical key). Prioritised so the most human-facing dimensions
 * survive the MAX_VALUE_COLUMNS cap.
 */
export function selectValueColumnRefs(liveColumns: QueryTable): ValueColumnRef[] {
    const rows = rowsToObjects<RawColumnRow>(liveColumns);
    const candidates = rows
        .filter((r) => {
            const table = str(r.Table);
            const column = str(r.Column);
            if (!table || !column) return false;
            if (!isStringType(str(r.DataType))) return false;
            if (bool(r.IsHidden)) return false;
            if (KEY_NAME.test(column)) return false;
            // RowNumber / technical data categories are never business values.
            const cat = str(r.DataCategory)?.toLowerCase();
            if (cat === "rownumber") return false;
            return true;
        })
        .map((r) => ({ table: String(r.Table), column: String(r.Column) }));

    candidates.sort((a, b) => {
        const pa = PRIORITY_HINT.test(a.column) ? 0 : 1;
        const pb = PRIORITY_HINT.test(b.column) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return `${a.table}[${a.column}]`.localeCompare(`${b.table}[${b.column}]`);
    });

    return candidates.slice(0, MAX_VALUE_COLUMNS);
}

interface ValueRow {
    Ref: unknown;
    Val: unknown;
}

/** A resolved column's live values, keyed by lowercased `table[column]`. */
export interface LiveValueEntry {
    /** Original-cased `Table[Column]` ref. */
    ref: string;
    values: string[];
}

/**
 * Build a `lowercased table[column]` -> SortByColumn map from the live column
 * schema. Lets the members list honour the model's business order (weekday
 * Mon→Sun, fiscal periods) instead of alphabetising display values. Only real,
 * non-empty sort columns are kept.
 */
export function parseColumnSortKeys(liveColumns: QueryTable): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of rowsToObjects<RawColumnRow>(liveColumns)) {
        const table = str(r.Table);
        const column = str(r.Column);
        const sortBy = str(r.SortByColumn);
        if (!table || !column || !sortBy || sortBy === column) continue;
        out.set(`${table}[${column}]`.toLowerCase(), sortBy);
    }
    return out;
}

/**
 * Return a new catalog with each column's `sortByColumn` folded on from the
 * live schema. Pure — never mutates the input.
 */
export function mergeColumnSortKeys(
    catalog: CatalogModel,
    sortKeys: Map<string, string>,
): CatalogModel {
    if (sortKeys.size === 0) return catalog;
    let changed = false;
    const columns = catalog.columns.map((c) => {
        const sortBy = sortKeys.get(`${c.table}[${c.name}]`.toLowerCase());
        if (!sortBy || sortBy === c.sortByColumn) return c;
        changed = true;
        return { ...c, sortByColumn: sortBy };
    });
    return changed ? { ...catalog, columns } : catalog;
}

/**
 * Parse the (Ref, Val) rows from one or more value-batch query results into a
 * map of normalized `table[column]` -> distinct values. Tolerant of failed
 * batches (pass only the ones that resolved).
 */
export function parseValueTables(tables: QueryTable[]): Map<string, LiveValueEntry> {
    const acc = new Map<string, { ref: string; values: Set<string> }>();
    for (const table of tables) {
        for (const row of rowsToObjects<ValueRow>(table)) {
            const ref = str(row.Ref);
            const val = str(row.Val);
            if (!ref || !val) continue;
            const lower = ref.toLowerCase();
            let bucket = acc.get(lower);
            if (!bucket) {
                bucket = { ref, values: new Set<string>() };
                acc.set(lower, bucket);
            }
            bucket.values.add(val);
        }
    }
    const out = new Map<string, LiveValueEntry>();
    for (const [lower, bucket] of acc) {
        out.set(lower, {
            ref: bucket.ref,
            values: [...bucket.values].sort((a, b) => a.localeCompare(b)),
        });
    }
    return out;
}

interface CardinalityRow {
    Ref: unknown;
    N: unknown;
}

/**
 * Parse (Ref, N) distinct-count probe rows into a lowercased `table[column]` ->
 * count map. Tolerant of failed probes — pass only the resolved tables.
 */
export function parseCardinalities(tables: QueryTable[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const table of tables) {
        for (const row of rowsToObjects<CardinalityRow>(table)) {
            const ref = str(row.Ref);
            if (!ref || row.N == null || row.N === "") continue;
            const n = Number(row.N);
            if (!Number.isFinite(n)) continue;
            out.set(ref.toLowerCase(), n);
        }
    }
    return out;
}

/**
 * Drop value columns whose distinct cardinality exceeds `max`. A column with
 * hundreds of thousands of distinct members (a per-row free-text or near-unique
 * field) can't be usefully value-searched from a TOPN sample and is the most
 * expensive to pull — better skipped than left to dominate the value overlay.
 * Columns with no probed count are KEPT (unknown -> include), so a failed probe
 * never silently strips the whole overlay.
 */
export function capValueRefs(
    refs: ValueColumnRef[],
    cardinalities: Map<string, number>,
    max: number,
): ValueColumnRef[] {
    if (cardinalities.size === 0) return refs;
    return refs.filter((r) => {
        const n = cardinalities.get(`${r.table}[${r.column}]`.toLowerCase());
        return n === undefined || n <= max;
    });
}

/**
 * Split settled value-batch results into the tables that resolved and the refs
 * whose MULTI-column batch failed — so the caller can retry those columns one at
 * a time and isolate a single unreadable column (e.g. RLS-protected) instead of
 * losing every column that shared its batch. A failed single-column batch has
 * nothing to isolate, so its ref is not retried.
 */
export function collectValueBatchResults(
    batches: { refs: ValueColumnRef[] }[],
    settled: PromiseSettledResult<QueryTable>[],
): { tables: QueryTable[]; retryRefs: ValueColumnRef[] } {
    const tables: QueryTable[] = [];
    const retryRefs: ValueColumnRef[] = [];
    settled.forEach((s, i) => {
        if (s.status === "fulfilled") {
            tables.push(s.value);
        } else if ((batches[i]?.refs.length ?? 0) > 1) {
            retryRefs.push(...batches[i].refs);
        }
    });
    return { tables, retryRefs };
}

/** Build a searchable dimension column for a ref the bundled catalog never saw. */
function synthesizeColumn(ref: string, values: string[]): ColumnMeta | undefined {
    const m = /^(.*)\[(.*)\]$/.exec(ref);
    if (!m) return undefined;
    const [, table, column] = m;
    return {
        key: columnKey(table, column),
        kind: "column",
        name: column,
        displayName: column,
        table,
        ref: `'${table}'[${column}]`,
        description: undefined,
        descriptionFromEnrichment: false,
        topic: undefined,
        displayFolder: undefined,
        emoji: undefined,
        isHidden: false,
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: undefined,
        dataType: "String",
        formatString: undefined,
        summarizeBy: undefined,
        isDimensionLike: true,
        category: undefined,
        usedByMeasures: [],
        liveValues: values,
    };
}

/**
 * Return a new catalog with live member values folded onto their columns.
 * Pure — never mutates the input. Columns present in the bundled catalog get
 * their `liveValues` set; refs the bundled catalog never saw (a brand-new
 * dimension) are synthesized so they're searchable too.
 */
export function mergeLiveValues(
    catalog: CatalogModel,
    valuesByRef: Map<string, LiveValueEntry>,
): CatalogModel {
    if (valuesByRef.size === 0) return catalog;
    const matched = new Set<string>();
    let changed = false;
    const columns = catalog.columns.map((c) => {
        const lower = `${c.table}[${c.name}]`.toLowerCase();
        const entry = valuesByRef.get(lower);
        if (!entry || entry.values.length === 0) return c;
        matched.add(lower);
        changed = true;
        return { ...c, liveValues: entry.values };
    });
    const additions: ColumnMeta[] = [];
    for (const [lower, entry] of valuesByRef) {
        if (matched.has(lower) || entry.values.length === 0) continue;
        const synth = synthesizeColumn(entry.ref, entry.values);
        if (synth) additions.push(synth);
    }
    if (additions.length > 0) changed = true;
    return changed ? { ...catalog, columns: [...columns, ...additions] } : catalog;
}
