// Deterministic Model BPA auto-fixer.
//
// A handful of BPA rules map to a safe, unambiguous TMDL edit. This module
// loads the semantic model's TMDL definition, patches the relevant column
// block, and writes it back via the same `updateDefinition` path the Source
// editor uses. Only column-property fixes are supported — they are the safest
// (no DAX rewriting, no renames) and fully reversible from the model.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';

/** Fix kinds that resolve to a single deterministic `prop: value` scalar patch
 *  on a column or measure block (the original PKG-1 framework). */
type ScalarFixKind =
  // Column scalar-property patches
  | 'SetSummarizeByNone'
  | 'HideColumn'
  | 'DisableAttributeHierarchy'
  | 'EnableAttributeHierarchy'
  | 'FloatToDecimal'
  | 'SetDateColumnFormat'
  | 'SetMonthColumnFormat'
  | 'SetFlagColumnFormat'
  | 'SetDataCategory'
  | 'MarkPrimaryKey'
  // Measure scalar-property patches
  | 'SetMeasureFormat'
  | 'SetPercentageFormat';

/** Fix kinds that need context beyond a static scalar patch — a measure
 *  expression rewrite (B17) or a sibling-column lookup (B15). They are handled
 *  by dedicated, conservative routines that no-op (leaving the finding) whenever
 *  the safe transform cannot be proven, rather than risk corrupting the model. */
type SpecialFixKind =
  // B17 — strip a top-level `0 +` / `+ 0` from a measure expression
  | 'StripAddZero'
  // B15 — set sortByColumn on a string month column to its month-number column
  | 'SetMonthSortByColumn';

export type ModelFixKind = ScalarFixKind | SpecialFixKind;

export interface ModelFixResult {
  changed: number;
  detail: string;
  /** Path of the TMDL part that was patched (for undo snapshots). */
  partPath?: string;
  /** Pre-fix text of the patched part, captured for revert. */
  before?: string;
  /** Post-fix text of the patched part. */
  after?: string;
}

/** Column findings are emitted by the engine as `TableName[ColumnName]`. */
function parseColumnPath(objectPath: string): { table: string; column: string } | null {
  const m = /^(.*)\[(.*)\]$/.exec(objectPath);
  if (!m || !m[1] || m[2] === undefined) return null;
  return { table: m[1], column: m[2] };
}

/** Measure findings are emitted by the engine as `[MeasureName]` (no table
 *  prefix — the measure name is unique within the model). */
function parseMeasurePath(objectPath: string): string | null {
  const m = /^\[(.*)\]$/.exec(objectPath);
  return m && m[1] !== undefined ? m[1] : null;
}

function indentOf(line: string): number {
  const m = /^(\t*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Extract the declared name from a TMDL declaration line (`column Foo`,
 *  `column 'My Col'`, `column X = <expr>` …) for the given keyword, or null. */
function declName(line: string, keyword: string): string | null {
  const trimmed = line.replace(/^\t*/, '');
  if (!new RegExp(`^${keyword}[\\s]`).test(trimmed)) return null;
  let rest = trimmed.slice(keyword.length).replace(/^\s+/, '');
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  const m = /^([^\s=]+)/.exec(rest);
  return m ? m[1] : null;
}

/** Locate the [start, end) line range of a child block (a `column` or `measure`
 *  declaration) within a TMDL part. */
function findBlock(
  lines: string[],
  keyword: string,
  name: string
): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], keyword) === name) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
      end = j;
      break;
    }
  }
  return { start, end };
}

/** Leading whitespace (tabs/spaces) of a line, used to mirror the exact
 *  indentation of an existing sibling property when inserting a new one. */
function leadingWs(line: string): string {
  const m = /^[\t ]*/.exec(line);
  return m ? m[0] : '';
}

/** True when a line is a scalar `name: value` property (e.g. `dataType: string`),
 *  as opposed to a `changedProperty = X` / `annotation X = Y` marker, a nested
 *  object header, or a blank line. TMDL requires scalar properties to precede
 *  `changedProperty`/`annotation` markers within a block, so a new property must
 *  be inserted after the last scalar property — never after a marker. */
function isScalarProp(line: string): boolean {
  const t = line.trimStart();
  if (t === '' || t.startsWith('annotation')) return false;
  return /^[A-Za-z_]\w*\s*:\s/.test(t);
}

