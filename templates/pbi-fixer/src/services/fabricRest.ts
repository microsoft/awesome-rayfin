/**
 * Fabric / Power BI read + write helpers, all routed through the server-side
 * `fabric_proxy` User Data Function (the static frontend has no Fabric-audience
 * token of its own and CORS blocks direct calls).
 *
 * Ported from the standalone "TS PBI Fixer" fabricApi.ts, with every direct
 * `fetch` replaced by `udf.fabricProxy(...)`.
 */
import { udf } from './udfClient';
import type {
  ModelData,
  TableInfo,
  ReportData,
  PageInfo,
  VisualInfo,
  VisualObjectRef,
} from '@/explorer/types';

// --------------------------------------------------------------------------- //
// Semantic models
// --------------------------------------------------------------------------- //
export async function listSemanticModels(
  workspaceId: string
): Promise<{ id: string; name: string }[]> {
  const data = await udf.fabricProxy<{ value: { id: string; name: string }[] }>(
    'pbi',
    `/groups/${workspaceId}/datasets`
  );
  return (data.value ?? []).map((d) => ({ id: d.id, name: d.name }));
}

// --------------------------------------------------------------------------- //
// Unified report + semantic-model picker (folder-aware)
// --------------------------------------------------------------------------- //
export interface ReportModelPair {
  /** Stable key: folderPath + NUL + lowercased name. */
  key: string;
  name: string;
  /** Display-folder path, e.g. "Finance / Monthly". Empty for workspace root. */
  folderPath: string;
  reportId?: string;
  datasetId?: string;
}

interface FabricItem {
  id: string;
  displayName: string;
  type: string;
  folderId?: string;
}
interface FabricFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
}

/**
 * List reports + semantic models in a workspace, merged into "pairs" keyed by
 * display-folder + name (a report and its model almost always share a name),
 * each annotated with its display-folder path. Routed through the Fabric items
 * API so we also get each item's `folderId` for grouping. Sorted alphabetically
 * by folder, then name.
 */
