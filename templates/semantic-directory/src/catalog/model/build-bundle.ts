//-----------------------------------------------------------------------
// Semantic Directory — build a CatalogModel from the bundled demo brain.
//
// This is the offline-capable counterpart to merge-enrichment.buildCatalog
// (which builds from live DAX queries). It assembles the FULL experience from
// the committed demo dataset (Contoso Sales): descriptions, DAX, dependency
// graph, measure families, source-system lineage and the trust layer. It powers
// the zero-setup DEMO mode and doubles as the "never blank" fallback when a
// configured live model is unreachable.
//
// Deterministic + offline. No AI.
//-----------------------------------------------------------------------

import { dataset } from "../data/types";
import type { CatalogDataset } from "../data/types";
import type {
    AdoptionSummary,
    CatalogModel,
    ColumnMeta,
    EnrichmentFile,
    GlossaryTerm,
    MeasureMeta,
    RelationshipMeta,
    SourceSystem,
    TableMeta,
} from "./types";
import { columnKey, measureKey, normName, tableKey } from "./types";
import { applyEnrichment, computeCoverage } from "./merge-enrichment";
import { parseDax } from "./dax-parse";
import { buildFamilies } from "./families";
import {
    resolveReverseDependencies,
    resolveSourceSystems,
    resolveTransitiveTables,
} from "./lineage-graph";
import { applyTrust, buildSystemTrust } from "./trust";
import { applyStructure } from "./structure";

function normalizeBundleMeasure(m: CatalogDataset["measures"][number]): MeasureMeta {
    return {
        key: measureKey(m.name),
        kind: "measure",
        name: m.name,
        displayName: m.name,
        table: m.table,
        description: m.description ?? undefined,
        descriptionFromEnrichment: false,
        topic: m.folder ?? undefined,
        displayFolder: m.folder ?? undefined,
        emoji: undefined,
        isHidden: m.hidden,
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: undefined,
        formatString: m.format ?? undefined,
        dataType: undefined,
        shows: undefined,
        dax: m.dax ?? undefined,
        sources: m.sources,
        stewardPending: m.stewardPending,
        dependsOnMeasures: [],
        dependsOnColumns: [],
        usesTables: [],
        usedByMeasures: [],
        sourceSystems: [],
    };
}

function normalizeBundleColumn(c: CatalogDataset["columns"][number]): ColumnMeta {
    return {
        key: columnKey(c.table, c.name),
        kind: "column",
        name: c.name,
        displayName: c.name,
        table: c.table,
        ref: `'${c.table}'[${c.name}]`,
        description: c.description ?? undefined,
        descriptionFromEnrichment: false,
        topic: c.folder ?? undefined,
        displayFolder: c.folder ?? undefined,
        emoji: undefined,
        isHidden: c.hidden,
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: undefined,
        dataType: c.type ?? undefined,
        formatString: undefined,
        summarizeBy: undefined,
        isDimensionLike: false,
        category: c.category ?? undefined,
        usedByMeasures: [],
    };
}

function normalizeBundleTable(t: CatalogDataset["tables"][number]): TableMeta {
    return {
        key: tableKey(t.name),
        kind: "table",
        name: t.name,
        displayName: t.name,
        description: t.description ?? undefined,
        descriptionFromEnrichment: false,
        topic: undefined,
        displayFolder: undefined,
        emoji: undefined,
        isHidden: t.hidden,
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: undefined,
        dataCategory: undefined,
        storageMode: t.storageMode ?? undefined,
        columnCount: 0,
        measureCount: 0,
        physicalSource: t.physicalSource ?? undefined,
        sourceSystem: t.sourceSystem ?? undefined,
    };
}

function normalizeBundleRelationship(
    r: CatalogDataset["relationships"][number],
    index: number,
): RelationshipMeta {
    return {
        id: `rel-${index}`,
        isActive: r.active,
        crossFilter: r.crossFilter,
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        fromCardinality: r.fromCardinality,
        toTable: r.toTable,
        toColumn: r.toColumn,
        toCardinality: r.toCardinality,
    };
}

