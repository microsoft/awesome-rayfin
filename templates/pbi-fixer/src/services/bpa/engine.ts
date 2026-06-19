// Engine that mirrors the surface of Python's `TOMWrapper` (`tom.*`)
// closely enough that the ported rule predicates stay readable and
// 1:1 with the source. ModelData (TMDL-derived) is the only required
// input; an optional ModelExtras carries DAX-fetched extras (RLS table
// permissions, calculation items, table data category, partition row
// counts) which a few rules need.

import type {
  ModelData,
  TableInfo,
  ColumnInfo,
  MeasureInfo,
  HierarchyInfo,
  PartitionInfo,
  RelationshipInfo,
} from "@/explorer/types";
import type { BpaRule, BpaScope, BpaViolation } from "./types";

// ---------------------------------------------------------------------------
// Scope objects — light wrappers that expose the *property names* the
// Python rules use (PascalCase like obj.DataType, obj.IsHidden, …).
// ---------------------------------------------------------------------------

export interface ScopeObjBase {
  __scope: BpaScope;
  __table?: string;
  Name: string;
  Description: string;
  IsHidden: boolean;
  Parent: any;
}

export interface TableObj extends ScopeObjBase {
  __scope: "Table";
  Columns: ColumnObj[];
  Measures: MeasureObj[];
  Hierarchies: HierarchyObj[];
  Partitions: { Count: number; [Symbol.iterator](): Iterator<PartitionObj> } & PartitionObj[];
  CalculationGroup: { CalculationItems: CalcItemObj[] } | null;
  DataCategory: string;
}

export interface ColumnObj extends ScopeObjBase {
  __scope: "Column" | "Calculated Column";
  Table: TableObj;
  DataType: string;
  Type: string;
  Expression: string;
  SourceColumn: string;
  SummarizeBy: string;
  DisplayFolder: string;
  IsKey: boolean;
  DataCategory: string;
  SortByColumn: ColumnObj | null;
  IsAvailableInMDX: boolean;
  FormatString: string;
}

export interface MeasureObj extends ScopeObjBase {
  __scope: "Measure";
  Table: TableObj;
  Expression: string;
  FormatString: string;
  FormatStringDefinition: any;
  DisplayFolder: string;
}

export interface HierarchyObj extends ScopeObjBase {
  __scope: "Hierarchy";
  Table: TableObj;
}

export interface PartitionObj extends ScopeObjBase {
  __scope: "Partition";
  Mode: string;
  SourceType: string;
  Source: { Expression: string };
  DataCoverageDefinition: any;
}

export interface CalcItemObj extends ScopeObjBase {
  __scope: "Calculation Item";
  Expression: string;
  Ordinal: number;
}

export interface RelationshipObj extends ScopeObjBase {
  __scope: "Relationship";
  IsActive: boolean;
  CrossFilteringBehavior: string;
  FromCardinality: string;
  ToCardinality: string;
  FromTable: { Name: string };
  ToTable: { Name: string };
  FromColumn: { Name: string; DataType: string };
  ToColumn: { Name: string; DataType: string };
}

export interface RlsObj extends ScopeObjBase {
  __scope: "Row Level Security";
  Table: { Name: string };
  FilterExpression: string;
}

export interface ModelObj extends ScopeObjBase {
  __scope: "Model";
  Tables: TableObj[];
  Relationships: RelationshipObj[] & { Count: number };
}

// ---------------------------------------------------------------------------
// Optional DAX-fetched extras
// ---------------------------------------------------------------------------

