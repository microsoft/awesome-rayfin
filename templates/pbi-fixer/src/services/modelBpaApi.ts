// Public Model BPA surface — wraps the local `bpa/` engine which is a
// faithful TypeScript port of `sempy_labs.run_model_bpa` (54 rules).
//
// Ported from the Fabric Developer Hub PBI Fixer. The engine runs fully
// in-browser against the TMDL-derived `ModelData` (loaded via DAX INFO.VIEW),
// so no server round-trip is needed to scan. Only the small subset of rules
// wired to a deterministic TMDL auto-fix carries a `fixKind` (see modelBpaFix).

import type { ModelData } from '@/explorer/types';
import { runBpa, ruleSlug } from './bpa/engine';
import { MODEL_BPA_RULES } from './bpa/rules';
import type { BpaRule as EngineRule } from './bpa/types';
import type { ModelFixKind } from './modelBpaFix';

export type BpaSeverity = 'Error' | 'Warning' | 'Info';

export interface BpaRule {
  id: string;
  category: string;
  severity: BpaSeverity;
  name: string;
  description: string;
  url?: string;
  /** Fixer kind: only the subset of rules wired to a deterministic TMDL
   *  auto-fix carries this. All other rules are read-only (no Fix button). */
  fixKind?: ModelFixKind;
}

export interface BpaFinding {
  rule: BpaRule;
  objectType: string;
  objectPath: string;
  detail?: string;
}

// Map rule names → fixKind values that `modelBpaFix.applyModelBpaFix` can
// apply as a safe, deterministic TMDL edit. Names that don't appear here stay
// read-only (no Fix button).
const FIX_KINDS: Record<string, ModelFixKind> = {
  'Do not summarize numeric columns': 'SetSummarizeByNone',
  'Hide foreign keys': 'HideColumn',
  'Do not use floating point data types': 'FloatToDecimal',
  'Set IsAvailableInMdx to false on non-attribute columns': 'DisableAttributeHierarchy',
  'Set IsAvailableInMdx to true on necessary columns': 'EnableAttributeHierarchy',
  "Provide format string for 'Date' columns": 'SetDateColumnFormat',
  "Provide format string for 'Month' columns": 'SetMonthColumnFormat',
  'Format flag columns as Yes/No value strings': 'SetFlagColumnFormat',
  'Add data category for columns': 'SetDataCategory',
  'Mark primary keys': 'MarkPrimaryKey',
  'Provide format string for measures': 'SetMeasureFormat',
  'Whole numbers should be formatted with thousands separators and no decimals': 'SetMeasureFormat',
  'Percentages should be formatted with thousands separators and 1 decimal': 'SetPercentageFormat',
  'Avoid adding 0 to a measure': 'StripAddZero',
  'Month (as a string) must be sorted': 'SetMonthSortByColumn',
};

function publicRule(r: EngineRule): BpaRule {
  return {
    id: ruleSlug(r.name),
    category: r.category,
    severity: r.severity,
    name: r.name,
    description: r.description,
    url: r.url,
    fixKind: FIX_KINDS[r.name],
  };
}

const RULES: BpaRule[] = MODEL_BPA_RULES.map(publicRule);
const RULE_BY_NAME = new Map<string, BpaRule>(RULES.map((r) => [r.name, r]));

export const BPA_RULES: ReadonlyArray<BpaRule> = RULES;

/** Run the full 54-rule BPA against `model` and return findings. Synchronous,
 *  in-browser pass over TMDL-derived model data. Rules that depend on DAX-only
 *  extras (calc dependencies, RLS filter expressions, row counts) degrade
 *  silently to no-ops. */
export function runModelBpa(model: ModelData): BpaFinding[] {
  const violations = runBpa(model, MODEL_BPA_RULES);
  const out: BpaFinding[] = [];
  for (const v of violations) {
    const rule = RULE_BY_NAME.get(v.ruleName);
    if (!rule) continue;
    out.push({
      rule,
      objectType: v.objectType,
      objectPath: v.objectName,
    });
  }
  return out;
}
