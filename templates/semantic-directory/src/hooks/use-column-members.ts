//-----------------------------------------------------------------------
// Semantic Directory — live "what's inside this field" members hook.
//
// A user opening a dimension field wants the pivot-table experience:
// see the ACTUAL members of the field — Weekday → Mon…Sun, Region → East/West.
// This hook fetches that on demand, deterministically, and decides (cardinality
// first) how to present it so a capped list never masquerades as complete:
//
//   • small categorical (≤ 500 distinct) → the full, business-ordered list
//   • large text (> 500)                 → first 500, honestly labelled
//   • numeric/date with many values      → a range + distinct count, no dump
//   • identifiers / non-dimensions       → suppressed, with the reason
//
// Ordering honours the model's SortByColumn (folded on live), so weekday and
// fiscal periods read in business order rather than alphabetically. Best-effort:
// outside the Fabric runtime the query fails and we show a calm empty state.
// Deterministic. No AI.
//-----------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { QueryTable } from "@microsoft/fabric-app-data";
import { getFabricClient } from "@/lib/fabric-client";
import { rowsToObjects, str, bool } from "@/lib/rows-to-objects";
import { CONNECTION, columnMembersQuery, columnStatsQuery } from "@/queries/metadata";
import type { ColumnMeta } from "@/catalog/model/types";

/** Hard cap on listed members — matches the DAX TOPN in columnMembersQuery. */
const MEMBER_CAP = 500;

/** Column names that are technical identifiers, never a browsable member set. */
const KEY_NAME = /(?:^|[\s_])(?:key|id|guid|sk|hash|index)$|(?:key|guid)\b|\bsk\d*$/i;

export type ColumnMembersMode =
    | "suppressed"
    | "loading"
    | "list"
    | "range"
    | "empty"
    | "error";

export interface ColumnMember {
    value: string;
    isBlank: boolean;
}

export interface ColumnMembersState {
    mode: ColumnMembersMode;
    /** Members in the field's business order (do NOT re-sort). */
    values: ColumnMember[];
    /** True distinct count from the model, incl. any blank. */
    distinctCount?: number;
    /** Distinct blank members (0 or 1). */
    blankCount?: number;
    /** Total rows in the field's home table (profile). */
    rowCount?: number;
    /** Rows where this field is empty (profile fill rate). */
    blankRows?: number;
    /** True when the list shows every distinct value. */
    complete?: boolean;
    /** Ordered by the model's SortByColumn (business order) vs. value order. */
    ordered?: boolean;
    /** Numeric/date field — a range chip is meaningful. */
    ranged?: boolean;
    minText?: string;
    maxText?: string;
    /** Human reason for suppressed / empty states. */
    reason?: string;
}

const EMPTY: ColumnMembersState = { mode: "empty", values: [] };

/** Module-level cache so switching between fields is instant after first load. */
const cache = new Map<string, ColumnMembersState>();

/** Drop cached members so a live refresh re-pulls them (kept honest). */
export function clearColumnMembersCache(): void {
    cache.clear();
}

function isNumericType(dataType: string | undefined): boolean {
    return !!dataType && /int|decimal|double|currency|number/i.test(dataType);
}

function isDateType(dataType: string | undefined): boolean {
    return !!dataType && /date|time/i.test(dataType);
}

/** Deterministic, no-query verdict on whether a column gets a members list. */
function classify(column: ColumnMeta): ColumnMembersState | undefined {
    if (!column.isDimensionLike) {
        return {
            ...EMPTY,
            mode: "suppressed",
            reason: "This is a value to aggregate, not a field to slice by — it has no member list.",
        };
    }
    if (column.category?.toLowerCase() === "rownumber") {
        return { ...EMPTY, mode: "suppressed", reason: "Technical row-number column." };
    }
    if (KEY_NAME.test(column.name)) {
        return {
            ...EMPTY,
            mode: "suppressed",
            reason: "Identifier field — its members are keys, not something to browse.",
        };
    }
    return undefined;
}

/** Instant first paint from any values already pulled by the bulk overlay. */
function seedLoading(column: ColumnMeta): ColumnMembersState {
    const seeded = (column.liveValues ?? []).map((value) => ({ value, isBlank: false }));
    return { mode: "loading", values: seeded, ordered: Boolean(column.sortByColumn) };
}

