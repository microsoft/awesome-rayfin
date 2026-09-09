//-----------------------------------------------------------------------
// Semantic Directory — the "at a glance" answer model.
//
// Turns an entity into a short, ordered set of decision-oriented answer cards
// so the first thing a user sees on open is the read that matters: what a
// measure does, how far it reaches downstream, whether it's safe to touch,
// what a table's role is, how a field is used. Every card is 100% derived from
// model metadata + the DAX dependency graph — no AI, and each carries a `help`
// string naming the exact rule it came from. Honesty guard: reach/built-from
// cards only appear when the dependency graph is actually present (bundled or
// live-enriched), never fabricated on a thin live model.
//-----------------------------------------------------------------------

import type { ColumnMeta, MeasureMeta, TableMeta, TrustSignal } from "./types";
import { explainDax } from "./dax-explain";
import { impactOf, visibleImpact } from "./impact";
import { memoByCatalogKey } from "../memo";
import type { CatalogModel } from "./types";

export type AnswerTone =
    | "neutral"
    | "reach"
    | "trust-high"
    | "trust-watch"
    | "trust-low"
    | "risk";

/** One derived, glanceable answer about an entity. */
export interface AnswerCard {
    /** Stable id for React keys and testing. */
    id: string;
    /** Short structural label (e.g. "Reach", "Role", "Check"). */
    label: string;
    /** The derived, human-readable answer. */
    value: string;
    /** Visual emphasis — decision signals (reach/trust/risk) stand out. */
    tone: AnswerTone;
    /** Tooltip naming the deterministic rule behind the value. */
    help: string;
}

/** "1 measure" / "3 measures" — safe pluralization. */
function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** "1 hop" / "3 hops". */
function hops(n: number): string {
    return `${n} ${n === 1 ? "hop" : "hops"}`;
}

const TRUST_TONE: Record<Exclude<TrustSignal["level"], "unknown">, AnswerTone> = {
    high: "trust-high",
    watch: "trust-watch",
    low: "trust-low",
};

const TRUST_TEXT: Record<Exclude<TrustSignal["level"], "unknown">, string> = {
    high: "Trusted",
    watch: "Watch",
    low: "Verify at source",
};

/** A trust card, or nothing when there's no real signal to show. */
function trustCard(trust: TrustSignal | undefined): AnswerCard | undefined {
    if (!trust || trust.level === "unknown") return undefined;
    const qa = trust.qaPassRate != null ? ` · ${Math.round(trust.qaPassRate * 100)}% match` : "";
    return {
        id: "trust",
        label: "Trust",
        value: `${TRUST_TEXT[trust.level]}${qa}`,
        tone: TRUST_TONE[trust.level],
        help: trust.note ?? "Rolled up from source-load freshness and reconciliation pass rate.",
    };
}

function measureAnswer(catalog: CatalogModel, m: MeasureMeta): AnswerCard[] {
    const cards: AnswerCard[] = [];
    const recipe = explainDax(catalog, m);

    if (recipe.hasDax && recipe.traits.length) {
        cards.push({
            id: "behavior",
            label: "Formula pattern",
            value: recipe.traits.slice(0, 2).join(" · "),
            tone: "neutral",
            help: "Read from the DAX formula — every phrase maps to a token in the expression.",
        });
    }

    // Reach only when the dependency graph exists (never fabricate "safe to change").
    if (m.usedByMeasures !== undefined) {
        const vis = visibleImpact(impactOf(catalog, m));
        cards.push(
            vis.total > 0
                ? {
                      id: "reach",
                      label: "Reach",
                      value: `Feeds ${plural(vis.total, "measure")} · ${hops(vis.maxDepth)} deep`,
                      tone: "reach",
                      help: "Downstream measures that read this, walked over the DAX dependency graph.",
                  }
                : {
                      id: "reach",
                      label: "Reach",
                      value: "Nothing downstream depends on it",
                      tone: "neutral",
                      help: "No downstream measure reads this over the DAX dependency graph.",
                  },
        );
    }

    const childN = recipe.childMeasures.length;
    const tableN = recipe.columnsByTable.length;
    if (childN || tableN) {
        const parts: string[] = [];
        if (childN) parts.push(plural(childN, "measure"));
        if (tableN) parts.push(plural(tableN, "table"));
        cards.push({
            id: "built",
            label: "Inputs",
            value: parts.join(" · "),
            tone: "neutral",
            help: "Inputs referenced directly in the formula — child measures and the tables their columns live in.",
        });
    }

    const trust = trustCard(m.trust);
    if (trust) cards.push(trust);

    const risks: string[] = [];
    if (!m.description) risks.push("No description");
    if (!recipe.hasDax) risks.push("No formula available");
    if (m.stewardPending) risks.push("Steward review pending");
    if (risks.length) {
        cards.push({
            id: "check",
            label: "Check",
            value: risks.join(" · "),
            tone: "risk",
            help: "Rule-based governance checks on this measure — each is a fact, not a judgement.",
        });
    }

    return cards;
}

