// P&L engine: account tree, signs, formula lines and the what-if simulation.
//
// Conventions (from the semantic model):
// - Fact values are stored positive; `sign` (SignConvention) turns them into
//   signed values, so revenue and income are positive, costs negative.
// - Subtotals are the signed sum of their children, formula lines reference
//   top-level lines by name ("[Net revenue] + [Cost of goods sold]").
// - With signed values a positive variance is always good, so colouring never
//   needs VarianceInvert. DisplayInvert only flips the shown number (costs are
//   shown as positive amounts, as controllers expect).

export type RowType = 'Account' | 'Subtotal' | 'Formula' | 'KPI' | 'Separator';

export interface KontoRow {
  id: string;
  parent: string;
  name: string;
  l1: string;
  l2: string;
  l3: string;
  rowType: RowType | string;
  formula: string;
  sign: number;
  displayInvert: boolean;
  varianceInvert: boolean;
  sort: number;
}

/** Raw (unsigned) values of one account for one fiscal year. */
export interface KontoWert {
  /** Actuals, closed months only. */
  ac: number;
  /** Rolling forecast for the full year = actuals + forecast of open months. */
  fc: number;
  pl: number;
  py: number;
  plYtd: number;
  pyYtd: number;
}

export type Mode = 'fy' | 'ytd';
export type Scope = 'ytg' | 'fy';

/** Signed values of one line in all scenario columns. */
export interface Cols {
  /** Base: AC+FC in FY mode, AC in YTD mode. */
  base: number;
  pl: number;
  py: number;
  /** Simulated base (equals base when no lever is moved). */
  sim: number;
  /** Actuals part of the base (closed months). */
  ac: number;
}

export interface Line {
  id: string;
  name: string;
  rowType: RowType;
  depth: number;
  parent: string | null;
  children: string[];
  /** +1 or -1 for the shown number. */
  displaySign: 1 | -1;
  isPercent: boolean;
  cols: Cols;
  /** Number of leaf accounts below (for the UI). */
  leafCount: number;
}

export interface PnlModel {
  lines: Map<string, Line>;
  /** Top-level lines in statement order (subtotals, formulas, KPIs, separators). */
  top: string[];
  /** Values that could not be placed in the statement (account missing in the tree). */
  unassigned: { accounts: number; base: number };
  divisions: string[];
}

// ---------------------------------------------------------------------------
// Simulation parameters
// ---------------------------------------------------------------------------

export interface DivisionLever {
  /** Price change in percent, e.g. 2 = +2 %. */
  price: number;
  /** Volume change in percent. */
  volume: number;
}

export interface SimParams {
  scope: Scope;
  divisions: Record<string, DivisionLever>;
  /** Material, freight and subcontracting cost change in percent. */
  material: number;
  /** OPEX blocks (L2 of "Operating expenses") change in percent. */
  opex: Record<string, number>;
  /** Interest expense change in percent. */
  interest: number;
  /** Change of the effective tax rate in percentage points. */
  taxPp: number;
}

export const EMPTY_SIM: SimParams = {
  scope: 'ytg',
  divisions: {},
  material: 0,
  opex: {},
  interest: 0,
  taxPp: 0,
};

// ⚠️ CALDOVA (SOURCE.md, "Names"): the engine finds its lines BY NAME. Michael's demo P&L used manufacturing
// cost blocks; the Caldova wholesaler P&L (tools/data/generate_finance.py) uses the names below and ONE
// variable cost block, "Merchandise" (cost of goods per category).
/** How strongly variable cost blocks follow volume (documented in the UI). */
export const VOLUME_ELASTICITY: Record<string, number> = {
  Merchandise: 1,
};

const MATERIAL_BLOCKS = new Set(['Merchandise']);

export const LINE_REVENUE = 'Revenue';
export const LINE_COGS = 'Cost of goods sold';
export const LINE_OPEX = 'Operating expenses';
export const LINE_FIN = 'Financial result';
export const LINE_TAX = 'Income taxes';
export const LINE_EBT = 'EBT';

