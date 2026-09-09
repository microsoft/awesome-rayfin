//-----------------------------------------------------------------------
// Semantic Directory — "Slice by" recommender surface.
//
// Answer Concierge, grounded: shows the best handful of *real* ways to break a
// measure down (ranked by usefulness, deduped), with the long tail
// tucked into a collapsible, table-grouped drawer so it's never a wall of
// pills. Each slice is clickable to jump to that dimension.
//-----------------------------------------------------------------------

import { useState } from "react";
import { m } from "framer-motion";
import { ChevronDown, Clock, MapPin, Package, SlidersHorizontal, Store, Users, Building2, ListFilter } from "lucide-react";
import type { SliceArchetype, SliceRecommendation, RankedSlice } from "@/catalog/lineage/slice-recommender";
import { chipPop, listContainer } from "@/lib/motion";
import { Section, Pill } from "./panel-ui";
import { Pressable } from "@/components/ui/pressable";

const ARCHETYPE_ICON: Record<SliceArchetype, typeof Clock> = {
    time: Clock,
    geography: MapPin,
    product: Package,
    scenario: SlidersHorizontal,
    channel: Store,
    customer: Users,
    organization: Building2,
    other: ListFilter,
};

function SliceButton({ slice, onSelect }: { slice: RankedSlice; onSelect: (key: string) => void }) {
    const Icon = ARCHETYPE_ICON[slice.archetype];
    return (
        <Pill tone="column" onClick={() => onSelect(slice.column.key)} title={slice.reason}>
            <Icon className="icon-size-100 text-[color:var(--hue-column)]" strokeWidth={2} aria-hidden />
            {slice.column.displayName}
        </Pill>
    );
}

export function SliceBy({
    rec,
    onSelect,
}: {
    rec: SliceRecommendation;
    onSelect: (key: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const remainderCount = rec.grouped.reduce((n, g) => n + g.slices.length, 0);

    return (
        <Section
            title="Slice by"
            hint={
                rec.scope === "model"
                    ? "model-wide dimensions (measure lives in a shared table)"
                    : `${rec.total} ways to break it down`
            }
        >
            {rec.top.length ? (
                <m.div variants={listContainer} initial="hidden" animate="show" className="flex flex-wrap gap-s">
                    {rec.top.map((s) => (
                        <m.div key={s.column.key} variants={chipPop}>
                            <SliceButton slice={s} onSelect={onSelect} />
                        </m.div>
                    ))}
                </m.div>
            ) : (
                <p className="text-200 text-muted-foreground">No related dimensions found.</p>
            )}

            {remainderCount > 0 ? (
                <div className="mt-m">
                    <Pressable
                        variant="control"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="inline-flex items-center gap-xs rounded-lg px-s py-xs text-200 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <ChevronDown
                            className={`icon-size-200 transition-transform ${open ? "rotate-180" : ""}`}
                            strokeWidth={2}
                            aria-hidden
                        />
                        {open ? "Hide" : `Show ${remainderCount} more`} across {rec.grouped.length} tables
                    </Pressable>
                    {open ? (
                        <div className="mt-s flex flex-col gap-m">
                            {rec.grouped.map((g) => (
                                <div key={g.table}>
                                    <p className="mb-xs text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                                        {g.table}
                                    </p>
                                    <div className="flex flex-wrap gap-s">
                                        {g.slices.slice(0, 24).map((s) => (
                                            <SliceButton key={s.column.key} slice={s} onSelect={onSelect} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Section>
    );
}
