//-----------------------------------------------------------------------
// Semantic Directory — normalize raw metadata rows into catalog entities.
//
// This layer is LIVE-ONLY: it maps the DAX query output into *Meta entities
// with enrichment fields left at neutral defaults. The enrichment overlay and
// cross-entity derivations (dimension detection, counts, coverage) are applied
// in merge-enrichment.ts.
//-----------------------------------------------------------------------

import { bool, str } from "@/lib/rows-to-objects";
import type {
    ColumnMeta,
    MeasureMeta,
    RawColumnRow,
    RawMeasureRow,
    RawRelationshipRow,
    RawTableRow,
    RelationshipMeta,
    TableMeta,
} from "./types";
import { columnKey, measureKey, tableKey } from "./types";

export function normalizeMeasure(row: RawMeasureRow): MeasureMeta {
    const name = String(row.Measure);
    const description = str(row.Description);
    const displayFolder = str(row.DisplayFolder);
    return {
        key: measureKey(name),
        kind: "measure",
        name,
        displayName: name,
        table: String(row.Table),
        description,
        descriptionFromEnrichment: false,
        topic: displayFolder,
        displayFolder,
        emoji: undefined,
        isHidden: bool(row.IsHidden),
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: str(row.LineageTag),
        formatString: str(row.FormatString),
        dataType: str(row.DataType),
        dax: str(row.Expression),
        shows: undefined,
    };
}

export function normalizeColumn(row: RawColumnRow): ColumnMeta {
    const table = String(row.Table);
    const column = String(row.Column);
    const description = str(row.Description);
    const displayFolder = str(row.DisplayFolder);
    return {
        key: columnKey(table, column),
        kind: "column",
        name: column,
        displayName: column,
        table,
        ref: `'${table}'[${column}]`,
        description,
        descriptionFromEnrichment: false,
        topic: displayFolder,
        displayFolder,
        emoji: undefined,
        isHidden: bool(row.IsHidden),
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: str(row.LineageTag),
        dataType: str(row.DataType),
        formatString: str(row.FormatString),
        summarizeBy: str(row.SummarizeBy),
        category: str(row.DataCategory),
        // Derived in merge once relationships are known; safe default here.
        isDimensionLike: false,
    };
}

export function normalizeTable(row: RawTableRow): TableMeta {
    const name = String(row.Table);
    const description = str(row.Description);
    return {
        key: tableKey(name),
        kind: "table",
        name,
        displayName: name,
        description,
        descriptionFromEnrichment: false,
        topic: undefined,
        displayFolder: undefined,
        emoji: undefined,
        isHidden: bool(row.IsHidden),
        enriched: false,
        synonyms: [],
        tags: [],
        exampleQuestions: [],
        lineageTag: str(row.LineageTag),
        dataCategory: str(row.DataCategory),
        storageMode: str(row.StorageMode),
        columnCount: 0,
        measureCount: 0,
    };
}

export function normalizeRelationship(
    row: RawRelationshipRow,
    index: number,
): RelationshipMeta {
    return {
        id: str(row.RelationshipId) ?? `rel-${index}`,
        isActive: bool(row.IsActive),
        crossFilter: str(row.CrossFilteringBehavior) ?? "OneDirection",
        fromTable: String(row.FromTable),
        fromColumn: String(row.FromColumn),
        fromCardinality: str(row.FromCardinality) ?? "Many",
        toTable: String(row.ToTable),
        toColumn: String(row.ToColumn),
        toCardinality: str(row.ToCardinality) ?? "One",
    };
}
