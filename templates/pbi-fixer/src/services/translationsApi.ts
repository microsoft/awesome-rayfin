// Translations service for the Translations tab.
//
// Propose: sends the in-scope captions to GitHub Copilot (via the UDF) and
// returns one proposal per object, enriched with the caption that currently
// exists in the model's culture file (so the review grid can show new vs.
// overwrite).
//
// Apply: round-trips the model's TMDL definition, finds or creates the
// `definition/cultures/<culture>.tmdl` part, merges the accepted captions into
// its `translations` block and writes it back via updateDefinition.
//
// The TMDL culture-file parse / merge / serialize logic is ported from the
// Developer Hub's well-tested `tmdl_translations.py` so the emitted structure
// (cultureInfo → translations → model → table → column/measure) is exactly the
// shape the Fabric serializer accepts on round-trip.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { getGithubToken } from './githubAuth';
import { udf } from './udfClient';

export type TranslationObjectType =
  | 'Table'
  | 'Column'
  | 'Measure'
  | 'Hierarchy'
  | 'Description';

export interface TranslationSourceItem {
  objectType: TranslationObjectType;
  objectPath: string;
  sourceCaption: string;
  existingCaption?: string | null;
}

export interface TranslationProposalItem {
  objectType: TranslationObjectType;
  objectPath: string;
  sourceCaption: string;
  existingCaption?: string | null;
  proposedCaption: string;
  proposedDescription?: string | null;
}

// --------------------------------------------------------------------------- //
// TMDL culture-file model (ported from tmdl_translations.py)
// --------------------------------------------------------------------------- //
const KNOWN_PROPS = ['caption', 'description', 'displayFolder'] as const;
const CHILD_SEP = '\u0000';

interface ChildEntry {
  kind: string; // 'Column' | 'Measure' | 'Hierarchy'
  name: string;
  props: Record<string, string>;
}

interface TableEntries {
  /** Table-level caption / description. */
  tableProps: Record<string, string>;
  /** key = `${kind}\u0000${name}`. */
  children: Map<string, ChildEntry>;
}

interface CultureModel {
  culture: string;
  modelName: string | null;
  modelProps: Record<string, string>;
  byTable: Map<string, TableEntries>;
  linguisticBlock: string | null;
}

function emptyCulture(culture: string): CultureModel {
  return { culture, modelName: null, modelProps: {}, byTable: new Map(), linguisticBlock: null };
}

function tableEntries(): TableEntries {
  return { tableProps: {}, children: new Map() };
}

