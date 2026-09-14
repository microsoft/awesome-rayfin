//-----------------------------------------------------------------------
// Semantic Directory — entity detail ("Measure DNA") panel.
//
// The hero surface. For a measure it answers, in plain English and with zero
// DAX knowledge required: what it means, how trustworthy it is, what it's
// built from (child measures → columns → tables → source systems), which
// family it belongs to, how you can slice it, and what questions it answers.
// Columns and tables get focused lineage views. Everything is derived from the
// catalog brain, so it always reflects the current model.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import { X } from "lucide-react";
import type { CatalogModel, ColumnMeta, MeasureMeta, TableMeta } from "@/catalog/model/types";
import { columnRollUp, tableNeighbors } from "@/catalog/lineage/relationships";
import { recommendSlices } from "@/catalog/lineage/slice-recommender";
import { questionsForMeasure } from "@/catalog/questions/generate";
import { panelReveal } from "@/lib/motion";
import { KindBadge } from "./kind-badge";
import { TrustBadge } from "./trust-badge";
import { Section, Pill, StatChip } from "./panel-ui";
import { BuiltFrom } from "./built-from";
import { FamilyStrip } from "./family-strip";
import { SliceBy } from "./slice-by";
import { Pressable } from "@/components/ui/pressable";

const ONTOLOGY_LABEL: Record<string, string> = {
    fact: "Fact table",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge",
    security: "Security / RLS",
    operational: "Operational",
};

export type CatalogEntity = MeasureMeta | ColumnMeta | TableMeta;

interface EntityDetailProps {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onClose: () => void;
    onNavigate: (key: string) => void;
}

