/**
 * Excel reading and writing.
 *
 * The only file that imports the Excel library. It runs inside a web worker
 * (`excel.worker.ts`), which has no access to the page, its session storage
 * or any token: an uploaded file is untrusted input.
 *
 * Every cell is written as text. A group or person name that starts with
 * `=` must not become a formula when the export is opened.
 */
import ExcelJS from 'exceljs';

export const SHEET_READ_LIMITS = { bytes: 2_000_000, rows: 5000, columns: 40, cell: 4000 } as const;

export type TextTable = { header: string[]; rows: Record<string, string>[] };

export interface WriteOptions {
  sheetName: string;
  columns: readonly string[];
  rows: readonly Record<string, string>[];
  /** Dropdown choices per column, for the editable ones. */
  choices?: Record<string, readonly string[]>;
  /** Extra data rows that receive the dropdowns, for typing new lines. */
  spareRows?: number;
}

export async function writeWorkbook(options: WriteOptions): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName);

  sheet.columns = options.columns.map((name) => ({
    header: name,
    key: name,
    width: Math.max(14, Math.min(48, name.length + 6)),
    // '@' is the text format: what is typed stays text.
    style: { numFmt: '@' },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of options.rows) {
    const added = sheet.addRow(options.columns.map((c) => String(row[c] ?? '')));
    added.eachCell({ includeEmpty: true }, (cell) => {
      // Force the string type explicitly; never a formula, number or date.
      cell.value = String(cell.value ?? '');
      cell.numFmt = '@';
    });
  }

  const lastRow = options.rows.length + 1 + (options.spareRows ?? 0);
  for (const [column, values] of Object.entries(options.choices ?? {})) {
    const index = options.columns.indexOf(column);
    if (index < 0 || values.length === 0) continue;
    const list = '"' + values.join(',') + '"';
    for (let r = 2; r <= lastRow; r++) {
      sheet.getCell(r, index + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
    }
  }

  // The library returns a Node Buffer or a typed array depending on the
  // runtime, never a plain ArrayBuffer. A worker can only transfer a real one,
  // so copy the exact bytes into a fresh ArrayBuffer.
  const written = (await workbook.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;
  const bytes = written instanceof ArrayBuffer ? new Uint8Array(written) : new Uint8Array(written.buffer, written.byteOffset, written.byteLength);
  return bytes.slice().buffer;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Formula, rich text, hyperlink, error: take what a person would see,
    // never the formula itself.
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join('');
    if (v.result !== undefined && v.result !== null && typeof v.result !== 'object') return String(v.result);
    if (typeof v.text === 'string') return v.text;
    return '';
  }
  return String(value);
}

/** Read the first worksheet as a table of text. Throws a short code on bad input. */
export async function readWorkbook(buffer: ArrayBuffer): Promise<TextTable> {
  if (buffer.byteLength > SHEET_READ_LIMITS.bytes) throw new Error('too-large');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('not-a-workbook');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('no-sheet');
  if (sheet.rowCount > SHEET_READ_LIMITS.rows + 1 || sheet.columnCount > SHEET_READ_LIMITS.columns) {
    throw new Error('too-large');
  }

  const header: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col - 1] = cellText(cell).trim();
  });

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, string> = {};
    let any = false;
    header.forEach((name, index) => {
      if (!name) return;
      const text = cellText(row.getCell(index + 1)).slice(0, SHEET_READ_LIMITS.cell);
      if (text.trim()) any = true;
      record[name] = text;
    });
    if (any) rows.push(record);
  }
  return { header: header.filter(Boolean), rows };
}
