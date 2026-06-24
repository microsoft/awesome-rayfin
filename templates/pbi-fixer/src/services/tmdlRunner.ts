// tmdlRunner — execute pasted TMDL against Fabric: create a brand-new semantic
// model from one or more `table` blocks, or add those tables to an existing
// model. Powers both the standalone "TMDL Runner" tab and the
// "Create / add to model" buttons on the Metric View Migration tab.
//
// Two write paths, both via the server-side `fabric_proxy` UDF:
//   • New model  — POST /workspaces/{ws}/items  (type SemanticModel) with a
//                  full TMDL definition assembled here (database / model /
//                  tables / optional expressions + .platform + definition.pbism).
//   • Add tables — getDefinition of the target model, append `ref table` lines
//                  to model.tmdl and write each table as its own part, then
//                  updateDefinition (reusing saveDefinitionParts).

import { udf } from './udfClient';
import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';

const SIMPLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** UTF-8 → base64 (definition parts are InlineBase64). */
function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

/** Quote a TMDL object name when it is not a simple identifier. */
function quoteName(name: string): string {
  return SIMPLE_IDENT.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Strip TMDL quoting from a name token (`'Foo Bar'` → `Foo Bar`). */
function unquoteName(token: string): string {
  const t = token.trim();
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Replace characters a Fabric part path cannot contain. */
function safeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Table';
}

export interface ParsedTable {
  /** Logical table name (unquoted). */
  name: string;
  /** Name token ready for a `ref table` line (quoted when needed). */
  ref: string;
  /** File base used for `definition/tables/<base>.tmdl`. */
  fileBase: string;
  /** The full `table …` block, normalised to end with a single newline. */
  body: string;
}

/**
 * Split a TMDL blob into individual `table` blocks. A table declaration is the
 * only statement that starts at column 0 with `table <name>`; every property
 * inside a table is tab-indented, so a column-0 `^table ` reliably marks a new
 * block. Returns one entry per table (empty array when none are found).
 */
export function splitTmdlTables(tmdl: string): ParsedTable[] {
  const lines = tmdl.replace(/\r\n/g, '\n').split('\n');
  const starts: { token: string; line: number }[] = [];
  lines.forEach((ln, i) => {
    const m = ln.match(/^table[ \t]+(.+?)[ \t]*$/);
    if (m) starts.push({ token: m[1], line: i });
  });
  const out: ParsedTable[] = [];
  for (let b = 0; b < starts.length; b++) {
    const from = starts[b].line;
    const to = b + 1 < starts.length ? starts[b + 1].line : lines.length;
    const body = lines.slice(from, to).join('\n').replace(/\s+$/, '') + '\n';
    const name = unquoteName(starts[b].token);
    out.push({ name, ref: quoteName(starts[b].token.trim()), fileBase: safeFileBase(name), body });
  }
  return out;
}

const DEFINITION_PBISM = JSON.stringify(
  {
    $schema:
      'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json',
    version: '4.2',
    settings: {},
  },
  null,
  2
);

function platformJson(displayName: string): string {
  return JSON.stringify(
    {
      $schema:
        'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
      metadata: { type: 'SemanticModel', displayName },
      config: { version: '2.0', logicalId: '00000000-0000-0000-0000-000000000000' },
    },
    null,
    2
  );
}

function buildModelTmdl(tables: ParsedTable[], culture: string): string {
  const lines: string[] = [];
  lines.push('model Model');
  lines.push(`\tculture: ${culture}`);
  lines.push('\tdefaultPowerBIDataSourceVersion: powerBI_V3');
  lines.push('\tdiscourageImplicitMeasures');
  lines.push('');
  for (const t of tables) lines.push(`ref table ${t.ref}`);
  lines.push('');
  return lines.join('\n');
}

export interface DefinitionPartOut {
  path: string;
  payload: string;
  payloadType: 'InlineBase64';
}

export interface NewModelOptions {
  /** Full `expression …` TMDL for shared M sources (e.g. a Direct Lake source). */
  expressionsTmdl?: string;
  /** Model culture; defaults to en-US. */
  culture?: string;
}

/** Assemble the full Fabric SemanticModel definition parts for a new model. */
export function buildNewModelParts(
  displayName: string,
  tablesTmdl: string,
  opts: NewModelOptions = {}
): DefinitionPartOut[] {
  const tables = splitTmdlTables(tablesTmdl);
  if (tables.length === 0) {
    throw new Error('No `table …` definitions were found in the TMDL.');
  }
  const culture = (opts.culture && opts.culture.trim()) || 'en-US';
  const parts: DefinitionPartOut[] = [];
  const add = (path: string, text: string) =>
    parts.push({ path, payload: b64(text), payloadType: 'InlineBase64' });

  add('definition.pbism', DEFINITION_PBISM);
  add('.platform', platformJson(displayName));
  add('definition/database.tmdl', 'database\n\tcompatibilityLevel: 1604\n');
  add('definition/model.tmdl', buildModelTmdl(tables, culture));
  for (const t of tables) add(`definition/tables/${t.fileBase}.tmdl`, t.body);
  if (opts.expressionsTmdl && opts.expressionsTmdl.trim()) {
    add('definition/expressions.tmdl', opts.expressionsTmdl.replace(/\s+$/, '') + '\n');
  }
  return parts;
}

export interface CreateModelResult {
  id: string;
  name: string;
  tables: string[];
}

/** Create a brand-new semantic model in the workspace from pasted TMDL. */
export async function createSemanticModel(
  workspaceId: string,
  displayName: string,
  tablesTmdl: string,
  opts: NewModelOptions = {}
): Promise<CreateModelResult> {
  const name = displayName.trim();
  if (!name) throw new Error('Enter a name for the new semantic model.');
  const parts = buildNewModelParts(name, tablesTmdl, opts);
  const created = await udf.fabricProxy<{ id: string; displayName?: string }>(
    'fabric',
    `/workspaces/${workspaceId}/items`,
    'POST',
    { displayName: name, type: 'SemanticModel', definition: { parts } }
  );
  const tableNames = splitTmdlTables(tablesTmdl).map((t) => t.name);
  return { id: created.id, name: created.displayName ?? name, tables: tableNames };
}

export interface AddTablesResult {
  added: string[];
  updated: string[];
}

/**
 * Add (or overwrite) one or more tables in an existing semantic model. Each
 * table becomes its own `definition/tables/<name>.tmdl` part and a `ref table`
 * line is appended to model.tmdl when the table is new. Optional shared
 * expressions are appended to (or create) expressions.tmdl.
 */
export async function addTablesToModel(
  workspaceId: string,
  datasetId: string,
  tablesTmdl: string,
  opts: NewModelOptions = {}
): Promise<AddTablesResult> {
  const tables = splitTmdlTables(tablesTmdl);
  if (tables.length === 0) {
    throw new Error('No `table …` definitions were found in the TMDL.');
  }

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /(^|\/)model\.tmdl$/i.test(p.path));
  if (!modelPart) {
    throw new Error('The target model has no model.tmdl part — cannot add tables.');
  }

  const existingRefs = new Set<string>();
  for (const m of modelPart.text.matchAll(/^ref table[ \t]+(.+)$/gm)) {
    existingRefs.add(unquoteName(m[1]).toLowerCase());
  }
  const existingPaths = new Set(parts.map((p) => p.path.toLowerCase()));

  const edits: Record<string, string> = {};
  const added: string[] = [];
  const updated: string[] = [];
  let modelText = modelPart.text.replace(/\s+$/, '');

  for (const t of tables) {
    const path = `definition/tables/${t.fileBase}.tmdl`;
    edits[path] = t.body;
    const known = existingRefs.has(t.name.toLowerCase()) || existingPaths.has(path.toLowerCase());
    if (!existingRefs.has(t.name.toLowerCase())) {
      modelText += `\nref table ${t.ref}`;
      existingRefs.add(t.name.toLowerCase());
    }
    if (known) updated.push(t.name);
    else added.push(t.name);
  }
  edits[modelPart.path] = modelText + '\n';

  if (opts.expressionsTmdl && opts.expressionsTmdl.trim()) {
    const exprPart = parts.find((p) => /(^|\/)expressions\.tmdl$/i.test(p.path));
    const base = exprPart ? exprPart.text.replace(/\s+$/, '') + '\n\n' : '';
    edits[exprPart?.path ?? 'definition/expressions.tmdl'] =
      (base + opts.expressionsTmdl.replace(/\s+$/, '')).replace(/^\n+/, '') + '\n';
  }

  await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return { added, updated };
}

