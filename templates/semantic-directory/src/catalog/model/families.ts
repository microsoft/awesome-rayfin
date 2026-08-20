//-----------------------------------------------------------------------
// Semantic Directory — measure family clustering.
//
// A model's measures are often really a few dozen business concepts, each with
// a spread of variants: Actuals / Target / Budget / Forecast, time-intelligence
// (QTD/YTD), currency, and variance. This module clusters them so a user
// who lands on ONE measure immediately sees its whole family.
//
// Deterministic: the family "stem" is the measure name with trailing variant
// tokens peeled off. No AI, fully explainable.
//-----------------------------------------------------------------------

import type { MeasureFamily, MeasureMeta } from "./types";
import { normName } from "./types";

// Trailing variant tokens, peeled from the end of a measure name (repeatedly,
// case-insensitive). Order matters only for multi-word tokens — those are
// matched as whole phrases first.
const VARIANT_PHRASES = [
    "prior year",
    "constant dollar",
    "vs target",
    "vs budget",
    "vs forecast",
    "vs prior year",
    "year over year",
];

const VARIANT_TOKENS = new Set([
    "actuals", "actual", "target", "budget", "forecast", "plan", "planning",
    "vtt", "vtf", "vtb", "vtp", "variance", "var", "delta", "growth",
    "qtd", "ytd", "mtd", "wtd", "fytd", "ptd", "cumulative", "cumul", "running",
    "cd", "c$", "usd", "lc",
    "py", "cy", "ly", "yoy", "mom", "qoq", "yty",
    "mix", "pct", "percent", "share", "ratio", "index",
]);

function peelStem(name: string): string {
    let words = name.trim().split(/\s+/);
    let changed = true;
    // Peel multi-word variant phrases first.
    let joined = words.join(" ").toLowerCase();
    for (const phrase of VARIANT_PHRASES) {
        if (joined.endsWith(" " + phrase) || joined === phrase) {
            const cut = words.length - phrase.split(" ").length;
            words = words.slice(0, Math.max(cut, 0));
            joined = words.join(" ").toLowerCase();
        }
    }
    // Then peel single trailing variant tokens repeatedly.
    while (changed && words.length > 1) {
        changed = false;
        const last = words[words.length - 1]
            .toLowerCase()
            .replace(/[()%]/g, "");
        if (VARIANT_TOKENS.has(last)) {
            words = words.slice(0, -1);
            changed = true;
        }
    }
    return words.join(" ").trim();
}

function familyId(stem: string, folder?: string): string {
    return `family:${normName(stem)}|${normName(folder ?? "")}`;
}

/**
 * Cluster measures into families and stamp `familyId` onto each measure
 * (mutates the measures in place). Returns the family list (families of ≥2
 * members only; singletons keep a family id but aren't returned as "families").
 */
export function buildFamilies(measures: MeasureMeta[]): MeasureFamily[] {
    const groups = new Map<string, { stem: string; folder?: string; members: MeasureMeta[] }>();

    for (const m of measures) {
        if (m.isHidden) continue;
        const stem = peelStem(m.name) || m.name;
        const id = familyId(stem, m.displayFolder);
        m.familyId = id;
        if (!groups.has(id)) groups.set(id, { stem, folder: m.displayFolder, members: [] });
        groups.get(id)!.members.push(m);
    }

    const families: MeasureFamily[] = [];
    for (const [id, g] of groups) {
        if (g.members.length < 2) continue; // singletons aren't a "family"
        const sources = new Set<string>();
        for (const m of g.members) for (const s of m.sourceSystems ?? []) sources.add(s);
        families.push({
            id,
            name: g.stem,
            folder: g.folder,
            memberKeys: g.members.map((m) => m.key).sort(),
            members: g.members
                .map((m) => m.displayName || m.name)
                .sort((a, b) => a.localeCompare(b)),
            sourceSystems: [...sources].sort(),
        });
    }

    // Singletons: clear the familyId so the UI doesn't imply a family of one.
    const familyIds = new Set(families.map((f) => f.id));
    for (const m of measures) {
        if (m.familyId && !familyIds.has(m.familyId)) m.familyId = undefined;
    }

    return families.sort(
        (a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name),
    );
}
