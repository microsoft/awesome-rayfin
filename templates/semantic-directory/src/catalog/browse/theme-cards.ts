//-----------------------------------------------------------------------
// Semantic Directory — live population for the curated dimension themes.
//
// Curated labels/order come from the theme registry; the numbers and examples
// here come straight from the model, so cards stay honest and current:
//   - themeFields(): the sliceable dimension columns in a theme (by topic).
//   - themeMeasures(): visible measures that can be broken down by the theme.
//   - buildThemeCard(): the populated card (field count, sample fields, example
//     member values when live, metric count).
// All deterministic — no AI, no guessed groupings.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta, MeasureMeta } from "../model/types";
import { normName } from "../model/types";
import { sliceDimensions, reachableTables } from "../lineage/relationships";
import type { ThemeDef } from "./theme-registry";

export interface ThemeCard {
    def: ThemeDef;
    fieldCount: number;
    /** Top field display names (curated by usage), for a quick preview. */
    sampleFields: string[];
    /** A few live member values across the theme's fields (deployed only). */
    exampleValues: string[];
    /** Visible measures that can be broken down by this theme. */
    metricCount: number;
}

/** Rank fields so the most-used dimensions preview first. */
function byUsage(a: ColumnMeta, b: ColumnMeta): number {
    const au = a.usedByMeasures?.length ?? 0;
    const bu = b.usedByMeasures?.length ?? 0;
    return bu - au || a.displayName.localeCompare(b.displayName);
}

/** The sliceable dimension columns that belong to an area (via its tables). */
export function themeFields(catalog: CatalogModel, def: ThemeDef): ColumnMeta[] {
    const tables = new Set(def.tables.map(normName));
    return sliceDimensions(catalog)
        .map((s) => s.column)
        .filter((c) => tables.has(normName(c.table)))
        .sort(byUsage);
}

/** Union of tables reachable from any of the theme's dimension tables. */
function themeReach(catalog: CatalogModel, fields: ColumnMeta[]): Set<string> {
    const reach = new Set<string>();
    const dimTables = new Set(fields.map((f) => normName(f.table)));
    for (const t of dimTables) {
        const r = reachableTables(catalog, t);
        if (r) for (const x of r) reach.add(x);
        else reach.add(t);
    }
    return reach;
}

/** Visible measures that can be broken down by (at least one field of) a theme. */
export function themeMeasures(catalog: CatalogModel, def: ThemeDef): MeasureMeta[] {
    const fields = themeFields(catalog, def);
    if (!fields.length) return [];
    const reach = themeReach(catalog, fields);
    const out = catalog.measures.filter((m) => {
        if (m.isHidden) return false;
        const uses = m.usesTables?.length ? m.usesTables : [m.table];
        return uses.some((t) => reach.has(normName(t)));
    });
    // Trust-first: high-trust, then described, then alphabetical — stable order.
    return out.sort((a, b) => {
        const av = a.trust?.level === "high" ? 1 : 0;
        const bv = b.trust?.level === "high" ? 1 : 0;
        if (av !== bv) return bv - av;
        const ad = a.description ? 1 : 0;
        const bd = b.description ? 1 : 0;
        if (ad !== bd) return bd - ad;
        return a.displayName.localeCompare(b.displayName);
    });
}

/** The most representative field to drop into when a theme is opened. */
export function themeTopField(catalog: CatalogModel, def: ThemeDef): ColumnMeta | undefined {
    return themeFields(catalog, def)[0];
}

/** Reject noise members (N/A, blanks, dashes, sentinels) from card previews. */
const JUNK_VALUE = /^(n\/?a|na|none|null|nil|blank|unknown|undefined|other|tbd|n\/d|-{1,}|—|–|\.|#|0)$/i;
function isCleanValue(v: string): boolean {
    const t = v.trim();
    if (t.length < 2) return false;
    if (!/[a-z0-9]/i.test(t)) return false; // must carry a real alphanumeric
    return !JUNK_VALUE.test(t);
}

/** Build a single populated card. Returns null when the theme has no fields. */
export function buildThemeCard(catalog: CatalogModel, def: ThemeDef): ThemeCard | null {
    const fields = themeFields(catalog, def);
    if (!fields.length) return null;

    const exampleValues: string[] = [];
    const seen = new Set<string>();
    for (const f of fields) {
        for (const raw of f.liveValues ?? []) {
            const v = raw.trim();
            if (!isCleanValue(v)) continue;
            const key = v.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            exampleValues.push(v);
            if (exampleValues.length >= 4) break;
        }
        if (exampleValues.length >= 4) break;
    }

    return {
        def,
        fieldCount: fields.length,
        sampleFields: fields.slice(0, 3).map((f) => f.displayName),
        exampleValues,
        metricCount: themeMeasures(catalog, def).length,
    };
}

/** Build populated cards for a set of themes, dropping any that are empty. */
export function buildThemeCards(catalog: CatalogModel, defs: ThemeDef[]): ThemeCard[] {
    return defs
        .map((d) => buildThemeCard(catalog, d))
        .filter((c): c is ThemeCard => c != null);
}