export async function listReportModelPairs(workspaceId: string): Promise<ReportModelPair[]> {
  const [foldersResp, itemsResp] = await Promise.all([
    udf
      .fabricProxy<{ value: FabricFolder[] }>('fabric', `/workspaces/${workspaceId}/folders`)
      .catch(() => ({ value: [] as FabricFolder[] })),
    udf.fabricProxy<{ value: FabricItem[] }>('fabric', `/workspaces/${workspaceId}/items`),
  ]);

  const folderById = new Map<string, FabricFolder>();
  for (const f of foldersResp.value ?? []) folderById.set(f.id, f);

  const folderPath = (folderId?: string): string => {
    const parts: string[] = [];
    let cur = folderId ? folderById.get(folderId) : undefined;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      parts.unshift(cur.displayName);
      cur = cur.parentFolderId ? folderById.get(cur.parentFolderId) : undefined;
    }
    return parts.join(' / ');
  };

  const pairs = new Map<string, ReportModelPair>();
  for (const it of itemsResp.value ?? []) {
    const isReport = it.type === 'Report';
    const isModel = it.type === 'SemanticModel';
    if (!isReport && !isModel) continue;
    const path = folderPath(it.folderId);
    const key = `${path}\u0000${it.displayName.toLowerCase()}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { key, name: it.displayName, folderPath: path };
      pairs.set(key, pair);
    }
    if (isReport) pair.reportId = it.id;
    if (isModel) pair.datasetId = it.id;
  }

  return [...pairs.values()].sort(
    (a, b) =>
      a.folderPath.localeCompare(b.folderPath) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

interface PbiTable {
  name: string;
  description?: string;
  isHidden?: boolean;
  columns?: PbiColumn[];
  measures?: PbiMeasure[];
}
interface PbiColumn {
  name: string;
  dataType?: string;
  isHidden?: boolean;
  expression?: string;
  columnType?: string;
  summarizeBy?: string;
  displayFolder?: string;
  isKey?: boolean;
  dataCategory?: string;
  sortByColumn?: string;
}
interface PbiMeasure {
  name: string;
  expression?: string;
  formatString?: string;
  description?: string;
  displayFolder?: string;
  isHidden?: boolean;
}
interface PbiRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  crossFilteringBehavior?: string;
  isActive?: boolean;
}

interface ExecuteQueriesResp {
  results?: { tables?: { rows?: Record<string, unknown>[] }[] }[];
}

/** Read a column from an executeQueries row, tolerating key formats like
 *  `[Name]`, `INFO.VIEW.TABLES()[Name]` or a bare `Name`. */
function cell(row: Record<string, unknown>, name: string): unknown {
  for (const k of Object.keys(row)) {
    const m = k.match(/\[([^\]]+)\]\s*$/);
    const bare = m ? m[1] : k;
    if (bare === name) return row[k];
  }
  return undefined;
}
function asStr(v: unknown): string {
  return v == null ? '' : String(v);
}
function asBool(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1';
}

export async function loadModelData(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<ModelData> {
  // An explicit (re)load should reflect server truth, not a stale optimistic
  // cache — force the next getDefinition export to be fresh.
  invalidateDefinitionCache('model', workspaceId, datasetId);
  const modelData: ModelData = {
    tables: {},
    relationships: [],
    perspectives: [],
    modelProperties: { compatibilityLevel: '', defaultMode: '' },
    datasetName,
  };

  // Primary path: INFO.VIEW DAX functions via executeQueries. Works for every
  // dataset type (Import / DirectQuery / Direct Lake), unlike the push-only
  // `/datasets/{id}/tables` REST endpoint.
  const infoOk = await loadModelViaInfoView(workspaceId, datasetId, modelData);

  // Fallback: legacy push-dataset REST endpoints (only succeed for push datasets).
  if (!infoOk || Object.keys(modelData.tables).length === 0) {
    await loadModelViaRestTables(workspaceId, datasetId, modelData);
  }

  return modelData;
}

/** Run a single DAX query via executeQueries (one query per call — the REST
 *  API rejects multi-query batches with "Only one query is allowed."). */
async function evalRows(
  workspaceId: string,
  datasetId: string,
  dax: string
): Promise<Record<string, unknown>[]> {
  const resp = await udf.fabricProxy<ExecuteQueriesResp>(
    'pbi',
    `/groups/${workspaceId}/datasets/${datasetId}/executeQueries`,
    'POST',
    {
      queries: [{ query: dax }],
      serializerSettings: { includeNulls: true },
    }
  );
  return resp.results?.[0]?.tables?.[0]?.rows ?? [];
}

// --------------------------------------------------------------------------- //
// TMDL partition parsing (table M / Power Query source)
// --------------------------------------------------------------------------- //

interface TmdlPartition {
  name: string;
  /** Storage mode (`import` / `directLake` / `directQuery` / `dual`) or kind. */
  mode: string;
  /** Raw M (Power Query) source for `= m` partitions; empty otherwise. */
  expression: string;
}

/** Tab-indent depth of a TMDL line. */
function tmdlIndent(line: string): number {
  const m = /^(\t*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Declared name from a TMDL `<keyword> <name> …` line, or null. */
function tmdlDeclName(line: string, keyword: string): string | null {
  const trimmed = line.replace(/^\t*/, '');
  if (!new RegExp(`^${keyword}\\s`).test(trimmed)) return null;
  const rest = trimmed.slice(keyword.length).replace(/^\s+/, '');
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  const m = /^([^\s=]+)/.exec(rest);
  return m ? m[1] : null;
}

/**
 * Parse `definition/tables/*.tmdl` parts into per-table partition lists,
 * extracting the M (Power Query) source body for `= m` partitions. The body is
 * dedented to the shallowest indent so the returned expression is clean
 * (`let … in …`). Entity / calculated partitions yield an empty expression.
 */
function parseTmdlPartitions(parts: RawDefinitionPart[]): Record<string, TmdlPartition[]> {
  const out: Record<string, TmdlPartition[]> = {};
  for (const part of parts) {
    if (part.binary) continue;
    if (!/^definition\/tables\/.+\.tmdl$/i.test(part.path)) continue;
    const lines = part.text.split('\n');

    let tableName: string | null = null;
    for (const line of lines) {
      if (tmdlIndent(line) === 0) {
        const n = tmdlDeclName(line, 'table');
        if (n) {
          tableName = n;
          break;
        }
      }
    }
    if (!tableName) continue;

    const list: TmdlPartition[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (tmdlIndent(lines[i]) !== 1) continue;
      const pName = tmdlDeclName(lines[i], 'partition');
      if (pName === null) continue;

      const kindMatch = /=\s*([A-Za-z]+)/.exec(lines[i].replace(/^\t*/, ''));
      const kind = kindMatch ? kindMatch[1] : '';

      // Partition block ends at the next line back at table-child depth (<= 1).
      let pEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && tmdlIndent(lines[j]) <= 1) {
          pEnd = j;
          break;
        }
      }

      let mode = '';
      for (let j = i + 1; j < pEnd; j++) {
        const mm = /^mode:\s*(\S+)/.exec(lines[j].replace(/^\t*/, ''));
        if (mm) {
          mode = mm[1];
          break;
        }
      }

      let expression = '';
      if (/^m$/i.test(kind)) {
        let srcIdx = -1;
        for (let j = i + 1; j < pEnd; j++) {
          if (tmdlIndent(lines[j]) === 2 && /^source\b/.test(lines[j].replace(/^\t*/, ''))) {
            srcIdx = j;
            break;
          }
        }
        if (srcIdx >= 0) {
          const body: string[] = [];
          for (let j = srcIdx + 1; j < pEnd; j++) {
            if (lines[j].trim() !== '' && tmdlIndent(lines[j]) <= 2) break;
            body.push(lines[j]);
          }
          let minIndent = Infinity;
          for (const b of body) {
            if (b.trim() === '') continue;
            minIndent = Math.min(minIndent, tmdlIndent(b));
          }
          if (!isFinite(minIndent)) minIndent = 0;
          expression = body
            .map((b) => (b.trim() === '' ? '' : b.slice(minIndent)))
            .join('\n')
            .replace(/\s+$/, '');
        }
      }

      list.push({ name: pName, mode: mode || kind, expression });
    }
    out[tableName] = list;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// TMDL scalar property scanning (TE2-parity advanced properties)
// --------------------------------------------------------------------------- //

/** Read `key: value` / bare-flag scalar properties at a given indent within a
 *  line range, keeping only keys in `wanted`. A bare flag (`key` with no value)
 *  is treated as `true`. */
function readScalarsAtIndent(
  lines: string[],
  start: number,
  end: number,
  indent: number,
  wanted: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = start; i < end; i++) {
    if (tmdlIndent(lines[i]) !== indent) continue;
    const t = lines[i].replace(/^\t*/, '');
    const kv = /^([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(t);
    if (kv) {
      if (wanted.has(kv[1])) out[kv[1]] = kv[2].trim();
      continue;
    }
    const bare = /^([A-Za-z_]\w*)\s*$/.exec(t);
    if (bare && wanted.has(bare[1])) out[bare[1]] = 'true';
  }
  return out;
}

const TABLE_SCALAR_KEYS = new Set([
  'dataCategory',
  'isPrivate',
  'excludeFromModelRefresh',
  'excludeFromAutomaticAggregations',
  'showAsVariationsOnly',
  'alternateSourcePrecedence',
  'lineageTag',
  'sourceLineageTag',
]);
const COLUMN_SCALAR_KEYS = new Set([
  'formatString',
  'dataType',
  'isAvailableInMdx',
  'lineageTag',
  'sourceLineageTag',
]);
const MEASURE_SCALAR_KEYS = new Set([
  'dataCategory',
  'lineageTag',
  'sourceLineageTag',
]);
const MODEL_SCALAR_KEYS = new Set([
  'culture',
  'collation',
  'sourceQueryCulture',
  'defaultDataView',
  'defaultPowerBIDataSourceVersion',
  'directLakeBehavior',
  'dataSourceVariablesOverrideBehavior',
  'defaultMeasure',
  'storageLocation',
  'mAttributes',
  'disableAutoExists',
  'dataSourceDefaultMaxConnections',
  'maxParallelismPerQuery',
  'maxParallelismPerRefresh',
  'discourageImplicitMeasures',
  'discourageCompositeModels',
  'forceUniqueNames',
  'fastCombine',
  'legacyRedirects',
  'returnErrorValuesAsNull',
  'defaultMode',
]);

function tmdlBool(v: string | undefined): boolean {
  return v != null && v.toLowerCase() === 'true';
}

/** Merge TE2-parity advanced scalar properties from the model's TMDL parts into
 *  the already-built `modelData`. INFO.VIEW does not expose most of these, so
 *  the TMDL definition is the only reliable source. Best-effort: any parse miss
 *  simply leaves the field undefined. */
function applyTmdlScalars(parts: RawDefinitionPart[], modelData: ModelData): void {
  for (const part of parts) {
    if (part.binary) continue;
    const lines = part.text.split('\n');

    // Model-level properties (definition/model.tmdl).
    if (/^definition\/model\.tmdl$/i.test(part.path)) {
      const mp = readScalarsAtIndent(lines, 0, lines.length, 1, MODEL_SCALAR_KEYS);
      const p = modelData.modelProperties;
      if (mp.culture) p.culture = mp.culture;
      if (mp.collation) p.collation = mp.collation;
      if (mp.sourceQueryCulture) p.sourceQueryCulture = mp.sourceQueryCulture;
      if (mp.defaultDataView) p.defaultDataView = mp.defaultDataView;
      if (mp.defaultPowerBIDataSourceVersion)
        p.defaultPowerBIDataSourceVersion = mp.defaultPowerBIDataSourceVersion;
      if (mp.directLakeBehavior) p.directLakeBehavior = mp.directLakeBehavior;
      if (mp.dataSourceVariablesOverrideBehavior)
        p.dataSourceVariablesOverrideBehavior = mp.dataSourceVariablesOverrideBehavior;
      if (mp.defaultMeasure) p.defaultMeasure = mp.defaultMeasure;
      if (mp.storageLocation) p.storageLocation = mp.storageLocation;
      if (mp.mAttributes) p.mAttributes = mp.mAttributes;
      if (mp.disableAutoExists) p.disableAutoExists = mp.disableAutoExists;
      if (mp.dataSourceDefaultMaxConnections)
        p.dataSourceDefaultMaxConnections = mp.dataSourceDefaultMaxConnections;
      if (mp.maxParallelismPerQuery) p.maxParallelismPerQuery = mp.maxParallelismPerQuery;
      if (mp.maxParallelismPerRefresh) p.maxParallelismPerRefresh = mp.maxParallelismPerRefresh;
      if (mp.defaultMode && !p.defaultMode) p.defaultMode = mp.defaultMode;
      p.discourageImplicitMeasures = tmdlBool(mp.discourageImplicitMeasures);
      p.discourageCompositeModels = tmdlBool(mp.discourageCompositeModels);
      p.forceUniqueNames = tmdlBool(mp.forceUniqueNames);
      p.fastCombine = tmdlBool(mp.fastCombine);
      p.legacyRedirects = tmdlBool(mp.legacyRedirects);
      p.returnErrorValuesAsNull = tmdlBool(mp.returnErrorValuesAsNull);
      continue;
    }

    // Table / column / measure properties (definition/tables/*.tmdl).
    if (!/^definition\/tables\/.+\.tmdl$/i.test(part.path)) continue;

    let tableName: string | null = null;
    for (const line of lines) {
      if (tmdlIndent(line) === 0) {
        const n = tmdlDeclName(line, 'table');
        if (n) {
          tableName = n;
          break;
        }
      }
    }
    if (!tableName) continue;
    const table = modelData.tables[tableName];
    if (!table) continue;

    // Table-level scalars are the indent-1 `key: value` lines (column / measure
    // / partition / hierarchy decls carry a name and never match the regex).
    const ts = readScalarsAtIndent(lines, 0, lines.length, 1, TABLE_SCALAR_KEYS);
    if (ts.dataCategory) table.dataCategory = ts.dataCategory;
    if (ts.alternateSourcePrecedence)
      table.alternateSourcePrecedence = ts.alternateSourcePrecedence;
    if (ts.lineageTag) table.lineageTag = ts.lineageTag;
    if (ts.sourceLineageTag) table.sourceLineageTag = ts.sourceLineageTag;
    table.isPrivate = tmdlBool(ts.isPrivate);
    table.excludeFromModelRefresh = tmdlBool(ts.excludeFromModelRefresh);
    table.excludeFromAutomaticAggregations = tmdlBool(ts.excludeFromAutomaticAggregations);
    table.showAsVariationsOnly = tmdlBool(ts.showAsVariationsOnly);

    // Per-column and per-measure scalars from their indent-2 child blocks.
    for (let i = 0; i < lines.length; i++) {
      if (tmdlIndent(lines[i]) !== 1) continue;
      const colName = tmdlDeclName(lines[i], 'column');
      const measName = tmdlDeclName(lines[i], 'measure');
      if (colName === null && measName === null) continue;
      let blockEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '' && tmdlIndent(lines[j]) <= 1) {
          blockEnd = j;
          break;
        }
      }
      if (colName !== null) {
        const col = table.columns[colName];
        if (col) {
          const cs = readScalarsAtIndent(lines, i + 1, blockEnd, 2, COLUMN_SCALAR_KEYS);
          if (cs.formatString) col.formatString = cs.formatString;
          if (cs.dataType && !col.dataType) col.dataType = cs.dataType;
          if (cs.lineageTag) col.lineageTag = cs.lineageTag;
          if (cs.sourceLineageTag) col.sourceLineageTag = cs.sourceLineageTag;
          col.isAvailableInMdx = cs.isAvailableInMdx == null ? true : tmdlBool(cs.isAvailableInMdx);
        }
      } else if (measName !== null) {
        const meas = table.measures[measName];
        if (meas) {
          const ms = readScalarsAtIndent(lines, i + 1, blockEnd, 2, MEASURE_SCALAR_KEYS);
          if (ms.dataCategory) meas.dataCategory = ms.dataCategory;
          if (ms.lineageTag) meas.lineageTag = ms.lineageTag;
          if (ms.sourceLineageTag) meas.sourceLineageTag = ms.sourceLineageTag;
        }
      }
    }
  }
}