function columnAnswer(catalog: CatalogModel, c: ColumnMeta): AnswerCard[] {
    const cards: AnswerCard[] = [];

    cards.push({
        id: "role",
        label: "Role",
        value: c.isDimensionLike ? "Slice / grouping field" : "Detail field",
        tone: "neutral",
        help: "Classified from data category and summarize-by — dimension-like fields make good slicers.",
    });

    if (c.usedByMeasures !== undefined) {
        const direct = c.usedByMeasures.length;
        const vis = visibleImpact(impactOf(catalog, c));
        let value = direct > 0 ? `Read by ${plural(direct, "measure")}` : "No measure reads it yet";
        if (vis.total > direct) value += ` · downstream to ${plural(vis.total, "measure")}`;
        cards.push({
            id: "reach",
            label: "Reach",
            value,
            tone: direct > 0 ? "reach" : "neutral",
            help: "Measures whose DAX reads this column, plus the transitive downstream they feed.",
        });
    }

    if (c.liveValues && c.liveValues.length) {
        cards.push({
            id: "values",
            label: "Values",
            value: plural(c.liveValues.length, "distinct value"),
            tone: "neutral",
            help: "Distinct members pulled live from the model.",
        });
    }

    return cards;
}

const ONTOLOGY_ROLE: Record<string, string> = {
    fact: "Fact table",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge table",
    security: "Security / RLS",
    operational: "Operational",
};

function tableAnswer(catalog: CatalogModel, t: TableMeta): AnswerCard[] {
    const cards: AnswerCard[] = [];

    if (t.ontology) {
        cards.push({
            id: "role",
            label: "Role",
            value: ONTOLOGY_ROLE[t.ontology] ?? t.ontology,
            tone: "neutral",
            help: "Structural class inferred from keys, relationships and hosted measures.",
        });
    }

    cards.push({
        id: "shape",
        label: "Shape",
        value: `${plural(t.columnCount, "column")} · ${plural(t.measureCount, "measure")}`,
        tone: "neutral",
        help: "Visible columns and measures hosted on this table.",
    });

    if (t.hubRank && t.hubRank > 0) {
        cards.push({
            id: "hub",
            label: "Hub",
            value: `${t.hubRank === 1 ? "1 fact joins" : `${t.hubRank} facts join`} here`,
            tone: "reach",
            help: "Fact tables that join to this dimension over the model's relationships.",
        });
    }

    if (t.sourceSystem) {
        cards.push({
            id: "source",
            label: "Source",
            value: t.sourceSystem,
            tone: "neutral",
            help: "System of record this table is loaded from.",
        });
    }

    const trust = trustCard(t.trust);
    if (trust) cards.push(trust);

    return cards;
}

/** Ordered, derived answer cards for any entity (memoized per catalog+entity). */
export const buildAnswer = memoByCatalogKey(
    (catalog: CatalogModel, entity: MeasureMeta | ColumnMeta | TableMeta): AnswerCard[] => {
        if (entity.kind === "measure") return measureAnswer(catalog, entity);
        if (entity.kind === "column") return columnAnswer(catalog, entity);
        return tableAnswer(catalog, entity);
    },
    (entity) => `${entity.kind}:${entity.key}`,
);