/**
 * Declarative description of a single deterministic property fix. This registry
 * is the model-fixer framework (PKG-1, B21): adding a new property-patch fixer is
 * one entry here plus a rule-name → fixKind mapping in modelBpaApi (FIX_KINDS) —
 * the Fix buttons and batch auto-fix light up for free. Fixers patch either a
 * `column` or a `measure` block. Every patch is a `prop: value` scalar line;
 * boolean properties such as `isHidden`/`isKey` are written explicitly as
 * `isHidden: true` (the Power BI TMDL importer rejects bare flag keywords).
 */
interface FixSpec {
  /** Which TMDL object the property lives on. `column` patches a `Table[Column]`
   *  object path; `measure` patches a `[Measure]` object path (the engine emits
   *  measures without a table prefix, so every part is searched). */
  scope: 'column' | 'measure';
  prop: string;
  /** Static scalar value for the `prop: value` line, or a resolver that derives
   *  the value from the object name (used by data-category style fixers where the
   *  correct value depends on the column name). Returning null skips the object. */
  value: string | ((objectName: string) => string | null);
}

const FIX_SPECS: Record<ScalarFixKind, FixSpec> = {
  // Column scalar-property patches.
  SetSummarizeByNone: { scope: 'column', prop: 'summarizeBy', value: 'none' },
  HideColumn: { scope: 'column', prop: 'isHidden', value: 'true' },
  DisableAttributeHierarchy: { scope: 'column', prop: 'isAvailableInMdx', value: 'false' },
  EnableAttributeHierarchy: { scope: 'column', prop: 'isAvailableInMdx', value: 'true' },
  FloatToDecimal: { scope: 'column', prop: 'dataType', value: 'decimal' },
  SetDateColumnFormat: { scope: 'column', prop: 'formatString', value: 'mm/dd/yyyy' },
  SetMonthColumnFormat: { scope: 'column', prop: 'formatString', value: 'MMMM yyyy' },
  SetFlagColumnFormat: { scope: 'column', prop: 'formatString', value: '"Yes";"Yes";"No"' },
  SetDataCategory: { scope: 'column', prop: 'dataCategory', value: resolveDataCategory },
  MarkPrimaryKey: { scope: 'column', prop: 'isKey', value: 'true' },
  // Measure scalar-property patches.
  SetMeasureFormat: { scope: 'measure', prop: 'formatString', value: '#,0' },
  SetPercentageFormat: { scope: 'measure', prop: 'formatString', value: '#,0.0%;-#,0.0%;#,0.0%' },
};

/** Derive a Power BI data category from a column name. Mirrors the
 *  "Add data category for columns" BPA rule, which flags geo-named columns. */
function resolveDataCategory(columnName: string): string | null {
  const lo = columnName.toLowerCase();
  if (lo.startsWith('country')) return 'Country/Region';
  if (lo.startsWith('city')) return 'City';
  if (lo.startsWith('continent')) return 'Continent';
  if (lo.startsWith('latitude')) return 'Latitude';
  if (lo.startsWith('longitude')) return 'Longitude';
  return null;
}

/** Resolve a fix spec's value for a given object name (static or derived). */
function resolveValue(spec: FixSpec, objectName: string): string | null {
  return typeof spec.value === 'function' ? spec.value(objectName) : spec.value;
}

/** Insert or replace a `prop: value` scalar line inside a child block whose
 *  line range is `[start, end)`. Returns the mutated `lines` array reference, or
 *  null when nothing changed (already compliant). The insertion is anchored
 *  after the LAST scalar property and the indent is mirrored from a sibling
 *  property — anchoring on a `changedProperty`/`annotation` marker or hardcoding
 *  the indent depth produces TMDL "Invalid indentation" import errors. */
function patchBlock(
  lines: string[],
  start: number,
  end: number,
  prop: string,
  value: string
): string[] | null {
  let propPrefix: string | null = null;
  let anchor = start;
  for (let i = start + 1; i < end; i++) {
    if (isScalarProp(lines[i])) {
      propPrefix = leadingWs(lines[i]);
      anchor = i;
    }
  }
  if (propPrefix === null) {
    propPrefix = `${leadingWs(lines[start])}\t`;
  }
  const desired = `${propPrefix}${prop}: ${value}`;

  const re = new RegExp(`^${prop}\\s*:`);
  for (let i = start + 1; i < end; i++) {
    if (re.test(lines[i].trimStart())) {
      if (lines[i] === desired) return null; // already compliant
      lines[i] = desired;
      return lines;
    }
  }
  lines.splice(anchor + 1, 0, desired);
  return lines;
}

