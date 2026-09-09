//-----------------------------------------------------------------------
// Semantic Directory — LineageStrip (the horizontal, source→consumer ribbon).
//
// A complement to the radial EntityConstellation: the same neighborhood, told
// left-to-right as a flow the way a user reads a lineage trace — where the
// data comes FROM on the left, the focused item in the middle, and what it
// FEEDS on the right. Deterministic, built from the entity neighborhood. Every
// chip is a real, clickable model entity.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { buildEntityHood, type HoodSector, type NodeKind } from "@/catalog/lineage/entity-hood";
import type { CatalogEntity } from "./entity-detail";

const DOT: Record<NodeKind, string> = {
    measure: "bg-[color:var(--hue-measure)]",
    column: "bg-[color:var(--hue-column)]",
    table: "bg-[color:var(--hue-table)]",
};
const TONE: Record<NodeKind, string> = {
    measure: "border-[color:var(--hue-measure)]/35 bg-[var(--hue-measure-soft)]",
    column: "border-[color:var(--hue-column)]/35 bg-[var(--hue-column-soft)]",
    table: "border-[color:var(--hue-table)]/35 bg-[var(--hue-table-soft)]",
};

// Which sectors form the upstream / downstream lanes, per entity kind.
const UPSTREAM: Record<string, string[]> = {
    measure: ["source", "built"],
    column: ["home", "rollup"],
    table: ["joins"],
};
const DOWNSTREAM: Record<string, string[]> = {
    measure: ["usedby"],
    column: ["usedby"],
    table: ["hosted", "refby"],
};

function Stage({
    sector,
    onNavigate,
}: {
    sector: HoodSector;
    onNavigate: (key: string) => void;
}) {
    return (
        <div className="flex shrink-0 flex-col gap-xs">
            <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">{sector.label}</span>
            <div className="flex flex-col gap-xs">
                {sector.nodes.slice(0, 4).map((n) => {
                    const body = (
                        <span className={`inline-flex max-w-[11rem] items-center gap-xs rounded-lg border px-s py-[3px] text-100 ${TONE[n.kind]}`}>
                            <span aria-hidden className={`size-[6px] shrink-0 rounded-full ${DOT[n.kind]}`} />
                            <span className="truncate text-foreground">{n.label}</span>
                        </span>
                    );
                    return n.navigable ? (
                        <button key={n.key} type="button" onClick={() => onNavigate(n.key)} title={`Open ${n.label}`} className="text-left transition-[filter] hover:brightness-110">
                            {body}
                        </button>
                    ) : (
                        <span key={n.key}>{body}</span>
                    );
                })}
                {sector.total > 4 ? (
                    <span className="pl-xs text-100 text-muted-foreground">+{sector.total - 4} more</span>
                ) : null}
            </div>
        </div>
    );
}

function Arrow() {
    return (
        <div className="flex shrink-0 items-center self-center text-primary/50" aria-hidden>
            <ArrowRight className="icon-size-200" strokeWidth={2} />
        </div>
    );
}

export function LineageStrip({
    entity,
    catalog,
    onNavigate,
}: {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onNavigate: (key: string) => void;
}) {
    const hood = useMemo(() => buildEntityHood(catalog, entity), [catalog, entity]);

    const lanes = useMemo(() => {
        if (!hood) return null;
        const byId = new Map(hood.sectors.map((s) => [s.id, s]));
        const up = (UPSTREAM[entity.kind] ?? []).map((id) => byId.get(id)).filter((s): s is HoodSector => Boolean(s));
        const down = (DOWNSTREAM[entity.kind] ?? []).map((id) => byId.get(id)).filter((s): s is HoodSector => Boolean(s));
        return { up, down };
    }, [hood, entity.kind]);

    if (!hood || !lanes || (!lanes.up.length && !lanes.down.length)) return null;

    return (
        <div className="relative">
            <div className="overflow-x-auto">
                <div className="flex min-w-min items-stretch gap-m pr-10 sm:pr-0">
                    {lanes.up.map((s) => (
                        <div key={s.id} className="flex items-stretch gap-m">
                            <Stage sector={s} onNavigate={onNavigate} />
                            <Arrow />
                        </div>
                    ))}

                    {/* Center item. */}
                    <div className="flex shrink-0 flex-col gap-xs">
                        <span className="text-100 font-semibold uppercase tracking-wide text-primary">This {entity.kind}</span>
                        <div className="flex flex-1 items-center rounded-lg border border-primary/50 bg-card px-m py-s shadow-[var(--glow)]">
                            <span className="flex items-center gap-xs">
                                {hood.center.emoji ? <span aria-hidden>{hood.center.emoji}</span> : null}
                                <span className="max-w-[11rem] truncate text-200 font-semibold text-foreground" title={hood.center.label}>
                                    {hood.center.label}
                                </span>
                            </span>
                        </div>
                    </div>

                    {lanes.down.map((s) => (
                        <div key={s.id} className="flex items-stretch gap-m">
                            <Arrow />
                            <Stage sector={s} onNavigate={onNavigate} />
                        </div>
                    ))}
                </div>
            </div>
            {/* Scroll-more hint on touch/narrow widths only; hidden once there's room (sm+). */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent sm:hidden" />
        </div>
    );
}
