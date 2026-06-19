// Perspectives editor service (PKG-15 · D1).
//
// A perspective is a named subset of the model's tables/columns/measures/
// hierarchies. In PBIP/TMDL each perspective is a separate part under
// `definition/perspectives/<name>.tmdl` and is registered in `model.tmdl`
// with a `ref perspective '<name>'` line:
//
//   perspective 'Sales view'
//
//       perspectiveTable Sales
//
//           perspectiveColumn Quantity
//
//           perspectiveMeasure 'Sales Amount'
//
// This module loads the existing perspectives, exposes the full object
// inventory (so a tri-state tree can show what is in/out of each perspective),
// and writes a perspective back, creating the file + ref on first save.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { loadModelData } from './fabricRest';
import type { ModelData } from '../explorer/types';

export type PerspectiveObjectKind = 'Column' | 'Measure' | 'Hierarchy';

export interface PerspectiveObject {
  table: string;
  kind: PerspectiveObjectKind;
  name: string;
  /** `${table}\u0000${kind}\u0000${name}` — stable selection key. */
  key: string;
}

export interface PerspectiveTableNode {
  table: string;
  objects: PerspectiveObject[];
}

export interface ModelInventory {
  /** Tables (and their objects) in declaration order, hidden ones excluded. */
  tables: PerspectiveTableNode[];
  /** All object keys, for "select all" helpers. */
  allKeys: string[];
}

export interface PerspectiveDef {
  name: string;
  /** Selected object keys (`${table}\u0000${kind}\u0000${name}`). */
  selected: Set<string>;
  /** Source part path (empty for a not-yet-saved perspective). */
  path: string;
}

const SEP = '\u0000';

export function objKey(table: string, kind: PerspectiveObjectKind, name: string): string {
  return `${table}${SEP}${kind}${SEP}${name}`;
}

// --------------------------------------------------------------------------- //
// TMDL identifier helpers
// --------------------------------------------------------------------------- //
function quoteName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

function unquote(token: string): string {
  const s = token.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Read the rest of a TMDL declaration line after a leading keyword. */
function declArg(line: string, keyword: string): string | null {
  const trimmed = line.replace(/^\t+/, '');
  if (!trimmed.startsWith(keyword + ' ')) return null;
  return unquote(trimmed.slice(keyword.length + 1));
}

// --------------------------------------------------------------------------- //
// Inventory
// --------------------------------------------------------------------------- //
/** Build the full object inventory from the model metadata. */
export function buildInventory(model: ModelData): ModelInventory {
  const tables: PerspectiveTableNode[] = [];
  const allKeys: string[] = [];
  for (const [tableName, t] of Object.entries(model.tables)) {
    const objects: PerspectiveObject[] = [];
    for (const [colName, col] of Object.entries(t.columns)) {
      // Skip the internal RowNumber-<guid> system column — it cannot be
      // referenced from a perspective (Workload_FailedToParseFile otherwise).
      if (/^RowNumber-/i.test(colName) || /^rownumber$/i.test(col.type ?? '')) continue;
      const key = objKey(tableName, 'Column', colName);
      objects.push({ table: tableName, kind: 'Column', name: colName, key });
      allKeys.push(key);
    }
    for (const mName of Object.keys(t.measures)) {
      const key = objKey(tableName, 'Measure', mName);
      objects.push({ table: tableName, kind: 'Measure', name: mName, key });
      allKeys.push(key);
    }
    for (const hName of Object.keys(t.hierarchies)) {
      const key = objKey(tableName, 'Hierarchy', hName);
      objects.push({ table: tableName, kind: 'Hierarchy', name: hName, key });
      allKeys.push(key);
    }
    tables.push({ table: tableName, objects });
  }
  return { tables, allKeys };
}

// --------------------------------------------------------------------------- //
// Parse existing perspective TMDL files
// --------------------------------------------------------------------------- //
function parsePerspectiveText(text: string, path: string): PerspectiveDef | null {
  const lines = text.split('\n');
  let name = '';
  const selected = new Set<string>();
  let currentTable: string | null = null;
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    const indent = raw.length - raw.replace(/^\t+/, '').length;
    if (indent === 0) {
      const n = declArg(raw, 'perspective');
      if (n != null) name = n;
      continue;
    }
    if (indent === 1) {
      const t = declArg(raw, 'perspectiveTable');
      if (t != null) currentTable = t;
      continue;
    }
    if (indent >= 2 && currentTable) {
      const col = declArg(raw, 'perspectiveColumn');
      if (col != null) {
        selected.add(objKey(currentTable, 'Column', col));
        continue;
      }
      const meas = declArg(raw, 'perspectiveMeasure');
      if (meas != null) {
        selected.add(objKey(currentTable, 'Measure', meas));
        continue;
      }
      const hier = declArg(raw, 'perspectiveHierarchy');
      if (hier != null) {
        selected.add(objKey(currentTable, 'Hierarchy', hier));
        continue;
      }
    }
  }
  if (!name) return null;
  return { name, selected, path };
}

