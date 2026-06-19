// Unused-object detection + guarded deletion (PKG-2 · E23 / E24).
//
// Finds columns (E23) and measures (E24) that no other object in the model
// references, then deletes the user-approved subset with a surgical TMDL edit.
// This is the destructive corner of the model fixer, so detection is
// deliberately *conservative*: an object is only reported as unused when its
// name appears nowhere in the model definition outside its own declaration
// block. Anything that shares a name with a referenced object, participates in
// a relationship, or is a system/auto object is treated as used and never
// proposed for deletion.
//
// What is checked (in-model, via the full TMDL corpus + INFO.VIEW relationships):
//   - relationships (column endpoints)
//   - measure / calculated-column / calc-item / calculated-table DAX
//   - hierarchy levels, sort-by columns, RLS filter expressions, KPI, etc.
// What is NOT checked (surfaced as a caveat in the UI):
//   - cross-report / cross-model usage — not visible from a single model.
//
// Deletion goes through the same `updateDefinition` path the measure editor and
// BPA auto-fixer use, and is reversible from source control / model history.

import { loadDefinitionParts, saveDefinitionParts, loadModelData } from './fabricRest';
import { deleteMeasure } from './measureEditor';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export interface UnusedColumn {
  table: string;
  column: string;
  dataType: string;
  isCalculated: boolean;
  isHidden: boolean;
  reason: string;
}

export interface UnusedMeasure {
  table: string;
  measure: string;
  isHidden: boolean;
  reason: string;
}

export interface UnusedScan {
  columns: UnusedColumn[];
  measures: UnusedMeasure[];
  /** Total columns considered (after excluding system / auto objects). */
  scannedColumns: number;
  /** Total measures considered. */
  scannedMeasures: number;
}

export interface DeleteResult {
  deleted: number;
  failed: number;
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

/** Index after the table block that starts at `tableDeclIdx`. */
function tableBlockEnd(lines: string[], tableDeclIdx: number): number {
  for (let i = tableDeclIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) === 0) return i;
  }
  return lines.length;
}

interface ObjectBlock {
  /** First line of the block (the declaration, ignoring `///` comments). */
  start: number;
  /** Exclusive end of the block (next sibling at indent <= 1, or table end). */
  end: number;
}

/** Block geometry for a `column`/`measure` declaration at `start`. */
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

/** Count whole-identifier occurrences of `name` in `haystack`. A non-word
 *  character (or string edge) must border each side, so `[Jahr]`, `'Jahr'`,
 *  `.Jahr`, and `Jahr ` all match but `Jahreszahl` does not. */
function countTokens(haystack: string, name: string): number {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'g');
  const m = haystack.match(re);
  return m ? m.length : 0;
}

// --------------------------------------------------------------------------- //
// Exclusion heuristics
// --------------------------------------------------------------------------- //

/** Auto-generated date tables Power BI maintains internally. */
function isAutoDateTable(table: string): boolean {
  return /^(LocalDateTable_|DateTableTemplate_)/.test(table);
}

/** System columns that must never be proposed for deletion. */
function isSystemColumn(column: string): boolean {
  return /^RowNumber-/i.test(column);
}

// --------------------------------------------------------------------------- //
// Scan
// --------------------------------------------------------------------------- //

interface ParsedObject {
  table: string;
  name: string;
  /** Verbatim text of the object's own declaration block. */
  blockText: string;
}

interface ParsedModel {
  columns: ParsedObject[];
  measures: ParsedObject[];
  /** Tables that are calculation groups (their columns are system-managed). */
  calcGroupTables: Set<string>;
  /** Full TMDL corpus (all non-binary parts joined). */
  corpus: string;
}

/** Parse every column / measure declaration block out of the TMDL parts. */
function parseTmdl(parts: { text: string; binary?: boolean }[]): ParsedModel {
  const columns: ParsedObject[] = [];
  const measures: ParsedObject[] = [];
  const calcGroupTables = new Set<string>();
  const texts: string[] = [];

  for (const part of parts) {
    if (part.binary) continue;
    texts.push(part.text);
    const lines = part.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const table = indentOf(lines[i]) === 0 ? declName(lines[i], 'table') : null;
      if (!table) continue;
      const tEnd = tableBlockEnd(lines, i);
      for (let j = i + 1; j < tEnd; j++) {
        const trimmed = lines[j].trim();
        if (indentOf(lines[j]) === 1 && trimmed.startsWith('calculationGroup')) {
          calcGroupTables.add(table);
        }
        if (indentOf(lines[j]) !== 1) continue;
        const colName = declName(lines[j], 'column');
        if (colName !== null) {
          const blk = blockFromStart(lines, j, tEnd);
          columns.push({ table, name: colName, blockText: lines.slice(blk.start, blk.end).join('\n') });
          continue;
        }
        const measName = declName(lines[j], 'measure');
        if (measName !== null) {
          const blk = blockFromStart(lines, j, tEnd);
          measures.push({ table, name: measName, blockText: lines.slice(blk.start, blk.end).join('\n') });
        }
      }
      i = tEnd - 1;
    }
  }

  return { columns, measures, calcGroupTables, corpus: texts.join('\n') };
}

