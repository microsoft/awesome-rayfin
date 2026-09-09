//-----------------------------------------------------------------------
// Semantic Directory — shared blast-radius presentation.
//
// Renders reverse-lineage dependents grouped by distance as a quiet vertical
// timeline: a thin rule threads the rings together, a small dot marks each
// depth, and every dependent is a clickable pill. One component, two homes —
// the embedded detail tab and the standalone Impact tool — so the blast radius
// looks and behaves identically wherever it appears. Derived from the DAX
// dependency graph — no AI.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import type { ImpactLevel } from "@/catalog/model/impact";
import { listContainer, sectionReveal } from "@/lib/motion";
import { Pill } from "./panel-ui";

/** Plain-language name for a ring of the blast radius (never a bare number). */
function depthLabel(depth: number): string {
    if (depth === 1) return "Reads it directly";
    if (depth === 2) return "One step further";
    return `${depth} steps downstream`;
}

export function ImpactLevels({
    levels,
    onNavigate,
}: {
    levels: ImpactLevel[];
    onNavigate: (key: string) => void;
}) {
    return (
        <m.ol variants={listContainer} initial="hidden" animate="show" className="flex flex-col">
            {levels.map((level, i) => (
                <m.li
                    key={level.depth}
                    variants={sectionReveal}
                    className={`relative flex flex-col gap-s border-l border-border pl-l ${
                        i < levels.length - 1 ? "pb-l" : ""
                    }`}
                >
                    <span
                        aria-hidden
                        className="absolute -left-[5px] top-[6px] size-2.5 rounded-full border border-[color:var(--hue-measure)]/40 bg-[var(--hue-measure-soft)]"
                    />
                    <div className="flex items-baseline gap-s">
                        <p className="text-200 font-semibold text-foreground">{depthLabel(level.depth)}</p>
                        <span className="font-numeric text-100 tabular-nums text-muted-foreground">
                            {level.measures.length}
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-s">
                        {level.measures.map((mm) => (
                            <Pill key={mm.key} tone="measure" onClick={() => onNavigate(mm.key)}>
                                {mm.emoji ? <span aria-hidden>{mm.emoji}</span> : null}
                                {mm.displayName}
                            </Pill>
                        ))}
                    </div>
                </m.li>
            ))}
        </m.ol>
    );
}
