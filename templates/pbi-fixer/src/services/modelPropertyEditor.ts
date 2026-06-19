// Generic Model-Explorer property editor.
//
// Surgically edits a single metadata property on a column / table / measure
// block in the model's TMDL definition and writes it back through the same
// `updateDefinition` path the Source editor and BPA auto-fixer use. Only the
// targeted property line (or the leading `/// description` comment block) is
// touched — DAX expressions, lineageTags, annotations and every other line are
// preserved verbatim. Measure edits reuse the tested loadMeasures/updateMeasure
// round-trip so multi-line DAX is never disturbed.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { loadMeasures, updateMeasure } from './measureEditor';

export interface PropertySaveResult {
  changed: number;
  detail: string;
}

/** Boolean properties: true → `prop: true`, false → omit the line (absence
 *  means false). The Power BI TMDL importer rejects bare flag keywords. */
const BOOLEAN_PROPS = new Set(['isHidden', 'isKey']);

// --------------------------------------------------------------------------- //
// TMDL primitives (mirrors measureEditor / modelBpaFix)
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

/** Quote a TMDL identifier when it is not a bare word. */
function quoteName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

interface Block {
  /** Declaration line index (`column …`, `table …`). */
  start: number;
  /** Exclusive end of the block (next sibling / table boundary). */
  end: number;
}

/** Locate the `table` declaration block at the top level. */
function findTableBlock(lines: string[], table: string): Block | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && declName(lines[i], 'table') === table) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].trim() !== '' && indentOf(lines[j]) === 0) {
      end = j;
      break;
    }
  }
  return { start, end };
}

/** Locate a `column` block (indent 1) inside the bounds of one table. */
function findColumnBlock(lines: string[], table: string, column: string): Block | null {
  const tBlock = findTableBlock(lines, table);
  if (!tBlock) return null;
  let start = -1;
  for (let i = tBlock.start + 1; i < tBlock.end; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], 'column') === column) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = tBlock.end;
  for (let j = start + 1; j < tBlock.end; j++) {
    if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
      end = j;
      break;
    }
  }
  return { start, end };
}

/** True when a line is a scalar `name: value` property (e.g. `dataType: string`),
 *  not a `changedProperty = X` / `annotation X = Y` marker or a blank line. TMDL
 *  requires scalar properties to precede such markers, so a new property line
 *  must be inserted after the last scalar property — never after a marker. */
function isScalarProp(line: string): boolean {
  const t = line.trimStart();
  if (t === '' || t.startsWith('annotation')) return false;
  return /^[A-Za-z_]\w*\s*:\s/.test(t);
}

/** Index of the last scalar property line inside a column block, used as the
 *  anchor after which a new property is inserted. Falls back to the declaration
 *  line itself. */
function lastColumnPropIndex(lines: string[], block: Block): number {
  let anchor = block.start;
  for (let i = block.start + 1; i < block.end; i++) {
    if (isScalarProp(lines[i])) {
      anchor = i;
    }
  }
  return anchor;
}

/** Render a single property line at the given indent. */
function propLine(indent: number, prop: string, value: string): string {
  return `${'\t'.repeat(indent)}${prop}: ${value}`;
}

/**
 * Set / clear one scalar or boolean property inside an already-located block.
 * `propIndent` is the indent of the property lines (column/measure = 2,
 * table = 1). `insertAnchor` is the line index after which a brand-new property
 * line is inserted. Returns true when a change was made.
 */