export function isSimActive(p: SimParams): boolean {
  return (
    Object.values(p.divisions).some((d) => d.price !== 0 || d.volume !== 0) ||
    p.material !== 0 ||
    Object.values(p.opex).some((v) => v !== 0) ||
    p.interest !== 0 ||
    p.taxPp !== 0
  );
}

// ---------------------------------------------------------------------------
// Formula evaluation
// ---------------------------------------------------------------------------

type Tok = { t: 'ref'; v: string } | { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(f: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === ' ') {
      i++;
    } else if (ch === '[') {
      const j = f.indexOf(']', i);
      if (j < 0) throw new Error(`Unclosed reference in formula: ${f}`);
      out.push({ t: 'ref', v: f.slice(i + 1, j) });
      i = j + 1;
    } else if ('+-*/()'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else {
      const m = /^\d+(\.\d+)?/.exec(f.slice(i));
      if (!m) throw new Error(`Unexpected "${ch}" in formula: ${f}`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    }
  }
  return out;
}

/** Recursive-descent evaluation of + - * / and parentheses over named values. */
export function evalFormula(formula: string, get: (name: string) => number): number {
  const toks = tokenize(formula);
  let p = 0;
  const peek = () => toks[p];
  const expr = (): number => {
    let v = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = toks[p++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = toks[p++].v;
      const r = factor();
      v = op === '*' ? v * r : r === 0 ? NaN : v / r;
    }
    return v;
  };
  const factor = (): number => {
    const tk = toks[p++];
    if (!tk) throw new Error(`Unexpected end of formula: ${formula}`);
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'ref') return get(tk.v);
    if (tk.v === '(') {
      const v = expr();
      p++; // ')'
      return v;
    }
    if (tk.v === '-') return -factor();
    throw new Error(`Unexpected "${tk.v}" in formula: ${formula}`);
  };
  const v = expr();
  return v;
}

// ---------------------------------------------------------------------------
// Building the statement
// ---------------------------------------------------------------------------

interface AccountCtx {
  row: KontoRow;
  /** Name of the top-level line the account rolls up to. */
  topName: string;
  /** Revenue division (L2 of revenue accounts) or cost block (L2 of costs). */
  l2: string;
  l3: string;
}

function emptyCols(): Cols {
  return { base: 0, pl: 0, py: 0, sim: 0, ac: 0 };
}

function addCols(a: Cols, b: Cols) {
  a.base += b.base;
  a.pl += b.pl;
  a.py += b.py;
  a.sim += b.sim;
  a.ac += b.ac;
}

/** Multiplier a lever set applies to one account (before taxes). */
export function accountMultiplier(ctx: AccountCtx, p: SimParams, weightedVolume: number): number {
  const top = ctx.topName;
  if (top === LINE_REVENUE) {
    const d = p.divisions[ctx.l2];
    return d ? (1 + d.price / 100) * (1 + d.volume / 100) : 1;
  }
  if (top === LINE_COGS) {
    let m = 1;
    const el = VOLUME_ELASTICITY[ctx.l2];
    if (el !== undefined) {
      // Division blocks follow their own division, freight follows the group.
      const v = ctx.l2 === 'Freight & duties' ? weightedVolume : (p.divisions[ctx.l3]?.volume ?? 0);
      m *= 1 + (el * v) / 100;
    }
    if (MATERIAL_BLOCKS.has(ctx.l2)) m *= 1 + p.material / 100;
    return m;
  }
  if (top === LINE_OPEX) {
    return 1 + (p.opex[ctx.l2] ?? 0) / 100;
  }
  if (top === LINE_FIN && /interest expense/i.test(ctx.row.name)) {
    return 1 + p.interest / 100;
  }
  return 1;
}

