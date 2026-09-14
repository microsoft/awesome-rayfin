/**
 * The synthetic condition model — PLAN Phase 7.
 *
 * ⚠️ **Everything here except floor area is invented.** `tools/geodata/build_condition.py` is the
 * rule that produced it, seeded from the AOI config so the same numbers come back every run. The
 * University of Tübingen publishes no renovation backlog; this is a plausible shape, not a claim
 * about a real estate, and the UI says so permanently rather than in a footnote.
 */

export type ScenarioId = 'nichtstun' | 'priorisiert' | 'gleichverteilt';

export interface ConditionYear {
  year: number;
  backlogEur: number;
  spentEur: number;
  cumulativeEur: number;
  /** Share of BUILDINGS at Zustandsnote 4 or worse. */
  sharePoor: number;
  poorBgfM2: number;
  /** Share of USED floor area at grade 4+, weighted by synthetic usage intensity. */
  poorWeighted: number;
  renovated: number;
}

export interface ConditionScenario {
  renovatedYear: number[];
  curve: ConditionYear[];
}

export interface ConditionModel {
  aoi: string;
  provenance: 'synthetic';
  syntheticWarning: string;
  seed: number;
  buildingCount: number;
  costPerM2ByGrade: Record<string, number>;
  annualBudgetEur: number;
  years: number[];
  totalBgfM2: number;
  totalBacklogEur: number;
  grade: number[];
  bgfM2: number[];
  costEur: number[];
  priority: number[];
  heritage: number[];
  scenarios: Record<ScenarioId, ConditionScenario>;
}

export async function loadCondition(
  aoiId: string,
  base = '/terrain'
): Promise<ConditionModel | null> {
  const response = await fetch(`${base}/${aoiId}/condition.json`);
  // Absent for sites with no condition model, which is most of them.
  if (!response.ok) return null;
  const model: ConditionModel = await response.json();
  if (model.provenance !== 'synthetic') {
    // Refuse to render figures that have lost their provenance stamp. If this ever throws, the
    // generator changed and the badge may no longer be telling the truth.
    throw new Error('condition.json is missing its synthetic provenance stamp');
  }
  return model;
}
