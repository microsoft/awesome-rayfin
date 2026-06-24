// ReportBpa — Best Practice Analyzer for the selected report (PKG-6).
//
// Loads the report's PBIR definition and runs the in-browser report BPA engine
// (a faithful port of `sempy_labs.report.run_report_bpa`, 9 evaluatable rules).
// Findings are grouped by category with severity badges, object paths and rule
// descriptions. The fixable subset (A12) is repaired either per-finding or in
// one pass via the "Fix all fixable" button, both routed through the PKG-5
// report fixers.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Badge,
  Input,
  Text,
  ToggleButton,
  Tooltip,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  ShieldCheckmark20Regular,
  Wrench20Regular,
  Search20Regular,
  Checkmark20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG, PANEL_BG } from '@/explorer/theme';
import {
  runReportBpaScan,
  fixReportBpa,
  applyReportFixKind,
  REPORT_BPA_RULE_LIST,
  type BpaFinding,
  type BpaSeverity,
} from '@/services/reportBpaApi';

export interface ReportBpaProps {
  workspaceId: string;
  reportId: string;
  reportName?: string;
  datasetId?: string;
  datasetName?: string;
}

const SEVERITIES: BpaSeverity[] = ['Error', 'Warning', 'Info'];
const SEVERITY_BADGE: Record<BpaSeverity, 'danger' | 'warning' | 'informative'> = {
  Error: 'danger',
  Warning: 'warning',
  Info: 'informative',
};
const CATEGORY_ORDER = ['Performance', 'Maintenance'];

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
  group: {
    backgroundColor: PANEL_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
  },
  groupHead: {
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
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  fGrow: { flex: 1, minWidth: 0 },
  ruleName: { fontWeight: '600', fontSize: '13px' },
  objPath: { fontFamily: 'monospace', fontSize: '12px', color: ICON_ACCENT },
  ruleDesc: { fontSize: '12px', color: GRAY_COLOR, marginTop: '2px' },
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
});

const findingKey = (f: BpaFinding) => `${f.rule.id}|${f.objectType}|${f.objectPath}`;