function setBlockProperty(
  lines: string[],
  block: Block,
  propIndent: number,
  insertAnchor: number,
  prop: string,
  value: string | boolean
): boolean {
  const isBool = BOOLEAN_PROPS.has(prop);
  // Find an existing line for this property (bare flag or `prop: value`).
  const re = new RegExp(`^\\t{${propIndent}}${prop}\\b`);
  let existing = -1;
  for (let i = block.start + 1; i < block.end; i++) {
    if (re.test(lines[i])) {
      existing = i;
      break;
    }
  }

  if (isBool) {
    const want = Boolean(value);
    if (want) {
      const desired = propLine(propIndent, prop, 'true');
      if (existing >= 0) {
        if (lines[existing] === desired) return false;
        lines[existing] = desired;
        return true;
      }
      lines.splice(insertAnchor + 1, 0, desired);
      return true;
    }
    // want === false → remove the property line if present (absence = false).
    if (existing >= 0) {
      lines.splice(existing, 1);
      return true;
    }
    return false;
  }

  // Scalar / enum property.
  const v = String(value).trim();
  if (v === '') {
    if (existing >= 0) {
      lines.splice(existing, 1);
      return true;
    }
    return false;
  }
  const line = propLine(propIndent, prop, v);
  if (existing >= 0) {
    if (lines[existing] === line) return false;
    lines[existing] = line;
    return true;
  }
  lines.splice(insertAnchor + 1, 0, line);
  return true;
}

/**
 * Replace the leading `/// description` comment block above a declaration.
 * `declIndent` is the indent of the declaration line (column = 1, table = 0).
 * Returns true when a change was made.
 */
function setDescription(
  lines: string[],
  declStart: number,
  declIndent: number,
  value: string
): boolean {
  let descStart = declStart;
  while (descStart - 1 >= 0 && lines[descStart - 1].trim().startsWith('///')) descStart--;
  const current = lines
    .slice(descStart, declStart)
    .map((l) => l.replace(/^\t*\/\/\/\s?/, ''))
    .join('\n');
  const next = value.replace(/\r\n/g, '\n').trim();
  if (current === next) return false;
  const newLines = next
    ? next.split('\n').map((l) => `${'\t'.repeat(declIndent)}/// ${l}`)
    : [];
  lines.splice(descStart, declStart - descStart, ...newLines);
  return true;
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //

/** Set one property on a column. `prop === 'description'` rewrites the leading
 *  `///` comment block; everything else is a scalar / boolean property line. */
export async function setColumnProperty(
  workspaceId: string,
  datasetId: string,
  table: string,
  column: string,
  prop: string,
  value: string | boolean
): Promise<PropertySaveResult> {
  const isSortBy = prop === 'sortByColumn';
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const block = findColumnBlock(lines, table, column);
    if (!block) continue;

    let changedLines: boolean;
    if (prop === 'description') {
      changedLines = setDescription(lines, block.start, 1, String(value));
    } else {
      const v = isSortBy && value ? quoteName(String(value)) : value;
      changedLines = setBlockProperty(lines, block, 2, lastColumnPropIndex(lines, block), prop, v);
    }
    if (!changedLines) {
      return { changed: 0, detail: `${table}[${column}] already up to date.` };
    }
    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail: changed > 0 ? `Updated ${prop} on ${table}[${column}].` : 'No change written.',
    };
  }
  return { changed: 0, detail: `Column ${table}[${column}] was not found in the model definition.` };
}

/** Set one property on a table (supports `isHidden` and `description`). */
export async function setTableProperty(
  workspaceId: string,
  datasetId: string,
  table: string,
  prop: string,
  value: string | boolean
): Promise<PropertySaveResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const block = findTableBlock(lines, table);
    if (!block) continue;

    let changedLines: boolean;
    if (prop === 'description') {
      changedLines = setDescription(lines, block.start, 0, String(value));
    } else {
      // Table-level scalar/boolean properties go right after the declaration
      // line (before any child column/measure), so the anchor is the decl line.
      changedLines = setBlockProperty(lines, block, 1, block.start, prop, value);
    }
    if (!changedLines) {
      return { changed: 0, detail: `Table ${table} already up to date.` };
    }
    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail: changed > 0 ? `Updated ${prop} on table ${table}.` : 'No change written.',
    };
  }
  return { changed: 0, detail: `Table ${table} was not found in the model definition.` };
}

/**
 * Replace the M (Power Query) source expression of a table's `= m` partition.
 * Only the multi-line `source =` body is rewritten — the partition's mode,
 * queryGroup, lineage and every other line are preserved verbatim. The incoming
 * `expression` is the raw M (e.g. `let … in …`); each line is re-indented to the
 * existing TMDL body depth so the round-trip is lossless.
 */
