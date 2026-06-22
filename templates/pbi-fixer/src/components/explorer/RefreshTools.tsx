// RefreshTools — "Add to Model" tools: tables, M functions, refresh policies and
// calculation groups written straight into the live semantic model.
//
// PKG-9 cards:
//   C4  Last Refresh (LocalNow)  — a one-row table stamped via DateTime.LocalNow().
//   C5  Last Refresh (CET/CEST)  — UTC→Europe/Berlin via a shared DST-aware M fn.
//   C7  Calendar function        — Lars Schreiber's "Kalenderfunktion" shared M fn.
//   C9  Incremental refresh      — scan import tables, attach a basic policy with
//                                  RangeStart/RangeEnd parameters + date filter.
//   CG  Calculation groups       — ready-made Time Intelligence / Units templates.
//
// Each action mutates the live model definition through a single TMDL round-trip.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Input,
  Dropdown,
  Option,
  Text,
  Badge,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Clock20Regular,
  GlobeClock20Regular,
  CalendarLtr20Regular,
  ArrowSync20Regular,
  Search20Regular,
  Table20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR } from '@/explorer/theme';
import {
  addLastRefreshTable,
  addCalendarFunction,
  scanIncrementalRefreshTargets,
  addIncrementalRefresh,
  analyzeModel,
  addCalculationGroup,
  listCalcGroupTemplates,
  type IncrRefreshTarget,
  type RefreshGranularity,
  type ModelAnalysis,
} from '@/services/ibcsModel';

export interface RefreshToolsProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

interface Result {
  ok: boolean;
  text: string;
}

const GRANULARITIES: RefreshGranularity[] = ['day', 'month', 'quarter', 'year'];

const SEP = '\u0000';
const CG_TEMPLATES = listCalcGroupTemplates();

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  status: { fontSize: '12px', color: GRAY_COLOR },
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
  num: { width: '90px' },
  gran: { width: '120px' },
  sel: { minWidth: '200px' },
});

