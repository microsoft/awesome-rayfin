export type VisualKind = "chartkitchen" | "pnl";
/** Ergebnis einer Semantikmodell-Abfrage, wie es der Rayfin-Konnektor liefert (`data.table`). */
export interface QueryTable {
    columns: {
        name: string;
    }[];
    rows: unknown[][];
}
/**
 * Datenrolle des Visuals → Spalte im Abfrageergebnis. Rollen mit mehreren Feldern
 * (P&L `levels`, ChartKitchen `colgroup`) nehmen eine Liste.
 * Spaltennamen wie im Ergebnis (`Kalender[Monat]`, `[AC]`) oder nur der Name (`Monat`, `AC`).
 */
export type Bindings = Record<string, string | string[]>;
/** Formatbereich-Objekte, identisch zu `objects` in capabilities.json bzw. PBIR `visual.json`. */
export type VisualObjects = Record<string, Record<string, unknown>>;
/** Eine ausgewählte Zeile: Spaltenname → Wert der gruppierenden Rollen. */
export type SelectionKey = Record<string, unknown>;
export interface TooltipItem {
    displayName: string;
    value: string;
    color?: string;
    header?: string;
}
export interface MountOptions {
    visual: VisualKind;
    table: QueryTable;
    bindings: Bindings;
    objects?: VisualObjects;
    /** Formatstring je Spalte (z. B. `#,0 €`), weil Abfrageergebnisse keine Formate tragen. */
    formats?: Record<string, string>;
    /** Anzeigename je Spalte, sonst der Spaltenname ohne Tabelle. */
    displayNames?: Record<string, string>;
    /**
     * Datentyp je Spalte (TMDL `dataType`, z. B. `{ "'Kalender'[Datum]": "dateTime" }`). Abfrageergebnisse tragen
     * keine Typen: ohne Angabe wird ISO-Text zum Date, mit Angabe nur in dateTime-Spalten.
     */
    columnTypes?: Record<string, string>;
    /** `de-DE` (Standard), `en-US`, `es-ES`, `ja-JP`. */
    locale?: string;
    /** Hell oder dunkel. Dunkel übergibt dem Visual einen dunklen Berichtshintergrund. */
    theme?: "light" | "dark";
    /** Hintergrundfarbe im Dunkelmodus, Standard `#16191d`. */
    darkBackground?: string;
    /** false = Export-/Lesemodus ohne Klicks und In-Chart-Knöpfe. */
    interactive?: boolean;
    /** Auswahl im Visual (Klick, Strg+Klick). Leeres Array = Auswahl aufgehoben. */
    onSelect?(keys: SelectionKey[]): void;
    /** Das Visual hat Einstellungen geändert (Sortierung, Auf-/Zuklappen …). */
    onPersist?(objects: VisualObjects): void;
    /** Rechtsklick bzw. Drill-Knopf: Zeilen, für die ein Detail gewünscht ist. */
    onContextMenu?(keys: SelectionKey[], pos: {
        x: number;
        y: number;
    }): void;
    /** Nach jedem Rendern, mit Dauer in ms. */
    onRendered?(ms: number): void;
    onError?(err: unknown): void;
}
export interface VisualHandle {
    /** Teile der Optionen ersetzen und neu rendern (neue Daten, Theme, Objekte …). */
    update(next: Partial<Omit<MountOptions, "visual">>): void;
    clearSelection(): void;
    /** Aktuelle Objekte inkl. aller Änderungen, die das Visual selbst gespeichert hat. */
    readonly objects: VisualObjects;
    readonly lastRenderMs: number;
    destroy(): void;
}
