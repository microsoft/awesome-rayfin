//-----------------------------------------------------------------------
// Semantic Directory — the "at a glance" answer strip.
//
// Renders the derived answer cards (model/answer.ts) as a compact, scannable
// band directly under the entity header. Decision signals — reach, trust, risk
// — carry a small icon and an accent so the eye lands on them first; plain
// facts stay quiet. Every cell exposes its rule via `title`/aria-label. Motion
// respects the global reduced-motion setting.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import { Waves, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CatalogModel, ColumnMeta, MeasureMeta, TableMeta } from "@/catalog/model/types";
import { buildAnswer, type AnswerCard, type AnswerTone } from "@/catalog/model/answer";
import { sectionReveal } from "@/lib/motion";

const TONE_CLASS: Record<AnswerTone, string> = {
    neutral: "border-border bg-secondary text-foreground",
    reach: "border-primary/30 bg-primary/10 text-foreground",
    "trust-high":
        "border-[color:var(--trust-high-border)] bg-[color:var(--trust-high-bg)] text-[color:var(--trust-high-fg)]",
    "trust-watch":
        "border-[color:var(--trust-watch-border)] bg-[color:var(--trust-watch-bg)] text-[color:var(--trust-watch-fg)]",
    "trust-low":
        "border-[color:var(--trust-low-border)] bg-[color:var(--trust-low-bg)] text-[color:var(--trust-low-fg)]",
    risk: "border-destructive/40 bg-destructive/10 text-foreground",
};

const TONE_ICON: Partial<Record<AnswerTone, LucideIcon>> = {
    reach: Waves,
    "trust-high": ShieldCheck,
    "trust-watch": ShieldAlert,
    "trust-low": ShieldAlert,
    risk: AlertTriangle,
};

function AnswerCell({ card }: { card: AnswerCard }) {
    const Icon = TONE_ICON[card.tone];
    return (
        <span
            title={card.help}
            aria-label={`${card.label}: ${card.value}`}
            className={`inline-flex items-center gap-s rounded-xl border px-m py-s ${TONE_CLASS[card.tone]}`}
        >
            {Icon ? <Icon className="icon-size-200 shrink-0 opacity-80" strokeWidth={2} aria-hidden /> : null}
            <span className="flex flex-col leading-tight">
                <span className="text-100 font-semibold uppercase tracking-wide opacity-70">{card.label}</span>
                <span className="text-200 font-semibold">{card.value}</span>
            </span>
        </span>
    );
}

export function AnswerStrip({
    entity,
    catalog,
}: {
    entity: MeasureMeta | ColumnMeta | TableMeta;
    catalog: CatalogModel;
}) {
    const cards = useMemo(() => buildAnswer(catalog, entity), [catalog, entity]);
    if (!cards.length) return null;
    return (
        <m.div
            variants={sectionReveal}
            initial="hidden"
            animate="show"
            role="group"
            aria-label="At a glance"
            className="flex flex-wrap gap-s"
        >
            {cards.map((c) => (
                <AnswerCell key={c.id} card={c} />
            ))}
        </m.div>
    );
}
