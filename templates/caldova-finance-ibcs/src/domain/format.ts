/** Number formats: thousands of the currency, no decimals; percentages with one decimal; English. */

const k = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const p1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** 1234567 -> "1,235" (kEUR). Zero shows as "0"; missing as an empty cell. */
export function fmtK(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  const r = Math.round(v / 1000);
  return r === 0 ? '0' : k.format(r).replace('-', '−');
}

/** Signed delta in kEUR: "+1,235" / "−1,235". */
export function fmtDeltaK(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  const r = Math.round(v / 1000);
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + k.format(Math.abs(r));
}

/** Ratio as percent: 0.123 -> "12.3%". */
export function fmtPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  return `${p1.format(v * 100).replace('-', '−')}%`;
}

/** Signed relative delta: "+4.2%". */
export function fmtDeltaPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  const r = Math.round(v * 1000) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : '−'}${p1.format(Math.abs(r))}%`;
}

/** Percentage points for KPI rows: "+0.4 pp". */
export function fmtDeltaPp(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  const r = Math.round(v * 1000) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${p1.format(Math.abs(r))} pp`;
}

/** Days with one decimal. */
export const fmtDays = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : `${p1.format(v)} d`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09" -> "Sep 2026". */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
/** "2026-09" -> "September 2026". */
export const monthLong = (m: string) => `${MONTHS_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
/** "2026-09" -> "Sep". */
export const monthShort = (m: string) => MONTHS[Number(m.slice(5)) - 1];
