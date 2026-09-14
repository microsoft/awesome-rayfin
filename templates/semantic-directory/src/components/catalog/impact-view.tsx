//-----------------------------------------------------------------------
// Semantic Directory — Impact analysis tool (full workspace view).
//
// Answers "if I change THIS, what breaks?" for any measure or field. Pick a
// root with the same typeahead used everywhere; the tool traces the reverse
// dependency graph and lays out the blast radius as depth-grouped rings — the
// measures that read it directly, then the ones that read those, and so on.
// Every dependent is clickable so a steward can walk the chain before touching
// anything. Built entirely from the DAX dependency graph (no AI), so it works
// against any model, and it opens on the highest-impact entity by default.
//
// The root is deep-linked (ie hash param) so a traced blast radius is a
// shareable link.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { ShieldCheck, Waypoints } from "lucide-react";
import type { CatalogModel, ColumnMeta, MeasureMeta } from "@/catalog/model/types";
import { impactOf, topImpactRoot, visibleImpact } from "@/catalog/model/impact";
import { ToolShell } from "./tool-shell";
import { SearchField } from "./search-field";
import { ImpactLevels } from "./impact-levels";
import { StatChip } from "./panel-ui";

export function ImpactView({
    catalog,
    onExit,
    initialKey,
    onSelectRoot,
    onNavigate,
}: {
    catalog: CatalogModel;
    onExit: () => void;
    /** Deep-linked root entity key (measure or column). */
    initialKey?: string;
    /** Report the chosen root back up for the shareable hash. */
    onSelectRoot?: (key: string) => void;
    /** Open a downstream dependent in the full catalog detail. */
    onNavigate: (key: string) => void;
}) {
    // Only measures and fields have a downstream blast radius, so the picker
    // resolves to those. Built once per catalog so a model swap can't strand a
    // stale root — an unknown key just falls back to the auto-resolved default.
    const rootIndex = useMemo(() => {
        const map = new Map<string, MeasureMeta | ColumnMeta>();
        for (const mm of catalog.measures) map.set(mm.key, mm);
        for (const cc of catalog.columns) map.set(cc.key, cc);
        return map;
    }, [catalog]);

    const fallback = useMemo(() => topImpactRoot(catalog), [catalog]);
    const [rootKey, setRootKey] = useState(initialKey ?? "");
    const [pickerQuery, setPickerQuery] = useState("");

    const root = (rootKey ? rootIndex.get(rootKey) : undefined) ?? fallback;
    const impact = useMemo(
        () => (root ? visibleImpact(impactOf(catalog, root)) : undefined),
        [catalog, root],
    );

    const pickRoot = (key: string) => {
        // Tables have no downstream measures — ignore them so the root stays valid.
        if (!rootIndex.has(key)) return;
        setRootKey(key);
        setPickerQuery("");
        onSelectRoot?.(key);
    };

    return (
        <ToolShell
            icon={<Waypoints className="icon-size-300" strokeWidth={1.75} />}
            title="Impact analysis"
            subtitle="See everything downstream before you change a measure or field."
            onExit={onExit}
            maxWidthClass="max-w-3xl"
            toolbar={
                <label className="flex flex-col gap-xs">
                    <span className="text-100 font-semibold text-muted-foreground">Trace impact from</span>
                    <SearchField
                        catalog={catalog}
                        query={pickerQuery}
                        onQueryChange={setPickerQuery}
                        onSelect={pickRoot}
                        onSubmit={() => undefined}
                        size="lg"
                        placeholder="Pick a measure or field to trace"
                    />
                </label>
            }
        >
            {root && impact ? (
                <div className="flex flex-col gap-l" aria-live="polite">
                    <div className="flex flex-wrap items-end justify-between gap-m rounded-2xl border border-border bg-card p-l shadow-[var(--e1)]">
                        <div className="min-w-0">
                            <p className="text-100 text-muted-foreground">Changing</p>
                            <h3 className="flex items-center gap-s text-500 font-semibold leading-500 text-foreground">
                                {root.emoji ? <span aria-hidden>{root.emoji}</span> : null}
                                {root.displayName}
                            </h3>
                            <p className="truncate text-100 text-muted-foreground">
                                {root.kind === "measure" ? `in ${root.table}` : root.ref}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-s">
                            <StatChip
                                value={impact.total}
                                label={impact.total === 1 ? "downstream measure" : "downstream measures"}
                            />
                            <StatChip
                                value={impact.maxDepth}
                                label={impact.maxDepth === 1 ? "level deep" : "levels deep"}
                            />
                        </div>
                    </div>

                    {impact.total > 0 ? (
                        <ImpactLevels levels={impact.levels} onNavigate={onNavigate} />
                    ) : (
                        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card p-xl text-center">
                            <ShieldCheck className="icon-size-500 text-primary" strokeWidth={1.5} aria-hidden />
                            <p className="mt-s text-400 font-semibold text-foreground">
                                Nothing downstream reads this
                            </p>
                            <p className="mt-xs max-w-md text-200 text-muted-foreground">
                                No measure depends on <span className="font-semibold text-foreground">{root.displayName}</span>{" "}
                                today, so it&apos;s safe to change on its own. Pick another measure or field above to trace
                                its blast radius.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card p-xl text-center">
                    <Waypoints className="icon-size-500 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                    <p className="mt-s text-400 font-semibold text-foreground">Nothing to trace yet</p>
                    <p className="mt-xs max-w-md text-200 text-muted-foreground">
                        This model has no measures or fields to analyze. Connect a model with measures to see downstream
                        impact.
                    </p>
                </div>
            )}
        </ToolShell>
    );
}
