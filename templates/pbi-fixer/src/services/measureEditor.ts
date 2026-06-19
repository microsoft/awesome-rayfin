// Tabular-Editor-style measure editing.
//
// Loads the semantic model's TMDL definition, rebuilds a single `measure`
// block (DAX expression + formatString / displayFolder / description /
// isHidden) and writes it back through the same `updateDefinition` path the
// Source editor and the BPA auto-fixer use. Creating and deleting measures is
// handled the same way. Identity-bearing lines (lineageTag, annotations,
// formatStringDefinition, …) are preserved verbatim.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { formatDax } from './daxFormat';

export interface MeasureValues {
  /** The measure name (also the rename target when editing). */
  name: string;
  /** Full DAX expression (no leading `=`). May be multi-line. */
  expression: string;
  formatString: string;
  displayFolder: string;
  description: string;
  isHidden: boolean;
}

export interface MeasureSaveResult {
  changed: number;
  detail: string;
}

// --------------------------------------------------------------------------- //
// TMDL primitives
// --------------------------------------------------------------------------- //

function tab(n: number): string {
  return '\t'.repeat(n);
}

function indentOf(line: string): number {
  const m = /^(\t*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Declared name from a TMDL declaration line (`measure Foo`, `measure 'My M'`,
 *  `measure X = <expr>` …) for the given keyword, or null. */
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

/** Locate the line index that declares `table` at the top level, or -1. */
function findTableDecl(lines: string[], table: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && declName(lines[i], 'table') === table) return i;
  }
  return -1;
}

/** Index after the table block (first later line at indent 0), or lines.length. */
function tableBlockEnd(lines: string[], tableDeclIdx: number): number {
  for (let i = tableDeclIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) === 0) return i;
  }
  return lines.length;
}

interface MeasureBlock {
  /** First `///` description-comment line above the declaration. */
  descStart: number;
  /** The `measure …` declaration line. */
  start: number;
  /** Inclusive last line of the DAX expression (decl line for inline forms). */
  exprEnd: number;
  /** Exclusive end of the whole block (next sibling / table boundary). */
  end: number;
}

/** Resolve the full block geometry for a measure whose declaration is at
 *  `start`, bounded by `tableDeclIdx` (above) and `tableEnd` (below). */
function blockFromStart(
  lines: string[],
  tableDeclIdx: number,
  tableEnd: number,
  start: number
): MeasureBlock {
  // Description comments (`/// …`) directly above the declaration.
  let descStart = start;
  while (descStart - 1 > tableDeclIdx && lines[descStart - 1].trim().startsWith('///')) descStart--;

  // Expression span: fenced (``` … ```), inline (`= expr`) or indented continuation.
  const declTrim = lines[start].replace(/\s+$/, '');
  let exprEnd = start;
  if (declTrim.endsWith('```')) {
    for (let j = start + 1; j < tableEnd; j++) {
      if (lines[j].trim() === '```') {
        exprEnd = j;
        break;
      }
    }
  } else {
    const eq = declTrim.indexOf('=');
    const afterEq = eq >= 0 ? declTrim.slice(eq + 1).trim() : '';
    if (afterEq === '') {
      // Indented continuation — consume indent>=2 lines that are not properties.
      for (let j = start + 1; j < tableEnd; j++) {
        if (lines[j].trim() === '') continue;
        if (indentOf(lines[j]) >= 2 && !isManagedProp(lines[j]) && !isKnownProp(lines[j])) {
          exprEnd = j;
        } else break;
      }
    }
  }

  // Block end: first non-blank sibling at indent <= 1 after the expression.
  let end = tableEnd;
  for (let j = exprEnd + 1; j < tableEnd; j++) {
    if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
      end = j;
      break;
    }
  }
  return { descStart, start, exprEnd, end };
}

/** Locate a measure block within the bounds of a single table. */
function findMeasureBlock(
  lines: string[],
  tableDeclIdx: number,
  tableEnd: number,
  name: string
): MeasureBlock | null {
  for (let i = tableDeclIdx + 1; i < tableEnd; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], 'measure') === name) {
      return blockFromStart(lines, tableDeclIdx, tableEnd, i);
    }
  }
  return null;
}