export function RefreshTools({ workspaceId, datasetId, datasetName }: RefreshToolsProps) {
  const styles = useStyles();
  const ready = !!datasetId;

  // C4 — LocalNow.
  const [c4Name, setC4Name] = useState('Last Refresh');
  const [c4Busy, setC4Busy] = useState(false);
  const [c4Result, setC4Result] = useState<Result | null>(null);

  // C5 — CET/CEST.
  const [c5Name, setC5Name] = useState('Last Refresh');
  const [c5Busy, setC5Busy] = useState(false);
  const [c5Result, setC5Result] = useState<Result | null>(null);

  // C7 — Calendar function.
  const [c7Busy, setC7Busy] = useState(false);
  const [c7Result, setC7Result] = useState<Result | null>(null);

  // C9 — Incremental refresh.
  const [scanBusy, setScanBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [targets, setTargets] = useState<IncrRefreshTarget[]>([]);
  const [c9Table, setC9Table] = useState('');
  const [c9Col, setC9Col] = useState('');
  const [storePeriods, setStorePeriods] = useState('5');
  const [storeGran, setStoreGran] = useState<RefreshGranularity>('year');
  const [refreshPeriods, setRefreshPeriods] = useState('10');
  const [refreshGran, setRefreshGran] = useState<RefreshGranularity>('day');
  const [c9Busy, setC9Busy] = useState(false);
  const [c9Result, setC9Result] = useState<Result | null>(null);

  // CG — Calculation groups (Time Intelligence / Units).
  const [analysis, setAnalysis] = useState<ModelAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [dateRef, setDateRef] = useState('');
  const [cgTemplateId, setCgTemplateId] = useState(CG_TEMPLATES[0].id);
  const [cgTableName, setCgTableName] = useState(CG_TEMPLATES[0].name);
  const [addingCg, setAddingCg] = useState(false);
  const [cgResult, setCgResult] = useState<Result | null>(null);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.table === c9Table) ?? null,
    [targets, c9Table]
  );

  const runC4 = useCallback(async () => {
    setC4Busy(true);
    setC4Result(null);
    try {
      const r = await addLastRefreshTable(workspaceId, datasetId, 'localNow', c4Name);
      setC4Result({ ok: r.created || !r.changed, text: r.detail });
    } catch (e) {
      setC4Result({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setC4Busy(false);
    }
  }, [workspaceId, datasetId, c4Name]);

  const runC5 = useCallback(async () => {
    setC5Busy(true);
    setC5Result(null);
    try {
      const r = await addLastRefreshTable(workspaceId, datasetId, 'europeCet', c5Name);
      setC5Result({ ok: r.created || !r.changed, text: r.detail });
    } catch (e) {
      setC5Result({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setC5Busy(false);
    }
  }, [workspaceId, datasetId, c5Name]);

  const runC7 = useCallback(async () => {
    setC7Busy(true);
    setC7Result(null);
    try {
      const r = await addCalendarFunction(workspaceId, datasetId);
      setC7Result({ ok: r.created || !r.changed, text: r.detail });
    } catch (e) {
      setC7Result({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setC7Busy(false);
    }
  }, [workspaceId, datasetId]);

  const runScan = useCallback(async () => {
    setScanBusy(true);
    setC9Result(null);
    try {
      const r = await scanIncrementalRefreshTargets(workspaceId, datasetId);
      setTargets(r.targets);
      setScanned(true);
      const first = r.targets[0];
      setC9Table(first?.table ?? '');
      setC9Col(first?.dateColumns[0] ?? '');
      if (r.targets.length === 0) {
        setC9Result({ ok: true, text: 'No eligible import tables with a date column were found.' });
      }
    } catch (e) {
      setC9Result({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setScanBusy(false);
    }
  }, [workspaceId, datasetId]);

  const canApplyC9 =
    !c9Busy &&
    !!selectedTarget &&
    !selectedTarget.hasPolicy &&
    !!c9Col &&
    Number(storePeriods) > 0 &&
    Number(refreshPeriods) > 0;

  const runC9 = useCallback(async () => {
    if (!canApplyC9) return;
    setC9Busy(true);
    setC9Result(null);
    try {
      const r = await addIncrementalRefresh(workspaceId, datasetId, {
        table: c9Table,
        dateColumn: c9Col,
        storePeriods: Number(storePeriods),
        storeGranularity: storeGran,
        refreshPeriods: Number(refreshPeriods),
        refreshGranularity: refreshGran,
      });
      setC9Result({ ok: r.created, text: r.detail });
      const s = await scanIncrementalRefreshTargets(workspaceId, datasetId);
      setTargets(s.targets);
    } catch (e) {
      setC9Result({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setC9Busy(false);
    }
  }, [canApplyC9, workspaceId, datasetId, c9Table, c9Col, storePeriods, storeGran, refreshPeriods, refreshGran]);

  const loadAnalysis = useCallback(async () => {
    if (!datasetId) return;
    setAnalyzing(true);
    try {
      const data = await analyzeModel(workspaceId, datasetId);
      setAnalysis(data);
      const def =
        data.calendarTables[0] != null
          ? `${data.calendarTables[0].table}${SEP}${data.calendarTables[0].dateColumn}`
          : data.dateColumns[0] != null
            ? `${data.dateColumns[0].table}${SEP}${data.dateColumns[0].column}`
            : '';
      setDateRef(def);
    } catch {
      // Date dropdown stays empty; the card shows a hint to pick a column.
    } finally {
      setAnalyzing(false);
    }
  }, [workspaceId, datasetId]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  const dateOptions = useMemo(() => {
    if (!analysis) return [] as { value: string; label: string; marked: boolean }[];
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

  const cgTemplate = CG_TEMPLATES.find((t) => t.id === cgTemplateId) ?? CG_TEMPLATES[0];

  const onPickTemplate = (id: string) => {
    setCgTemplateId(id);
    const tpl = CG_TEMPLATES.find((t) => t.id === id);
    if (tpl) setCgTableName(tpl.name);
    setCgResult(null);
  };

  const canAddCg =
    ready && !addingCg && !!cgTableName.trim() && (!cgTemplate.needsDate || !!dateRef);

  const runAddCalcGroup = useCallback(async () => {
    if (!canAddCg) return;
    const [calendarTable, dateColumn] = dateRef.split(SEP);
    setAddingCg(true);
    setCgResult(null);
    try {
      const r = await addCalculationGroup(workspaceId, datasetId, {
        templateId: cgTemplate.id,
        tableName: cgTableName,
        calendarTable: cgTemplate.needsDate ? calendarTable : undefined,
        dateColumn: cgTemplate.needsDate ? dateColumn : undefined,
      });
      setCgResult({ ok: r.changed > 0 || !r.created, text: r.detail });
      await loadAnalysis();
    } catch (e) {
      setCgResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAddingCg(false);
    }
  }, [canAddCg, dateRef, workspaceId, datasetId, cgTemplate, cgTableName, loadAnalysis]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <ArrowSync20Regular style={{ color: ICON_ACCENT }} />
        <span className={styles.status}>
          {ready ? `Add-to-model tools · ${datasetName}` : 'Select a semantic model first.'}
        </span>
      </div>

      <div className={styles.body}>
        {/* C4 — Last Refresh (LocalNow) */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Clock20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Last-Refresh table (LocalNow)</span>
          </div>
          <Text className={styles.cardHint}>
            Adds a one-row table stamped with <code>DateTime.LocalNow()</code> plus a{' '}
            <code>Last Refresh Measure</code> for a "Last refreshed …" caption.
          </Text>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Table name</label>
              <Input value={c4Name} onChange={(_, d) => setC4Name(d.value)} />
            </div>
            <Button
              appearance="primary"
              icon={c4Busy ? <Spinner size="tiny" /> : <Clock20Regular />}
              disabled={!ready || c4Busy || !c4Name.trim()}
              onClick={runC4}
            >
              Add Last-Refresh table
            </Button>
          </div>
          {c4Result && (
            <MessageBar intent={c4Result.ok ? 'success' : 'error'}>
              <MessageBarBody>{c4Result.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* C5 — Last Refresh (CET/CEST) */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <GlobeClock20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Last-Refresh table (CET/CEST)</span>
          </div>
          <Text className={styles.cardHint}>
            UTC→Europe/Berlin local time, DST-aware. Also creates a shared{' '}
            <code>UTC to CEST/CET</code> M function used for the conversion.
          </Text>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Table name</label>
              <Input value={c5Name} onChange={(_, d) => setC5Name(d.value)} />
            </div>
            <Button
              appearance="primary"
              icon={c5Busy ? <Spinner size="tiny" /> : <GlobeClock20Regular />}
              disabled={!ready || c5Busy || !c5Name.trim()}
              onClick={runC5}
            >
              Add CET Last-Refresh table
            </Button>
          </div>
          {c5Result && (
            <MessageBar intent={c5Result.ok ? 'success' : 'error'}>
              <MessageBarBody>{c5Result.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* C7 — Calendar function */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <CalendarLtr20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Calendar function (Kalenderfunktion)</span>
          </div>
          <Text className={styles.cardHint}>
            Adds Lars Schreiber's shared <code>Kalenderfunktion</code> M function (ISO weeks, fiscal
            year, day names). Call it from a new query, e.g.{' '}
            <code>= Kalenderfunktion(2020, 6, "de-de", "Jul", "Mo")</code>.
          </Text>
          <div className={styles.row}>
            <Button
              appearance="primary"
              icon={c7Busy ? <Spinner size="tiny" /> : <CalendarLtr20Regular />}
              disabled={!ready || c7Busy}
              onClick={runC7}
            >
              Add Kalenderfunktion
            </Button>
          </div>
          {c7Result && (
            <MessageBar intent={c7Result.ok ? 'success' : 'error'}>
              <MessageBarBody>{c7Result.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* C9 — Incremental refresh */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <ArrowSync20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Incremental refresh policy</span>
          </div>
          <Text className={styles.cardHint}>
            Scans for import-mode (M) tables with a date column, then attaches a basic
            refresh policy: <code>RangeStart</code>/<code>RangeEnd</code> parameters, a date filter
            on the partition, and a rolling-window archive. Not available for Direct Lake tables.
          </Text>
          <div className={styles.row}>
            <Button
              appearance="primary"
              icon={scanBusy ? <Spinner size="tiny" /> : <Search20Regular />}
              disabled={!ready || scanBusy}
              onClick={runScan}
            >
              {scanned ? 'Rescan' : 'Scan import tables'}
            </Button>
            {scanned && (
              <span className={styles.status}>
                {targets.length} eligible table{targets.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {scanned && targets.length > 0 && (
            <>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Table</label>
                  <Dropdown
                    className={styles.sel}
                    selectedOptions={[c9Table]}
                    value={c9Table}
                    onOptionSelect={(_, d) => {
                      const t = targets.find((x) => x.table === d.optionValue);
                      setC9Table(d.optionValue ?? '');
                      setC9Col(t?.dateColumns[0] ?? '');
                    }}
                  >
                    {targets.map((t) => (
                      <Option key={t.table} value={t.table} text={t.table}>
                        {t.table}
                        {t.hasPolicy ? ' (has policy)' : ''}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Date column</label>
                  <Dropdown
                    className={styles.sel}
                    selectedOptions={[c9Col]}
                    value={c9Col}
                    disabled={!selectedTarget}
                    onOptionSelect={(_, d) => setC9Col(d.optionValue ?? '')}
                  >
                    {(selectedTarget?.dateColumns ?? []).map((c) => (
                      <Option key={c} value={c} text={c}>
                        {c}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Store rows in the last</label>
                  <Input
                    className={styles.num}
                    type="number"
                    value={storePeriods}
                    onChange={(_, d) => setStorePeriods(d.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>&nbsp;</label>
                  <Dropdown
                    className={styles.gran}
                    selectedOptions={[storeGran]}
                    value={storeGran}
                    onOptionSelect={(_, d) => setStoreGran((d.optionValue as RefreshGranularity) ?? 'year')}
                  >
                    {GRANULARITIES.map((g) => (
                      <Option key={g} value={g} text={g}>
                        {g}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Refresh rows in the last</label>
                  <Input
                    className={styles.num}
                    type="number"
                    value={refreshPeriods}
                    onChange={(_, d) => setRefreshPeriods(d.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>&nbsp;</label>
                  <Dropdown
                    className={styles.gran}
                    selectedOptions={[refreshGran]}
                    value={refreshGran}
                    onOptionSelect={(_, d) => setRefreshGran((d.optionValue as RefreshGranularity) ?? 'day')}
                  >
                    {GRANULARITIES.map((g) => (
                      <Option key={g} value={g} text={g}>
                        {g}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
                <Button
                  appearance="primary"
                  icon={c9Busy ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
                  disabled={!canApplyC9}
                  onClick={runC9}
                >
                  Apply policy
                </Button>
              </div>
              {selectedTarget?.hasPolicy && (
                <Badge appearance="tint" color="warning">
                  "{c9Table}" already has a refresh policy.
                </Badge>
              )}
            </>
          )}

          {c9Result && (
            <MessageBar intent={c9Result.ok ? 'success' : 'error'}>
              <MessageBarBody>{c9Result.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>

        {/* CG — Calculation groups */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Table20Regular style={{ color: ICON_ACCENT }} />
            <span className={styles.cardTitle}>Calculation group templates</span>
          </div>
          <Text className={styles.cardHint}>
            Adds a ready-made calculation group that switches every measure at once — no
            per-measure copies. <b>Time Intelligence</b> (Current, MTD, QTD, YTD, PY, YoY, YoY %)
            needs a date column; <b>Units</b> (units / thousands / millions / billions) works on
            any measure.
          </Text>
          {analysis && analysis.calcGroups.length > 0 && (
            <Text className={styles.cardHint}>Existing: {analysis.calcGroups.join(', ')}</Text>
          )}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Template</label>
              <Dropdown
                style={{ minWidth: '220px' }}
                value={cgTemplate.name + (cgTemplate.needsDate ? ' · time intelligence' : ' · scaling')}
                selectedOptions={[cgTemplate.id]}
                onOptionSelect={(_, d) => onPickTemplate(d.optionValue ?? cgTemplate.id)}
              >
                {CG_TEMPLATES.map((t) => (
                  <Option key={t.id} value={t.id} text={t.name}>
                    {t.name} · {t.items.length} items
                  </Option>
                ))}
              </Dropdown>
            </div>
            {cgTemplate.needsDate && (
              <div className={styles.field}>
                <label className={styles.label}>Date column</label>
                <Dropdown
                  className={styles.sel}
                  disabled={dateOptions.length === 0}
                  placeholder={analyzing ? 'Analysing…' : 'Select a date column'}
                  value={dateOptions.find((o) => o.value === dateRef)?.label ?? ''}
                  selectedOptions={[dateRef]}
                  onOptionSelect={(_, d) => setDateRef(d.optionValue ?? '')}
                >
                  {dateOptions.map((o) => (
                    <Option key={o.value} value={o.value} text={o.label}>
                      {o.label}{o.marked ? ' · marked' : ''}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            )}
            <div className={styles.field}>
              <label className={styles.label}>Table name</label>
              <Input value={cgTableName} onChange={(_, d) => setCgTableName(d.value)} />
            </div>
            <Button
              appearance="primary"
              icon={addingCg ? <Spinner size="tiny" /> : <Table20Regular />}
              disabled={!canAddCg}
              onClick={runAddCalcGroup}
            >
              Add calculation group
            </Button>
          </div>
          <Text className={styles.cardHint}>{cgTemplate.description}</Text>
          {cgTemplate.needsDate && !dateRef && (
            <span className={styles.cardHint}>Pick a date column first.</span>
          )}
          {cgResult && (
            <MessageBar intent={cgResult.ok ? 'success' : 'warning'}>
              <MessageBarBody>{cgResult.text}</MessageBarBody>
            </MessageBar>
          )}
        </div>
      </div>
    </div>
  );
}

export default RefreshTools;
