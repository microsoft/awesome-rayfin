// MemoryAnalyzer — cardinality-based VertiPaq footprint analysis.
//
// Loads the model (via DAX INFO.VIEW) plus per-column cardinality
// (COLUMNSTATISTICS), estimates each column's memory footprint and surfaces the
// largest contributors alongside memory findings. The "Attribute hierarchy"
// finding carries a deterministic TMDL auto-fix (set IsAvailableInMdx = false)
// that patches the model definition and writes it back via updateDefinition.
//
// Absolute byte figures are estimates (true VertiPaq sizes need the XMLA DMV
// endpoint, unreachable from this REST-proxy app); the ranking they produce
// tracks the real footprint because distinct count drives VertiPaq memory.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Badge,
  Input,
  Text,
  ToggleButton,
  Tooltip,
  Card,
  Checkbox,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  DataHistogram20Regular,
  Wrench20Regular,
  Search20Regular,
  Info20Regular,
  ChartMultiple20Regular,
  Flash20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import { loadModelData, listSemanticModels } from '@/services/fabricRest';
import {
  loadMemoryData,
  analyzeModelsParallel,
  formatBytes,
  formatNumber,
  type MemoryData,
  type MemoryFinding,
  type MemorySeverity,
  type ModelMemorySummary,
} from '@/services/memoryApi';
import { applyModelBpaFix } from '@/services/modelBpaFix';

