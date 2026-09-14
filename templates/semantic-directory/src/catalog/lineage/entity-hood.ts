//-----------------------------------------------------------------------
// Semantic Directory — entity neighborhood (v2, categorized sectors).
//
// The old buildNeighborhood gave a *linear* two-sided picture (upstream ←
// item → downstream), so most items showed only ~2 nodes. buildEntityHood
// instead returns the item's FULL context as categorized sectors — source
// tables, the measures it's built from, its family siblings, the measures
// that read it, the dimensions it slices by, etc. — so the EntityConstellation
// can render a genuinely broad + deep radial map. Every node is a real,
// clickable model entity. Deterministic, metadata-only — no AI, no guesses.
//-----------------------------------------------------------------------

import type {
    CatalogModel,
    ColumnMeta,
    MeasureMeta,
    TableMeta,
    EntityKind,
} from "../model/types";
import { normName } from "../model/types";
import type { CatalogEntity } from "@/components/catalog/entity-detail";
import { recommendSlices } from "./slice-recommender";
import { columnRollUp } from "./relationships";
import { memoByCatalog, memoByCatalogKey } from "../memo";

export type NodeKind = "measure" | "column" | "table";

/**
 * Per-sector node budget. Sectors are capped here (after deterministic ranking)
 * so a hub entity in a LARGE model — a foundational measure read by hundreds of
 * others, a Date field every measure slices by, a fact table dozens of tables
 * point at — bounds both the built payload and the rendered chip count. The
 * sector still reports its true `total`, so the map stays honest about scale
 * while staying legible + performant. Small models are unaffected.
 */
const SECTOR_CAP = 24;

export interface HoodNode {
    key: string;
    label: string;
    kind: NodeKind;
    emoji?: string;
    /** Whether clicking navigates to this entity. */
    navigable: boolean;
    /**
     * Ranking hint (higher = more connected). Used ONLY to decide which members
     * survive when a sector overflows SECTOR_CAP; it never reorders a sector that
     * fits, so small models keep their natural, deterministic order.
     */
    weight?: number;
}

export interface HoodSector {
    id: string;
    /** Short sector heading, e.g. "Built from", "Slice by". */
    label: string;
    /** Colour tone for the sector's nodes. */
    kind: NodeKind;
    /**
     * Node list, capped at SECTOR_CAP and ranked so the most-connected members
     * survive. The view caps display further + shows a "+N" affordance.
     */
    nodes: HoodNode[];
    /**
     * The true distinct member count this sector holds — after any intentional
     * sampling of live example values, but before the SECTOR_CAP display cap — so
     * the view can show an honest total (e.g. "42") even when the map renders fewer.
     */
    total: number;
}

export interface EntityHood {
    center: { label: string; kind: EntityKind; emoji?: string; role: string };
    sectors: HoodSector[];
    /** One-line, plain-English summary of the item's footprint. */
    summary: string;
}

const ROLE: Record<string, string> = {
    fact: "Fact table",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge",
    security: "Security / RLS",
    operational: "Operational",
};

function dedupe(nodes: HoodNode[]): HoodNode[] {
    const seen = new Set<string>();
    const out: HoodNode[] = [];
    for (const n of nodes) {
        if (seen.has(n.key)) continue;
        seen.add(n.key);
        out.push(n);
    }
    return out;
}

const tableIndex = memoByCatalog((catalog: CatalogModel): Map<string, TableMeta> => {
    const map = new Map<string, TableMeta>();
    for (const t of catalog.tables) map.set(normName(t.name), t);
    return map;
});

const measureIndex = memoByCatalog((catalog: CatalogModel): Map<string, MeasureMeta> => {
    const map = new Map<string, MeasureMeta>();
    for (const m of catalog.measures) map.set(normName(m.name), m);
    return map;
});

const measureByKey = memoByCatalog((catalog: CatalogModel): Map<string, MeasureMeta> => {
    const map = new Map<string, MeasureMeta>();
    for (const m of catalog.measures) map.set(m.key, m);
    return map;
});

function tableNode(tables: Map<string, TableMeta>, name: string): HoodNode {
    const t = tables.get(normName(name));
    return {
        key: t ? t.key : `table:${normName(name)}`,
        label: t?.displayName ?? name,
        kind: "table",
        emoji: t?.emoji,
        navigable: Boolean(t) && !(t?.isHidden ?? false),
    };
}

