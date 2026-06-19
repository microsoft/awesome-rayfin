// HistoryTab — read-only view over the stateful fixer history (PKG-18).
//
// Three capabilities, all lazy-loaded on demand (never pre-fetched on the hot
// fix/scan path):
//   • DB-1 Change log — every applied fix, filterable by scope / fixer / result.
//   • DB-2 Undo — a "Revert" action on any entry that captured a pre-fix
//     snapshot, replaying it through the existing surgical patch path.
//   • DB-3 Scan trend — BPA violations-over-time for the connected model.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Badge,
  Spinner,
  Text,
  Input,
  Switch,
  Tooltip,
  MessageBar,
  MessageBarBody,
  TabList,
  Tab,
  makeStyles,
  shorthands,
  type SelectTabEvent,
  type SelectTabData,
} from '@fluentui/react-components';
import {
  History20Regular,
  ArrowUndo20Regular,
  DataTrending20Regular,
  Search20Regular,
  Delete20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG, PANEL_BG } from '@/explorer/theme';
import {
  listFixLog,
  listScans,
  getSnapshotText,
  markReverted,
  clearHistory,
  type FixLogEntry,
  type ScanRecord,
} from '@/services/historyService';
import { revertModelPart } from '@/services/modelBpaFix';

export interface HistoryTabProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

type HistorySub = 'log' | 'trend';

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
    ...shorthands.gap('8px'),
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    ...shorthands.gap('10px'),
    ...shorthands.padding('8px', '12px'),
    backgroundColor: PANEL_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
  },
  rowGrow: { flex: 1, minWidth: 0 },
  title: { fontWeight: '600', fontSize: '13px' },
  meta: { fontSize: '12px', color: GRAY_COLOR, marginTop: '2px' },
  objPath: { fontFamily: 'monospace', fontSize: '12px', color: ICON_ACCENT },
  ts: { fontSize: '11px', color: GRAY_COLOR, whiteSpace: 'nowrap' },
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
  chart: {
    backgroundColor: PANEL_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('12px'),
  },
});

const fmtTs = (ts: number) => new Date(ts).toLocaleString();

function ResultBadge({ result }: { result: 'ok' | 'fail' }) {
  return result === 'ok' ? (
    <Badge appearance="filled" color="success">ok</Badge>
  ) : (
    <Badge appearance="filled" color="danger">fail</Badge>
  );
}

