//-----------------------------------------------------------------------
// Semantic Directory — area insight helpers (kills the "wall + dead-end").
//
// Two problems this fixes deterministically:
//   • An area (e.g. "Sales") is really several concepts, each with a spread of
//     variant measures (YoY / vs Budget / QTD / …). groupFamilies()
//     collapses that wall into one lead per family + its variants.
//   • Landing on an area must never be a blank pane. flagshipMeasures() picks
//     the few measures that matter (verified / foundational) and areaSlices()
//     the best ways to break the area down — an instant, useful overview.
// No AI: every choice is a scored, explainable heuristic over the brain.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta, MeasureMeta } from "../model/types";
import { recommendSlices } from "../lineage/slice-recommender";

export interface FamilyGroup {
    /** Stable group key (familyId when clustered, else the lead's key). */
    key: string;
    /** The representative "base" measure a user should read first. */
    lead: MeasureMeta;
    /** The remaining variants (YoY / vs Budget / QTD / …), sorted. */
    variants: MeasureMeta[];
}

function wordCount(s: string): number {
    return s.trim().split(/\s+/).length;
}

/** Pick the most "base" member of a cluster: fewest words, then shortest. */
function pickLead(members: MeasureMeta[]): MeasureMeta {
    return [...members].sort(
        (a, b) =>
            wordCount(a.displayName) - wordCount(b.displayName) ||
            a.displayName.length - b.displayName.length ||
            a.displayName.localeCompare(b.displayName),
    )[0];
}

/** How "flagship" is a measure — foundational / documented / widely used. */
function leadScore(m: MeasureMeta): number {
    let s = 0;
    if (m.trust?.level === "high") s += 20;
    if (m.description) s += 6;
    s += Math.min(m.usedByMeasures?.length ?? 0, 20);
    return s;
}

/** Collapse a measure list into families (lead + variants). Best first. */
export function groupFamilies(measures: MeasureMeta[]): FamilyGroup[] {
    const clusters = new Map<string, MeasureMeta[]>();
    for (const m of measures) {
        const id = m.familyId ?? `solo:${m.key}`;
        if (!clusters.has(id)) clusters.set(id, []);
        clusters.get(id)!.push(m);
    }

    const groups: FamilyGroup[] = [];
    for (const [id, members] of clusters) {
        const lead = pickLead(members);
        const variants = members
            .filter((m) => m.key !== lead.key)
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
        groups.push({ key: id, lead, variants });
    }
    return groups.sort(
        (a, b) =>
            leadScore(b.lead) + b.variants.length - (leadScore(a.lead) + a.variants.length) ||
            a.lead.displayName.localeCompare(b.lead.displayName),
    );
}

/** The few measures that matter in an area — one per family, best first. */
export function flagshipMeasures(
    catalog: CatalogModel,
    topic: string,
    limit = 5,
): MeasureMeta[] {
    const inTopic = catalog.measures.filter((m) => !m.isHidden && (m.topic ?? "") === topic);
    return groupFamilies(inTopic)
        .map((g) => g.lead)
        .sort((a, b) => leadScore(b) - leadScore(a) || a.displayName.localeCompare(b.displayName))
        .slice(0, limit);
}

/** The best ways to break an area down — aggregated across its flagships. */
export function areaSlices(
    catalog: CatalogModel,
    topic: string,
    limit = 6,
): ColumnMeta[] {
    const flagships = flagshipMeasures(catalog, topic, 5);
    const tally = new Map<string, { col: ColumnMeta; n: number; score: number }>();
    for (const m of flagships) {
        for (const s of recommendSlices(catalog, m).top) {
            const prev = tally.get(s.column.key);
            if (prev) {
                prev.n += 1;
                prev.score = Math.max(prev.score, s.score);
            } else {
                tally.set(s.column.key, { col: s.column, n: 1, score: s.score });
            }
        }
    }
    return [...tally.values()]
        .sort(
            (a, b) =>
                b.n - a.n ||
                b.score - a.score ||
                a.col.displayName.localeCompare(b.col.displayName),
        )
        .slice(0, limit)
        .map((t) => t.col);
}
