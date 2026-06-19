// Descriptions service — export / import / AI-generate object descriptions.
//
// PKG-12. Reads and writes the leading `/// description` comment block on every
// table, column and measure straight from the model's TMDL definition (the same
// loadDefinitionParts / saveDefinitionParts round-trip the property editor and
// BPA auto-fixer use). Only the `///` comment lines above each declaration are
// ever touched — DAX expressions, partitions, lineageTags and every other line
// are preserved verbatim, so the round-trip is lossless.
//
// Three capabilities are exposed:
//   • Export / Import — round-trip all descriptions as a portable JSON document.
//   • Fill from DAX (B12) — set an empty measure description to its DAX text.
//   • AI-generate — ask GitHub Copilot (via the existing `github_comment_m` UDF,
//     the same describe-only path the M step commenter uses) to write a one-line
//     description for objects that have none. The model only ever DESCRIBES; the
//     proposal is shown for review before anything is written.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { loadMeasures } from './measureEditor';
import { getGithubToken } from './githubAuth';
import { GithubAuthRequiredError } from './mCommenter';
import { udf } from './udfClient';

export type DescObjectType = 'Table' | 'Column' | 'Measure';

export interface DescriptionEntry {
  objectType: DescObjectType;
  /** Owning table. For a Table entry this equals `name`. */
  table: string;
  /** Object name (table / column / measure). */
  name: string;
  /** Current description (`/// …` block joined with newlines). */
  description: string;
  /** DAX expression — measures only, used for "fill from DAX" and AI context. */
  expression?: string;
}

export interface ApplyResult {
  /** Number of TMDL parts written. */
  changed: number;
  /** Number of object descriptions actually updated. */
  applied: number;
  detail: string;
}

// --------------------------------------------------------------------------- //
// TMDL primitives (mirrors measureEditor / modelPropertyEditor)
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

/** Stable identity for an entry, used to dedupe / look up edits. */
function entryKey(objectType: DescObjectType, table: string, name: string): string {
  return `${objectType}\u0001${table}\u0001${name}`;
}

export function keyOf(e: DescriptionEntry): string {
  return entryKey(e.objectType, e.table, e.name);
}

interface DeclLocation {
  objectType: DescObjectType;
  table: string;
  name: string;
  /** Index of the declaration line. */
  declStart: number;
  /** Indent of the declaration line (table = 0, column / measure = 1). */
  declIndent: number;
}

/** Locate every table / column / measure declaration in one TMDL part. */
function locateDeclarations(lines: string[]): DeclLocation[] {
  const out: DeclLocation[] = [];
  let currentTable: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const indent = indentOf(lines[i]);
    if (indent === 0) {
      const t = declName(lines[i], 'table');
      if (t !== null) {
        currentTable = t;
        out.push({ objectType: 'Table', table: t, name: t, declStart: i, declIndent: 0 });
        continue;
      }
      // A non-table top-level declaration ends the current table scope.
      if (lines[i].trim() !== '' && declName(lines[i], 'table') === null) {
        // Keep currentTable for ref-only lines; only clear on a real new block.
      }
    } else if (indent === 1 && currentTable) {
      const col = declName(lines[i], 'column');
      if (col !== null) {
        out.push({ objectType: 'Column', table: currentTable, name: col, declStart: i, declIndent: 1 });
        continue;
      }
      const meas = declName(lines[i], 'measure');
      if (meas !== null) {
        out.push({ objectType: 'Measure', table: currentTable, name: meas, declStart: i, declIndent: 1 });
        continue;
      }
    }
  }
  return out;
}

/** Read the `/// …` description block immediately above a declaration line. */
function readDescription(lines: string[], declStart: number): string {
  let descStart = declStart;
  while (descStart - 1 >= 0 && lines[descStart - 1].trim().startsWith('///')) descStart--;
  return lines
    .slice(descStart, declStart)
    .map((l) => l.replace(/^\t*\/\/\/\s?/, ''))
    .join('\n');
}

/**
 * Replace the leading `/// description` comment block above a declaration.
 * Returns true when a change was made. Mirrors modelPropertyEditor.setDescription.
 */
function writeDescription(
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
// Public API — scan / export / import
// --------------------------------------------------------------------------- //

/**
 * Read every table / column / measure description from the model. Measure DAX
 * expressions come from the tested loadMeasures round-trip so they always
 * reflect the real (possibly multi-line) expression.
 */
export async function scanDescriptions(
  workspaceId: string,
  datasetId: string
): Promise<DescriptionEntry[]> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const entries: DescriptionEntry[] = [];
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    for (const decl of locateDeclarations(lines)) {
      if (decl.objectType === 'Measure') continue; // measures handled below
      entries.push({
        objectType: decl.objectType,
        table: decl.table,
        name: decl.name,
        description: readDescription(lines, decl.declStart),
      });
    }
  }
  // Measures with their real DAX expressions.
  const { measures } = await loadMeasures(workspaceId, datasetId);
  for (const m of measures) {
    entries.push({
      objectType: 'Measure',
      table: m.table,
      name: m.values.name,
      description: m.values.description,
      expression: m.values.expression,
    });
  }
  entries.sort(
    (a, b) =>
      a.objectType.localeCompare(b.objectType) ||
      a.table.localeCompare(b.table) ||
      a.name.localeCompare(b.name)
  );
  return entries;
}

interface ExportRow {
  objectType: DescObjectType;
  table: string;
  name: string;
  description: string;
}

