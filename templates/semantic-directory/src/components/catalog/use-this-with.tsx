//-----------------------------------------------------------------------
// Semantic Directory — "Use this with" (report-safe pairings).
//
// Pairs with the constellation to answer the practical question a user
// actually has: "OK — how do I put this to work in a report?" For a measure it
// suggests the fields to break it down by; for a dimension, the measures it can
// slice; for a table, the measures + slicers to start from. Every suggestion is
// a real, clickable model entity, derived deterministically — no AI.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import type { CatalogModel, MeasureMeta, ColumnMeta, TableMeta } from "@/catalog/model/types";
import { normName } from "@/catalog/model/types";
import { recommendSlices } from "@/catalog/lineage/slice-recommender";
import type { CatalogEntity } from "./entity-detail";
import { Pill } from "./panel-ui";

function Group({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-xs">
            <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <div className="flex flex-wrap gap-s">{children}</div>
        </div>
    );
}

export function UseThisWith({
    entity,
    catalog,
    onNavigate,
}: {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onNavigate: (key: string) => void;
}) {
    const model = useMemo(() => {
        if (entity.kind === "measure") {
            const slices = recommendSlices(catalog, entity as MeasureMeta).top.slice(0, 5);
            return { kind: "measure" as const, slices };
        }
        if (entity.kind === "column") {
            const byName = new Map(catalog.measures.map((m) => [normName(m.name), m]));
            const measures = (entity as ColumnMeta).usedByMeasures
                ?.map((n) => byName.get(normName(n)))
                .filter((x): x is MeasureMeta => Boolean(x) && !x!.isHidden)
                .slice(0, 6) ?? [];
            return { kind: "column" as const, measures };
        }
        const t = entity as TableMeta;
        const home = normName(t.name);
        const hosted = catalog.measures
            .filter((m) => normName(m.table) === home && !m.isHidden)
            .slice(0, 5);
        const dims = catalog.columns
            .filter((c) => normName(c.table) === home && !c.isHidden && c.isDimensionLike)
            .sort((a, b) => (b.usedByMeasures?.length ?? 0) - (a.usedByMeasures?.length ?? 0))
            .slice(0, 5);
        return { kind: "table" as const, hosted, dims };
    }, [entity, catalog]);

    // Nothing useful to suggest → don't render an empty shell.
    if (model.kind === "measure" && !model.slices.length) return null;
    if (model.kind === "column" && !model.measures.length) return null;
    if (model.kind === "table" && !model.hosted.length && !model.dims.length) return null;

    return (
        <div className="flex flex-col gap-s rounded-2xl border border-border bg-secondary/40 p-l">
            <div className="flex items-center gap-xs text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                <LayoutDashboard className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                Use this with
            </div>

            {model.kind === "measure" ? (
                <>
                    <Group label="Break it down by">
                        {model.slices.map((s) => (
                            <Pill key={s.column.key} tone="column" onClick={() => onNavigate(s.column.key)}>
                                {s.column.displayName}
                            </Pill>
                        ))}
                    </Group>
                    <p className="text-100 text-muted-foreground">
                        Drop this measure into a card or matrix, then slice by the fields above. It&rsquo;s
                        report-ready — pull it straight, no need to rebuild from the raw source.
                    </p>
                </>
            ) : null}

            {model.kind === "column" ? (
                <>
                    <Group label="Slice these measures">
                        {model.measures.map((m) => (
                            <Pill key={m.key} tone="measure" onClick={() => onNavigate(m.key)}>
                                {m.emoji ? <span aria-hidden>{m.emoji}</span> : null}
                                {m.displayName}
                            </Pill>
                        ))}
                    </Group>
                    <p className="text-100 text-muted-foreground">
                        Use this field as rows, columns, or a slicer to break those measures down.
                    </p>
                </>
            ) : null}

            {model.kind === "table" ? (
                <>
                    {model.hosted.length ? (
                        <Group label="Start with these measures">
                            {model.hosted.map((m) => (
                                <Pill key={m.key} tone="measure" onClick={() => onNavigate(m.key)}>
                                    {m.emoji ? <span aria-hidden>{m.emoji}</span> : null}
                                    {m.displayName}
                                </Pill>
                            ))}
                        </Group>
                    ) : null}
                    {model.dims.length ? (
                        <Group label="Common slicers">
                            {model.dims.map((c) => (
                                <Pill key={c.key} tone="column" onClick={() => onNavigate(c.key)}>
                                    {c.displayName}
                                </Pill>
                            ))}
                        </Group>
                    ) : null}
                    <p className="text-100 text-muted-foreground">
                        Bring these into a report together — the measures with the slicers beside them.
                    </p>
                </>
            ) : null}
        </div>
    );
}
