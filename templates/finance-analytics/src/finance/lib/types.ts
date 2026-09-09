/** Generic, data-agnostic table shape that every feature operates on.
 *  Apps map their semantic-model query results into this once; all standardized
 *  features (export, pivot, grid, charts) consume it without app-specific coupling. */

export type CellValue = string | number | null;

export interface Column {
  key: string;
  label: string;
  /** Numeric columns are right-aligned and usable as pivot/chart measures. */
  numeric?: boolean;
  /** Optional VBA/ECMA-376 model format string (e.g. `"$#,##0.00"`, `"0.0%"`),
   *  honored by `formatCell` across grid cells, pivot values, and export. */
  format?: string;
}

export interface DataTable {
  columns: Column[];
  rows: Record<string, CellValue>[];
}

export function numericColumns(table: DataTable): Column[] {
  return table.columns.filter((c) => c.numeric);
}

export function categoryColumns(table: DataTable): Column[] {
  return table.columns.filter((c) => !c.numeric);
}
