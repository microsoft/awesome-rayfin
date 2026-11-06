import { createContext, useContext } from 'react';

import type { Cube, MemberFilter, RefScen, Scen, ScenarioChoice } from '@finance/lib/cockpit/cube';
import type { KpiDef } from '@finance/lib/cockpit/kpis';
import type { View } from '@finance/lib/cockpit/view';

export interface CockpitContextValue {
  cube: Cube;
  catalogue: KpiDef[];
  view: View;
  setView: (patch: Partial<View>) => void;
  /** Months (1..12) of the selected period. */
  months: number[];
  choice: ScenarioChoice;
  filter: MemberFilter;
  /** Selected KPI. */
  kpi: KpiDef;
  /** IBCS code of the primary scenario for the period: AC, FC or AC&FC. */
  primary: 'AC' | 'FC' | 'AC&FC';
  /** KPI value in a scenario for given months (defaults: selected period) and filter (default: view filter). */
  value: (kpi: KpiDef, scen: Scen, months?: number[], filter?: MemberFilter) => number;
  /** Code used for drawing the reference scenario. */
  refCode: (r: RefScen) => 'PY' | 'PL' | 'FC';
  /** Display name of a scenario incl. versions, e.g. "PL (Budget)". */
  scenName: (s: Scen) => string;
}

export const CockpitContext = createContext<CockpitContextValue | undefined>(undefined);

export function useCockpit(): CockpitContextValue {
  const ctx = useContext(CockpitContext);
  if (!ctx) throw new Error('useCockpit must be used inside <CockpitContext.Provider>');
  return ctx;
}