/** Apply a column-property fix to a single column. Returns the patched part
 *  text, or null when nothing changed (table/column missing or already
 *  compliant, or no value resolved for this column). */
function patchColumn(
  partText: string,
  table: string,
  column: string,
  spec: FixSpec
): string | null {
  const lines = partText.split('\n');
  // Confirm this part actually declares the target table at the top level.
  const declaresTable = lines.some((l) => indentOf(l) === 0 && declName(l, 'table') === table);
  if (!declaresTable) return null;

  const block = findBlock(lines, 'column', column);
  if (!block) return null;

  const value = resolveValue(spec, column);
  if (value === null) return null;

  const patched = patchBlock(lines, block.start, block.end, spec.prop, value);
  return patched ? patched.join('\n') : null;
}

/** Apply a measure-property fix to a single measure. The engine emits measures
 *  as `[Measure]` (no table prefix), so any part may hold the declaration —
 *  callers iterate parts until one matches. Returns the patched part text, or
 *  null when this part doesn't declare the measure / it already complies. */
function patchMeasure(partText: string, measure: string, spec: FixSpec): string | null {
  const lines = partText.split('\n');
  const block = findBlock(lines, 'measure', measure);
  if (!block) return null;

  const value = resolveValue(spec, measure);
  if (value === null) return null;

  const patched = patchBlock(lines, block.start, block.end, spec.prop, value);
  return patched ? patched.join('\n') : null;
}

// --------------------------------------------------------------------------- //
// B17 — "Avoid adding 0 to a measure" (StripAddZero)
// --------------------------------------------------------------------------- //

/** True for a TMDL line that introduces a measure property / marker rather than
 *  part of the DAX expression. Used to bound the expression region: TMDL writes
 *  the expression first, then the properties, so the expression ends at the
 *  first such line. */
function isMeasureProp(trimmed: string): boolean {
  if (trimmed.startsWith('///')) return true;
  return /^(formatString|formatStringDefinition|displayFolder|description|isHidden|lineageTag|sourceLineageTag|displayOrdinal|dataCategory|detailRowsDefinition|kpi|isSimpleMeasure|relatedColumnDetails|annotation|changedProperty|extendedProperty)\b/.test(
    trimmed
  );
}

/**
 * Strip a **top-level** leading `0 +` or trailing `+ 0` from a measure's DAX
 * expression. Adding zero at the top level is the additive identity, so removing
 * it is semantically lossless. Crucially, the `DIVIDE(…, 0)` / `IFERROR(…, 0)`
 * default-value forms that the BPA rule also flags are **not** rewritten — their
 * `0` is a meaningful fallback, not an added zero — and they never match the
 * leading/trailing pattern below, so they are left intact.
 *
 * Conservative by design: returns null (no change → finding stays) when the
 * `0 +` / `+ 0` is not contiguous within a single expression segment or when the
 * expression is a fenced (```` ``` ````) block, rather than risk a wrong edit.
 */
function stripAddZeroFromMeasure(partText: string, measure: string): string | null {
  const lines = partText.split('\n');
  const block = findBlock(lines, 'measure', measure);
  if (!block) return null;
  const { start, end } = block;

  const decl = lines[start];
  const eq = decl.indexOf('=');
  if (eq < 0) return null;
  const inlineRhs = decl.slice(eq + 1);
  // Fenced multi-line DAX block: out of scope (do not reformat).
  if (inlineRhs.trim().startsWith('```')) return null;

  // Expression segment line indices: the decl line (when it carries inline DAX)
  // plus indented continuation lines, up to the first property/marker line.
  const seg: number[] = [];
  if (inlineRhs.trim().length > 0) seg.push(start);
  for (let i = start + 1; i < end; i++) {
    const t = lines[i].trim();
    if (t === '') continue;
    if (isMeasureProp(t) || indentOf(lines[i]) < 2) break;
    seg.push(i);
  }
  if (seg.length === 0) return null;

  const segText = (idx: number): string => (idx === start ? inlineRhs : lines[idx]);
  const stripped = seg.map(segText).join('').replace(/\s/g, '');
  const lead = stripped.startsWith('0+');
  const trail = !lead && stripped.endsWith('+0');
  if (!lead && !trail) return null;

  if (lead) {
    const first = seg[0];
    const text = segText(first);
    const m = /^(\s*)0\s*\+\s*/.exec(text);
    if (!m) return null; // 0 and + split across lines — leave untouched (safe)
    const rest = text.slice(m[0].length).replace(/^\s+/, '');
    lines[first] =
      first === start ? `${decl.slice(0, eq + 1)} ${rest}` : `${leadingWs(text)}${rest}`;
  } else {
    const last = seg[seg.length - 1];
    const text = segText(last);
    const m = /\s*\+\s*0\s*$/.exec(text);
    if (!m) return null; // + and 0 split across lines — leave untouched (safe)
    const head = text.slice(0, text.length - m[0].length).replace(/\s+$/, '');
    lines[last] =
      last === start ? `${decl.slice(0, eq + 1)} ${head.replace(/^\s+/, '')}` : head;
  }
  return lines.join('\n');
}