/**
 * Build a shared `expression` TMDL block for a Direct Lake source pointing at a
 * Fabric Lakehouse's OneLake path. The expression name must match the
 * `expressionSource` referenced by the table partitions.
 */
export function buildOneLakeDirectLakeExpression(
  expressionName: string,
  workspaceId: string,
  lakehouseId: string
): string {
  const url = `https://onelake.dfs.fabric.microsoft.com/${workspaceId}/${lakehouseId}`;
  return [
    `expression ${quoteName(expressionName)} =`,
    '\t\tlet',
    `\t\t\tSource = AzureStorage.DataLake("${url}", [HierarchicalNavigation=true])`,
    '\t\tin',
    '\t\t\tSource',
  ].join('\n');
}

export interface LakehouseRef {
  id: string;
  name: string;
}

/** List the Lakehouses in a workspace (for wiring a Direct Lake source). */
export async function listLakehouses(workspaceId: string): Promise<LakehouseRef[]> {
  const data = await udf.fabricProxy<{ value?: { id: string; displayName: string; type: string }[] }>(
    'fabric',
    `/workspaces/${workspaceId}/items?type=Lakehouse`
  );
  return (data.value ?? [])
    .filter((i) => i.type === 'Lakehouse')
    .map((i) => ({ id: i.id, name: i.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