/** Load tables / columns / measures / relationships through INFO.VIEW DAX. */
async function loadModelViaInfoView(
  workspaceId: string,
  datasetId: string,
  modelData: ModelData
): Promise<boolean> {
  // Tables, columns, measures and relationships are four independent INFO.VIEW
  // queries. Each executeQueries call hops through the server-side fabric_proxy
  // UDF (browser → UDF → PBI REST), so the round-trip count is the dominant
  // cost. Fire all four concurrently — one network wave instead of "TABLES
  // first, then the rest" — which roughly halves per-model load latency. The
  // rows are still processed tables-first below, so fetch order is irrelevant.
  //
  // The TMDL getDefinition export (for partition M / storage mode) is a slow
  // 202 long-running operation and is fully independent of the INFO.VIEW rows,
  // so kick it off in the SAME wave and only await it after the tables map is
  // built — overlapping it instead of running it serially afterwards removes a
  // whole LRO round-trip (often the single slowest item) from the critical path.
  const partsPromise = loadDefinitionParts('model', workspaceId, datasetId).catch(
    () => null as RawDefinitionPart[] | null
  );
  const [tblRes, colRes, measRes, relRes] = await Promise.allSettled([
    evalRows(workspaceId, datasetId, 'EVALUATE INFO.VIEW.TABLES()'),
    evalRows(workspaceId, datasetId, 'EVALUATE INFO.VIEW.COLUMNS()'),
    evalRows(workspaceId, datasetId, 'EVALUATE INFO.VIEW.MEASURES()'),
    evalRows(workspaceId, datasetId, 'EVALUATE INFO.VIEW.RELATIONSHIPS()'),
  ]);

  // TABLES is the authoritative driver: if it errored or returned nothing,
  // INFO.VIEW is unsupported / executeQueries was blocked → signal the caller
  // to try the legacy REST-tables fallback.
  if (tblRes.status !== 'fulfilled' || tblRes.value.length === 0) return false;
  const tableRows = tblRes.value;
  const columnRows = colRes.status === 'fulfilled' ? colRes.value : [];
  const measureRows = measRes.status === 'fulfilled' ? measRes.value : [];
  const relRows = relRes.status === 'fulfilled' ? relRes.value : [];

  for (const r of tableRows) {
    const name = asStr(cell(r, 'Name'));
    if (!name) continue;
    modelData.tables[name] = {
      description: asStr(cell(r, 'Description')),
      isHidden: asBool(cell(r, 'IsHidden')),
      type: 'Table',
      columns: {},
      measures: {},
      hierarchies: {},
      calcItems: {},
      partitions: [],
    };
  }

  for (const r of columnRows) {
    const tableName = asStr(cell(r, 'Table'));
    const name = asStr(cell(r, 'Name'));
    const t = modelData.tables[tableName];
    if (!t || !name) continue;
    const expr = asStr(cell(r, 'Expression'));
    t.columns[name] = {
      dataType: asStr(cell(r, 'DataType')),
      isHidden: asBool(cell(r, 'IsHidden')),
      expression: expr || null,
      type: expr ? 'Calculated' : 'Data',
      summarizeBy: asStr(cell(r, 'SummarizeBy')),
      displayFolder: asStr(cell(r, 'DisplayFolder')),
      isKey: asBool(cell(r, 'IsKey')),
      dataCategory: asStr(cell(r, 'DataCategory')),
      sortByColumn: asStr(cell(r, 'SortByColumn')),
      encodingHint: '',
      isNullable: true,
    };
  }

  for (const r of measureRows) {
    const tableName = asStr(cell(r, 'Table'));
    const name = asStr(cell(r, 'Name'));
    const t = modelData.tables[tableName];
    if (!t || !name) continue;
    t.measures[name] = {
      expression: asStr(cell(r, 'Expression')),
      formatString: asStr(cell(r, 'FormatString')),
      description: asStr(cell(r, 'Description')),
      displayFolder: asStr(cell(r, 'DisplayFolder')),
      isHidden: asBool(cell(r, 'IsHidden')),
    };
  }

  // Relationships were fetched in parallel above; map them here. A view-schema
  // mismatch simply yields an empty list (the parallel fetch swallowed errors).
  modelData.relationships = relRows
    .map((r) => ({
      fromTable: asStr(cell(r, 'FromTable')),
      fromColumn: asStr(cell(r, 'FromColumn')),
      toTable: asStr(cell(r, 'ToTable')),
      toColumn: asStr(cell(r, 'ToColumn')),
      crossFilter: asStr(cell(r, 'CrossFilteringBehavior')),
      isActive: cell(r, 'IsActive') == null ? true : asBool(cell(r, 'IsActive')),
      multiplicity: `${asStr(cell(r, 'FromCardinality'))}:${asStr(cell(r, 'ToCardinality'))}`,
      securityFiltering: asStr(cell(r, 'SecurityFilteringBehavior')),
      relyOnRri: asBool(cell(r, 'RelyOnReferentialIntegrity')),
    }))
    .filter((x) => x.fromTable && x.toTable);

  // M (Power Query) source expressions and the storage mode come from the
  // model's TMDL definition. `INFO.VIEW.PARTITIONS()` does not exist and
  // `INFO.PARTITIONS()` is blocked by the executeQueries endpoint, so the only
  // reliable source for a table's M expression is its TMDL part. We read each
  // `definition/tables/*.tmdl` part and (a) populate the table's partition list
  // with the editable M source and (b) derive the model's default mode so the
  // UI can offer Direct Lake-specific actions (e.g. cache warm-up).
  let anyDirectLake = false;
  try {
    const parts = await partsPromise;
    const byTable = parts ? parseTmdlPartitions(parts) : {};
    for (const [tableName, plist] of Object.entries(byTable)) {
      const t = modelData.tables[tableName];
      if (!t) continue;
      t.partitions = plist.map((p) => ({
        name: p.name,
        sourceType: p.mode,
        expression: p.expression,
      }));
      if (plist.some((p) => /directlake/i.test(p.mode) || /entity/i.test(p.mode))) {
        anyDirectLake = true;
      }
    }
    // TE2-parity advanced scalar properties (lineageTag, isPrivate, model-level
    // options, …) come from the same TMDL parts — merge them in.
    if (parts) applyTmdlScalars(parts, modelData);
  } catch {
    // TMDL export unavailable (e.g. capacity paused) — leave partitions empty.
  }
  if (anyDirectLake) {
    modelData.modelProperties.defaultMode = 'DirectLake';
  }

  return true;
}

