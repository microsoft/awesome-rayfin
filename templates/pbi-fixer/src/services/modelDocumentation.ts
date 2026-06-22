// Model documentation (PKG-8 / C8).
//
// Two complementary actions that turn any semantic model into a self-describing
// one, mirroring the community "Data Model Documentation Template.pbix":
//
//   1. addDocumentationTables — adds four calculated documentation tables
//      (`_Tables`, `_Columns`, `_DAX Measures`, `_Relationships`) built from the
//      DAX `INFO.VIEW.*` functions via `SELECTCOLUMNS`, exposing friendly column
//      names the documentation page binds to.
//   2. addDocumentationPage — merges the bundled documentation report page
//      (8 visuals + 4 bookmarks, taken verbatim from the template's PBIR parts)
//      into the user's existing PBIR report so the doc tables are presented as a
//      ready-made "Documentation" page.
//
// Both writes go through the same TMDL / PBIR `updateDefinition` round-trip the
// rest of the app uses, and `refreshDocumentationTables` re-processes the new
// calculated tables so they populate.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { triggerRefresh, getRefreshHistory, waitForLatestRefresh } from './refreshModel';
import docTemplate from '@/assets/docTemplate.json';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export interface DocTablesResult {
  created: string[];
  skipped: string[];
  changed: number;
  detail: string;
}

export interface DocPageResult {
  added: boolean;
  detail: string;
}

export interface DocRefreshResult {
  ok: boolean;
  detail: string;
}

/** A documentation column: a friendly display name backed by an INFO.VIEW column. */
interface DocColumn {
  /** Friendly name shown in the model and bound by the documentation page. */
  friendly: string;
  /** INFO.VIEW source column referenced inside SELECTCOLUMNS, e.g. "[Name]". */
  source: string;
  /** TMDL data type. All textual except the boolean "Is Hidden". */
  type: 'string' | 'boolean';
}

interface DocTableSpec {
  name: string;
  /** The INFO.VIEW table function, e.g. "INFO.VIEW.TABLES()". */
  infoView: string;
  columns: DocColumn[];
}

// --------------------------------------------------------------------------- //
// Table specifications — friendly → INFO.VIEW column mappings
// --------------------------------------------------------------------------- //

const DOC_TABLES: DocTableSpec[] = [
  {
    name: '_Tables',
    infoView: 'INFO.VIEW.TABLES()',
    columns: [
      { friendly: 'Table Name', source: '[Name]', type: 'string' },
      { friendly: 'Description', source: '[Description]', type: 'string' },
      { friendly: 'Data Category', source: '[DataCategory]', type: 'string' },
      { friendly: 'Storage Mode', source: '[StorageMode]', type: 'string' },
      { friendly: 'Expression', source: '[Expression]', type: 'string' },
    ],
  },
  {
    name: '_Columns',
    infoView: 'INFO.VIEW.COLUMNS()',
    columns: [
      { friendly: 'Column Name', source: '[Name]', type: 'string' },
      { friendly: 'Table Name', source: '[Table]', type: 'string' },
      { friendly: 'Data Type', source: '[DataType]', type: 'string' },
      { friendly: 'Explicit Data Type Name', source: '[DataType]', type: 'string' },
      { friendly: 'Description', source: '[Description]', type: 'string' },
      { friendly: 'Expression', source: '[Expression]', type: 'string' },
      { friendly: 'Format String', source: '[FormatString]', type: 'string' },
      { friendly: 'Sort By Column', source: '[SortByColumn]', type: 'string' },
    ],
  },
  {
    name: '_DAX Measures',
    infoView: 'INFO.VIEW.MEASURES()',
    columns: [
      { friendly: 'Name', source: '[Name]', type: 'string' },
      { friendly: 'Table Name', source: '[Table]', type: 'string' },
      { friendly: 'Description', source: '[Description]', type: 'string' },
      { friendly: 'Display Folder', source: '[DisplayFolder]', type: 'string' },
      { friendly: 'Expression', source: '[Expression]', type: 'string' },
      { friendly: 'Format String', source: '[FormatString]', type: 'string' },
      { friendly: 'Is Hidden', source: '[IsHidden]', type: 'boolean' },
      { friendly: 'Data Category', source: '[DataCategory]', type: 'string' },
    ],
  },
  {
    name: '_Relationships',
    infoView: 'INFO.VIEW.RELATIONSHIPS()',
    columns: [
      { friendly: 'From Table', source: '[FromTable]', type: 'string' },
      { friendly: 'From Column', source: '[FromColumn]', type: 'string' },
      { friendly: 'From Cardinality', source: '[FromCardinality]', type: 'string' },
      { friendly: 'To Table', source: '[ToTable]', type: 'string' },
      { friendly: 'To Column', source: '[ToColumn]', type: 'string' },
      { friendly: 'To Cardinality', source: '[ToCardinality]', type: 'string' },
    ],
  },
  // A measures listing the documentation page groups by display folder. Built
  // with the same SELECTCOLUMNS pattern as the other doc tables.
  {
    name: '_Model Measures',
    infoView: 'INFO.VIEW.MEASURES()',
    columns: [
      { friendly: 'Measure Display Folder', source: '[DisplayFolder]', type: 'string' },
      { friendly: 'Measure Description', source: '[Description]', type: 'string' },
      { friendly: 'Default Format String', source: '[FormatString]', type: 'string' },
    ],
  },
];

