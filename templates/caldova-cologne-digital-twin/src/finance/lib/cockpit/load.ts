// Turns the connector's query tables into the in-memory cube.

import { cubeIndex, emptyCube, type BaseKpi, type BaseScenario, type Cube, type Market, type Product } from './cube';

export interface QueryTableLike {
  columns: { name: string }[];
  rows: unknown[][];
}

/** Column accessor by bare name ("dim-market[Country]" → "Country", "[AC]" → "AC"). */
function cols(t: QueryTableLike) {
  const idx = new Map<string, number>();
  t.columns.forEach((c, i) => idx.set(c.name.replace(/^.*\[/, '').replace(/\]$/, ''), i));
  return (name: string) => {
    const i = idx.get(name);
    if (i === undefined) throw new Error(`Column "${name}" is missing from the query result.`);
    return i;
  };
}

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => {
  if (v == null || v === '') return NaN;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const bool = (v: unknown) => v === true || str(v).toLowerCase() === 'true';

export interface CubeTables {
  info: QueryTableLike;
  kpis: QueryTableLike;
  maerkte: QueryTableLike;
  produkte: QueryTableLike;
  wuerfel: QueryTableLike;
  vorjahr: QueryTableLike;
  szenarien?: QueryTableLike;
}

export function buildCube(t: CubeTables): Cube {
  const ci = cols(t.info);
  const infoRow = t.info.rows[0] ?? [];
  const year = num(infoRow[ci('year')]);
  const lastAc = num(infoRow[ci('month')]);
  if (!Number.isFinite(year) || !Number.isFinite(lastAc)) throw new Error('No actual month found in the model.');

  const ck = cols(t.kpis);
  const kpis: BaseKpi[] = t.kpis.rows
    .map((r) => ({
      id: str(r[ck('kpi')]),
      group: str(r[ck('group')]),
      unit: str(r[ck('unit')]),
      higherBetter: bool(r[ck('higherIsBetter')]),
      sort: num(r[ck('sort')]),
    }))
    .filter((k) => k.id)
    .sort((a, b) => a.sort - b.sort);

  const cm = cols(t.maerkte);
  const markets: Market[] = t.maerkte.rows
    .map((r) => ({ land: str(r[cm('market')]), region: str(r[cm('region')]), reife: str(r[cm('maturity')]) }))
    .filter((m) => m.land);

  const cp = cols(t.produkte);
  const products: Product[] = t.produkte.rows
    .map((r) => ({ produkt: str(r[cp('product')]), kategorie: str(r[cp('category')]), linie: str(r[cp('line')]) }))
    .filter((p) => p.produkt);

  const cube = emptyCube(year, lastAc, kpis, markets, products);
  const mIdx = new Map(markets.map((m, i) => [m.land, i]));
  const pIdx = new Map(products.map((p, i) => [p.produkt, i]));
  const kIdx = new Map(kpis.map((k, i) => [k.id, i]));

  const fill = (table: QueryTableLike, scen: BaseScenario[]) => {
    const g = cols(table);
    const iC = g('Country');
    const iP = g('Product');
    const iM = g('Month');
    const iK = g('KPI');
    const iS = scen.map((s) => g(s));
    for (const r of table.rows) {
      const c = mIdx.get(str(r[iC]));
      const p = pIdx.get(str(r[iP]));
      const k = kIdx.get(str(r[iK]));
      const m = num(r[iM]);
      if (c === undefined || p === undefined || k === undefined || !(m >= 1 && m <= 12)) continue;
      const at = cubeIndex(cube, c, p, m - 1, k);
      scen.forEach((s, j) => {
        cube.values[s][at] = num(r[iS[j]]);
      });
    }
  };
  fill(t.wuerfel, ['AC', 'PL1', 'PL2', 'FC1', 'FC2', 'FC3']);
  fill(t.vorjahr, ['PY']);
  if (t.szenarien) {
    const cs = cols(t.szenarien);
    for (const r of t.szenarien.rows) cube.scenarioNames[str(r[cs('scenario')])] = str(r[cs('name')]);
  }
  return cube;
}
