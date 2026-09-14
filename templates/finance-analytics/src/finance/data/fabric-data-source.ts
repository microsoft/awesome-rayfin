import type { CellValue, Column, DataTable } from "../lib/types";
import type { DataQuery, DataSource } from "./data-source";

/**
 * The Fabric-native bridge. This is the **live data path** for a Fabric data app:
 * it queries a semantic model through the Rayfin SDK (host-brokered auth — no tokens,
 * no MSAL, no REST) and converts the SDK's raw, **positional** `QueryTable` into the
 * **object-row** `DataTable` every standardized feature (grid, pivot, charts, export)
 * consumes.
 *
 * It is structurally typed against `@microsoft/fabric-app-data`'s `FabricClient`, so you
 * pass the real SDK client without this package taking a hard dependency on it.
 */

/** One column of the SDK's raw query result. Mirrors `@microsoft/fabric-app-data`. */
export interface FabricQueryColumn {
  /** Exact DAX result name, e.g. `Segment[Segment]`, `[Total Revenue]`, or your alias. */
  name: string;
  /** SDK data type, e.g. `Int64`, `Double`, `String`, `DateTime`, `Boolean`. */
  dataType?: string;
}

/** The SDK's raw query result table: metadata columns + **positional** row arrays. */
export interface FabricQueryTable {
  columns: FabricQueryColumn[];
  /** Row-major, positional: `rows[r][c]` lines up with `columns[c]`. */
  rows: unknown[][];
}

/** The status-bearing result the SDK returns. It **never throws** — branch on `status`. */
export interface FabricQueryResult {
  status: "success" | "error";
  table?: FabricQueryTable;
  error?: { category?: string; message?: string };
}

/** Structural shape of `client.semanticModel(alias)` — accepts the real SDK client. */
export interface FabricSemanticModel {
  query(dax: string, opts?: { bypassCache?: boolean }): Promise<FabricQueryResult>;
}

/** Structural shape of the Rayfin `FabricClient` (from `initEmbeddedAuth`). */
export interface FabricClientLike {
  semanticModel(connection: string): FabricSemanticModel;
}

/**
 * Presentation metadata for one result column, **looked up by the exact DAX result name**.
 * The lookup key stays the exact DAX name; the emitted `key`/`label` may differ so page
 * config can read clean field names (e.g. `revenue`) while the query keeps `[Total Revenue]`.
 */
export interface FabricColumnMeta {
  /** The `key` your page config / features read (e.g. `revenue`). Defaults to the DAX name. */
  key?: string;
  /** Header users see. Defaults to the bare label of the DAX name (`[Total Revenue]` → `Total Revenue`). */
  label?: string;
  /** Right-align + usable as a measure. Defaults to inferred from the SDK `dataType`. */
  numeric?: boolean;
  /**
   * Optional VBA/ECMA-376 format string (e.g. `"#,##0"`, `"$#,##0.00"`, `"0.0%"`,
   * `"yyyy-mm-dd"`). Carried onto the official `ColumnDef.format` by
   * `fabricQueryToFabricTable` (so `VegaVisual` / `DataGrid` format natively) AND
   * onto the object-row `Column.format` by `fabricQueryToDataTable` (so `formatCell`
   * renders the custom grid, pivot, finance tables, and export the same way).
   */
  format?: string;
}

/** Column metadata map, keyed by the **exact DAX result name**. */
export type FabricColumnMetaMap = Record<string, FabricColumnMeta>;

export interface FabricDataSourceOptions {
  /** The Rayfin SDK client (e.g. from `initEmbeddedAuth()` / `FabricClient`). */
  client: FabricClientLike;
  /** The connection alias declared in `fabric.yaml` (codegen'd into `fabric.generated.ts`). */
  connection: string;
  /** Optional per-column metadata, keyed by exact DAX result name. */
  columns?: FabricColumnMetaMap;
  /** Header label shown in the shell. Defaults to `Live · <connection>`. */
  label?: string;
  /** Skip the SDK's built-in query cache for this source. */
  bypassCache?: boolean;
}

