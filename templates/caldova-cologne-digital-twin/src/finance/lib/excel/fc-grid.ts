// Forecast grid for the Excel round-trip: one row per account, one column per
// open month. The workbook carries the model values in a hidden basis sheet, so
// an upload is compared cell by cell and only real changes become adjustments.

export interface FcCell {
  account: string;
  name: string;
  l2: string;
  l3: string;
  month: string; // YYYY-MM
  fc: number; // model value (unsigned, EUR)
}

export interface FcGrid {
  year: number;
  l1: string;
  months: string[];
  accounts: { id: string; name: string; l2: string; l3: string }[];
  /** Model FC per account|month. */
  base: Map<string, number>;
  /** Value shown in the template: newest adjustment, else model FC. */
  current: Map<string, number>;
}

const key = (a: string, m: string) => `${a}|${m}`;

export function buildGrid(year: number, l1: string, cells: FcCell[], adjusted: Map<string, { new_value: number }>): FcGrid {
  const months = [...new Set(cells.map((c) => c.month))].sort();
  const acc = new Map<string, FcGrid['accounts'][number]>();
  const base = new Map<string, number>();
  const current = new Map<string, number>();
  for (const c of cells) {
    if (!acc.has(c.account)) acc.set(c.account, { id: c.account, name: c.name, l2: c.l2, l3: c.l3 });
    const k = key(c.account, c.month);
    base.set(k, c.fc);
    current.set(k, adjusted.get(k)?.new_value ?? c.fc);
  }
  const accounts = [...acc.values()].sort((a, b) => a.l2.localeCompare(b.l2) || a.l3.localeCompare(b.l3) || a.id.localeCompare(b.id));
  return { year, l1, months, accounts, base, current };
}

export interface UploadRow {
  account: string;
  values: Record<string, unknown>; // month -> cell value
}

export interface GridChange {
  account_id: string;
  name: string;
  month: string;
  base_value: number;
  previous: number;
  new_value: number;
}

export interface DiffResult {
  changes: GridChange[];
  errors: string[];
  unknownAccounts: string[];
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return toNumber((v as { result: unknown }).result); // formula cell
  if (typeof v === 'string') {
    const s = v.trim().replace(/\s/g, '');
    if (!s) return null;
    // German or English notation: 1.234,56 / 1,234.56 / 1234,56
    const norm = /,\d{1,2}$/.test(s) ? s.replaceAll('.', '').replace(',', '.') : s.replaceAll(',', '');
    const n = Number(norm);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compares an uploaded grid with the values the template was built from. */
export function diffGrid(grid: FcGrid, rows: UploadRow[], tolerance = 0.005): DiffResult {
  const known = new Map(grid.accounts.map((a) => [a.id, a]));
  const changes: GridChange[] = [];
  const errors: string[] = [];
  const unknownAccounts: string[] = [];
  for (const r of rows) {
    const a = known.get(r.account);
    if (!a) {
      if (r.account) unknownAccounts.push(r.account);
      continue;
    }
    for (const m of grid.months) {
      const raw = r.values[m];
      if (raw === undefined || raw === null || raw === '') continue;
      const v = toNumber(raw);
      const k = key(a.id, m);
      if (v === null) {
        errors.push(`${a.id} ${m}: "${String(raw)}" is not a number`);
        continue;
      }
      const prev = grid.current.get(k) ?? 0;
      if (Math.abs(v - prev) > tolerance)
        changes.push({ account_id: a.id, name: a.name, month: m, base_value: grid.base.get(k) ?? 0, previous: prev, new_value: Math.round(v * 100) / 100 });
    }
  }
  return { changes, errors, unknownAccounts };
}
