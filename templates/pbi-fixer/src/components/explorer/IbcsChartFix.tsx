// IbcsChartFix — apply IBCS minimalist styling to native bar / column / line
// charts, and (optionally) re-orient them to match their category axis.
//
// PKG-4 / A1 (bar), A2 (column), A3 (line). Report-side companion to the IBCS
// Multi-Tier custom-visual orientation fix in the IBCS sub-tab. Preview-then-
// apply, like the model Display Folders / Unused Cleanup tools — the change is
// non-destructive (formatting + chart type only) so there is no allow-gate, but
// the plan is shown before anything is written.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Switch,
  Text,
  Badge,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  ChartMultiple20Regular,
  ArrowSort20Regular,
  Info20Regular,
  DataTrending20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanChartFixes,
  applyChartFixes,
  DEFAULT_CHART_FIX_OPTIONS,
  type ChartScanResult,
  type ChartFixInfo,
  scanVarianceFixes,
  applyVarianceFixes,
  type VarianceScanResult,
} from '@/services/ibcsChartFix';

export interface IbcsChartFixProps {
  workspaceId: string;
  reportId: string;
  reportName?: string;
}

interface PageGroup {
  page: string;
  visuals: ChartFixInfo[];
}

const FAMILY_LABEL: Record<string, string> = {
  bar: 'bar',
  column: 'column',
  line: 'line',
};

function groupByPage(visuals: ChartFixInfo[]): PageGroup[] {
  const byPage = new Map<string, ChartFixInfo[]>();
  for (const v of visuals) {
    const list = byPage.get(v.page) ?? [];
    list.push(v);
    byPage.set(v.page, list);
  }
  return [...byPage.entries()]
    .map(([page, vs]) => ({ page, visuals: vs }))
    .sort((a, b) => a.page.localeCompare(b.page));
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('12px'), flexWrap: 'wrap', flexShrink: 0 },
  grow: { flex: 1 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('12px') },
  group: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    overflow: 'hidden',
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    fontWeight: '600',
  },
  visRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
    fontSize: '12px',
  },
  visName: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    color: GRAY_COLOR,
    minWidth: '180px',
    flexShrink: 0,
  },
  cat: { color: GRAY_COLOR, fontSize: '11px' },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.gap('10px'),
    ...shorthands.padding('40px'),
    textAlign: 'center',
  },
});