function toAdoption(a: CatalogDataset["adoption"]): AdoptionSummary {
    return {
        workspaceUsers: a.workspace_totals.distinct_users,
        workspaceViews: a.workspace_totals.total_views,
        modelUsers: a.model_totals.distinct_users,
        modelViews: a.model_totals.total_views,
        topReports: a.top_reports.map((r) => ({
            report: r.report,
            views: r.views,
            users: r.users,
            kind: r.kind,
        })),
    };
}

/**
 * Assemble the full CatalogModel from the bundled brain + curated enrichment.
 */
export function buildCatalogFromBundle(
    enrichment: EnrichmentFile,
    data: CatalogDataset = dataset,
): CatalogModel {
    const measures = data.measures.map(normalizeBundleMeasure);
    const columns = data.columns.map(normalizeBundleColumn);
    const tables = data.tables.map(normalizeBundleTable);
    const relationships = data.relationships.map(normalizeBundleRelationship);

    // --- Relationship participation (drives dimension detection) ---
    const relColumnKeys = new Set<string>();
    for (const r of relationships) {
        relColumnKeys.add(columnKey(r.fromTable, r.fromColumn));
        relColumnKeys.add(columnKey(r.toTable, r.toColumn));
    }

    // --- Overlay curated enrichment (friendly names, emoji, topics, synonyms) ---
    const eMeasures = enrichment.measures ?? {};
    const eColumns = enrichment.columns ?? {};
    const eTables = enrichment.tables ?? {};
    for (const m of measures) applyEnrichment(m, eMeasures[m.key]);
    for (const c of columns) {
        applyEnrichment(c, eColumns[c.key]);
        c.isDimensionLike = !c.isHidden
            && (relColumnKeys.has(c.key)
                || (c.category ?? "").toLowerCase() !== "rownumber");
    }
    for (const t of tables) applyEnrichment(t, eTables[t.key]);

    // --- Dependency graph from DAX ---
    const knownMeasures = new Set(measures.map((m) => normName(m.name)));
    const knownTables = new Set(tables.map((t) => normName(t.name)));
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

    // --- Real source-system lineage ---
    resolveSourceSystems(measures, tables);

    // --- Families ---
    const families = buildFamilies(measures);

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
    for (const t of tables) {
        const k = normName(t.name);
        t.columnCount = columnsByTable.get(k) ?? 0;
        t.measureCount = measuresByTable.get(k) ?? 0;
    }

    // --- Trust layer ---
    const sourceSystems: SourceSystem[] = data.sourceSystems.map((s) => ({
        id: s.id,
        label: s.label,
        what: s.what,
        confidence: s.confidence,
        tableCount: 0,
        measureCount: 0,
    }));
    const systemTrust = buildSystemTrust(data.freshness, data.qaTieOut);
    applyTrust(measures, tables, sourceSystems, systemTrust);
    // Only surface source systems that actually back model content.
    const activeSystems = sourceSystems
        .filter((s) => s.tableCount > 0 || s.measureCount > 0)
        .sort((a, b) => b.measureCount - a.measureCount || b.tableCount - a.tableCount);

    const glossary: GlossaryTerm[] = data.glossary.map((g) => ({
        term: g.term,
        meaning: g.meaning,
        confidence: g.confidence,
        category: g.category,
        aliases: g.aliases,
    }));

    const coverage = computeCoverage(
        measures,
        columns,
        tables,
        relationships.length,
        enrichment,
    );

    const model: CatalogModel = {
        snapshotAt: data.generatedAt,
        origin: "bundled",
        measures,
        columns,
        tables,
        relationships,
        coverage,
        synonyms: enrichment.synonyms ?? {},
        families,
        sourceSystems: activeSystems,
        glossary,
        freshness: data.freshness,
        adoption: toAdoption(data.adoption),
        brainSource: {
            model: data.source.model,
            workspace: data.source.workspace,
            capturedUtc: data.source.capturedUtc,
        },
    };

    // --- Model-agnostic structure (ontology, hub rank, Direct Lake) ---
    applyStructure(model);

    return model;
}
