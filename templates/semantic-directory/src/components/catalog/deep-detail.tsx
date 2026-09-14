//-----------------------------------------------------------------------
// Semantic Directory — deep detail (Level 3, on demand).
//
// The full story, revealed only when the user clicks "Go deeper" on the glance
// card. Tabs keep it from becoming a long vertical scroll: each tab reuses an
// existing pillar surface (Built from, Slice by, the trust cards, family) in a
// tight two-column grid. Adapts its tabs to the entity kind.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { m } from "framer-motion";
import type { CatalogModel, MeasureMeta, ColumnMeta, TableMeta } from "@/catalog/model/types";
import { normName } from "@/catalog/model/types";
import { tableNeighbors, columnRollUp } from "@/catalog/lineage/relationships";
import { recommendSlices } from "@/catalog/lineage/slice-recommender";
import { questionsForMeasure } from "@/catalog/questions/generate";
import { sectionReveal, pressSpring } from "@/lib/motion";
import type { CatalogEntity } from "./entity-detail";
import { Section, Pill, StatChip } from "./panel-ui";
import { BuiltFrom } from "./built-from";
import { FamilyStrip } from "./family-strip";
import { SliceBy } from "./slice-by";
import { LineageStrip } from "./lineage-strip";
import { TableRowPreview } from "./table-row-preview";
import { ColumnMembersPanel } from "./column-members-panel";
import { ImpactPanel } from "./impact-panel";

interface DeepDetailProps {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onNavigate: (key: string) => void;
    /** Hand off to the standalone Impact tool, seeded on an entity. */
    onOpenImpact?: (key: string) => void;
}

/** Space-free, lowercase token so tab labels ("Slice by") make valid DOM ids. */
const tabSlug = (label: string) => label.replace(/\s+/g, "-").toLowerCase();

