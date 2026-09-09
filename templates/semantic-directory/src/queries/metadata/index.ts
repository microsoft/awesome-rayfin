//-----------------------------------------------------------------------
// Semantic Directory — metadata query factories.
//
// Unlike the template's chart-per-measure pattern, these factories drive a
// live metadata catalog. Each returns { connection, query } for use with
// useSemanticModelQuery. DAX lives in sibling .dax files (imported ?raw).
//-----------------------------------------------------------------------

import measuresDax from "./measures.dax?raw";
import tablesDax from "./tables.dax?raw";
import columnsDax from "./columns.dax?raw";
import relationshipsDax from "./relationships.dax?raw";

/** Connection alias registered in fabric.yaml. */
export const CONNECTION = "model";

export function measuresQuery() {
    return { connection: CONNECTION, query: measuresDax };
}

export function tablesQuery() {
    return { connection: CONNECTION, query: tablesDax };
}

export function columnsQuery() {
    return { connection: CONNECTION, query: columnsDax };
}

export function relationshipsQuery() {
    return { connection: CONNECTION, query: relationshipsDax };
}

/** A live column reference we want distinct member values for. */
export interface ValueColumnRef {
    table: string;
    column: string;
}

function daxTable(name: string): string {
    return `'${name.replace(/'/g, "''")}'`;
}

function daxColumn(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
}

/**
 * Build ONE DAX EVALUATE that returns (Ref, Val) rows of distinct member
 * values for a batch of columns. `Ref` is the plain `Table[Column]` key used to
 * fold the values back onto the matching catalog column.
 */