const NUMERIC_DATA_TYPES = new Set([
  "Int64", "Double", "Decimal", "Currency", "Number", "number", "int64", "double",
]);

/** Strip the `Table[Col]` / `[Measure]` wrapper a DAX result name carries → bare label. */
function bareLabel(daxName: string): string {
  return daxName.replace(/^.*\[/, "").replace(/\]$/, "");
}

/**
 * Convert a positional SDK `QueryTable` into this package's object-row `DataTable`.
 * Pure and exported so it is unit-testable and reusable outside a `DataSource`.
 *
 * - Each column's `key` comes from `columns[daxName].key`, else the exact DAX name.
 * - Duplicate keys are de-duplicated (`revenue`, `revenue_2`, …) so features never
 *   silently drop a column.
 * - `undefined` cells (and SDK `BLANK`) become `null`.
 */
export function fabricQueryToDataTable(
  table: FabricQueryTable,
  columns: FabricColumnMetaMap = {},
): DataTable {
  const seen = new Map<string, number>();
  const cols: Column[] = table.columns.map((c) => {
    const meta = columns[c.name] ?? {};
    let key = meta.key ?? c.name;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}_${n + 1}`;
    const numeric = meta.numeric ?? (c.dataType ? NUMERIC_DATA_TYPES.has(c.dataType) : undefined);
    return { key, label: meta.label ?? bareLabel(c.name), numeric, format: meta.format };
  });

  const rows: Record<string, CellValue>[] = table.rows.map((row) => {
    const out: Record<string, CellValue> = {};
    cols.forEach((col, i) => {
      const v = row[i];
      out[col.key] = (v === undefined ? null : v) as CellValue;
    });
    return out;
  });

  return { columns: cols, rows };
}

/**
 * Fabric-native `DataSource` — the live path. Wraps `client.semanticModel(connection)`
 * and maps each query's positional result into the standard object-row `DataTable`.
 *
 * The SDK never throws; a `status: "error"` result is surfaced as a thrown error here so
 * the shell's standardized error state renders it (via `useDataQuery`).
 *
 * @example
 * ```ts
 * import { createFabricStandardApp, fabricDataSource } from "@/finance";
 * // `client` from the Rayfin SDK's initEmbeddedAuth(); `salesModel` from fabric.yaml
 * export default createFabricStandardApp({
 *   appName: "Revenue",
 *   dataSource: fabricDataSource({
 *     client, connection: "salesModel",
 *     columns: {
 *       // Lookup key = EXACT DAX result name. A SUMMARIZECOLUMNS extension column
 *       // named "Revenue" comes back BRACKETED as `[Revenue]` (verified against the
 *       // live @microsoft/fabric-app-data contract); dimensions stay `Table[Column]`.
 *       "Segment[Segment]": { key: "segment", label: "Segment" },
 *       "[Revenue]":        { key: "revenue", label: "Revenue", numeric: true },
 *     },
 *   }),
 *   query: { id: "main", query: 'EVALUATE SUMMARIZECOLUMNS(Segment[Segment], "Revenue", [Total Revenue])' },
 *   // …
 * });
 * ```
 */
export function fabricDataSource(opts: FabricDataSourceOptions): DataSource {
  const model = opts.client.semanticModel(opts.connection);
  return {
    label: opts.label ?? `Live · ${opts.connection}`,
    async fetch(query: DataQuery): Promise<DataTable> {
      const result = await model.query(query.query, { bypassCache: opts.bypassCache });
      if (result.status !== "success" || !result.table) {
        const category = result.error?.category ?? "unknown";
        const message = result.error?.message ?? "query returned no table";
        throw new Error(`Semantic-model query failed (${category}): ${message}`);
      }
      return fabricQueryToDataTable(result.table, opts.columns);
    },
  };
}
