// ModelBpa — Best Practice Analyzer for the connected semantic model.
//
// Loads the model (via DAX INFO.VIEW) and runs the in-browser BPA
// engine ported from the Fabric Developer Hub. Findings are grouped by
// category with severity badges, object paths and rule descriptions. A small
// subset of rules carries a deterministic TMDL auto-fix ("Do not summarize
// numeric columns", "Hide foreign keys") that patches the model definition and
// writes it back via updateDefinition.

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
import type { ModelData } from '@/explorer/types';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG, PANEL_BG } from '@/explorer/theme';
import { loadModelData } from '@/services/fabricRest';
import { runModelBpa, type BpaFinding, type BpaSeverity } from '@/services/modelBpaApi';
import { applyModelBpaFix } from '@/services/modelBpaFix';
import { MODEL_BPA_RULES } from '@/services/bpa/rules';
import { logFix, saveSnapshot, recordScan } from '@/services/historyService';

export interface ModelBpaProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const SEVERITIES: BpaSeverity[] = ['Error', 'Warning', 'Info'];
const SEVERITY_BADGE: Record<BpaSeverity, 'danger' | 'warning' | 'informative'> = {
  Error: 'danger',
  Warning: 'warning',
  Info: 'informative',
};
const CATEGORY_ORDER = [
  'Performance',
  'Error Prevention',
  'DAX Expressions',
  'Maintenance',
  'Formatting',
  'Naming Conventions',
];

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

export function ModelBpa({ workspaceId, datasetId, datasetName }: ModelBpaProps) {
  const styles = useStyles();
  const [, setModel] = useState<ModelData | null>(null);
  const [findings, setFindings] = useState<BpaFinding[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<BpaSeverity>>(() => new Set(SEVERITIES));
  const [search, setSearch] = useState('');
  const [fixing, setFixing] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!workspaceId || !datasetId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const data = await loadModelData(workspaceId, datasetId, datasetName);
      setModel(data);
      const f = runModelBpa(data);
      setFindings(f);
      // DB-3 — persist the scan result for the quality trend (fire-and-forget,
      // off the critical path: the findings are already rendered above).
      {
        const sev: Record<BpaSeverity, number> = { Error: 0, Warning: 0, Info: 0 };
        for (const x of f) sev[x.rule.severity]++;
        recordScan({
          workspaceId,
          itemKind: 'model',
          itemId: datasetId,
          itemName: datasetName || datasetId,
          ruleSetVersion: `v${MODEL_BPA_RULES.length}`,
          error: sev.Error,
          warning: sev.Warning,
          info: sev.Info,
        });
      }
      setStatus(`${datasetName || 'Model'} · ${f.length} finding${f.length === 1 ? '' : 's'} across ${Object.keys(data.tables).length} tables.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, datasetId, datasetName]);

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
      if (!f.rule.fixKind || !workspaceId || !datasetId) return;
      const fixKind = f.rule.fixKind;
      const itemName = datasetName || datasetId;
      setFixing(findingKey(f));
      setErr(null);
      setStatus(null);
      try {
        const res = await applyModelBpaFix(workspaceId, datasetId, fixKind, f.objectPath);
        setStatus(res.detail);
        // DB-1/DB-2 — record the fix and capture its undo snapshot, both
        // fire-and-forget so the user never waits on persistence.
        const snapId =
          res.before && res.partPath
            ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
            : undefined;
        if (snapId && res.before && res.partPath) {
          saveSnapshot({
            id: snapId,
            workspaceId,
            itemKind: 'model',
            itemId: datasetId,
            itemName,
            fixer: fixKind,
            partPath: res.partPath,
            before: res.before,
          });
        }
        logFix({
          workspaceId,
          itemKind: 'model',
          itemId: datasetId,
          itemName,
          fixer: fixKind,
          rule: f.rule.name,
          objectPath: f.objectPath,
          result: 'ok',
          changed: res.changed,
          message: res.detail,
          snapshotId: snapId,
        });
        // Re-scan so the fixed finding drops off and counts refresh.
        const data = await loadModelData(workspaceId, datasetId, datasetName);
        setModel(data);
        setFindings(runModelBpa(data));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        logFix({
          workspaceId,
          itemKind: 'model',
          itemId: datasetId,
          itemName,
          fixer: fixKind,
          rule: f.rule.name,
          objectPath: f.objectPath,
          result: 'fail',
          changed: 0,
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setFixing(null);
      }
    },
    [workspaceId, datasetId, datasetName]
  );

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
        (a, b) => sevRank(a.rule.severity) - sevRank(b.rule.severity) || a.rule.name.localeCompare(b.rule.name)
      );
    }
    return [...map.entries()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0]);
      const ib = CATEGORY_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  }, [visible]);

  if (!workspaceId || !datasetId) {
    return (
      <div className={styles.empty}>
        <ShieldCheckmark20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a semantic model in the connection bar, then scan for best-practice issues.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <ShieldCheckmark20Regular />}
          disabled={scanning || !!fixing}
          onClick={() => void scan()}
        >
          {findings === null ? 'Scan model' : 'Re-scan'}
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
            <Text>Click “Scan model” to run {MODEL_BPA_RULES.length} best-practice rules against the semantic model.</Text>
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
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
