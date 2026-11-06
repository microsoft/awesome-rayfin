// Excel file for the forecast round-trip (exceljs, loaded only when used).
// Sheet "Forecast": account columns locked, one editable column per open month,
// prefilled with the current value (adjustment or model). Hidden sheet "_basis"
// names year, block and months so an upload is matched to its template.

import type { FcGrid, UploadRow } from './fc-grid';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (m: string) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export async function writeWorkbook(grid: FcGrid): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Finance Cockpit';
  const ws = wb.addWorksheet('Forecast', { views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }] });
  ws.addRow([`Forecast ${grid.l1} ${grid.year}: values in EUR, change only the yellow month columns`]);
  ws.mergeCells(1, 1, 1, 4 + grid.months.length);
  ws.getRow(1).font = { bold: true };
  const head = ws.addRow(['Account', 'Description', 'Area', 'Region', ...grid.months.map(label)]);
  head.font = { bold: true };
  for (const a of grid.accounts) ws.addRow([a.id, a.name, a.l2, a.l3, ...grid.months.map((m) => grid.current.get(`${a.id}|${m}`) ?? 0)]);
  ws.columns.forEach((c, i) => (c.width = i === 1 ? 34 : i < 4 ? 18 : 14));
  for (let r = 3; r <= ws.rowCount; r++) {
    for (let c = 5; c <= 4 + grid.months.length; c++) {
      const cell = ws.getCell(r, c);
      cell.numFmt = '#,##0.00';
      cell.protection = { locked: false };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6CC' } };
    }
  }
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true });

  const meta = wb.addWorksheet('_basis', { state: 'veryHidden' });
  meta.addRow(['year', grid.year]);
  meta.addRow(['l1', grid.l1]);
  meta.addRow(['months', ...grid.months]);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export interface ParsedUpload {
  year: number;
  l1: string;
  months: string[];
  rows: UploadRow[];
}

export async function readWorkbook(file: ArrayBuffer): Promise<ParsedUpload> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);
  const meta = wb.getWorksheet('_basis');
  const ws = wb.getWorksheet('Forecast');
  if (!meta || !ws) throw new Error('This is not a forecast template of this app (sheet "Forecast" or "_basis" is missing).');
  const year = Number(meta.getCell(1, 2).value);
  const l1 = String(meta.getCell(2, 2).value ?? '');
  const months: string[] = [];
  meta.getRow(3).eachCell((c, i) => i > 1 && months.push(String(c.value)));
  const rows: UploadRow[] = [];
  ws.eachRow((row, r) => {
    if (r < 3) return;
    const account = String(row.getCell(1).value ?? '').trim();
    const values: Record<string, unknown> = {};
    months.forEach((m, i) => (values[m] = row.getCell(5 + i).value));
    rows.push({ account, values });
  });
  return { year, l1, months, rows };
}