/** Reconstruct the DAX expression text from a measure block. */
function extractExpression(lines: string[], start: number, exprEnd: number): string {
  const declTrim = lines[start].replace(/\s+$/, '');
  if (declTrim.endsWith('```')) {
    // Fenced: strip the closing-delimiter indentation from each content line.
    const fenceIndent = indentOf(lines[exprEnd]);
    const prefix = '\t'.repeat(fenceIndent);
    return lines
      .slice(start + 1, exprEnd)
      .map((l) => (l.startsWith(prefix) ? l.slice(fenceIndent) : l.replace(/^\t+/, '')))
      .join('\n');
  }
  const eq = declTrim.indexOf('=');
  const afterEq = eq >= 0 ? declTrim.slice(eq + 1).trim() : '';
  if (exprEnd === start) return afterEq; // inline
  // Indented continuation — drop the leading two tabs from each line.
  const cont = lines.slice(start + 1, exprEnd + 1).map((l) => l.replace(/^\t\t/, ''));
  return (afterEq ? afterEq + '\n' : '') + cont.join('\n');
}

/** Read all measure values from a single block. */
function extractValues(lines: string[], block: MeasureBlock): MeasureValues {
  const name = declName(lines[block.start], 'measure') ?? '';
  const expression = extractExpression(lines, block.start, block.exprEnd);
  let formatString = '';
  let displayFolder = '';
  let isHidden = false;
  for (let i = block.exprEnd + 1; i < block.end; i++) {
    const fs = /^\t\tformatString:\s?(.*)$/.exec(lines[i]);
    if (fs) formatString = fs[1].trim();
    const df = /^\t\tdisplayFolder:\s?(.*)$/.exec(lines[i]);
    if (df) displayFolder = df[1].trim();
    if (/^\t\tisHidden\b/.test(lines[i])) {
      const m = /^\t\tisHidden:\s*(\w+)/.exec(lines[i]);
      isHidden = m ? m[1] === 'true' : true;
    }
  }
  const description = lines
    .slice(block.descStart, block.start)
    .map((l) => l.replace(/^\t*\/\/\/\s?/, ''))
    .join('\n');
  return { name, expression, formatString, displayFolder, description, isHidden };
}

const KNOWN_PROP_RE =
  /^\t\t(formatString|displayFolder|description|isHidden|lineageTag|formatStringDefinition|detailRowsDefinition|kpi|dataCategory|displayName|annotation|extendedProperty|changedProperty|sourceLineageTag)\b/;

/** A property line this editor manages (and therefore rewrites). */
function isManagedProp(line: string): boolean {
  return /^\t\t(formatString:|displayFolder:|isHidden\b)/.test(line);
}

/** Any recognised measure property / annotation line. */
function isKnownProp(line: string): boolean {
  return KNOWN_PROP_RE.test(line);
}

/** Build the declaration + expression lines for a measure. */
function declLines(name: string, expression: string): string[] {
  const nameTok = quoteName(name);
  const expr = expression.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (!expr.includes('\n')) {
    return [`${tab(1)}measure ${nameTok} = ${expr.trim()}`];
  }
  // Multi-line → fenced block; content keeps its own relative indentation.
  const out = [`${tab(1)}measure ${nameTok} = \`\`\``];
  for (const ln of expr.split('\n')) out.push(`${tab(3)}${ln}`);
  out.push(`${tab(3)}\`\`\``);
  return out;
}

/** Build the leading `/// description` comment lines (empty when blank). */
function descLines(description: string): string[] {
  const d = description.replace(/\r\n/g, '\n').trim();
  if (!d) return [];
  return d.split('\n').map((l) => `${tab(1)}/// ${l}`);
}

