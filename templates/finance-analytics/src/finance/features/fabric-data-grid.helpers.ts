/**
 * Pure, runtime-dependency-free helpers for the fabric-backed data grid.
 *
 * Kept in a separate module so they can be unit-tested WITHOUT importing
 * `@microsoft/fabric-datagrid` (whose Fluent-icon subpaths don't resolve cleanly
 * under the test runner's ESM loader). The official `GridColumnDef` is referenced
 * with `import type` only, so it is erased at build time — this module has zero
 * runtime dependency on the SDK.
 */
import type { GridColumnDef } from "@microsoft/fabric-datagrid";
import type { Column } from "../lib/types";
import { formatCell } from "../lib/format-string";
import type { InteractionEvent, DataPointSelection } from "../data/fabric-interop";

/**
 * Map our object-row column model to the official `GridColumnDef`. Numeric or
 * model-formatted columns get a cell renderer that honors the VBA/ECMA-376 format
 * string via `formatCell`, so the official grid renders the same as every other
 * object-row surface.
 */
export function toGridColumns(columns: Column[]): GridColumnDef[] {
  return columns.map((c) => ({
    id: c.key,
    header: c.label,
    numeric: c.numeric,
    sortable: true,
    cellRenderer:
      c.numeric || c.format
        ? (value: unknown) => formatCell(value, c.format)
        : undefined,
  }));
}

/** Collect the selections carried by a batch of official `select` events. */
export function collectSelections(events: InteractionEvent[]): DataPointSelection[] {
  const out: DataPointSelection[] = [];
  for (const ev of events) {
    if (ev.action === "select") out.push(...ev.selections);
  }
  return out;
}
