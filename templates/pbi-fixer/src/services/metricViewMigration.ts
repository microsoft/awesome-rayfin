// metricViewMigration — turn a Databricks Unity Catalog *metric view*
// definition (YAML) into a Power BI Direct Lake semantic-model table (TMDL):
// dimensions become columns, measures become DAX measures (the SQL aggregate
// expressions are translated to their DAX equivalents), and a directLake
// partition is stamped from the metric view's `source` three-part name.
//
// Pure client-side: paste the YAML, get a downloadable .tmdl + a preview of the
// generated columns / measures. No new dependency — a small line parser handles
// the fixed metric-view shape (top-level scalars + dimensions/measures lists).

export interface MetricItem {
  name: string;
  expr: string;
}

export interface MetricView {
  version?: string;
  source: string;
  filter?: string;
  dimensions: MetricItem[];
  measures: MetricItem[];
}

export interface GeneratedColumn {
  name: string;
  sourceColumn: string;
  dataType: 'string' | 'dateTime' | 'double' | 'int64';
  hidden: boolean;
}

export interface GeneratedMeasure {
  name: string;
  dax: string;
}

export interface MigrationResult {
  tableName: string;
  schemaName?: string;
  entityName: string;
  columns: GeneratedColumn[];
  measures: GeneratedMeasure[];
  tmdl: string;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* YAML parsing (narrow, metric-view-shaped)                          */
/* ------------------------------------------------------------------ */

/** Strip surrounding quotes from a scalar value. */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parse a Databricks metric-view YAML. Supports the documented shape:
 *   version: 0.1
 *   source: catalog.schema.table        (or quoted)
 *   filter: <sql predicate>             (optional)
 *   dimensions:
 *     - name: <name>
 *       expr: <sql>
 *   measures:
 *     - name: <name>
 *       expr: <sql aggregate>
 */
export function parseMetricView(yamlText: string): MetricView {
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  const view: MetricView = { source: '', dimensions: [], measures: [] };
  let section: 'dimensions' | 'measures' | null = null;
  let current: MetricItem | null = null;

  const flush = () => {
    if (current && section) {
      if (current.name || current.expr) view[section].push(current);
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    // Top-level keys (indent 0).
    if (indent === 0) {
      flush();
      section = null;
      const m = content.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2];
      if (key === 'version') view.version = unquote(val);
      else if (key === 'source') view.source = unquote(val);
      else if (key === 'filter') view.filter = unquote(val);
      else if (key === 'dimensions') section = 'dimensions';
      else if (key === 'measures') section = 'measures';
      continue;
    }

    if (!section) continue;

    // New list item: "- name: ..." or "-".
    if (content.startsWith('-')) {
      flush();
      current = { name: '', expr: '' };
      const after = content.replace(/^-\s*/, '');
      if (after) {
        const m = after.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
        if (m) applyItemKey(current, m[1], m[2]);
      }
      continue;
    }

    // Continuation key under the current item: "name: ..." / "expr: ...".
    if (current) {
      const m = content.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
      if (m) applyItemKey(current, m[1], m[2]);
    }
  }
  flush();

  return view;
}

function applyItemKey(item: MetricItem, key: string, value: string): void {
  const k = key.toLowerCase();
  if (k === 'name') item.name = unquote(value);
  else if (k === 'expr' || k === 'expression') item.expr = unquote(value);
}

/* ------------------------------------------------------------------ */
/* SQL aggregate → DAX translation                                    */
/* ------------------------------------------------------------------ */

const SIMPLE_IDENT = /^[A-Za-z_][\w]*$/;

/** Quote a column reference against the target table. */
function colRef(table: string, col: string): string {
  return `'${table}'[${col.trim()}]`;
}

/** Replace bare identifiers in an inner SQL expression with column refs. */
function refColumns(table: string, expr: string): string {
  return expr.replace(/\b([A-Za-z_][\w]*)\b(?!\s*\()/g, (m) => {
    // Leave SQL keywords / numeric literals alone.
    if (/^(AND|OR|NOT|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END|AS)$/i.test(m)) return m;
    return colRef(table, m);
  });
}

/**
 * Translate a single SQL aggregate call to DAX. Returns null unless `expr` is
 * exactly one aggregate call spanning the whole expression (balanced parens,
 * nothing trailing) — so ratios like `SUM(a) / SUM(b)` fall through to the
 * caller's DIVIDE handling instead of being mis-parsed.
 */
function translateAggregate(table: string, expr: string): string | null {
  const trimmed = expr.trim();
  const head = trimmed.match(/^(SUM|AVG|AVERAGE|COUNT|MIN|MAX)\s*\(/i);
  if (!head) return null;
  const fn = head[1].toUpperCase();
  const open = head[0].length - 1; // index of the '('
  let depth = 0;
  let close = -1;
  for (let i = open; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++;
    else if (trimmed[i] === ')') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;
  if (trimmed.slice(close + 1).trim() !== '') return null; // trailing content → not a single call

  let inner = trimmed.slice(open + 1, close).trim();
  let distinct = false;
  const dm = inner.match(/^DISTINCT\s+([\s\S]+)$/i);
  if (dm) {
    distinct = true;
    inner = dm[1].trim();
  }

  if (inner === '*') {
    return distinct ? null : `COUNTROWS('${table}')`;
  }

  const simple = SIMPLE_IDENT.test(inner);

  if (fn === 'COUNT') {
    if (distinct) return simple ? `DISTINCTCOUNT(${colRef(table, inner)})` : `COUNTX('${table}', ${refColumns(table, inner)})`;
    return simple ? `COUNT(${colRef(table, inner)})` : `COUNTX('${table}', ${refColumns(table, inner)})`;
  }

  if (simple) {
    switch (fn) {
      case 'SUM':
        return `SUM(${colRef(table, inner)})`;
      case 'AVG':
      case 'AVERAGE':
        return `AVERAGE(${colRef(table, inner)})`;
      case 'MIN':
        return `MIN(${colRef(table, inner)})`;
      case 'MAX':
        return `MAX(${colRef(table, inner)})`;
    }
  }

  // Complex inner expression → iterator (…X) variant.
  const innerDax = refColumns(table, inner);
  switch (fn) {
    case 'SUM':
      return `SUMX('${table}', ${innerDax})`;
    case 'AVG':
    case 'AVERAGE':
      return `AVERAGEX('${table}', ${innerDax})`;
    case 'MIN':
      return `MINX('${table}', ${innerDax})`;
    case 'MAX':
      return `MAXX('${table}', ${innerDax})`;
  }
  return null;
}

/**
 * Translate a metric-view measure expression to DAX. Handles a single aggregate
 * and the common ratio shape `AGG(a) / AGG(b)` (→ DIVIDE). Anything else falls
 * back to a best-effort replacement and is flagged for review.
 */
export function measureExprToDax(table: string, expr: string): { dax: string; warning?: string } {
  const single = translateAggregate(table, expr);
  if (single) return { dax: single };

  // Ratio: AGG(...) / AGG(...).
  const ratio = splitTopLevelDivide(expr);
  if (ratio) {
    const num = translateAggregate(table, ratio[0]);
    const den = translateAggregate(table, ratio[1]);
    if (num && den) return { dax: `DIVIDE(${num}, ${den})` };
  }

  // Fallback: replace every recognized aggregate call inline, ref the rest.
  let replaced = expr;
  replaced = replaced.replace(/(SUM|AVG|AVERAGE|COUNT|MIN|MAX)\s*\(\s*(DISTINCT\s+)?([^()]+?)\s*\)/gi, (full) => {
    const t = translateAggregate(table, full);
    return t ?? full;
  });
  return {
    dax: replaced,
    warning: `Measure expression "${expr}" was auto-translated — review the generated DAX.`,
  };
}

/** Split `a / b` only on a top-level (un-parenthesized) division. */
function splitTopLevelDivide(expr: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '/' && depth === 0) {
      return [expr.slice(0, i).trim(), expr.slice(i + 1).trim()];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Column inference + TMDL generation                                 */
/* ------------------------------------------------------------------ */

/** Guess a TMDL dataType from a column name. */
function guessDataType(name: string, isMeasureSource: boolean): GeneratedColumn['dataType'] {
  const n = name.toLowerCase();
  if (/(date|time|_at|_ts|timestamp)/.test(n)) return 'dateTime';
  if (isMeasureSource || /(amount|amt|price|fare|cost|total|sum|qty|quantity|count|rate|distance|value)/.test(n)) {
    return /(count|qty|quantity|id|year|month|day)$/.test(n) ? 'int64' : 'double';
  }
  return 'string';
}

/** Collect the bare source columns referenced by a SQL expression. */
function extractColumns(expr: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Za-z_][\w]*)\b(?!\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    const id = m[1];
    if (/^(SUM|AVG|AVERAGE|COUNT|MIN|MAX|DISTINCT|AND|OR|NOT|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END|AS)$/i.test(id)) continue;
    if (/^\d/.test(id)) continue;
    out.push(id);
  }
  return out;
}

/** Build the Direct Lake TMDL + a structured preview from a metric view. */
export function migrateMetricView(view: MetricView, tableNameOverride?: string): MigrationResult {
  const warnings: string[] = [];
  const parts = view.source.split('.').map((s) => s.replace(/`/g, '').trim()).filter(Boolean);
  const entityName = parts[parts.length - 1] || 'MetricView';
  const schemaName = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const tableName = (tableNameOverride && tableNameOverride.trim()) || entityName;

  if (!view.source) warnings.push('No `source` found in the metric view — set the Direct Lake entity manually.');
  if (view.dimensions.length === 0 && view.measures.length === 0) {
    warnings.push('No dimensions or measures parsed — check the YAML indentation.');
  }

  // Dimension columns (visible).
  const seen = new Set<string>();
  const columns: GeneratedColumn[] = [];
  for (const d of view.dimensions) {
    const src = SIMPLE_IDENT.test(d.expr.trim()) ? d.expr.trim() : d.name;
    const dt = guessDataType(src, false);
    if (!seen.has(d.name.toLowerCase())) {
      columns.push({ name: d.name, sourceColumn: src, dataType: dt, hidden: false });
      seen.add(d.name.toLowerCase());
      seen.add(src.toLowerCase());
    }
    if (!SIMPLE_IDENT.test(d.expr.trim())) {
      warnings.push(`Dimension "${d.name}" has a derived expression (${d.expr}); mapped to a plain column "${src}" — add a calculated column if needed.`);
    }
  }

  // Base measure-source columns (hidden) so the DAX resolves.
  for (const me of view.measures) {
    for (const col of extractColumns(me.expr)) {
      if (!seen.has(col.toLowerCase())) {
        columns.push({ name: col, sourceColumn: col, dataType: guessDataType(col, true), hidden: true });
        seen.add(col.toLowerCase());
      }
    }
  }

  // Measures → DAX.
  const measures: GeneratedMeasure[] = view.measures.map((me) => {
    const { dax, warning } = measureExprToDax(tableName, me.expr);
    if (warning) warnings.push(warning);
    return { name: me.name, dax };
  });

  const tmdl = buildTmdl({ tableName, schemaName, entityName, columns, measures, filter: view.filter });

  return { tableName, schemaName, entityName, columns, measures, tmdl, warnings };
}

function tmdlName(name: string): string {
  // Quote object names that are not simple identifiers.
  return SIMPLE_IDENT.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

function buildTmdl(opts: {
  tableName: string;
  schemaName?: string;
  entityName: string;
  columns: GeneratedColumn[];
  measures: GeneratedMeasure[];
  filter?: string;
}): string {
  const { tableName, schemaName, entityName, columns, measures, filter } = opts;
  const lines: string[] = [];
  lines.push(`table ${tmdlName(tableName)}`);
  lines.push('');

  for (const c of columns) {
    lines.push(`\tcolumn ${tmdlName(c.name)}`);
    lines.push(`\t\tdataType: ${c.dataType}`);
    if (c.hidden) lines.push('\t\tisHidden');
    lines.push(`\t\tsourceColumn: ${c.sourceColumn}`);
    lines.push('');
  }

  for (const m of measures) {
    lines.push(`\tmeasure ${tmdlName(m.name)} = ${m.dax}`);
    lines.push('');
  }

  if (filter) {
    lines.push(`\t/// Source filter from the metric view (apply as a model filter or partition predicate): ${filter}`);
    lines.push('');
  }

  lines.push(`\tpartition ${tmdlName(tableName)} = entity`);
  lines.push('\t\tmode: directLake');
  lines.push('\t\tsource');
  lines.push(`\t\t\tentityName: ${entityName}`);
  if (schemaName) lines.push(`\t\t\tschemaName: ${schemaName}`);
  lines.push('\t\t\texpressionSource: DatabricksDirectLakeSource');
  lines.push('');
  lines.push('/// NOTE: point the Direct Lake partition\'s expressionSource at the target');
  lines.push('/// Lakehouse / SQL endpoint that mirrors this Databricks table.');

  return lines.join('\n');
}

/** Trigger a browser download of text content. */
export function downloadTmdl(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SAMPLE_METRIC_VIEW = `version: 0.1
source: samples.nyctaxi.trips
filter: trip_distance > 0
dimensions:
  - name: Pickup Zip
    expr: pickup_zip
  - name: Dropoff Zip
    expr: dropoff_zip
  - name: Trip Date
    expr: tpep_pickup_datetime
measures:
  - name: Total Fare
    expr: SUM(fare_amount)
  - name: Trip Count
    expr: COUNT(*)
  - name: Avg Distance
    expr: AVG(trip_distance)
  - name: Distinct Pickup Zips
    expr: COUNT(DISTINCT pickup_zip)
  - name: Fare Per Mile
    expr: SUM(fare_amount) / SUM(trip_distance)
`;
