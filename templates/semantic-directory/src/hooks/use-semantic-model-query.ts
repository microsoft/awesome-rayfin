//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { type CachedQueryResult } from "@microsoft/fabric-app-data";
import { getFabricClient } from "@/lib/fabric-client";

interface UseSemanticModelQueryOptions {
    /** Connection alias from fabric.yaml (e.g., "salesModel"). */
    connection: string;
    /** DAX query string. */
    query: string;
    /** If true, skip reading from cache (still writes the fresh result). */
    bypassCache?: boolean;
}

interface UseSemanticModelQueryResult {
    data: CachedQueryResult | undefined;
    isLoading: boolean;
    error: Error | undefined;
    refetch: () => Promise<void>;
}

/**
 * React hook that executes a DAX query against a Power BI semantic model
 * via the Fabric SDK. Results are cached by the SDK's built-in LRU cache.
 *
 * The connection alias is resolved from `fabric.generated.ts`
 * (managed by `npx fabric-app-data`).
 *
 * @example
 * // Basic usage
 * const { data, isLoading } = useSemanticModelQuery({
 *   connection: "salesModel",
 *   query: 'EVALUATE SUMMARIZE(Sales, Products[Name], "Total", SUM(Sales[Amount]))',
 * });
 *
 * if (data?.status === "success") {
 *   const table = data.table;
 *   // table.columns, table.rows
 * }
 *
 * @example
 * // Handling errors (SDK never throws — check result.status)
 * if (data?.status === "error") {
 *   console.error(data.error.message); // e.g., "401 Unauthorized"
 * }
 *
 * @example
 * // Checking cache status
 * if (data?.fromCache) {
 *   console.log(`Cached at ${data.cachedAt}`);
 * }
 *
 * @example
 * // Bypassing cache for fresh data
 * const { data } = useSemanticModelQuery({
 *   connection: "salesModel",
 *   query: 'EVALUATE ...',
 *   bypassCache: true,
 * });
 */
export function useSemanticModelQuery(
    options: UseSemanticModelQueryOptions,
): UseSemanticModelQueryResult {
    const { connection, query, bypassCache } = options;
    const canExecute = Boolean(connection && query);

    // A single "outcome" keyed by the request identity, plus a manual-refetch
    // nonce. `isLoading` is DERIVED (we have no result for the current key yet),
    // so nothing sets state synchronously inside the effect — the effect only
    // writes state from an async continuation, guarded against stale responses.
    const [outcome, setOutcome] = useState<{
        key: string;
        data: CachedQueryResult | undefined;
        error: Error | undefined;
    }>();
    const [nonce, setNonce] = useState(0);

    const key = `${nonce}\u0000${connection}\u0000${query}\u0000${bypassCache ? 1 : 0}`;

    const isLoading = canExecute && outcome?.key !== key;

    useEffect(() => {
        if (!canExecute) return;
        // The cleanup flag drops the result of a superseded request: when `key`
        // changes (query/connection/nonce), the previous run's cleanup sets
        // `ignore`, so only the latest in-flight query is allowed to write state.
        let ignore = false;
        void (async () => {
            try {
                const client = await getFabricClient();
                const result = await client
                    .semanticModel(connection)
                    .query(query, { bypassCache });
                if (ignore) return;
                setOutcome({
                    key,
                    data: result,
                    error:
                        result.status === "error"
                            ? new Error(result.error.message)
                            : undefined,
                });
            } catch (err) {
                if (ignore) return;
                setOutcome({
                    key,
                    data: undefined,
                    error: err instanceof Error ? err : new Error(String(err)),
                });
            }
        })();
        return () => {
            ignore = true;
        };
    }, [key, canExecute, connection, query, bypassCache]);

    const refetch = useCallback(async () => {
        // Bumping the nonce changes `key`, which re-runs the effect.
        setNonce((n) => n + 1);
    }, []);

    return {
        data: outcome?.data,
        isLoading,
        error: outcome?.error,
        refetch,
    };
}

/**
 * Clears cached query results from the SDK's LRU cache.
 * Pass a connection alias to clear a specific model, or omit to clear all.
 *
 * @example
 * await clearQueryCache();              // clear all models
 * await clearQueryCache("salesModel");  // clear a specific model
 */
export async function clearQueryCache(connection?: string): Promise<void> {
    const client = await getFabricClient();
    if (connection) {
        client.semanticModel(connection).clearCache();
    } else {
        client.clearCache();
    }
}
