//-----------------------------------------------------------------------
// Semantic Directory — glance card (Level 2, trust-first).
//
// The decision-oriented summary a user sees the instant they pick an
// item — short enough to read without scrolling. Meaning, the trust signals
// (verified-to-close + "don't pull the raw source"), a one-line "built from",
// the top ways to slice it, and a couple of answerable questions. Depth lives
// one click away in DeepDetail; trust never hides behind it.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import type { CatalogModel, MeasureMeta, ColumnMeta } from "@/catalog/model/types";
import { questionsForMeasure } from "@/catalog/questions/generate";
import { columnRollUp } from "@/catalog/lineage/relationships";
import { buildHierarchy } from "@/catalog/lineage/hierarchy";
import { sectionReveal } from "@/lib/motion";
import type { CatalogEntity } from "./entity-detail";
import { Pill } from "./panel-ui";
import { EntityConstellation } from "./entity-constellation";
import { UseThisWith } from "./use-this-with";
import { ColumnMembersPanel } from "./column-members-panel";
import { HierarchyPath } from "./hierarchy-path";

function GlanceLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
    );
}

export function GlanceCard({
    entity,
    catalog,
    onNavigate,
}: {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onNavigate: (key: string) => void;
}) {
    const measureView = useMemo(() => {
        if (entity.kind !== "measure") return undefined;
        return {
            questions: questionsForMeasure(catalog, entity as MeasureMeta).slice(0, 2),
        };
    }, [entity, catalog]);

    const rollUp = useMemo(
        () => (entity.kind === "column" ? columnRollUp(catalog, entity as ColumnMeta).slice(0, 6) : []),
        [entity, catalog],
    );

    const hierarchy = useMemo(
        () => (entity.kind === "column" ? buildHierarchy(catalog, entity as ColumnMeta) : null),
        [entity, catalog],
    );

    return (
        <m.div variants={sectionReveal} initial="hidden" animate="show" className="flex flex-col gap-l">
            <p className="text-300 leading-400 text-foreground">
                {entity.description
                    ?? "No plain-English description yet — this item is live from the model."}
            </p>

            <EntityConstellation entity={entity} catalog={catalog} onNavigate={onNavigate} />

            <UseThisWith entity={entity} catalog={catalog} onNavigate={onNavigate} />

            {hierarchy ? <HierarchyPath view={hierarchy} onNavigate={onNavigate} /> : null}

            {measureView ? (
                <>
                    {measureView.questions.length ? (
                        <div className="flex flex-col gap-xs">
                            <GlanceLabel>Answers questions like</GlanceLabel>
                            <ul className="flex flex-col gap-s">
                                {measureView.questions.map((q) => (
                                    <li
                                        key={q}
                                        className="rounded-lg border border-border bg-secondary px-m py-s text-200 text-foreground"
                                    >
                                        {q}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </>
            ) : null}

            {entity.kind === "column" ? (
                <div className="flex flex-col gap-xs">
                    <GlanceLabel>Rolls up to</GlanceLabel>
                    {rollUp.length ? (
                        <div className="flex flex-wrap gap-s">
                            {rollUp.map((t) => (
                                <Pill key={t} tone="table">{t}</Pill>
                            ))}
                        </div>
                    ) : (
                        <p className="text-200 text-muted-foreground">Top-level dimension — nothing rolls up above it.</p>
                    )}
                    <ColumnMembersPanel column={entity as ColumnMeta} />
                </div>
            ) : null}
        </m.div>
    );
}