async function queryTable(query: string): Promise<QueryTable> {
    const client = await getFabricClient();
    const result = await client
        .semanticModel(CONNECTION)
        .query(query, { bypassCache: false });
    if (result.status === "error") throw new Error(result.error.message);
    return result.table;
}

interface RawStats {
    DistinctCount: unknown;
    NonBlank: unknown;
    RowCount: unknown;
    BlankRows: unknown;
    MinText: unknown;
    MaxText: unknown;
}

interface RawMember {
    Value: unknown;
    IsBlank: unknown;
}

function assemble(
    column: ColumnMeta,
    statsTable: QueryTable,
    membersTable: QueryTable,
): ColumnMembersState {
    const stats = rowsToObjects<RawStats>(statsTable)[0];
    const distinctCount = Number(stats?.DistinctCount ?? 0);
    const nonBlank = Number(stats?.NonBlank ?? 0);
    const blankCount = Math.max(distinctCount - nonBlank, 0);
    const rowCount = Number(stats?.RowCount ?? 0) || undefined;
    const blankRows = Number(stats?.BlankRows ?? 0) || undefined;
    const minText = str(stats?.MinText);
    const maxText = str(stats?.MaxText);

    const values: ColumnMember[] = rowsToObjects<RawMember>(membersTable).map((r) => {
        const isBlank = bool(r.IsBlank) || Number(r.IsBlank) === 1;
        return { value: isBlank ? "(Blank)" : String(r.Value ?? ""), isBlank };
    });

    const ordered = Boolean(column.sortByColumn);
    const ranged = isNumericType(column.dataType) || isDateType(column.dataType);
    const profile = { rowCount, blankRows };

    if (distinctCount === 0) {
        return { ...EMPTY, reason: "This field has no values in the current model." };
    }

    // ≤ cap → we have the complete, business-ordered list.
    if (distinctCount <= MEMBER_CAP) {
        return {
            mode: "list",
            values,
            distinctCount,
            blankCount,
            ...profile,
            complete: true,
            ordered,
            ranged,
            minText,
            maxText,
        };
    }

    // Too many to list. For numeric/date that's noise → show the range instead.
    if (ranged) {
        return {
            mode: "range",
            values: [],
            distinctCount,
            blankCount,
            ...profile,
            complete: false,
            ordered,
            ranged: true,
            minText,
            maxText,
        };
    }

    // High-cardinality text → first N, honestly labelled as incomplete.
    return {
        mode: "list",
        values,
        distinctCount,
        blankCount,
        ...profile,
        complete: false,
        ordered,
        ranged: false,
        minText,
        maxText,
    };
}

async function load(column: ColumnMeta): Promise<ColumnMembersState> {
    const ref = { table: column.table, column: column.name };
    try {
        const membersPromise = queryTable(
            columnMembersQuery(ref, { sortByColumn: column.sortByColumn }).query,
        ).catch((err) => {
            // A bad/unqueryable SortByColumn shouldn't lose the list — retry plain.
            if (column.sortByColumn) return queryTable(columnMembersQuery(ref).query);
            throw err;
        });
        const [statsTable, membersTable] = await Promise.all([
            queryTable(columnStatsQuery(ref).query),
            membersPromise,
        ]);
        return assemble(column, statsTable, membersTable);
    } catch {
        return { ...EMPTY, reason: "Members load live inside Fabric." };
    }
}

/**
 * Live members for the focused column. Suppressed/empty verdicts are derived
 * purely during render; the effect only fires the network fetch and commits its
 * result from an async callback (never a synchronous setState in the effect), so
 * rapid field switching can't clobber a newer field's result.
 */
export function useColumnMembers(column: ColumnMeta | undefined): ColumnMembersState {
    const [byKey, setByKey] = useState<Record<string, ColumnMembersState>>({});

    useEffect(() => {
        if (!column) return;
        if (classify(column)) return;
        if (cache.has(column.key)) return;
        let cancelled = false;
        void load(column).then((result) => {
            if (cancelled) return;
            cache.set(column.key, result);
            setByKey((prev) => ({ ...prev, [column.key]: result }));
        });
        return () => {
            cancelled = true;
        };
    }, [column]);

    if (!column) return EMPTY;
    const suppressed = classify(column);
    if (suppressed) return suppressed;
    return byKey[column.key] ?? cache.get(column.key) ?? seedLoading(column);
}