// The icon / title / count helper measures the documentation page binds to.
// They live on a dedicated `_Doc Measures` host table (created below) and are
// not part of DOC_TABLES because they are measures, not SELECTCOLUMNS columns.
const MEASURE_HOST_TABLE = '_Doc Measures';

const DOC_TABLE_NAMES = [...DOC_TABLES.map((t) => t.name), MEASURE_HOST_TABLE];

// --------------------------------------------------------------------------- //
// Small TMDL helpers (kept local so this service stays self-contained)
// --------------------------------------------------------------------------- //

/** TMDL object name: bare when an identifier, single-quoted otherwise. */
function quoteName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Make a name safe to use as a TMDL part file name. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '_').trim() || 'table';
}

// --------------------------------------------------------------------------- //
// Calculated-table TMDL builder
// --------------------------------------------------------------------------- //

function buildDocTableTmdl(spec: DocTableSpec): string {
  const t = quoteName(spec.name);
  const lines: string[] = [`table ${t}`, `\tlineageTag: ${uuid()}`, ``];

  for (const col of spec.columns) {
    lines.push(
      `\tcolumn ${quoteName(col.friendly)}`,
      `\t\tdataType: ${col.type}`,
      `\t\tlineageTag: ${uuid()}`,
      `\t\tsummarizeBy: none`,
      `\t\tsourceColumn: [${col.friendly}]`,
      ``,
      `\t\tannotation SummarizationSetBy = Automatic`,
      ``
    );
  }

  // SELECTCOLUMNS body — every line indented one level deeper than `source =`.
  const projections = spec.columns
    .map((c, i) => {
      const comma = i < spec.columns.length - 1 ? ',' : '';
      return `\t\t\t\t    "${c.friendly}", ${c.source}${comma}`;
    })
    .join('\n');

  lines.push(
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource =`,
    `\t\t\t\tSELECTCOLUMNS(`,
    `\t\t\t\t    ${spec.infoView},`,
    projections,
    `\t\t\t\t)`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``
  );

  return lines.join('\n');
}

// --------------------------------------------------------------------------- //
// Measure-host TMDL builder
// --------------------------------------------------------------------------- //

/**
 * The icon / title / count measures the documentation page binds to (entity
 * `_Doc Measures`). The icon measures read the live `INFO.VIEW.*` attributes for
 * the row currently shown in each documentation visual, so they evaluate per
 * row without needing extra columns on the doc tables. Titles are static labels
 * for the page's section headers.
 */
const HOST_MEASURES: { name: string; expr: string }[] = [
  { name: 'Title - Tables', expr: '"Tables"' },
  { name: 'Title - Columns', expr: '"Columns"' },
  { name: 'Title - Measures', expr: '"Measures"' },
  { name: 'Title - Relationships', expr: '"Relationships"' },
  {
    name: 'Column Count',
    expr: `VAR _t = SELECTEDVALUE('_Tables'[Table Name]) RETURN IF(ISBLANK(_t), BLANK(), COUNTROWS(FILTER('_Columns', '_Columns'[Table Name] = _t)))`,
  },
  {
    name: 'Table Is Visible Icon',
    expr: `VAR _t = SELECTEDVALUE('_Tables'[Table Name]) VAR _h = MAXX(FILTER(INFO.VIEW.TABLES(), [Name] = _t), IF([IsHidden], 1, 0)) RETURN IF(ISBLANK(_t), BLANK(), IF(_h = 1, "✗", "✓"))`,
  },
  {
    name: 'Table Is Calculation Group Icon',
    expr: `VAR _t = SELECTEDVALUE('_Tables'[Table Name]) VAR _g = MAXX(FILTER(INFO.VIEW.TABLES(), [Name] = _t), IF(NOT ISBLANK([CalculationGroupPrecedence]), 1, 0)) RETURN IF(ISBLANK(_t), BLANK(), IF(_g = 1, "✓", BLANK()))`,
  },
  {
    name: 'Table Refresh Enabled Icon',
    expr: `VAR _t = SELECTEDVALUE('_Tables'[Table Name]) VAR _i = MAXX(FILTER(INFO.VIEW.TABLES(), [Name] = _t), IF([StorageMode] = "Import", 1, 0)) RETURN IF(ISBLANK(_t), BLANK(), IF(_i = 1, "✓", BLANK()))`,
  },
  {
    name: 'Column Is Visible Icon',
    expr: `VAR _c = SELECTEDVALUE('_Columns'[Column Name]) VAR _t = SELECTEDVALUE('_Columns'[Table Name]) VAR _h = MAXX(FILTER(INFO.VIEW.COLUMNS(), [Name] = _c && [Table] = _t), IF([IsHidden], 1, 0)) RETURN IF(ISBLANK(_c), BLANK(), IF(_h = 1, "✗", "✓"))`,
  },
  {
    name: 'Column Is Key Icon',
    expr: `VAR _c = SELECTEDVALUE('_Columns'[Column Name]) VAR _t = SELECTEDVALUE('_Columns'[Table Name]) VAR _k = MAXX(FILTER(INFO.VIEW.COLUMNS(), [Name] = _c && [Table] = _t), IF([IsKey], 1, 0)) RETURN IF(ISBLANK(_c), BLANK(), IF(_k = 1, "✓", BLANK()))`,
  },
  {
    name: 'Column Is Unique Icon',
    expr: `VAR _c = SELECTEDVALUE('_Columns'[Column Name]) VAR _t = SELECTEDVALUE('_Columns'[Table Name]) VAR _u = MAXX(FILTER(INFO.VIEW.COLUMNS(), [Name] = _c && [Table] = _t), IF([IsUnique], 1, 0)) RETURN IF(ISBLANK(_c), BLANK(), IF(_u = 1, "✓", BLANK()))`,
  },
  {
    name: 'Measure Is Visible Icon',
    expr: `VAR _m = SELECTEDVALUE('_DAX Measures'[Name]) VAR _t = SELECTEDVALUE('_DAX Measures'[Table Name]) VAR _h = MAXX(FILTER(INFO.VIEW.MEASURES(), [Name] = _m && [Table] = _t), IF([IsHidden], 1, 0)) RETURN IF(ISBLANK(_m), BLANK(), IF(_h = 1, "✗", "✓"))`,
  },
  {
    name: 'Relationship Is Active Icon',
    expr: `VAR _ft = SELECTEDVALUE('_Relationships'[From Table]) VAR _fc = SELECTEDVALUE('_Relationships'[From Column]) VAR _tt = SELECTEDVALUE('_Relationships'[To Table]) VAR _tc = SELECTEDVALUE('_Relationships'[To Column]) VAR _a = MAXX(FILTER(INFO.VIEW.RELATIONSHIPS(), [FromTable] = _ft && [FromColumn] = _fc && [ToTable] = _tt && [ToColumn] = _tc), IF([IsActive], 1, 0)) RETURN IF(ISBLANK(_ft), BLANK(), IF(_a = 1, "✓", BLANK()))`,
  },
  {
    name: 'Relationship Cardinality Icon',
    expr: `VAR _ft = SELECTEDVALUE('_Relationships'[From Table]) VAR _fc = SELECTEDVALUE('_Relationships'[From Column]) VAR _tt = SELECTEDVALUE('_Relationships'[To Table]) VAR _tc = SELECTEDVALUE('_Relationships'[To Column]) VAR _r = FILTER(INFO.VIEW.RELATIONSHIPS(), [FromTable] = _ft && [FromColumn] = _fc && [ToTable] = _tt && [ToColumn] = _tc) VAR _from = CONCATENATEX(_r, [FromCardinality]) VAR _to = CONCATENATEX(_r, [ToCardinality]) RETURN IF(ISBLANK(_ft), BLANK(), IF(_from = "Many", "*", IF(_from = "One", "1", _from)) & " : " & IF(_to = "Many", "*", IF(_to = "One", "1", _to)))`,
  },
  {
    name: 'Relationship Cross Filtering Behaviour Icon',
    expr: `VAR _ft = SELECTEDVALUE('_Relationships'[From Table]) VAR _fc = SELECTEDVALUE('_Relationships'[From Column]) VAR _tt = SELECTEDVALUE('_Relationships'[To Table]) VAR _tc = SELECTEDVALUE('_Relationships'[To Column]) VAR _cf = CONCATENATEX(FILTER(INFO.VIEW.RELATIONSHIPS(), [FromTable] = _ft && [FromColumn] = _fc && [ToTable] = _tt && [ToColumn] = _tc), [CrossFilteringBehavior]) RETURN IF(ISBLANK(_ft), BLANK(), SWITCH(_cf, "OneDirection", "→", "BothDirections", "↔", "Both", "↔", "Automatic", "⇄", _cf))`,
  },
];

/**
 * Build the `_Doc Measures` host table: a one-row calculated table carrying the
 * documentation page's icon / title / count measures.
 */
function buildMeasureHostTmdl(): string {
  const t = quoteName(MEASURE_HOST_TABLE);
  const lines: string[] = [`table ${t}`, `\tlineageTag: ${uuid()}`, ``];

  lines.push(
    `\tcolumn Value`,
    `\t\tisHidden`,
    `\t\tdataType: int64`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Value]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``
  );

  for (const m of HOST_MEASURES) {
    lines.push(`\tmeasure ${quoteName(m.name)} = ${m.expr}`, `\t\tlineageTag: ${uuid()}`, ``);
  }

  lines.push(
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource = ROW("Value", 1)`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``
  );

  return lines.join('\n');
}

