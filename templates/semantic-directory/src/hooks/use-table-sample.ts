//-----------------------------------------------------------------------
// Semantic Directory — live sample rows for a table.
//
// Pulls a handful of real rows (TOPN) over a table's visible columns so a
// fact/dimension stops being abstract — the equivalent of glancing at
// the first page of the source. Best-effort, module-cached, and silent outside
// the Fabric runtime. Deterministic (no AI); just the model's own rows.
//-----------------------------------------------------------------------

import { useEffect, useState } from "react";
import { rowsToObjects } from "@/lib/rows-to-objects";
import { runMetadataQuery } from "@/lib/run-metadata-query";
import { tableSampleQuery } from "@/queries/metadata";

/** Max columns / rows we ever request — keep the preview compact and cheap. */
export const SAMPLE_MAX_COLS = 10;
export const SAMPLE_ROWS = 8;

export type SampleStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface TableSampleState {
    status: SampleStatus;
    columns: string[];
    rows: Record<string, unknown>[];
    /** True when the source table has more columns than we requested. */
    truncatedColumns: boolean;
}

interface CacheEntry {
    columns: string[];
    rows: Record<string, unknown>[];
    truncatedColumns: boolean;
}

const cache = new Map<string, CacheEntry>();

export function clearTableSampleCache(): void {
    cache.clear();
}

/**
 * Fetch up to SAMPLE_ROWS real rows for `table` over the first SAMPLE_MAX_COLS
 * of `columnNames` (technical names). `totalColumns` lets us flag when the
 * preview is a subset. Returns a stable state object; safe to call always.
 */
export function useTableSample(
    table: string | undefined,
    columnNames: string[],
    totalColumns: number,
): TableSampleState {
    const cols = columnNames.slice(0, SAMPLE_MAX_COLS);
    const truncatedColumns = totalColumns > cols.length;
    const cacheKey = table ? `${table}::${cols.join(",")}` : "";

    const [state, setState] = useState<TableSampleState>(() => {
        const hit = cacheKey ? cache.get(cacheKey) : undefined;
        return hit
            ? { status: "ready", ...hit }
            : { status: "idle", columns: [], rows: [], truncatedColumns };
    });

    useEffect(() => {
        if (!table || cols.length === 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when no table
            setState({ status: "idle", columns: [], rows: [], truncatedColumns });
            return;
        }
        const hit = cache.get(cacheKey);
        if (hit) {
            setState({ status: "ready", ...hit });
            return;
        }
        setState({ status: "loading", columns: cols, rows: [], truncatedColumns });

        const { query } = tableSampleQuery(table, cols, { topN: SAMPLE_ROWS });
        let cancelled = false;
        void runMetadataQuery(query)
            .then((qt) => {
                if (cancelled) return;
                const rows = rowsToObjects<Record<string, unknown>>(qt);
                const entry: CacheEntry = { columns: cols, rows, truncatedColumns };
                cache.set(cacheKey, entry);
                setState({
                    status: rows.length ? "ready" : "empty",
                    ...entry,
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setState({ status: "error", columns: [], rows: [], truncatedColumns });
                }
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheKey]);

    return state;
}