function measureNode(m: MeasureMeta): HoodNode {
    return {
        key: m.key,
        label: m.displayName,
        kind: "measure",
        emoji: m.emoji,
        navigable: !m.isHidden,
        weight: m.usedByMeasures?.length ?? 0,
    };
}

function columnNode(c: ColumnMeta): HoodNode {
    return {
        key: c.key,
        label: c.displayName,
        kind: "column",
        emoji: c.emoji,
        navigable: !c.isHidden,
        weight: c.usedByMeasures?.length ?? 0,
    };
}

/**
 * Deterministic cap-time ranking: most-connected first, then a fixed-locale label
 * and finally the stable key so equal labels never fall back to catalog order.
 */
function rankNode(a: HoodNode, b: HoodNode): number {
    return (
        (b.weight ?? 0) - (a.weight ?? 0)
        || a.label.localeCompare(b.label, "en")
        || a.key.localeCompare(b.key, "en")
    );
}

function sector(id: string, label: string, kind: NodeKind, nodes: HoodNode[]): HoodSector | null {
    const deduped = dedupe(nodes);
    if (!deduped.length) return null;
    // Rank ONLY when the sector overflows the cap, so sectors that fit keep their
    // natural input order and the demo model's chip order never shifts.
    const ordered = deduped.length > SECTOR_CAP ? [...deduped].sort(rankNode) : deduped;
    return { id, label, kind, nodes: ordered.slice(0, SECTOR_CAP), total: deduped.length };
}

/** Distinct count of table nodes (multiple relationships can hit the same pair). */
function distinctCount(nodes: HoodNode[]): number {
    return new Set(nodes.map((n) => n.key)).size;
}

// ---- Measure ---------------------------------------------------------------

function measureHood(catalog: CatalogModel, m: MeasureMeta): EntityHood | null {
    const tables = tableIndex(catalog);
    const measures = measureIndex(catalog);
    const home = normName(m.table);

    const sourceTables = (m.usesTables?.length ? m.usesTables : m.sources?.length ? m.sources : [m.table])
        .filter((t) => normName(t) !== home)
        .map((t) => tableNode(tables, t));

    const builtFrom = (m.dependsOnMeasures ?? [])
        .map((n) => measures.get(normName(n)))
        .filter((x): x is MeasureMeta => Boolean(x))
        .map(measureNode);

    const usedBy = (m.usedByMeasures ?? [])
        .map((n) => measures.get(normName(n)))
        .filter((x): x is MeasureMeta => Boolean(x) && !x!.isHidden)
        .map(measureNode);

    // Family siblings (same cluster, excluding self). memberKeys are entity keys,
    // so resolve them against the key index — not the name index.
    const measuresByKey = measureByKey(catalog);
    const family = m.familyId ? catalog.families?.find((f) => f.id === m.familyId) : undefined;
    const siblings = (family?.memberKeys ?? [])
        .map((k) => measuresByKey.get(k))
        .filter((x): x is MeasureMeta => Boolean(x) && x!.key !== m.key && !x!.isHidden)
        .map(measureNode);

    const slices = recommendSlices(catalog, m).top.map<HoodNode>((s) => ({
        key: s.column.key,
        label: s.column.displayName,
        kind: "column",
        navigable: true,
    }));

    const sectors = [
        sector("source", "Source tables", "table", sourceTables),
        sector("built", "Built from", "measure", builtFrom),
        sector("family", "Family", "measure", siblings),
        sector("usedby", "Feeds measures", "measure", usedBy),
        sector("slice", "Slice by", "column", slices),
    ].filter((s): s is HoodSector => s !== null);

    if (!sectors.length) return null;

    const parts: string[] = [];
    if (sourceTables.length) parts.push(`draws on ${sourceTables.length} ${sourceTables.length === 1 ? "table" : "tables"}`);
    if (builtFrom.length) parts.push(`built from ${builtFrom.length} ${builtFrom.length === 1 ? "measure" : "measures"}`);
    if (slices.length) parts.push(`slices ${slices.length}+ ways`);

    return {
        center: { label: m.displayName, kind: "measure", emoji: m.emoji, role: "Measure" },
        sectors,
        summary: parts.length ? `This measure ${parts.join(" · ")}.` : "How this measure connects to the model.",
    };
}

// ---- Column / dimension ----------------------------------------------------

