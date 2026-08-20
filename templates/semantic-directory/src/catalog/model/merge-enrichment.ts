//-----------------------------------------------------------------------
// Semantic Directory — merge live metadata with the enrichment overlay.
//
// buildCatalog() is the single entry point the runtime hook calls. It:
//   1. parses the four metadata QueryTables into typed rows,
//   2. normalizes them into *Meta entities (live-only),
//   3. overlays curated enrichment (friendly names, descriptions, topics...),
//   4. derives cross-entity facts (dimension detection, per-table counts),
//   5. computes coverage/diagnostics.
//-----------------------------------------------------------------------

import type { QueryTable } from "@microsoft/fabric-app-data";
import { rowsToObjects } from "@/lib/rows-to-objects";
import type {
    CatalogModel,
    ColumnMeta,
    Coverage,
    EnrichmentEntry,
    EnrichmentFile,
    MeasureMeta,
    RawColumnRow,
    RawMeasureRow,
    RawRelationshipRow,
    RawTableRow,
    TableMeta,
} from "./types";
import { columnKey, normName } from "./types";
import {
    normalizeColumn,
    normalizeMeasure,
    normalizeRelationship,
    normalizeTable,
} from "./normalize";
import { parseDax } from "./dax-parse";
import { buildFamilies } from "./families";
import { applyStructure } from "./structure";
import {
    resolveReverseDependencies,
    resolveSourceSystems,
    resolveTransitiveTables,
} from "./lineage-graph";

export interface MetadataTables {
    measures: QueryTable;
    tables: QueryTable;
    columns: QueryTable;
    relationships: QueryTable;
}

/** Merge a curated enrichment entry into a base entity (in place). */
export function applyEnrichment<T extends MeasureMeta | ColumnMeta | TableMeta>(
    entity: T,
    entry: EnrichmentEntry | undefined,
): void {
    if (!entry) return;
    entity.enriched = true;
    if (entry.friendlyName) entity.displayName = entry.friendlyName;
    // Live model description wins when present; otherwise use enrichment.
    if (!entity.description && entry.description) {
        entity.description = entry.description;
        entity.descriptionFromEnrichment = true;
    }
    if (entry.businessTopic) entity.topic = entry.businessTopic;
    if (entry.emoji) entity.emoji = entry.emoji;
    if (entry.synonyms?.length) entity.synonyms = dedupe(entry.synonyms);
    if (entry.tags?.length) entity.tags = dedupe(entry.tags);
    if (entry.exampleQuestions?.length) {
        entity.exampleQuestions = entry.exampleQuestions.slice();
    }
    if (entity.kind === "measure" && entry.shows) {
        (entity as MeasureMeta).shows = entry.shows;
    }
}

