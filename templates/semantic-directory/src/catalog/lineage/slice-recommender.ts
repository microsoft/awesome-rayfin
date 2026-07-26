//-----------------------------------------------------------------------
// Semantic Directory — slice-by recommender.
//
// The old behaviour dumped every model dimension (~397 pills, including raw
// technical columns) whenever a measure lived in the detached shared measures
// table. That destroys trust. This module instead RANKS candidate dimensions
// by how useful they are to a user — favouring curated/friendly fields
// and common archetypes (time, geography, product, scenario…) and penalising
// technical plumbing (IDs, keys, ALL_CAPS_UNDERSCORE names). It returns a small
// curated set plus a grouped, collapsible remainder — never a wall of pills.
//
// Deterministic + metadata-only (no AI): every score is explainable.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta, MeasureMeta } from "../model/types";
import { normName } from "../model/types";
import { reachableTables, sliceDimensions, type SliceDimension } from "./relationships";
import { memoByCatalog, memoByCatalogKey } from "../memo";

export type SliceArchetype =
    | "time"
    | "geography"
    | "product"
    | "scenario"
    | "channel"
    | "customer"
    | "organization"
    | "other";

export interface RankedSlice {
    table: string;
    column: ColumnMeta;
    score: number;
    archetype: SliceArchetype;
    /** Short, user-friendly reason this slice is suggested. */
    reason: string;
    /** True when the field carries curated enrichment (a "known-good" slice). */
    friendly: boolean;
}

export interface SliceRecommendation {
    /** The best handful of ways to slice — shown expanded by default. */
    top: RankedSlice[];
    /** Everything else, grouped by source table, ranked within each group. */
    grouped: { table: string; slices: RankedSlice[] }[];
    /** Total candidate dimensions considered. */
    total: number;
    /** "related" when reachable via relationships, "model" for a detached measure. */
    scope: "related" | "model";
    /** The strongest time dimension, used to seed trend questions. */
    primaryTime?: RankedSlice;
}

const ARCHETYPE_HINTS: { archetype: SliceArchetype; bonus: number; words: string[] }[] = [
    { archetype: "time", bonus: 30, words: ["date", "month", "quarter", "year", "fiscal", "period", "week", "calendar", "qtr"] },
    { archetype: "product", bonus: 26, words: ["product", "sku", "item", "device", "category", "subcategory", "brand", "segment", "model", "style", "color"] },
    { archetype: "geography", bonus: 22, words: ["country", "region", "geo", "market", "territory", "area", "state", "continent"] },
    { archetype: "scenario", bonus: 20, words: ["scenario", "version", "actual", "budget", "forecast", "plan", "ledger"] },
    { archetype: "channel", bonus: 16, words: ["channel", "retail", "digital", "store", "partner", "reseller", "oem"] },
    { archetype: "customer", bonus: 15, words: ["customer", "account", "client", "buyer", "vendor", "member"] },
    { archetype: "organization", bonus: 12, words: ["org", "division", "department", "cost center", "entity", "company", "business unit"] },
];

const ARCHETYPE_LABEL: Record<SliceArchetype, string> = {
    time: "Trend over time",
    geography: "By geography",
    product: "By product",
    scenario: "By scenario",
    channel: "By channel",
    customer: "By customer",
    organization: "By organization",
    other: "Break it down",
};

/** Heuristic: does this name look like technical plumbing rather than a business field? */
function isTechnicalName(name: string): boolean {
    const raw = name.trim();
    if (raw.includes("_")) return true;
    if (/^[A-Z0-9][A-Z0-9 ]{3,}$/.test(raw)) return true; // ALL CAPS
    if (/\b(id|key|code|guid|sk|uid|pk|fk|hash|idx)\b/i.test(raw)) return true;
    if (/(id|key|code|sk|guid|no|num)$/i.test(raw)) return true;
    return false;
}

function classify(dim: SliceDimension): { archetype: SliceArchetype; bonus: number } {
    const hay = normName(`${dim.table} ${dim.column.displayName} ${dim.column.name}`);
    for (const h of ARCHETYPE_HINTS) {
        if (h.words.some((w) => hay.includes(w))) {
            return { archetype: h.archetype, bonus: h.bonus };
        }
    }
    return { archetype: "other", bonus: 0 };
}

