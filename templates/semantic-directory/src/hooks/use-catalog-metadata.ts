//-----------------------------------------------------------------------
// Semantic Directory — catalog metadata hook (demo bundle + live model).
//
// The catalog renders SYNCHRONOUSLY from the bundled demo brain (Contoso Sales),
// so the full rich experience (measure DNA, families, lineage, relationships,
// constellation) is visible instantly and works everywhere — browser, dev,
// offline, or a stakeholder demo with no model wired up at all.
//
// When a real workspace + semantic model IS configured (fabric.yaml), the hook
// introspects THAT model live — building a full catalog from its own measures,
// tables, columns and relationships — and swaps it in as the source of truth.
// The demo bundle then simply becomes the "never blank" fallback: if the live
// fetch fails, the demo experience stands on its own with no error.
//-----------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryTable } from "@microsoft/fabric-app-data";
import { getFabricClient } from "@/lib/fabric-client";
import { isModelConfigured } from "@/lib/model-config";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { enrichment } from "@/catalog/enrichment";
import { buildCatalogFromBundle } from "@/catalog/model/build-bundle";
import { buildCatalog } from "@/catalog/model/merge-enrichment";
import {
    capValueRefs,
    collectValueBatchResults,
    mergeColumnSortKeys,
    mergeLiveValues,
    parseCardinalities,
    parseColumnSortKeys,
    parseValueTables,
    selectValueColumnRefs,
    type LiveValueEntry,
} from "@/catalog/model/live-values";
import { clearColumnMembersCache } from "@/hooks/use-column-members";
import { clearTableSampleCache } from "@/hooks/use-table-sample";
import { clearDistinctCountsCache } from "@/hooks/use-distinct-counts";
import type { CatalogModel } from "@/catalog/model/types";
import {
    cardinalityProbeQueries,
    columnsQuery,
    CONNECTION,
    dimensionValuesQueries,
    measuresQuery,
    relationshipsQuery,
    tablesQuery,
    type ValueColumnRef,
} from "@/queries/metadata";

/** Which brain the catalog is currently rendering from. */
export type CatalogMode = "demo" | "live";

/** Live connection state for the configured model (only meaningful in live). */
export type LiveStatus = "checking" | "synced" | "offline";

interface UseCatalogMetadataResult {
    catalog: CatalogModel | undefined;
    isLoading: boolean;
    error: Error | undefined;
    /** "demo" until a live model has been introspected, then "live". */
    mode: CatalogMode;
    /** True when fabric.yaml points at a real workspace + model. */
    modelConfigured: boolean;
    /** Live introspection state for the configured model. */
    liveStatus: LiveStatus;
    /** Re-introspect the live model (no-op in demo mode). */
    refresh: () => Promise<void>;
}

/** Max live value-batch queries in flight at once (bounds model load). */
const VALUE_BATCH_CONCURRENCY = 3;

/**
 * Skip value columns above this distinct cardinality. A field with more distinct
 * members than this (free-text notes, email, near-unique keys) can't be usefully
 * value-searched from a 500-row TOPN sample and is the most expensive to pull —
 * so it's gated out of the live value overlay. Adopter-tunable.
 */
const MAX_VALUE_CARDINALITY = 50_000;

async function runQuery(query: string, bypassCache: boolean): Promise<QueryTable> {
    const client = await getFabricClient();
    const result = await client
        .semanticModel(CONNECTION)
        .query(query, { bypassCache });
    if (result.status === "error") {
        throw new Error(result.error.message);
    }
    return result.table;
}

interface LiveSetters {
    setLiveCatalog: (model: CatalogModel | undefined) => void;
    setLiveStatus: (status: LiveStatus) => void;
    setSortKeys: (keys: Map<string, string>) => void;
    setLiveValues: (values: Map<string, LiveValueEntry>) => void;
}

