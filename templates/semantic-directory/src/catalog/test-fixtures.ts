//-----------------------------------------------------------------------
// Semantic Directory — shared test fixtures for catalog-derived logic.
//
// Tiny factories that build just enough of a CatalogModel to exercise the pure
// analysis modules (path-finder, impact, health). Everything is `as`-cast to
// keep fixtures to the fields under test, matching the repo's spec style.
//-----------------------------------------------------------------------

import type {
    CatalogModel,
    ColumnMeta,
    MeasureMeta,
    RelationshipMeta,
    TableMeta,
} from "./model/types";
import { columnKey, measureKey, tableKey } from "./model/types";

export function tbl(
    name: string,
    partial: Partial<TableMeta> = {},
): TableMeta {
    return {
        kind: "table",
        key: tableKey(name),
        name,
        displayName: name,
        isHidden: false,
        columnCount: 0,
        measureCount: 0,
        synonyms: [],
        tags: [],
        ...partial,
    } as TableMeta;
}

export function col(
    table: string,
    column: string,
    partial: Partial<ColumnMeta> = {},
): ColumnMeta {
    return {
        kind: "column",
        key: columnKey(table, column),
        name: column,
        displayName: column,
        table,
        ref: `'${table}'[${column}]`,
        isHidden: false,
        isDimensionLike: true,
        synonyms: [],
        tags: [],
        ...partial,
    } as ColumnMeta;
}

export function meas(
    name: string,
    partial: Partial<MeasureMeta> = {},
): MeasureMeta {
    return {
        kind: "measure",
        key: measureKey(name),
        name,
        displayName: name,
        table: "Measures",
        isHidden: false,
        synonyms: [],
        tags: [],
        ...partial,
    } as MeasureMeta;
}

export function rel(
    fromTable: string,
    fromColumn: string,
    toTable: string,
    toColumn: string,
    partial: Partial<RelationshipMeta> = {},
): RelationshipMeta {
    return {
        id: `${fromTable}.${fromColumn}->${toTable}.${toColumn}`,
        isActive: true,
        crossFilter: "OneDirection",
        fromTable,
        fromColumn,
        fromCardinality: "Many",
        toTable,
        toColumn,
        toCardinality: "One",
        ...partial,
    };
}

export function catalog(partial: Partial<CatalogModel> = {}): CatalogModel {
    return {
        snapshotAt: "2025-01-01T00:00:00.000Z",
        origin: "live",
        measures: [],
        columns: [],
        tables: [],
        relationships: [],
        coverage: {} as CatalogModel["coverage"],
        synonyms: {},
        ...partial,
    } as CatalogModel;
}