/** Assemble a complete measure block, preserving non-managed property lines. */
function buildMeasureBlock(values: MeasureValues, preserved: string[]): string[] {
  const out: string[] = [];
  out.push(...descLines(values.description));
  out.push(...declLines(values.name, values.expression));
  if (values.formatString.trim()) out.push(`${tab(2)}formatString: ${values.formatString.trim()}`);
  if (values.displayFolder.trim()) out.push(`${tab(2)}displayFolder: ${values.displayFolder.trim()}`);
  if (values.isHidden) out.push(`${tab(2)}isHidden`);
  out.push(...preserved);
  return out;
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //

export interface LoadedMeasure {
  table: string;
  values: MeasureValues;
}

export interface LoadedMeasures {
  measures: LoadedMeasure[];
  /** Every table declared in the model (including those without measures). */
  tables: string[];
}

/**
 * Load every measure straight from the model's TMDL definition. Reading from
 * the same source we write to guarantees the editor always shows the real DAX
 * expression and properties (the executeQueries / INFO.VIEW path does not
 * reliably surface measure expressions in this REST-proxy environment).
 */
export async function loadMeasures(
  workspaceId: string,
  datasetId: string
): Promise<LoadedMeasures> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const measures: LoadedMeasure[] = [];
  const tables: string[] = [];
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const table = indentOf(lines[i]) === 0 ? declName(lines[i], 'table') : null;
      if (!table) continue;
      tables.push(table);
      const tEnd = tableBlockEnd(lines, i);
      for (let j = i + 1; j < tEnd; j++) {
        if (indentOf(lines[j]) === 1 && declName(lines[j], 'measure') !== null) {
          const block = blockFromStart(lines, i, tEnd, j);
          measures.push({ table, values: extractValues(lines, block) });
          j = block.end - 1;
        }
      }
      i = tEnd - 1;
    }
  }
  measures.sort((a, b) => a.table.localeCompare(b.table) || a.values.name.localeCompare(b.values.name));
  tables.sort();
  return { measures, tables };
}

/**
 * Update an existing measure. `originalName` identifies the block to replace;
 * `values.name` becomes the new declared name (supports rename). The DAX
 * expression and managed properties are rewritten; lineageTag, annotations and
 * other lines are preserved.
 */
export async function updateMeasure(
  workspaceId: string,
  datasetId: string,
  table: string,
  originalName: string,
  values: MeasureValues
): Promise<MeasureSaveResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const tIdx = findTableDecl(lines, table);
    if (tIdx < 0) continue;
    const tEnd = tableBlockEnd(lines, tIdx);
    const block = findMeasureBlock(lines, tIdx, tEnd, originalName);
    if (!block) continue;

    const preserved = lines
      .slice(block.exprEnd + 1, block.end)
      .filter((l) => l.trim() !== '' && !isManagedProp(l));
    const rebuilt = buildMeasureBlock(values, preserved);
    lines.splice(block.descStart, block.end - block.descStart, ...rebuilt);

    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail:
        changed > 0
          ? `Saved measure ${table}[${values.name}].`
          : 'No change was written (model already up to date).',
    };
  }
  return { changed: 0, detail: `Measure ${table}[${originalName}] was not found in the model definition.` };
}

/** Create a new measure on `table`. Fails if the name already exists. */
export async function createMeasure(
  workspaceId: string,
  datasetId: string,
  table: string,
  values: MeasureValues
): Promise<MeasureSaveResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const tIdx = findTableDecl(lines, table);
    if (tIdx < 0) continue;
    const tEnd = tableBlockEnd(lines, tIdx);
    if (findMeasureBlock(lines, tIdx, tEnd, values.name)) {
      return { changed: 0, detail: `A measure named "${values.name}" already exists on ${table}.` };
    }

    // Insert before the first partition (keeps the m / source block intact),
    // otherwise at the end of the table block.
    let insertAt = tEnd;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1 && declName(lines[i], 'partition') !== null) {
        insertAt = i;
        break;
      }
    }
    while (insertAt - 1 > tIdx && lines[insertAt - 1].trim() === '') insertAt--;

    const block = buildMeasureBlock(values, []);
    lines.splice(insertAt, 0, '', ...block);

    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail:
        changed > 0
          ? `Created measure ${table}[${values.name}].`
          : 'No change was written.',
    };
  }
  return { changed: 0, detail: `Table "${table}" was not found in the model definition.` };
}

