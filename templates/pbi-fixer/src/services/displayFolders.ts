// Display-folder organization (PKG-14 · MA3 — pairs with rules E4 / E5).
//
// "Auto clean up into display folders": groups columns and measures that share
// a leading name token into a display folder named after that token. Only
// objects that currently have *no* display folder are touched, and a folder is
// only created when at least `minGroupSize` siblings share the token — so a
// table of unrelated one-off fields is left alone. The proposal is shown to the
// user before anything is written.
//
// Writes go through the same surgical TMDL `updateDefinition` path the measure
// editor, property editor and BPA auto-fixer use: only a single
// `displayFolder:` property line is inserted/updated per object — DAX
// expressions, lineageTags, annotations and every other line are preserved
// verbatim. A whole model is organized in one load/save round-trip.

import { loadDefinitionParts, saveDefinitionParts, loadModelData } from './fabricRest';
import type { ModelData } from '../explorer/types';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export type FolderObjKind = 'column' | 'measure';

export interface FolderAssignment {
  table: string;
  kind: FolderObjKind;
  name: string;
  /** The display folder the object will be moved into. */
  folder: string;
}

export interface FolderPlan {
  assignments: FolderAssignment[];
  /** Columns considered (lacking a folder, in a table over the threshold). */
  scannedColumns: number;
  /** Measures considered. */
  scannedMeasures: number;
}

export interface OrganizeOptions {
  /** Organize columns (default true). */
  columns: boolean;
  /** Organize measures (default true). */
  measures: boolean;
  /** Minimum siblings that must share a leading token to form a folder. */
  minGroupSize: number;
  /** Only organize a table once it has more than this many of the object kind. */
  tableThreshold: number;
}

export const DEFAULT_ORGANIZE_OPTIONS: OrganizeOptions = {
  columns: true,
  measures: true,
  minGroupSize: 2,
  tableThreshold: 10,
};

export interface OrganizeResult {
  /** Number of object property lines written. */
  changed: number;
  /** Number of objects the plan intended to move. */
  planned: number;
  detail: string;
}

// --------------------------------------------------------------------------- //
// TMDL primitives (kept local so this module stays self-contained)
// --------------------------------------------------------------------------- //

function indentOf(line: string): number {
  const m = /^(\t*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Declared name from a TMDL declaration line for the given keyword, or null. */
function declName(line: string, keyword: string): string | null {
  const trimmed = line.replace(/^\t*/, '');
  if (!new RegExp(`^${keyword}[\\s]`).test(trimmed)) return null;
  const rest = trimmed.slice(keyword.length).replace(/^\s+/, '');
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  const m = /^([^\s=]+)/.exec(rest);
  return m ? m[1] : null;
}

/** Locate the top-level `table` declaration line index, or -1. */
function findTableDecl(lines: string[], table: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && declName(lines[i], 'table') === table) return i;
  }
  return -1;
}

/** Index after the table block that starts at `tableDeclIdx`. */
function tableBlockEnd(lines: string[], tableDeclIdx: number): number {
  for (let i = tableDeclIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) === 0) return i;
  }
  return lines.length;
}

interface ObjectBlock {
  start: number;
  end: number;
}

/** Block geometry for a `column`/`measure` declaration at `start` (indent 1),
 *  bounded by the table end. */
function blockFromStart(lines: string[], start: number, tableEnd: number): ObjectBlock {
  let end = tableEnd;
  for (let j = start + 1; j < tableEnd; j++) {
    if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
      end = j;
      break;
    }
  }
  return { start, end };
}

/** Locate a child `column`/`measure` block by name inside one table's bounds. */
function findObjectBlock(
  lines: string[],
  tableStart: number,
  tableEnd: number,
  keyword: FolderObjKind,
  name: string
): ObjectBlock | null {
  for (let i = tableStart + 1; i < tableEnd; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], keyword) === name) {
      return blockFromStart(lines, i, tableEnd);
    }
  }
  return null;
}

/** Anchor (last property line at indent >= 2 that is not an annotation) after
 *  which a fresh property is inserted. Falls back to the declaration line. */
function lastPropIndex(lines: string[], block: ObjectBlock): number {
  let anchor = block.start;
  for (let i = block.start + 1; i < block.end; i++) {
    if (
      indentOf(lines[i]) >= 2 &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('annotation')
    ) {
      anchor = i;
    }
  }
  return anchor;
}

/** Render a TMDL string property value, escaping embedded quotes. */
function quoteValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Insert or replace the `displayFolder:` line on the object block in `lines`.
 * Returns true when a change was made. The block is re-located by name so the
 * caller can apply many edits to the same `lines` array in sequence.
 */
function setDisplayFolder(
  lines: string[],
  table: string,
  kind: FolderObjKind,
  name: string,
  folder: string
): boolean {
  const tStart = findTableDecl(lines, table);
  if (tStart < 0) return false;
  const tEnd = tableBlockEnd(lines, tStart);
  const block = findObjectBlock(lines, tStart, tEnd, kind, name);
  if (!block) return false;

  const desired = `\t\tdisplayFolder: ${quoteValue(folder)}`;
  const re = /^\t\tdisplayFolder\b/;
  for (let i = block.start + 1; i < block.end; i++) {
    if (re.test(lines[i])) {
      if (lines[i] === desired) return false;
      lines[i] = desired;
      return true;
    }
  }
  lines.splice(lastPropIndex(lines, block) + 1, 0, desired);
  return true;
}