// --------------------------------------------------------------------------- //
// 1. Documentation tables
// --------------------------------------------------------------------------- //

/**
 * Add the documentation tables to the model: the four `INFO.VIEW.*` tables
 * (`_Tables`, `_Columns`, `_DAX Measures`, `_Relationships`), the `_Model
 * Measures` listing, and the `_Doc Measures` host table carrying the icon /
 * title / count measures the documentation page binds to. Tables that already
 * exist are left untouched and reported as skipped, so the action is safe to
 * re-run.
 *
 * `onProgress` receives short status messages for each stage so the UI can show
 * what the (multi-second) operation is currently doing.
 */
export async function addDocumentationTables(
  workspaceId: string,
  datasetId: string,
  onProgress?: (msg: string) => void
): Promise<DocTablesResult> {
  const step = (msg: string) => onProgress?.(msg);
  if (!workspaceId || !datasetId) {
    return { created: [], skipped: [], changed: 0, detail: 'Select a workspace and a semantic model first.' };
  }

  step('Reading the model definition…');
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) {
    return { created: [], skipped: [], changed: 0, detail: 'model.tmdl part not found.' };
  }

  step('Checking which documentation tables already exist…');
  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';

  const tableExists = (name: string): boolean =>
    parts.some(
      (p) => !p.binary && /\/tables\//i.test(p.path) && p.text.split('\n').some((l) => l === `table ${quoteName(name)}` || l === `table ${name}`)
    ) || new RegExp(`^ref table ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm').test(modelPart.text);

  const edits: Record<string, string> = {};
  const created: string[] = [];
  const skipped: string[] = [];
  const modelLines = modelPart.text.split('\n');

  // The four SELECTCOLUMNS doc tables + the `_Model Measures` listing, plus the
  // `_Doc Measures` measure host. Each is created only if it does not yet exist.
  const buildSpecs: { name: string; tmdl: () => string }[] = [
    ...DOC_TABLES.map((spec) => ({ name: spec.name, tmdl: () => buildDocTableTmdl(spec) })),
    { name: MEASURE_HOST_TABLE, tmdl: buildMeasureHostTmdl },
  ];

  for (const spec of buildSpecs) {
    if (tableExists(spec.name)) {
      skipped.push(spec.name);
      continue;
    }
    edits[`${tablesDir}/${sanitizeFileName(spec.name)}.tmdl`] = spec.tmdl();

    let lastRef = -1;
    for (let i = 0; i < modelLines.length; i++) {
      if (/^ref table /.test(modelLines[i])) lastRef = i;
    }
    const refLine = `ref table ${quoteName(spec.name)}`;
    if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, refLine);
    else modelLines.push('', refLine);
    created.push(spec.name);
  }

  if (created.length === 0) {
    return {
      created,
      skipped,
      changed: 0,
      detail: 'All documentation tables already exist — nothing to add.',
    };
  }

  step(`Building TMDL for ${created.length} table(s): ${created.join(', ')}…`);
  edits[modelPart.path] = modelLines.join('\n');
  step(`Writing ${created.length} table(s) to the model (this can take a moment)…`);
  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  step('Finishing up…');

  return {
    created,
    skipped,
    changed,
    detail:
      changed > 0
        ? `Added ${created.length} documentation table(s): ${created.join(', ')}.${
            skipped.length ? ` Skipped ${skipped.length} already present.` : ''
          }`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// 2. Documentation page (bundled PBIR parts merged into the user's report)
// --------------------------------------------------------------------------- //

interface BookmarksMeta {
  items: unknown[];
  [k: string]: unknown;
}

/**
 * Merge the bundled "Documentation" page (8 visuals + 4 bookmarks) into the
 * user's PBIR report. Idempotent — if the page is already present nothing is
 * written. Requires a report stored in PBIR format.
 */
export async function addDocumentationPage(
  workspaceId: string,
  reportId: string
): Promise<DocPageResult> {
  if (!workspaceId || !reportId) {
    return { added: false, detail: 'Select a workspace and a report first.' };
  }

  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const pagesMetaPart = parts.find((p) => !p.binary && /definition\/pages\/pages\.json$/.test(p.path));
  if (!pagesMetaPart) {
    return {
      added: false,
      detail:
        'This report is not in PBIR format. Upgrade it to PBIR first (Report Structure → Upgrade to PBIR), then retry.',
    };
  }

  const pageName = docTemplate.pageName;
  const pagesMeta = JSON.parse(pagesMetaPart.text) as { pageOrder?: string[]; [k: string]: unknown };
  const order = Array.isArray(pagesMeta.pageOrder) ? pagesMeta.pageOrder : [];
  if (order.includes(pageName)) {
    return { added: false, detail: 'A "Documentation" page is already present in this report.' };
  }

  const pagesBase = pagesMetaPart.path.replace(/\/pages\.json$/, ''); // definition/pages
  const bookmarksBase = pagesBase.replace(/\/pages$/, '/bookmarks'); // definition/bookmarks

  const edits: Record<string, string> = {};

  // Page + visuals.
  edits[`${pagesBase}/${pageName}/page.json`] = JSON.stringify(docTemplate.page, null, 2);
  for (const [visualId, visualJson] of Object.entries(docTemplate.visuals)) {
    edits[`${pagesBase}/${pageName}/visuals/${visualId}/visual.json`] = JSON.stringify(visualJson, null, 2);
  }

  // Append the page to the metadata order.
  pagesMeta.pageOrder = [...order, pageName];
  edits[pagesMetaPart.path] = JSON.stringify(pagesMeta, null, 2);

  // Bookmarks — merge the group + write the four bookmark parts.
  const bmMetaPart = parts.find((p) => !p.binary && /definition\/bookmarks\/bookmarks\.json$/.test(p.path));
  let bmMeta: BookmarksMeta;
  if (bmMetaPart) {
    const parsed = JSON.parse(bmMetaPart.text) as Partial<BookmarksMeta>;
    bmMeta = { ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] } as BookmarksMeta;
  } else {
    bmMeta = {
      $schema:
        'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/bookmarksMetadata/1.0.0/schema.json',
      items: [],
    };
  }
  bmMeta.items = [...bmMeta.items, docTemplate.bookmarkGroup];
  edits[`${bookmarksBase}/bookmarks.json`] = JSON.stringify(bmMeta, null, 2);
  for (const [bookmarkName, bookmarkJson] of Object.entries(docTemplate.bookmarks)) {
    edits[`${bookmarksBase}/${bookmarkName}.bookmark.json`] = JSON.stringify(bookmarkJson, null, 2);
  }

  const changed = await saveDefinitionParts('report', workspaceId, reportId, edits);
  const visualCount = Object.keys(docTemplate.visuals).length;
  const bookmarkCount = Object.keys(docTemplate.bookmarks).length;
  return {
    added: changed > 0,
    detail:
      changed > 0
        ? `Added the "Documentation" page (${visualCount} visuals, ${bookmarkCount} bookmarks). Reopen the report to see it.`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// 3. Refresh the documentation tables so they populate
// --------------------------------------------------------------------------- //

/**
 * Trigger a full refresh scoped to the documentation tables that exist, then
 * wait for it to finish. `onProgress` is called as soon as the refresh has been
 * accepted (so the UI can show "started") and the returned detail reflects the
 * final, completed (or failed) status.
 */
export async function refreshDocumentationTables(
  workspaceId: string,
  datasetId: string,
  tables: string[] = DOC_TABLE_NAMES,
  onProgress?: (msg: string) => void
): Promise<DocRefreshResult> {
  if (!workspaceId || !datasetId) {
    return { ok: false, detail: 'Select a workspace and a semantic model first.' };
  }
  if (tables.length === 0) {
    return { ok: false, detail: 'No documentation tables to refresh.' };
  }

  // Capture the current newest refresh so we can tell the new one apart.
  const before = await getRefreshHistory(workspaceId, datasetId, 1);
  const baselineRequestId = before[0]?.requestId;

  const r = await triggerRefresh(
    workspaceId,
    datasetId,
    tables.map((t) => ({ table: t })),
    'full'
  );
  onProgress?.(`${r.detail} Waiting for it to finish…`);

  const result = await waitForLatestRefresh(workspaceId, datasetId, baselineRequestId);
  if (result.timedOut) {
    return {
      ok: false,
      detail: `${r.detail} Still running after the wait window — check Refresh history for the final status.`,
    };
  }
  if (result.ok) {
    return { ok: true, detail: `Refresh of ${tables.length} object(s) completed successfully.` };
  }
  return {
    ok: false,
    detail: `Refresh finished with status "${result.status}". Check Refresh history for details.`,
  };
}

export { DOC_TABLE_NAMES };
