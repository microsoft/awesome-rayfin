//-----------------------------------------------------------------------
// Semantic Directory — impact panel ("what breaks if I change this?").
//
// The embedded blast radius, shown in an entity's Impact tab: the measures that
// read it directly, then the ones that read those, grouped by distance and all
// clickable. Shares the depth-timeline presentation with the standalone Impact
// tool, and offers a one-click hand-off to that tool for the full-screen view.
// Derived from the DAX dependency graph — no AI.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { ShieldCheck, Waypoints } from "lucide-react";
import type { CatalogModel, ColumnMeta, MeasureMeta } from "@/catalog/model/types";
import { impactOf, visibleImpact } from "@/catalog/model/impact";
import { Section } from "./panel-ui";
import { ImpactLevels } from "./impact-levels";
import { Pressable } from "@/components/ui/pressable";

export function ImpactPanel({
    catalog,
    entity,
    onNavigate,
    onOpenFull,
}: {
    catalog: CatalogModel;
    entity: MeasureMeta | ColumnMeta;
    onNavigate: (key: string) => void;
    /** Hand off to the standalone Impact tool, seeded on this entity. */
    onOpenFull?: (key: string) => void;
}) {
    // Hidden measures aren't surfaced anywhere else, so render the visible slice.
    const view = useMemo(() => visibleImpact(impactOf(catalog, entity)), [catalog, entity]);

    if (view.total === 0) {
        return (
            <Section title="Downstream impact" hint="what depends on this today">
                <div className="flex items-center gap-s rounded-xl border border-border bg-secondary px-m py-s">
                    <ShieldCheck className="icon-size-200 text-primary" strokeWidth={2} aria-hidden />
                    <p className="text-200 text-foreground">
                        Nothing downstream reads this yet — safe to change on its own.
                    </p>
                </div>
            </Section>
        );
    }

    return (
        <Section
            title="Downstream impact"
            hint={`${view.total} ${view.total === 1 ? "measure depends" : "measures depend"} on this`}
        >
            <div className="flex flex-col gap-l">
                <p className="text-200 text-muted-foreground">
                    Changing this affects{" "}
                    <span className="font-semibold text-foreground">{view.total}</span>{" "}
                    downstream {view.total === 1 ? "measure" : "measures"} across{" "}
                    <span className="font-semibold text-foreground">{view.maxDepth}</span>{" "}
                    {view.maxDepth === 1 ? "level" : "levels"}. Review before editing.
                </p>
                <ImpactLevels levels={view.levels} onNavigate={onNavigate} />
                {onOpenFull ? (
                    <div>
                        <Pressable
                            onClick={() => onOpenFull(entity.key)}
                            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
                        >
                            <Waypoints className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                            Open full impact analysis
                        </Pressable>
                    </div>
                ) : null}
            </div>
        </Section>
    );
}