export function ReportBpa({ workspaceId, reportId, reportName, datasetId }: ReportBpaProps) {
  const styles = useStyles();
  const [findings, setFindings] = useState<BpaFinding[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<BpaSeverity>>(() => new Set(SEVERITIES));
  const [search, setSearch] = useState('');
  const [fixing, setFixing] = useState<string | null>(null);
  const [batchFixing, setBatchFixing] = useState(false);

  const scan = useCallback(async () => {
    if (!workspaceId || !reportId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const f = await runReportBpaScan(workspaceId, reportId);
      setFindings(f);
      setStatus(`${reportName || 'Report'} · ${f.length} finding${f.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, reportId, reportName]);

  const toggleSev = useCallback((s: BpaSeverity) => {
    setSevFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const fixOne = useCallback(
    async (f: BpaFinding) => {
      if (!f.rule.fixKind || !workspaceId || !reportId) return;
      setFixing(findingKey(f));
      setErr(null);
      setStatus(null);
      try {
        const res = await applyReportFixKind(workspaceId, reportId, f.rule.fixKind, datasetId);
        setStatus(res.detail);
        setFindings(await runReportBpaScan(workspaceId, reportId));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setFixing(null);
      }
    },
    [workspaceId, reportId, datasetId]
  );

  const fixAll = useCallback(async () => {
    if (!workspaceId || !reportId) return;
    setBatchFixing(true);
    setErr(null);
    setStatus(null);
    try {
      const res = await fixReportBpa(workspaceId, reportId, datasetId);
      setStatus(res.detail);
      setFindings(await runReportBpaScan(workspaceId, reportId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchFixing(false);
    }
  }, [workspaceId, reportId, datasetId]);

  const counts = useMemo(() => {
    const c: Record<BpaSeverity, number> = { Error: 0, Warning: 0, Info: 0 };
    for (const f of findings ?? []) c[f.rule.severity]++;
    return c;
  }, [findings]);

  const fixableCount = useMemo(
    () => (findings ?? []).filter((f) => f.rule.fixKind).length,
    [findings]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (findings ?? []).filter(
      (f) =>
        sevFilter.has(f.rule.severity) &&
        (!q ||
          f.rule.name.toLowerCase().includes(q) ||
          f.objectPath.toLowerCase().includes(q) ||
          f.rule.category.toLowerCase().includes(q))
    );
  }, [findings, sevFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, BpaFinding[]>();
    for (const f of visible) {
      const arr = map.get(f.rule.category) ?? [];
      arr.push(f);
      map.set(f.rule.category, arr);
    }
    const sevRank = (s: BpaSeverity) => SEVERITIES.indexOf(s);
    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          sevRank(a.rule.severity) - sevRank(b.rule.severity) ||
          a.rule.name.localeCompare(b.rule.name)
      );
    }
    return [...map.entries()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0]);
      const ib = CATEGORY_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [visible]);

  if (!workspaceId || !reportId) {
    return (
      <div className={styles.empty}>
        <ShieldCheckmark20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a report in the connection bar, then scan for best-practice issues.</Text>
      </div>
    );
  }

  const busy = scanning || !!fixing || batchFixing;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <ShieldCheckmark20Regular />}
          disabled={busy}
          onClick={() => void scan()}
        >
          {findings === null ? 'Scan report' : 'Re-scan'}
        </Button>

        {findings !== null && (
          <>
            {SEVERITIES.map((s) => (
              <ToggleButton
                key={s}
                size="small"
                appearance={sevFilter.has(s) ? 'primary' : 'outline'}
                icon={sevFilter.has(s) ? <Checkmark20Regular /> : undefined}
                checked={sevFilter.has(s)}
                onClick={() => toggleSev(s)}
              >
                {s} ({counts[s]})
              </ToggleButton>
            ))}
            <Input
              size="small"
              contentBefore={<Search20Regular />}
              placeholder="Filter rules / objects…"
              value={search}
              onChange={(_, d) => setSearch(d.value)}
              style={{ width: 220 }}
            />
            {fixableCount > 0 && (
              <Tooltip content="Apply every fixable BPA rule in one pass" relationship="label">
                <Button
                  size="small"
                  appearance="secondary"
                  icon={batchFixing ? <Spinner size="tiny" /> : <Wrench20Regular />}
                  disabled={busy}
                  onClick={() => void fixAll()}
                >
                  Fix all fixable ({fixableCount})
                </Button>
              </Tooltip>
            )}
          </>
        )}

        <span className={styles.grow} />

        {fixableCount > 0 && (
          <Badge appearance="tint" color="brand" icon={<Wrench20Regular />}>
            {fixableCount} auto-fixable
          </Badge>
        )}
        {status && <span className={styles.stats}>{status}</span>}
      </div>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        {findings === null && !scanning && (
          <div className={styles.empty}>
            <ShieldCheckmark20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
            <Text>Click “Scan report” to run {REPORT_BPA_RULE_LIST.length} best-practice rules against the report definition.</Text>
          </div>
        )}

        {findings !== null && visible.length === 0 && (
          <div className={styles.empty}>
            <ShieldCheckmark20Regular style={{ width: 32, height: 32, color: '#107c10' }} />
            <Text>
              {findings.length === 0
                ? 'No best-practice issues found. '
                : 'No findings match the current filters.'}
            </Text>
          </div>
        )}

        {grouped.map(([category, items]) => (
          <div key={category} className={styles.group}>
            <div className={styles.groupHead}>
              <span>{category}</span>
              <Badge appearance="tint" color="informative">
                {items.length}
              </Badge>
            </div>
            {items.map((f) => {
              const key = findingKey(f);
              return (
                <div key={key} className={styles.finding}>
                  <Badge appearance="filled" color={SEVERITY_BADGE[f.rule.severity]} size="small">
                    {f.rule.severity}
                  </Badge>
                  <div className={styles.fGrow}>
                    <div>
                      <span className={styles.ruleName}>{f.rule.name}</span>{' '}
                      {f.objectPath && <span className={styles.objPath}>· {f.objectPath}</span>}
                    </div>
                    <div className={styles.ruleDesc}>
                      {f.rule.description}
                      {f.rule.url && (
                        <>
                          {' '}
                          <Link href={f.rule.url} target="_blank" rel="noreferrer">
                            Learn more
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  {f.rule.fixKind && (
                    <Tooltip content="Patch the report definition and write it back" relationship="label">
                      <Button
                        size="small"
                        appearance="secondary"
                        icon={fixing === key ? <Spinner size="tiny" /> : <Wrench20Regular />}
                        disabled={busy}
                        onClick={() => void fixOne(f)}
                      >
                        Fix
                      </Button>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