async function applyStripAddZero(
  workspaceId: string,
  datasetId: string,
  objectPath: string
): Promise<ModelFixResult> {
  const measure = parseMeasurePath(objectPath);
  if (!measure) return { changed: 0, detail: `Cannot parse measure path "${objectPath}".` };

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const patched = stripAddZeroFromMeasure(part.text, measure);
    if (patched === null) continue;
    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: patched,
    });
    return {
      changed,
      detail:
        changed > 0
          ? `Removed the redundant "+ 0" from measure [${measure}] in ${part.path}.`
          : 'No change was written (model already up to date).',
      partPath: part.path,
      before: part.text,
      after: patched,
    };
  }
  return {
    changed: 0,
    detail: `Left [${measure}] unchanged — the "+ 0" is not a simple top-level term that can be removed safely. Edit the measure manually.`,
  };
}

// --------------------------------------------------------------------------- //
// B15 — "Month (as a string) must be sorted" (SetMonthSortByColumn)
// --------------------------------------------------------------------------- //

/** Quote a TMDL identifier when it is not a bare word. */
function quoteName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Enumerate every child block of `keyword` (e.g. `column`) declared at indent 1
 *  in a TMDL part, with each block's line range. */
function enumerateBlocks(
  lines: string[],
  keyword: string
): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) !== 1) continue;
    const name = declName(lines[i], keyword);
    if (name === null) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) {
        end = j;
        break;
      }
    }
    out.push({ name, start: i, end });
  }
  return out;
}

/** Read a scalar `prop: value` from inside a block's line range, or null. */
function propValueInBlock(
  lines: string[],
  start: number,
  end: number,
  prop: string
): string | null {
  const re = new RegExp(`^${prop}\\s*:\\s*(.+)$`);
  for (let i = start + 1; i < end; i++) {
    const m = re.exec(lines[i].trimStart());
    if (m) return m[1].trim();
  }
  return null;
}

/** Decide whether `candidate` looks like the month-NUMBER column matching the
 *  month-NAME column `monthCol` (e.g. "Month" → "MonthNumber" / "MonthNo" /
 *  "MonthIndex"). Tight on purpose — a wrong guess corrupts the sort order. */
function isMonthNumberName(candidate: string, monthCol: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[\s_]/g, '');
  const c = norm(candidate);
  const base = norm(monthCol);
  const suffixes = ['number', 'no', 'nr', 'num', 'index', 'idx', 'sort', 'sortorder', 'id', 'key', 'ordinal'];
  if (suffixes.some((s) => c === base + s)) return true;
  if (c.includes('month') && suffixes.some((s) => c.endsWith(s))) return true;
  return false;
}