/** Legacy fallback: push-dataset REST endpoints (`/tables`, `/relationships`). */
async function loadModelViaRestTables(
  workspaceId: string,
  datasetId: string,
  modelData: ModelData
): Promise<void> {
  try {
    const tablesResp = await udf.fabricProxy<{ value: PbiTable[] }>(
      'pbi',
      `/groups/${workspaceId}/datasets/${datasetId}/tables`
    );
    for (const t of tablesResp.value ?? []) {
      const tableInfo: TableInfo = {
        description: t.description ?? '',
        isHidden: t.isHidden ?? false,
        type: 'Table',
        columns: {},
        measures: {},
        hierarchies: {},
        calcItems: {},
        partitions: [],
      };
      for (const c of t.columns ?? []) {
        tableInfo.columns[c.name] = {
          dataType: c.dataType ?? '',
          isHidden: c.isHidden ?? false,
          expression: c.expression ?? null,
          type: c.columnType ?? '',
          summarizeBy: c.summarizeBy ?? '',
          displayFolder: c.displayFolder ?? '',
          isKey: c.isKey ?? false,
          dataCategory: c.dataCategory ?? '',
          sortByColumn: c.sortByColumn ?? '',
          encodingHint: '',
          isNullable: true,
        };
      }
      for (const m of t.measures ?? []) {
        tableInfo.measures[m.name] = {
          expression: m.expression ?? '',
          formatString: m.formatString ?? '',
          description: m.description ?? '',
          displayFolder: m.displayFolder ?? '',
          isHidden: m.isHidden ?? false,
        };
      }
      modelData.tables[t.name] = tableInfo;
    }
  } catch {
    // tables endpoint unavailable for some dataset types
  }

  try {
    const relsResp = await udf.fabricProxy<{ value: PbiRelationship[] }>(
      'pbi',
      `/groups/${workspaceId}/datasets/${datasetId}/relationships`
    );
    modelData.relationships = (relsResp.value ?? []).map((r) => ({
      fromTable: r.fromTable,
      fromColumn: r.fromColumn,
      toTable: r.toTable,
      toColumn: r.toColumn,
      crossFilter: r.crossFilteringBehavior ?? '',
      isActive: r.isActive ?? true,
      multiplicity: '',
      securityFiltering: '',
      relyOnRri: false,
    }));
  } catch {
    // relationships endpoint may fail
  }
}