function valuesBatchDax(refs: ValueColumnRef[], topN: number): string {
    const parts = refs.map(({ table, column }) => {
        const col = `${daxTable(table)}${daxColumn(column)}`;
        const ref = `${table}[${column}]`.replace(/"/g, '""');
        return (
            `SELECTCOLUMNS(\n` +
            `        TOPN(${topN}, FILTER(VALUES(${col}), NOT ISBLANK(${col})), ${col}, ASC),\n` +
            `        "Ref", "${ref}",\n` +
            `        "Val", ${col} & ""\n` +
            `    )`
        );
    });
    const body = parts.length === 1 ? parts[0] : `UNION(\n    ${parts.join(",\n    ")}\n)`;
    return `EVALUATE\n${body}`;
}

/** One value-batch query, tagged with the refs it pulls (for per-column retry). */
export interface ValueBatchQuery {
    connection: string;
    query: string;
    refs: ValueColumnRef[];
}

/**
 * Split the requested columns into batches and return one query per batch, so a
 * single unreadable column only fails its own batch (Promise.allSettled). Each
 * query carries its `refs`, so a failed multi-column batch can be retried one
 * column at a time to isolate the unreadable one.
 */
export function dimensionValuesQueries(
    refs: ValueColumnRef[],
    { topN = 500, batchSize = 10 }: { topN?: number; batchSize?: number } = {},
): ValueBatchQuery[] {
    const queries: ValueBatchQuery[] = [];
    for (let i = 0; i < refs.length; i += batchSize) {
        const batch = refs.slice(i, i + batchSize);
        queries.push({ connection: CONNECTION, query: valuesBatchDax(batch, topN), refs: batch });
    }
    return queries;
}

/**
 * ONE column's distinct members, in the model's business order — ordered by the
 * field's SortByColumn when present (weekday Mon→Sun, fiscal periods) and by the
 * value itself otherwise, blanks last. Capped at `topN`. Returns Value / IsBlank
 * rows; the caller must NOT re-sort (order is authoritative here).
 */
export function columnMembersQuery(
    ref: ValueColumnRef,
    { topN = 500, sortByColumn }: { topN?: number; sortByColumn?: string } = {},
): { connection: string; query: string } {
    const table = daxTable(ref.table);
    const col = `${table}${daxColumn(ref.column)}`;
    const useSort = Boolean(sortByColumn && sortByColumn !== ref.column);
    const sortRef = useSort ? `${table}${daxColumn(sortByColumn!)}` : col;
    const source = useSort ? `SUMMARIZE(${table}, ${col}, ${sortRef})` : `VALUES(${col})`;
    const query =
        `EVALUATE\n` +
        `TOPN(\n` +
        `    ${topN},\n` +
        `    SELECTCOLUMNS(\n` +
        `        ${source},\n` +
        `        "Value", ${col} & "",\n` +
        `        "IsBlank", IF(ISBLANK(${col}), 1, 0),\n` +
        `        "SortValue", ${sortRef}\n` +
        `    ),\n` +
        `    [IsBlank], ASC, [SortValue], ASC, [Value], ASC\n` +
        `)\n` +
        `ORDER BY [IsBlank] ASC, [SortValue] ASC, [Value] ASC`;
    return { connection: CONNECTION, query };
}

/**
 * ONE column's profile: true distinct count (incl. any blank), the non-blank
 * distinct count, and min/max of the non-blank members (for a numeric/date
 * range chip). Cheap ROW result. Drives the cardinality-first decision of
 * whether to show a full list, a "first 500 of N", or just a range.
 */
export function columnStatsQuery(
    ref: ValueColumnRef,
): { connection: string; query: string } {
    const table = daxTable(ref.table);
    const col = `${table}${daxColumn(ref.column)}`;
    const nonBlank = `FILTER(VALUES(${col}), NOT ISBLANK(${col}))`;
    const query =
        `EVALUATE\n` +
        `ROW(\n` +
        `    "DistinctCount", COUNTROWS(VALUES(${col})),\n` +
        `    "NonBlank", COUNTROWS(${nonBlank}),\n` +
        `    "RowCount", COUNTROWS(${table}),\n` +
        `    "BlankRows", COUNTROWS(FILTER(${table}, ISBLANK(${col}))),\n` +
        `    "MinText", MINX(${nonBlank}, ${col}) & "",\n` +
        `    "MaxText", MAXX(${nonBlank}, ${col}) & ""\n` +
        `)`;
    return { connection: CONNECTION, query };
}

/**
 * ONE query returning the true distinct count of each ref (Ref, N rows). Powers
 * hierarchy "grain" badges — the size of each level (Year 5 → Month 60) — and
 * covers date/numeric levels the bulk string-only value overlay never pulls.
 */
export function distinctCountsQuery(
    refs: ValueColumnRef[],
): { connection: string; query: string } | null {
    if (refs.length === 0) return null;
    const rows = refs.map(({ table, column }) => {
        const col = `${daxTable(table)}${daxColumn(column)}`;
        const ref = `${table}[${column}]`.replace(/"/g, '""');
        return `ROW("Ref", "${ref}", "N", COUNTROWS(VALUES(${col})))`;
    });
    const body = rows.length === 1 ? rows[0] : `UNION(\n    ${rows.join(",\n    ")}\n)`;
    return { connection: CONNECTION, query: `EVALUATE\n${body}` };
}

/**
 * Probe the true distinct count of each candidate value column, chunked so no
 * single probe query fans out over too many columns. Reuses distinctCountsQuery
 * (Ref, N rows). Lets the value overlay skip runaway high-cardinality columns
 * (a free-text notes / email / near-unique field) whose members can't be
 * usefully value-searched from a TOPN sample and are the most expensive to
 * materialize — the main mitigation for slow DirectQuery models. Best-effort:
 * callers fall back to pulling every candidate if a probe fails.
 */
export function cardinalityProbeQueries(
    refs: ValueColumnRef[],
    { batchSize = 40 }: { batchSize?: number } = {},
): { connection: string; query: string }[] {
    const queries: { connection: string; query: string }[] = [];
    for (let i = 0; i < refs.length; i += batchSize) {
        const probe = distinctCountsQuery(refs.slice(i, i + batchSize));
        if (probe) queries.push(probe);
    }
    return queries;
}

/**
 * A small sample of real rows from a table (TOPN over the given visible columns)
 * so a fact/dimension table stops being abstract. Column aliases keep the output
 * clean (no `Table[Col]` brackets, no technical key columns).
 */
export function tableSampleQuery(
    table: string,
    columns: string[],
    { topN = 8 }: { topN?: number } = {},
): { connection: string; query: string } {
    const t = daxTable(table);
    const projected = columns
        .map((c) => `"${c.replace(/"/g, '""')}", ${t}${daxColumn(c)}`)
        .join(",\n    ");
    const query =
        `EVALUATE\n` +
        `SELECTCOLUMNS(\n` +
        `    TOPN(${topN}, ${t}),\n` +
        `    ${projected}\n` +
        `)`;
    return { connection: CONNECTION, query };
}
