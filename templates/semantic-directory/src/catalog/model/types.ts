//-----------------------------------------------------------------------
// Semantic Directory — catalog domain types.
//
// Two layers:
//  - Raw* types mirror the exact SELECTCOLUMNS output of the metadata DAX
//    queries (src/queries/metadata/*.dax).
//  - *Meta types are the normalized, enrichment-merged entities the UI uses.
//-----------------------------------------------------------------------

// ---------- Raw rows (match DAX SELECTCOLUMNS aliases) ----------

export interface RawMeasureRow {
    MeasureId: unknown;
    Measure: string;
    Table: string;
    Description: unknown;
    /** The measure's DAX expression — powers the live dependency graph. */
    Expression: unknown;
    DisplayFolder: unknown;
    FormatString: unknown;
    DataType: unknown;
    IsHidden: unknown;
    LineageTag: unknown;
}

export interface RawTableRow {
    TableId: unknown;
    Table: string;
    Description: unknown;
    DataCategory: unknown;
    IsHidden: unknown;
    StorageMode: unknown;
    LineageTag: unknown;
}

export interface RawColumnRow {
    ColumnId: unknown;
    Table: string;
    Column: string;
    DataType: unknown;
    Description: unknown;
    DisplayFolder: unknown;
    FormatString: unknown;
    IsHidden: unknown;
    SummarizeBy: unknown;
    DataCategory: unknown;
    SortByColumn: unknown;
    LineageTag: unknown;
}

export interface RawRelationshipRow {
    RelationshipId: unknown;
    IsActive: unknown;
    CrossFilteringBehavior: unknown;
    FromTable: string;
    FromColumn: string;
    FromCardinality: unknown;
    ToTable: string;
    ToColumn: string;
    ToCardinality: unknown;
}

// ---------- Enrichment overlay ----------

/** One curated enrichment record, keyed in the enrichment file by entity key. */
export interface EnrichmentEntry {
    /** Human-friendly display name (overrides the technical name if present). */
    friendlyName?: string;
    /** Plain-English, one-line explanation for non-technical users. */
    description?: string;
    /** Business topic / menu section (e.g. "Sales"). */
    businessTopic?: string;
    /** Emoji used in the wireframe menu for quick visual scanning. */
    emoji?: string;
    /** Alternate search terms / business synonyms. */
    synonyms?: string[];
    /** Example questions this entity helps answer. */
    exampleQuestions?: string[];
    /** Free-form tags (e.g. "target", "YoY"). */
    tags?: string[];
    /** Short "what it shows" hint (e.g. "a currency amount"). */
    shows?: string;
}

export interface EnrichmentFile {
    version: number;
    /** Global business-language synonyms: term -> canonical field/value hints. */
    synonyms?: Record<string, { field?: string; values?: string[] }>;
    /** Entity enrichment keyed by entity key (see key helpers). */
    measures?: Record<string, EnrichmentEntry>;
    columns?: Record<string, EnrichmentEntry>;
    tables?: Record<string, EnrichmentEntry>;
}

// ---------- Normalized catalog entities ----------

export type EntityKind = "measure" | "column" | "table";

interface BaseEntity {
    /** Stable key: `${kind}:${...}` — see key helpers. */
    key: string;
    kind: EntityKind;
    /** Technical name from the model. */
    name: string;
    /** Enriched display name, falls back to `name`. */
    displayName: string;
    /** Live model description (rare) merged with enrichment description. */
    description?: string;
    /** True when description came from enrichment, not the model. */
    descriptionFromEnrichment: boolean;
    /** Business topic/section for grouping (enrichment or display folder). */
    topic?: string;
    displayFolder?: string;
    emoji?: string;
    isHidden: boolean;
    /** True when this entity has any curated enrichment. */
    enriched: boolean;
    synonyms: string[];
    tags: string[];
    exampleQuestions: string[];
    lineageTag?: string;
}

export interface MeasureMeta extends BaseEntity {
    kind: "measure";
    /** Home table (usually a measures table like "Reporting Measures"). */
    table: string;
    formatString?: string;
    dataType?: string;
    shows?: string;
    // ---- Rich brain fields (bundled catalog only; undefined on live-only) ----
    /** The measure's DAX expression. */
    dax?: string;
    /** Normalized names of measures this measure references in its DAX. */
    dependsOnMeasures?: string[];
    /** Fully-qualified column refs (`'Table'[Column]`) this measure reads. */
    dependsOnColumns?: string[];
    /** Distinct tables this measure touches (directly + via child measures). */
    usesTables?: string[];
    /** Normalized names of measures that reference THIS measure. */
    usedByMeasures?: string[];
    /** Source-system ids this measure ultimately draws from. */
    sourceSystems?: string[];
    /** Family cluster id (see MeasureFamily). */
    familyId?: string;
    /** Validated source tables from the catalog description ("Sources:"). */
    sources?: string[];
    /** True when the bundled description is auto-generated & steward-pending. */
    stewardPending?: boolean;
    /** Trust signal (freshness + reconciliation) rolled up from sources. */
    trust?: TrustSignal;
}

export interface ColumnMeta extends BaseEntity {
    kind: "column";
    table: string;
    /** Fully-qualified `'Table'[Column]`. */
    ref: string;
    dataType?: string;
    formatString?: string;
    summarizeBy?: string;
    /** True when this column looks like a usable slice/dimension field. */
    isDimensionLike: boolean;
    /** Data category from the model (e.g. "RowNumber"); rich field. */
    category?: string;
    /** Normalized names of measures that read this column in their DAX. */
    usedByMeasures?: string[];
    /**
     * Distinct member values pulled LIVE from the model (e.g. the actual
     * product names in Product[ProductName]). Undefined until the live overlay
     * loads; powers value-level search so new values become findable automatically.
     */
    liveValues?: string[];
    /**
     * The model's SortByColumn for this field, folded on from the live schema.
     * Lets the members list honour business order (Mon→Sun, fiscal periods)
     * instead of alphabetising the display values. Undefined until live.
     */
    sortByColumn?: string;
}

