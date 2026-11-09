// In-memory KPI cube of the current fiscal year (country x product x month x KPI)
// with all scenarios, plus the previous year's actuals as PY. Every filter and
// view switch is answered from here, so the dashboard reacts instantly.

export type BaseScenario = 'AC' | 'PL1' | 'PL2' | 'FC1' | 'FC2' | 'FC3' | 'PY';
export const STORED: BaseScenario[] = ['AC', 'PL1', 'PL2', 'FC1', 'FC2', 'FC3', 'PY'];

export type PlanVersion = 'PL1' | 'PL2';
export type FcVersion = 'FC1' | 'FC2' | 'FC3';

/** Scenarios a view compares. ACT = actuals, completed by the forecast after the last actual month. */
export type Scen = 'ACT' | 'PY' | 'PL' | 'FC';
export type RefScen = Exclude<Scen, 'ACT'>;

export interface BaseKpi {
  id: string; // KPI name in the model, e.g. "Revenue"
  group: string;
  unit: string; // EUR | units | count | km | points
  higherBetter: boolean;
  sort: number;
}

export interface Market {
  land: string;
  region: string;
  reife: string;
}
export interface Product {
  produkt: string;
  kategorie: string;
  linie: string;
}

export interface Cube {
  year: number;
  /** Last month (1..12) with actuals. */
  lastAc: number;
  kpis: BaseKpi[];
  markets: Market[];
  products: Product[];
  /** Scenario display names from the model (e.g. PL1 → Budget). */
  scenarioNames: Record<string, string>;
  /** values[scenario][idx(c,p,m,k)], NaN = blank. */
  values: Record<BaseScenario, Float64Array>;
}

export const MONTHS = 12;

export function cubeIndex(cube: Pick<Cube, 'products' | 'kpis'>, c: number, p: number, m: number, k: number): number {
  return ((c * cube.products.length + p) * MONTHS + m) * cube.kpis.length + k;
}

export function emptyCube(year: number, lastAc: number, kpis: BaseKpi[], markets: Market[], products: Product[]): Cube {
  const n = markets.length * products.length * MONTHS * kpis.length;
  const values = {} as Record<BaseScenario, Float64Array>;
  for (const s of STORED) values[s] = new Float64Array(n).fill(NaN);
  return { year, lastAc, kpis, markets, products, values, scenarioNames: {} };
}

/** Optional member filters (indexes into cube.markets / cube.products). */
export interface MemberFilter {
  markets: Set<number> | null;
  products: Set<number> | null;
}

export const NO_FILTER: MemberFilter = { markets: null, products: null };

/** Average instead of sum for score KPIs. */
export const AVERAGED = new Set(['Customer Satisfaction']);

/**
 * Aggregates one stored scenario of one base KPI over the given months (1-based)
 * and member filter. Returns NaN when nothing is present.
 */
export function aggBase(cube: Cube, sc: BaseScenario, k: number, months: number[], f: MemberFilter): number {
  const arr = cube.values[sc];
  const avg = AVERAGED.has(cube.kpis[k].id);
  let sum = 0;
  let n = 0;
  const C = cube.markets.length;
  const P = cube.products.length;
  for (let c = 0; c < C; c++) {
    if (f.markets && !f.markets.has(c)) continue;
    for (let p = 0; p < P; p++) {
      if (f.products && !f.products.has(p)) continue;
      for (const m of months) {
        const v = arr[cubeIndex(cube, c, p, m - 1, k)];
        if (!Number.isNaN(v)) {
          sum += v;
          n++;
        }
      }
    }
  }
  if (n === 0) return NaN;
  return avg ? sum / n : sum;
}

export interface ScenarioChoice {
  plan: PlanVersion;
  fc: FcVersion;
}

/**
 * Base KPI value of a view scenario. ACT takes actuals for closed months and
 * the chosen forecast for open months, so a full year reads as AC+FC.
 */
export function aggScen(cube: Cube, scen: Scen, k: number, months: number[], f: MemberFilter, ch: ScenarioChoice): number {
  if (scen === 'PY') return aggBase(cube, 'PY', k, months, f);
  if (scen === 'PL') return aggBase(cube, ch.plan, k, months, f);
  if (scen === 'FC') return aggBase(cube, ch.fc, k, months, f);
  const closed = months.filter((m) => m <= cube.lastAc);
  const open = months.filter((m) => m > cube.lastAc);
  if (AVERAGED.has(cube.kpis[k].id)) {
    // Average over all months: weight by month count.
    const a = closed.length ? aggBase(cube, 'AC', k, closed, f) : NaN;
    const b = open.length ? aggBase(cube, ch.fc, k, open, f) : NaN;
    if (Number.isNaN(a)) return b;
    if (Number.isNaN(b)) return a;
    return (a * closed.length + b * open.length) / months.length;
  }
  const a = closed.length ? aggBase(cube, 'AC', k, closed, f) : 0;
  const b = open.length ? aggBase(cube, ch.fc, k, open, f) : 0;
  return (Number.isNaN(a) ? 0 : a) + (Number.isNaN(b) ? 0 : b);
}