function columnHood(catalog: CatalogModel, c: ColumnMeta): EntityHood | null {
    const tables = tableIndex(catalog);
    const measures = measureIndex(catalog);

    const homeTable = [tableNode(tables, c.table)];
    const rollUp = columnRollUp(catalog, c).map((t) => tableNode(tables, t));

    const usedBy = (c.usedByMeasures ?? [])
        .map((n) => measures.get(normName(n)))
        .filter((x): x is MeasureMeta => Boolean(x) && !x!.isHidden)
        .map(measureNode);

    // Sibling fields: other dimension fields on the same table, in usage order.
    const siblings = catalog.columns
        .filter((o) => o.key !== c.key && !o.isHidden && o.isDimensionLike && normName(o.table) === normName(c.table))
        .sort((a, b) => (b.usedByMeasures?.length ?? 0) - (a.usedByMeasures?.length ?? 0))
        .map(columnNode);

    // Live member values (non-navigable, a texture of what's inside the field).
    const values = (c.liveValues ?? []).slice(0, 8).map<HoodNode>((v) => ({
        key: `val:${c.key}:${v}`,
        label: v,
        kind: "column",
        navigable: false,
    }));

    const sectors = [
        sector("home", "Lives in", "table", homeTable),
        sector("rollup", "Rolls up to", "table", rollUp),
        sector("usedby", "Used by measures", "measure", usedBy),
        sector("siblings", "Sibling fields", "column", siblings),
        sector("values", "Example values", "column", values),
    ].filter((s): s is HoodSector => s !== null);

    if (!sectors.length) return null;

    return {
        center: { label: c.displayName, kind: "column", emoji: c.emoji, role: "Dimension field" },
        sectors,
        summary: usedBy.length
            ? `${usedBy.length}${c.usedByMeasures && c.usedByMeasures.length > usedBy.length ? "+" : ""} measures read this field, across ${1 + rollUp.length} ${1 + rollUp.length === 1 ? "table" : "tables"}.`
            : "A dimension field you can slice measures by.",
    };
}

// ---- Table -----------------------------------------------------------------

function tableHood(catalog: CatalogModel, t: TableMeta): EntityHood | null {
    const tables = tableIndex(catalog);
    const home = normName(t.name);

    const joinsTo: HoodNode[] = [];
    const referencedBy: HoodNode[] = [];
    for (const r of catalog.relationships) {
        if (!r.isActive) continue;
        if (normName(r.fromTable) === home) joinsTo.push(tableNode(tables, r.toTable));
        else if (normName(r.toTable) === home) referencedBy.push(tableNode(tables, r.fromTable));
    }

    // Measures hosted on this table.
    const hosted = catalog.measures
        .filter((m) => normName(m.table) === home && !m.isHidden)
        .map(measureNode);

    // Key dimension fields in this table, in usage order.
    const dims = catalog.columns
        .filter((c) => normName(c.table) === home && !c.isHidden && c.isDimensionLike)
        .sort((a, b) => (b.usedByMeasures?.length ?? 0) - (a.usedByMeasures?.length ?? 0))
        .map(columnNode);

    const sectors = [
        sector("joins", "Joins to", "table", joinsTo),
        sector("refby", "Referenced by", "table", referencedBy),
        sector("hosted", "Measures here", "measure", hosted),
        sector("dims", "Key fields", "column", dims),
    ].filter((s): s is HoodSector => s !== null);

    if (!sectors.length) return null;

    const joinCount = distinctCount(joinsTo);
    const refCount = distinctCount(referencedBy);

    return {
        center: {
            label: t.displayName,
            kind: "table",
            emoji: t.emoji,
            role: t.ontology ? (ROLE[t.ontology] ?? t.ontology) : "Table",
        },
        sectors,
        summary: `${joinCount} join${joinCount === 1 ? "" : "s"} out · ${refCount} table${refCount === 1 ? "" : "s"} point here · ${t.measureCount} measures · ${t.columnCount} columns.`,
    };
}

/**
 * Build the categorized neighborhood for any catalog entity. Returns `null`
 * when there's nothing meaningful to show (keeps the UI honest).
 */
export const buildEntityHood = memoByCatalogKey(
    (catalog: CatalogModel, entity: CatalogEntity): EntityHood | null => {
        if (entity.kind === "measure") return measureHood(catalog, entity as MeasureMeta);
        if (entity.kind === "table") return tableHood(catalog, entity as TableMeta);
        return columnHood(catalog, entity as ColumnMeta);
    },
    (entity: CatalogEntity) => `${entity.kind}:${entity.key}`,
);
