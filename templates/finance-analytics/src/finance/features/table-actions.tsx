import { useState } from "react";
import { Check, Copy, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import type { DataTable } from "../lib/types";
import { exportCsv, exportExcel, exportPptx } from "../lib/export";
import { copyTable } from "../lib/clipboard";
import { cn } from "../lib/cn";

export type TableExportFormat = "copy" | "csv" | "excel" | "pptx";

export interface TableActionsProps {
  /** Title used for the file name and the deck slide. */
  title: string;
  /** Returns the *raw numeric* export table. A thunk so it's only built on demand. */
  getTable: () => DataTable;
  /** Base file name (no extension). Defaults to a slug of `title`. */
  filename?: string;
  /** Governance banner carried into every export. */
  classification?: string;
  /** Audit hook — mirrors the top-nav export governance callback. */
  onExport?: (evt: { format: TableExportFormat; rows: number; filename: string }) => void;
  /** Trim the set of offered actions. Defaults to all four. */
  formats?: TableExportFormat[];
  className?: string;
}

const toolBtn =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The reusable per-table export/copy cluster. Every finance table wears one so a
 * user can push any table straight into Excel — either via the same export
 * formats as the top nav (CSV / Excel / PowerPoint) or a one-click rich copy that
 * pastes natively into a spreadsheet with real numeric cells.
 */
export function TableActions({
  title,
  getTable,
  filename,
  classification,
  onExport,
  formats = ["copy", "csv", "excel", "pptx"],
  className,
}: TableActionsProps) {
  const [copied, setCopied] = useState(false);
  const slug = (filename ?? title).replace(/\s+/g, "-").toLowerCase();

  const audit = (format: TableExportFormat, rows: number, name: string) =>
    onExport?.({ format, rows, filename: name });

  const handleCopy = async () => {
    const table = getTable();
    const ok = await copyTable(table);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      audit("copy", table.rows.length, `${slug} (clipboard)`);
    }
  };

  const handleCsv = () => {
    const table = getTable();
    const name = `${slug}.csv`;
    exportCsv(table, name, { classification });
    audit("csv", table.rows.length, name);
  };

  const handleExcel = () => {
    const table = getTable();
    const name = `${slug}.xlsx`;
    exportExcel(table, name, { classification });
    audit("excel", table.rows.length, name);
  };

  const handlePptx = async () => {
    const table = getTable();
    await exportPptx(table, { title, classification });
    audit("pptx", table.rows.length, `${slug}.pptx`);
  };

  return (
    <div className={cn("flex items-center gap-xxs", className)}>
      {formats.includes("copy") ? (
        <button type="button" className={toolBtn} onClick={handleCopy} aria-label={`Copy ${title} to clipboard`} title="Copy — paste straight into Excel">
          {copied ? <Check size={13} className="text-[var(--color-positive,#16a34a)]" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      ) : null}
      {formats.includes("csv") ? (
        <button type="button" className={toolBtn} onClick={handleCsv} aria-label={`Export ${title} as CSV`} title="Export CSV">
          <FileText size={13} />
          CSV
        </button>
      ) : null}
      {formats.includes("excel") ? (
        <button type="button" className={toolBtn} onClick={handleExcel} aria-label={`Export ${title} as Excel`} title="Export Excel (.xlsx)">
          <FileSpreadsheet size={13} />
          Excel
        </button>
      ) : null}
      {formats.includes("pptx") ? (
        <button type="button" className={toolBtn} onClick={handlePptx} aria-label={`Export ${title} to PowerPoint`} title="Export to PowerPoint">
          <Presentation size={13} />
          PPTX
        </button>
      ) : null}
    </div>
  );
}
