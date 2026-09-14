//-----------------------------------------------------------------------
// Semantic Directory — "where does this sit in the model" neighborhood.
//
// Turns the relationship + lineage graph into a small, two-sided picture a
// user can orient around: what an item is BUILT FROM / ROLLS UP TO
// (upstream, left) and what it FEEDS / can be SLICED BY (downstream, right).
// Deterministic — every node/edge comes from the model's own relationships and
// DAX lineage, never a guess. Powers the ModelPosition mini-graph.
//-----------------------------------------------------------------------

import type {
    CatalogModel,
    ColumnMeta,
    MeasureMeta,
    TableMeta,
    EntityKind,
} from "../model/types";
import { normName, tableKey } from "../model/types";
import type { CatalogEntity } from "@/components/catalog/entity-detail";
import { recommendSlices } from "./slice-recommender";
import { columnRollUp } from "./relationships";

export interface GraphNode {
    key: string;
    label: string;
    kind: "measure" | "column" | "table";
    emoji?: string;
    /** Tiny edge annotation, e.g. "∗→1", "slice by", "reads". */
    edge?: string;
    /** Whether clicking should navigate to this entity. */
    navigable: boolean;
}

export interface Neighborhood {
    center: { label: string; kind: EntityKind; emoji?: string; role: string };
    upstreamLabel: string;
    downstreamLabel: string;
    /** Full upstream/downstream lists — the view caps + expands them. */
    upstream: GraphNode[];
    downstream: GraphNode[];
    note: string;
}

function dedupe(nodes: GraphNode[]): GraphNode[] {
    const seen = new Set<string>();
    const out: GraphNode[] = [];
    for (const n of nodes) {
        if (seen.has(n.key)) continue;
        seen.add(n.key);
        out.push(n);
    }
    return out;
}

function tableIndex(catalog: CatalogModel): Map<string, TableMeta> {
    const map = new Map<string, TableMeta>();
    for (const t of catalog.tables) map.set(normName(t.name), t);
    return map;
}

function measureIndex(catalog: CatalogModel): Map<string, MeasureMeta> {
    const map = new Map<string, MeasureMeta>();
    for (const m of catalog.measures) map.set(normName(m.name), m);
    return map;
}

function tableNode(tables: Map<string, TableMeta>, name: string, edge?: string): GraphNode {
    const t = tables.get(normName(name));
    return {
        key: t ? t.key : tableKey(name),
        label: t?.displayName ?? name,
        kind: "table",
        emoji: t?.emoji,
        edge,
        navigable: Boolean(t) && !(t?.isHidden ?? false),
    };
}

const ROLE: Record<string, string> = {
    fact: "Fact table",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge",
    security: "Security / RLS",
    operational: "Operational",
};

/**
 * Build the two-sided neighborhood for any catalog entity. Returns `null`
 * when there is nothing meaningful to show (keeps the UI honest).
 */
export function buildNeighborhood(
    catalog: CatalogModel,
    entity: CatalogEntity,
): Neighborhood | null {
    const tables = tableIndex(catalog);

    if (entity.kind === "measure") {
        const m = entity as MeasureMeta;
        const sourceTables = (m.usesTables?.length ? m.usesTables : m.sources?.length ? m.sources : [m.table])
            .filter((t) => normName(t) !== normName(m.table)); // drop its own measure-home
        const upstream = dedupe(sourceTables.map((t) => tableNode(tables, t, "reads")));
        const slices = recommendSlices(catalog, m).top.map<GraphNode>((s) => ({
            key: s.column.key,
            label: s.column.displayName,
            kind: "column",
            edge: "slice by",
            navigable: true,
        }));
        const downstream = dedupe(slices);
        if (!upstream.length && !downstream.length) return null;
        return {
            center: { label: m.displayName, kind: "measure", emoji: m.emoji, role: "Measure" },
            upstreamLabel: "Built from",
            downstreamLabel: "Break it down by",
            upstream,
            downstream,
            note:
                upstream.length && downstream.length
                    ? `Calculated from ${upstream.length} source ${upstream.length === 1 ? "table" : "tables"}; can be sliced by ${downstream.length}+ dimensions.`
                    : "How this measure connects to the model.",
        };
    }

    if (entity.kind === "table") {
        const t = entity as TableMeta;
        const home = normName(t.name);
        const rollsUpTo: GraphNode[] = [];
        const referencedBy: GraphNode[] = [];
        for (const r of catalog.relationships) {
            if (!r.isActive) continue;
            if (normName(r.fromTable) === home) rollsUpTo.push(tableNode(tables, r.toTable, "∗→1"));
            else if (normName(r.toTable) === home) referencedBy.push(tableNode(tables, r.fromTable, "∗→1"));
        }
        const upstream = dedupe(rollsUpTo);
        const downstream = dedupe(referencedBy);
        if (!upstream.length && !downstream.length) return null;
        return {
            center: {
                label: t.displayName,
                kind: "table",
                emoji: t.emoji,
                role: t.ontology ? (ROLE[t.ontology] ?? t.ontology) : "Table",
            },
            upstreamLabel: "Joins to",
            downstreamLabel: "Referenced by",
            upstream,
            downstream,
            note: `${upstream.length} join${upstream.length === 1 ? "" : "s"} out · ${downstream.length} table${downstream.length === 1 ? "" : "s"} point here.`,
        };
    }

    // column / dimension
    const c = entity as ColumnMeta;
    const measures = measureIndex(catalog);
    const upstream = dedupe([
        tableNode(tables, c.table, "field of"),
        ...columnRollUp(catalog, c).map((t) => tableNode(tables, t, "rolls up to")),
    ]);
    const usedBy = (c.usedByMeasures ?? [])
        .map((n) => measures.get(normName(n)))
        .filter((mm): mm is MeasureMeta => Boolean(mm) && !mm!.isHidden)
        .map<GraphNode>((mm) => ({
            key: mm.key,
            label: mm.displayName,
            kind: "measure",
            emoji: mm.emoji,
            edge: "reads this",
            navigable: true,
        }));
    const downstream = dedupe(usedBy);
    if (!upstream.length && !downstream.length) return null;
    return {
        center: { label: c.displayName, kind: "column", emoji: c.emoji, role: "Dimension field" },
        upstreamLabel: "Lives in",
        downstreamLabel: "Used by measures",
        upstream,
        downstream,
        note: downstream.length
            ? `${downstream.length}${c.usedByMeasures && c.usedByMeasures.length > downstream.length ? "+" : ""} measures read this field directly.`
            : "A dimension field you can slice measures by.",
    };
}
