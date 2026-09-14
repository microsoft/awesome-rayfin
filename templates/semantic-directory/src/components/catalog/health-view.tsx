//-----------------------------------------------------------------------
// Semantic Directory — Model Health tool (full workspace view).
//
// A BPA-lite scorecard for ANY connected model: an overall grade plus the
// best-practice rules that moved it. Findings are grouped so the state reads
// honestly at a glance:
//   • Issues affecting the score — scored rules with offenders (actionable).
//   • Notes — informational findings that don't move the score (e.g. inactive
//     relationships), which must never be hidden even at a perfect 100.
//   • Passing checks — everything currently clean, stated affirmatively.
// Every finding is derived from live metadata (descriptions, formats, joins,
// name collisions) — deterministic, no AI, no guessing.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { m } from "framer-motion";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { listContainer, sectionReveal, pressSpring } from "@/lib/motion";
import { analyzeHealth, type HealthRule, type HealthSeverity } from "@/catalog/model/health";
import { StatChip } from "./panel-ui";
import { ToolShell } from "./tool-shell";
import { countNoun, pluralize } from "@/lib/copy";

const GRADE_TONE: Record<string, string> = {
    A: "text-primary border-primary/40 bg-primary/10",
    B: "text-primary border-primary/40 bg-primary/10",
    C: "text-foreground border-border bg-secondary",
    D: "text-destructive border-destructive/40 bg-destructive/10",
    F: "text-destructive border-destructive/40 bg-destructive/10",
};

const SEVERITY_LABEL: Record<HealthSeverity, string> = {
    high: "High",
    medium: "Medium",
    info: "Info",
};

const SEVERITY_TONE: Record<HealthSeverity, string> = {
    high: "text-destructive border-destructive/30 bg-destructive/10",
    medium: "text-primary border-primary/30 bg-primary/10",
    info: "text-muted-foreground border-border bg-secondary",
};

const OFFENDERS_SHOWN = 16;

/**
 * A rule's score impact for display. Penalties are fractional (weight × offender
 * ratio) and the score only rounds after they're summed, so we never show a bare
 * rounded integer that wouldn't reconcile — sub-point impacts read as "<1 pt".
 */
function penaltyLabel(penalty: number): string {
    if (penalty < 1) return "−<1 pt";
    const r = Math.round(penalty * 10) / 10;
    return `−${Number.isInteger(r) ? r : r.toFixed(1)} pts`;
}

/** A scored issue or an informational note — both list offenders on demand. */
function IssueCard({ rule, scored }: { rule: HealthRule; scored: boolean }) {
    const [open, setOpen] = useState(false);
    const shown = rule.offenders.slice(0, OFFENDERS_SHOWN);
    const extra = rule.offenderCount - shown.length;

    return (
        <m.li
            variants={sectionReveal}
            className="rounded-2xl border border-border bg-card p-m shadow-[var(--e1)]"
        >
            <div className="flex flex-wrap items-center gap-x-s gap-y-xs">
                <h3 className="text-300 font-semibold text-foreground">{rule.label}</h3>
                <span
                    className={`inline-flex items-center rounded-full border px-s py-[1px] text-100 font-medium ${SEVERITY_TONE[rule.severity]}`}
                >
                    {SEVERITY_LABEL[rule.severity]}
                </span>
                <span className="ml-auto inline-flex items-center gap-s">
                    {scored ? (
                        <span className="rounded-full border border-border bg-secondary px-s py-[1px] font-numeric text-100 tabular-nums text-foreground">
                            {penaltyLabel(rule.penalty)}
                        </span>
                    ) : null}
                    <span className="font-numeric text-200 tabular-nums text-muted-foreground">
                        {rule.offenderCount}
                        {rule.population ? ` / ${rule.population}` : ""}
                    </span>
                </span>
            </div>
            <p className="mt-xxs text-200 text-muted-foreground">{rule.hint}</p>

            <m.button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                whileTap={{ scale: 0.97 }}
                transition={pressSpring}
                className="mt-s inline-flex items-center gap-xs rounded-lg py-xxs text-100 font-medium text-primary hover:opacity-80"
            >
                <ChevronDown
                    className={`icon-size-100 transition-transform ${open ? "rotate-180" : ""}`}
                    strokeWidth={2}
                    aria-hidden
                />
                {open ? "Hide" : "Show"} {countNoun(rule.offenderCount, "item")}
            </m.button>
            {open ? (
                <div className="mt-s flex flex-wrap gap-xs">
                    {shown.map((o) => (
                        <span
                            key={o}
                            className="inline-flex items-center rounded-full border border-border bg-secondary px-m py-xxs text-100 text-foreground"
                        >
                            {o}
                        </span>
                    ))}
                    {extra > 0 ? (
                        <span className="inline-flex items-center rounded-full px-m py-xxs text-100 text-muted-foreground">
                            +{extra} more
                        </span>
                    ) : null}
                </div>
            ) : null}
        </m.li>
    );
}