export function DeepDetail({ entity, catalog, onNavigate, onOpenImpact }: DeepDetailProps) {
    const tabs = useMemo(() => {
        if (entity.kind === "measure") return ["Overview", "Slice by", "Formula", "Impact", "Questions"];
        if (entity.kind === "table") return ["Overview", "Connections", "Fields"];
        return ["Overview", "Used by", "Impact", "Values"];
    }, [entity.kind]);
    const [tab, setTab] = useState(tabs[0]);
    // Keep the active tab valid when the entity kind changes (render-phase guard,
    // React's supported derived-state pattern — avoids a stale, blank tab).
    if (!tabs.includes(tab)) setTab(tabs[0]);

    const measure = entity.kind === "measure" ? (entity as MeasureMeta) : undefined;
    const table = entity.kind === "table" ? (entity as TableMeta) : undefined;
    const column = entity.kind === "column" ? (entity as ColumnMeta) : undefined;

    const rec = useMemo(
        () => (measure ? recommendSlices(catalog, measure) : undefined),
        [measure, catalog],
    );
    const questions = useMemo(
        () => (measure ? questionsForMeasure(catalog, measure) : []),
        [measure, catalog],
    );
    const neighbors = useMemo(
        () => (table ? tableNeighbors(catalog, table.name) : []),
        [table, catalog],
    );
    const rollUp = useMemo(
        () => (column ? columnRollUp(catalog, column) : []),
        [column, catalog],
    );
    const columnMeasures = useMemo(() => {
        if (!column) return [];
        const byName = new Map(catalog.measures.map((mm) => [normName(mm.name), mm]));
        return (column.usedByMeasures ?? [])
            .map((n) => byName.get(normName(n)))
            .filter((x): x is MeasureMeta => Boolean(x) && !x!.isHidden);
    }, [column, catalog]);
    const tableColumns = useMemo(
        () =>
            table
                ? catalog.columns.filter(
                      (c) => normName(c.table) === normName(table.name) && !c.isHidden,
                  )
                : [],
        [table, catalog],
    );

    return (
        <div className="flex flex-col gap-l">
            {tabs.length > 1 ? (
                <div className="sticky top-0 z-20 -mt-xs bg-card pt-xs pb-xs">
                    <div role="tablist" aria-label="Detail views" className="flex flex-wrap gap-xs rounded-2xl border border-border bg-secondary p-xxs sm:rounded-full">
                    {tabs.map((t, i) => (
                        <m.button
                            key={t}
                            id={`deep-tab-${tabSlug(t)}`}
                            role="tab"
                            aria-selected={tab === t}
                            aria-controls="deep-tabpanel"
                            tabIndex={tab === t ? 0 : -1}
                            type="button"
                            onClick={() => setTab(t)}
                            whileTap={{ scale: 0.94 }}
                            transition={pressSpring}
                            onKeyDown={(e) => {
                                let next = i;
                                if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
                                else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
                                else if (e.key === "Home") next = 0;
                                else if (e.key === "End") next = tabs.length - 1;
                                else return;
                                e.preventDefault();
                                setTab(tabs[next]);
                                const sibling = e.currentTarget.parentElement?.children[next];
                                if (sibling instanceof HTMLElement) sibling.focus();
                            }}
                            className={`relative rounded-full px-l py-xs text-200 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-secondary ${
                                tab === t ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {tab === t ? (
                                <m.span
                                    layoutId="deep-tab"
                                    className="absolute inset-0 rounded-full bg-primary shadow-[var(--glow)]"
                                    transition={{ type: "spring", stiffness: 480, damping: 34 }}
                                />
                            ) : null}
                            <span className="relative z-10">{t}</span>
                        </m.button>
                    ))}
                    </div>
                </div>
            ) : null}

            <m.div
                role="tabpanel"
                id="deep-tabpanel"
                aria-labelledby={`deep-tab-${tabSlug(tab)}`}
                tabIndex={0}
                variants={sectionReveal}
                initial="hidden"
                animate="show"
                className="flex w-full max-w-5xl flex-col gap-l focus-visible:outline-none"
            >
                {/* MEASURE */}
                {measure && tab === "Overview" ? (
                    <>
                        <Section title="Full lineage" hint="source → this measure → what it feeds">
                            <LineageStrip entity={entity} catalog={catalog} onNavigate={onNavigate} />
                        </Section>
                        <div className="grid grid-cols-1 gap-l xl:grid-cols-2">
                            <BuiltFrom catalog={catalog} measure={measure} onSelectMeasure={onNavigate} onSelectTable={onNavigate} />
                            <FamilyStrip catalog={catalog} measure={measure} onSelectMeasure={onNavigate} />
                        </div>
                    </>
                ) : null}
                {measure && tab === "Slice by" && rec ? (
                    <SliceBy rec={rec} onSelect={onNavigate} />
                ) : null}
                {measure && tab === "Formula" ? (
                    <Section title="Formula" hint="the exact DAX behind this measure">
                        {measure.dax?.trim() ? (
                            <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-secondary/60 p-m font-monospace text-100 leading-300 text-foreground">
                                {measure.dax}
                            </pre>
                        ) : (
                            <p className="text-200 text-muted-foreground">
                                No DAX expression is available for this measure.
                            </p>
                        )}
                    </Section>
                ) : null}
                {measure && tab === "Impact" ? (
                    <ImpactPanel catalog={catalog} entity={measure} onNavigate={onNavigate} onOpenFull={onOpenImpact} />
                ) : null}
                {measure && tab === "Questions" ? (
                    <Section title="Questions it can answer">
                        {questions.length ? (
                            <ul className="flex flex-col gap-s">
                                {questions.map((q) => (
                                    <li key={q} className="rounded-lg border border-border bg-secondary px-m py-s text-300 text-foreground">
                                        {q}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-200 text-muted-foreground">Add example questions via enrichment.</p>
                        )}
                    </Section>
                ) : null}

                {/* TABLE */}
                {table && tab === "Overview" ? (
                    <>
                        <Section title="Full lineage" hint="joins in → this table → measures it hosts">
                            <LineageStrip entity={entity} catalog={catalog} onNavigate={onNavigate} />
                        </Section>
                        <Section title="Structure">
                        <div className="flex flex-wrap gap-s">
                            <StatChip value={table.columnCount} label="columns" />
                            <StatChip value={table.measureCount} label="measures" />
                            {table.sourceSystem ? <StatChip value={table.sourceSystem} label="source system" /> : null}
                        </div>
                        {table.physicalSource ? (
                            <p className="mt-s text-100 text-muted-foreground">Physical source · {table.physicalSource}</p>
                        ) : null}
                    </Section>
                        <Section title="Sample rows" hint="a live peek at what this table holds">
                            {tableColumns.length ? (
                                <TableRowPreview tableName={table.name} columns={tableColumns} />
                            ) : (
                                <p className="text-100 text-muted-foreground">
                                    No visible columns to preview.
                                </p>
                            )}
                        </Section>
                    </>
                ) : null}
                {table && tab === "Connections" ? (
                    <Section title="Connects to">
                        {neighbors.length ? (
                            <div className="flex flex-wrap gap-s">
                                {neighbors.map((t) => (
                                    <Pill key={t} tone="table">{t}</Pill>
                                ))}
                            </div>
                        ) : (
                            <p className="text-200 text-muted-foreground">No active relationships to other tables.</p>
                        )}
                    </Section>
                ) : null}
                {table && tab === "Fields" ? (
                    <Section title="Fields" hint="every column in this table — click any to explore">
                        {tableColumns.length ? (
                            <div className="flex flex-wrap gap-s">
                                {tableColumns.map((c) => (
                                    <Pill key={c.key} tone="column" onClick={() => onNavigate(c.key)}>
                                        {c.emoji ? <span aria-hidden>{c.emoji}</span> : null}
                                        {c.displayName}
                                    </Pill>
                                ))}
                            </div>
                        ) : (
                            <p className="text-200 text-muted-foreground">No visible columns in this table.</p>
                        )}
                    </Section>
                ) : null}

                {/* COLUMN / DIMENSION */}
                {column && tab === "Overview" ? (
                    <>
                        <Section title="Full lineage" hint="home table → this field → measures that read it">
                            <LineageStrip entity={entity} catalog={catalog} onNavigate={onNavigate} />
                        </Section>
                        <Section title="Rolls up to">
                            {rollUp.length ? (
                                <div className="flex flex-wrap gap-s">
                                    {rollUp.map((t) => (
                                        <Pill key={t} tone="table">{t}</Pill>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-200 text-muted-foreground">
                                    This field is a top-level dimension — nothing rolls up above it.
                                </p>
                            )}
                        </Section>
                    </>
                ) : null}
                {column && tab === "Used by" ? (
                    <Section title="Measures that use this field" hint="break these down by this dimension">
                        {columnMeasures.length ? (
                            <div className="flex flex-wrap gap-s">
                                {columnMeasures.map((mm) => (
                                    <Pill key={mm.key} tone="measure" onClick={() => onNavigate(mm.key)}>
                                        {mm.emoji ? <span aria-hidden>{mm.emoji}</span> : null}
                                        {mm.displayName}
                                    </Pill>
                                ))}
                            </div>
                        ) : (
                            <p className="text-200 text-muted-foreground">
                                No measures reference this field yet — use it as a slicer or grouping in a report.
                            </p>
                        )}
                    </Section>
                ) : null}
                {column && tab === "Impact" ? (
                    <ImpactPanel catalog={catalog} entity={column} onNavigate={onNavigate} onOpenFull={onOpenImpact} />
                ) : null}
                {column && tab === "Values" ? (
                    <Section title="What's inside" hint="the members of this field, live from the model">
                        <ColumnMembersPanel column={column} />
                    </Section>
                ) : null}
            </m.div>
        </div>
    );
}