export interface LoadPerspectivesResult {
  perspectives: PerspectiveDef[];
  /** Directory where perspective parts live (for new files). */
  perspectivesDir: string;
  modelPartPath: string;
}

export async function loadPerspectives(
  workspaceId: string,
  datasetId: string
): Promise<LoadPerspectivesResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  const perspectiveParts = parts.filter(
    (p) => !p.binary && /\/perspectives\/[^/]+\.tmdl$/i.test(p.path)
  );
  // Only perspectives registered via `ref perspective` in model.tmdl are part of
  // the model. A deleted perspective leaves an orphaned bare-declaration file
  // behind (updateDefinition cannot delete parts), so we must ignore files whose
  // name is no longer referenced — otherwise a deleted perspective reappears
  // with 0 objects after reload.
  let registered: Set<string> | null = null;
  if (modelPart) {
    registered = new Set<string>();
    for (const line of modelPart.text.split('\n')) {
      const n = declArg(line.replace(/^ref\s+/, ''), 'perspective');
      if (n != null && /^ref\s+perspective\b/.test(line.trim())) {
        registered.add(n.toLowerCase());
      }
    }
  }
  const perspectives: PerspectiveDef[] = [];
  for (const p of perspectiveParts) {
    const def = parsePerspectiveText(p.text, p.path);
    if (!def) continue;
    if (registered && !registered.has(def.name.toLowerCase())) continue;
    perspectives.push(def);
  }
  perspectives.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // Derive the perspectives dir from an existing perspective part, else from
  // the model.tmdl location (sibling `perspectives` folder).
  let perspectivesDir = 'definition/perspectives';
  if (perspectiveParts.length > 0) {
    perspectivesDir = perspectiveParts[0].path.replace(/\/[^/]+\.tmdl$/i, '');
  } else if (modelPart) {
    perspectivesDir = modelPart.path.replace(/\/model\.tmdl$/i, '/perspectives');
  }
  return {
    perspectives,
    perspectivesDir,
    modelPartPath: modelPart?.path ?? 'definition/model.tmdl',
  };
}

// --------------------------------------------------------------------------- //
// Serialize + save
// --------------------------------------------------------------------------- //
/** Build a perspective TMDL file from a selection set, respecting model order. */
export function serializePerspective(
  name: string,
  selected: Set<string>,
  inventory: ModelInventory
): string {
  const out: string[] = [`perspective ${quoteName(name)}`];
  for (const node of inventory.tables) {
    const chosen = node.objects.filter((o) => selected.has(o.key));
    if (chosen.length === 0) continue;
    out.push('');
    out.push(`\tperspectiveTable ${quoteName(node.table)}`);
    for (const o of chosen) {
      const kw =
        o.kind === 'Column'
          ? 'perspectiveColumn'
          : o.kind === 'Measure'
            ? 'perspectiveMeasure'
            : 'perspectiveHierarchy';
      out.push('');
      out.push(`\t\t${kw} ${quoteName(o.name)}`);
    }
  }
  return out.join('\n') + '\n';
}

export interface SavePerspectiveResult {
  changed: number;
  created: boolean;
  objectCount: number;
  detail: string;
  path: string;
}

