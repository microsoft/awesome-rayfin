// KPI catalogue of the cockpit: the 11 model KPIs plus derived ratios, with
// display labels, display units and polarity. Values are always computed from
// the cube, ratios as quotient of sums (never as average of ratios).

import { aggScen, type Cube, type MemberFilter, type Scen, type ScenarioChoice } from './cube';

export type DisplayUnit = 'mio' | 'tsd' | 'eur' | 'pts' | 'pct' | 'km';

export interface KpiDef {
  id: string;
  label: string;
  short: string;
  group: string;
  unit: DisplayUnit;
  higherBetter: boolean;
  /** Base KPI id (model name) for plain KPIs. */
  base?: string;
  /** Ratio: numerator / denominator base KPI ids. */
  ratio?: { num: string; den: string; factor?: number };
}

// Caldova KPIs (tools/data/generate_finance.py); the cockpit's own ids below stay for compatibility.
const LABELS: Record<string, [string, string]> = {
  Revenue: ['Revenue', 'Revenue'],
  COGS: ['Cost of goods sold', 'COGS'],
  'Gross Profit': ['Gross profit', 'Gross profit'],
  'Logistics Cost': ['Logistics cost', 'Logistics'],
  Profit: ['Contribution after logistics', 'Contribution'],
  Drops: ['Drops', 'Drops'],
  'Tour km': ['Tour kilometres', 'Tour km'],
  Cost: ['Total cost', 'Cost'],
  'Units Sold': ['Units sold', 'Units'],
  Discount: ['Discounts', 'Discounts'],
  'Marketing Spend': ['Marketing', 'Marketing'],
  Orders: ['Orders', 'Orders'],
  'Returned Units': ['Returns', 'Returns'],
  'New Customers': ['New customers', 'New customers'],
  'Customer Satisfaction': ['Customer satisfaction', 'Satisfaction'],
};

const GROUP_LABEL: Record<string, string> = {
  Result: 'Result',
  Cost: 'Cost',
  Volume: 'Volume',
  Customer: 'Customer',
  Quality: 'Quality',
};

function unitOf(modelUnit: string): DisplayUnit {
  if (modelUnit === 'EUR') return 'mio';
  if (modelUnit === 'points') return 'pts';
  return 'tsd';
}

/** Builds the catalogue from the model's KPI dimension plus derived ratios. */
export function buildCatalogue(cube: Cube): KpiDef[] {
  const base: KpiDef[] = cube.kpis.map((k) => ({
    id: k.id,
    label: LABELS[k.id]?.[0] ?? k.id,
    short: LABELS[k.id]?.[1] ?? k.id,
    group: GROUP_LABEL[k.group] ?? k.group,
    unit: unitOf(k.unit),
    higherBetter: k.higherBetter,
    base: k.id,
  }));
  const has = (id: string) => cube.kpis.some((k) => k.id === id);
  const derived: KpiDef[] = [];
  // Caldova (decision 2026-10-20): the two logistics ratios; as everywhere, a quotient of sums.
  if (has('Logistics Cost') && has('Drops'))
    derived.push({ id: 'costPerDrop', label: 'Cost per drop', short: 'Cost/drop', group: 'Ratios', unit: 'eur', higherBetter: false, ratio: { num: 'Logistics Cost', den: 'Drops' } });
  if (has('Tour km') && has('Drops'))
    derived.push({ id: 'kmPerDrop', label: 'km per drop', short: 'km/drop', group: 'Ratios', unit: 'km', higherBetter: false, ratio: { num: 'Tour km', den: 'Drops' } });
  if (has('Drops')) return [...base, ...derived]; // Caldova cube: none of the cockpit's other ratios apply
  if (has('Profit') && has('Revenue'))
    derived.push({ id: 'margin', label: 'Return on sales', short: 'Margin', group: 'Ratios', unit: 'pct', higherBetter: true, ratio: { num: 'Profit', den: 'Revenue' } });
  if (has('Revenue') && has('Orders'))
    derived.push({ id: 'aov', label: 'Avg. order value', short: 'Avg. order', group: 'Ratios', unit: 'eur', higherBetter: true, ratio: { num: 'Revenue', den: 'Orders' } });
  if (has('Revenue') && has('Units Sold'))
    derived.push({ id: 'price', label: 'Avg. price per unit', short: 'Avg. price', group: 'Ratios', unit: 'eur', higherBetter: true, ratio: { num: 'Revenue', den: 'Units Sold' } });
  if (has('Returned Units') && has('Units Sold'))
    derived.push({ id: 'returns', label: 'Return rate', short: 'Return rate', group: 'Ratios', unit: 'pct', higherBetter: false, ratio: { num: 'Returned Units', den: 'Units Sold' } });
  if (has('Marketing Spend') && has('Revenue'))
    derived.push({ id: 'mktshare', label: 'Marketing ratio', short: 'Mkt. ratio', group: 'Ratios', unit: 'pct', higherBetter: false, ratio: { num: 'Marketing Spend', den: 'Revenue' } });
  return [...base, ...derived];
}

/** Value of a KPI in a view scenario over months and member filter. */
export function kpiValue(cube: Cube, kpi: KpiDef, scen: Scen, months: number[], f: MemberFilter, ch: ScenarioChoice): number {
  const idx = (id: string) => cube.kpis.findIndex((k) => k.id === id);
  if (kpi.base) {
    const k = idx(kpi.base);
    return k < 0 ? NaN : aggScen(cube, scen, k, months, f, ch);
  }
  if (kpi.ratio) {
    const n = aggScen(cube, scen, idx(kpi.ratio.num), months, f, ch);
    const d = aggScen(cube, scen, idx(kpi.ratio.den), months, f, ch);
    return d ? (n / d) * (kpi.ratio.factor ?? 1) : NaN;
  }
  return NaN;
}

/** Signed "goodness" of a variance: positive is always favourable. */
export function favourable(kpi: KpiDef, delta: number): number {
  return kpi.higherBetter ? delta : -delta;
}

/** Headline KPIs for the card row (MockupKitchen "kpi" row): Caldova's seven (decision 2026-10-20). */
export const HEADLINE = ['Revenue', 'Gross Profit', 'Units Sold', 'Drops', 'costPerDrop', 'Logistics Cost', 'kmPerDrop'];
