//-----------------------------------------------------------------------
// Semantic Directory — relationship path-finder.
//
// Answers "can I relate table A to table B, and how?" by finding the SHORTEST
// join path between two tables over the model's active relationships. Returns
// the ordered table chain plus, for every hop, the exact relationship used
// (join columns + cardinality + direction) so a report author knows whether the
// join is safe (many-to-one) or needs care (many-to-many / bidirectional).
//
// Pure + deterministic, built only from INFO.VIEW.RELATIONSHIPS metadata — no
// AI. Undirected BFS: relationships filter in both directions regardless of the
// stored From/To orientation, so the path mirrors what the model can actually
// slice.
//-----------------------------------------------------------------------

import type { CatalogModel, RelationshipMeta } from "../model/types";
import { normName } from "../model/types";
import { memoByCatalog, memoByCatalogKey } from "../memo";

/** One join step along a relationship path (oriented as travelled). */
export interface PathHop {
    /** Table we travel FROM on this hop (display name). */
    fromTable: string;
    /** Table we travel TO on this hop (display name). */
    toTable: string;
    /** Column on `fromTable` used by the relationship. */
    fromColumn: string;
    /** Column on `toTable` used by the relationship. */
    toColumn: string;
    /** Cardinality on the `fromTable` side, as travelled (e.g. "Many"/"One"). */
    fromCardinality: string;
    /** Cardinality on the `toTable` side, as travelled (e.g. "Many"/"One"). */
    toCardinality: string;
    /** True when the relationship filters both ways (bidirectional). */
    bidirectional: boolean;
}

export interface RelationshipPath {
    /** Ordered table display names from source to target (inclusive). */
    tables: string[];
    /** One hop per relationship traversed (empty when source === target). */
    hops: PathHop[];
    /** Number of relationships crossed. */
    length: number;
    /**
     * How many distinct shortest paths of this length connect the two tables
     * (>=1). The displayed path is one of them; a value >1 means equal-length
     * alternates exist. Clamped to avoid meaningless huge counts in dense models.
     */
    pathCount: number;
}

/** A table option for the path-finder pickers. */
export interface PathTableOption {
    /** Table display name. */
    name: string;
    /** True when the table participates in at least one active relationship. */
    connected: boolean;
}

interface Edge {
    /** Normalized name of the table on the other end of the relationship. */
    to: string;
    rel: RelationshipMeta;
    /** True when this edge is stored From→To (vs traversed To→From). */
    forward: boolean;
}

/** Adjacency list with full edge detail, over ACTIVE relationships only. */
const edgesOf = memoByCatalog((catalog: CatalogModel): Map<string, Edge[]> => {
    const adj = new Map<string, Edge[]>();
    const add = (from: string, to: string, rel: RelationshipMeta, forward: boolean) => {
        const key = normName(from);
        if (!adj.has(key)) adj.set(key, []);
        adj.get(key)!.push({ to: normName(to), rel, forward });
    };
    for (const r of catalog.relationships) {
        if (!r.isActive) continue;
        add(r.fromTable, r.toTable, r, true);
        add(r.toTable, r.fromTable, r, false);
    }
    return adj;
});

/** Normalized-name → display-name table lookup, built once per catalog. */
const displayNameByNorm = memoByCatalog(
    (catalog: CatalogModel) =>
        new Map(catalog.tables.map((t) => [normName(t.name), t.name])),
);

/** True when a cross-filter behaviour string denotes bidirectional filtering. */
function isBidirectional(crossFilter: string): boolean {
    return /both/i.test(crossFilter);
}

/** Turn a stored edge into a hop oriented in the direction we travelled it. */
function hopFromEdge(
    edge: Edge,
    fromDisplay: string,
    toDisplay: string,
): PathHop {
    const r = edge.rel;
    // The stored relationship is From→To. When we traverse it backwards
    // (forward === false) the columns/cardinalities swap to match travel order.
    return {
        fromTable: fromDisplay,
        toTable: toDisplay,
        fromColumn: edge.forward ? r.fromColumn : r.toColumn,
        toColumn: edge.forward ? r.toColumn : r.fromColumn,
        fromCardinality: edge.forward ? r.fromCardinality : r.toCardinality,
        toCardinality: edge.forward ? r.toCardinality : r.fromCardinality,
        bidirectional: isBidirectional(r.crossFilter),
    };
}

/** Upper bound on the alternate-path count we bother to compute/display. */
const PATH_COUNT_CAP = 99;