/**
 * Scan the model for columns (E23) and measures (E24) that nothing else in the
 * model references. Loads model metadata (for relationships + column types) and
 * the raw TMDL (for reference analysis), then applies the conservative
 * "token appears nowhere outside its own block" test.
 */
export async function scanUnusedObjects(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<UnusedScan> {
  const [model, parts] = await Promise.all([
    loadModelData(workspaceId, datasetId, datasetName),
    loadDefinitionParts('model', workspaceId, datasetId),
  ]);
  const parsed = parseTmdl(parts);
  const corpus = parsed.corpus;

  // Columns that participate in a relationship are always "used".
  const relColumns = new Set<string>();
  for (const r of model.relationships) {
    relColumns.add(`${r.fromTable}\u0000${r.fromColumn}`);
    relColumns.add(`${r.toTable}\u0000${r.toColumn}`);
  }

  const NOT_REFERENCED =
    'No references found in the model definition (relationships, DAX, hierarchies, sort-by, RLS). Cross-report usage is not checked.';

  const unusedColumns: UnusedColumn[] = [];
  let scannedColumns = 0;
  for (const c of parsed.columns) {
    if (isAutoDateTable(c.table) || isSystemColumn(c.name) || parsed.calcGroupTables.has(c.table)) {
      continue;
    }
    scannedColumns++;
    if (relColumns.has(`${c.table}\u0000${c.name}`)) continue;
    const total = countTokens(corpus, c.name);
    const own = countTokens(c.blockText, c.name);
    if (total - own > 0) continue; // referenced elsewhere → used
    const meta = model.tables[c.table]?.columns[c.name];
    unusedColumns.push({
      table: c.table,
      column: c.name,
      dataType: meta?.dataType ?? '',
      isCalculated: !!meta?.expression,
      isHidden: !!meta?.isHidden,
      reason: NOT_REFERENCED,
    });
  }

  const unusedMeasures: UnusedMeasure[] = [];
  let scannedMeasures = 0;
  for (const m of parsed.measures) {
    if (isAutoDateTable(m.table)) continue;
    scannedMeasures++;
    const total = countTokens(corpus, m.name);
    const own = countTokens(m.blockText, m.name);
    if (total - own > 0) continue; // referenced by another measure / object → used
    const meta = model.tables[m.table]?.measures[m.name];
    unusedMeasures.push({
      table: m.table,
      measure: m.name,
      isHidden: !!meta?.isHidden,
      reason: NOT_REFERENCED,
    });
  }

  unusedColumns.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  unusedMeasures.sort((a, b) => a.table.localeCompare(b.table) || a.measure.localeCompare(b.measure));

  return {
    columns: unusedColumns,
    measures: unusedMeasures,
    scannedColumns,
    scannedMeasures,
  };
}

// --------------------------------------------------------------------------- //
// Deletion
// --------------------------------------------------------------------------- //

/** Find the table declaration line index, or -1. */
function findTableDecl(lines: string[], table: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && declName(lines[i], 'table') === table) return i;
  }
  return -1;
}

/** Delete a single column from a table via a surgical TMDL edit. */
export async function deleteColumn(
  workspaceId: string,
  datasetId: string,
  table: string,
  column: string
): Promise<boolean> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const tIdx = findTableDecl(lines, table);
    if (tIdx < 0) continue;
    const tEnd = tableBlockEnd(lines, tIdx);

    let start = -1;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1 && declName(lines[i], 'column') === column) {
        start = i;
        break;
      }
    }
    if (start < 0) continue;
    const { end } = blockFromStart(lines, start, tEnd);

    // Absorb leading `///` description comments above the declaration.
    let from = start;
    while (from - 1 > tIdx && lines[from - 1].trim().startsWith('///')) from--;
    let to = end;
    // Absorb one trailing blank separator, else one leading blank separator.
    if (to < lines.length && lines[to].trim() === '') to++;
    else if (from - 1 > tIdx && lines[from - 1].trim() === '') from--;
    lines.splice(from, to - from);

    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return changed > 0;
  }
  return false;
}

/**
 * Delete an approved set of unused columns and measures. Each object is removed
 * with its own surgical edit; failures are tallied but do not abort the batch.
 * Never called automatically — the UI requires an explicit confirm gate.
 */
export async function deleteUnusedObjects(
  workspaceId: string,
  datasetId: string,
  columns: { table: string; column: string }[],
  measures: { table: string; measure: string }[]
): Promise<DeleteResult> {
  let deleted = 0;
  let failed = 0;

  // Delete measures first (they may reference columns we are about to remove).
  for (const m of measures) {
    try {
      const r = await deleteMeasure(workspaceId, datasetId, m.table, m.measure);
      if (r.changed > 0) deleted++;
      else failed++;
    } catch {
      failed++;
    }
  }
  for (const c of columns) {
    try {
      if (await deleteColumn(workspaceId, datasetId, c.table, c.column)) deleted++;
      else failed++;
    } catch {
      failed++;
    }
  }

  const detail =
    failed === 0
      ? `Deleted ${deleted} object${deleted === 1 ? '' : 's'}.`
      : `Deleted ${deleted}, ${failed} failed.`;
  return { deleted, failed, detail };
}
