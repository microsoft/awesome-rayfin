// IBCS chart-orientation fix.
//
// IBCS / Hichert rule: time flows left → right, so a time category belongs on a
// COLUMN chart (time runs horizontally); every other structure dimension uses a
// BAR chart (category stacked vertically, long labels stay readable).
//
// The two self-developed IBCS Multi-Tier visuals share identical query bindings
// (category + actual/reference projections), so switching orientation is a pure
// `visual.visualType` swap between the two GUIDs — no projection change needed.
// This module scans the report's PBIR visuals and flips any IBCS Multi-Tier
// visual whose orientation disagrees with the category dimension.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';

export const IBCS_COLUMN_GUID = 'ibcsMultiTierColumnB84BA14B8B6A4201A7F698B3B38DD148';
export const IBCS_BAR_GUID = 'ibcsMultiTierBarECA4F65BFFB141198B7A6391AFFC946A';

export type IbcsOrientation = 'column' | 'bar';

// Tokens that mark a category projection as a time dimension (German + English).
const TIME_TOKENS = [
  'jahr',
  'year',
  'monat',
  'month',
  'datum',
  'date',
  'quartal',
  'quarter',
  'woche',
  'week',
  'yearmonth',
];

export interface IbcsVisualInfo {
  page: string;
  visual: string;
  /** Best-guess category column property (the axis dimension). */
  category: string;
  current: IbcsOrientation;
  recommended: IbcsOrientation;
  needsChange: boolean;
}

export interface IbcsScanResult {
  visuals: IbcsVisualInfo[];
  ibcsCount: number;
  needsChange: number;
}

export interface IbcsFixResult {
  changed: number;
  updated: IbcsVisualInfo[];
  detail: string;
}

function isTimeProperty(prop: string): boolean {
  const p = prop.toLowerCase();
  return TIME_TOKENS.some((t) => p.includes(t));
}

/** First Column projection property found in a visual (the category axis).
 *  IBCS Multi-Tier visuals bind the category to a Column and the values to
 *  Measures, so the first Column reference is the category dimension. */
function findCategoryColumn(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const col = obj['Column'] as { Property?: string } | undefined;
  if (col && typeof col.Property === 'string') return col.Property;
  for (const v of Object.values(obj)) {
    const found = findCategoryColumn(v);
    if (found) return found;
  }
  return null;
}

function guidToKind(guid: string): IbcsOrientation | null {
  if (guid === IBCS_COLUMN_GUID) return 'column';
  if (guid === IBCS_BAR_GUID) return 'bar';
  return null;
}

/** Public helper: the IBCS orientation kind ('column' | 'bar') of an IBCS
 *  Multi-Tier custom-visual GUID, or null when the type is not one of them. */
export function ibcsKindOf(visualType: string): IbcsOrientation | null {
  return guidToKind(visualType);
}

const VISUAL_PATH_RE = /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/;

/** Scan a report for IBCS Multi-Tier visuals and report which ones disagree
 *  with the time-horizontal / category-vertical rule. */
export async function scanIbcsOrientation(
  workspaceId: string,
  reportId: string
): Promise<IbcsScanResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const visuals: IbcsVisualInfo[] = [];

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(part.text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as Record<string, unknown>;
    const kind = guidToKind(String(visual.visualType ?? ''));
    if (!kind) continue;

    const category = findCategoryColumn(visual) ?? '';
    // Without a category we cannot decide — leave the visual as-is.
    const recommended: IbcsOrientation = !category
      ? kind
      : isTimeProperty(category)
        ? 'column'
        : 'bar';

    visuals.push({
      page: m[1],
      visual: m[2],
      category,
      current: kind,
      recommended,
      needsChange: recommended !== kind,
    });
  }

  return {
    visuals,
    ibcsCount: visuals.length,
    needsChange: visuals.filter((v) => v.needsChange).length,
  };
}

/** Apply the time-horizontal / category-vertical rule: flip the visualType of
 *  any IBCS Multi-Tier visual that disagrees with its category dimension.
 *  One round trip. */
export async function applyIbcsOrientation(
  workspaceId: string,
  reportId: string
): Promise<IbcsFixResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  const updated: IbcsVisualInfo[] = [];

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(part.text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as Record<string, unknown>;
    const vType = String(visual.visualType ?? '');
    const kind = guidToKind(vType);
    if (!kind) continue;

    const category = findCategoryColumn(visual);
    if (!category) continue;
    const recommended: IbcsOrientation = isTimeProperty(category) ? 'column' : 'bar';
    if (recommended === kind) continue;

    const newGuid = recommended === 'column' ? IBCS_COLUMN_GUID : IBCS_BAR_GUID;
    // Targeted replace preserves the visual.json formatting; the GUID is unique.
    const newText = part.text.replace(`"${vType}"`, `"${newGuid}"`);
    if (newText === part.text) continue;

    edits[part.path] = newText;
    updated.push({
      page: m[1],
      visual: m[2],
      category,
      current: kind,
      recommended,
      needsChange: true,
    });
  }

  const changed = Object.keys(edits).length
    ? await saveDefinitionParts('report', workspaceId, reportId, edits)
    : 0;

  return {
    changed,
    updated,
    detail:
      changed > 0
        ? `Re-oriented ${updated.length} IBCS visual(s) to match the time-horizontal / category-vertical rule.`
        : updated.length === 0
          ? 'All IBCS visuals already follow the rule (or none were found).'
          : 'No change was written.',
  };
}

/** Flip the orientation of a SINGLE IBCS Multi-Tier visual to match its
 *  category dimension (time → column, structure → bar). One round trip. */
export async function applyIbcsOrientationToVisual(
  workspaceId: string,
  reportId: string,
  page: string,
  visualName: string
): Promise<IbcsFixResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  const updated: IbcsVisualInfo[] = [];

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m || m[1] !== page || m[2] !== visualName) continue;

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(part.text) as Record<string, unknown>;
    } catch {
      break;
    }
    const visual = (doc.visual ?? {}) as Record<string, unknown>;
    const vType = String(visual.visualType ?? '');
    const kind = guidToKind(vType);
    if (!kind) break;

    const category = findCategoryColumn(visual);
    if (!category) break;
    const recommended: IbcsOrientation = isTimeProperty(category) ? 'column' : 'bar';
    if (recommended === kind) break;

    const newGuid = recommended === 'column' ? IBCS_COLUMN_GUID : IBCS_BAR_GUID;
    const newText = part.text.replace(`"${vType}"`, `"${newGuid}"`);
    if (newText === part.text) break;

    edits[part.path] = newText;
    updated.push({
      page: m[1],
      visual: m[2],
      category,
      current: kind,
      recommended,
      needsChange: true,
    });
    break;
  }

  const changed = Object.keys(edits).length
    ? await saveDefinitionParts('report', workspaceId, reportId, edits)
    : 0;

  return {
    changed,
    updated,
    detail:
      changed > 0
        ? `Re-oriented the IBCS visual to ${updated[0]?.recommended ?? ''} to match its category axis.`
        : 'The IBCS visual already follows the time-horizontal / category-vertical rule.',
  };
}
