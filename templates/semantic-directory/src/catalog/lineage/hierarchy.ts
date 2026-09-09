//-----------------------------------------------------------------------
// Semantic Directory — dimension hierarchy resolver.
//
// "Where does this field sit in the product hierarchy?" — answered from the
// model itself, two honest ways:
//   1. FOLDER hierarchy: the model author groups related levels in a display
//      folder (e.g. "Channel Hierarchy" → Channel Category 1..7, "Product" →
//      Super Division → … → Product Family). Those are true, ordered levels.
//   2. TOPIC levels: when a field's own table is thin (e.g. Product Detail holds
//      only "Product Summary"), we surface the other sliceable levels in the
//      same business area (via businessTopic) so the user sees the full set of
//      product/geo/channel levels they can drill through — never a dead end.
// Deterministic: folders, dimension flags, topics, and (when deployed) live
// cardinality all come from the model. No guessed groupings.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta } from "../model/types";
import { normName } from "../model/types";

export interface HierarchyItem {
    key: string;
    label: string;
    emoji?: string;
    table: string;
    /** Raw column name — used to fetch this level's live distinct-count grain. */
    column: string;
    /** The field currently being viewed. */
    current: boolean;
}

export interface HierarchyView {
    title: string;
    note: string;
    /** "levels" = an ordered drill path; "chips" = a related set (no strict order). */
    layout: "levels" | "chips";
    items: HierarchyItem[];
}

const MAX_ITEMS = 8;

/** Tokens too generic to identify a shared dimension subject. */
const STOPWORDS = new Set([
    "detail", "details", "summary", "attributes", "attribute", "group", "groups",
    "dim", "dimension", "table", "data", "fact", "id", "code", "the", "and",
    "sales", "reporting", "historical", "plan", "planning",
]);

/** Significant lowercase tokens (len ≥ 4, not generic) from a table name. */
function subjectTokens(table: string): Set<string> {
    const out = new Set<string>();
    for (const raw of table.toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length >= 4 && !STOPWORDS.has(raw)) out.add(raw);
    }
    return out;
}

/** Fact tables that join INTO a given dimension table (active relationships). */
function factsInto(catalog: CatalogModel, table: string): Set<string> {
    const home = normName(table);
    const out = new Set<string>();
    for (const r of catalog.relationships) {
        if (r.isActive !== false && normName(r.toTable) === home) out.add(normName(r.fromTable));
    }
    return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
    for (const x of a) if (b.has(x)) return true;
    return false;
}

// Coarse → fine keyword ranks (lower = broader / higher in a hierarchy).
// "super division" is checked before "division" so it ranks correctly.
const RANK: string[] = [
    "super division",
    "reporting division",
    "division",
    "business unit",
    "department",
    "segment",
    "family",
    "group",
    "category",
    "subcategory",
    "class",
    "brand",
    "product summary",
    "product detail",
    "summary",
    "detail",
];

function keywordRank(name: string): number {
    const n = name.toLowerCase();
    for (let i = 0; i < RANK.length; i++) if (n.includes(RANK[i])) return i;
    return RANK.length;
}

function numericSuffix(name: string): number {
    const match = name.match(/(\d+)\s*$/);
    return match ? Number.parseInt(match[1], 10) : 0;
}

function toItem(c: ColumnMeta, current: ColumnMeta): HierarchyItem {
    return {
        key: c.key,
        label: c.displayName,
        emoji: c.emoji,
        table: c.table,
        column: c.name,
        current: c.key === current.key,
    };
}

/** Cardinality-ordered levels (broad → detailed) when live counts exist, else null. */
function orderByCardinality(cols: ColumnMeta[]): ColumnMeta[] | null {
    const allLive = cols.every((c) => (c.liveValues?.length ?? 0) > 0);
    const distinct = new Set(cols.map((c) => c.liveValues?.length ?? 0));
    if (!allLive || distinct.size < 2) return null;
    return [...cols].sort(
        (a, b) => (a.liveValues!.length - b.liveValues!.length) || a.displayName.localeCompare(b.displayName),
    );
}

/** Heuristic order for a flat grouping when we have no live cardinality signal. */
function orderByHeuristic(cols: ColumnMeta[]): ColumnMeta[] {
    return [...cols].sort(
        (a, b) =>
            keywordRank(a.name) - keywordRank(b.name)
            || numericSuffix(a.name) - numericSuffix(b.name)
            || a.displayName.localeCompare(b.displayName),
    );
}