export interface MemoryAnalyzerProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const SEVERITIES: MemorySeverity[] = ['High', 'Medium', 'Low'];
const SEVERITY_BADGE: Record<MemorySeverity, 'danger' | 'warning' | 'informative'> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'informative',
};
const TOP_COLUMNS = 25;
const TOP_TABLES = 15;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('8px') },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  grow: { flex: 1 },
  stats: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('12px'),
    flexShrink: 0,
    fontSize: '12px',
    color: GRAY_COLOR,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    ...shorthands.padding('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('14px'),
  },
  cards: { display: 'flex', ...shorthands.gap('10px'), flexWrap: 'wrap' },
  summaryCard: { ...shorthands.padding('12px', '16px'), minWidth: '130px', flex: '1 1 130px' },
  cardLabel: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: GRAY_COLOR },
  cardValue: { fontSize: '20px', fontWeight: '700' },
  section: {
    backgroundColor: '#ffffff',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('10px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    fontWeight: '600',
  },
  finding: {
    display: 'flex',
    alignItems: 'flex-start',
    ...shorthands.gap('10px'),
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', '#f0f0f0'),
  },
  fGrow: { flex: 1, minWidth: 0 },
  ruleName: { fontWeight: '600', fontSize: '13px' },
  objPath: { fontFamily: 'monospace', fontSize: '12px', color: ICON_ACCENT },
  ruleDesc: { fontSize: '12px', color: GRAY_COLOR, marginTop: '2px' },
  sizeTag: { fontFamily: 'monospace', fontSize: '12px', color: GRAY_COLOR, whiteSpace: 'nowrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: {
    textAlign: 'left',
    ...shorthands.padding('6px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    color: GRAY_COLOR,
    fontWeight: '600',
    position: 'sticky',
    top: 0,
    backgroundColor: '#ffffff',
  },
  thNum: {
    textAlign: 'right',
    ...shorthands.padding('6px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    color: GRAY_COLOR,
    fontWeight: '600',
  },
  td: { ...shorthands.padding('5px', '12px'), ...shorthands.borderBottom('1px', 'solid', '#f3f3f3') },
  tdNum: {
    ...shorthands.padding('5px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', '#f3f3f3'),
    textAlign: 'right',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  },
  bar: { height: '6px', borderRadius: '3px', backgroundColor: ICON_ACCENT, minWidth: '2px' },
  barTrack: { backgroundColor: '#eee', borderRadius: '3px', width: '90px' },
  colName: { fontFamily: 'monospace' },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.gap('8px'),
    color: GRAY_COLOR,
    ...shorthands.padding('40px'),
    textAlign: 'center',
  },
  infoPanel: {
    ...shorthands.padding('12px', '14px'),
    fontSize: '12px',
    color: GRAY_COLOR,
    lineHeight: '1.55',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
  },
  infoHeading: { fontWeight: '600', color: '#242424', fontSize: '12px' },
  infoList: { margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  infoCode: { fontFamily: 'monospace', fontSize: '11px', color: ICON_ACCENT },
  disclaimer: {
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderRadius('6px'),
    backgroundColor: '#fff8e6',
    ...shorthands.border('1px', 'solid', '#f0d68a'),
    fontSize: '11.5px',
    color: '#6b5300',
  },
  compareList: {
    display: 'flex',
    flexWrap: 'wrap',
    ...shorthands.gap('4px', '16px'),
    ...shorthands.padding('8px', '12px'),
  },
  muted: { color: GRAY_COLOR, fontSize: '11px', ...shorthands.padding('4px', '12px') },
});

const findingKey = (f: MemoryFinding) => f.id;

export function MemoryAnalyzer({ workspaceId, datasetId, datasetName }: MemoryAnalyzerProps) {
  const styles = useStyles();
  const [data, setData] = useState<MemoryData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<MemorySeverity>>(() => new Set(SEVERITIES));
  const [search, setSearch] = useState('');
  const [fixing, setFixing] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  // Multi-model comparison.
  const [showCompare, setShowCompare] = useState(false);
  const [modelList, setModelList] = useState<{ id: string; name: string }[]>([]);
  const [compareSel, setCompareSel] = useState<Set<string>>(() => new Set());
  const [compareData, setCompareData] = useState<ModelMemorySummary[] | null>(null);
  const [comparing, setComparing] = useState(false);

  const scan = useCallback(async () => {
    if (!workspaceId || !datasetId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const model = await loadModelData(workspaceId, datasetId, datasetName);
      const mem = await loadMemoryData(workspaceId, datasetId, model);
      setData(mem);
      setStatus(
        mem.summary.hasCardinality || mem.summary.hasActualSizes
          ? `${datasetName || 'Model'} · ${mem.findings.length} finding${mem.findings.length === 1 ? '' : 's'} · ${formatBytes(mem.summary.estTotalBytes)} ${mem.summary.hasActualSizes ? 'actual VertiPaq size' : 'estimated'}.`
          : `${datasetName || 'Model'} · cardinality stats unavailable (COLUMNSTATISTICS blocked for this model).`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, datasetId, datasetName]);

  const toggleSev = useCallback((s: MemorySeverity) => {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const fixOne = useCallback(
    async (f: MemoryFinding) => {
      if (!f.fixKind || !workspaceId || !datasetId) return;
      setFixing(findingKey(f));
      setErr(null);
      setStatus(null);
      try {
        const res = await applyModelBpaFix(workspaceId, datasetId, f.fixKind, f.objectPath);
        setStatus(res.detail);
        // Re-scan so the fixed finding drops off and counts refresh.
        const model = await loadModelData(workspaceId, datasetId, datasetName);
        setData(await loadMemoryData(workspaceId, datasetId, model));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setFixing(null);
      }
    },
    [workspaceId, datasetId, datasetName]
  );

  const toggleCompare = useCallback(async () => {
    setShowCompare((v) => !v);
    if (modelList.length === 0 && workspaceId) {
      try {
        const list = await listSemanticModels(workspaceId);
        setModelList(list);
        if (datasetId) setCompareSel(new Set([datasetId]));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }, [modelList.length, workspaceId, datasetId]);

  const toggleCompareSel = useCallback((id: string) => {
    setCompareSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runCompare = useCallback(async () => {
    if (!workspaceId || compareSel.size === 0) return;
    setComparing(true);
    setErr(null);
    try {
      const picks = modelList.filter((m) => compareSel.has(m.id));
      setCompareData(await analyzeModelsParallel(workspaceId, picks));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  }, [workspaceId, compareSel, modelList]);

  const counts = useMemo(() => {
    const c: Record<MemorySeverity, number> = { High: 0, Medium: 0, Low: 0 };
    for (const f of data?.findings ?? []) c[f.severity]++;
    return c;
  }, [data]);

  const fixableCount = useMemo(
    () => (data?.findings ?? []).filter((f) => f.fixKind).length,
    [data]
  );

  const visibleFindings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.findings ?? []).filter(
      (f) =>
        sevFilter.has(f.severity) &&
        (!q ||
          f.title.toLowerCase().includes(q) ||
          f.objectPath.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q))
    );
  }, [data, sevFilter, search]);

  const topColumns = useMemo(() => (data?.columns ?? []).slice(0, TOP_COLUMNS), [data]);
  const maxColBytes = topColumns[0]?.estTotalBytes ?? 0;

  const topTables = useMemo(() => (data?.tables ?? []).slice(0, TOP_TABLES), [data]);
  const maxTableBytes = topTables[0]?.estTotalBytes ?? 0;
  const actual = !!data?.summary.hasActualSizes;
  const hasSizes = !!data && (data.summary.hasCardinality || data.summary.hasActualSizes);
  const anySegments = useMemo(() => (data?.columns ?? []).some((c) => c.segments > 0), [data]);
  const maxCompareBytes = useMemo(
    () => (compareData ?? []).reduce((m, r) => Math.max(m, r.estTotalBytes), 0),
    [compareData]
  );

  if (!workspaceId || !datasetId) {
    return (
      <div className={styles.empty}>
        <DataHistogram20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a semantic model in the connection bar, then analyze memory usage.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <DataHistogram20Regular />}
          disabled={scanning || !!fixing}
          onClick={() => void scan()}
        >
          {data === null ? 'Analyze memory' : 'Re-analyze'}
        </Button>

        {data !== null && data.findings.length > 0 && (
          <>
            {SEVERITIES.map((s) => (
              <ToggleButton key={s} size="small" checked={sevFilter.has(s)} onClick={() => toggleSev(s)}>
                {s} ({counts[s]})
              </ToggleButton>
            ))}
            <Input
              size="small"
              contentBefore={<Search20Regular />}
              placeholder="Filter findings / columns…"
              value={search}
              onChange={(_, d) => setSearch(d.value)}
              style={{ width: 220 }}
            />
          </>
        )}

        <span className={styles.grow} />

        {fixableCount > 0 && (
          <Badge appearance="tint" color="brand" icon={<Wrench20Regular />}>
            {fixableCount} auto-fixable
          </Badge>
        )}
        {status && <span className={styles.stats}>{status}</span>}
        <Tooltip content="Compare the footprint of several models in this workspace" relationship="label">
          <ToggleButton
            size="small"
            icon={<ChartMultiple20Regular />}
            checked={showCompare}
            disabled={scanning || comparing}
            onClick={() => void toggleCompare()}
          >
            Compare
          </ToggleButton>
        </Tooltip>
        <Tooltip content="How the estimates work & disclaimer" relationship="label">
          <ToggleButton
            size="small"
            icon={<Info20Regular />}
            checked={showInfo}
            onClick={() => setShowInfo((v) => !v)}
          >
            Info
          </ToggleButton>
        </Tooltip>
      </div>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        {showCompare && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <ChartMultiple20Regular />
              <span>Compare models</span>
              <Badge appearance="tint" color="informative">
                {compareSel.size} selected
              </Badge>
              <span className={styles.grow} />
              <Button
                size="small"
                appearance="primary"
                icon={comparing ? <Spinner size="tiny" /> : <ChartMultiple20Regular />}
                disabled={comparing || compareSel.size === 0}
                onClick={() => void runCompare()}
              >
                Analyze {compareSel.size} model{compareSel.size === 1 ? '' : 's'}
              </Button>
            </div>
            <div className={styles.compareList}>
              {modelList.length === 0 ? (
                <Text className={styles.muted}>Loading models…</Text>
              ) : (
                modelList.map((m) => (
                  <Checkbox
                    key={m.id}
                    label={m.name}
                    checked={compareSel.has(m.id)}
                    onChange={() => toggleCompareSel(m.id)}
                  />
                ))
              )}
            </div>
            {compareData && (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Model</th>
                      <th className={styles.th}>Mode</th>
                      <th className={styles.thNum}>Tables</th>
                      <th className={styles.thNum}>Columns</th>
                      <th className={styles.thNum}>Rows</th>
                      <th className={styles.thNum}>Size</th>
                      <th className={styles.thNum}>Findings</th>
                      <th className={styles.th}>Largest column</th>
                      <th className={styles.th}>% of max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.map((m) => (
                      <tr key={m.datasetId}>
                        <td className={styles.td}>
                          <span className={styles.colName}>{m.datasetName}</span>
                        </td>
                        {m.error ? (
                          <td className={styles.td} colSpan={8} style={{ color: '#b10e1c' }}>
                            {m.error}
                          </td>
                        ) : (
                          <>
                            <td className={styles.td}>{m.isDirectLake ? 'Direct Lake' : 'Import'}</td>
                            <td className={styles.tdNum}>{formatNumber(m.tableCount)}</td>
                            <td className={styles.tdNum}>{formatNumber(m.columnCount)}</td>
                            <td className={styles.tdNum}>{formatNumber(m.totalRows)}</td>
                            <td className={styles.tdNum}>
                              {formatBytes(m.estTotalBytes)}
                              {m.hasActualSizes ? '' : ' *'}
                            </td>
                            <td className={styles.tdNum}>{formatNumber(m.findingCount)}</td>
                            <td className={styles.td}>
                              <span className={styles.colName}>{m.topColumn}</span>
                            </td>
                            <td className={styles.td}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className={styles.barTrack}>
                                  <div
                                    className={styles.bar}
                                    style={{ width: `${maxCompareBytes > 0 ? Math.max(2, (m.estTotalBytes / maxCompareBytes) * 90) : 2}px` }}
                                  />
                                </div>
                                <span className={styles.sizeTag}>
                                  {maxCompareBytes > 0 ? ((m.estTotalBytes / maxCompareBytes) * 100).toFixed(0) : '0'}%
                                </span>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Text className={styles.muted}>
                  * estimated size — storage stats were unavailable for that model.
                </Text>
              </div>
            )}
          </div>
        )}

        {showInfo && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <Info20Regular />
              <span>How this works &amp; disclaimer</span>
            </div>
            <div className={styles.infoPanel}>
              {actual ? (
                <div className={styles.disclaimer} style={{ backgroundColor: '#eaf6ec', borderColor: '#a9d9b3', color: '#1e5128' }}>
                  Byte figures are <strong>actual VertiPaq sizes</strong> read from{' '}
                  <span className={styles.infoCode}>INFO.STORAGETABLECOLUMNS()</span> and{' '}
                  <span className={styles.infoCode}>INFO.STORAGETABLECOLUMNSEGMENTS()</span> — the engine's own
                  dictionary + segment data, the same numbers a DMV tool reports. Columns not currently resident
                  in memory (e.g. unloaded Direct Lake segments) show as 0.
                </div>
              ) : (
                <div className={styles.disclaimer}>
                  Byte figures are <strong>estimates</strong>. The storage INFO functions returned nothing for
                  this model (no write permission, or a mostly non-resident Direct Lake model), so sizes are
                  derived from cardinality instead. The estimates rank columns the way the real engine does,
                  because distinct count (cardinality) is the dominant driver of VertiPaq memory — but treat the
                  absolute KB/MB values as indicative, not exact.
                </div>
              )}

              <div className={styles.infoHeading}>How the footprint is measured</div>
              {actual ? (
                <ul className={styles.infoList}>
                  <li>
                    <strong>Dictionary</strong> bytes come from{' '}
                    <span className={styles.infoCode}>INFO.STORAGETABLECOLUMNS()[DICTIONARY_SIZE]</span>.
                  </li>
                  <li>
                    <strong>Data segment</strong> bytes are the summed{' '}
                    <span className={styles.infoCode}>USED_SIZE</span> from{' '}
                    <span className={styles.infoCode}>INFO.STORAGETABLECOLUMNSEGMENTS()</span>, joined per column.
                  </li>
                  <li>Per-column total = dictionary + data, summed per table and per model.</li>
                </ul>
              ) : (
                <ul className={styles.infoList}>
                  <li>
                    Per-column cardinality comes from{' '}
                    <span className={styles.infoCode}>EVALUATE COLUMNSTATISTICS()</span>; row counts from{' '}
                    <span className={styles.infoCode}>EVALUATE INFO.VIEW.TABLES()</span>.
                  </li>
                  <li>
                    <strong>Dictionary</strong> ≈ cardinality × per-value width (8 bytes for numbers/dates,
                    2 × max length + 8 for strings).
                  </li>
                  <li>
                    <strong>Data segment</strong> ≈ rows × ⌈log₂(cardinality)⌉ ÷ 8 (value-encoded bit width).
                  </li>
                  <li>Total estimate = dictionary + data segment, summed per table and per model.</li>
                </ul>
              )}

              <div className={styles.infoHeading}>What the findings mean</div>
              <ul className={styles.infoList}>
                <li>
                  <strong>High-cardinality column</strong> — a single column dominates the footprint. Reduce
                  precision, split, or drop it if it isn't needed for analysis.
                </li>
                <li>
                  <strong>Date/time split</strong> — a date column with a time component inflates cardinality.
                  Split it into separate Date and Time columns to collapse distinct values.
                </li>
                <li>
                  <strong>Attribute hierarchy</strong> — a hidden, high-cardinality column keeps an unused
                  attribute hierarchy. <em>Auto-fixable</em>: the <strong>Fix</strong> button sets{' '}
                  <span className={styles.infoCode}>isAvailableInMdx = false</span> in the model TMDL and
                  writes it back, freeing that memory. Reversible by re-enabling the attribute hierarchy.
                </li>
              </ul>
            </div>
          </div>
        )}

        {data === null && !scanning && (
          <div className={styles.empty}>
            <DataHistogram20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
            <Text>
              Click “Analyze memory” to estimate the model's VertiPaq footprint from per-column cardinality.
            </Text>
          </div>
        )}

        {data !== null && (
          <>
            <div className={styles.cards}>
              <Card className={styles.summaryCard}>
                <div className={styles.cardLabel}>Tables</div>
                <div className={styles.cardValue}>{formatNumber(data.summary.tableCount)}</div>
              </Card>
              <Card className={styles.summaryCard}>
                <div className={styles.cardLabel}>Columns</div>
                <div className={styles.cardValue}>{formatNumber(data.summary.columnCount)}</div>
              </Card>
              <Card className={styles.summaryCard}>
                <div className={styles.cardLabel}>Total rows</div>
                <div className={styles.cardValue}>{formatNumber(data.summary.totalRows)}</div>
              </Card>
              <Card className={styles.summaryCard}>
                <div className={styles.cardLabel}>{actual ? 'Actual size' : 'Est. size'}</div>
                <div className={styles.cardValue}>{formatBytes(data.summary.estTotalBytes)}</div>
              </Card>
              {data.summary.totalSegments > 0 && (
                <Card className={styles.summaryCard}>
                  <div className={styles.cardLabel}>Segments</div>
                  <div className={styles.cardValue}>{formatNumber(data.summary.totalSegments)}</div>
                </Card>
              )}
              {data.summary.isDirectLake && (
                <Card className={styles.summaryCard}>
                  <div className={styles.cardLabel}>Resident cols</div>
                  <div className={styles.cardValue}>
                    {formatNumber(data.summary.residentColumns)} / {formatNumber(data.summary.columnCount)}
                  </div>
                </Card>
              )}
            </div>

            {/* Findings */}
            {data.findings.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <Wrench20Regular />
                  <span>Memory findings</span>
                  <Badge appearance="tint" color="informative">
                    {visibleFindings.length}
                  </Badge>
                </div>
                {visibleFindings.length === 0 ? (
                  <div className={styles.empty}>
                    <Text>No findings match the current filters.</Text>
                  </div>
                ) : (
                  visibleFindings.map((f) => {
                    const key = findingKey(f);
                    return (
                      <div key={key} className={styles.finding}>
                        <Badge appearance="filled" color={SEVERITY_BADGE[f.severity]} size="small">
                          {f.severity}
                        </Badge>
                        <div className={styles.fGrow}>
                          <div>
                            <span className={styles.ruleName}>{f.title}</span>{' '}
                            <span className={styles.objPath}>· {f.objectPath}</span>
                          </div>
                          <div className={styles.ruleDesc}>{f.detail}</div>
                        </div>
                        <span className={styles.sizeTag}>{formatBytes(f.estTotalBytes)}</span>
                        {f.fixKind && (
                          <Tooltip content="Patch the model TMDL and write it back" relationship="label">
                            <Button
                              size="small"
                              appearance="secondary"
                              icon={fixing === key ? <Spinner size="tiny" /> : <Wrench20Regular />}
                              disabled={!!fixing || scanning}
                              onClick={() => void fixOne(f)}
                            >
                              Fix
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Largest tables */}
            {hasSizes && topTables.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <DataHistogram20Regular />
                  <span>Largest tables ({actual ? 'actual' : 'estimated'})</span>
                  <Badge appearance="tint" color="informative">
                    {topTables.length}
                  </Badge>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Table</th>
                        <th className={styles.thNum}>Rows</th>
                        <th className={styles.thNum}>Columns</th>
                        <th className={styles.thNum}>{actual ? 'Actual size' : 'Est. size'}</th>
                        <th className={styles.th}>% of model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topTables.map((t) => (
                        <tr key={t.table}>
                          <td className={styles.td}>
                            <span className={styles.colName}>{t.table}</span>
                          </td>
                          <td className={styles.tdNum}>{formatNumber(t.rows)}</td>
                          <td className={styles.tdNum}>{formatNumber(t.columns)}</td>
                          <td className={styles.tdNum}>{formatBytes(t.estTotalBytes)}</td>
                          <td className={styles.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className={styles.barTrack}>
                                <div
                                  className={styles.bar}
                                  style={{ width: `${maxTableBytes > 0 ? Math.max(2, (t.estTotalBytes / maxTableBytes) * 90) : 2}px` }}
                                />
                              </div>
                              <span className={styles.sizeTag}>{t.pctOfModel.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Largest columns */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <DataHistogram20Regular />
                <span>Largest columns ({actual ? 'actual' : 'estimated'})</span>
                <Badge appearance="tint" color="informative">
                  {topColumns.length}
                </Badge>
              </div>
              {!hasSizes ? (
                <div className={styles.empty}>
                  <Text>
                    Cardinality could not be read for this model (COLUMNSTATISTICS is blocked or returned no
                    rows) and the storage INFO functions returned nothing, so per-column memory cannot be
                    shown.
                  </Text>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Column</th>
                        <th className={styles.th}>Type</th>
                        <th className={styles.thNum}>Cardinality</th>
                        {anySegments && <th className={styles.thNum}>Segments</th>}
                        <th className={styles.thNum}>{actual ? 'Actual size' : 'Est. size'}</th>
                        <th className={styles.th}>% of model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topColumns.map((c) => (
                        <tr key={`${c.table}[${c.column}]`}>
                          <td className={styles.td}>
                            <span className={styles.colName}>
                              {c.table}[{c.column}]
                            </span>
                            {data.summary.isDirectLake && c.resident && (
                              <Tooltip content="Resident in memory" relationship="label">
                                <Flash20Regular
                                  style={{ width: 13, height: 13, color: ICON_ACCENT, marginLeft: 4, verticalAlign: 'text-bottom' }}
                                />
                              </Tooltip>
                            )}
                          </td>
                          <td className={styles.td}>{c.dataType}</td>
                          <td className={styles.tdNum}>{formatNumber(c.cardinality)}</td>
                          {anySegments && (
                            <td className={styles.tdNum}>{c.segments > 0 ? formatNumber(c.segments) : '—'}</td>
                          )}
                          <td className={styles.tdNum}>{formatBytes(c.estTotalBytes)}</td>
                          <td className={styles.td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className={styles.barTrack}>
                                <div
                                  className={styles.bar}
                                  style={{ width: `${maxColBytes > 0 ? Math.max(2, (c.estTotalBytes / maxColBytes) * 90) : 2}px` }}
                                />
                              </div>
                              <span className={styles.sizeTag}>{c.pctOfModel.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
