//-----------------------------------------------------------------------
// Semantic Directory — real lineage graph.
//
// Resolves, for every measure, the chain:
//     measure → columns/tables (from DAX) → source system
// and rolls source systems up onto measures + families. One level of measure
// dependency is followed so a wrapper measure inherits its children's systems.
//
// Deterministic + offline: every edge is a token parsed from real DAX or the
// physical-source map from the catalog.
//-----------------------------------------------------------------------

import type { MeasureMeta, TableMeta } from "./types";
import { normName } from "./types";

/** Map of normalized table name → source-system id (from the bundle). */
export function tableSystemMap(tables: TableMeta[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const t of tables) {
        if (t.sourceSystem) map.set(normName(t.name), t.sourceSystem);
    }
    return map;
}

/**
 * Stamp `sourceSystems` onto each measure. Assumes each measure already has
 * `dependsOnMeasures` and a (transitively resolved) `usesTables`. Follows one
 * hop of measure dependency so wrapper measures inherit their children's
 * systems even if `usesTables` rollup was skipped.
 */
export function resolveSourceSystems(
    measures: MeasureMeta[],
    tables: TableMeta[],
): void {
    const sysByTable = tableSystemMap(tables);
    const byKey = new Map(measures.map((m) => [normName(m.name), m]));

    const directSystems = (m: MeasureMeta): Set<string> => {
        const out = new Set<string>();
        for (const tbl of m.usesTables ?? []) {
            const sys = sysByTable.get(normName(tbl));
            if (sys) out.add(sys);
        }
        return out;
    };

    // Precompute direct systems, then fold in one hop of children.
    const direct = new Map<string, Set<string>>();
    for (const m of measures) direct.set(normName(m.name), directSystems(m));

    for (const m of measures) {
        const combined = new Set(direct.get(normName(m.name)) ?? []);
        for (const childKey of m.dependsOnMeasures ?? []) {
            const child = byKey.get(childKey);
            if (!child) continue;
            for (const s of direct.get(childKey) ?? []) combined.add(s);
        }
        m.sourceSystems = [...combined].sort();
    }
}

/**
 * Expand each measure's `usesTables` to its TRANSITIVE closure through measure
 * dependencies. A wrapper measure (e.g. `[Revenue YoY] = [Revenue] - [Revenue
 * PY]`) references only other measures in its DAX, so its direct table set is
 * empty; without this, lineage / source-table / browse-metric counts silently
 * fall back to the measure's home (host) table. Assumes each measure already
 * has a DIRECT `usesTables` and `dependsOnMeasures` from the DAX parse. Pure +
 * deterministic, with a cycle guard so malformed models can't loop forever.
 */
export function resolveTransitiveTables(measures: MeasureMeta[]): void {
    const byKey = new Map(measures.map((m) => [normName(m.name), m]));
    const cache = new Map<string, Set<string>>();
    const visiting = new Set<string>();

    const resolve = (key: string): Set<string> => {
        const cached = cache.get(key);
        if (cached) return cached;
        const m = byKey.get(key);
        if (!m) return new Set();
        // Cycle: return this measure's direct tables only (best-effort).
        if (visiting.has(key)) return new Set(m.usesTables ?? []);
        visiting.add(key);
        const out = new Set<string>(m.usesTables ?? []);
        for (const dep of m.dependsOnMeasures ?? []) {
            for (const t of resolve(normName(dep))) out.add(t);
        }
        visiting.delete(key);
        cache.set(key, out);
        return out;
    };

    // Resolve everything against the ORIGINAL direct sets first, then write the
    // expanded sets back — so the traversal never reads a half-expanded value.
    const resolved = new Map<string, string[]>();
    for (const m of measures) {
        resolved.set(normName(m.name), [...resolve(normName(m.name))].sort());
    }
    for (const m of measures) {
        m.usesTables = resolved.get(normName(m.name)) ?? m.usesTables ?? [];
    }
}

/**
 * Build the reverse dependency edges: for each measure, which measures /
 * columns reference it. Mutates measures + columns' `usedByMeasures`.
 */
export function resolveReverseDependencies(
    measures: MeasureMeta[],
    columnUsedBy: Map<string, string[]>,
): void {
    const usedBy = new Map<string, Set<string>>();
    for (const m of measures) {
        for (const dep of m.dependsOnMeasures ?? []) {
            if (!usedBy.has(dep)) usedBy.set(dep, new Set());
            usedBy.get(dep)!.add(normName(m.name));
        }
        for (const col of m.dependsOnColumns ?? []) {
            const k = normName(col);
            if (!columnUsedBy.has(k)) columnUsedBy.set(k, []);
            columnUsedBy.get(k)!.push(normName(m.name));
        }
    }
    for (const m of measures) {
        const set = usedBy.get(normName(m.name));
        m.usedByMeasures = set ? [...set].sort() : [];
    }
}