export async function executeDax(
  workspaceId: string,
  datasetId: string,
  daxQuery: string
): Promise<Record<string, unknown>[]> {
  const resp = await udf.fabricProxy<{
    results: { tables: { rows: Record<string, unknown>[] }[] }[];
  }>('pbi', `/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, 'POST', {
    queries: [{ query: daxQuery }],
    serializerSettings: { includeNulls: true },
  });
  return resp.results?.[0]?.tables?.[0]?.rows ?? [];
}

// --------------------------------------------------------------------------- //
// Reports
// --------------------------------------------------------------------------- //

/** Metadata needed to embed a live Power BI report (organization embed). */
export interface ReportEmbedInfo {
  embedUrl: string;
  reportId: string;
  datasetId: string;
}

/**
 * Fetch the report's embed URL via the PBI REST API (through the proxy). Used by
 * the live preview, which embeds with the signed-in user's AAD token
 * (`tokenType: Aad`) — no capacity-bound embed token required.
 */
export async function getReportEmbedInfo(
  workspaceId: string,
  reportId: string
): Promise<ReportEmbedInfo> {
  const meta = await udf.fabricProxy<{ embedUrl?: string; id?: string; datasetId?: string }>(
    'pbi',
    `/groups/${workspaceId}/reports/${reportId}`
  );
  if (!meta.embedUrl) throw new Error('Report has no embed URL');
  return {
    embedUrl: meta.embedUrl,
    reportId: meta.id ?? reportId,
    datasetId: meta.datasetId ?? '',
  };
}

interface DefinitionPart {
  path: string;
  payload: string;
  payloadType: string;
}

function decodePart(payload: string): unknown {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  } catch {
    try {
      return JSON.parse(atob(payload));
    } catch {
      return null;
    }
  }
}

/** Recursively collect Measure / Column field references inside a visual. */
function collectUsedObjects(node: unknown, out: VisualObjectRef[], seen: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  for (const kind of ['Measure', 'Column'] as const) {
    const ref = obj[kind] as
      | { Expression?: { SourceRef?: { Entity?: string } }; Property?: string }
      | undefined;
    if (ref && ref.Property) {
      const table = ref.Expression?.SourceRef?.Entity ?? '';
      const dedupe = `${kind}:${table}:${ref.Property}`;
      if (!seen.has(dedupe)) {
        seen.add(dedupe);
        out.push({ table, object: ref.Property, type: kind });
      }
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') collectUsedObjects(v, out, seen);
  }
}

async function getReportDefinition(
  workspaceId: string,
  reportId: string
): Promise<DefinitionPart[]> {
  const resp = await udf.fabricProxy<{ definition?: { parts?: DefinitionPart[] } }>(
    'fabric',
    `/workspaces/${workspaceId}/reports/${reportId}/getDefinition?format=PBIR`,
    'POST'
  );
  return resp.definition?.parts ?? [];
}

export async function loadReportDefinition(
  workspaceId: string,
  reportId: string
): Promise<ReportData> {
  const parts = await getReportDefinition(workspaceId, reportId);
  const reportData: ReportData = {
    pages: {},
    format: 'PBIR',
    reportId,
    workspaceId,
    visualObjects: {},
  };

  // page order
  const pageOrderMap: Record<string, number> = {};
  const pagesJsonPart = parts.find((p) => p.path.endsWith('pages.json'));
  if (pagesJsonPart) {
    const pagesJson = decodePart(pagesJsonPart.payload) as { pageOrder?: string[] } | null;
    pagesJson?.pageOrder?.forEach((name, idx) => {
      pageOrderMap[name] = idx;
    });
  }

  for (const part of parts) {
    const pageMatch = part.path.match(/definition\/pages\/([^/]+)\/page\.json$/);
    if (!pageMatch) continue;
    const pageJson = decodePart(part.payload) as
      | { displayName?: string; width?: number; height?: number; visibility?: string }
      | null;
    if (!pageJson) continue;
    const pageName = pageMatch[1];
    const page: PageInfo = {
      displayName: pageJson.displayName ?? pageName,
      width: pageJson.width ?? 1280,
      height: pageJson.height ?? 720,
      hidden: pageJson.visibility === 'HiddenInViewMode',
      visualCount: 0,
      ordinal: pageOrderMap[pageName] ?? 9999,
      visuals: {},
    };
    reportData.pages[pageName] = page;
  }

  for (const part of parts) {
    const visualMatch = part.path.match(
      /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/
    );
    if (!visualMatch) continue;
    const visualJson = decodePart(part.payload) as Record<string, unknown> | null;
    if (!visualJson) continue;
    const pageName = visualMatch[1];
    const visualName = visualMatch[2];
    const page = reportData.pages[pageName];
    if (!page) continue;

    const position = (visualJson.position ?? {}) as Record<string, number>;
    const visual = (visualJson.visual ?? {}) as Record<string, unknown>;
    const vType = (visual.visualType as string) ?? '';

    const title =
      ((
        (
          ((visual.visualContainerObjects as Record<string, unknown>)?.title as unknown[])?.[0] as
            | Record<string, unknown>
            | undefined
        )?.properties as Record<string, unknown>
      )?.text as Record<string, unknown>)?.toString?.() ?? '';

    const info: VisualInfo = {
      type: vType,
      displayType: vType,
      x: position.x ?? 0,
      y: position.y ?? 0,
      width: position.width ?? 0,
      height: position.height ?? 0,
      hidden: (visualJson.isHidden as boolean) ?? false,
      title: typeof title === 'string' && title !== '[object Object]' ? title : '',
    };
    page.visuals[visualName] = info;
    page.visualCount++;

    const used: VisualObjectRef[] = [];
    collectUsedObjects(visual, used, new Set());
    if (used.length) reportData.visualObjects![`${pageName}:${visualName}`] = used;
  }

  return reportData;
}

// --------------------------------------------------------------------------- //
// Save-back (editable properties)
// --------------------------------------------------------------------------- //
export interface ReportEdits {
  /** keyed by page internal name */
  pages?: Record<
    string,
    Partial<{ displayName: string; width: number; height: number; hidden: boolean }>
  >;
  /** keyed by `${pageName}:${visualName}` */
  visuals?: Record<
    string,
    Partial<{ hidden: boolean; x: number; y: number; width: number; height: number }>
  >;
}

function encodePart(value: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

/** Apply pending page/visual edits and write the report definition back. */
export async function saveReportDefinition(
  workspaceId: string,
  reportId: string,
  edits: ReportEdits
): Promise<number> {
  const parts = await getReportDefinition(workspaceId, reportId);
  let changed = 0;

  for (const part of parts) {
    const pageMatch = part.path.match(/definition\/pages\/([^/]+)\/page\.json$/);
    if (pageMatch && edits.pages?.[pageMatch[1]]) {
      const doc = decodePart(part.payload) as Record<string, unknown> | null;
      if (!doc) continue;
      const e = edits.pages[pageMatch[1]];
      if (e.displayName !== undefined) doc.displayName = e.displayName;
      if (e.width !== undefined) doc.width = e.width;
      if (e.height !== undefined) doc.height = e.height;
      if (e.hidden !== undefined) {
        if (e.hidden) doc.visibility = 'HiddenInViewMode';
        else delete doc.visibility;
      }
      part.payload = encodePart(doc);
      changed++;
      continue;
    }

    const visualMatch = part.path.match(
      /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/
    );
    if (visualMatch) {
      const vKey = `${visualMatch[1]}:${visualMatch[2]}`;
      const e = edits.visuals?.[vKey];
      if (!e) continue;
      const doc = decodePart(part.payload) as Record<string, unknown> | null;
      if (!doc) continue;
      if (e.hidden !== undefined) doc.isHidden = e.hidden;
      const pos = (doc.position ?? {}) as Record<string, number>;
      if (e.x !== undefined) pos.x = e.x;
      if (e.y !== undefined) pos.y = e.y;
      if (e.width !== undefined) pos.width = e.width;
      if (e.height !== undefined) pos.height = e.height;
      doc.position = pos;
      part.payload = encodePart(doc);
      changed++;
    }
  }

  if (changed > 0) {
    await udf.fabricProxy(
      'fabric',
      `/workspaces/${workspaceId}/reports/${reportId}/updateDefinition`,
      'POST',
      { definition: { parts } }
    );
  }
  return changed;
}

// --------------------------------------------------------------------------- //
// Raw definition (TMDL / PBIR) — editable source view with save-back
// --------------------------------------------------------------------------- //

/** A single decoded definition part exposed for the raw source editor. */
export interface RawDefinitionPart {
  /** Logical path inside the item definition, e.g. "definition/tables/Sales.tmdl". */
  path: string;
  /** Decoded UTF-8 text. Empty when the part is binary (see `binary`). */
  text: string;
  payloadType: string;
  /** True when the payload is not UTF-8 text (e.g. an embedded image) — read-only. */
  binary: boolean;
}

export type DefinitionKind = 'report' | 'model';

function itemSegment(kind: DefinitionKind): string {
  return kind === 'report' ? 'reports' : 'semanticModels';
}

function defaultFormat(kind: DefinitionKind): string {
  return kind === 'report' ? 'PBIR' : 'TMDL';
}

function decodeText(payload: string): string | null {
  try {
    return decodeURIComponent(escape(atob(payload)));
  } catch {
    return null;
  }
}

function encodeText(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

// --------------------------------------------------------------------------- //
// Definition-parts cache
// --------------------------------------------------------------------------- //
// `getDefinition` is a heavyweight long-running export (TMDL/PBIR) — measured at
// ~25-31s per call through the `fabric_proxy` double hop. A single property edit
// otherwise fetches it twice (once in the property editor, once inside
// `saveDefinitionParts`), turning every edit into get + update (~55-79s).
//
// The cache is therefore SESSION-SCOPED, not time-boxed: the initial model load
// already exports the definition once (in `loadModelViaInfoView`), so every
// later edit reuses those parts and pays only the unavoidable `updateDefinition`
// (~24s) instead of re-exporting first. Authoritative-ness is kept two ways:
//   • every successful save write-throughs the just-written parts, and
//   • an explicit model (re)load calls `invalidateDefinitionCache`,
// so stale state cannot outlive an intentional refresh. The long TTL is only a
// safety net against a session that stays open for hours.

const DEFINITION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — effectively session-scoped
const definitionCache = new Map<string, { parts: DefinitionPart[]; ts: number }>();

function defCacheKey(kind: DefinitionKind, workspaceId: string, itemId: string): string {
  return `${kind}:${workspaceId}:${itemId}`;
}

/** Drop any cached definition parts for one item (call before a fresh reload). */
export function invalidateDefinitionCache(
  kind: DefinitionKind,
  workspaceId: string,
  itemId: string
): void {
  definitionCache.delete(defCacheKey(kind, workspaceId, itemId));
}

/** Fetch the raw definition parts, reusing a fresh cache entry when available. */
async function fetchRawDefinitionParts(
  kind: DefinitionKind,
  workspaceId: string,
  itemId: string
): Promise<DefinitionPart[]> {
  const key = defCacheKey(kind, workspaceId, itemId);
  const hit = definitionCache.get(key);
  if (hit && Date.now() - hit.ts < DEFINITION_CACHE_TTL_MS) return hit.parts;
  const format = defaultFormat(kind);
  const resp = await udf.fabricProxy<{ definition?: { parts?: DefinitionPart[] } }>(
    'fabric',
    `/workspaces/${workspaceId}/${itemSegment(kind)}/${itemId}/getDefinition?format=${format}`,
    'POST'
  );
  const parts = resp.definition?.parts ?? [];
  definitionCache.set(key, { parts, ts: Date.now() });
  return parts;
}

/**
 * Fetch the raw item definition (TMDL for models, PBIR for reports) and return
 * each part decoded to UTF-8 text, sorted by path. Binary parts are flagged
 * read-only.
 */
export async function loadDefinitionParts(
  kind: DefinitionKind,
  workspaceId: string,
  itemId: string
): Promise<RawDefinitionPart[]> {
  const parts = await fetchRawDefinitionParts(kind, workspaceId, itemId);
  return parts
    .map((p) => {
      const text = decodeText(p.payload);
      return {
        path: p.path,
        text: text ?? '',
        payloadType: p.payloadType,
        binary: text === null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}

/**
 * Write back edited definition parts. Parts present in `edits` (keyed by path)
 * are replaced; an edit whose path does not exist yet is added as a new part
 * (e.g. a new TMDL table file). All other parts are preserved verbatim from a
 * fresh getDefinition so the update is complete. Returns the number of parts
 * that actually changed (replaced or added).
 */
export async function saveDefinitionParts(
  kind: DefinitionKind,
  workspaceId: string,
  itemId: string,
  edits: Record<string, string>
): Promise<number> {
  const seg = itemSegment(kind);
  // Reuse the parts the property editor just exported (cache hit) instead of a
  // second getDefinition. Clone so a failed write never corrupts the cache.
  const source = await fetchRawDefinitionParts(kind, workspaceId, itemId);
  const parts: DefinitionPart[] = source.map((p) => ({ ...p }));
  const seen = new Set<string>();
  let changed = 0;
  for (const part of parts) {
    if (!(part.path in edits)) continue;
    seen.add(part.path);
    const current = decodeText(part.payload);
    const next = edits[part.path];
    if (current === next) continue;
    part.payload = encodeText(next);
    part.payloadType = 'InlineBase64';
    changed++;
  }
  // Append any edits that reference a path not already in the definition.
  for (const [path, text] of Object.entries(edits)) {
    if (seen.has(path)) continue;
    parts.push({ path, payload: encodeText(text), payloadType: 'InlineBase64' });
    changed++;
  }
  if (changed > 0) {
    await udf.fabricProxy(
      'fabric',
      `/workspaces/${workspaceId}/${seg}/${itemId}/updateDefinition`,
      'POST',
      { definition: { parts } }
    );
    // Keep the cache authoritative with the just-written parts so the next edit
    // (or the source editor) reuses them without re-exporting.
    definitionCache.set(defCacheKey(kind, workspaceId, itemId), { parts, ts: Date.now() });
  }
  return changed;
}

// --------------------------------------------------------------------------- //
// Report storage format (PBIR vs PBIRLegacy) — A11
// --------------------------------------------------------------------------- //

/**
 * Return the storage format of a report (e.g. "PBIR" or "PBIRLegacy"), read
 * from the Power BI reports list. Empty string if the report is not found.
 */
export async function getReportFormat(
  workspaceId: string,
  reportId: string
): Promise<string> {
  const data = await udf.fabricProxy<{ value?: { id: string; reportFlags?: number; format?: string }[] }>(
    'pbi',
    `/groups/${workspaceId}/reports`
  );
  const rpt = (data.value ?? []).find((r) => r.id === reportId);
  return rpt?.format ?? '';
}

/**
 * Upgrade a PBIRLegacy report to PBIR by exporting its PBIR definition and
 * pushing it back via updateDefinition. The server stores the report in PBIR
 * format. The caller is responsible for checking the report is PBIRLegacy
 * first and for polling `getReportFormat` until the flip is observed.
 */
export async function upgradeReportToPbir(
  workspaceId: string,
  reportId: string
): Promise<void> {
  const resp = await udf.fabricProxy<{ definition?: { parts?: DefinitionPart[] } }>(
    'fabric',
    `/workspaces/${workspaceId}/reports/${reportId}/getDefinition?format=PBIR`,
    'POST'
  );
  const parts = resp.definition?.parts ?? [];
  if (!parts.length) {
    throw new Error('Report definition returned no parts — cannot upgrade.');
  }
  await udf.fabricProxy(
    'fabric',
    `/workspaces/${workspaceId}/reports/${reportId}/updateDefinition`,
    'POST',
    { definition: { parts } }
  );
  invalidateDefinitionCache('report', workspaceId, reportId);
}
