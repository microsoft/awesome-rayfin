//-----------------------------------------------------------------------
// Semantic Directory — area overview (the right pane never goes blank).
//
// When a user enters a area we auto-open its flagship measure, but if
// they close it this pane keeps the space useful instead of "pick something":
// what the area is, the few measures that matter, and the best ways to break it
// down — every item one click from the full story. All derived from the brain.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import { Compass, ArrowRight } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { flagshipMeasures, areaSlices } from "@/catalog/browse/area-insights";
import { panelReveal, sectionReveal } from "@/lib/motion";
import { Pill } from "./panel-ui";
import { Pressable } from "@/components/ui/pressable";

function Label({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
    );
}

export function AreaOverview({
    catalog,
    topic,
    onSelect,
    onNavigate,
}: {
    catalog: CatalogModel;
    topic: string;
    onSelect: (key: string) => void;
    onNavigate: (key: string) => void;
}) {
    const flagships = useMemo(() => flagshipMeasures(catalog, topic, 5), [catalog, topic]);
    const slices = useMemo(() => areaSlices(catalog, topic, 6), [catalog, topic]);
    const count = useMemo(
        () => catalog.measures.filter((mm) => !mm.isHidden && (mm.topic ?? "") === topic).length,
        [catalog, topic],
    );
    const emoji = flagships[0]?.emoji;

    return (
        <m.div
            variants={panelReveal}
            initial="hidden"
            animate="show"
            exit="exit"
            className="flex h-full flex-col gap-l overflow-y-auto rounded-2xl border border-border bg-card p-xl shadow-[var(--e2)]"
        >
            <m.header variants={sectionReveal} className="flex items-start gap-m">
                <span className="text-hero-700" aria-hidden>{emoji ?? <Compass className="icon-size-500 text-primary" />}</span>
                <div>
                    <h2 className="text-hero-700 font-semibold leading-hero-700 text-foreground">{topic}</h2>
                    <p className="text-200 text-muted-foreground">
                        <span className="font-numeric">{count}</span> measures in this area
                    </p>
                </div>
            </m.header>

            {flagships.length ? (
                <m.section variants={sectionReveal} className="flex flex-col gap-s">
                    <Label>The measures that matter here</Label>
                    <div className="flex flex-col gap-xs">
                        {flagships.map((f) => (
                            <Pressable
                                key={f.key}
                                variant="card"
                                onClick={() => onSelect(f.key)}
                                className="group flex items-start gap-m rounded-xl border border-border bg-secondary px-m py-s text-left transition-colors hover:border-primary/40 hover:bg-accent"
                            >
                                <span className="mt-xxs text-400" aria-hidden>{f.emoji ?? "•"}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-s">
                                        <span className="truncate text-300 font-semibold text-foreground">{f.displayName}</span>
                                    </span>
                                    {f.description ? (
                                        <span className="mt-xxs block line-clamp-1 text-100 text-muted-foreground">{f.description}</span>
                                    ) : null}
                                </span>
                                <ArrowRight className="icon-size-100 mt-xs shrink-0 text-muted-foreground transition-transform group-hover:translate-x-[2px] group-hover:text-primary" strokeWidth={2} aria-hidden />
                            </Pressable>
                        ))}
                    </div>
                </m.section>
            ) : null}

            {slices.length ? (
                <m.section variants={sectionReveal} className="flex flex-col gap-s">
                    <Label>Break this area down by</Label>
                    <div className="flex flex-wrap gap-s">
                        {slices.map((c) => (
                            <Pill key={c.key} tone="column" onClick={() => onNavigate(c.key)}>
                                {c.displayName}
                            </Pill>
                        ))}
                    </div>
                </m.section>
            ) : null}

            <m.p variants={sectionReveal} className="mt-auto text-100 text-muted-foreground">
                Pick a measure to see what it means, how it&apos;s built, and the questions it answers — no DAX required.
            </m.p>
        </m.div>
    );
}