async function applyMonthSortBy(
  workspaceId: string,
  datasetId: string,
  objectPath: string
): Promise<ModelFixResult> {
  const parsed = parseColumnPath(objectPath);
  if (!parsed) return { changed: 0, detail: `Cannot parse object path "${objectPath}".` };
  const { table, column } = parsed;

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');
    const declaresTable = lines.some((l) => indentOf(l) === 0 && declName(l, 'table') === table);
    if (!declaresTable) continue;

    const monthBlock = findBlock(lines, 'column', column);
    if (!monthBlock) continue;

    // Find integer sibling columns that look like the month-number column.
    const candidates = enumerateBlocks(lines, 'column')
      .filter((b) => b.name !== column)
      .filter((b) => /^int64\b/i.test(propValueInBlock(lines, b.start, b.end, 'dataType') ?? ''))
      .filter((b) => isMonthNumberName(b.name, column))
      .map((b) => b.name);

    if (candidates.length === 0) {
      return {
        changed: 0,
        detail: `No integer "month number" column found in "${table}" — set Sort By Column manually for [${column}].`,
      };
    }
    if (candidates.length > 1) {
      return {
        changed: 0,
        detail: `Ambiguous month-number columns in "${table}" (${candidates.join(', ')}) — left [${column}] unchanged.`,
      };
    }

    const patched = patchBlock(
      lines,
      monthBlock.start,
      monthBlock.end,
      'sortByColumn',
      quoteName(candidates[0])
    );
    if (patched === null) {
      return { changed: 0, detail: `${table}[${column}] is already sorted by ${candidates[0]}.` };
    }
    const text = patched.join('\n');
    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: text,
    });
    return {
      changed,
      detail:
        changed > 0
          ? `Set Sort By Column on ${table}[${column}] → ${candidates[0]} in ${part.path}.`
          : 'No change was written (model already up to date).',
      partPath: part.path,
      before: part.text,
      after: text,
    };
  }
  return {
    changed: 0,
    detail: `Could not locate ${table}[${column}] in the model TMDL (it may already comply).`,
  };
}

/**
 * Apply a deterministic BPA fix to the semantic model and write it back.
 * Resolves the TMDL part that declares the target object, patches the column or
 * measure block, and persists via `updateDefinition`. Throws on transport errors.
 */
export async function applyModelBpaFix(
  workspaceId: string,
  datasetId: string,
  fixKind: ModelFixKind,
  objectPath: string
): Promise<ModelFixResult> {
  // Context-dependent fixers (expression rewrite / sibling lookup) are handled
  // by dedicated, conservative routines that no-op when the safe edit can't be
  // proven, rather than via the static scalar-patch path below.
  if (fixKind === 'StripAddZero') return applyStripAddZero(workspaceId, datasetId, objectPath);
  if (fixKind === 'SetMonthSortByColumn') return applyMonthSortBy(workspaceId, datasetId, objectPath);

  const spec = FIX_SPECS[fixKind];
  if (!spec) return { changed: 0, detail: `Unknown fix kind "${fixKind}".` };

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);

  if (spec.scope === 'measure') {
    const measure = parseMeasurePath(objectPath);
    if (!measure) return { changed: 0, detail: `Cannot parse measure path "${objectPath}".` };
    for (const part of parts) {
      if (part.binary) continue;
      const patched = patchMeasure(part.text, measure, spec);
      if (patched === null) continue;
      const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
        [part.path]: patched,
      });
      return {
        changed,
        detail:
          changed > 0
            ? `Patched measure [${measure}] in ${part.path}.`
            : 'No change was written (model already up to date).',
        partPath: part.path,
        before: part.text,
        after: patched,
      };
    }
    return {
      changed: 0,
      detail: `Could not locate measure [${measure}] in the model TMDL (it may already comply).`,
    };
  }

  const parsed = parseColumnPath(objectPath);
  if (!parsed) return { changed: 0, detail: `Cannot parse object path "${objectPath}".` };

  for (const part of parts) {
    if (part.binary) continue;
    const patched = patchColumn(part.text, parsed.table, parsed.column, spec);
    if (patched === null) continue;
    const changed = await saveDefinitionParts('model', workspaceId, datasetId, {
      [part.path]: patched,
    });
    return {
      changed,
      detail:
        changed > 0
          ? `Patched ${parsed.table}[${parsed.column}] in ${part.path}.`
          : 'No change was written (model already up to date).',
      partPath: part.path,
      before: part.text,
      after: patched,
    };
  }
  return {
    changed: 0,
    detail: `Could not locate ${parsed.table}[${parsed.column}] in the model TMDL (it may already comply).`,
  };
}

/**
 * Revert a previously applied model fix by writing a stored pre-fix snapshot of
 * a single TMDL part back through the same surgical `updateDefinition` path used
 * by {@link applyModelBpaFix}. Returns the number of parts changed (0 if the
 * model already matches the snapshot).
 */
export async function revertModelPart(
  workspaceId: string,
  datasetId: string,
  partPath: string,
  text: string
): Promise<number> {
  return saveDefinitionParts('model', workspaceId, datasetId, { [partPath]: text });
}