/**
 * Deterministic neighbour ordering so the SAME pair always yields the SAME
 * displayed path regardless of catalog/relationship insertion order. Tie-break:
 * destination display name → relationship id → travelled from/to columns.
 */
function sortedEdges(edges: Edge[], byNorm: Map<string, string>): Edge[] {
    return [...edges].sort((a, b) => {
        const da = byNorm.get(a.to) ?? a.to;
        const db = byNorm.get(b.to) ?? b.to;
        if (da !== db) return da.localeCompare(db);
        if (a.rel.id !== b.rel.id) return a.rel.id.localeCompare(b.rel.id);
        const afc = a.forward ? a.rel.fromColumn : a.rel.toColumn;
        const bfc = b.forward ? b.rel.fromColumn : b.rel.toColumn;
        if (afc !== bfc) return afc.localeCompare(bfc);
        const atc = a.forward ? a.rel.toColumn : a.rel.fromColumn;
        const btc = b.forward ? b.rel.toColumn : b.rel.fromColumn;
        return atc.localeCompare(btc);
    });
}

/**
 * Shortest active-relationship path between two tables. Returns `null` when
 * either table is unknown or no path connects them; an empty-hop path when
 * source and target are the same table.
 *
 * Uses a shortest-path COUNTING BFS: it records, per node, the distance from the
 * source and how many shortest paths reach it, so it can report whether
 * equal-length alternates exist. One deterministic predecessor is kept per node
 * for the displayed chain.
 */
export const findRelationshipPath = memoByCatalogKey(
    (
        catalog: CatalogModel,
        fromTable: string,
        toTable: string,
    ): RelationshipPath | null => {
        const byNorm = displayNameByNorm(catalog);
        const start = normName(fromTable);
        const goal = normName(toTable);
        if (!byNorm.has(start) || !byNorm.has(goal)) return null;

        if (start === goal) {
            return { tables: [byNorm.get(start)!], hops: [], length: 0, pathCount: 1 };
        }

        const adj = edgesOf(catalog);
        const distance = new Map<string, number>([[start, 0]]);
        const pathCount = new Map<string, number>([[start, 1]]);
        // First (deterministic) predecessor for path reconstruction.
        const cameBy = new Map<string, { parent: string; edge: Edge }>();
        const queue: string[] = [start];

        while (queue.length) {
            const cur = queue.shift()!;
            const dCur = distance.get(cur)!;
            const cCur = pathCount.get(cur)!;
            for (const edge of sortedEdges(adj.get(cur) ?? [], byNorm)) {
                const nb = edge.to;
                if (!distance.has(nb)) {
                    distance.set(nb, dCur + 1);
                    pathCount.set(nb, Math.min(cCur, PATH_COUNT_CAP));
                    cameBy.set(nb, { parent: cur, edge });
                    queue.push(nb);
                } else if (distance.get(nb) === dCur + 1) {
                    // Another equally-short path into nb — count it, but keep the
                    // deterministic first predecessor for display.
                    pathCount.set(nb, Math.min(pathCount.get(nb)! + cCur, PATH_COUNT_CAP));
                }
            }
        }

        if (!cameBy.has(goal)) return null;

        // Walk the deterministic predecessors back from the goal, then reverse.
        const revNodes: string[] = [goal];
        const revEdges: Edge[] = [];
        let node = goal;
        while (node !== start) {
            const step = cameBy.get(node)!;
            revEdges.push(step.edge);
            node = step.parent;
            revNodes.push(node);
        }
        const nodes = revNodes.reverse();
        const edges = revEdges.reverse();

        const tables = nodes.map((n) => byNorm.get(n) ?? n);
        const hops = edges.map((edge, i) =>
            hopFromEdge(edge, tables[i], tables[i + 1]),
        );
        return { tables, hops, length: hops.length, pathCount: pathCount.get(goal)! };
    },
    (fromTable: string, toTable: string) =>
        `${normName(fromTable)}→${normName(toTable)}`,
);

/**
 * Tables offered in the path-finder pickers: every visible table, flagged with
 * whether it's wired into the relationship graph (so islands are visible as
 * "unconnected" rather than silently missing).
 */
export const pathTableOptions = memoByCatalog(
    (catalog: CatalogModel): PathTableOption[] => {
        const adj = edgesOf(catalog);
        return catalog.tables
            .filter((t) => !t.isHidden)
            .map((t) => ({
                name: t.name,
                connected: (adj.get(normName(t.name))?.length ?? 0) > 0,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    },
);