export async function setPartitionExpression(
  workspaceId: string,
  datasetId: string,
  table: string,
  expression: string
): Promise<PropertySaveResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const tBlock = findTableBlock(lines, table);
    if (!tBlock) continue;

    // Locate the `= m` partition block inside the table.
    let pStart = -1;
    for (let i = tBlock.start + 1; i < tBlock.end; i++) {
      if (
        indentOf(lines[i]) === 1 &&
        declName(lines[i], 'partition') !== null &&
        /=\s*m\b/.test(lines[i])
      ) {
        pStart = i;
        break;
      }
    }
    if (pStart < 0) {
      return { changed: 0, detail: `Table ${table} has no M (Power Query) partition to edit.` };
    }
    let pEnd = tBlock.end;
    for (let j = pStart + 1; j < tBlock.end; j++) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
        pEnd = j;
        break;
      }
    }

    // Find the `source` line (indent 2) inside the partition block.
    let srcIdx = -1;
    for (let i = pStart + 1; i < pEnd; i++) {
      if (indentOf(lines[i]) === 2 && /^source\b/.test(lines[i].trimStart())) {
        srcIdx = i;
        break;
      }
    }
    if (srcIdx < 0) {
      return { changed: 0, detail: `Partition source for ${table} was not found.` };
    }

    // The M body is every following line indented deeper than the source line,
    // up to the next property / partition boundary (blank lines stay in body).
    let bodyEnd = pEnd;
    for (let j = srcIdx + 1; j < pEnd; j++) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= 2) {
        bodyEnd = j;
        break;
      }
    }
    // Re-indent new lines to the existing body depth (fallback: source + 2).
    let bodyIndent = 4;
    for (let j = srcIdx + 1; j < bodyEnd; j++) {
      if (lines[j].trim() !== '') {
        bodyIndent = indentOf(lines[j]);
        break;
      }
    }

    const normalized = expression.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    const newBody = normalized
      .split('\n')
      .map((l) => (l.trim() === '' ? '' : `${'\t'.repeat(bodyIndent)}${l}`));
    const desiredSrc = `${'\t'.repeat(2)}source =`;
    const existingBody = lines.slice(srcIdx + 1, bodyEnd);

    if (lines[srcIdx] === desiredSrc && existingBody.join('\n') === newBody.join('\n')) {
      return { changed: 0, detail: `M expression on table ${table} already up to date.` };
    }
    lines.splice(srcIdx, bodyEnd - srcIdx, desiredSrc, ...newBody);

    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail: changed > 0 ? `Updated M expression on table ${table}.` : 'No change written.',
    };
  }
  return { changed: 0, detail: `Table ${table} was not found in the model definition.` };
}

/**
 * Set one property on a measure. Reuses the tested loadMeasures/updateMeasure
 * round-trip so the DAX expression and all preserved lines survive intact.
 * Supports `formatString`, `displayFolder`, `description`, `isHidden`.
 */
export async function setMeasureProperty(
  workspaceId: string,
  datasetId: string,
  table: string,
  measure: string,
  prop: string,
  value: string | boolean
): Promise<PropertySaveResult> {
  const loaded = await loadMeasures(workspaceId, datasetId);
  const found = loaded.measures.find((m) => m.table === table && m.values.name === measure);
  if (!found) {
    return { changed: 0, detail: `Measure ${table}[${measure}] was not found in the model definition.` };
  }
  const values = { ...found.values };
  switch (prop) {
    case 'formatString':
      values.formatString = String(value);
      break;
    case 'displayFolder':
      values.displayFolder = String(value);
      break;
    case 'description':
      values.description = String(value);
      break;
    case 'isHidden':
      values.isHidden = Boolean(value);
      break;
    default:
      return { changed: 0, detail: `Property "${prop}" is not editable on a measure.` };
  }
  return updateMeasure(workspaceId, datasetId, table, measure, values);
}