export interface BuildInput {
  konten: KontoRow[];
  werte: Map<string, KontoWert>;
  mode: Mode;
  sim: SimParams;
}

export function buildPnl({ konten, werte, mode, sim }: BuildInput): PnlModel {
  const byId = new Map(konten.map((k) => [k.id, k]));
  const childrenOf = new Map<string, KontoRow[]>();
  const top: KontoRow[] = [];
  for (const k of konten) {
    if (!k.parent) top.push(k);
    else {
      const arr = childrenOf.get(k.parent);
      if (arr) arr.push(k);
      else childrenOf.set(k.parent, [k]);
    }
  }
  top.sort((a, b) => a.sort - b.sort);
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.sort - b.sort);

  // Top-level ancestor of every node (null when the chain is broken).
  const rootOf = (k: KontoRow): KontoRow | null => {
    let cur: KontoRow | undefined = k;
    let guard = 0;
    while (cur && cur.parent && guard++ < 50) cur = byId.get(cur.parent);
    return cur && !cur.parent ? cur : null;
  };

  // Revenue-weighted volume change drives group-level freight.
  const divisions = new Set<string>();
  let revTotal = 0;
  const revByDiv = new Map<string, number>();
  const ctxById = new Map<string, AccountCtx>();
  for (const k of konten) {
    if (k.rowType !== 'Account') continue;
    const root = rootOf(k);
    if (!root) continue;
    const ctx: AccountCtx = { row: k, topName: root.name, l2: k.l2, l3: k.l3 };
    ctxById.set(k.id, ctx);
    if (root.name === LINE_REVENUE && k.l2) {
      divisions.add(k.l2);
      const w = werte.get(k.id);
      const v = w ? w.fc : 0;
      revTotal += v;
      revByDiv.set(k.l2, (revByDiv.get(k.l2) ?? 0) + v);
    }
  }
  let weightedVolume = 0;
  if (revTotal) {
    for (const [d, v] of revByDiv) weightedVolume += ((sim.divisions[d]?.volume ?? 0) * v) / revTotal;
  }

  const lines = new Map<string, Line>();

  // Leaf values.
  const leafCols = (k: KontoRow): Cols => {
    const w = werte.get(k.id);
    if (!w) return emptyCols();
    const s = k.sign || 1;
    const ctx = ctxById.get(k.id);
    const m = ctx ? accountMultiplier(ctx, sim, weightedVolume) : 1;
    if (mode === 'ytd') {
      return { base: s * w.ac, pl: s * w.plYtd, py: s * w.pyYtd, sim: s * w.ac, ac: s * w.ac };
    }
    const simRaw = sim.scope === 'fy' ? w.fc * m : w.ac + (w.fc - w.ac) * m;
    return { base: s * w.fc, pl: s * w.pl, py: s * w.py, sim: s * simRaw, ac: s * w.ac };
  };

  const build = (k: KontoRow, depth: number, parent: string | null): Line => {
    const kids = childrenOf.get(k.id) ?? [];
    const cols = emptyCols();
    let leafCount = 0;
    if (k.rowType === 'Account') {
      addCols(cols, leafCols(k));
      leafCount = 1;
    }
    for (const c of kids) {
      const l = build(c, depth + 1, k.id);
      addCols(cols, l.cols);
      leafCount += l.leafCount;
    }
    const line: Line = {
      id: k.id,
      name: k.name,
      rowType: k.rowType as RowType,
      depth,
      parent,
      children: kids.map((c) => c.id),
      displaySign: k.displayInvert ? -1 : 1,
      isPercent: false,
      cols,
      leafCount,
    };
    lines.set(k.id, line);
    return line;
  };

  const byName = new Map<string, Line>();
  for (const k of top) {
    if (k.rowType === 'Formula' || k.rowType === 'KPI' || k.rowType === 'Separator') continue;
    byName.set(k.name, build(k, 0, null));
  }

  // Formula and KPI lines in statement order (formulas may reference earlier formulas).
  const colKeys: (keyof Cols)[] = ['base', 'pl', 'py', 'sim', 'ac'];
  for (const k of top) {
    if (k.rowType !== 'Formula' && k.rowType !== 'KPI' && k.rowType !== 'Separator') continue;
    const cols = emptyCols();
    if (k.rowType !== 'Separator' && k.formula) {
      for (const key of colKeys) {
        cols[key] = evalFormula(k.formula, (n) => byName.get(n)?.cols[key] ?? 0);
      }
    }
    const line: Line = {
      id: k.id,
      name: k.name,
      rowType: k.rowType as RowType,
      depth: 0,
      parent: null,
      children: [],
      displaySign: 1,
      isPercent: k.rowType === 'KPI',
      cols,
      leafCount: 0,
    };
    lines.set(k.id, line);
    byName.set(k.name, line);
  }

  // Taxes follow EBT at the effective rate (FY mode only; YTD has no simulation).
  if (mode === 'fy') applyTaxSimulation(lines, byName, konten, werte, sim);

  // Values without a place in the statement.
  let unassignedAccounts = 0;
  let unassignedBase = 0;
  for (const [id, w] of werte) {
    const k = byId.get(id);
    if (k && ctxById.has(id)) continue;
    if (k && k.rowType !== 'Account') continue;
    unassignedAccounts++;
    unassignedBase += mode === 'ytd' ? w.ac : w.fc;
  }

  return {
    lines,
    top: top.map((k) => k.id),
    unassigned: { accounts: unassignedAccounts, base: unassignedBase },
    divisions: [...divisions].sort((a, b) => (revByDiv.get(b) ?? 0) - (revByDiv.get(a) ?? 0)),
  };
}