/** Keep the current field in view even if it fell past the display cap. */
function ensureCurrent(cols: ColumnMeta[], current: ColumnMeta): ColumnMeta[] {
    if (cols.some((c) => c.key === current.key)) return cols;
    return [...cols.slice(0, -1), current];
}

function folderTitle(folder: string): string {
    const leaf = folder.split(/[\\/]/).pop() ?? folder;
    return /hierarch/i.test(leaf) ? leaf : `${leaf} hierarchy`;
}

/**
 * Build the hierarchy view for a dimension column, or null when there's nothing
 * meaningful beyond the field itself.
 */
export function buildHierarchy(catalog: CatalogModel, column: ColumnMeta): HierarchyView | null {
    const usableDim = (c: ColumnMeta) => !c.isHidden && c.isDimensionLike;

    // 1) Display-folder hierarchy: true, ordered levels grouped by the author.
    const folder = column.displayFolder;
    if (folder) {
        const siblings = catalog.columns.filter(
            (c) =>
                usableDim(c)
                && normName(c.table) === normName(column.table)
                && (c.displayFolder ?? "") === folder,
        );
        if (siblings.length >= 2) {
            const leaf = folder.split(/[\\/]/).pop() ?? folder;
            const byCardinality = orderByCardinality(siblings);
            if (byCardinality) {
                // Real distinct-value counts justify an ordered broad → detailed ladder.
                const ordered = ensureCurrent(byCardinality.slice(0, MAX_ITEMS), column);
                return {
                    title: folderTitle(folder),
                    note: "Ordered broad → detailed by number of distinct values.",
                    layout: "levels",
                    items: ordered.map((c) => toItem(c, column)),
                };
            }
            // No cardinality signal — present as a flat, honest grouping (no implied nesting).
            const grouped = ensureCurrent(orderByHeuristic(siblings).slice(0, MAX_ITEMS), column);
            return {
                title: `Fields grouped under ${leaf}`,
                note: `The model groups these fields together under ${folder.replace(/[\\/]/g, " › ")} — pick one to slice by.`,
                layout: "chips",
                items: grouped.map((c) => toItem(c, column)),
            };
        }
    }

    // 2) Business-area levels: the other sliceable fields in the same topic, so a
    // thin dimension (e.g. Product Summary) still shows the full product ladder.
    const topic = column.topic;
    if (topic) {
        const peers = catalog.columns.filter(
            (c) => usableDim(c) && c.topic != null && normName(c.topic) === normName(topic),
        );
        if (peers.length >= 2) {
            const ranked = [...peers].sort(
                (a, b) =>
                    (b.usedByMeasures?.length ?? 0) - (a.usedByMeasures?.length ?? 0)
                    || a.displayName.localeCompare(b.displayName),
            );
            const top = ranked.slice(0, MAX_ITEMS);
            if (!top.some((c) => c.key === column.key)) {
                top.pop();
                top.unshift(column);
            }
            return {
                title: `${topic} levels`,
                note: "Other fields in this business area you can drill through.",
                layout: "chips",
                items: top.map((c) => toItem(c, column)),
            };
        }
    }

    // 3) Conformed sibling dimensions: a thin table (e.g. Product Detail holds
    // only "Product Summary") shares a subject and a fact with a richer table
    // (Product). Surface that richer table's levels so the full ladder shows.
    const tokens = subjectTokens(column.table);
    if (tokens.size) {
        const myFacts = factsInto(catalog, column.table);
        const okTables = new Set<string>();
        const rejTables = new Set<string>();
        const peers: ColumnMeta[] = [];
        for (const c of catalog.columns) {
            if (!usableDim(c)) continue;
            const t = normName(c.table);
            if (t === normName(column.table) || rejTables.has(t)) continue;
            if (!okTables.has(t)) {
                if (!intersects(subjectTokens(c.table), tokens) || !intersects(factsInto(catalog, c.table), myFacts)) {
                    rejTables.add(t);
                    continue;
                }
                okTables.add(t);
            }
            peers.push(c);
        }
        if (peers.length >= 2) {
            const ranked = peers.sort(
                (a, b) =>
                    (b.usedByMeasures?.length ?? 0) - (a.usedByMeasures?.length ?? 0)
                    || a.displayName.localeCompare(b.displayName),
            );
            const top = ranked.slice(0, MAX_ITEMS - 1);
            const subject = [...tokens][0];
            const items = [toItem(column, column), ...top.map((c) => toItem(c, column))];
            return {
                title: `${subject.charAt(0).toUpperCase() + subject.slice(1)} levels`,
                note: `Related levels across the ${subject} dimension you can drill through.`,
                layout: "chips",
                items,
            };
        }
    }

    return null;
}