/**
 * Write a perspective. Creates the part + `ref perspective` registration on
 * first save; otherwise overwrites the existing file. An empty selection for an
 * existing perspective writes an empty (table-less) perspective rather than
 * deleting it (use {@link deletePerspective} to remove).
 */
export async function savePerspective(
  workspaceId: string,
  datasetId: string,
  name: string,
  selected: Set<string>,
  inventory: ModelInventory
): Promise<SavePerspectiveResult> {
  const trimmed = name.trim();
  if (!trimmed) return { changed: 0, created: false, objectCount: 0, detail: 'Perspective name is required.', path: '' };

  const { perspectives, perspectivesDir, modelPartPath } = await loadPerspectives(workspaceId, datasetId);
  const existing = perspectives.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const objectCount = inventory.allKeys.filter((k) => selected.has(k)).length;

  const edits: Record<string, string> = {};
  const filePath = existing?.path ?? `${perspectivesDir}/${trimmed}.tmdl`;
  edits[filePath] = serializePerspective(trimmed, selected, inventory);

  let created = false;
  if (!existing) {
    created = true;
    const parts = await loadDefinitionParts('model', workspaceId, datasetId);
    const modelPart = parts.find((p) => p.path === modelPartPath && !p.binary);
    if (modelPart) {
      const lines = modelPart.text.split('\n');
      let lastRef = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^ref perspective /.test(lines[i])) lastRef = i;
      }
      if (lastRef < 0) {
        for (let i = 0; i < lines.length; i++) {
          if (/^ref table /.test(lines[i])) lastRef = i;
        }
      }
      const refLine = `ref perspective ${quoteName(trimmed)}`;
      if (lastRef >= 0) lines.splice(lastRef + 1, 0, refLine);
      else lines.push('', refLine);
      edits[modelPart.path] = lines.join('\n');
    }
  }

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    changed,
    created,
    objectCount,
    path: filePath,
    detail: created
      ? `Created perspective "${trimmed}" with ${objectCount} object(s).`
      : `Updated perspective "${trimmed}" (${objectCount} object(s)).`,
  };
}

export interface DeletePerspectiveResult {
  changed: number;
  detail: string;
}

/**
 * Remove a perspective: empty its TMDL file and strip its `ref perspective`
 * line from model.tmdl. (The empty part is left in place — Fabric tolerates an
 * unreferenced perspective file, and updateDefinition cannot delete parts.)
 */
export async function deletePerspective(
  workspaceId: string,
  datasetId: string,
  name: string
): Promise<DeletePerspectiveResult> {
  const trimmed = name.trim();
  const { perspectives, modelPartPath } = await loadPerspectives(workspaceId, datasetId);
  const existing = perspectives.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  if (!existing) return { changed: 0, detail: `Perspective "${trimmed}" not found.` };

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const edits: Record<string, string> = {};
  // Empty the perspective file down to a bare declaration.
  edits[existing.path] = `perspective ${quoteName(existing.name)}\n`;
  // Strip the `ref perspective <name>` line from model.tmdl (robust to quoting
  // and whitespace — matches by parsed identifier, not a literal regex).
  const modelPart = parts.find((p) => p.path === modelPartPath && !p.binary);
  if (modelPart) {
    const lines = modelPart.text.split('\n').filter((l) => {
      const t = l.trim();
      if (!/^ref\s+perspective\b/.test(t)) return true;
      const n = declArg(t.replace(/^ref\s+/, ''), 'perspective');
      return n == null || n.toLowerCase() !== existing.name.toLowerCase();
    });
    edits[modelPart.path] = lines.join('\n');
  }
  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return { changed, detail: `Removed perspective "${trimmed}".` };
}

/** Convenience: load both the inventory and the existing perspectives. */
export async function loadPerspectiveEditorData(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<{ inventory: ModelInventory; perspectives: PerspectiveDef[] }> {
  const [model, persp] = await Promise.all([
    loadModelData(workspaceId, datasetId, datasetName),
    loadPerspectives(workspaceId, datasetId),
  ]);
  return { inventory: buildInventory(model), perspectives: persp.perspectives };
}
