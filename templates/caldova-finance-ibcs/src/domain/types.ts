/** Which statement an account belongs to. */
export type Statement = 'PL' | 'BS' | 'CF';

/** IBCS scenario codes. AC actual, PY previous year, PL plan (budget), FC forecast. */
export type Scenario = 'AC' | 'PY' | 'PL' | 'FC';

export type RowType = 'Account' | 'Subtotal' | 'Formula' | 'KPI' | 'Balance';

export interface Account {
  id: string;
  statement: Statement;
  parentId: string | null;
  name: string;
  rowType: RowType;
  /** +1 adds to the parent, -1 subtracts (balance sheet and cash flow trees). */
  sign: 1 | -1;
  /** For Formula and KPI rows: an expression over other account ids, e.g. `[F-GP] / [N-REV]`. */
  formula: string;
  /** Variance colour: is a higher value good (IBCS: colour by impact, not by sign)? null: no direction, grey. */
  goodUp: boolean | null;
  sort: number;
}

export interface Month {
  /** `YYYY-MM` */
  id: string;
  year: number;
  monthNo: number;
  label: string;
  closed: boolean;
}

/** Balance sheet and cash flow drivers, as stated by the generator (tools/generate_statements.py). */
export interface Drivers {
  company: string;
  currency: string;
  cutoff: string;
  taxRate: number;
  dso: number;
  dio: number;
  dpo: number;
  loanRepayment: number;
  dividendShare: number;
  dividendMonth: number;
  capex: Record<string, { fleet: Record<string, number>; equipment: Record<string, number> }>;
  taxPaymentMonths: Record<string, number>;
  /** State at the cut-off month: where the forecast roll starts. */
  fcStart: { balances: Record<string, number>; taxDue: Record<string, number>; priorYearNetIncome: number };
}

/** value[scenario][month][accountId], leaves and balances as stored; subtotals are computed. */
export type Values = Record<Scenario, Record<string, Record<string, number>>>;

export interface Snapshot {
  meta: { company: string; currency: string; cutoff: string; bakedAt: string; source: string };
  accounts: Account[];
  months: Month[];
  values: Values;
  drivers: Drivers;
}
