import type { SelectionKey, TooltipItem, VisualObjects } from "./types";
interface CategoryLike {
    source?: {
        queryName?: string;
        displayName?: string;
    };
    values?: unknown[];
}
/** Auswahl-ID: trägt die Werte der gruppierenden Spalten einer Zeile. */
export declare class SelectionId {
    readonly keys: [string, unknown][];
    readonly idx: number | null;
    readonly col: string | null;
    readonly key: string;
    constructor(keys: [string, unknown][], idx: number | null, col: string | null);
    equals(other: unknown): boolean;
    includes(other: unknown): boolean;
    getKey(): string;
    getSelector(): Record<string, unknown>;
    getSelectorsByColumn(): Record<string, unknown>;
    hasIdentity(): boolean;
    toRecord(): SelectionKey;
}
declare class SelectionIdBuilder {
    private keys;
    private idx;
    private col;
    withCategory(cat: CategoryLike, i: number): this;
    withMeasure(): this;
    withSeries(): this;
    withMatrixNode(): this;
    withTable(): this;
    createSelectionId(): SelectionId;
}
export interface HostEvents {
    onSelect(ids: SelectionId[]): void;
    /** nach persistProperties: die neuen Objekte und das Änderungspaket ({merge, replace, remove}) */
    onPersist(objects: VisualObjects, changes: unknown): void;
    onContextMenu(ids: SelectionId[], pos: {
        x: number;
        y: number;
    }): void;
    onRenderingFailed(err: unknown): void;
}
export interface HostState {
    locale: string;
    dark: boolean;
    darkBackground: string;
    interactive: boolean;
    objects: VisualObjects;
    locales: Record<string, Record<string, string>>;
}
declare class SelectionManager {
    private events;
    private selected;
    private callback;
    constructor(events: HostEvents);
    select(ids: SelectionId | SelectionId[], multi?: boolean): Promise<SelectionId[]>;
    clear(): Promise<void>;
    /** von außen (App) aufheben, ohne erneut onSelect auszulösen */
    reset(): void;
    hasSelection(): boolean;
    getSelectionIds(): SelectionId[];
    registerOnSelectCallback(cb: (ids: SelectionId[]) => void): void;
    showContextMenu(id: SelectionId | SelectionId[], pos: {
        x: number;
        y: number;
    }): Promise<object>;
    toggleExpandCollapse(): Promise<object>;
}
/** wendet ein persistProperties-Paket ({merge, replace, remove}) auf die Objekte an */
export declare function applyPersist(objects: VisualObjects, changes: unknown): VisualObjects;
/**
 * Objekte aus der Spec (base) mit dem, was das Visual seither per persistProperties gespeichert hat (log, in
 * Reihenfolge), zusammengeführt. Damit überlebt der Zustand des Visuals (aufgeklappte Knoten, Ansicht, Sortierung)
 * eine neue Abfrage oder einen Theme-Wechsel, wie in Power BI, wo persistierte Eigenschaften im Bericht bleiben.
 */
export declare function rebaseObjects(base: VisualObjects, log: unknown[]): VisualObjects;
export declare function createHost(state: HostState, events: HostEvents): {
    host: {
        readonly locale: string;
        readonly colorPalette: {
            isHighContrast: boolean;
            background: {
                value: string;
            };
            foreground: {
                value: string;
            };
        };
        readonly hostCapabilities: {
            allowInteractions: boolean;
        };
        instanceId: string;
        createSelectionManager: () => SelectionManager;
        createSelectionIdBuilder: () => SelectionIdBuilder;
        createLocalizationManager: () => {
            getDisplayName: (key: string) => string;
        };
        tooltipService: {
            enabled: () => boolean;
            show(a: {
                dataItems?: TooltipItem[];
                coordinates?: number[];
            }): void;
            move(a: {
                dataItems?: TooltipItem[];
                coordinates?: number[];
            }): void;
            hide(): void;
        };
        eventService: {
            renderingStarted(): void;
            renderingFinished(): void;
            renderingFailed(_o: unknown, reason: unknown): void;
        };
        persistProperties(changes: unknown): void;
        fetchMoreData: () => boolean;
        drill: () => void;
        launchUrl: (url: string) => void;
        displayWarningIcon: () => void;
        switchFocusModeState: () => void;
        applyJsonFilter: () => void;
        refreshHostData: () => void;
    };
    selection: SelectionManager;
};
export {};
