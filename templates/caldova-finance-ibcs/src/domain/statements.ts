import type { Account, Scenario, Snapshot, Statement } from './types';

/** Month or year-to-date. Balance sheet rows always show the balance at the end of the period. */
export type PeriodMode = 'MTD' | 'YTD';

export interface Period {
  month: string;
  mode: PeriodMode;
}

/** Months a period covers: the month itself, or January up to it. */
export function periodMonths(p: Period): string[] {
  if (p.mode === 'MTD') return [p.month];
  const [y, m] = p.month.split('-').map(Number);
  return Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}

/** Leaf and balance values of one scenario, summed (flows) or taken at the end (balances) over a period. */
export function leafValues(
  snapshot: Snapshot,
  values: Record<string, Record<string, number>>,
  statement: Statement,
  p: Period
): Record<string, number> {
  const out: Record<string, number> = {};
  const months = periodMonths(p);
  const isBalance = (a: Account) => statement === 'BS' || a.rowType === 'Balance';
  for (const a of snapshot.accounts) {
    if (a.statement !== statement || (a.rowType !== 'Account' && a.rowType !== 'Balance')) continue;
    if (isBalance(a)) {
      // Opening cash of a YTD cash flow is the balance before its first month; closing is at its last month.
      const at = a.id === 'C-OPEN' ? months[0] : months[months.length - 1];
      const v = values[at]?.[a.id];
      if (v !== undefined) out[a.id] = v;
    } else {
      let s = 0;
      let any = false;
      for (const m of months) {
        const v = values[m]?.[a.id];
        if (v !== undefined) {
          s += v;
          any = true;
        }
      }
      if (any) out[a.id] = s;
    }
  }
  return out;
}

/**
 * Evaluate the two formula shapes the account tree uses, `[A] + [B] - [C]` and `[A] / [B]`, over already
 * computed row values. No eval: hosted apps may run under a CSP without 'unsafe-eval'.
 */
export function evalFormula(formula: string, rows: Record<string, number>): number {
  const ref = (s: string) => {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(s);
    if (!m) throw new Error(`unsupported formula ${formula}`);
    const v = rows[m[1]];
    return v === undefined ? NaN : v;
  };
  if (formula.includes('/')) {
    const [a, b] = formula.split('/');
    const d = ref(b);
    return d === 0 ? NaN : ref(a) / d;
  }
  let sum = 0;
  for (const m of formula.matchAll(/([+-]?)\s*(\[[^\]]+\])/g)) sum += (m[1] === '-' ? -1 : 1) * ref(m[2]);
  return sum;
}

/**
 * Every row of a statement: leaves as given, subtotals as the signed sum of their children, formulas and KPIs
 * evaluated in tree order. Returns undefined for a row when none of its inputs exist (e.g. AC of an open month).
 */
export function rowValues(snapshot: Snapshot, statement: Statement, leaves: Record<string, number>): Record<string, number> {
  const accounts = snapshot.accounts.filter((a) => a.statement === statement).sort((a, b) => a.sort - b.sort);
  const children = new Map<string, Account[]>();
  for (const a of accounts) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const rows: Record<string, number> = {};
  const visit = (a: Account): number | undefined => {
    if (a.id in rows) return rows[a.id];
    if (a.rowType === 'Account' || a.rowType === 'Balance') {
      if (a.id in leaves) rows[a.id] = leaves[a.id];
      return rows[a.id];
    }
    if (a.rowType === 'Subtotal') {
      let s = 0;
      let any = false;
      for (const c of children.get(a.id) ?? []) {
        const v = visit(c);
        if (v === undefined) continue;
        // P&L values are already signed; balance sheet and cash flow trees add with the child's sign.
        s += statement === 'PL' ? v : c.sign * v;
        any = true;
      }
      if (any) rows[a.id] = s;
      return rows[a.id];
    }
    return undefined;
  };
  for (const a of accounts) visit(a);
  // Formulas and KPIs after all subtotals, in sort order (each may use the one before).
  for (const a of accounts) {
    if (a.rowType === 'Formula' || a.rowType === 'KPI') {
      if (a.formula) {
        const v = evalFormula(a.formula, rows);
        if (!Number.isNaN(v) || a.rowType === 'KPI') rows[a.id] = v;
      } else if (a.id === 'C-NET') {
        const parts = ['C-OP', 'C-IN', 'C-FI'].map((id) => rows[id]);
        if (parts.every((v) => v !== undefined)) rows[a.id] = parts.reduce((s, v) => s + v, 0);
      }
    }
  }
  return rows;
}

/** Row values of one scenario for a period, ready for a table. */
export function statementRows(
  snapshot: Snapshot,
  values: Record<string, Record<string, number>>,
  statement: Statement,
  p: Period
): Record<string, number> {
  return rowValues(snapshot, statement, leafValues(snapshot, values, statement, p));
}

/** The comparison scenarios of the app: what AC (or FC in open months) is compared against. */
export type Comparison = Extract<Scenario, 'PL' | 'PY'>;