function scoreDimension(dim: SliceDimension): RankedSlice {
    const { archetype, bonus } = classify(dim);
    const col = dim.column;
    const friendly = col.enriched || col.displayName !== col.name;

    let score = 8; // base for being a sliceable dimension
    if (friendly) score += 40;
    score += bonus;

    const technical = isTechnicalName(col.displayName || col.name);
    if (technical) score -= 45;
    if (/\d/.test(col.name)) score -= 4;
    if ((col.displayName || col.name).length > 30) score -= 4;
    if (col.summarizeBy && col.summarizeBy !== "none" && col.summarizeBy !== "None") score -= 8;

    const reason = friendly
        ? "Curated field"
        : archetype !== "other"
            ? ARCHETYPE_LABEL[archetype]
            : technical
                ? "Technical field"
                : "Related dimension";

    return { table: dim.table, column: col, score, archetype, reason, friendly };
}

interface ScoredSlice {
    ranked: RankedSlice;
    normTable: string;
}

/**
 * Every model dimension, scored once per catalog. Scoring depends only on the
 * dimension (not the measure), so the regex-heavy classification runs a single
 * time per catalog and every measure open reuses the result.
 */
const scoredDimensionsOf = memoByCatalog((catalog: CatalogModel): ScoredSlice[] =>
    sliceDimensions(catalog).map((d) => ({
        ranked: scoreDimension(d),
        normTable: normName(d.table),
    })),
);

/** Rank the ways a user can realistically slice a measure. */
export const recommendSlices = memoByCatalogKey(
    (
        catalog: CatalogModel,
        measure: MeasureMeta,
        topN: number = 6,
    ): SliceRecommendation => {
        const reachable = reachableTables(catalog, measure.table);
        const scope: "related" | "model" = reachable ? "related" : "model";

        const all = scoredDimensionsOf(catalog);
        const inScope = reachable
            ? all.filter((d) => reachable.has(d.normTable))
            : all;
        const source = inScope.length ? inScope : all;

        // De-duplicate by display name (keep the strongest instance).
        const byName = new Map<string, RankedSlice>();
        for (const { ranked } of source) {
            const key = normName(ranked.column.displayName || ranked.column.name);
            const existing = byName.get(key);
            if (!existing || ranked.score > existing.score) byName.set(key, ranked);
        }

        const ranked = [...byName.values()].sort(
            (a, b) =>
                b.score - a.score ||
                a.table.localeCompare(b.table) ||
                a.column.displayName.localeCompare(b.column.displayName),
        );

        // Curated top: highest scoring, but diversify archetypes so the first row
        // isn't six near-identical date fields.
        const top: RankedSlice[] = [];
        const usedArchetypes = new Set<SliceArchetype>();
        for (const r of ranked) {
            if (top.length >= topN) break;
            if (r.score <= 0) break; // never surface technical fields in the curated set
            const dupeArchetype = usedArchetypes.has(r.archetype) && r.archetype !== "other";
            if (dupeArchetype && top.length >= 3) continue;
            top.push(r);
            usedArchetypes.add(r.archetype);
        }
        // If diversification left us short, backfill with the next best remaining.
        if (top.length < topN) {
            for (const r of ranked) {
                if (top.length >= topN) break;
                if (r.score <= 0) break;
                if (!top.includes(r)) top.push(r);
            }
        }

        const topKeys = new Set(top.map((t) => normName(t.column.displayName || t.column.name)));
        const remainder = ranked.filter(
            (r) => !topKeys.has(normName(r.column.displayName || r.column.name)),
        );

        const groupMap = new Map<string, RankedSlice[]>();
        for (const r of remainder) {
            if (!groupMap.has(r.table)) groupMap.set(r.table, []);
            groupMap.get(r.table)!.push(r);
        }
        const grouped = [...groupMap.entries()]
            .map(([table, slices]) => ({
                table,
                slices: slices.sort((a, b) => b.score - a.score),
            }))
            .sort((a, b) => b.slices[0].score - a.slices[0].score || a.table.localeCompare(b.table));

        const primaryTime = ranked.find((r) => r.archetype === "time" && r.score > 0);

        return { top, grouped, total: ranked.length, scope, primaryTime };
    },
    (measure: MeasureMeta, topN: number = 6) => `${measure.key}::${topN}`,
);
