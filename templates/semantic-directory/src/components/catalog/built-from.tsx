//-----------------------------------------------------------------------
// Semantic Directory — "Built from" (DAX recipe + lineage).
//
// Pillar 1 (Measure DNA) + Pillar 3 (Real lineage): shows in plain English
// what a measure does and the real building blocks it's assembled from —
// child measures, the columns/tables it reads, and the source systems those
// tables ultimately come from. All derived deterministically from the parsed
// DAX (see model/dax-explain + model/dax-parse). No AI.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { Sigma, Table2, Database, ArrowRight } from "lucide-react";
import type { CatalogModel, MeasureMeta, SourceSystem } from "@/catalog/model/types";
import { explainDax, TRAIT_HELP } from "@/catalog/model/dax-explain";
import { memoByCatalog } from "@/catalog/memo";
import { chipPop, listContainer } from "@/lib/motion";
import { Section, Pill } from "./panel-ui";
import { Pressable } from "@/components/ui/pressable";

/** name → key table lookup, built once per catalog (not per render). */
const tableKeyByNameOf = memoByCatalog(
    (catalog: CatalogModel) =>
        new Map(catalog.tables.map((t) => [t.name.toLowerCase(), t.key])),
);

export function BuiltFrom({
    catalog,
    measure,
    onSelectMeasure,
    onSelectTable,
}: {
    catalog: CatalogModel;
    measure: MeasureMeta;
    onSelectMeasure: (key: string) => void;
    onSelectTable: (key: string) => void;
}) {
    const recipe = explainDax(catalog, measure);
    const systems = (measure.sourceSystems ?? [])
        .map((id) => catalog.sourceSystems?.find((s) => s.id === id))
        .filter((s): s is SourceSystem => !!s);
    const tableKeyByName = tableKeyByNameOf(catalog);

    if (!recipe.hasDax && systems.length === 0) return null;

    return (
        <Section title="Built from" hint="how this number is assembled">
            {recipe.traits.length ? (
                <m.div
                    variants={listContainer}
                    initial="hidden"
                    animate="show"
                    className="mb-m flex flex-wrap gap-s"
                >
                    {recipe.traits.map((t) => (
                        <m.span key={t} variants={chipPop} title={TRAIT_HELP[t] ?? t} className="inline-flex cursor-help items-center gap-xs rounded-full border border-primary/25 bg-primary/10 px-m py-xs text-200 font-medium text-primary">
                            <Sigma className="icon-size-100" strokeWidth={2} aria-hidden />
                            {t}
                        </m.span>
                    ))}
                </m.div>
            ) : null}

            {recipe.childMeasures.length ? (
                <div className="mb-m">
                    <p className="mb-xs text-100 text-muted-foreground">Combines these measures</p>
                    <div className="flex flex-wrap gap-s">
                        {recipe.childMeasures.map((c) => (
                            <Pill key={c.key} tone="measure" onClick={() => onSelectMeasure(c.key)}>
                                {c.name}
                            </Pill>
                        ))}
                    </div>
                </div>
            ) : null}

            {recipe.columnsByTable.length ? (
                <div className="mb-m">
                    <p className="mb-xs text-100 text-muted-foreground">Reads these fields</p>
                    <div className="flex flex-col gap-xs">
                        {recipe.columnsByTable.slice(0, 6).map((grp) => {
                            const tKey = tableKeyByName.get(grp.table.toLowerCase());
                            return (
                                <div key={grp.table} className="flex flex-wrap items-center gap-xs text-200">
                                    <Pressable
                                        variant="control"
                                        disabled={!tKey}
                                        onClick={() => tKey && onSelectTable(tKey)}
                                        className="inline-flex items-center gap-xs rounded-md px-xs py-xxs font-medium text-foreground enabled:hover:bg-accent disabled:cursor-default disabled:opacity-[var(--disabled-opacity)]"
                                    >
                                        <Table2 className="icon-size-100 text-[color:var(--hue-table)]" strokeWidth={2} aria-hidden />
                                        {grp.table}
                                    </Pressable>
                                    <span className="text-muted-foreground">
                                        {grp.columns.slice(0, 5).join(", ")}
                                        {grp.columns.length > 5 ? ` +${grp.columns.length - 5}` : ""}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {systems.length ? (
                <div>
                    <p className="mb-xs text-100 text-muted-foreground">Sourced from</p>
                    <div className="flex flex-wrap items-center gap-s">
                        {systems.map((s, i) => (
                            <div key={s.id} className="flex items-center gap-s">
                                <span
                                    title={s.what}
                                    className="inline-flex items-center gap-xs rounded-lg border border-border bg-secondary px-m py-xs text-200 font-medium text-foreground"
                                >
                                    <Database className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                                    {s.label}
                                </span>
                                {i < systems.length - 1 ? (
                                    <ArrowRight className="icon-size-100 text-muted-foreground" aria-hidden />
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </Section>
    );
}
