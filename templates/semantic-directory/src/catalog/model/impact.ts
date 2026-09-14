//-----------------------------------------------------------------------
// Semantic Directory — impact analysis (reverse lineage).
//
// Answers "if I change THIS, what breaks?" by walking the reverse dependency
// graph downstream from a measure or column: every measure that reads it, then
// every measure that reads THOSE, and so on. Results are grouped by distance so
// a steward sees direct dependents first and the full blast radius below.
//
// Pure + deterministic, built from the DAX dependency graph already resolved in
// both the live and bundled build paths (`usedByMeasures`). No AI.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta, MeasureMeta } from "./types";
import { normName } from "./types";
import { memoByCatalog, memoByCatalogKey } from "../memo";

/** One ring of the blast radius: measures at a fixed distance from the root. */
export interface ImpactLevel {
    /** Hops from the root (1 = reads the root directly). */
    depth: number;
    /** Measures at this depth, sorted by display name. */
    measures: MeasureMeta[];
}

export interface ImpactResult {
    /** The entity whose downstream we traced. */
    root: { kind: "measure" | "column"; key: string; displayName: string };
    /** Distinct downstream measures across every level. */
    total: number;
    /** Downstream measures grouped by depth (nearest first). */
    levels: ImpactLevel[];
    /** Deepest chain length reached. */
    maxDepth: number;
}

/** Normalized measure name → measure, built once per measure list. */
function measureIndex(measures: MeasureMeta[]): Map<string, MeasureMeta> {
    return new Map(measures.map((m) => [normName(m.name), m]));
}

/**
 * Transitive downstream measures for a measure or column, grouped by depth.
 * Seeds from the entity's own `usedByMeasures`, then BFS over each measure's
 * `usedByMeasures`. A global visited set assigns every measure to its SHALLOWEST
 * depth and doubles as the cycle guard, so mutually-referential measures (or a
 * measure that transitively references the root) can't loop or double-count.
 */
export const impactOf = memoByCatalogKey(
    (
        catalog: CatalogModel,
        entity: MeasureMeta | ColumnMeta,
    ): ImpactResult => {
        const byNorm = measureIndex(catalog.measures);
        const root = {
            kind: entity.kind,
            key: entity.key,
            displayName: entity.displayName,
        } as ImpactResult["root"];

        // The root measure is never part of its own blast radius.
        const visited = new Set<string>(
            entity.kind === "measure" ? [normName(entity.name)] : [],
        );

        const levels: ImpactLevel[] = [];
        // Seed: measures that reference the entity directly (depth 1).
        let frontier = (entity.usedByMeasures ?? [])
            .map((n) => normName(n))
            .filter((n) => {
                if (visited.has(n)) return false;
                visited.add(n);
                return true;
            });

        let depth = 1;
        let total = 0;
        while (frontier.length) {
            const measures = frontier
                .map((n) => byNorm.get(n))
                .filter((m): m is MeasureMeta => Boolean(m))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));
            if (measures.length) {
                levels.push({ depth, measures });
                total += measures.length;
            }

            const next: string[] = [];
            for (const n of frontier) {
                const m = byNorm.get(n);
                for (const up of m?.usedByMeasures ?? []) {
                    const k = normName(up);
                    if (visited.has(k)) continue;
                    visited.add(k);
                    next.push(k);
                }
            }
            frontier = next;
            depth++;
        }

        return {
            root,
            total,
            levels,
            maxDepth: levels.length ? levels[levels.length - 1].depth : 0,
        };
    },
    (entity: MeasureMeta | ColumnMeta) => `${entity.kind}:${entity.key}`,
);

/** An impact result with hidden measures dropped and totals recomputed. */
export interface VisibleImpact {
    levels: ImpactLevel[];
    total: number;
    maxDepth: number;
}

/**
 * The visible slice of a blast radius. Hidden measures aren't surfaced anywhere
 * else in the app (matching the "Used by" tab), so drop them from every level,
 * skip levels that empty out, and recompute the total + reach. Pure and cheap —
 * both the embedded panel and the standalone tool render from this.
 */
export function visibleImpact(impact: ImpactResult): VisibleImpact {
    const levels = impact.levels
        .map((lvl) => ({
            depth: lvl.depth,
            measures: lvl.measures.filter((mm) => !mm.isHidden),
        }))
        .filter((lvl) => lvl.measures.length > 0);
    const total = levels.reduce((n, lvl) => n + lvl.measures.length, 0);
    const maxDepth = levels.length ? levels[levels.length - 1].depth : 0;
    return { levels, total, maxDepth };
}

/**
 * The measure or field with the largest *visible* blast radius — the natural
 * default for the standalone impact tool (as path-finder auto-picks a connected
 * pair). Ranked by downstream count, ties broken alphabetically so the pick is
 * deterministic across reloads. Falls back to the alphabetically-first entity
 * when nothing is downstream of anything, so the tool always seeds a root.
 */
export const topImpactRoot = memoByCatalog(
    (catalog: CatalogModel): MeasureMeta | ColumnMeta | undefined => {
        let best: MeasureMeta | ColumnMeta | undefined;
        let bestTotal = -1;
        const consider = (e: MeasureMeta | ColumnMeta) => {
            if (e.isHidden) return;
            const total = visibleImpact(impactOf(catalog, e)).total;
            const better =
                total > bestTotal ||
                (total === bestTotal && best !== undefined && e.displayName.localeCompare(best.displayName) < 0);
            if (better) {
                best = e;
                bestTotal = total;
            }
        };
        for (const mm of catalog.measures) consider(mm);
        for (const cc of catalog.columns) consider(cc);
        return best;
    },
);
