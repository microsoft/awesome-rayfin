export type Unit = 'mio' | 'tsd';

export const UNIT_LABEL: Record<Unit, string> = { mio: 'mEUR', tsd: 'kEUR' };

const DIV: Record<Unit, number> = { mio: 1e6, tsd: 1e3 };

export function fmtValue(v: number, unit: Unit): string {
  if (!Number.isFinite(v)) return '–';
  const x = v / DIV[unit];
  const digits = unit === 'mio' ? 1 : 0;
  if (Math.abs(x) < 0.05 && unit === 'mio' && v !== 0) return x < 0 ? '−0.0' : '0.0';
  return x.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−');
}

export function fmtDelta(v: number, unit: Unit): string {
  if (!Number.isFinite(v)) return '–';
  const s = fmtValue(Math.abs(v), unit);
  if (s === '0.0' || s === '0') return s;
  return (v >= 0 ? '+' : '−') + s;
}

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '–';
  return (v * 100).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
}

export function fmtDeltaPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '–';
  const s = Math.abs(v * 100).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v >= 0 ? '+' : '−') + s + '%';
}

/** Percentage-point delta for KPI lines (margins). */
export function fmtDeltaPp(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = Math.abs(v * 100).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (v >= 0 ? '+' : '−') + s + ' pp';
}

/** Relative variance with sign convention: signed delta over absolute comparison. */
export function relDelta(actual: number, compare: number): number {
  if (!compare) return NaN;
  return (actual - compare) / Math.abs(compare);
}

/** Text colour for a signed variance (positive is always good). */
export function deltaClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-muted-foreground';
  return v > 0 ? 'text-good' : 'text-bad';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ?? ym;
}
