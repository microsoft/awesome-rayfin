import type { Bindings, VisualKind } from "./types";
/** Spaltenreferenz mit korrekt maskiertem Tabellennamen: col("Pipeline Status", "Sort Order"). */
export declare function col(table: string, column: string): string;
export type DaxValue = string | number | boolean | Date | null;
/** Datentyp einer Spalte wie im TMDL (`dataType`): `dateTime`, `string`, `int64`, `double`, `decimal`, `boolean`. */
export type DaxColumnType = string;
export interface DaxFilter {
    column: string;
    /** Werteliste (TREATAS). */
    values: DaxValue[];
    /** Datentyp der Spalte, wenn bekannt (aus dem TMDL); entscheidet, ob ISO-Text ein Datum ist. */
    type?: DaxColumnType;
}
export interface DaxOptions {
    /** feste Filter und Querfilter aus der App (Auswahl in anderen Visuals) */
    filters?: DaxFilter[];
    /** Sortierspalte je gruppierender Spalte, z. B. Monatsname → Monatsnummer (wie „Nach Spalte sortieren"). */
    sortBy?: Record<string, string>;
    /**
     * Elemente ohne Daten behalten (ADDMISSINGITEMS), z. B. Summen- und Formelzeilen der GuV. Mit Filtern steht das
     * Ganze in CALCULATETABLE(…, Filter): ADDMISSINGITEMS füllt nur mit Elementen auf, die die Filter zulassen (sonst
     * kämen Perioden anderer Jahre oder Konten außerhalb eines Kachelfilters als leere Zeilen dazu).
     */
    showItemsWithNoData?: boolean;
}
export interface DaxQuery {
    query: string;
    /** Rollenbindung auf die Spalten des Abfrageergebnisses, direkt für mountVisual. */
    bindings: Bindings;
    /** Anzeigename je Measure-Spalte (`[actual]` → `Umsatz AC`), direkt für mountVisual. */
    displayNames: Record<string, string>;
}
/** `2026-03-01` oder `2026-03-01T10:30:00` → Date in Ortszeit, sonst null. */
export declare function parseIsoDate(s: string): Date | null;
/** Date → `2026-03-01T00:00:00` (Ortszeit, wie der Konnektor schreibt): ein Schlüssel je Zeitpunkt. */
export declare function isoDate(d: Date): string;
/**
 * Filterwert in die gemeinsame Form bringen: Datum als Date. Auf einer Spalte mit anderem bekanntem Typ bleibt
 * ISO-Text Text (und ein Date wird ISO-Text). Slicer-Werte, Querfilter und Spec-Filter laufen hier durch.
 */
export declare function filterValue(v: unknown, type?: DaxColumnType): DaxValue;
/** Schlüssel zum Vergleichen (Schnittmenge, Slicer-Auswahl): Datum über isoDate(), sonst Typ und Text. */
export declare function valueKey(v: unknown, type?: DaxColumnType): string;
/** DAX-Literal für einen Filterwert; `type` ist der Datentyp der Spalte, wenn bekannt. */
export declare function daxLiteral(v: DaxValue, type?: DaxColumnType): string;
export declare function daxQuery(kind: VisualKind, bindings: Bindings, opts?: DaxOptions): DaxQuery;
