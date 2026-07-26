//-----------------------------------------------------------------------
// Semantic Directory — relationship graph: slice-by compatibility + roll-ups.
//
// The model uses a shared measures table ("Reporting Measures"), so a measure's
// home table usually has no relationships. We therefore expose two things:
//   - sliceDimensions(): every dimension column that participates in a
//     relationship — the model's sliceable fields (the global "Slice by").
//   - compatibleSlices(measure): dimensions reachable from the measure's home
//     table via the relationship graph, falling back to ALL model dimensions
//     when the home table is a detached measures table.
//   - tableNeighbors()/columnRollUp(): star-schema navigation for detail views.
//-----------------------------------------------------------------------

import type {
    CatalogModel,
    ColumnMeta,
    RelationshipMeta,
} from "../model/types";
import { normName } from "../model/types";
import { memoByCatalog, memoByCatalogKey } from "../memo";

export interface SliceDimension {
    table: string;
    column: ColumnMeta;
}

/** Adjacency list over tables (active relationships only). */
function buildAdjacency(
    relationships: RelationshipMeta[],
): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
        const key = normName(a);
        if (!adj.has(key)) adj.set(key, new Set());
        adj.get(key)!.add(normName(b));
    };
    for (const r of relationships) {
        if (!r.isActive) continue;
        link(r.fromTable, r.toTable);
        link(r.toTable, r.fromTable);
    }
    return adj;
}

/** Table adjacency, built once per catalog. */
const adjacencyOf = memoByCatalog((catalog: CatalogModel) =>
    buildAdjacency(catalog.relationships),
);

/** Normalized-name → display-name table lookup, built once per catalog. */
const tableNameByNorm = memoByCatalog(
    (catalog: CatalogModel) =>
        new Map(catalog.tables.map((t) => [normName(t.name), t.name])),
);

/** Set of normalized table names that participate in any relationship. */
function relationshipTables(relationships: RelationshipMeta[]): Set<string> {
    const set = new Set<string>();
    for (const r of relationships) {
        set.add(normName(r.fromTable));
        set.add(normName(r.toTable));
    }
    return set;
}

/**
 * Every dimension-like column whose table participates in a relationship.
 * These are the fields a user can realistically slice a report by.
 */
export const sliceDimensions = memoByCatalog(
    (catalog: CatalogModel): SliceDimension[] => {
        const relTables = relationshipTables(catalog.relationships);
        const out: SliceDimension[] = [];
        for (const c of catalog.columns) {
            if (c.isHidden || !c.isDimensionLike) continue;
            if (!relTables.has(normName(c.table))) continue;
            out.push({ table: c.table, column: c });
        }
        return out.sort(
            (a, b) =>
                a.table.localeCompare(b.table)
                || a.column.name.localeCompare(b.column.name),
        );
    },
);

/** Tables directly related to the given table. */
export function tableNeighbors(
    catalog: CatalogModel,
    table: string,
): string[] {
    const adj = adjacencyOf(catalog);
    const neighbors = adj.get(normName(table));
    if (!neighbors) return [];
    const byNorm = tableNameByNorm(catalog);
    return Array.from(neighbors)
        .map((n) => byNorm.get(n) ?? n)
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Tables reachable from a starting table via active relationships. Returns
 * `null` when the table isn't wired into the relationship graph at all (e.g. a
 * detached shared measures table), signalling "model-wide" scope to callers.
 */
export const reachableTables = memoByCatalogKey(
    (catalog: CatalogModel, table: string): Set<string> | null => {
        const adj = adjacencyOf(catalog);
        const home = normName(table);
        if (!adj.has(home)) return null;

        const reachable = new Set<string>([home]);
        const queue = [home];
        while (queue.length) {
            const cur = queue.shift()!;
            for (const next of adj.get(cur) ?? []) {
                if (!reachable.has(next)) {
                    reachable.add(next);
                    queue.push(next);
                }
            }
        }
        return reachable;
    },
    (table: string) => table,
);

/**
 * Roll-up chain for a dimension column: the related tables its table joins to
 * on the "one" side (e.g. a detail table rolling up to a summary table).
 */
export function columnRollUp(
    catalog: CatalogModel,
    column: ColumnMeta,
): string[] {
    const out: string[] = [];
    for (const r of catalog.relationships) {
        if (!r.isActive) continue;
        if (normName(r.fromTable) === normName(column.table)) {
            out.push(r.toTable);
        }
    }
    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
}