/** A passing check — one calm affirmative line, no severity, no fix hint. */
function PassingRow({ rule }: { rule: HealthRule }) {
    return (
        <li className="flex items-center gap-s px-m py-s">
            <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-primary"
            >
                <Check className="icon-size-100" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1 truncate text-200 text-foreground">{rule.pass}</span>
            <span className="shrink-0 text-100 text-muted-foreground">Passing</span>
        </li>
    );
}

function SectionHeading({ title, count, hint }: { title: string; count: number; hint?: string }) {
    return (
        <div className="mb-s flex items-baseline gap-s">
            <h3 className="text-300 font-semibold text-foreground">{title}</h3>
            <span className="font-numeric text-100 tabular-nums text-muted-foreground">{count}</span>
            {hint ? <span className="text-100 text-muted-foreground">· {hint}</span> : null}
        </div>
    );
}

export function HealthView({
    catalog,
    onExit,
}: {
    catalog: CatalogModel;
    onExit: () => void;
}) {
    const report = useMemo(() => analyzeHealth(catalog), [catalog]);
    const { entityCounts: c } = report;

    // Three honest buckets. "All clear" means no SCORED issues — informational
    // findings can (and should) still appear at a perfect 100.
    const { scored, notes, passing, scoredTotal } = useMemo(() => {
        const scored = report.rules.filter((r) => r.weight > 0 && r.offenderCount > 0);
        const notes = report.rules.filter((r) => r.weight === 0 && r.offenderCount > 0);
        const passing = report.rules.filter((r) => r.offenderCount === 0);
        const scoredTotal = report.rules.filter((r) => r.weight > 0).length;
        return { scored, notes, passing, scoredTotal };
    }, [report.rules]);

    const scoredPassing = scoredTotal - scored.length;

    return (
        <ToolShell
            icon={<ShieldCheck className="icon-size-300" strokeWidth={1.75} />}
            title="Model health"
            subtitle="Best-practice checks derived from the live model metadata."
            onExit={onExit}
            maxWidthClass="max-w-4xl"
        >
            <div className="flex flex-col gap-l">
                {/* Scorecard hero */}
                <div className="flex flex-col items-start gap-l rounded-2xl border border-border bg-card p-l shadow-[var(--e1)] sm:flex-row sm:items-center">
                    <div
                        className={`grid size-20 shrink-0 place-items-center rounded-2xl border ${GRADE_TONE[report.grade]}`}
                    >
                        <span className="font-numeric text-hero-700 leading-hero-700 tabular-nums">
                            {report.grade}
                        </span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-s">
                            <span className="font-numeric text-hero-700 leading-hero-700 tabular-nums text-foreground">
                                {report.score}
                            </span>
                            <span className="text-300 text-muted-foreground">/ 100</span>
                        </div>
                        <p className="mt-xs text-200 text-foreground">
                            <span className="font-semibold">{scoredPassing}</span> of {scoredTotal}{" "}
                            scored {pluralize(scoredTotal, "check")} passing
                            {notes.length > 0 ? (
                                <span className="text-muted-foreground">
                                    {" "}· {countNoun(notes.length, "note")} to review
                                </span>
                            ) : null}
                        </p>
                        <div className="mt-m flex flex-wrap gap-s">
                            <StatChip value={c.measures} label="measures" />
                            <StatChip value={c.columns} label="columns" />
                            <StatChip value={c.tables} label="tables" />
                            <StatChip value={c.relationships} label="relationships" />
                        </div>
                    </div>
                </div>

                {/* Scored issues */}
                {scored.length > 0 ? (
                    <section>
                        <SectionHeading
                            title="Issues affecting the score"
                            count={scored.length}
                            hint="deductions are summed, then the score is rounded"
                        />
                        <m.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-s">
                            {scored.map((rule) => (
                                <IssueCard key={rule.id} rule={rule} scored />
                            ))}
                        </m.ul>
                    </section>
                ) : null}

                {/* Informational notes */}
                {notes.length > 0 ? (
                    <section>
                        <SectionHeading title="Notes" count={notes.length} hint="no score impact" />
                        <m.ul variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-s">
                            {notes.map((rule) => (
                                <IssueCard key={rule.id} rule={rule} scored={false} />
                            ))}
                        </m.ul>
                    </section>
                ) : null}

                {/* Passing checks */}
                {passing.length > 0 ? (
                    <section>
                        <SectionHeading title="Passing checks" count={passing.length} />
                        <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-[var(--e1)]">
                            {passing.map((rule) => (
                                <PassingRow key={rule.id} rule={rule} />
                            ))}
                        </ul>
                    </section>
                ) : null}
            </div>
        </ToolShell>
    );
}
