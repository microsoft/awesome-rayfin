// Public Report BPA surface — wraps the local `reportBpa/` engine, a faithful
// TypeScript port of `sempy_labs.report.run_report_bpa` (9 evaluatable rules).
//
// The engine runs fully in-browser against the report's PBIR definition parts
// (loaded via `loadDefinitionParts`). The fixable subset (A12) maps four rule
// names to the deterministic PKG-5 report fixers; every other rule is
// read-only (no Fix button).

import { loadDefinitionParts } from './fabricRest';
import { extractReportModel, runReportBpa, ruleSlug } from './reportBpa/engine';
import { REPORT_BPA_RULES } from './reportBpa/rules';
import type { ReportBpaRule, ReportBpaSeverity } from './reportBpa/types';
import {
  applyUnusedCustomVisuals,
  applyShowItems,
  applyReportLevelMeasures,
  applyTallPages,
} from './reportStructFix';

export type BpaSeverity = ReportBpaSeverity;

/** Auto-fix kinds wired to a deterministic PKG-5 report fixer. */
export type ReportFixKind =
  | 'RemoveUnusedCustomVisuals'
  | 'DisableShowItemsNoData'
  | 'MigrateReportLevelMeasures'
  | 'ShortenTallPages';

export interface BpaRule {
  id: string;
  category: string;
  severity: BpaSeverity;
  name: string;
  description: string;
  url?: string;
  /** Only the fixable subset carries this. Read-only rules omit it. */
  fixKind?: ReportFixKind;
}

export interface BpaFinding {
  rule: BpaRule;
  objectType: string;
  objectPath: string;
  detail?: string;
}

// Map rule names → the fixer kind that can repair them (lowercased lookup keeps
// us in step with the Python `_RULE_TO_FIXER` table).
const FIX_KINDS: Record<string, ReportFixKind> = {
  'remove custom visuals which are not used in the report': 'RemoveUnusedCustomVisuals',
  "avoid setting 'show items with no data' on columns": 'DisableShowItemsNoData',
  'move report-level measures into the semantic model.': 'MigrateReportLevelMeasures',
  'avoid tall report pages with vertical scrolling': 'ShortenTallPages',
};

function publicRule(r: ReportBpaRule): BpaRule {
  return {
    id: ruleSlug(r.name),
    category: r.category,
    severity: r.severity,
    name: r.name,
    description: r.description,
    url: r.url,
    fixKind: FIX_KINDS[r.name.toLowerCase()],
  };
}

const RULES: BpaRule[] = REPORT_BPA_RULES.map(publicRule);
const RULE_BY_NAME = new Map<string, BpaRule>(RULES.map((r) => [r.name, r]));

export const REPORT_BPA_RULE_LIST: ReadonlyArray<BpaRule> = RULES;

/**
 * Load the report's PBIR definition, extract the per-scope object model, and
 * run the 9 BPA rules. Synchronous evaluation after a single definition load.
 */
export async function runReportBpaScan(
  workspaceId: string,
  reportId: string
): Promise<BpaFinding[]> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const model = extractReportModel(parts);
  const violations = runReportBpa(model, REPORT_BPA_RULES);
  const out: BpaFinding[] = [];
  for (const v of violations) {
    const rule = RULE_BY_NAME.get(v.ruleName);
    if (!rule) continue;
    out.push({ rule, objectType: v.objectType, objectPath: v.objectName });
  }
  return out;
}

export interface ReportBpaFixResult {
  applied: number;
  detail: string;
  /** Per-fixer outcome lines for the UI log. */
  lines: string[];
}

/** Run a single fixer kind (per-finding Fix button). */
export async function applyReportFixKind(
  workspaceId: string,
  reportId: string,
  kind: ReportFixKind,
  datasetId?: string
): Promise<{ changed: number; detail: string }> {
  switch (kind) {
    case 'RemoveUnusedCustomVisuals': {
      const r = await applyUnusedCustomVisuals(workspaceId, reportId);
      return { changed: r.removed, detail: r.detail };
    }
    case 'DisableShowItemsNoData': {
      const r = await applyShowItems(workspaceId, reportId);
      return { changed: r.changed, detail: r.detail };
    }
    case 'ShortenTallPages': {
      const r = await applyTallPages(workspaceId, reportId);
      return { changed: r.changed, detail: r.detail };
    }
    case 'MigrateReportLevelMeasures': {
      if (!datasetId) {
        return { changed: 0, detail: 'No bound semantic model resolved — cannot migrate measures.' };
      }
      const r = await applyReportLevelMeasures(workspaceId, reportId, datasetId);
      return { changed: r.migrated, detail: r.detail };
    }
    default:
      return { changed: 0, detail: 'No fixer is wired to this rule.' };
  }
}

/**
 * Auto-fix the fixable subset of report BPA rules (A12). Runs each PKG-5 fixer
 * once and aggregates the results. Report-level measure migration is skipped
 * when no bound `datasetId` is supplied.
 */
export async function fixReportBpa(
  workspaceId: string,
  reportId: string,
  datasetId?: string
): Promise<ReportBpaFixResult> {
  const lines: string[] = [];
  let applied = 0;

  const cv = await applyUnusedCustomVisuals(workspaceId, reportId);
  if (cv.removed > 0) applied += cv.removed;
  lines.push(`Custom visuals: ${cv.detail}`);

  const si = await applyShowItems(workspaceId, reportId);
  if (si.changed > 0) applied += si.changed;
  lines.push(`Show items with no data: ${si.detail}`);

  const tp = await applyTallPages(workspaceId, reportId);
  if (tp.changed > 0) applied += tp.changed;
  lines.push(`Tall pages: ${tp.detail}`);

  if (datasetId) {
    const rlm = await applyReportLevelMeasures(workspaceId, reportId, datasetId);
    if (rlm.migrated > 0) applied += rlm.migrated;
    lines.push(`Report-level measures: ${rlm.detail}`);
  } else {
    lines.push('Report-level measures: skipped — no bound semantic model resolved.');
  }

  return {
    applied,
    detail:
      applied > 0
        ? `Applied ${applied} fix(es) across the fixable BPA rules.`
        : 'Nothing to fix — the report is already clean on the fixable rules.',
    lines,
  };
}