// --- TMDL primitives ------------------------------------------------------- //
function unquote(name: string): string {
  const s = name.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function quote(name: string): string {
  if (!name) return "''";
  if (/[ .=:']/.test(name)) return "'" + name.replace(/'/g, "''") + "'";
  return name;
}

function unescapeValue(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function escapeValue(v: string): string {
  if (v === '' || v !== v.trim() || v.includes('"') || /[:#-]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

// --- Parse ----------------------------------------------------------------- //
function parseCultureHeader(lines: string[]): string {
  for (const line of lines) {
    const m = /^\s*(?:cultureInfo|culture)\s+(\S+)\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return '';
}

function linguisticBlockEnded(line: string, indentPrefix: string): boolean {
  if (line.trim() === '') return false;
  const lead = line.length - line.replace(/^\s+/, '').length;
  return (
    lead <= indentPrefix.length &&
    !line.startsWith(indentPrefix + ' ') &&
    !line.startsWith(indentPrefix + '\t')
  );
}

function captureLinguisticBlock(lines: string[], startIndex: number): [string, number] {
  const m = /^(\s*)linguisticMetadata\b/.exec(lines[startIndex]);
  if (!m) return ['', startIndex + 1];
  const indentPrefix = m[1];
  const block: string[] = [lines[startIndex]];
  let i = startIndex + 1;
  while (i < lines.length) {
    if (linguisticBlockEnded(lines[i], indentPrefix)) break;
    block.push(lines[i]);
    i++;
  }
  return [block.join('\n').replace(/\s+$/, ''), i];
}

function parseCulture(text: string): CultureModel {
  const cm = emptyCulture('');
  if (!text) return cm;

  const lines = text.split('\n');
  cm.culture = parseCultureHeader(lines);

  let inTranslations = false;
  let inModel = false;
  let curTable: string | null = null;
  let curChild: { kind: string; name: string } | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const bare = line.trim();

    if (/^\s*linguisticMetadata\b/.test(line)) {
      const [block, next] = captureLinguisticBlock(lines, i);
      cm.linguisticBlock = block;
      inTranslations = false;
      inModel = false;
      curTable = null;
      curChild = null;
      i = next;
      continue;
    }

    if (bare === 'translations') {
      inTranslations = true;
      inModel = false;
      curTable = null;
      curChild = null;
      i++;
      continue;
    }

    if (!inTranslations || !bare) {
      i++;
      continue;
    }

    const tableM = /^table\s+(.+)$/.exec(bare);
    const modelM = /^model\s+(.+)$/.exec(bare);
    const childM = /^(column|measure|hierarchy)\s+(.+)$/.exec(bare);
    const propM = /^(caption|description|displayFolder)\s*:\s*(.*)$/.exec(bare);

    if (tableM) {
      curTable = unquote(tableM[1]);
      if (!cm.byTable.has(curTable)) cm.byTable.set(curTable, tableEntries());
      curChild = null;
      inModel = false;
    } else if (modelM) {
      cm.modelName = unquote(modelM[1]);
      inModel = true;
      curTable = null;
      curChild = null;
    } else if (childM && curTable !== null) {
      const kind = childM[1].charAt(0).toUpperCase() + childM[1].slice(1);
      const name = unquote(childM[2]);
      curChild = { kind, name };
      const te = cm.byTable.get(curTable)!;
      const key = `${kind}${CHILD_SEP}${name}`;
      if (!te.children.has(key)) te.children.set(key, { kind, name, props: {} });
    } else if (propM) {
      const prop = propM[1];
      const val = unescapeValue(propM[2]);
      if (inModel) {
        cm.modelProps[prop] = val;
      } else if (curTable !== null) {
        const te = cm.byTable.get(curTable)!;
        if (curChild) {
          const key = `${curChild.kind}${CHILD_SEP}${curChild.name}`;
          const ce = te.children.get(key) ?? { kind: curChild.kind, name: curChild.name, props: {} };
          ce.props[prop] = val;
          te.children.set(key, ce);
        } else {
          te.tableProps[prop] = val;
        }
      }
    }
    i++;
  }

  return cm;
}

// --- Serialize ------------------------------------------------------------- //
function appendProps(out: string[], props: Record<string, string>, indent: string): void {
  for (const prop of KNOWN_PROPS) {
    if (prop in props) out.push(`${indent}${prop}: ${escapeValue(props[prop])}`);
  }
}

function serializeCulture(cm: CultureModel, indent = '\t'): string {
  const out: string[] = [`cultureInfo ${cm.culture}`, ''];

  if (cm.modelName || cm.byTable.size > 0) {
    out.push(`${indent}translations`);
    out.push(`${indent.repeat(2)}model ${quote(cm.modelName || 'Model')}`);
    appendProps(out, cm.modelProps, indent.repeat(3));

    for (const tableName of [...cm.byTable.keys()].sort()) {
      const te = cm.byTable.get(tableName)!;
      out.push(`${indent.repeat(3)}table ${quote(tableName)}`);
      appendProps(out, te.tableProps, indent.repeat(4));

      const children = [...te.children.values()].sort((a, b) =>
        a.kind === b.kind ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.kind.localeCompare(b.kind)
      );
      for (const ce of children) {
        if (Object.keys(ce.props).length === 0) continue;
        out.push(`${indent.repeat(4)}${ce.kind.toLowerCase()} ${quote(ce.name)}`);
        appendProps(out, ce.props, indent.repeat(5));
      }
    }
  }

  if (cm.linguisticBlock) {
    out.push('');
    out.push(cm.linguisticBlock.replace(/\s+$/, ''));
  }

  return out.join('\n') + '\n';
}

// --- Merge ----------------------------------------------------------------- //
function splitPath(objectPath: string): [string, string | null] {
  const m = /^(.+?)\[(.+)\]$/.exec(objectPath.trim());
  if (m) return [m[1].trim(), m[2].trim()];
  return [objectPath.trim(), null];
}

function normalizedChildKind(parentKind: string | undefined): string {
  const k = (parentKind || 'Column');
  const cap = k.charAt(0).toUpperCase() + k.slice(1);
  return cap === 'Column' || cap === 'Measure' || cap === 'Hierarchy' ? cap : 'Column';
}

function mergeItems(cm: CultureModel, items: TranslationProposalItem[]): number {
  let touched = 0;
  for (const it of items) {
    const [table, childName] = splitPath(it.objectPath);
    if (!table) continue;
    if (!cm.byTable.has(table)) cm.byTable.set(table, tableEntries());
    const te = cm.byTable.get(table)!;

    const isDescription = it.objectType === 'Description';
    let props: Record<string, string>;
    if (it.objectType === 'Table' || (isDescription && childName === null)) {
      props = te.tableProps;
    } else if (it.objectType === 'Column' || it.objectType === 'Measure' || it.objectType === 'Hierarchy') {
      const key = `${it.objectType}${CHILD_SEP}${childName ?? ''}`;
      const ce = te.children.get(key) ?? { kind: it.objectType, name: childName ?? '', props: {} };
      te.children.set(key, ce);
      props = ce.props;
    } else if (isDescription) {
      const kind = normalizedChildKind(undefined);
      const key = `${kind}${CHILD_SEP}${childName ?? ''}`;
      const ce = te.children.get(key) ?? { kind, name: childName ?? '', props: {} };
      te.children.set(key, ce);
      props = ce.props;
    } else {
      continue;
    }

    props[isDescription ? 'description' : 'caption'] = isDescription
      ? (it.proposedDescription ?? it.proposedCaption)
      : it.proposedCaption;
    touched += 1;
    if (!isDescription && it.proposedDescription) {
      props['description'] = it.proposedDescription;
      touched += 1;
    }
  }
  return touched;
}

// --------------------------------------------------------------------------- //
// Public API
// --------------------------------------------------------------------------- //
function discoverModelName(parts: { path: string; text: string }[]): string | null {
  const mp = parts.find((p) => p.path === 'definition/model.tmdl');
  if (!mp) return null;
  for (const line of mp.text.split('\n')) {
    const m = /^model\s+(.+?)\s*$/.exec(line);
    if (m) return unquote(m[1]);
  }
  return null;
}

function lookupExisting(cm: CultureModel, item: TranslationSourceItem): string | null {
  const [table, child] = splitPath(item.objectPath);
  const te = cm.byTable.get(table);
  if (!te) return null;
  if (item.objectType === 'Table') return te.tableProps['caption'] ?? null;
  const ce = te.children.get(`${item.objectType}${CHILD_SEP}${child ?? ''}`);
  return ce?.props['caption'] ?? null;
}

/**
 * Generate AI caption proposals for one target culture. Captions are sent to
 * GitHub Copilot via the UDF; each proposal is enriched with the caption that
 * already exists in the model's culture file (best effort).
 */
export async function proposeTranslations(
  workspaceId: string,
  datasetId: string,
  culture: string,
  sourceItems: TranslationSourceItem[],
  glossary?: Record<string, string>
): Promise<TranslationProposalItem[]> {
  const token = getGithubToken();
  if (!token) throw new Error('Sign in to GitHub first to generate translations.');
  if (sourceItems.length === 0) return [];

  // Best-effort: read existing captions so the grid can flag new vs. overwrite.
  // The getDefinition export is a slow long-running operation, but it is fully
  // independent of the Copilot translate round-trip below — so kick it off
  // first and only await it *after* the translation call. That overlaps the two
  // slowest steps (TMDL export + LLM) instead of paying for them back to back.
  const existingPromise: Promise<CultureModel | null> = loadDefinitionParts(
    'model',
    workspaceId,
    datasetId
  )
    .then((parts) => {
      const part = parts.find((p) => p.path === `definition/cultures/${culture}.tmdl`);
      return part ? parseCulture(part.text) : null;
    })
    .catch(() => null); // existing captions are a nicety — ignore load failures

  const captions = sourceItems.map((s) => s.sourceCaption);
  const { translations } = await udf.githubTranslate(token, culture, captions, glossary);
  const existing = await existingPromise;

  return sourceItems.map((s, i) => ({
    objectType: s.objectType,
    objectPath: s.objectPath,
    sourceCaption: s.sourceCaption,
    existingCaption: existing ? lookupExisting(existing, s) : (s.existingCaption ?? null),
    proposedCaption: translations[i] ?? s.sourceCaption,
  }));
}

export interface ApplyTranslationsResult {
  applied: number;
  createdCultureFile: boolean;
}

/**
 * Write the accepted captions into the model's `definition/cultures/
 * <culture>.tmdl` part (created if missing) via getDefinition/updateDefinition.
 */
export async function applyTranslations(
  workspaceId: string,
  datasetId: string,
  culture: string,
  items: TranslationProposalItem[]
): Promise<ApplyTranslationsResult> {
  const path = `definition/cultures/${culture}.tmdl`;
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const existingPart = parts.find((p) => p.path === path);

  const cm = existingPart ? parseCulture(existingPart.text) : emptyCulture(culture);
  if (!cm.culture) cm.culture = culture;
  if (!cm.modelName) cm.modelName = discoverModelName(parts);

  const applied = mergeItems(cm, items);
  const text = serializeCulture(cm);
  await saveDefinitionParts('model', workspaceId, datasetId, { [path]: text });

  return { applied, createdCultureFile: !existingPart };
}