/** Delete a measure from `table`. */
export async function deleteMeasure(
  workspaceId: string,
  datasetId: string,
  table: string,
  name: string
): Promise<MeasureSaveResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const tIdx = findTableDecl(lines, table);
    if (tIdx < 0) continue;
    const tEnd = tableBlockEnd(lines, tIdx);
    const block = findMeasureBlock(lines, tIdx, tEnd, name);
    if (!block) continue;

    let from = block.descStart;
    let to = block.end;
    // Absorb one trailing blank separator line, if any.
    if (to < lines.length && lines[to].trim() === '') to++;
    // Otherwise absorb a leading blank separator line.
    else if (from - 1 > tIdx && lines[from - 1].trim() === '') from--;
    lines.splice(from, to - from);

    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: lines.join('\n'),
    });
    return {
      changed,
      detail:
        changed > 0 ? `Deleted measure ${table}[${name}].` : 'No change was written.',
    };
  }
  return { changed: 0, detail: `Measure ${table}[${name}] was not found in the model definition.` };
}

// --------------------------------------------------------------------------- //
// Bulk measure utilities (PKG-11)
// --------------------------------------------------------------------------- //

export interface BulkMeasureResult {
  /** Number of measures inspected. */
  scanned: number;
  /** Number of measures whose block was rewritten. */
  changed: number;
  /** Number of measures whose name changed (find/replace only). */
  renamed?: number;
  detail: string;
}

interface MeasureHit {
  table: string;
  block: MeasureBlock;
  values: MeasureValues;
}

/** Collect every measure block in a TMDL part, with its table + parsed values. */
function collectMeasures(lines: string[]): MeasureHit[] {
  const hits: MeasureHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) !== 0) continue;
    const table = declName(lines[i], 'table');
    if (!table) continue;
    const tEnd = tableBlockEnd(lines, i);
    for (let j = i + 1; j < tEnd; j++) {
      if (indentOf(lines[j]) === 1 && declName(lines[j], 'measure') !== null) {
        const block = blockFromStart(lines, i, tEnd, j);
        hits.push({ table, block, values: extractValues(lines, block) });
        j = block.end - 1;
      }
    }
    i = tEnd - 1;
  }
  return hits;
}

/** Rebuild a measure block (preserving non-managed property lines). */
function rebuildBlock(lines: string[], block: MeasureBlock, values: MeasureValues): string[] {
  const preserved = lines
    .slice(block.exprEnd + 1, block.end)
    .filter((l) => l.trim() !== '' && !isManagedProp(l));
  return buildMeasureBlock(values, preserved);
}

/** Apply a set of block replacements to `lines` bottom-up (indices stay valid). */
function applyBlockEdits(
  lines: string[],
  pending: { from: number; to: number; repl: string[] }[]
): void {
  pending.sort((a, b) => b.from - a.from);
  for (const e of pending) lines.splice(e.from, e.to - e.from, ...e.repl);
}

/**
 * Format every measure's DAX expression model-wide using the offline DAX
 * pretty-printer (MA2). Loads + writes the definition once; only measures whose
 * formatted text differs are rewritten. The formatter is self-checking (it
 * returns the input unchanged if its token stream would differ), so this can
 * never corrupt an expression.
 */
export async function formatAllMeasures(
  workspaceId: string,
  datasetId: string
): Promise<BulkMeasureResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const edits: Record<string, string> = {};
  let scanned = 0;
  let changed = 0;
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const pending: { from: number; to: number; repl: string[] }[] = [];
    for (const hit of collectMeasures(lines)) {
      scanned++;
      const formatted = formatDax(hit.values.expression);
      if (formatted !== hit.values.expression) {
        const repl = rebuildBlock(lines, hit.block, { ...hit.values, expression: formatted });
        pending.push({ from: hit.block.descStart, to: hit.block.end, repl });
        changed++;
      }
    }
    if (pending.length) {
      applyBlockEdits(lines, pending);
      edits[part.path] = lines.join('\n');
    }
  }
  if (Object.keys(edits).length) {
    await saveDefinitionParts('model', workspaceId, datasetId, edits);
  }
  return {
    scanned,
    changed,
    detail:
      changed === 0
        ? `All ${scanned} measure expression(s) were already formatted.`
        : `Formatted ${changed} of ${scanned} measure expression(s).`,
  };
}