/**
 * Introspect the configured live model and build a full catalog from it. Kept
 * OUTSIDE the component so the effect that kicks it off never appears to set
 * state synchronously. Every write is gated on `isCurrent()` (the run token) so
 * a superseded or unmounted pass is dropped.
 */
async function loadLiveModel(
    bypassCache: boolean,
    isCurrent: () => boolean,
    set: LiveSetters,
): Promise<void> {
    let liveColumns: QueryTable;
    try {
        const [measures, tables, columns, relationships] = await Promise.all([
            runQuery(measuresQuery().query, bypassCache),
            runQuery(tablesQuery().query, bypassCache),
            runQuery(columnsQuery().query, bypassCache),
            runQuery(relationshipsQuery().query, bypassCache),
        ]);
        if (!isCurrent()) return;
        liveColumns = columns;
        // Full model-agnostic build: normalize → enrich → dependency graph →
        // families → lineage → coverage. Works for ANY semantic model.
        const live = buildCatalog(
            { measures, tables, columns, relationships },
            enrichment,
        );
        set.setLiveCatalog(live);
        set.setLiveStatus("synced");
    } catch {
        // Configured model unreachable (or not embedded) — the demo bundle
        // stands in as the "never blank" fallback. Clear ALL live overlays so a
        // failed refresh can't leave stale live values merged onto the demo.
        if (!isCurrent()) return;
        set.setLiveCatalog(undefined);
        set.setSortKeys(new Map());
        set.setLiveValues(new Map());
        set.setLiveStatus("offline");
        return;
    }

    // Live member values (dimension members, e.g. product names, regions) — a
    // background, best-effort layer that makes value-level search fully dynamic.
    // Auto-detects dimension columns from the live schema, so new members (or an
    // entirely new dimension) become searchable with no code or file edits.
    try {
        if (!isCurrent()) return;
        set.setSortKeys(parseColumnSortKeys(liveColumns));
        const candidates = selectValueColumnRefs(liveColumns);
        if (candidates.length === 0) return;

        // Cardinality gate: probe distinct counts and drop runaway high-card
        // columns (free-text / near-unique) that can't be usefully value-searched
        // from a TOPN sample and are the most expensive to pull — the main
        // mitigation for slow DirectQuery models. Best-effort: a failed probe
        // leaves every candidate in play.
        const refs = await gateRefsByCardinality(candidates, bypassCache);
        if (!isCurrent()) return;
        if (refs.length === 0) return;

        // Pull member values in batches; if a multi-column batch fails (e.g. one
        // RLS-protected column returns Access Denied), retry its columns one at a
        // time so a single unreadable column can't take its batch-mates down.
        const parsed = await loadDimensionValues(refs, bypassCache);
        if (!isCurrent()) return;
        if (parsed.size > 0) set.setLiveValues(parsed);
    } catch {
        // Values are a bonus layer — never fail the app over them.
    }
}

/**
 * Probe candidate columns' distinct counts and drop any above
 * MAX_VALUE_CARDINALITY. Best-effort: any failure (or a model that can't answer
 * the probe) returns the full candidate set unchanged.
 */
async function gateRefsByCardinality(
    refs: ValueColumnRef[],
    bypassCache: boolean,
): Promise<ValueColumnRef[]> {
    try {
        const probes = cardinalityProbeQueries(refs);
        if (probes.length === 0) return refs;
        const settled = await mapWithConcurrency(
            probes,
            VALUE_BATCH_CONCURRENCY,
            (p) => runQuery(p.query, bypassCache),
        );
        const tables = settled
            .filter((s): s is PromiseFulfilledResult<QueryTable> => s.status === "fulfilled")
            .map((s) => s.value);
        return capValueRefs(refs, parseCardinalities(tables), MAX_VALUE_CARDINALITY);
    } catch {
        return refs;
    }
}

/**
 * Pull dimension member values, isolating unreadable columns: multi-column
 * batches that fail are retried one column at a time so a single RLS-protected
 * column doesn't take its batch-mates' values down with it.
 */
