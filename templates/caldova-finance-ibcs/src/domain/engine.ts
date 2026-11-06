import type { Account, Drivers, Snapshot, Values } from './types';

/**
 * The forecast engine: applies forecast adjustments to the P&L of the forecast months and rolls the
 * balance sheet and cash flow forward from the cut-off, with the same drivers and order of steps as
 * `tools/generate_statements.py#roll`. Without adjustments it must reproduce the baked FC values
 * (engine.spec.ts checks that against the snapshot).
 */

/** One forecast adjustment, in the account's natural orientation: +1000 on a cost account means more cost. */
export interface Adjustment {
  accountId: string;
  month: string;
  amount: number;
}

const TAX_ACCOUNTS = ['8000', '8010'] as const;
const DEP_FLEET = '7000';
const DEP_EQUIP = '7010';

export const isRevenueLeaf = (id: string) => id.startsWith('4000') || id.startsWith('4100');
export const isCogsLeaf = (id: string) => id.startsWith('5000');
export const isTaxLeaf = (id: string) => (TAX_ACCOUNTS as readonly string[]).includes(id);

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Forecast months after the cut-off, in order. */
export function forecastMonths(snapshot: Snapshot): string[] {
  return snapshot.months.map((m) => m.id).filter((id) => id > snapshot.meta.cutoff);
}

/** Can this account be adjusted? Only P&L leaves; taxes follow from the result and are never entered. */
export function isAdjustable(account: Account): boolean {
  return account.statement === 'PL' && account.rowType === 'Account' && !isTaxLeaf(account.id);
}

/**
 * The sign that turns an amount in natural orientation into the stored signed value (revenue +, cost -).
 * The stored values carry it already, so it is the sign of the account's PL value, read from the tree:
 * revenue lines are positive, everything under COGS, operating expenses and depreciation is negative.
 */
export function naturalSign(snapshot: Snapshot, accountId: string): 1 | -1 | undefined {
  // The source's sign convention lives on the account (+1 revenue/income, -1 cost).
  return snapshot.accounts.find((a) => a.id === accountId)?.sign;
}

/** Monthly P&L totals the balance sheet needs, from signed leaves. */
function plTotals(leaves: Record<string, number>) {
  let revenue = 0;
  let cogs = 0;
  let ni = 0;
  for (const [id, v] of Object.entries(leaves)) {
    if (isRevenueLeaf(id)) revenue += v;
    if (isCogsLeaf(id)) cogs -= v;
    ni += v;
  }
  const depFleet = -(leaves[DEP_FLEET] ?? 0);
  const depEquip = -(leaves[DEP_EQUIP] ?? 0);
  const tax = -TAX_ACCOUNTS.reduce((s, a) => s + (leaves[a] ?? 0), 0);
  return { revenue, cogs, depFleet, depEquip, dep: depFleet + depEquip, tax, ni };
}

/** Taxes on positive EBT of the month, split evenly into the two tax lines (as the source P&L does). */
function withTaxes(leaves: Record<string, number>, taxRate: number): Record<string, number> {
  const ebt = Object.entries(leaves).reduce((s, [id, v]) => (isTaxLeaf(id) ? s : s + v), 0);
  const tax = Math.max(0, ebt) * taxRate;
  return { ...leaves, '8000': -tax / 2, '8010': -tax / 2 };
}

/**
 * Forecast values with adjustments applied: P&L leaves (with taxes recomputed for adjusted months only),
 * balance sheet balances and cash flow lines for every forecast month. Months up to the cut-off are actuals
 * and are returned unchanged.
 */