function dedupe(values: string[]): string[] {
    return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function buildCatalog(
    tables: MetadataTables,
    enrichment: EnrichmentFile,
): CatalogModel {
    const measureRows = rowsToObjects<RawMeasureRow>(tables.measures);
    const tableRows = rowsToObjects<RawTableRow>(tables.tables);
    const columnRows = rowsToObjects<RawColumnRow>(tables.columns);
    const relRows = rowsToObjects<RawRelationshipRow>(tables.relationships);

    const measures = measureRows.map(normalizeMeasure);
    const columns = columnRows.map(normalizeColumn);
    const tableMetas = tableRows.map(normalizeTable);
    const relationships = relRows.map(normalizeRelationship);

    // --- Relationship participation (drives dimension detection) ---
    const relColumnKeys = new Set<string>();
    for (const r of relationships) {
        relColumnKeys.add(columnKey(r.fromTable, r.fromColumn));
        relColumnKeys.add(columnKey(r.toTable, r.toColumn));
    }

    // --- Overlay enrichment ---
    const eMeasures = enrichment.measures ?? {};
    const eColumns = enrichment.columns ?? {};
    const eTables = enrichment.tables ?? {};
    for (const m of measures) applyEnrichment(m, eMeasures[m.key]);
    for (const c of columns) {
        applyEnrichment(c, eColumns[c.key]);
        c.isDimensionLike = !c.isHidden
            && (relColumnKeys.has(c.key)
                || (c.summarizeBy ?? "").toLowerCase() === "none");
    }
    for (const t of tableMetas) applyEnrichment(t, eTables[t.key]);

    // --- Per-table counts ---
    const columnsByTable = new Map<string, number>();
    const measuresByTable = new Map<string, number>();
    for (const c of columns) {
        const k = normName(c.table);
        columnsByTable.set(k, (columnsByTable.get(k) ?? 0) + 1);
    }
    for (const m of measures) {
        const k = normName(m.table);
        measuresByTable.set(k, (measuresByTable.get(k) ?? 0) + 1);
    }
    for (const t of tableMetas) {
        const k = normName(t.name);
        t.columnCount = columnsByTable.get(k) ?? 0;
        t.measureCount = measuresByTable.get(k) ?? 0;
    }

    // --- Live dependency graph (Measure DNA + lineage, no bundle required) ---
    // Parse each measure's real DAX into measure/column/table edges, then roll
    // up reverse dependencies, source systems and families. Every edge traces
    // to a token in the live DAX, so this stays deterministic and explainable
    // for ANY model — this is what makes the template plug-and-play.
    const knownMeasures = new Set(measures.map((m) => normName(m.name)));
    const knownTables = new Set(tableMetas.map((t) => normName(t.name)));
    for (const m of measures) {
        const refs = parseDax(m.dax, knownMeasures, knownTables);
        m.dependsOnMeasures = refs.measures;
        m.dependsOnColumns = refs.columns;
        m.usesTables = refs.tables;
    }
    // Roll table usage through measure-to-measure dependencies so wrapper /
    // time-intelligence measures inherit the real tables they are built from.
    resolveTransitiveTables(measures);
    const columnUsedBy = new Map<string, string[]>();
    resolveReverseDependencies(measures, columnUsedBy);
    for (const c of columns) {
        const used = columnUsedBy.get(normName(c.ref));
        c.usedByMeasures = used ? Array.from(new Set(used)).sort() : [];
    }
    // Source systems roll up from any physical-source map on the tables; with a
    // pure-live model there is none, so this simply yields empty sets (graceful).
    resolveSourceSystems(measures, tableMetas);
    const families = buildFamilies(measures);

    const coverage = computeCoverage(
        measures,
        columns,
        tableMetas,
        relationships.length,
        enrichment,
    );

    const model: CatalogModel = {
        snapshotAt: new Date().toISOString(),
        origin: "live",
        measures,
        columns,
        tables: tableMetas,
        relationships,
        coverage,
        families,
        synonyms: enrichment.synonyms ?? {},
    };

    // --- Model-agnostic structure (ontology, hub rank, Direct Lake) ---
    applyStructure(model);

    return model;
}

export function computeCoverage(
    measures: MeasureMeta[],
    columns: ColumnMeta[],
    tableMetas: TableMeta[],
    relationshipCount: number,
    enrichment: EnrichmentFile,
): Coverage {
    const liveKeys = new Set<string>();
    for (const m of measures) liveKeys.add(m.key);
    for (const c of columns) liveKeys.add(c.key);
    for (const t of tableMetas) liveKeys.add(t.key);

    const enrichmentKeys = [
        ...Object.keys(enrichment.measures ?? {}),
        ...Object.keys(enrichment.columns ?? {}),
        ...Object.keys(enrichment.tables ?? {}),
    ];
    const orphanEnrichmentKeys = enrichmentKeys.filter((k) => !liveKeys.has(k));

    const visibleMeasures = measures.filter((m) => !m.isHidden);
    const needsDescription = visibleMeasures
        .filter((m) => !m.description)
        .map((m) => m.name);

    return {
        measureCount: measures.length,
        measureVisible: visibleMeasures.length,
        measureEnriched: measures.filter((m) => m.enriched).length,
        measureDescribed: measures.filter((m) => !!m.description).length,
        columnCount: columns.length,
        tableCount: tableMetas.length,
        tableVisible: tableMetas.filter((t) => !t.isHidden).length,
        relationshipCount,
        orphanEnrichmentKeys,
        needsDescription,
    };
}