async function loadDimensionValues(
    refs: ValueColumnRef[],
    bypassCache: boolean,
): Promise<Map<string, LiveValueEntry>> {
    const batches = dimensionValuesQueries(refs);
    const settled = await mapWithConcurrency(
        batches,
        VALUE_BATCH_CONCURRENCY,
        (b) => runQuery(b.query, bypassCache),
    );
    const { tables, retryRefs } = collectValueBatchResults(batches, settled);
    if (retryRefs.length > 0) {
        const singles = dimensionValuesQueries(retryRefs, { batchSize: 1 });
        const retried = await mapWithConcurrency(
            singles,
            VALUE_BATCH_CONCURRENCY,
            (b) => runQuery(b.query, bypassCache),
        );
        for (const s of retried) {
            if (s.status === "fulfilled") tables.push(s.value);
        }
    }
    return parseValueTables(tables);
}

export function useCatalogMetadata(): UseCatalogMetadataResult {
    // Demo brain: built once, synchronously. This is the app's foundation and
    // the offline / not-configured fallback.
    const base = useMemo(() => buildCatalogFromBundle(enrichment), []);
    const modelConfigured = useMemo(() => isModelConfigured(), []);

    const [liveCatalog, setLiveCatalog] = useState<CatalogModel | undefined>();
    const [liveValues, setLiveValues] = useState<Map<string, LiveValueEntry>>();
    const [sortKeys, setSortKeys] = useState<Map<string, string>>();
    const [liveStatus, setLiveStatus] = useState<LiveStatus>(
        modelConfigured ? "checking" : "offline",
    );
    const [error] = useState<Error | undefined>();

    // Monotonic run token: results from a superseded/stale pass (e.g. a refresh
    // fired mid-flight, or the component unmounted) are dropped.
    const runIdRef = useRef(0);

    const loadLive = useCallback(
        (bypassCache: boolean): Promise<void> => {
            const runId = ++runIdRef.current;
            return loadLiveModel(
                bypassCache,
                () => runIdRef.current === runId,
                { setLiveCatalog, setLiveStatus, setSortKeys, setLiveValues },
            );
        },
        [],
    );

    useEffect(() => {
        // Only reach for the live model when one is actually configured; the
        // demo bundle renders instantly regardless (initial state above).
        if (!modelConfigured) return;
        void loadLive(false);
        // Invalidate any in-flight load on unmount so it can't set state on an
        // unmounted component (the run token guards every write).
        return () => {
            runIdRef.current += 1;
        };
    }, [modelConfigured, loadLive]);

    const refresh = useCallback(async () => {
        if (!modelConfigured) return;
        setLiveStatus("checking");
        try {
            (await getFabricClient()).semanticModel(CONNECTION).clearCache();
        } catch {
            // no live client available; ignore
        }
        // Invalidate the on-demand module caches too, so detail views (members,
        // table samples, distinct counts) re-fetch fresh alongside the overlay.
        clearColumnMembersCache();
        clearTableSampleCache();
        clearDistinctCountsCache();
        await loadLive(true);
    }, [modelConfigured, loadLive]);

    const catalog = useMemo<CatalogModel>(() => {
        // Live model is the source of truth once introspected; otherwise the
        // demo bundle. Live values + sort keys layer onto whichever is active.
        let next = liveCatalog ?? base;
        if (liveValues && liveValues.size > 0) next = mergeLiveValues(next, liveValues);
        if (sortKeys && sortKeys.size > 0) next = mergeColumnSortKeys(next, sortKeys);
        return next;
    }, [base, liveCatalog, liveValues, sortKeys]);

    const mode: CatalogMode = liveCatalog ? "live" : "demo";

    return {
        catalog,
        isLoading: false,
        error,
        mode,
        modelConfigured,
        liveStatus,
        refresh,
    };
}