export function IbcsChartFix({ workspaceId, reportId, reportName }: IbcsChartFixProps) {
  const styles = useStyles();
  const [scan, setScan] = useState<ChartScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [bar, setBar] = useState(true);
  const [column, setColumn] = useState(true);
  const [line, setLine] = useState(true);
  const [reorient, setReorient] = useState(true);

  // A4 — IBCS integrated-variance styling (separate scan/apply).
  const [varScan, setVarScan] = useState<VarianceScanResult | null>(null);
  const [varBusy, setVarBusy] = useState(false);
  const [varStatus, setVarStatus] = useState<string | null>(null);
  const [varErr, setVarErr] = useState<string | null>(null);

  const options = useMemo(
    () => ({ ...DEFAULT_CHART_FIX_OPTIONS, bar, column, line, reorient }),
    [bar, column, line, reorient]
  );

  const runScan = useCallback(async () => {
    if (!workspaceId || !reportId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const result = await scanChartFixes(workspaceId, reportId, options);
      setScan(result);
      setStatus(
        `${reportName || 'Report'} · ${result.total} native chart${result.total === 1 ? '' : 's'} · ` +
          `${result.needsFormat} need styling, ${result.needsReorient} need re-orientation.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, reportId, reportName, options]);

  const runApply = useCallback(async () => {
    if (!scan) return;
    setApplying(true);
    setErr(null);
    setStatus(null);
    try {
      const res = await applyChartFixes(workspaceId, reportId, options);
      setStatus(res.detail);
      // Re-scan so fixed visuals drop off the list.
      const result = await scanChartFixes(workspaceId, reportId, options);
      setScan(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [scan, workspaceId, reportId, options]);

  const runVarScan = useCallback(async () => {
    if (!workspaceId || !reportId) return;
    setVarBusy(true);
    setVarErr(null);
    setVarStatus(null);
    try {
      const result = await scanVarianceFixes(workspaceId, reportId);
      setVarScan(result);
      const n = result.candidates.length;
      setVarStatus(
        `${n} bar/column chart${n === 1 ? '' : 's'} with a single actuals measure` +
          (result.ambiguous > 0 ? ` · ${result.ambiguous} skipped (multiple measures).` : '.')
      );
    } catch (e) {
      setVarErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVarBusy(false);
    }
  }, [workspaceId, reportId]);

  const runVarApply = useCallback(async () => {
    if (!varScan) return;
    setVarBusy(true);
    setVarErr(null);
    setVarStatus(null);
    try {
      const res = await applyVarianceFixes(workspaceId, reportId);
      setVarStatus(res.detail);
      const result = await scanVarianceFixes(workspaceId, reportId);
      setVarScan(result);
    } catch (e) {
      setVarErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVarBusy(false);
    }
  }, [varScan, workspaceId, reportId]);

  const actionable = useMemo(
    () => (scan?.visuals ?? []).filter((v) => v.needsFormat || v.reorientTo),
    [scan]
  );
  const groups = useMemo(() => groupByPage(actionable), [actionable]);

  if (!workspaceId || !reportId) {
    return (
      <div className={styles.empty}>
        <ChartMultiple20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a report in the connection bar, then scan to preview IBCS chart fixes.</Text>
      </div>
    );
  }

  const busy = scanning || applying;
  const nothingToDo = scan !== null && actionable.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <ChartMultiple20Regular />}
          disabled={busy}
          onClick={() => void runScan()}
        >
          {scan === null ? 'Preview chart fixes' : 'Re-scan'}
        </Button>
        <Switch label="Bar" checked={bar} disabled={busy} onChange={(_, d) => setBar(!!d.checked)} />
        <Switch label="Column" checked={column} disabled={busy} onChange={(_, d) => setColumn(!!d.checked)} />
        <Switch label="Line" checked={line} disabled={busy} onChange={(_, d) => setLine(!!d.checked)} />
        <Switch label="Re-orient" checked={reorient} disabled={busy} onChange={(_, d) => setReorient(!!d.checked)} />
        <span className={styles.grow} />
        {status && <span className={styles.status}>{status}</span>}
      </div>

      {err && (
        <div className={styles.group}>
          <div className={styles.groupHead} style={{ color: '#b10e1c' }}>
            {err}
          </div>
        </div>
      )}

      <div className={styles.body}>
        {scan === null && !scanning && (
          <div className={styles.empty}>
            <ChartMultiple20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
            <Text>
              Click “Preview chart fixes” to see which native bar / column / line charts would be
              IBCS-styled (hide axis titles &amp; value axis, drop gridlines, show data labels) and
              re-oriented to match their category axis (time → columns, structure → bars). Nothing is
              written until you apply.
            </Text>
          </div>
        )}

        {nothingToDo && (
          <div className={styles.empty}>
            <Info20Regular style={{ width: 32, height: 32, color: '#107c10' }} />
            <Text>All native charts already follow the IBCS style (or none were found).</Text>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.page} className={styles.group}>
            <div className={styles.groupHead}>
              <span>{g.page}</span>
              <Badge appearance="tint" color="informative">
                {g.visuals.length} chart{g.visuals.length === 1 ? '' : 's'}
              </Badge>
            </div>
            {g.visuals.map((v) => (
              <div key={v.visual} className={styles.visRow}>
                <span className={styles.visName}>{v.visual}</span>
                <Badge appearance="outline" color="brand">
                  {FAMILY_LABEL[v.family]}
                </Badge>
                {v.reorientTo && (
                  <Badge appearance="tint" color="warning" icon={<ArrowSort20Regular />}>
                    → {FAMILY_LABEL[v.reorientTo]}
                  </Badge>
                )}
                {v.needsFormat && (
                  <Badge appearance="tint" color="informative">
                    IBCS style
                  </Badge>
                )}
                {v.category && <span className={styles.cat}>axis: {v.category}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {scan !== null && !nothingToDo && (
        <div className={styles.toolbar}>
          <span className={styles.grow} />
          <Button
            appearance="primary"
            icon={applying ? <Spinner size="tiny" /> : <ArrowSort20Regular />}
            disabled={busy || actionable.length === 0}
            onClick={() => void runApply()}
          >
            Apply to {actionable.length} chart{actionable.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      <div className={styles.group}>
        <div className={styles.groupHead}>
          <DataTrending20Regular />
          <span>IBCS variance styling</span>
          <Badge appearance="tint" color="informative">
            error bars
          </Badge>
          <span className={styles.grow} />
          {varStatus && <span className={styles.status}>{varStatus}</span>}
        </div>
        <div className={styles.visRow} style={{ display: 'block' }}>
          <Text className={styles.cat}>
            Turns each bar/column chart with a single actuals (AC) measure into an IBCS
            integrated-variance chart: clustered overlap, the “&lt;AC&gt; PY” series behind it,
            red/green deviation error bars, dark/light grey columns, hidden value axis and (for
            bars) a descending sort. Create the “&lt;AC&gt; PY / Δ PY / Max Green PY / Max Red AC”
            measures first with the <b>Previous-year &amp; variance measures</b> tool (enable error
            bars) so the red/green bars bind.
          </Text>
        </div>
        {varErr && (
          <div className={styles.visRow} style={{ color: '#b10e1c' }}>
            {varErr}
          </div>
        )}
        {varScan?.candidates.map((c) => (
          <div key={`${c.page}/${c.visual}`} className={styles.visRow}>
            <span className={styles.visName}>{c.visual}</span>
            <Badge appearance="outline" color="brand">
              {c.isBar ? 'bar' : 'column'}
            </Badge>
            <span className={styles.cat}>AC: {c.acMeasure}</span>
            {c.styled ? (
              <Badge appearance="tint" color="success">
                styled
              </Badge>
            ) : (
              <Badge appearance="tint" color="warning">
                needs styling
              </Badge>
            )}
          </div>
        ))}
        <div className={styles.toolbar} style={{ padding: '8px 12px' }}>
          <Button
            icon={varBusy ? <Spinner size="tiny" /> : <DataTrending20Regular />}
            disabled={varBusy}
            onClick={() => void runVarScan()}
          >
            {varScan === null ? 'Preview variance fixes' : 'Re-scan'}
          </Button>
          <span className={styles.grow} />
          {varScan !== null && varScan.candidates.length > 0 && (
            <Button
              appearance="primary"
              icon={varBusy ? <Spinner size="tiny" /> : <ArrowSort20Regular />}
              disabled={varBusy}
              onClick={() => void runVarApply()}
            >
              Apply to {varScan.candidates.length} chart{varScan.candidates.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