export interface ModelExtras {
  /** Per-table data category from INFO.TABLES (lowercased). */
  tableDataCategory?: Record<string, string>;
  /** Per-table calculation items: tableName → array of {name, expression, ordinal}. */
  calcItems?: Record<string, { name: string; expression: string; ordinal: number }[]>;
  /** RLS rows: per role/table filter expressions. */
  rls?: { role: string; table: string; filterExpression: string }[];
  /** Optional row-count override: tableName → row count. */
  rowCounts?: Record<string, number>;
  /** True when the model is Direct Lake (any partition has source-type `entity`). */
  isDirectLake?: boolean;
  /** True when at least one DirectQuery-on-Lakehouse partition references a SQL view. */
  isDirectLakeUsingView?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers — value normalization
// ---------------------------------------------------------------------------

function lc(s: string | undefined | null): string {
  return (s ?? "").toLowerCase();
}

/** Map a TMDL data type string ("int64" / "Int64") to the canonical TOM
 *  enum value the rules compare against ("Int64", "Double", …). */
function normDataType(dt: string): string {
  switch (lc(dt)) {
    case "int64": return "Int64";
    case "string": return "String";
    case "datetime": return "DateTime";
    case "decimal": return "Decimal";
    case "double": return "Double";
    case "boolean": return "Boolean";
    case "binary": return "Binary";
    default: return dt || "";
  }
}

function normColumnType(t: string): string {
  switch (lc(t)) {
    case "calculated": return "Calculated";
    case "calculatedtablecolumn": return "CalculatedTableColumn";
    case "rownumber": return "RowNumber";
    case "data":
    case "":
      return "Data";
    default: return t;
  }
}

function normSummarizeBy(s: string): string {
  if (!s) return "Default";
  const lo = lc(s);
  if (lo === "none") return "None";
  if (lo === "default") return "Default";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Normalize TMDL partition `mode` (import / directQuery / dual) to TOM enum. */
function normMode(mode: string, sourceType: string): string {
  const m = lc(mode);
  if (m === "directquery") return "DirectQuery";
  if (m === "dual") return "Dual";
  if (m === "import") return "Import";
  // Direct Lake partitions have sourceType="entity" and no mode → DirectQuery
  if (lc(sourceType) === "entity") return "DirectQuery";
  return "Import";
}

/** Normalize TMDL partition source kind (m, calculated, entity, …). */
function normSourceType(s: string): string {
  switch (lc(s)) {
    case "m": return "M";
    case "calculated": return "Calculated";
    case "entity": return "Entity";
    case "policyrange": return "PolicyRange";
    case "calculationgroup": return "CalculationGroup";
    default: return s;
  }
}

function normCrossFilter(s: string): string {
  switch (lc(s)) {
    case "automatic": return "Automatic";
    case "bothdirections":
    case "both":
      return "BothDirections";
    case "onedirection":
    case "single":
      return "OneDirection";
    default: return s;
  }
}

function cardinalityFromMultiplicity(m: string, end: "from" | "to"): string {
  const lo = lc(m);
  const norm = (x: string): string => {
    const v = x.trim();
    if (v === "many" || v === "2" || v === "m" || v === "*") return "Many";
    if (v === "one" || v === "1") return "One";
    return "";
  };
  // Primary form: INFO.VIEW.RELATIONSHIPS() yields friendly strings combined as
  // `${FromCardinality}:${ToCardinality}` (e.g. "Many:One"). Numeric TMSCHEMA
  // values ("2:1") are tolerated too.
  if (lo.includes(":")) {
    const [f, t] = lo.split(":");
    return end === "from" ? norm(f) : norm(t);
  }
  // Legacy /relationships push-dataset endpoint emits "OneMany" / "ManyOne" /
  // "OneOne" / "ManyMany" — split into From/To halves.
  let from = "";
  let to = "";
  if (lo === "onemany") { from = "One"; to = "Many"; }
  else if (lo === "manyone") { from = "Many"; to = "One"; }
  else if (lo === "manymany") { from = "Many"; to = "Many"; }
  else if (lo === "oneone") { from = "One"; to = "One"; }
  return end === "from" ? from : to;
}

// ---------------------------------------------------------------------------
// Build wrapped scope objects from ModelData
// ---------------------------------------------------------------------------

function buildPartition(p: PartitionInfo, parent: TableObj): PartitionObj {
  return {
    __scope: "Partition",
    __table: parent.Name,
    Name: p.name,
    Description: "",
    IsHidden: false,
    Parent: parent,
    Mode: normMode(p.sourceType, p.sourceType),
    SourceType: normSourceType(p.sourceType),
    Source: { Expression: p.expression ?? "" },
    DataCoverageDefinition: null,
  };
}

function buildColumn(name: string, c: ColumnInfo, parent: TableObj): ColumnObj {
  const sortBy = c.sortByColumn ? { Name: c.sortByColumn } as ColumnObj : null;
  const colType = normColumnType(c.type);
  return {
    __scope: colType === "Calculated" || colType === "CalculatedTableColumn"
      ? "Calculated Column"
      : "Column",
    __table: parent.Name,
    Name: name,
    Description: "",
    IsHidden: !!c.isHidden,
    Parent: parent,
    Table: parent,
    DataType: normDataType(c.dataType),
    Type: colType,
    Expression: c.expression ?? "",
    SourceColumn: c.expression ? "" : name,
    SummarizeBy: normSummarizeBy(c.summarizeBy),
    DisplayFolder: c.displayFolder ?? "",
    IsKey: !!c.isKey,
    DataCategory: c.dataCategory ?? "",
    SortByColumn: sortBy,
    IsAvailableInMDX: true,
    FormatString: "",
  };
}

function buildMeasure(name: string, m: MeasureInfo, parent: TableObj): MeasureObj {
  return {
    __scope: "Measure",
    __table: parent.Name,
    Name: name,
    Description: m.description ?? "",
    IsHidden: !!m.isHidden,
    Parent: parent,
    Table: parent,
    Expression: m.expression ?? "",
    FormatString: m.formatString ?? "",
    FormatStringDefinition: null,
    DisplayFolder: m.displayFolder ?? "",
  };
}

function buildHierarchy(name: string, _h: HierarchyInfo, parent: TableObj): HierarchyObj {
  return {
    __scope: "Hierarchy",
    __table: parent.Name,
    Name: name,
    Description: "",
    IsHidden: false,
    Parent: parent,
    Table: parent,
  };
}

function partitionsArray(items: PartitionObj[]): TableObj["Partitions"] {
  const arr = items as TableObj["Partitions"];
  Object.defineProperty(arr, "Count", { value: items.length, enumerable: false });
  return arr;
}

function buildTable(name: string, t: TableInfo, extras: ModelExtras): TableObj {
  // Detect calculation group: TMDL `type` is one of "Table" / "CalculatedTable"
  // / "CalculationGroup" *if* the parser captured it; otherwise infer from
  // calcItems presence or the extras override (DAX INFO.TABLES).
  const hasCalcItems =
    Object.keys(t.calcItems).length > 0 ||
    (extras.calcItems?.[name]?.length ?? 0) > 0;
  const dataCategory =
    extras.tableDataCategory?.[name.toLowerCase()] ?? "";

  const stub: TableObj = {
    __scope: "Table",
    __table: name,
    Name: name,
    Description: t.description ?? "",
    IsHidden: !!t.isHidden,
    Parent: null,
    Columns: [],
    Measures: [],
    Hierarchies: [],
    Partitions: partitionsArray([]),
    CalculationGroup: null,
    DataCategory: dataCategory,
  };

  stub.Columns = Object.entries(t.columns).map(([cn, c]) => buildColumn(cn, c, stub));
  stub.Measures = Object.entries(t.measures).map(([mn, m]) => buildMeasure(mn, m, stub));
  stub.Hierarchies = Object.entries(t.hierarchies).map(([hn, h]) => buildHierarchy(hn, h, stub));
  stub.Partitions = partitionsArray(t.partitions.map((p) => buildPartition(p, stub)));

  if (hasCalcItems) {
    const items: CalcItemObj[] = [];
    // TMDL-derived
    for (const [cin, ci0] of Object.entries(t.calcItems)) {
      items.push({
        __scope: "Calculation Item",
        __table: name,
        Name: cin,
        Description: "",
        IsHidden: false,
        Parent: stub,
        Expression: ci0.expression ?? "",
        Ordinal: ci0.ordinal ?? 0,
      });
    }
    // DAX-derived (non-overlapping)
    for (const ci0 of extras.calcItems?.[name] ?? []) {
      if (items.some((x) => x.Name === ci0.name)) continue;
      items.push({
        __scope: "Calculation Item",
        __table: name,
        Name: ci0.name,
        Description: "",
        IsHidden: false,
        Parent: stub,
        Expression: ci0.expression ?? "",
        Ordinal: ci0.ordinal ?? 0,
      });
    }
    stub.CalculationGroup = { CalculationItems: items };
  }

  return stub;
}

function buildRelationship(r: RelationshipInfo, byTable: Map<string, TableObj>): RelationshipObj {
  const fromTable = byTable.get(r.fromTable);
  const toTable = byTable.get(r.toTable);
  const fromCol = fromTable?.Columns.find((c) => c.Name === r.fromColumn);
  const toCol = toTable?.Columns.find((c) => c.Name === r.toColumn);
  return {
    __scope: "Relationship",
    Name: `${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}]`,
    Description: "",
    IsHidden: false,
    Parent: null,
    IsActive: r.isActive !== false,
    CrossFilteringBehavior: normCrossFilter(r.crossFilter),
    FromCardinality: cardinalityFromMultiplicity(r.multiplicity, "from"),
    ToCardinality: cardinalityFromMultiplicity(r.multiplicity, "to"),
    FromTable: { Name: r.fromTable },
    ToTable: { Name: r.toTable },
    FromColumn: { Name: r.fromColumn, DataType: fromCol?.DataType ?? "" },
    ToColumn: { Name: r.toColumn, DataType: toCol?.DataType ?? "" },
  };
}

function buildModel(model: ModelData, extras: ModelExtras): ModelObj {
  const tables = Object.entries(model.tables).map(([n, t]) => buildTable(n, t, extras));
  const byTable = new Map(tables.map((t) => [t.Name, t]));
  const rels = (model.relationships ?? []).map((r) => buildRelationship(r, byTable));
  const relsArr = rels as ModelObj["Relationships"];
  Object.defineProperty(relsArr, "Count", { value: rels.length, enumerable: false });
  return {
    __scope: "Model",
    Name: model.datasetName ?? "",
    Description: "",
    IsHidden: false,
    Parent: null,
    Tables: tables,
    Relationships: relsArr,
  };
}

// ---------------------------------------------------------------------------
// TomContext — mirrors `tom.*` helpers used by Python rules.
// ---------------------------------------------------------------------------

export class TomContext {
  readonly model: ModelObj;
  readonly extras: ModelExtras;
  private rls?: RlsObj[];

  constructor(model: ModelObj, extras: ModelExtras) {
    this.model = model;
    this.extras = extras;
  }

  is_direct_lake(): boolean {
    if (this.extras.isDirectLake !== undefined) return this.extras.isDirectLake;
    return this.model.Tables.some((t) =>
      Array.from(t.Partitions).some((p) => p.SourceType === "Entity"),
    );
  }

  is_direct_lake_using_view(): boolean {
    return !!this.extras.isDirectLakeUsingView;
  }

  is_field_parameter(args: { table_name: string }): boolean {
    const t = this.model.Tables.find((x) => x.Name === args.table_name);
    if (!t) return false;
    // Field parameters carry an annotation `PBI_FieldParameters` we don't
    // capture from TMDL; use a conservative heuristic: a calculated table
    // whose expression starts with `{ ` (the field-parameter syntax).
    const calc = Array.from(t.Partitions).find((p) => p.SourceType === "Calculated");
    if (!calc) return false;
    return /^\s*\{\s*\(/.test(calc.Source.Expression || "");
  }

  is_calculated_table(args: { table_name: string }): boolean {
    const t = this.model.Tables.find((x) => x.Name === args.table_name);
    if (!t) return false;
    return Array.from(t.Partitions).some((p) => p.SourceType === "Calculated");
  }

  is_hybrid_table(args: { table_name: string }): boolean {
    const t = this.model.Tables.find((x) => x.Name === args.table_name);
    if (!t) return false;
    const parts = Array.from(t.Partitions);
    const hasImport = parts.some((p) => p.Mode === "Import");
    const hasDQ = parts.some((p) => p.Mode === "DirectQuery");
    return hasImport && hasDQ;
  }

  has_hybrid_table(): boolean {
    return this.model.Tables.some((t) => this.is_hybrid_table({ table_name: t.Name }));
  }

  *all_partitions(): Iterable<PartitionObj> {
    for (const t of this.model.Tables) for (const p of t.Partitions) yield p;
  }

  *all_measures(): Iterable<MeasureObj> {
    for (const t of this.model.Tables) for (const m of t.Measures) yield m;
  }

  *all_columns(): Iterable<ColumnObj> {
    for (const t of this.model.Tables) for (const c of t.Columns) yield c;
  }

  all_rls(): RlsObj[] {
    if (this.rls) return this.rls;
    const rows = this.extras.rls ?? [];
    this.rls = rows.map((r): RlsObj => ({
      __scope: "Row Level Security",
      Name: `${r.role}::${r.table}`,
      Description: "",
      IsHidden: false,
      Parent: null,
      Table: { Name: r.table },
      FilterExpression: r.filterExpression ?? "",
    }));
    return this.rls;
  }

  used_in_relationships(args: { object: any }): RelationshipObj[] {
    const obj = args.object;
    const rels = this.model.Relationships;
    if (obj.__scope === "Table") {
      return rels.filter((r) => r.FromTable.Name === obj.Name || r.ToTable.Name === obj.Name);
    }
    if (obj.__scope === "Column" || obj.__scope === "Calculated Column") {
      const tn = obj.Table.Name;
      return rels.filter(
        (r) =>
          (r.FromTable.Name === tn && r.FromColumn.Name === obj.Name) ||
          (r.ToTable.Name === tn && r.ToColumn.Name === obj.Name),
      );
    }
    return [];
  }

  used_in_sort_by(args: { column: ColumnObj }): ColumnObj[] {
    const col = args.column;
    const result: ColumnObj[] = [];
    for (const t of this.model.Tables) {
      if (t.Name !== col.Table.Name) continue;
      for (const c of t.Columns) {
        if (c.SortByColumn?.Name === col.Name) result.push(c);
      }
    }
    return result;
  }

  used_in_hierarchies(args: { column: ColumnObj }): HierarchyObj[] {
    // TMDL parser doesn't capture per-level column refs robustly enough
    // for false-positive-free filtering; this would need a richer
    // hierarchy capture. Return empty so the related rules degrade
    // gracefully (they no-op).
    void args;
    return [];
  }

  row_count(args: { object: TableObj }): number {
    return this.extras.rowCounts?.[args.object.Name] ?? 0;
  }

  // The four DAX-dependency helpers below need INFO.CALCDEPENDENCY;
  // when that data isn't available (the common case in-browser), return
  // safe defaults that prevent both false positives and false negatives.
  unqualified_columns(_: { object: any; dependencies?: any }): unknown[] { return []; }
  fully_qualified_measures(_: { object: any; dependencies?: any }): unknown[] { return []; }
  /** "object depends on something" — used by Maintenance rules to detect
   *  hidden columns that ARE referenced. Without dep data, we return
   *  truthy so the rule conservatively flags nothing (avoids deleting
   *  columns that turn out to be referenced). */
  depends_on(_: { object: any; dependencies?: any }): unknown[] { return [{}]; }
  referenced_by(_: { object: any; dependencies?: any }): unknown[] { return [{}]; }
}

// ---------------------------------------------------------------------------
// Scope iteration — yields every object a rule with that scope applies to.
// ---------------------------------------------------------------------------

function* scopeObjects(scope: BpaScope, ctx: TomContext): Iterable<any> {
  switch (scope) {
    case "Model":
      yield ctx.model;
      return;
    case "Table":
    case "Calculated Table":
      for (const t of ctx.model.Tables) {
        if (scope === "Calculated Table" && !ctx.is_calculated_table({ table_name: t.Name })) continue;
        yield t;
      }
      return;
    case "Column":
    case "Calculated Column":
      for (const c of ctx.all_columns()) {
        if (scope === "Calculated Column" && c.Type !== "Calculated" && c.Type !== "CalculatedTableColumn") continue;
        yield c;
      }
      return;
    case "Measure":
      yield* ctx.all_measures();
      return;
    case "Hierarchy":
      for (const t of ctx.model.Tables) for (const h of t.Hierarchies) yield h;
      return;
    case "Partition":
      yield* ctx.all_partitions();
      return;
    case "Relationship":
      for (const r of ctx.model.Relationships) yield r;
      return;
    case "Calculation Item":
      for (const t of ctx.model.Tables) {
        if (t.CalculationGroup) for (const ci0 of t.CalculationGroup.CalculationItems) yield ci0;
      }
      return;
    case "Row Level Security":
      for (const r of ctx.all_rls()) yield r;
      return;
  }
}

function pathOf(obj: any): string {
  if (!obj) return "";
  switch (obj.__scope) {
    case "Model": return obj.Name || "<model>";
    case "Table":
    case "Calculated Table":
      return obj.Name;
    case "Column":
    case "Calculated Column":
      return `${obj.Table.Name}[${obj.Name}]`;
    case "Measure":
      return `[${obj.Name}]`;
    case "Hierarchy":
      return `${obj.Table.Name}.${obj.Name}`;
    case "Partition":
      return `${obj.__table}::${obj.Name}`;
    case "Relationship":
      return obj.Name;
    case "Calculation Item":
      return `${obj.__table}.${obj.Name}`;
    case "Row Level Security":
      return obj.Name;
    default:
      return obj.Name ?? "";
  }
}

// ---------------------------------------------------------------------------
// Public runner
// ---------------------------------------------------------------------------

export function runBpa(
  model: ModelData,
  rules: BpaRule[],
  extras: ModelExtras = {},
): BpaViolation[] {
  const ctx = new TomContext(buildModel(model, extras), extras);
  const out: BpaViolation[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    for (const scope of scopes) {
      for (const obj of scopeObjects(scope, ctx)) {
        let hit = false;
        try {
          hit = !!rule.predicate(obj, ctx);
        } catch {
          // Defensive: predicates accessing missing fields shouldn't
          // crash the whole BPA run.
          hit = false;
        }
        if (!hit) continue;
        const path = pathOf(obj);
        const dedupe = `${rule.name}|${scope}|${path}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({
          category: rule.category,
          ruleName: rule.name,
          severity: rule.severity,
          description: rule.description,
          url: rule.url,
          objectType: scope,
          objectName: path,
        });
      }
    }
  }

  return out;
}

// Helper exposed for callers that want to know the slug of a rule (used
// by the public `BpaRule.id`).
export function ruleSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
