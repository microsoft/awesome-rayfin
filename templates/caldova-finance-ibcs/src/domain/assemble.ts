import type { Account, Drivers, Month, Snapshot, Values } from './types';

/**
 * The three DAX queries that read the statements from the model, and how their rows become a Snapshot.
 * Used by live mode (services/liveModel.ts); tools/bake-snapshot.mjs runs the same queries and mapping.
 */
export const QUERIES = {
  accounts: `EVALUATE 'Account' ORDER BY 'Account'[Sort]`,
  months: `EVALUATE 'Month' ORDER BY 'Month'[Month]`,
  values: `EVALUATE SELECTCOLUMNS ( 'Statement Value', "a", 'Statement Value'[AccountID], "m", 'Statement Value'[Month], "s", 'Statement Value'[Scenario], "v", 'Statement Value'[Amount] )`,
} as const;

type Row = Record<string, unknown>;

/** Column keys come back as 'Table'[Column] or [Name]; keep the part in the last brackets. */
export const plain = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.includes('[') ? k.slice(k.lastIndexOf('[') + 1, -1) : k, v]));

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const yes = (v: unknown) => v === true || v === 'True' || v === 'true' || v === 1;

export function assembleSnapshot(rows: { accounts: Row[]; months: Row[]; values: Row[] }, drivers: Drivers, source: string): Snapshot {
  const accounts: Account[] = rows.accounts.map(plain).map((a) => ({
    id: str(a.AccountID),
    statement: str(a.Statement) as Account['statement'],
    parentId: str(a.ParentID) || null,
    name: str(a.Name),
    rowType: str(a.RowType) as Account['rowType'],
    sign: Number(a.Sign) < 0 ? -1 : 1,
    formula: str(a.Formula),
    goodUp: a.GoodDirection === 'up' ? true : a.GoodDirection === 'down' ? false : null,
    sort: Number(a.Sort),
  }));
  const months: Month[] = rows.months.map(plain).map((m) => ({
    id: str(m.Month),
    year: Number(m.Year),
    monthNo: Number(m.MonthNo),
    label: str(m.MonthName),
    closed: yes(m.Closed),
  }));
  const values: Values = { AC: {}, PY: {}, PL: {}, FC: {} };
  for (const r of rows.values.map(plain)) {
    const s = str(r.s) as keyof Values;
    if (!(s in values)) throw new Error(`unknown scenario ${s}`);
    (values[s][str(r.m)] ??= {})[str(r.a)] = Math.round(Number(r.v) * 100) / 100;
  }
  const cutoff = months.filter((m) => m.closed).at(-1)?.id;
  if (!cutoff) throw new Error('the model has no closed month');
  if (drivers.cutoff !== cutoff) throw new Error(`the drivers are for cut-off ${drivers.cutoff}, the model's last closed month is ${cutoff}`);
  return {
    meta: { company: drivers.company, currency: drivers.currency, cutoff, bakedAt: new Date().toISOString(), source },
    accounts,
    months,
    values,
    drivers,
  };
}
