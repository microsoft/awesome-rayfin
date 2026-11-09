// View state of the cockpit (period, comparison, versions, selected KPI,
// cross-filters, chart variants), mirrored into the URL hash for sharing.

import type { Cube, FcVersion, MemberFilter, PlanVersion, RefScen, ScenarioChoice } from './cube';

export type PeriodKind = 'ytd' | 'fy' | 'month';
export type TimeVariant = 'integrated' | 'columns' | 'line' | 'cumulative';
export type StructDim = 'region' | 'land' | 'kategorie' | 'produkt';
export type StructSort = 'value' | 'delta';

export interface View {
  period: PeriodKind;
  month: number; // used when period === 'month'
  ref: RefScen; // primary comparison
  plan: PlanVersion;
  fc: FcVersion;
  kpi: string;
  timeVariant: TimeVariant;
  structDim: StructDim;
  structSort: StructSort;
  /** Cross-filters by member name (stable across reloads). */
  markets: string[];
  products: string[];
}

export const DEFAULT_VIEW: View = {
  period: 'ytd',
  month: 0,
  ref: 'PL',
  plan: 'PL1',
  fc: 'FC3',
  kpi: 'Revenue',
  timeVariant: 'integrated',
  structDim: 'land',
  structSort: 'value',
  markets: [],
  products: [],
};

export function monthsOf(v: View, cube: Pick<Cube, 'lastAc'>): number[] {
  if (v.period === 'fy') return Array.from({ length: 12 }, (_, i) => i + 1);
  if (v.period === 'month') return [v.month || cube.lastAc];
  return Array.from({ length: cube.lastAc }, (_, i) => i + 1);
}

export function choiceOf(v: View): ScenarioChoice {
  return { plan: v.plan, fc: v.fc };
}

export function filterOf(v: View, cube: Cube): MemberFilter {
  const m = v.markets.length ? new Set(v.markets.map((n) => cube.markets.findIndex((x) => x.land === n)).filter((i) => i >= 0)) : null;
  const p = v.products.length ? new Set(v.products.map((n) => cube.products.findIndex((x) => x.produkt === n)).filter((i) => i >= 0)) : null;
  return { markets: m, products: p };
}

/** IBCS code of the primary scenario for the current period. */
export function primaryCode(v: View, cube: Pick<Cube, 'lastAc'>): 'AC' | 'FC' | 'AC&FC' {
  const ms = monthsOf(v, cube);
  const anyOpen = ms.some((m) => m > cube.lastAc);
  const anyClosed = ms.some((m) => m <= cube.lastAc);
  if (anyOpen && anyClosed) return 'AC&FC';
  return anyOpen ? 'FC' : 'AC';
}

export function refCode(r: RefScen): string {
  return r;
}

// ---------- URL hash ----------

const KEYS: (keyof View)[] = ['period', 'month', 'ref', 'plan', 'fc', 'kpi', 'timeVariant', 'structDim', 'structSort'];

export function toHash(v: View): string {
  const p = new URLSearchParams();
  for (const k of KEYS) if (v[k] !== DEFAULT_VIEW[k]) p.set(k, String(v[k]));
  if (v.markets.length) p.set('m', v.markets.join('|'));
  if (v.products.length) p.set('p', v.products.join('|'));
  const s = p.toString();
  return s ? '#' + s : '';
}

export function fromHash(hash: string): View {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const v: View = { ...DEFAULT_VIEW };
  const pick = <K extends keyof View>(k: K, allowed: readonly string[]) => {
    const x = p.get(k as string);
    if (x && allowed.includes(x)) (v[k] as unknown) = x;
  };
  pick('period', ['ytd', 'fy', 'month']);
  pick('ref', ['PY', 'PL', 'FC']);
  pick('plan', ['PL1', 'PL2']);
  pick('fc', ['FC1', 'FC2', 'FC3']);
  pick('timeVariant', ['integrated', 'columns', 'line', 'cumulative']);
  pick('structDim', ['region', 'land', 'kategorie', 'produkt']);
  pick('structSort', ['value', 'delta']);
  const month = Number(p.get('month'));
  if (month >= 1 && month <= 12) v.month = month;
  if (p.get('kpi')) v.kpi = p.get('kpi')!;
  if (p.get('m')) v.markets = p.get('m')!.split('|').filter(Boolean);
  if (p.get('p')) v.products = p.get('p')!.split('|').filter(Boolean);
  return v;
}