export function EntityDetail({ entity, catalog, onClose, onNavigate }: EntityDetailProps) {
    const measureView = useMemo(() => {
        if (entity.kind !== "measure") return undefined;
        return {
            rec: recommendSlices(catalog, entity),
            questions: questionsForMeasure(catalog, entity),
        };
    }, [entity, catalog]);

    const columnView = useMemo(
        () => (entity.kind === "column" ? { rollUp: columnRollUp(catalog, entity) } : undefined),
        [entity, catalog],
    );
    const tableView = useMemo(
        () => (entity.kind === "table" ? { neighbors: tableNeighbors(catalog, entity.name) } : undefined),
        [entity, catalog],
    );

    const trust = entity.kind === "measure" || entity.kind === "table" ? entity.trust : undefined;

    return (
        <m.div
            key={entity.key}
            variants={panelReveal}
            initial="hidden"
            animate="show"
            className="flex h-full flex-col gap-l overflow-y-auto rounded-2xl border border-border bg-card p-xl shadow-[var(--e2)]"
        >
            <header className="flex items-start justify-between gap-m">
                <div className="flex items-start gap-m">
                    {entity.emoji ? <span className="text-hero-700">{entity.emoji}</span> : null}
                    <div>
                        <div className="mb-xs flex flex-wrap items-center gap-s">
                            <KindBadge kind={entity.kind} />
                            {trust ? <TrustBadge trust={trust} showNote /> : null}
                            {entity.kind === "table" && (entity as TableMeta).ontology ? (
                                <span className="rounded-full border border-border bg-secondary px-s py-xxs text-100 font-semibold text-muted-foreground">
                                    {ONTOLOGY_LABEL[(entity as TableMeta).ontology!] ?? (entity as TableMeta).ontology}
                                </span>
                            ) : null}
                            {entity.kind === "measure" && !entity.description ? (
                                <span className="rounded-full bg-destructive/15 px-s py-xxs text-100 font-semibold text-destructive">
                                    Needs description
                                </span>
                            ) : null}
                        </div>
                        <h2 className="text-hero-700 font-semibold leading-hero-700 text-foreground">
                            {entity.displayName}
                        </h2>
                        <p className="text-200 text-muted-foreground">
                            {entity.kind === "column"
                                ? entity.ref
                                : entity.kind === "measure"
                                    ? `in ${entity.table}`
                                    : "Table"}
                        </p>
                    </div>
                </div>
                <Pressable
                    variant="icon"
                    onClick={onClose}
                    aria-label="Close"
                    className="rounded-lg p-s text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X className="icon-size-300" strokeWidth={2} aria-hidden />
                </Pressable>
            </header>

            <m.div variants={panelReveal} className="flex flex-col gap-l">
                <Section title="What is it">
                    <p className="text-300 leading-400 text-foreground">
                        {entity.description
                            ?? "No plain-English description yet. This item is live from the model — help us describe it."}
                    </p>
                    {entity.kind === "measure" && entity.stewardPending ? (
                        <p className="mt-xs text-100 text-muted-foreground">
                            ⚠︎ Auto-generated summary, pending data-steward review.
                        </p>
                    ) : null}
                    <div className="mt-m flex flex-wrap gap-s">
                        {entity.topic ? <Pill title="Business topic">📂 {entity.topic}</Pill> : null}
                        {entity.kind === "measure" && entity.formatString ? (
                            <Pill title="Format">🔢 {entity.formatString}</Pill>
                        ) : null}
                        {entity.kind === "measure" && entity.shows ? <Pill>{entity.shows}</Pill> : null}
                        {entity.tags.map((t) => (
                            <Pill key={t}>#{t}</Pill>
                        ))}
                    </div>
                </Section>

                {measureView ? (
                    <>
                        <BuiltFrom
                            catalog={catalog}
                            measure={entity as MeasureMeta}
                            onSelectMeasure={onNavigate}
                            onSelectTable={onNavigate}
                        />
                        <FamilyStrip
                            catalog={catalog}
                            measure={entity as MeasureMeta}
                            onSelectMeasure={onNavigate}
                        />
                        <SliceBy rec={measureView.rec} onSelect={onNavigate} />
                        <Section title="Questions it can answer">
                            {measureView.questions.length ? (
                                <ul className="flex flex-col gap-s">
                                    {measureView.questions.map((q) => (
                                        <li
                                            key={q}
                                            className="rounded-lg border border-border bg-secondary px-m py-s text-300 text-foreground"
                                        >
                                            {q}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-200 text-muted-foreground">
                                    Add example questions via enrichment.
                                </p>
                            )}
                        </Section>
                    </>
                ) : null}

                {columnView ? (
                    <Section title="Rolls up to">
                        {columnView.rollUp.length ? (
                            <div className="flex flex-wrap items-center gap-s">
                                {columnView.rollUp.map((t) => (
                                    <Pill key={t} tone="table">{t}</Pill>
                                ))}
                            </div>
                        ) : (
                            <p className="text-200 text-muted-foreground">
                                This field is a top-level dimension — nothing rolls up above it.
                            </p>
                        )}
                    </Section>
                ) : null}

                {tableView ? (
                    <>
                        <Section title="Structure">
                            <div className="flex flex-wrap gap-s">
                                <StatChip value={(entity as TableMeta).columnCount} label="columns" />
                                <StatChip value={(entity as TableMeta).measureCount} label="measures" />
                                {(entity as TableMeta).sourceSystem ? (
                                    <StatChip value={(entity as TableMeta).sourceSystem!} label="source system" />
                                ) : null}
                            </div>
                            {(entity as TableMeta).physicalSource ? (
                                <p className="mt-s text-100 text-muted-foreground">
                                    Physical source · {(entity as TableMeta).physicalSource}
                                </p>
                            ) : null}
                        </Section>
                        <Section title="Connects to">
                            {tableView.neighbors.length ? (
                                <div className="flex flex-wrap gap-s">
                                    {tableView.neighbors.map((t) => (
                                        <Pill key={t} tone="table">{t}</Pill>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-200 text-muted-foreground">
                                    No active relationships to other tables.
                                </p>
                            )}
                        </Section>
                    </>
                ) : null}
            </m.div>
        </m.div>
    );
}