export function forecastWithAdjustments(snapshot: Snapshot, adjustments: Adjustment[]): Values['FC'] {
  const { drivers } = snapshot;
  const fc = snapshot.values.FC;
  const out: Values['FC'] = {};
  for (const [month, vals] of Object.entries(fc)) out[month] = { ...vals };

  // Rows come from the browser: anything but an adjustable P&L leaf with a finite amount is ignored, never thrown
  // on (one bad row must not break the app for everyone). lock.ts reports such rows as invalid.
  const adjustable = new Set(snapshot.accounts.filter(isAdjustable).map((a) => a.id));
  const byMonth = new Map<string, Adjustment[]>();
  for (const a of adjustments) {
    if (a.month <= snapshot.meta.cutoff) continue; // actual months cannot change
    if (!adjustable.has(a.accountId) || !Number.isFinite(a.amount)) continue;
    byMonth.set(a.month, [...(byMonth.get(a.month) ?? []), a]);
  }

  let bal: Record<string, number> = { ...drivers.fcStart.balances };
  const due: Record<number, number> = {};
  for (const [k, v] of Object.entries(drivers.fcStart.taxDue)) due[Number(k)] = v;
  let priorYearNi = drivers.fcStart.priorYearNetIncome;

  for (const month of forecastMonths(snapshot)) {
    const base = fc[month] ?? {};
    let leaves: Record<string, number> = {};
    for (const a of snapshot.accounts) if (a.statement === 'PL' && a.rowType === 'Account') leaves[a.id] = base[a.id] ?? 0;
    const adj = byMonth.get(month);
    if (adj?.length) {
      for (const a of adj) leaves[a.accountId] = (leaves[a.accountId] ?? 0) + (naturalSign(snapshot, a.accountId) ?? 0) * a.amount;
      leaves = withTaxes(leaves, drivers.taxRate);
    }
    Object.assign(out[month], leaves);

    const { bs, cf, prior } = rollMonth(month, bal, leaves, due, priorYearNi, drivers);
    priorYearNi = prior;
    Object.assign(out[month], bs, cf);
    bal = bs;
  }
  return out;
}

/** One month of the roll; mutates `due` (tax accrued, keyed by payment month). */
function rollMonth(
  month: string,
  bal: Record<string, number>,
  leaves: Record<string, number>,
  due: Record<number, number>,
  priorYearNi: number,
  d: Drivers
) {
  const [y, m] = month.split('-').map(Number);
  const t = plTotals(leaves);
  const b = { ...bal };
  if (m === 1) {
    priorYearNi = b['B-EQ-NI'];
    b['B-EQ-RE'] += b['B-EQ-NI'];
    b['B-EQ-NI'] = 0;
  }
  const dividend = m === d.dividendMonth ? d.dividendShare * Math.max(0, priorYearNi) : 0;
  b['B-EQ-RE'] -= dividend;
  b['B-EQ-NI'] += t.ni;
  const capex = d.capex[String(y)] ?? { fleet: {}, equipment: {} };
  const fleetCapex = capex.fleet[String(m)] ?? 0;
  const equipCapex = capex.equipment[String(m)] ?? 0;
  b['B-FA-FLEET'] += fleetCapex - t.depFleet;
  b['B-FA-EQUIP'] += equipCapex - t.depEquip;
  const days = daysIn(month);
  b['B-CA-REC'] = (t.revenue * d.dso) / days;
  b['B-CA-INV'] = (t.cogs * d.dio) / days;
  b['B-LI-PAY'] = (t.cogs * d.dpo) / days;
  b['B-LI-LOAN'] -= d.loanRepayment;
  const payIn = d.taxPaymentMonths[String(m)];
  due[payIn] = (due[payIn] ?? 0) + t.tax;
  let paid = 0;
  if ([1, 4, 7, 10].includes(m)) {
    paid = due[m] ?? 0;
    delete due[m];
  }
  b['B-PR-TAX'] += t.tax - paid;

  const cf: Record<string, number> = {
    'C-OP-NI': t.ni,
    'C-OP-DA': t.dep,
    'C-OP-REC': -(b['B-CA-REC'] - bal['B-CA-REC']),
    'C-OP-INV': -(b['B-CA-INV'] - bal['B-CA-INV']),
    'C-OP-PAY': b['B-LI-PAY'] - bal['B-LI-PAY'],
    'C-OP-PR': b['B-PR-TAX'] - bal['B-PR-TAX'] + (b['B-PR-OTH'] - bal['B-PR-OTH']),
    'C-IN-FLEET': -fleetCapex,
    'C-IN-EQUIP': -equipCapex,
    'C-FI-LOAN': -d.loanRepayment,
    'C-FI-DIV': -dividend,
  };
  const net = Object.values(cf).reduce((s, v) => s + v, 0);
  b['B-CA-CASH'] = bal['B-CA-CASH'] + net;
  cf['C-NET'] = net;
  cf['C-OPEN'] = bal['B-CA-CASH'];
  cf['C-CLOSE'] = b['B-CA-CASH'];
  return { bs: b, cf, prior: priorYearNi };
}
