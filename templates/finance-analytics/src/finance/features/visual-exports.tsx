import { useState } from "react";
import type { ReactNode } from "react";
import { Check, FileSpreadsheet, FileText } from "lucide-react";
import type { BarDatum } from "./bar-chart";
import type { DataTable } from "../lib/types";
import { exportCsv, exportExcel } from "../lib/export";
import { Tooltip } from "../primitives";

export interface VisualExportsProps {
  /** Visual title — becomes the measure column header and the file name. */
  title: string;
  /** The exact series the visual plots, exported at full precision. */
  data: BarDatum[];
  /** Optional classification banner carried into the exported file. */
  classification?: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "visual";
}

function toTable(title: string, data: BarDatum[]): DataTable {
  return {
    columns: [
      { key: "label", label: "Category" },
      { key: "value", label: title || "Value", numeric: true },
    ],
    rows: data.map((d) => ({ label: d.label, value: d.value })),
  };
}

function ActionButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {active ? <Check className="size-4 text-success" /> : children}
      </button>
    </Tooltip>
  );
}

/**
 * The standardized per-visual data export cluster — CSV + Excel of the exact
 * series the chart plots. Rendered into a VisualFrame's hover `actions` slot so
 * every framed visual across the org gets identical, Power BI-style exports.
 */
export function VisualExports({ title, data, classification }: VisualExportsProps) {
  const [done, setDone] = useState<null | "csv" | "xls">(null);
  const flash = (which: "csv" | "xls") => {
    setDone(which);
    window.setTimeout(() => setDone(null), 1500);
  };

  if (!data.length) return null;
  const base = slug(title);

  return (
    <>
      <ActionButton label="Export data (CSV)" active={done === "csv"} onClick={() => { exportCsv(toTable(title, data), `${base}.csv`, { classification }); flash("csv"); }}>
        <FileText className="size-4" />
      </ActionButton>
      <ActionButton label="Export data (Excel)" active={done === "xls"} onClick={() => { exportExcel(toTable(title, data), `${base}.xlsx`, { classification }); flash("xls"); }}>
        <FileSpreadsheet className="size-4" />
      </ActionButton>
    </>
  );
}
