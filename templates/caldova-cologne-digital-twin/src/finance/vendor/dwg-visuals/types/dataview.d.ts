import type { Bindings, QueryTable, VisualKind, VisualObjects } from "./types";
/** `'Kalender'[Monat]` → `Kalender[Monat]` (so heißen die Spalten im Abfrageergebnis). */
export declare function normalizeRef(ref: string): string;
/** `Kalender[Monat]` → `Monat`, `[AC]` → `AC`. */
export declare function bareName(ref: string): string;
export declare function columnIndex(table: QueryTable, ref: string): number;
export interface DataViewOptions {
    objects?: VisualObjects;
    formats?: Record<string, string>;
    displayNames?: Record<string, string>;
}
interface Source {
    displayName: string;
    queryName: string;
    roles: Record<string, boolean>;
    index: number;
    isMeasure?: boolean;
    format?: string;
}
export declare function buildDataView(kind: VisualKind, table: QueryTable, bindings: Bindings, opts?: DataViewOptions): {
    metadata: {
        columns: Source[];
        objects: VisualObjects;
    };
    categorical: {
        categories: {
            source: Source;
            values: unknown[];
        }[];
        values: {
            source: Source;
            values: (number | null)[];
        }[];
    };
};
export {};