/** Serialize descriptions to a portable JSON document (pretty-printed). */
export function exportDescriptionsJson(entries: DescriptionEntry[]): string {
  const rows: ExportRow[] = entries.map((e) => ({
    objectType: e.objectType,
    table: e.table,
    name: e.name,
    description: e.description,
  }));
  return JSON.stringify({ version: 1, descriptions: rows }, null, 2);
}

export interface ParsedImport {
  rows: ExportRow[];
}

/** Parse an exported descriptions JSON document. Throws on malformed input. */
export function parseDescriptionsImport(text: string): ParsedImport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Import is not valid JSON.');
  }
  const raw =
    doc && typeof doc === 'object' && Array.isArray((doc as { descriptions?: unknown }).descriptions)
      ? (doc as { descriptions: unknown[] }).descriptions
      : Array.isArray(doc)
        ? (doc as unknown[])
        : null;
  if (!raw) throw new Error('Import has no "descriptions" array.');
  const rows: ExportRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const objectType = String(o.objectType ?? '');
    if (objectType !== 'Table' && objectType !== 'Column' && objectType !== 'Measure') continue;
    const table = String(o.table ?? '');
    const name = String(o.name ?? '');
    if (!table || !name) continue;
    rows.push({ objectType, table, name, description: String(o.description ?? '') });
  }
  if (!rows.length) throw new Error('Import contained no usable description rows.');
  return { rows };
}

// --------------------------------------------------------------------------- //
// Public API — apply
// --------------------------------------------------------------------------- //

/**
 * Write a set of descriptions back into the model in a single load/save
 * round-trip. Each edit only rewrites the `///` comment block above the matching
 * declaration; everything else is preserved. Edits are applied bottom-up per
 * part so splice offsets stay valid.
 */
export async function applyDescriptions(
  workspaceId: string,
  datasetId: string,
  edits: ExportRow[]
): Promise<ApplyResult> {
  if (!edits.length) return { changed: 0, applied: 0, detail: 'No descriptions to apply.' };
  const wanted = new Map<string, string>();
  for (const e of edits) wanted.set(entryKey(e.objectType, e.table, e.name), e.description);

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const updates: Record<string, string> = {};
  let applied = 0;

  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const decls = locateDeclarations(lines)
      .map((d) => ({ d, value: wanted.get(entryKey(d.objectType, d.table, d.name)) }))
      .filter((x) => x.value !== undefined)
      // Bottom-up so earlier splices do not shift later declaration indices.
      .sort((a, b) => b.d.declStart - a.d.declStart);

    let dirty = false;
    for (const { d, value } of decls) {
      if (writeDescription(lines, d.declStart, d.declIndent, value as string)) {
        dirty = true;
        applied++;
      }
    }
    if (dirty) updates[part.path] = lines.join('\n');
  }

  const changed = Object.keys(updates).length
    ? await saveDefinitionParts('model', workspaceId, datasetId, updates)
    : 0;
  return {
    changed,
    applied,
    detail:
      applied > 0
        ? `Updated ${applied} description(s) across ${changed} file(s).`
        : 'All descriptions already up to date.',
  };
}

// --------------------------------------------------------------------------- //
// Public API — fill empty measure descriptions from DAX (B12)
// --------------------------------------------------------------------------- //

/**
 * For every measure whose description is empty, set the description to its DAX
 * expression. Deterministic — no AI involved. Returns how many were filled.
 */
export async function fillEmptyMeasureDescriptionsFromDax(
  workspaceId: string,
  datasetId: string
): Promise<ApplyResult> {
  const { measures } = await loadMeasures(workspaceId, datasetId);
  const edits: ExportRow[] = [];
  for (const m of measures) {
    if (m.values.description.trim()) continue;
    const expr = m.values.expression.replace(/\r\n/g, '\n').trim();
    if (!expr) continue;
    edits.push({ objectType: 'Measure', table: m.table, name: m.values.name, description: expr });
  }
  if (!edits.length) {
    return { changed: 0, applied: 0, detail: 'Every measure already has a description.' };
  }
  return applyDescriptions(workspaceId, datasetId, edits);
}

// --------------------------------------------------------------------------- //
// Public API — AI-generate descriptions for empty objects
// --------------------------------------------------------------------------- //

/** Build a compact, describable snippet for one object. */
function snippetFor(e: DescriptionEntry): string {
  if (e.objectType === 'Measure') {
    const expr = (e.expression ?? '').replace(/\s+/g, ' ').trim().slice(0, 1800);
    return `DAX measure [${e.name}] in table '${e.table}': ${expr}`;
  }
  if (e.objectType === 'Column') {
    return `Power BI model column '${e.table}'[${e.name}]`;
  }
  return `Power BI model table '${e.name}'`;
}

export interface AiProposal {
  objectType: DescObjectType;
  table: string;
  name: string;
  description: string;
}

/**
 * Ask GitHub Copilot to write a one-line description for each supplied object.
 * Reuses the describe-only `github_comment_m` UDF (the same path the M step
 * commenter uses) — the model never returns code, only plain-English text.
 * Throws {@link GithubAuthRequiredError} when the user has not signed in yet.
 */
export async function generateDescriptionsAI(
  targets: DescriptionEntry[]
): Promise<AiProposal[]> {
  const token = getGithubToken();
  if (!token) throw new GithubAuthRequiredError();
  if (!targets.length) return [];
  const snippets = targets.map(snippetFor);
  const { comments } = await udf.githubCommentM(token, snippets);
  const out: AiProposal[] = [];
  targets.forEach((t, i) => {
    const text = (comments[i] ?? '').replace(/\r?\n/g, ' ').trim();
    if (!text) return;
    out.push({ objectType: t.objectType, table: t.table, name: t.name, description: text });
  });
  return out;
}
