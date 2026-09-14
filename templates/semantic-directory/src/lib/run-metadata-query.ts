//-----------------------------------------------------------------------
// Semantic Directory — shared live metadata query runner.
//
// A thin wrapper around the Fabric client for the on-demand detail queries
// (members, profile, hierarchy grain, table sample). Best-effort by contract:
// callers catch and degrade gracefully when not embedded in Fabric.
//-----------------------------------------------------------------------

import type { QueryTable } from "@microsoft/fabric-app-data";
import { getFabricClient } from "@/lib/fabric-client";
import { CONNECTION } from "@/queries/metadata";

// De-dup identical in-flight queries. Members/profile/hierarchy panels often
// request the same DAX at once (e.g. re-mounts, hover + click); sharing the
// promise avoids redundant round-trips. Entries clear as soon as they settle,
// so results are never stale-cached here.
const inFlight = new Map<string, Promise<QueryTable>>();

export async function runMetadataQuery(query: string): Promise<QueryTable> {
    const pending = inFlight.get(query);
    if (pending) return pending;

    const run = (async () => {
        const client = await getFabricClient();
        const result = await client
            .semanticModel(CONNECTION)
            .query(query, { bypassCache: false });
        if (result.status === "error") throw new Error(result.error.message);
        return result.table;
    })();

    inFlight.set(query, run);
    try {
        return await run;
    } finally {
        inFlight.delete(query);
    }
}
