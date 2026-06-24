// IbcsTools — IBCS implementation helpers for the semantic model.
//
// Three building blocks for an IBCS-compliant model:
//   1. Calendar table   — add a marked DAX date table when the model lacks one.
//   2. Previous-year + variance measures — PY, absolute Δ PY and percent Δ% PY
//      for the selected base measures (the variance "error bars").
//   3. IBCS variance visual — guidance on the self-developed Multi-Tier Bar /
//      Column custom visuals that render the integrated variance chart.
//
// Calendar creation and measure generation mutate the live model definition and
// reload afterwards, so the analysis always reflects what was persisted.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Input,
  Switch,
  Checkbox,
  Dropdown,
  Option,
  Text,
  Badge,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  CalendarLtr20Regular,
  ArrowClockwise20Regular,
  Search20Regular,
  DataTrending20Regular,
  ChartMultiple20Regular,
  CheckmarkCircle20Filled,
  ArrowSort20Regular,
  Calculator20Regular,
  TableAdd20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  analyzeModel,
  addCalendarTable,
  generateTimeIntelligence,
  addMeasureTableEmpty,
  addMeasureTables3WithIcons,
  addMeasuresFromColumns,
  type ModelAnalysis,
  type TimeIntelMeasure,
} from '@/services/ibcsModel';
import {
  scanIbcsOrientation,
  applyIbcsOrientation,
  type IbcsScanResult,
} from '@/services/ibcsVisualFix';

export interface IbcsToolsProps {
  workspaceId: string;
  datasetId: string;
  reportId: string;
}

// The two self-developed IBCS custom visuals (github.com/kornalexander/PBI-IBCS-Visuals).
const IBCS_VISUALS = [
  {
    title: 'IBCS Multi-Tier Column',
    guid: 'ibcsMultiTierColumnB84BA14B8B6A4201A7F698B3B38DD148',
    use: 'Time on the category axis (Year / Month / Date) — columns, left→right.',
  },
  {
    title: 'IBCS Multi-Tier Bar',
    guid: 'ibcsMultiTierBarECA4F65BFFB141198B7A6391AFFC946A',
    use: 'Structure on the category axis (region, product, …) — bars, readable labels.',
  },
];

const SEP = '\u0000';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  status: { fontSize: '12px', color: GRAY_COLOR, flexShrink: 0 },
  grow: { flex: 1, minWidth: '180px' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('14px') },
  card: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: '#ffffff',
    ...shorthands.padding('14px', '16px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
  },
  cardHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px') },
  cardTitle: { fontSize: '14px', fontWeight: '700' },
  cardHint: { fontSize: '12px', color: GRAY_COLOR },
  row: { display: 'flex', alignItems: 'flex-end', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  label: { fontSize: '12px', fontWeight: '600', color: '#333' },
  options: { display: 'flex', ...shorthands.gap('18px'), flexWrap: 'wrap' },
  measureList: {
    maxHeight: '260px',
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    backgroundColor: SECTION_BG,
  },
  tableHead: {
    ...shorthands.padding('5px', '12px'),
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: GRAY_COLOR,
    backgroundColor: '#ffffff',
    position: 'sticky',
    top: 0,
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  measureRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('3px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', '#f0f0f0'),
  },
  selectRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  visualRow: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('2px'),
    ...shorthands.padding('8px', '0'),
    ...shorthands.borderBottom('1px', 'solid', '#f0f0f0'),
  },
  guid: { fontFamily: 'monospace', fontSize: '11px', color: GRAY_COLOR, wordBreak: 'break-all' },
  ok: { color: '#107c10' },
});

interface CalResult {
  ok: boolean;
  text: string;
}

