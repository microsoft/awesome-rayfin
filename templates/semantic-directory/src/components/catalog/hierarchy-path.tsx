//-----------------------------------------------------------------------
// Semantic Directory — hierarchy path visual.
//
// Shows the fuller context a dimension field belongs to, honestly:
//   • "levels" — a flat, ordered broad→detailed list, used ONLY when live
//     cardinality justifies the order (no faked parent/child nesting).
//   • "chips" — a related set of fields grouped by the model (display folder,
//     business area, or conformed dimension), with no implied order.
// Every level is clickable to jump around the dimension. From buildHierarchy.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import { ListTree, ArrowDown } from "lucide-react";
import type { HierarchyView } from "@/catalog/lineage/hierarchy";
import { useDistinctCounts } from "@/hooks/use-distinct-counts";
import { listContainer, chipPop } from "@/lib/motion";
import { Pill } from "./panel-ui";
import { Pressable } from "@/components/ui/pressable";

const grainFmt = new Intl.NumberFormat("en-US");

export function HierarchyPath({
    view,
    onNavigate,
}: {
    view: HierarchyView;
    onNavigate: (key: string) => void;
}) {
    const refs = useMemo(
        () => view.items.map((i) => ({ table: i.table, column: i.column })),
        [view.items],
    );
    const counts = useDistinctCounts(refs);
    const grainOf = (table: string, column: string) =>
        counts.get(`${table}[${column}]`.toLowerCase());
    return (
        <div className="flex flex-col gap-s rounded-2xl border border-border bg-secondary/40 p-l">
            <div className="flex items-center justify-between gap-s">
                <div className="flex items-center gap-xs text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                    <ListTree className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                    {view.title}
                </div>
                {view.layout === "levels" ? (
                    <span className="inline-flex items-center gap-xxs text-100 text-muted-foreground">
                        summary <ArrowDown className="icon-size-100" strokeWidth={2} aria-hidden /> detail
                    </span>
                ) : null}
            </div>

            {counts.size ? (
                <p className="text-100 text-muted-foreground">
                    Numbers show <span className="tabular-nums">distinct</span> values at each level.
                </p>
            ) : null}

            {view.layout === "levels" ? (
                <m.ol
                    variants={listContainer}
                    initial="hidden"
                    animate="show"
                    className="flex flex-col gap-[3px] border-l border-border/70 pl-m"
                >
                    {view.items.map((item) => (
                        <m.li key={item.key} variants={chipPop} className="relative">
                            <span
                                aria-hidden
                                className={`absolute -left-[calc(1rem+1px)] top-1/2 h-px w-m ${item.current ? "bg-primary/60" : "bg-border/70"}`}
                            />
                            <Pressable
                                variant="control"
                                interactive={!item.current}
                                onClick={() => !item.current && onNavigate(item.key)}
                                aria-current={item.current || undefined}
                                className={`group flex w-full items-center gap-xs rounded-lg border px-m py-xs text-left text-200 transition-colors ${
                                    item.current
                                        ? "border-primary/50 bg-primary/12 font-semibold text-foreground shadow-[var(--glow)]"
                                        : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
                                }`}
                            >
                                {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {(() => {
                                    const g = grainOf(item.table, item.column);
                                    return typeof g === "number" ? (
                                        <span
                                            title={`${grainFmt.format(g)} distinct values`}
                                            className="shrink-0 rounded-full bg-secondary px-s py-[1px] text-100 font-medium tabular-nums text-muted-foreground"
                                        >
                                            {grainFmt.format(g)}
                                        </span>
                                    ) : null;
                                })()}
                                {item.current ? (
                                    <span className="shrink-0 rounded-full bg-primary/15 px-s py-[1px] text-100 font-medium text-primary">
                                        you are here
                                    </span>
                                ) : null}
                            </Pressable>
                        </m.li>
                    ))}
                </m.ol>
            ) : (
                <m.div variants={listContainer} initial="hidden" animate="show" className="flex flex-wrap gap-s">
                    {view.items.map((item) => (
                        <m.div key={item.key} variants={chipPop}>
                            <Pill
                                tone={item.current ? "measure" : "column"}
                                onClick={item.current ? undefined : () => onNavigate(item.key)}
                            >
                                {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                                {item.label}
                                {(() => {
                                    const g = grainOf(item.table, item.column);
                                    return typeof g === "number" ? (
                                        <span className="ml-xxs text-100 tabular-nums opacity-70">
                                            · {grainFmt.format(g)}
                                        </span>
                                    ) : null;
                                })()}
                                {item.current ? <span className="ml-xxs text-100 opacity-70">· here</span> : null}
                            </Pill>
                        </m.div>
                    ))}
                </m.div>
            )}

            <p className="text-100 text-muted-foreground">{view.note}</p>
        </div>
    );
}