/** Compact inline SVG sparkline of total violations over the scan history. */
function TrendChart({ scans }: { scans: ScanRecord[] }) {
  const W = 640;
  const H = 160;
  const PAD = 24;
  const max = Math.max(1, ...scans.map((s) => s.total));
  const n = scans.length;
  const x = (i: number) => (n <= 1 ? PAD : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  const points = scans.map((s, i) => `${x(i)},${y(s.total)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Violations over time">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={BORDER_COLOR} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={BORDER_COLOR} />
      <text x={PAD - 4} y={y(max) + 4} fontSize="10" textAnchor="end" fill={GRAY_COLOR}>{max}</text>
      <text x={PAD - 4} y={H - PAD + 4} fontSize="10" textAnchor="end" fill={GRAY_COLOR}>0</text>
      {n > 1 && <polyline points={points} fill="none" stroke={ICON_ACCENT} strokeWidth="2" />}
      {scans.map((s, i) => (
        <circle key={s.id} cx={x(i)} cy={y(s.total)} r="3" fill={ICON_ACCENT}>
          <title>{`${fmtTs(s.ts)} · ${s.total} violations (E${s.error}/W${s.warning}/I${s.info})`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function HistoryTab({ datasetId, datasetName }: HistoryTabProps) {
  const styles = useStyles();
  const [sub, setSub] = useState<HistorySub>('log');
  const [fixes, setFixes] = useState<FixLogEntry[] | null>(null);
  const [scans, setScans] = useState<ScanRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [thisModelOnly, setThisModelOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [reverting, setReverting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [f, s] = await Promise.all([listFixLog(), listScans()]);
      setFixes(f);
      setScans(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy-load once when the tab first mounts.
  useEffect(() => {
    void reload();
  }, [reload]);

  const revert = useCallback(
    async (entry: FixLogEntry) => {
      if (!entry.snapshotId) return;
      setReverting(entry.id);
      setErr(null);
      setStatus(null);
      try {
        const resolved = await getSnapshotText(entry.snapshotId);
        if (!resolved) {
          setErr('Snapshot is no longer available (it may have been pruned by the retention policy).');
          return;
        }
        const { snapshot, text } = resolved;
        const changed = await revertModelPart(snapshot.workspaceId, snapshot.itemId, snapshot.partPath, text);
        markReverted(entry.id);
        setStatus(
          changed > 0
            ? `Reverted ${entry.rule || entry.fixer} on ${entry.itemName} (${snapshot.partPath}).`
            : 'Model already matches the snapshot — nothing to revert.'
        );
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setReverting(null);
      }
    },
    [reload]
  );

  const clearAll = useCallback(async () => {
    setErr(null);
    try {
      await clearHistory();
      setStatus('History cleared.');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [reload]);

  const visibleFixes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (fixes ?? []).filter((f) => {
      if (thisModelOnly && f.itemId !== datasetId) return false;
      if (!q) return true;
      return (
        f.itemName.toLowerCase().includes(q) ||
        f.fixer.toLowerCase().includes(q) ||
        (f.rule ?? '').toLowerCase().includes(q) ||
        (f.objectPath ?? '').toLowerCase().includes(q)
      );
    });
  }, [fixes, search, thisModelOnly, datasetId]);

  const visibleScans = useMemo(
    () => (scans ?? []).filter((s) => !thisModelOnly || s.itemId === datasetId),
    [scans, thisModelOnly, datasetId]
  );

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <TabList selectedValue={sub} onTabSelect={(_: SelectTabEvent, d: SelectTabData) => setSub(d.value as HistorySub)}>
          <Tab value="log" icon={<History20Regular />}>Change Log &amp; Undo</Tab>
          <Tab value="trend" icon={<DataTrending20Regular />}>Scan Trend</Tab>
        </TabList>
        <Switch
          label="This model only"
          checked={thisModelOnly}
          onChange={(_, d) => setThisModelOnly(!!d.checked)}
        />
        {sub === 'log' && (
          <Input
            size="small"
            placeholder="Filter…"
            value={search}
            contentBefore={<Search20Regular />}
            onChange={(_, d) => setSearch(d.value)}
            style={{ minWidth: '200px' }}
          />
        )}
        <span className={styles.grow} />
        <Button size="small" appearance="subtle" onClick={() => void reload()} disabled={loading}>
          Refresh
        </Button>
        <Tooltip content="Delete all stored history, snapshots and scans" relationship="label">
          <Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={() => void clearAll()}>
            Clear
          </Button>
        </Tooltip>
      </div>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}
      {status && (
        <MessageBar intent="success">
          <MessageBarBody>{status}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        {loading && <Spinner size="small" label="Loading history…" />}

        {!loading && sub === 'log' && visibleFixes.length === 0 && (
          <div className={styles.empty}>
            <History20Regular style={{ fontSize: '32px' }} />
            <Text>No fixes recorded yet. Apply a Model BPA fix and it will appear here.</Text>
          </div>
        )}

        {!loading && sub === 'log' &&
          visibleFixes.map((f) => (
            <div key={f.id} className={styles.row}>
              <div className={styles.rowGrow}>
                <div className={styles.title}>
                  {f.rule || f.fixer}{' '}
                  <ResultBadge result={f.result} />
                  {f.reverted && (
                    <>
                      {' '}
                      <Badge appearance="tint" color="warning">reverted</Badge>
                    </>
                  )}
                </div>
                {f.objectPath && <div className={styles.objPath}>{f.objectPath}</div>}
                <div className={styles.meta}>
                  {f.itemName} · {f.changed} object{f.changed === 1 ? '' : 's'} touched · {f.user}
                  {f.message ? ` · ${f.message}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <span className={styles.ts}>{fmtTs(f.ts)}</span>
                {f.snapshotId && !f.reverted && f.result === 'ok' && (
                  <Button
                    size="small"
                    appearance="outline"
                    icon={<ArrowUndo20Regular />}
                    disabled={reverting === f.id}
                    onClick={() => void revert(f)}
                  >
                    {reverting === f.id ? 'Reverting…' : 'Revert'}
                  </Button>
                )}
              </div>
            </div>
          ))}

        {!loading && sub === 'trend' && visibleScans.length === 0 && (
          <div className={styles.empty}>
            <DataTrending20Regular style={{ fontSize: '32px' }} />
            <Text>No scans recorded yet. Run a Model BPA scan to start the quality trend.</Text>
          </div>
        )}

        {!loading && sub === 'trend' && visibleScans.length > 0 && (
          <>
            <div className={styles.chart}>
              <Text weight="semibold">
                Violations over time{thisModelOnly ? ` · ${datasetName || 'this model'}` : ''}
              </Text>
              <TrendChart scans={visibleScans} />
            </div>
            {[...visibleScans].reverse().map((s) => (
              <div key={s.id} className={styles.row}>
                <div className={styles.rowGrow}>
                  <div className={styles.title}>{s.itemName}</div>
                  <div className={styles.meta}>
                    Total {s.total} · <span style={{ color: '#c50f1f' }}>E {s.error}</span> ·{' '}
                    <span style={{ color: '#bc4b09' }}>W {s.warning}</span> · I {s.info} · rules {s.ruleSetVersion}
                  </div>
                </div>
                <span className={styles.ts}>{fmtTs(s.ts)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
