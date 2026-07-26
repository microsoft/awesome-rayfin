//-----------------------------------------------------------------------
// Semantic Directory — model health scorecard (BPA-lite).
//
// A deterministic, model-agnostic quality read on ANY connected semantic model.
// Every rule is a real, low-false-positive best-practice check derived from the
// live metadata already in the catalog — descriptions, format strings, join
// participation, name collisions. No AI, no report-usage telemetry (which the
// model doesn't expose), so nothing here is a guess.
//
// Score = 100 − Σ(weight × offender-ratio), clamped to 0..100. Informational
// rules (weight 0) surface findings without moving the score.
//-----------------------------------------------------------------------

import type { CatalogModel } from "./types";
import { normName } from "./types";
import { memoByCatalog } from "../memo";

export type HealthSeverity = "high" | "medium" | "info";
export type HealthGrade = "A" | "B" | "C" | "D" | "F";

export interface HealthRule {
    id: string;
    label: string;
    severity: HealthSeverity;
    /** Scoring weight; 0 for informational rules. */
    weight: number;
    /** Human descriptors of the offenders (capped for payload sanity). */
    offenders: string[];
    /** True offender count (may exceed `offenders.length` when capped). */
    offenderCount: number;
    /** Denominator the ratio is measured against. */
    population: number;
    /** offenderCount / population, 0 when population is 0. */
    ratio: number;
    /** weight × ratio — how many points this rule removed. */
    penalty: number;
    /** One-line remediation guidance, shown when the rule has offenders. */
    hint: string;
    /** Affirmative one-liner shown when the check passes (offenderCount === 0). */
    pass: string;
}

export interface HealthReport {
    /** 0..100, rounded. */
    score: number;
    grade: HealthGrade;
    summary: string;
    /** Scored rules first (worst penalty first), informational rules last. */
    rules: HealthRule[];
    entityCounts: {
        measures: number;
        columns: number;
        tables: number;
        relationships: number;
    };
}

const OFFENDER_CAP = 100;

function grade(score: number): HealthGrade {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
}

function makeRule(
    base: Omit<
        HealthRule,
        "offenderCount" | "ratio" | "penalty" | "offenders" | "population"
    > & {
        offenders: string[];
    },
    population: number,
): HealthRule {
    const offenderCount = base.offenders.length;
    const ratio = population > 0 ? offenderCount / population : 0;
    return {
        ...base,
        population,
        offenders: base.offenders.slice(0, OFFENDER_CAP).sort((a, b) => a.localeCompare(b)),
        offenderCount,
        ratio,
        penalty: base.weight * ratio,
    };
}

/**
 * Score a semantic model against a small set of high-signal best-practice rules.
 * Pure + memoized per catalog.
 */
export const analyzeHealth = memoByCatalog((catalog: CatalogModel): HealthReport => {
    const visibleMeasures = catalog.measures.filter((m) => !m.isHidden);
    const visibleTables = catalog.tables.filter((t) => !t.isHidden);

    // --- Rule: measures without a description -----------------------------
    const undescribed = visibleMeasures
        .filter((m) => !m.description?.trim())
        .map((m) => m.displayName);

    // --- Rule: measures without a format string ---------------------------
    const unformatted = visibleMeasures
        .filter((m) => !m.formatString?.trim())
        .map((m) => m.displayName);

    // --- Rule: island tables ---------------------------------------------
    // A visible table that carries at least one visible dimension-like column
    // (so it's meant to be joined) yet participates in NO relationship at all.
    // Inactive relationships count as "connected" — a role-playing date
    // dimension or what-if parameter table joined only via USERELATIONSHIP is
    // correctly modelled, not an island. Pure measure-host tables (no dimension
    // columns) are excluded because they carry no dimension-like column.
    const relatedTables = new Set<string>();
    for (const r of catalog.relationships) {
        relatedTables.add(normName(r.fromTable));
        relatedTables.add(normName(r.toTable));
    }
    const dimColsByTable = new Map<string, number>();
    for (const c of catalog.columns) {
        if (c.isHidden || !c.isDimensionLike) continue;
        const k = normName(c.table);
        dimColsByTable.set(k, (dimColsByTable.get(k) ?? 0) + 1);
    }
    const islands = visibleTables
        .filter(
            (t) =>
                (dimColsByTable.get(normName(t.name)) ?? 0) > 0 &&
                !relatedTables.has(normName(t.name)),
        )
        .map((t) => t.displayName);

    // --- Rule: measure/column name collisions -----------------------------
    // A measure and a column sharing a normalized name are ambiguous to
    // reference and confusing to search. Report the colliding measures.
    const columnNames = new Set(catalog.columns.map((c) => normName(c.name)));
    const collisions = visibleMeasures
        .filter((m) => columnNames.has(normName(m.name)))
        .map((m) => m.displayName);

    // --- Informational: inactive relationships ----------------------------
    const inactiveRels = catalog.relationships
        .filter((r) => !r.isActive)
        .map((r) => `${r.fromTable} → ${r.toTable}`);

    const rules: HealthRule[] = [
        makeRule(
            {
                id: "measure-no-description",
                label: "Measures missing a description",
                severity: "high",
                weight: 30,
                offenders: undescribed,
                hint: "Add a one-line description so consumers know what each measure means.",
                pass: "Every visible measure has a description.",
            },
            visibleMeasures.length,
        ),
        makeRule(
            {
                id: "island-table",
                label: "Tables with no relationship",
                severity: "high",
                weight: 25,
                offenders: islands,
                hint: "Join these tables into the model, hide them, or remove them.",
                pass: "Every visible table joins the model.",
            },
            visibleTables.length,
        ),
        makeRule(
            {
                id: "measure-column-collision",
                label: "Measure names that collide with a column",
                severity: "medium",
                weight: 15,
                offenders: collisions,
                hint: "Rename the measure or column so references are unambiguous.",
                pass: "No measure name collides with a column.",
            },
            visibleMeasures.length,
        ),
        makeRule(
            {
                id: "measure-no-format",
                label: "Measures missing a format string",
                severity: "medium",
                weight: 10,
                offenders: unformatted,
                hint: "Set an explicit format string so numbers render consistently.",
                pass: "Every visible measure has a format string.",
            },
            visibleMeasures.length,
        ),
        makeRule(
            {
                id: "inactive-relationship",
                label: "Inactive relationships",
                severity: "info",
                weight: 0,
                offenders: inactiveRels,
                hint: "These only apply via USERELATIONSHIP — confirm each is intentional.",
                pass: "No inactive relationships to review.",
            },
            Math.max(catalog.relationships.length, 1),
        ),
    ];

    const totalPenalty = rules.reduce((sum, r) => sum + r.penalty, 0);
    const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

    rules.sort((a, b) => {
        // Informational rules sink to the bottom; otherwise worst penalty first.
        if (a.weight === 0 && b.weight !== 0) return 1;
        if (b.weight === 0 && a.weight !== 0) return -1;
        return b.penalty - a.penalty;
    });

    const flagged = rules.filter((r) => r.weight > 0 && r.offenderCount > 0).length;
    const summary =
        flagged === 0
            ? "No best-practice issues detected in the model metadata."
            : `${flagged} best-practice ${flagged === 1 ? "rule" : "rules"} flagged findings across the model.`;

    return {
        score,
        grade: grade(score),
        summary,
        rules,
        entityCounts: {
            measures: catalog.measures.length,
            columns: catalog.columns.length,
            tables: catalog.tables.length,
            relationships: catalog.relationships.length,
        },
    };
});