// --------------------------------------------------------------------------- //
// Planning
// --------------------------------------------------------------------------- //

/** Leading name token used as the display-folder name (text up to the first
 *  whitespace). Returns '' when the name has no usable leading token. */
function leadingToken(name: string): string {
  const trimmed = name.trim();
  const sp = trimmed.search(/\s/);
  const head = sp < 0 ? trimmed : trimmed.slice(0, sp);
  return head;
}

/** Group sibling object names by their leading token and return the assignments
 *  for tokens shared by at least `minGroupSize` objects. */
function groupByToken(names: string[], minGroupSize: number): Map<string, string> {
  const buckets = new Map<string, string[]>();
  for (const name of names) {
    const token = leadingToken(name);
    if (!token || token === name) continue; // single-word names have no family
    const list = buckets.get(token) ?? [];
    list.push(name);
    buckets.set(token, list);
  }
  const result = new Map<string, string>(); // objectName → folder
  for (const [token, list] of buckets) {
    if (list.length < minGroupSize) continue;
    for (const name of list) result.set(name, token);
  }
  return result;
}

/** Build the (pure) folder-assignment plan from already-loaded model metadata. */
export function planFolders(model: ModelData, options: OrganizeOptions): FolderPlan {
  const assignments: FolderAssignment[] = [];
  let scannedColumns = 0;
  let scannedMeasures = 0;

  for (const [tableName, table] of Object.entries(model.tables)) {
    // Skip calculation-group tables (their items are not folder-organized here).
    if (table.type === 'CalculationGroup') continue;

    if (options.columns) {
      const colNames = Object.keys(table.columns).filter(
        (c) => !/^RowNumber-/i.test(c) && (table.columns[c].displayFolder ?? '') === ''
      );
      if (Object.keys(table.columns).length > options.tableThreshold) {
        scannedColumns += colNames.length;
        const groups = groupByToken(colNames, options.minGroupSize);
        for (const [name, folder] of groups) {
          assignments.push({ table: tableName, kind: 'column', name, folder });
        }
      }
    }

    if (options.measures) {
      const measNames = Object.keys(table.measures).filter(
        (m) => (table.measures[m].displayFolder ?? '') === ''
      );
      if (Object.keys(table.measures).length > options.tableThreshold) {
        scannedMeasures += measNames.length;
        const groups = groupByToken(measNames, options.minGroupSize);
        for (const [name, folder] of groups) {
          assignments.push({ table: tableName, kind: 'measure', name, folder });
        }
      }
    }
  }

  return { assignments, scannedColumns, scannedMeasures };
}

// --------------------------------------------------------------------------- //
// Scan + apply
// --------------------------------------------------------------------------- //

/** Load the model and compute the folder-assignment plan (no writes). */
export async function scanDisplayFolders(
  workspaceId: string,
  datasetId: string,
  datasetName: string,
  options: OrganizeOptions = DEFAULT_ORGANIZE_OPTIONS
): Promise<FolderPlan> {
  const model = await loadModelData(workspaceId, datasetId, datasetName);
  return planFolders(model, options);
}

/**
 * Apply a folder-assignment plan in a single load/save round-trip. The plan is
 * grouped by table, and every object's `displayFolder` line is inserted/updated
 * on the part that owns its table. Returns the number of lines actually written.
 */
export async function applyDisplayFolders(
  workspaceId: string,
  datasetId: string,
  assignments: FolderAssignment[]
): Promise<OrganizeResult> {
  if (assignments.length === 0) {
    return { changed: 0, planned: 0, detail: 'Nothing to organize.' };
  }

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const updates: Record<string, string> = {};
  let changed = 0;

  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    let partChanged = false;

    for (const a of assignments) {
      // Only act when this part actually contains the object's table.
      if (findTableDecl(lines, a.table) < 0) continue;
      if (setDisplayFolder(lines, a.table, a.kind, a.name, a.folder)) {
        changed++;
        partChanged = true;
      }
    }

    if (partChanged) updates[part.path] = lines.join('\n');
  }

  if (changed === 0) {
    return { changed: 0, planned: assignments.length, detail: 'All objects were already organized.' };
  }

  const written = await saveDefinitionParts('model', workspaceId, datasetId, updates);
  return {
    changed,
    planned: assignments.length,
    detail:
      written > 0
        ? `Organized ${changed} object(s) into display folders.`
        : 'No change written.',
  };
}

/** Convenience: scan + apply in one call (used for the "organize all" action). */
export async function organizeDisplayFolders(
  workspaceId: string,
  datasetId: string,
  datasetName: string,
  options: OrganizeOptions = DEFAULT_ORGANIZE_OPTIONS
): Promise<OrganizeResult> {
  const plan = await scanDisplayFolders(workspaceId, datasetId, datasetName, options);
  return applyDisplayFolders(workspaceId, datasetId, plan.assignments);
}
