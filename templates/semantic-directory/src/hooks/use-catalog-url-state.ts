//-----------------------------------------------------------------------
// Semantic Directory — catalog URL state (shareable deep-links).
//
// The app is a single-view SPA with no router, but every meaningful view — a
// search, a filter, an open entity, a browse area, or a tool — is encodable.
// This hook mirrors that state into `location.hash` so any view is a copyable,
// bookmarkable link that survives reload and works inside the Fabric iframe.
//
// Hash writes use history.replaceState (no navigation entry, no hashchange
// storm); external hashchanges (back/forward, hand-edited URL) flow back in.
// All history access is best-effort try/catch — a sandboxed embed that blocks
// it must never crash the app.
//-----------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import type { EntityKind } from "@/catalog/model/types";

export type KindFilter = "all" | EntityKind;
export type ToolId = "health" | "pathfinder" | "impact";

export interface CatalogUrlState {
    query: string;
    filter: KindFilter;
    selectedKey?: string;
    browseTopic?: string;
    browseThemeId?: string;
    tool?: ToolId;
    /** Path-finder source table (deep-link; only meaningful when tool==="pathfinder"). */
    pfFrom?: string;
    /** Path-finder target table (deep-link; only meaningful when tool==="pathfinder"). */
    pfTo?: string;
    /** Impact-tool root entity key (deep-link; only meaningful when tool==="impact"). */
    impactKey?: string;
}

const DEFAULT_STATE: CatalogUrlState = { query: "", filter: "all" };
const FILTERS: readonly string[] = ["all", "measure", "column", "table"];
const TOOLS: readonly string[] = ["health", "pathfinder", "impact"];

/** Parse a `location.hash` string into catalog state (defaults on empty/garbage). */
export function parseCatalogHash(hash: string): CatalogUrlState {
    const raw = hash.replace(/^#/, "");
    if (!raw) return { ...DEFAULT_STATE };
    const p = new URLSearchParams(raw);
    const filter = p.get("filter");
    const tool = p.get("tool");
    return {
        query: p.get("q") ?? "",
        filter: FILTERS.includes(filter ?? "") ? (filter as KindFilter) : "all",
        selectedKey: p.get("sel") || undefined,
        browseTopic: p.get("topic") || undefined,
        browseThemeId: p.get("theme") || undefined,
        tool: TOOLS.includes(tool ?? "") ? (tool as ToolId) : undefined,
        pfFrom: p.get("pf") || undefined,
        pfTo: p.get("pt") || undefined,
        impactKey: p.get("ie") || undefined,
    };
}

/** Serialize catalog state to a hash query string (omitting defaults). */
export function serializeCatalogHash(state: CatalogUrlState): string {
    const p = new URLSearchParams();
    if (state.query.trim()) p.set("q", state.query);
    if (state.filter !== "all") p.set("filter", state.filter);
    if (state.selectedKey) p.set("sel", state.selectedKey);
    if (state.browseTopic) p.set("topic", state.browseTopic);
    if (state.browseThemeId) p.set("theme", state.browseThemeId);
    if (state.tool) p.set("tool", state.tool);
    // Path-finder selection only travels with the path-finder view.
    if (state.tool === "pathfinder") {
        if (state.pfFrom) p.set("pf", state.pfFrom);
        if (state.pfTo) p.set("pt", state.pfTo);
    }
    // The impact root only travels with the impact view.
    if (state.tool === "impact" && state.impactKey) p.set("ie", state.impactKey);
    return p.toString();
}

function currentHash(): string {
    if (typeof window === "undefined") return "";
    return window.location.hash;
}

/**
 * Owns all catalog view state, synced to the URL hash. Returns the state, a
 * merge-patch setter, and a reset-to-home action.
 */
export function useCatalogUrlState(): [
    CatalogUrlState,
    (patch: Partial<CatalogUrlState>) => void,
    () => void,
] {
    const [state, setState] = useState<CatalogUrlState>(() =>
        parseCatalogHash(currentHash()),
    );

    // State → hash. replaceState keeps the address bar honest without spamming
    // the history stack or firing hashchange (so it can't feed back into us).
    useEffect(() => {
        if (typeof window === "undefined") return;
        const next = serializeCatalogHash(state);
        const cur = window.location.hash.replace(/^#/, "");
        if (next === cur) return;
        try {
            const base = window.location.pathname + window.location.search;
            window.history.replaceState(null, "", next ? `#${next}` : base);
        } catch {
            // Sandboxed embed blocked history access — in-memory state still works.
        }
    }, [state]);

    // hash → state, for real external navigation (back/forward, hand-edited URL).
    // Our own writes use replaceState and never land here.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onHash = () => setState(parseCatalogHash(window.location.hash));
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, []);

    const patch = useCallback(
        (p: Partial<CatalogUrlState>) => setState((s) => ({ ...s, ...p })),
        [],
    );
    const reset = useCallback(() => setState({ ...DEFAULT_STATE }), []);

    return [state, patch, reset];
}
