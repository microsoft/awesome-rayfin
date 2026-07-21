/**
 * Fabric interop seam — the fold-in point between this finance layer and the
 * official Fabric Apps Analytics substrate (`@microsoft/fabric-visuals-core`,
 * consumed by `VegaVisual` + `@microsoft/fabric-datagrid`).
 *
 * The official contract is a **positional** `DataTable` (`columns: ColumnDef[]`,
 * `rows: unknown[][]`). This package's features operate on an **object-row**
 * `DataTable` (`rows: Record<string, CellValue>[]`) — which is exactly the shape
 * the official `convertDataTableToRows` produces. So the two are the same data in
 * two access shapes, and these converters bridge them losslessly.
 *
 * Design: the official types are pulled in with **`import type`** only, so they are
 * erased at build time — this module adds **zero runtime dependency**. The devDep
 * `@microsoft/fabric-visuals-core` provides the types for our own typecheck/build,
 * and the structural `import type` guarantees our converters stay shape-compatible
 * with the real SDK. The couple of runtime helpers we need are reimplemented here
 * (they mirror the official semantics exactly) rather than imported, to keep the
 * package installable without the SDK present.
 */

import type {
  DataTable as FabricDataTable,
  ColumnDef as FabricColumnDef,
} from "@microsoft/fabric-visuals-core";
import type { CellValue, Column, DataTable } from "../lib/types";
import type { FabricColumnMetaMap, FabricQueryTable } from "./fabric-data-source";

// Re-export the official contract types (type-only → erased at runtime).
export type {
  DataTable as FabricDataTable,
  ColumnDef as FabricColumnDef,
  DataPointSelection,
  DataPointPredicate,
  SetPredicate,
  RangePredicate,
  InteractionEvent,
  SelectInteractionEvent,
  ClearInteractionEvent,
  InteractionEventCallback,
  VisualTheme,
} from "@microsoft/fabric-visuals-core";

/** Strip the `Table[Col]` / `[Measure]` wrapper a DAX result name carries → bare label. */
function bareLabel(daxName: string): string {
  return daxName.replace(/^.*\[/, "").replace(/\]$/, "");
}

/** Coerce an arbitrary SDK/Vega cell to this package's `CellValue` (string | number | null). */
function toCell(v: unknown): CellValue {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Infer whether an official column carries numeric data by sampling its values. */
function inferNumeric(rows: readonly unknown[][], index: number): boolean {
  let sawValue = false;
  for (const r of rows) {
    const v = r[index];
    if (v == null) continue;
    sawValue = true;
    if (typeof v !== "number") return false;
  }
  return sawValue;
}

/**
 * Convert an official **positional** `DataTable` into this package's **object-row**
 * `DataTable`. Keyed by column `name`, matching the official `convertDataTableToRows`
 * semantics exactly (last value wins on duplicate names, per plain-object keying) so
 * data round-trips faithfully through the official pipeline. Numeric-ness is inferred
 * by sampling, since the official `ColumnDef` carries a `format` string, not a flag.
 */
export function fromFabricTable(table: FabricDataTable): DataTable {
  const cols: Column[] = table.columns.map((c, i) => ({
    key: c.name,
    label: c.displayName ?? bareLabel(c.name),
    numeric: inferNumeric(table.rows, i),
  }));
  const rows: Record<string, CellValue>[] = table.rows.map((row) => {
    const out: Record<string, CellValue> = {};
    table.columns.forEach((c, i) => {
      out[c.name] = toCell(row[i]);
    });
    return out;
  });
  return { columns: cols, rows };
}

/**
 * Convert this package's **object-row** `DataTable` into the official **positional**
 * `DataTable` that `VegaVisual` and `@microsoft/fabric-datagrid` consume. This is the
 * bridge used at the visual boundary once the official components are adopted.
 *
 * `Column.key → ColumnDef.name`, `Column.label → ColumnDef.displayName`. No `format`
 * is invented (numeric-ness is carried by the cell values already being numbers), so
 * the round-trip `fromFabricTable(toFabricTable(t))` preserves `numeric` for any column
 * that has at least one non-null numeric value.
 */
export function toFabricTable(table: DataTable): FabricDataTable {
  const columns: FabricColumnDef[] = table.columns.map((c) => ({
    name: c.key,
    displayName: c.label,
  }));
  const rows: unknown[][] = table.rows.map((r) => table.columns.map((c) => r[c.key] ?? null));
  return { columns, rows };
}

/**
 * Convert the raw Rayfin SDK `QueryTable` (positional, `dataType`-tagged) directly into
 * the **official** positional `DataTable`, carrying per-column presentation metadata
 * (clean `name`, `displayName`, and a VBA/ECMA-376 `format` string) so the result can be
 * handed straight to `VegaVisual` / `DataGrid` without a second conversion.
 *
 * This is the "positional DataTable is the primary output" fold: the live semantic-model
 * path can emit the official table for the adopted visuals, while `fabricQueryToDataTable`
 * remains available for features that still consume the object-row shape. Both dedup
 * duplicate keys identically (`revenue`, `revenue_2`, …) so the two paths agree.
 */
export function fabricQueryToFabricTable(
  table: FabricQueryTable,
  columns: FabricColumnMetaMap = {},
): FabricDataTable {
  const seen = new Map<string, number>();
  const cols: FabricColumnDef[] = table.columns.map((c) => {
    const meta = columns[c.name] ?? {};
    let name = meta.key ?? c.name;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name}_${n + 1}`;
    const def: FabricColumnDef = { name, displayName: meta.label ?? bareLabel(c.name) };
    return meta.format ? { ...def, format: meta.format } : def;
  });
  const rows: unknown[][] = table.rows.map((row) => cols.map((_c, i) => row[i] ?? null));
  return { columns: cols, rows };
}
