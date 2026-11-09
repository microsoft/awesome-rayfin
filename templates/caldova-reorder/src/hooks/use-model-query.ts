import { useCallback, useEffect, useState } from "react";

import { getRayfinClient } from "@/lib/rayfin-client";
import type { ModelRow } from "@/queries/model-row";

/**
 * Run a query, and give a cold connector one second chance.
 *
 * The connector reaches the model through a function bridge that is redeployed
 * with the app, so the first call of a session can be slow enough to time out
 * while every later one returns in a second or two. Retrying once turns that
 * into a slightly slow first paint instead of a dashboard full of errors that
 * only a reload clears.
 */
async function runWithOneRetry(query: string) {
    const client = getRayfinClient();

    try {
        return await client.connectors.caldovaModel.executeQuery({ query });
    } catch (first) {
        console.warn("[model] query failed, retrying once", first);
        return await client.connectors.caldovaModel.executeQuery({ query });
    }
}

interface ModelQuery<T> {
    query: string;
    parse: (row: ModelRow) => T;
}

export interface ModelQueryState<T> {
    rows: T[];
    isLoading: boolean;
    error: string | null;
    refresh: () => void;
}

/**
 * Runs a DAX query against Caldova's semantic model through the Rayfin
 * connector.
 *
 * The connector runs with delegated auth, so the model applies its own
 * row-level security to the signed-in manager. Nothing here filters by region.
 *
 * @param pollMs - When set, re-runs the query on this interval. Used while a
 *   reorder is waiting for the model to mirror it, and switched off again as
 *   soon as nothing is pending.
 */
export function useModelQuery<T>(source: ModelQuery<T>, pollMs?: number): ModelQueryState<T> {
    const { query, parse } = source;

    const [rows, setRows] = useState<T[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            setIsLoading(true);

            try {
                const result = await runWithOneRetry(query);
                if (cancelled) return;

                if (result.status === "error") {
                    setError(result.error.message);
                    setRows([]);
                    return;
                }

                const { columns, rows: values } = result.table;
                setRows(
                    values.map((value) =>
                        parse(Object.fromEntries(columns.map((column, i) => [column.name, value[i]]))),
                    ),
                );
                setError(null);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                    setRows([]);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
        // `parse` is a stable pure mapper recreated by each query factory call.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, reloadToken]);

    useEffect(() => {
        if (!pollMs) return;

        const timer = setInterval(refresh, pollMs);
        return () => clearInterval(timer);
    }, [pollMs, refresh]);

    return { rows, isLoading, error, refresh };
}
