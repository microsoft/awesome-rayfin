import type { DisplayUnit, KpiDef } from './kpis';

const nf = (v: number, d: number) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');

/** Divisor and decimals per display unit. */
const SPEC: Record<DisplayUnit, { div: number; dec: number; suffix: string; long: string }> = {
  mio: { div: 1e6, dec: 1, suffix: '', long: 'mEUR' },
  tsd: { div: 1e3, dec: 1, suffix: '', long: 'k' },
  eur: { div: 1, dec: 0, suffix: '', long: 'EUR' },
  pts: { div: 1, dec: 1, suffix: '', long: 'points' },
  pct: { div: 0.01, dec: 1, suffix: '%', long: '%' },
  km: { div: 1, dec: 2, suffix: '', long: 'km' },
};

export function unitLabel(kpi: KpiDef): string {
  if (kpi.unit === 'tsd') return kpi.id === 'Units Sold' || kpi.id === 'Returned Units' ? 'k units' : kpi.id === 'Drops' ? 'k drops' : kpi.id === 'Tour km' ? 'k km' : 'k';
  return SPEC[kpi.unit].long;
}

/** Value in the KPI's display unit (no unit text, except % for ratios). */
export function fmt(kpi: KpiDef, v: number, extraDec = 0): string {
  if (!Number.isFinite(v)) return '–';
  const s = SPEC[kpi.unit];
  return nf(v / s.div, s.dec + extraDec) + s.suffix;
}

/** Signed absolute variance; percentage KPIs as percentage points. */
export function fmtDelta(kpi: KpiDef, d: number): string {
  if (!Number.isFinite(d)) return '–';
  const s = SPEC[kpi.unit];
  const txt = nf(Math.abs(d) / s.div, s.dec);
  const zero = Number(txt.replace(/[^\d.]/g, '')) === 0;
  const sign = zero ? '±' : d > 0 ? '+' : '−';
  return sign + txt + (kpi.unit === 'pct' ? ' pp' : '');
}

/** Relative variance as signed percent. */
export function fmtRel(r: number, dec = 1): string {
  if (!Number.isFinite(r)) return '–';
  const txt = nf(Math.abs(r) * 100, dec);
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + txt + '%';
}

export function relDelta(a: number, ref: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(ref) || ref === 0) return NaN;
  return (a - ref) / Math.abs(ref);
}

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** IBCS period notation, e.g. "Jan..Aug 2026". */
export function periodLabel(months: number[], year: number): string {
  if (months.length === 1) return `${MONTH_SHORT[months[0] - 1]} ${year}`;
  return `${MONTH_SHORT[months[0] - 1]}..${MONTH_SHORT[months[months.length - 1] - 1]} ${year}`;
}