/**
 * Format every measure's DAX expression inside a single in-memory TMDL part
 * string and return the rewritten text. Pure (no network) so callers such as
 * the Source/TMDL view can format the text the user is editing — including
 * unsaved edits — and route the result through their own save flow. Uses the
 * same self-checking pretty-printer as `formatAllMeasures`, so it can never
 * corrupt an expression (worst case it is a no-op).
 */
export function formatTmdlMeasures(text: string): {
  text: string;
  scanned: number;
  changed: number;
} {
  const lines = text.split('\n');
  const pending: { from: number; to: number; repl: string[] }[] = [];
  let scanned = 0;
  let changed = 0;
  for (const hit of collectMeasures(lines)) {
    scanned++;
    const formatted = formatDax(hit.values.expression);
    if (formatted !== hit.values.expression) {
      const repl = rebuildBlock(lines, hit.block, { ...hit.values, expression: formatted });
      pending.push({ from: hit.block.descStart, to: hit.block.end, repl });
      changed++;
    }
  }
  if (pending.length) applyBlockEdits(lines, pending);
  return { text: changed ? lines.join('\n') : text, scanned, changed };
}

export interface FindReplaceOptions {
  find: string;
  replace: string;
  /** Apply the replacement to measure DAX expressions. */
  inExpression: boolean;
  /** Apply the replacement to measure names (rename). */
  inName: boolean;
  caseSensitive?: boolean;
  /** Treat `find` as a JavaScript regular expression. */
  useRegex?: boolean;
}

/** Build a global replace function from the find/replace options. */
function buildReplacer(opts: FindReplaceOptions): (s: string) => string {
  const flags = opts.caseSensitive ? 'g' : 'gi';
  if (opts.useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(opts.find, flags);
    } catch {
      throw new Error('Invalid regular expression in "find".');
    }
    return (s) => s.replace(re, opts.replace);
  }
  const esc = opts.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, flags);
  return (s) => s.replace(re, opts.replace);
}

/**
 * Find & replace a substring (or regex) across measure names and/or DAX
 * expressions model-wide (MA1 / MA4). Loads + writes the definition once.
 * Renames change only the measure declaration — references to the measure in
 * other expressions are intentionally left untouched.
 */
export async function findReplaceInMeasures(
  workspaceId: string,
  datasetId: string,
  opts: FindReplaceOptions
): Promise<BulkMeasureResult> {
  if (!opts.find) return { scanned: 0, changed: 0, detail: 'Enter text to find.' };
  if (!opts.inName && !opts.inExpression) {
    return { scanned: 0, changed: 0, detail: 'Select at least one scope (names or expressions).' };
  }
  const replace = buildReplacer(opts);
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const edits: Record<string, string> = {};
  let scanned = 0;
  let changed = 0;
  let renamed = 0;
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const pending: { from: number; to: number; repl: string[] }[] = [];
    for (const hit of collectMeasures(lines)) {
      scanned++;
      const newName = opts.inName ? replace(hit.values.name) : hit.values.name;
      const newExpr = opts.inExpression ? replace(hit.values.expression) : hit.values.expression;
      if (newName !== hit.values.name || newExpr !== hit.values.expression) {
        const repl = rebuildBlock(lines, hit.block, {
          ...hit.values,
          name: newName,
          expression: newExpr,
        });
        pending.push({ from: hit.block.descStart, to: hit.block.end, repl });
        changed++;
        if (newName !== hit.values.name) renamed++;
      }
    }
    if (pending.length) {
      applyBlockEdits(lines, pending);
      edits[part.path] = lines.join('\n');
    }
  }
  if (Object.keys(edits).length) {
    await saveDefinitionParts('model', workspaceId, datasetId, edits);
  }
  const note = renamed > 0 ? ` (${renamed} renamed — references are not rewritten)` : '';
  return {
    scanned,
    changed,
    renamed,
    detail:
      changed === 0
        ? `No matches in ${scanned} measure(s).`
        : `Updated ${changed} of ${scanned} measure(s)${note}.`,
  };
}