export interface TableMeta extends BaseEntity {
    kind: "table";
    dataCategory?: string;
    storageMode?: string;
    columnCount: number;
    measureCount: number;
    // ---- Rich brain fields ----
    /** Physical delta table this friendly table points at. */
    physicalSource?: string;
    /** Source-system id (ERP, CRM, Data Warehouse, …). */
    sourceSystem?: string;
    /** Trust signal for the table's source system. */
    trust?: TrustSignal;
    /** Entity ontology class from the catalog (fact / dimension / …). */
    ontology?: OntologyClass;
    /** True when this table is served via Direct Lake from the lakehouse. */
    directLake?: boolean;
    /** Number of facts that join to this dimension (star-schema hub rank). */
    hubRank?: number;
}

// ---------- Trust / lineage / families (bundled brain) ----------

export type Confidence = "confirmed" | "inferred" | "standard";

export interface TrustSignal {
    /** ISO timestamp of the freshest relevant source load. */
    freshestAt?: string;
    /** ISO timestamp of the stalest relevant source load. */
    stalestAt?: string;
    /** True when any contributing source is flagged stale. */
    hasStaleSource: boolean;
    /** Automated source→model reconciliation pass rate (0..1), if measured. */
    qaPassRate?: number;
    /** Overall banded trust level. */
    level: "high" | "watch" | "low" | "unknown";
    /** Short human explanation. */
    note?: string;
}

// ---------- Entity ontology ----------

/** Entity ontology class for a model table. */
export type OntologyClass =
    | "fact"
    | "dimension"
    | "measure-host"
    | "bridge"
    | "security"
    | "operational";


export interface SourceSystem {
    id: string;
    label: string;
    what: string;
    confidence: Confidence;
    /** Number of model tables sourced from this system. */
    tableCount: number;
    /** Number of measures ultimately drawing on this system. */
    measureCount: number;
    freshestAt?: string;
    stalestAt?: string;
    qaPassRate?: number;
}

export interface MeasureFamily {
    id: string;
    /** Family display name (the shared stem, e.g. "Total Sales"). */
    name: string;
    /** Display folder the family lives in. */
    folder?: string;
    /** Member measure entity keys (e.g. "measure:total sales"), sorted. */
    memberKeys: string[];
    /** Member measure display names (sorted). */
    members: string[];
    /** Source systems spanned by the family. */
    sourceSystems: string[];
}

export interface GlossaryTerm {
    term: string;
    meaning: string;
    confidence: Confidence;
    category: string;
    aliases: string[];
}

export interface FreshnessRow {
    system: string;
    detail: string;
    latest: string;
    status: "fresh" | "stale";
    note?: string;
}

export interface AdoptionSummary {
    workspaceUsers: number;
    workspaceViews: number;
    modelUsers: number;
    modelViews: number;
    topReports: { report: string; views: number; users: number; kind?: string }[];
}

export interface RelationshipMeta {
    id: string;
    isActive: boolean;
    crossFilter: string;
    fromTable: string;
    fromColumn: string;
    fromCardinality: string;
    toTable: string;
    toColumn: string;
    toCardinality: string;
}

// ---------- Coverage / diagnostics ----------

export interface Coverage {
    measureCount: number;
    measureVisible: number;
    measureEnriched: number;
    measureDescribed: number;
    columnCount: number;
    tableCount: number;
    tableVisible: number;
    relationshipCount: number;
    /** Enrichment keys that matched no live entity (stale/orphan). */
    orphanEnrichmentKeys: string[];
    /** Visible measures lacking any friendly description. */
    needsDescription: string[];
}

export interface CatalogModel {
    snapshotAt: string;
    /** Where this catalog was assembled from. */
    origin: "bundled" | "live" | "bundled+live";
    measures: MeasureMeta[];
    columns: ColumnMeta[];
    tables: TableMeta[];
    relationships: RelationshipMeta[];
    coverage: Coverage;
    /** Global business synonyms from the enrichment file. */
    synonyms: Record<string, { field?: string; values?: string[] }>;
    // ---- Bundled brain (undefined on a pure-live catalog) ----
    families?: MeasureFamily[];
    sourceSystems?: SourceSystem[];
    glossary?: GlossaryTerm[];
    freshness?: FreshnessRow[];
    adoption?: AdoptionSummary;
    /** Drift vs the live model, set when a live overlay was reconciled. */
    drift?: DriftReport;
    /** Provenance of the bundled brain. */
    brainSource?: {
        model: string;
        workspace: string;
        capturedUtc: string;
    };
}

/** Reconciliation of the bundled brain against the live model (by name). */
export interface DriftReport {
    checkedAt: string;
    liveMeasureCount: number;
    liveTableCount: number;
    /** Measure names live has that the bundled brain doesn't (new since capture). */
    newMeasures: string[];
    /** Measure names the brain has that live doesn't (removed/renamed). */
    missingMeasures: string[];
    /** True when the live model matched cleanly. */
    inSync: boolean;
}

// ---------- Key helpers ----------

/** Normalize a name for matching (lowercase, collapse whitespace). */
export function normName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Stable entity key used to join live metadata with enrichment records. */
export function measureKey(name: string): string {
    return `measure:${normName(name)}`;
}
export function columnKey(table: string, column: string): string {
    return `column:${normName(table)}[${normName(column)}]`;
}
export function tableKey(name: string): string {
    return `table:${normName(name)}`;
}