/**
 * Recomputes the tax line of the simulation: the simulated EBT is taxed at the
 * base effective rate plus the lever's percentage points. In "rest of year"
 * scope the closed months keep their actual tax.
 */
function applyTaxSimulation(
  lines: Map<string, Line>,
  byName: Map<string, Line>,
  konten: KontoRow[],
  werte: Map<string, KontoWert>,
  sim: SimParams
) {
  const tax = byName.get(LINE_TAX);
  const ebt = byName.get(LINE_EBT);
  if (!tax || !ebt || ebt.rowType !== 'Formula') return;

  // EBT before the tax line was recomputed: tax is not part of EBT, so it is final.
  const baseEbt = ebt.cols.base;
  const simEbt = ebt.cols.sim;
  const baseTax = tax.cols.base; // signed, negative for an expense
  if (!baseEbt) return;
  const baseRate = -baseTax / baseEbt;
  const rate = baseRate + sim.taxPp / 100;

  let simTax: number;
  if (sim.scope === 'fy') {
    simTax = -rate * simEbt;
  } else {
    // Actual tax of closed months stays; the open months are taxed at the new rate.
    const taxIds = new Set<string>();
    const collect = (id: string) => {
      const l = lines.get(id);
      if (!l) return;
      if (l.rowType === 'Account') taxIds.add(id);
      l.children.forEach(collect);
    };
    collect(tax.id);
    let acTax = 0;
    for (const k of konten) if (taxIds.has(k.id)) acTax += (k.sign || 1) * (werte.get(k.id)?.ac ?? 0);
    const acEbt = ebtActual(byName, konten, werte, lines);
    simTax = acTax - rate * (simEbt - acEbt);
  }
  if (!Number.isFinite(simTax)) return;

  // Distribute to the tax subtree proportionally to the base.
  const factor = baseTax ? simTax / baseTax : 1;
  const scale = (id: string) => {
    const l = lines.get(id);
    if (!l) return;
    l.cols.sim = l.cols.base * factor;
    l.children.forEach(scale);
  };
  scale(tax.id);

  // Lines that follow taxes: recompute formulas and KPIs after the tax line.
  const order = [...byName.values()].filter((l) => l.rowType === 'Formula' || l.rowType === 'KPI');
  const formulaOf = new Map(konten.map((k) => [k.id, k.formula]));
  for (const l of order) {
    const f = formulaOf.get(l.id);
    if (f) l.cols.sim = evalFormula(f, (n) => byName.get(n)?.cols.sim ?? 0);
  }
}

