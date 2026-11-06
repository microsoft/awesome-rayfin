import { statementRows, type Period } from './statements';
import type { Account, Snapshot, Statement, Values } from './types';

/** One table line: the three scenarios and the variances against PL and PY. */
export interface Line {
  account: Account;
  depth: number;
  hasChildren: boolean;
  cur?: number;
  pl?: number;
  py?: number;
  /** Absolute variances (current minus reference); for KPI rows the difference in ratio points. */
  dPl?: number;
  dPy?: number;
  /** Relative variances against the reference's absolute value; undefined for KPI rows. */
  rPl?: number;
  rPy?: number;
  /** Is a positive delta good for this line? (IBCS: colour by impact.) null: neutral, drawn grey. */
  goodUp: boolean | null;
  isKpi: boolean;
}

const rel = (d: number | undefined, ref: number | undefined) =>
  d === undefined || ref === undefined || ref === 0 ? undefined : d / Math.abs(ref);

/**
 * The PY reference of a statement. Flows (P&L, cash flow) compare with the same period one year earlier.
 * The balance sheet compares the month end with the PREVIOUS YEAR-END (the usual balance sheet comparison),
 * which is the PY value of December of the selected year.
 */
export function pyValues(snapshot: Snapshot, statement: Statement, p: Period): Record<string, number> {
  if (statement === 'BS') {
    const yearEnd = `${p.month.slice(0, 4)}-12`;
    return statementRows(snapshot, snapshot.values.PY, 'BS', { month: yearEnd, mode: 'MTD' });
  }
  return statementRows(snapshot, snapshot.values.PY, statement, p);
}

/** Every line of a statement for a period, in tree order, with its depth. */
export function statementLines(snapshot: Snapshot, current: Values['FC'], statement: Statement, p: Period): Line[] {
  const period = statement === 'BS' ? { month: p.month, mode: 'MTD' as const } : p;
  const cur = statementRows(snapshot, current, statement, period);
  const pl = statementRows(snapshot, snapshot.values.PL, statement, period);
  const py = pyValues(snapshot, statement, p);
  const accounts = snapshot.accounts.filter((a) => a.statement === statement).sort((a, b) => a.sort - b.sort);
  const children = new Map<string | null, Account[]>();
  for (const a of accounts) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const out: Line[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of children.get(parent) ?? []) {
      const isKpi = a.rowType === 'KPI';
      const c = cur[a.id];
      const dPl = c !== undefined && pl[a.id] !== undefined ? c - pl[a.id] : undefined;
      const dPy = c !== undefined && py[a.id] !== undefined ? c - py[a.id] : undefined;
      out.push({
        account: a,
        depth,
        hasChildren: (children.get(a.id)?.length ?? 0) > 0,
        cur: c,
        pl: pl[a.id],
        py: py[a.id],
        dPl,
        dPy,
        rPl: isKpi ? undefined : rel(dPl, pl[a.id]),
        rPy: isKpi ? undefined : rel(dPy, py[a.id]),
        goodUp: a.goodUp,
        isKpi,
      });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The lines to show: top level always, plus the children of every expanded line whose own parent is shown.
 * Balance sheet and cash flow are short enough to show expanded; the P&L opens one block at a time.
 */
export function visibleLines(lines: Line[], expanded: ReadonlySet<string>): Line[] {
  const shown = new Set<string>();
  return lines.filter((l) => {
    const visible = l.account.parentId === null || (shown.has(l.account.parentId) && expanded.has(l.account.parentId));
    if (visible) shown.add(l.account.id);
    return visible;
  });
}
