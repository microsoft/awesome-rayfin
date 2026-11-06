import type { Bindings, VisualKind } from "./types";
/** Spaltenreferenz mit korrekt maskiertem Tabellennamen: col("Pipeline Status", "Sort Order"). */
export declare function col(table: string, column: string): string;
export type DaxValue = string | number | boolean | Date | null;
export interface DaxFilter {
    column: string;
    /** Werteliste (TREATAS). */
    values: DaxValue[];
}
export interface DaxOptions {
    /** feste Filter und Querfilter aus der App (Auswahl in anderen Visuals) */
    filters?: DaxFilter[];
    /** Sortierspalte je gruppierender Spalte, z. B. Monatsname → Monatsnummer (wie „Nach Spalte sortieren"). */
    sortBy?: Record<string, string>;
    /** Elemente ohne Daten behalten (ADDMISSINGITEMS), z. B. Summen- und Formelzeilen der GuV. */
    showItemsWithNoData?: boolean;
}
export interface DaxQuery {
    query: string;
    /** Rollenbindung auf die Spalten des Abfrageergebnisses, direkt für mountVisual. */
    bindings: Bindings;
    /** Anzeigename je Measure-Spalte (`[actual]` → `Umsatz AC`), direkt für mountVisual. */
    displayNames: Record<string, string>;
}
export declare function daxLiteral(v: DaxValue): string;
export declare function daxQuery(kind: VisualKind, bindings: Bindings, opts?: DaxOptions): DaxQuery;