/** EBT of the closed months (actuals), used for the rest-of-year tax logic. */
function ebtActual(
  byName: Map<string, Line>,
  konten: KontoRow[],
  werte: Map<string, KontoWert>,
  lines: Map<string, Line>
): number {
  const ebtLine = byName.get(LINE_EBT);
  if (!ebtLine) return 0;
  const formulaOf = new Map(konten.map((k) => [k.name, k.formula]));
  const signOf = new Map(konten.map((k) => [k.id, k.sign || 1]));
  const memo = new Map<string, number>();
  const sumAc = (id: string): number => {
    const l = lines.get(id);
    if (!l) return 0;
    let v = 0;
    if (l.rowType === 'Account') {
      v += (signOf.get(id) ?? 1) * (werte.get(id)?.ac ?? 0);
    }
    for (const c of l.children) v += sumAc(c);
    return v;
  };
  const valueOf = (name: string): number => {
    if (memo.has(name)) return memo.get(name)!;
    const l = byName.get(name);
    let v = 0;
    if (l && l.rowType === 'Formula') v = evalFormula(formulaOf.get(name) ?? '', valueOf);
    else if (l) v = sumAc(l.id);
    memo.set(name, v);
    return v;
  };
  return valueOf(LINE_EBT);
}

// ---------------------------------------------------------------------------
// Bridge: base → simulation, one step per lever group
// ---------------------------------------------------------------------------

export interface BridgeStep {
  key: string;
  label: string;
  value: number;
}

/** Net income bridge from base to simulation, lever groups applied one after another. */
export function bridge(input: Omit<BuildInput, 'mode'>, target = 'Net income'): BridgeStep[] {
  const { sim } = input;
  const val = (p: SimParams) => {
    const m = buildPnl({ ...input, mode: 'fy', sim: p });
    for (const l of m.lines.values()) if (l.name === target) return l.cols.sim;
    return 0;
  };
  const noTax = { ...sim, taxPp: 0 };
  const priceOnly = Object.fromEntries(
    Object.entries(sim.divisions).map(([d, v]) => [d, { price: v.price, volume: 0 }])
  );
  const stages: { key: string; label: string; p: SimParams }[] = [
    { key: 'base', label: 'Base', p: { ...EMPTY_SIM, scope: sim.scope } },
    { key: 'price', label: 'Price', p: { ...EMPTY_SIM, scope: sim.scope, divisions: priceOnly } },
    { key: 'volume', label: 'Volume', p: { ...EMPTY_SIM, scope: sim.scope, divisions: sim.divisions } },
    { key: 'material', label: 'Material', p: { ...EMPTY_SIM, scope: sim.scope, divisions: sim.divisions, material: sim.material } },
    {
      key: 'opex',
      label: 'OPEX',
      p: { ...EMPTY_SIM, scope: sim.scope, divisions: sim.divisions, material: sim.material, opex: sim.opex },
    },
    { key: 'interest', label: 'Interest', p: { ...noTax } },
    { key: 'tax', label: 'Tax rate', p: sim },
  ];
  const vals = stages.map((s) => val(s.p));
  const steps: BridgeStep[] = [{ key: 'base', label: 'Base', value: vals[0] }];
  for (let i = 1; i < stages.length; i++) {
    steps.push({ key: stages[i].key, label: stages[i].label, value: vals[i] - vals[i - 1] });
  }
  steps.push({ key: 'sim', label: 'Simulation', value: vals[vals.length - 1] });
  return steps;
}
