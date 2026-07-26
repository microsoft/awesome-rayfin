//-----------------------------------------------------------------------
// Semantic Directory — model-derived "browse by area" registry.
//
// The landing's "browse by area" cards are generated LIVE from whatever model
// is connected — no curation required. Each dimension table a user can slice by
// becomes an area; areas are ranked by star-schema importance (hub rank, then
// how many slice fields they carry) so the most useful areas surface first.
// Labels, counts, example fields, and metrics all come straight from the model,
// so a brand-new model gets a sensible front door with zero configuration.
//
// The landing orbit renders the top areas (see ORBIT_CAP in model-constellation);
// the rest live behind a "More areas" tray so nothing is hidden, just not
// first-impression noise.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta, TableMeta } from "../model/types";
import { normName } from "../model/types";
import { sliceDimensions } from "../lineage/relationships";

export interface ThemeDef {
    /** Stable route id — the normalized dimension-table name. */
    id: string;
    /** Human label — the dimension table's display name. */
    label: string;
    emoji: string;
    blurb: string;
    /** Dimension tables whose sliceable columns roll into this area. */
    tables: string[];
}

// Keyword → emoji. First match wins; falls back to a rotating neutral palette
// so cards stay visually distinct even for unrecognized domains. Deterministic.
const EMOJI_RULES: [RegExp, string][] = [
    [/\b(product|item|sku|title|part|material|catalog)\b/i, "📦"],
    [/\b(customer|client|consumer|member|buyer|contact)\b/i, "👥"],
    [/\b(store|shop|outlet|branch|site|location|warehouse)\b/i, "🏬"],
    [/\b(geo|geograph|region|country|territory|market|city|state|province)\b/i, "🌍"],
    [/\b(date|calendar|time|period|fiscal|month|year|week|day)\b/i, "📅"],
    [/\b(employee|staff|person|people|seller|salesperson|agent)\b/i, "🧑‍💼"],
    [/\b(channel|route|medium)\b/i, "🔀"],
    [/\b(promotion|promo|campaign|discount|deal|offer)\b/i, "🏷️"],
    [/\b(currency|fx|exchange)\b/i, "💱"],
    [/\b(account|gl|ledger|finance|financial|pnl|p&l)\b/i, "💹"],
    [/\b(vendor|supplier|manufacturer)\b/i, "🚚"],
    [/\b(org|organization|department|division|team|function|segment)\b/i, "🏢"],
    [/\b(subscription|plan|tier|membership)\b/i, "🎟️"],
    [/\b(order|invoice|transaction|sale)\b/i, "🧾"],
];
const FALLBACK_EMOJI = ["🗂️", "🧩", "🔷", "🔶", "⭐", "🧭", "🔹", "📊"];

function pickEmoji(label: string, index: number): string {
    for (const [re, emoji] of EMOJI_RULES) if (re.test(label)) return emoji;
    return FALLBACK_EMOJI[index % FALLBACK_EMOJI.length];
}

/** Rank slice fields so the most-used dimensions preview first. */
function byUsage(a: ColumnMeta, b: ColumnMeta): number {
    const au = a.usedByMeasures?.length ?? 0;
    const bu = b.usedByMeasures?.length ?? 0;
    return bu - au || a.displayName.localeCompare(b.displayName);
}

/**
 * Derive browse areas from the connected model. One area per dimension table
 * that carries at least one sliceable field, ranked so star-schema hubs and
 * field-rich dimensions come first. Pure + deterministic — no AI, no curation.
 */
export function deriveThemes(catalog: CatalogModel): ThemeDef[] {
    const tableByNorm = new Map<string, TableMeta>();
    for (const t of catalog.tables) tableByNorm.set(normName(t.name), t);

    // Group sliceable dimension columns by their home table.
    const groups = new Map<string, { table: string; columns: ColumnMeta[] }>();
    for (const { table, column } of sliceDimensions(catalog)) {
        const key = normName(table);
        const g = groups.get(key) ?? { table, columns: [] };
        g.columns.push(column);
        groups.set(key, g);
    }

    // Fallback for flat / single-table / no-relationship models: with no
    // relationships there are no slice dimensions, which would leave the landing
    // with zero areas. Group every visible dimension-like column by its table
    // (excluding the measure host) so any model still gets a usable front door.
    if (groups.size === 0) {
        for (const c of catalog.columns) {
            if (c.isHidden || !c.isDimensionLike) continue;
            if (tableByNorm.get(normName(c.table))?.ontology === "measure-host") {
                continue;
            }
            const key = normName(c.table);
            const g = groups.get(key) ?? { table: c.table, columns: [] };
            g.columns.push(c);
            groups.set(key, g);
        }
    }

    const ranked = [...groups.entries()]
        .map(([key, g]) => {
            const meta = tableByNorm.get(key);
            // Areas are things you slice BY, so keep dimension-ish tables and
            // drop the measure host (default in when unclassified).
            const isMeasureHost = meta?.ontology === "measure-host";
            const hubRank = meta?.hubRank ?? 0;
            return { key, group: g, meta, hubRank, isMeasureHost };
        })
        .filter((r) => !r.isMeasureHost && r.group.columns.length > 0)
        .sort(
            (a, b) =>
                b.hubRank - a.hubRank
                || b.group.columns.length - a.group.columns.length
                || (a.meta?.displayName ?? a.group.table).localeCompare(
                    b.meta?.displayName ?? b.group.table,
                ),
        );

    return ranked.map((r, index) => {
        const label = r.meta?.displayName ?? r.group.table;
        const topFields = [...r.group.columns]
            .sort(byUsage)
            .slice(0, 3)
            .map((c) => c.displayName);
        const blurb = topFields.length
            ? `${topFields.join(", ")}${r.group.columns.length > topFields.length ? "…" : ""}`
            : `Slice by ${label}.`;
        return {
            id: r.key,
            label,
            emoji: pickEmoji(label, index),
            blurb,
            tables: [r.group.table],
        };
    });
}

/** Look up a derived area by its route id. */
export function findTheme(all: ThemeDef[], id: string): ThemeDef | undefined {
    return all.find((t) => t.id === id);
}