export function IbcsTools({ workspaceId, datasetId, reportId }: IbcsToolsProps) {
  const styles = useStyles();
  const [analysis, setAnalysis] = useState<ModelAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calendar.
  const [calName, setCalName] = useState('Calendar');
  const [connect, setConnect] = useState(true);
  const [addingCal, setAddingCal] = useState(false);
  const [calResult, setCalResult] = useState<CalResult | null>(null);

  // Time intelligence.
  const [dateRef, setDateRef] = useState('');
  const [doPY, setDoPY] = useState(true);
  const [doAbs, setDoAbs] = useState(true);
  const [doPct, setDoPct] = useState(true);
  const [folder, setFolder] = useState('Time Intelligence');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<CalResult | null>(null);

  // Measure tables & explicit measures (PKG-7).
  const [richCal, setRichCal] = useState(false);
  const [mtName, setMtName] = useState('Measure');
  const [addingMt, setAddingMt] = useState(false);
  const [adding3Mt, setAdding3Mt] = useState(false);
  const [mtResult, setMtResult] = useState<CalResult | null>(null);
  const [mfcTable, setMfcTable] = useState('');
  const [mfcHide, setMfcHide] = useState(true);
  const [addingMfc, setAddingMfc] = useState(false);
  const [mfcResult, setMfcResult] = useState<CalResult | null>(null);

  const load = useCallback(async () => {
    if (!datasetId) {
      setError('Select a semantic model first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeModel(workspaceId, datasetId);
      setAnalysis(data);
      // Default the date column to a detected calendar table, else first date column.
      const def =
        data.calendarTables[0] != null
          ? `${data.calendarTables[0].table}${SEP}${data.calendarTables[0].dateColumn}`
          : data.dateColumns[0] != null
            ? `${data.dateColumns[0].table}${SEP}${data.dateColumns[0].column}`
            : '';
      setDateRef(def);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, datasetId]);

  const dateOptions = useMemo(() => {
    if (!analysis) return [];
    const seen = new Set<string>();
    const opts: { value: string; label: string; marked: boolean }[] = [];
    for (const c of analysis.calendarTables) {
      const v = `${c.table}${SEP}${c.dateColumn}`;
      if (seen.has(v)) continue;
      seen.add(v);
      opts.push({ value: v, label: `${c.table}[${c.dateColumn}]`, marked: true });
    }
    for (const d of analysis.dateColumns) {
      const v = `${d.table}${SEP}${d.column}`;
      if (seen.has(v)) continue;
      seen.add(v);
      opts.push({ value: v, label: `${d.table}[${d.column}]`, marked: false });
    }
    return opts;
  }, [analysis]);

  const filteredMeasures = useMemo(() => {
    if (!analysis) return [];
    const q = search.trim().toLowerCase();
    const list = q
      ? analysis.measures.filter(
          (m) => m.values.name.toLowerCase().includes(q) || m.table.toLowerCase().includes(q)
        )
      : analysis.measures;
    const map = new Map<string, typeof analysis.measures>();
    for (const m of list) {
      const arr = map.get(m.table) ?? [];
      arr.push(m);
      map.set(m.table, arr);
    }
    return [...map.entries()];
  }, [analysis, search]);

  const filteredKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [, items] of filteredMeasures) for (const m of items) keys.push(`${m.table}${SEP}${m.values.name}`);
    return keys;
  }, [filteredMeasures]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectAll = () => setSelected((s) => new Set([...s, ...filteredKeys]));
  const clearAll = () => setSelected(new Set());

  const runAddCalendar = useCallback(async () => {
    setAddingCal(true);
    setCalResult(null);
    setError(null);
    try {
      const r = await addCalendarTable(workspaceId, datasetId, {
        tableName: calName,
        connect,
        rich: richCal,
      });
      setCalResult({ ok: r.changed > 0 || !r.created, text: r.detail });
      await load();
    } catch (e) {
      setCalResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAddingCal(false);
    }
  }, [workspaceId, datasetId, calName, connect, richCal, load]);

  const runAddMeasureTable = useCallback(async () => {
    setAddingMt(true);
    setMtResult(null);
    setError(null);
    try {
      const r = await addMeasureTableEmpty(workspaceId, datasetId, mtName);
      setMtResult({ ok: r.changed > 0 || r.created.length === 0, text: r.detail });
      await load();
    } catch (e) {
      setMtResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAddingMt(false);
    }
  }, [workspaceId, datasetId, mtName, load]);

  const runAddMeasureTables3 = useCallback(async () => {
    setAdding3Mt(true);
    setMtResult(null);
    setError(null);
    try {
      const r = await addMeasureTables3WithIcons(workspaceId, datasetId);
      setMtResult({ ok: r.changed > 0 || r.created.length === 0, text: r.detail });
      await load();
    } catch (e) {
      setMtResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAdding3Mt(false);
    }
  }, [workspaceId, datasetId, load]);

  const runMeasuresFromColumns = useCallback(async () => {
    if (!mfcTable) return;
    setAddingMfc(true);
    setMfcResult(null);
    setError(null);
    try {
      const r = await addMeasuresFromColumns(workspaceId, datasetId, {
        table: mfcTable,
        hideSources: mfcHide,
      });
      setMfcResult({ ok: r.changed > 0, text: r.detail });
      await load();
    } catch (e) {
      setMfcResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAddingMfc(false);
    }
  }, [workspaceId, datasetId, mfcTable, mfcHide, load]);

  const baseMeasures = useMemo<TimeIntelMeasure[]>(() => {
    if (!analysis) return [];
    const out: TimeIntelMeasure[] = [];
    for (const m of analysis.measures) {
      if (selected.has(`${m.table}${SEP}${m.values.name}`)) {
        out.push({ table: m.table, name: m.values.name, formatString: m.values.formatString });
      }
    }
    return out;
  }, [analysis, selected]);

  const canGenerate =
    !generating && !!dateRef && baseMeasures.length > 0 && (doPY || doAbs || doPct);

  const runGenerate = useCallback(async () => {
    if (!canGenerate) return;
    const [calendarTable, dateColumn] = dateRef.split(SEP);
    setGenerating(true);
    setGenResult(null);
    setError(null);
    try {
      const r = await generateTimeIntelligence(workspaceId, datasetId, {
        calendarTable,
        dateColumn,
        measures: baseMeasures,
        previousYear: doPY,
        varianceAbsolute: doAbs,
        variancePercent: doPct,
        displayFolder: folder,
      });
      setGenResult({ ok: r.created.length > 0, text: r.detail });
      await load();
    } catch (e) {
      setGenResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, dateRef, workspaceId, datasetId, baseMeasures, doPY, doAbs, doPct, folder, load]);

  // IBCS chart orientation (report-side): time → column, structure → bar.
  const [orientBusy, setOrientBusy] = useState<'scan' | 'fix' | null>(null);
  const [orientScan, setOrientScan] = useState<IbcsScanResult | null>(null);
  const [orientResult, setOrientResult] = useState<CalResult | null>(null);

  const runScanOrient = useCallback(async () => {
    if (!reportId) return;
    setOrientBusy('scan');
    setOrientResult(null);
    setError(null);
    try {
      const r = await scanIbcsOrientation(workspaceId, reportId);
      setOrientScan(r);
      setOrientResult({
        ok: true,
        text:
          r.ibcsCount === 0
            ? 'No IBCS Multi-Tier visuals found in this report.'
            : r.needsChange === 0
              ? `${r.ibcsCount} IBCS visual(s) — all already follow the rule.`
              : `${r.needsChange} of ${r.ibcsCount} IBCS visual(s) need re-orientation.`,
      });
    } catch (e) {
      setOrientResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setOrientBusy(null);
    }
  }, [workspaceId, reportId]);

  const runFixOrient = useCallback(async () => {
    if (!reportId) return;
    setOrientBusy('fix');
    setOrientResult(null);
    setError(null);
    try {
      const r = await applyIbcsOrientation(workspaceId, reportId);
      setOrientResult({ ok: r.changed > 0, text: r.detail });
      // Refresh the scan so the table reflects the new orientation.
      const s = await scanIbcsOrientation(workspaceId, reportId);
      setOrientScan(s);
    } catch (e) {
      setOrientResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setOrientBusy(null);
    }
  }, [workspaceId, reportId]);

  const hasCalendar = (analysis?.calendarTables.length ?? 0) > 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
          disabled={loading || !datasetId}
          onClick={load}
        >
          {analysis ? 'Reload' : 'Analyze model'}
        </Button>
        <span className={styles.status}>
          {analysis
            ? `${analysis.tables.length} tables · ${analysis.dateColumns.length} date columns · ${
                hasCalendar ? 'date table ✓' : 'no date table'
              } · ${analysis.measures.length} measures · ${analysis.calcGroups.length} calc groups`
            : 'not analyzed'}
        </span>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {!analysis ? (
        <div className={styles.body}>
          <div className={styles.card}>
            <Text className={styles.cardHint}>
              Analyze the model to add a calendar table, generate previous-year and variance
              measures, and review the IBCS variance visuals.
            </Text>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {/* 1. Calendar table */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <CalendarLtr20Regular style={{ color: ICON_ACCENT }} />
              <span className={styles.cardTitle}>Calendar table</span>
            </div>
            {hasCalendar ? (
              <MessageBar intent="success">
                <MessageBarBody>
                  Date table detected:{' '}
                  {analysis.calendarTables
                    .map((c) => `${c.table}[${c.dateColumn}]${c.marked ? ' (marked)' : ''}`)
                    .join(', ')}
                  . Time intelligence is ready to use below.
                </MessageBarBody>
              </MessageBar>
            ) : (
              <>
                <Text className={styles.cardHint}>
                  No date table found. Add a marked DAX calendar (CALENDARAUTO with Year, Quarter,
                  Month, YearMonth) so SAMEPERIODLASTYEAR works.
                </Text>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label}>Table name</label>
                    <Input value={calName} onChange={(_, d) => setCalName(d.value)} />
                  </div>
                  <Switch
                    checked={connect}
                    label="Relate to fact date columns"
                    onChange={(_, d) => setConnect(d.checked)}
                  />
                  <Switch
                    checked={richCal}
                    label="Rich (20 columns)"
                    onChange={(_, d) => setRichCal(d.checked)}
                  />
                  <Button
                    appearance="primary"
                    icon={addingCal ? <Spinner size="tiny" /> : <CalendarLtr20Regular />}
                    disabled={addingCal || !calName.trim()}
                    onClick={runAddCalendar}
                  >
                    Add Calendar table
                  </Button>
                </div>
              </>
            )}
            {calResult && (
              <MessageBar intent={calResult.ok ? 'success' : 'error'}>
                <MessageBarBody>{calResult.text}</MessageBarBody>
              </MessageBar>
            )}
          </div>

          {/* 2. Previous-year + variance measures */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <DataTrending20Regular style={{ color: ICON_ACCENT }} />
              <span className={styles.cardTitle}>Previous-year &amp; variance measures</span>
            </div>
            <Text className={styles.cardHint}>
              For each selected measure: <b>PY</b> (previous year), <b>Δ PY</b> (absolute variance)
              and <b>Δ% PY</b> (percent variance) — the tiers an IBCS variance chart renders.
            </Text>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Date column</label>
                <Dropdown
                  style={{ minWidth: '220px' }}
                  value={dateOptions.find((o) => o.value === dateRef)?.label ?? ''}
                  selectedOptions={[dateRef]}
                  placeholder="Select a date column"
                  onOptionSelect={(_, d) => setDateRef(d.optionValue ?? '')}
                >
                  {dateOptions.map((o) => (
                    <Option key={o.value} value={o.value} text={o.label}>
                      {o.label}
                      {o.marked ? ' · date table' : ''}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Display folder</label>
                <Input value={folder} onChange={(_, d) => setFolder(d.value)} placeholder="(none)" />
              </div>
            </div>

            <div className={styles.options}>
              <Checkbox checked={doPY} label="Previous year (PY)" onChange={(_, d) => setDoPY(!!d.checked)} />
              <Checkbox checked={doAbs} label="Absolute variance (Δ PY)" onChange={(_, d) => setDoAbs(!!d.checked)} />
              <Checkbox checked={doPct} label="Percent variance (Δ% PY)" onChange={(_, d) => setDoPct(!!d.checked)} />
            </div>

            <div className={styles.selectRow}>
              <Input
                className={styles.grow}
                contentBefore={<Search20Regular />}
                placeholder="Filter measures…"
                value={search}
                onChange={(_, d) => setSearch(d.value)}
              />
              <Button size="small" onClick={selectAll} disabled={filteredKeys.length === 0}>
                Select all
              </Button>
              <Button size="small" onClick={clearAll} disabled={selected.size === 0}>
                Clear ({selected.size})
              </Button>
            </div>

            <div className={styles.measureList}>
              {filteredMeasures.map(([table, items]) => (
                <div key={table}>
                  <div className={styles.tableHead}>{table}</div>
                  {items.map((m) => {
                    const key = `${m.table}${SEP}${m.values.name}`;
                    return (
                      <div key={key} className={styles.measureRow}>
                        <Checkbox checked={selected.has(key)} onChange={() => toggle(key)} />
                        <span style={{ flex: 1, minWidth: 0 }}>{m.values.name}</span>
                        {m.values.isHidden && (
                          <Badge size="small" appearance="tint" color="informative">
                            hidden
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {filteredMeasures.length === 0 && (
                <div style={{ padding: '12px', color: GRAY_COLOR, fontSize: '13px' }}>
                  No measures match the filter.
                </div>
              )}
            </div>

            <div className={styles.selectRow}>
              <Button
                appearance="primary"
                icon={generating ? <Spinner size="tiny" /> : <DataTrending20Regular />}
                disabled={!canGenerate}
                onClick={runGenerate}
              >
                Generate measures ({baseMeasures.length} selected)
              </Button>
              {!dateRef && <span className={styles.cardHint}>Pick a date column first.</span>}
            </div>
            {genResult && (
              <MessageBar intent={genResult.ok ? 'success' : 'warning'}>
                <MessageBarBody>{genResult.text}</MessageBarBody>
              </MessageBar>
            )}
          </div>

          {/* 3. Measure tables & explicit measures (PKG-7) */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <Calculator20Regular style={{ color: ICON_ACCENT }} />
              <span className={styles.cardTitle}>Measure tables &amp; explicit measures</span>
            </div>
            <Text className={styles.cardHint}>
              Add an empty <b>measure container</b> table to keep measures out of fact tables, or
              turn a table's implicit numeric columns into <b>explicit measures</b> (SUM / AVERAGE /
              …) and hide the source columns — the recommended modelling hygiene.
            </Text>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Measure table name</label>
                <Input value={mtName} onChange={(_, d) => setMtName(d.value)} />
              </div>
              <Button
                appearance="primary"
                icon={addingMt ? <Spinner size="tiny" /> : <TableAdd20Regular />}
                disabled={addingMt || adding3Mt || !mtName.trim()}
                onClick={runAddMeasureTable}
              >
                Add measure table
              </Button>
              <Button
                icon={adding3Mt ? <Spinner size="tiny" /> : <TableAdd20Regular />}
                disabled={addingMt || adding3Mt}
                onClick={runAddMeasureTables3}
              >
                Add 3 themed tables
              </Button>
            </div>
            {mtResult && (
              <MessageBar intent={mtResult.ok ? 'success' : 'error'}>
                <MessageBarBody>{mtResult.text}</MessageBarBody>
              </MessageBar>
            )}

            <div style={{ borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: '10px', marginTop: '4px' }} />
            <Text className={styles.cardHint}>
              <b>Explicit measures from columns</b> — for every numeric column with an aggregation
              (summarizeBy), create a <b>Sum of …</b> measure and hide the column.
            </Text>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Table</label>
                <Dropdown
                  style={{ minWidth: '220px' }}
                  value={mfcTable}
                  selectedOptions={mfcTable ? [mfcTable] : []}
                  placeholder="Select a table"
                  onOptionSelect={(_, d) => setMfcTable(d.optionValue ?? '')}
                >
                  {analysis.tables.map((t) => (
                    <Option key={t} value={t} text={t}>
                      {t}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <Switch
                checked={mfcHide}
                label="Hide source columns"
                onChange={(_, d) => setMfcHide(d.checked)}
              />
              <Button
                appearance="primary"
                icon={addingMfc ? <Spinner size="tiny" /> : <Calculator20Regular />}
                disabled={addingMfc || !mfcTable}
                onClick={runMeasuresFromColumns}
              >
                Create measures
              </Button>
            </div>
            {mfcResult && (
              <MessageBar intent={mfcResult.ok ? 'success' : 'warning'}>
                <MessageBarBody>{mfcResult.text}</MessageBarBody>
              </MessageBar>
            )}
          </div>

          {/* 5. IBCS variance visual */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <ChartMultiple20Regular style={{ color: ICON_ACCENT }} />
              <span className={styles.cardTitle}>IBCS variance visual (error bars)</span>
            </div>
            <Text className={styles.cardHint}>
              Plot the generated <b>Δ PY</b> / <b>Δ% PY</b> measures with the self-developed IBCS
              custom visuals for integrated variance bars (AC vs PY, absolute + percent tiers,
              semantic green/red). Bundle the matching visual into the report — time axis uses the
              column variant, structure axis uses the bar variant.
            </Text>
            {IBCS_VISUALS.map((v) => (
              <div key={v.guid} className={styles.visualRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckmarkCircle20Filled className={styles.ok} />
                  <b>{v.title}</b>
                </div>
                <span className={styles.cardHint}>{v.use}</span>
                <span className={styles.guid}>{v.guid}</span>
              </div>
            ))}
            <Link href="https://github.com/kornalexander/PBI-IBCS-Visuals" target="_blank">
              github.com/kornalexander/PBI-IBCS-Visuals
            </Link>

            {/* Actionable orientation fix (report-side PBIR edit). */}
            <div style={{ borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: '10px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className={styles.cardHead}>
                <ArrowSort20Regular style={{ color: ICON_ACCENT }} />
                <span className={styles.cardTitle}>Fix chart orientation</span>
              </div>
              <Text className={styles.cardHint}>
                Enforce the IBCS rule on the selected report: a <b>time</b> category (Year / Month /
                Date) becomes the <b>column</b> variant (time runs horizontally); every other
                category becomes the <b>bar</b> variant (category stacked vertically). Bindings stay
                identical — only the visual type is swapped.
              </Text>
              {!reportId && (
                <MessageBar intent="info">
                  <MessageBarBody>Select a report on the Connection tab to scan and fix visual orientation.</MessageBarBody>
                </MessageBar>
              )}
              <div className={styles.row}>
                <Button
                  icon={orientBusy === 'scan' ? <Spinner size="tiny" /> : <Search20Regular />}
                  disabled={!reportId || orientBusy !== null}
                  onClick={runScanOrient}
                >
                  Scan report
                </Button>
                <Button
                  appearance="primary"
                  icon={orientBusy === 'fix' ? <Spinner size="tiny" /> : <ArrowSort20Regular />}
                  disabled={!reportId || orientBusy !== null || !orientScan || orientScan.needsChange === 0}
                  onClick={runFixOrient}
                >
                  {orientScan && orientScan.needsChange > 0
                    ? `Fix orientation (${orientScan.needsChange})`
                    : 'Fix orientation'}
                </Button>
              </div>
              {orientScan && orientScan.visuals.length > 0 && (
                <div className={styles.measureList}>
                  <div className={styles.tableHead}>IBCS visuals · category → orientation</div>
                  {orientScan.visuals.map((v) => (
                    <div key={`${v.page}:${v.visual}`} className={styles.measureRow}>
                      {v.needsChange ? (
                        <Badge appearance="tint" color="warning">fix</Badge>
                      ) : (
                        <Badge appearance="tint" color="success">ok</Badge>
                      )}
                      <span style={{ flex: 1, fontSize: '12px' }}>
                        <b>{v.category || '(no category)'}</b>
                        <span className={styles.cardHint}>
                          {' '}
                          · {v.current}
                          {v.needsChange ? ` → ${v.recommended}` : ''}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {orientResult && (
                <MessageBar intent={orientResult.ok ? 'success' : 'error'}>
                  <MessageBarBody>{orientResult.text}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
