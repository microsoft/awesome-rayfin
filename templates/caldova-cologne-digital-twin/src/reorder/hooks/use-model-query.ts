import { useSnapshotQuery, type SnapshotKey } from "@/reorder-live/snapshot";
import type { ModelRow } from "@reorder/queries/model-row";

/**
 * The original screens' `useModelQuery`, now answered by the baked snapshot.
 *
 * ⚠️ WHY NOT THE CONNECTOR. The `fabric-semanticmodel` connector runs through a delegated User Data
 * Function, and Fabric then opens the deployed app ONLY for its owner. The snapshot holds what these
 * same `.dax` files return from the same model, gated at deploy; the parsers are unchanged.
 */
interface ModelQuery<T> {
    key: SnapshotKey;
    query: string;
    parse: (row: ModelRow) => T;
}

export interface ModelQueryState<T> {
    rows: T[];
    isLoading: boolean;
    error: string | null;
}

export function useModelQuery<T>(source: ModelQuery<T>): ModelQueryState<T> {
    return useSnapshotQuery(source.key, source.parse);
}
