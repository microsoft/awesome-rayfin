import type { CellValue, DataTable } from "./types";
import { buildXlsx } from "./xlsx";

function fmt(v: CellValue): string {
  return v == null ? "" : String(v);
}

/** Neutralize CSV/Excel formula-injection (cells starting with = + - @ tab/CR). */
function deFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV — pure JS, zero dependencies, instant. Formula-injection safe. */
export function exportCsv(table: DataTable, filename = "export.csv", opts: { classification?: string } = {}) {
  const esc = (s: string) => {
    const g = deFormula(s);
    return /[",\n]/.test(g) ? `"${g.replace(/"/g, '""')}"` : g;
  };
  const header = table.columns.map((c) => esc(c.label)).join(",");
  const lines = table.rows.map((r) =>
    table.columns.map((c) => esc(fmt(r[c.key]))).join(","),
  );
  const banner = opts.classification ? [esc(`Classification: ${opts.classification}`), ""] : [];
  download(new Blob([[...banner, header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" }), filename);
}

/** Excel — a genuine, zero-dependency .xlsx (OOXML) workbook. Opens natively in
 *  Excel with no format-mismatch warning; numeric cells stay numeric. */
export function exportExcel(table: DataTable, filename = "export.xlsx", opts: { classification?: string } = {}) {
  const name = filename.endsWith(".xls") ? `${filename}x` : filename;
  const blob = buildXlsx({
    columns: table.columns.map((c) => ({ key: c.key, label: c.label })),
    rows: table.rows,
    classification: opts.classification,
    sheetName: "Data",
  });
  download(blob, name);
}

/** PowerPoint — heavy dep is DYNAMICALLY IMPORTED so it never ships until used. */
export async function exportPptx(table: DataTable, opts: { title?: string; classification?: string } = {}) {
  const { default: Pptx } = await import("pptxgenjs");
  const deck = new Pptx();
  deck.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  deck.layout = "WIDE";
  const slide = deck.addSlide();
  slide.addText(opts.title ?? "Fabric App Export", { x: 0.5, y: 0.3, fontSize: 24, bold: true });
  const rows = [
    table.columns.map((c) => ({ text: c.label, options: { bold: true, fill: { color: "0F6CBD" }, color: "FFFFFF" } })),
    ...table.rows.map((r) => table.columns.map((c) => ({ text: fmt(r[c.key]) }))),
  ];
  // pptxgenjs table cell typing is loose across versions — cast keeps consumer builds green.
  slide.addTable(rows as never, { x: 0.5, y: 1.1, w: 12.3, fontSize: 10, border: { type: "solid", color: "E0E0E0", pt: 1 } });
  if (opts.classification) {
    slide.addText(opts.classification, { x: 0.5, y: 7.05, w: 12.3, fontSize: 9, color: "8A8A8A", align: "center" });
  }
  await deck.writeFile({ fileName: `${(opts.title ?? "export").replace(/\s+/g, "-")}.pptx` });
}
