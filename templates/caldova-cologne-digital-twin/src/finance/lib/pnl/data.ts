// Parses the connector's query tables into typed rows for the engine.

import type { KontoRow, KontoWert } from './engine';

export interface QueryTableLike {
  columns: { name: string }[];
  rows: unknown[][];
}

/** Rows arrive as arrays aligned with `columns`; index by the bare column name. */
function indexer(table: QueryTableLike) {
  const idx = new Map<string, number>();
  table.columns.forEach((c, i) => {
    const bare = c.name.replace(/^.*\[/, '').replace(/\]$/, '');
    idx.set(bare, i);
  });
  return (row: unknown[], col: string): unknown => {
    const i = idx.get(col);
    return i === undefined ? undefined : Array.isArray(row) ? row[i] : (row as Record<string, unknown>)[col];
  };
}

function str(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v: unknown): boolean {
  return v === true || str(v).toLowerCase() === 'true';
}

export function parseKonten(t: QueryTableLike): KontoRow[] {
  const g = indexer(t);
  return t.rows
    .map((r) => ({
      id: str(g(r, 'id')),
      parent: str(g(r, 'parent')),
      name: str(g(r, 'name')),
      l1: str(g(r, 'l1')),
      l2: str(g(r, 'l2')),
      l3: str(g(r, 'l3')),
      rowType: str(g(r, 'rowType')),
      formula: str(g(r, 'formula')),
      sign: num(g(r, 'sign')) || 1,
      displayInvert: bool(g(r, 'displayInvert')),
      varianceInvert: bool(g(r, 'varianceInvert')),
      sort: num(g(r, 'sort')),
    }))
    .filter((k) => k.id);
}

export function parseWerte(t: QueryTableLike): Map<string, KontoWert> {
  const g = indexer(t);
  const m = new Map<string, KontoWert>();
  for (const r of t.rows) {
    const id = str(g(r, 'AccountID'));
    if (!id) continue;
    m.set(id, {
      ac: num(g(r, 'AC')),
      fc: num(g(r, 'FC')),
      pl: num(g(r, 'PL')),
      py: num(g(r, 'PY')),
      plYtd: num(g(r, 'PLYTD')),
      pyYtd: num(g(r, 'PYYTD')),
    });
  }
  return m;
}

export interface MonatsWert {
  monat: string; // YYYY-MM
  line: string; // top-level line name (L1)
  ac: number;
  fc: number;
  pl: number;
  py: number;
}

/** Signed monthly values per top-level line. */
export function parseMonate(t: QueryTableLike): MonatsWert[] {
  const g = indexer(t);
  const acc = new Map<string, MonatsWert>();
  for (const r of t.rows) {
    const line = str(g(r, 'L1'));
    const monat = str(g(r, 'Month'));
    if (!line || !monat) continue;
    const s = num(g(r, 'SignConvention')) || 1;
    const key = `${monat}|${line}`;
    const cur = acc.get(key) ?? { monat, line, ac: 0, fc: 0, pl: 0, py: 0 };
    cur.ac += s * num(g(r, 'AC'));
    cur.fc += s * num(g(r, 'FC'));
    cur.pl += s * num(g(r, 'PL'));
    cur.py += s * num(g(r, 'PY'));
    acc.set(key, cur);
  }
  return [...acc.values()].sort((a, b) => a.monat.localeCompare(b.monat));
}

export interface JahrInfo {
  year: number;
  lastActual: string; // YYYY-MM
}

export function parseJahre(t: QueryTableLike): JahrInfo[] {
  const g = indexer(t);
  return t.rows
    .map((r) => ({ year: num(g(r, 'Year')), lastActual: str(g(r, 'lastActual')) }))
    .filter((y) => y.year > 0)
    .sort((a, b) => a.year - b.year);
}
