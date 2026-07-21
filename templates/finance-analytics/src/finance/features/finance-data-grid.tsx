/**
 * Official-grid renderer for the finance tables (variance / time-series). Given the
 * columns + rows produced by `finance-grid-columns`, it mounts the SDK
 * `@microsoft/fabric-datagrid` so the condensed finance tables gain the official
 * grid's native **cell-range Ctrl+C Excel copy** and row virtualization — while the
 * cellRenderers preserve their bespoke presentation (one-line units + % variance,
 * favourability colour, trend sparkline) and the app theme via `useVisualTheme`.
 *
 * Loaded ONLY behind a lazy boundary (see `variance-table.tsx` / `time-series-table.tsx`,
 * `engine="fabric"`), so the SDK + its transitive deps land in the shared
 * `fabric-datagrid` async chunk and never touch the initial-load budget. The SDK is
 * an OPTIONAL peer dependency every Fabric Apps Analytics host already provides.
 */
import { DataGrid as FabricGrid, type GridColumnDef, type Row } from "@microsoft/fabric-datagrid";
import { useVisualTheme } from "../lib/visual-theme";

export interface FinanceDataGridProps {
  columns: GridColumnDef[];
  data: Row[];
  /** Row height in px. Finance tables are dense by default. */
  rowHeight?: number;
}

export default function FinanceDataGrid({ columns, data, rowHeight = 34 }: FinanceDataGridProps) {
  // Hand the app's own palette to the official grid so it renders in OUR theme,
  // never the SDK's stale default.
  const theme = useVisualTheme();
  return (
    <div className="overflow-hidden rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
      <FabricGrid
        columns={columns}
        data={data}
        theme={theme}
        rowHeight={rowHeight}
        capabilities={{ virtualization: rowHeight, disableSelection: false, disableColumnReorder: true }}
      />
    </div>
  );
}
