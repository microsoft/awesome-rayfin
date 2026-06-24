// DisplayFolders — auto-organize columns and measures into display folders.
//
// PKG-14 / MA3. Pairs with the BPA rules "Organize columns/measures into
// display folders" (E4 / E5). Unlike the Unused Cleanup tool this change is
// non-destructive and fully reversible (a display folder only affects the field
// list), but the plan is still previewed before anything is written so the user
// can see exactly which objects move where.
//
// Heuristic: within each table over the threshold, objects that share a leading
// name token (e.g. "Sales Amount", "Sales Qty" → folder "Sales") and that
// currently have no display folder are grouped into a folder named after the
// shared token. Singletons are left at the table root.

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
  FolderSwap20Regular,
  Folder20Regular,
  Info20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanDisplayFolders,
  applyDisplayFolders,
  DEFAULT_ORGANIZE_OPTIONS,
  type FolderPlan,
  type FolderAssignment,
} from '@/services/displayFolders';

export interface DisplayFoldersProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

interface TableGroup {
  table: string;
  folders: { folder: string; items: FolderAssignment[] }[];
  count: number;
}

/** Group flat assignments into table → folder → objects for display. */
function groupForDisplay(assignments: FolderAssignment[]): TableGroup[] {
  const byTable = new Map<string, Map<string, FolderAssignment[]>>();
  for (const a of assignments) {
    const folders = byTable.get(a.table) ?? new Map<string, FolderAssignment[]>();
    const list = folders.get(a.folder) ?? [];
    list.push(a);
    folders.set(a.folder, list);
    byTable.set(a.table, folders);
  }
  const result: TableGroup[] = [];
  for (const [table, folders] of byTable) {
    const folderList = [...folders.entries()]
      .map(([folder, items]) => ({ folder, items }))
      .sort((x, y) => x.folder.localeCompare(y.folder));
    result.push({
      table,
      folders: folderList,
      count: folderList.reduce((n, f) => n + f.items.length, 0),
    });
  }
  return result.sort((x, y) => x.table.localeCompare(y.table));
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
  folderRow: {
    display: 'flex',
    alignItems: 'flex-start',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  folderName: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('5px'),
    fontWeight: '600',
    fontSize: '12px',
    minWidth: '160px',
    flexShrink: 0,
  },
  folderItems: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    color: GRAY_COLOR,
    display: 'flex',
    flexWrap: 'wrap',
    ...shorthands.gap('4px', '8px'),
  },
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

export function DisplayFolders({ workspaceId, datasetId, datasetName }: DisplayFoldersProps) {
  const styles = useStyles();
  const [plan, setPlan] = useState<FolderPlan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [organizeColumns, setOrganizeColumns] = useState(true);
  const [organizeMeasures, setOrganizeMeasures] = useState(true);

  const options = useMemo(
    () => ({ ...DEFAULT_ORGANIZE_OPTIONS, columns: organizeColumns, measures: organizeMeasures }),
    [organizeColumns, organizeMeasures]
  );

  const runScan = useCallback(async () => {
    if (!workspaceId || !datasetId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    try {
      const result = await scanDisplayFolders(workspaceId, datasetId, datasetName, options);
      setPlan(result);
      const folders = new Set(result.assignments.map((a) => `${a.table}\u0000${a.folder}`)).size;
      setStatus(
        `${datasetName || 'Model'} · ${result.assignments.length} object${
          result.assignments.length === 1 ? '' : 's'
        } would move into ${folders} folder${folders === 1 ? '' : 's'}.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, datasetId, datasetName, options]);

  const runApply = useCallback(async () => {
    if (!plan || plan.assignments.length === 0) return;
    setApplying(true);
    setErr(null);
    setStatus(null);
    try {
      const res = await applyDisplayFolders(workspaceId, datasetId, plan.assignments);
      setStatus(res.detail);
      // Re-scan so applied objects drop off (they now have a folder).
      const result = await scanDisplayFolders(workspaceId, datasetId, datasetName, options);
      setPlan(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [plan, workspaceId, datasetId, datasetName, options]);

  const groups = useMemo(() => groupForDisplay(plan?.assignments ?? []), [plan]);

  if (!workspaceId || !datasetId) {
    return (
      <div className={styles.empty}>
        <FolderSwap20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a semantic model in the connection bar, then scan to preview a display-folder layout.</Text>
      </div>
    );
  }

  const busy = scanning || applying;
  const nothingFound = plan !== null && plan.assignments.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <FolderSwap20Regular />}
          disabled={busy}
          onClick={() => void runScan()}
        >
          {plan === null ? 'Preview display folders' : 'Re-scan'}
        </Button>
        <Switch
          label="Columns"
          checked={organizeColumns}
          disabled={busy}
          onChange={(_, d) => setOrganizeColumns(!!d.checked)}
        />
        <Switch
          label="Measures"
          checked={organizeMeasures}
          disabled={busy}
          onChange={(_, d) => setOrganizeMeasures(!!d.checked)}
        />
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
        {plan === null && !scanning && (
          <div className={styles.empty}>
            <FolderSwap20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
            <Text>
              Click “Preview display folders” to see how related columns and measures (sharing a
              leading name word, in tables with more than {DEFAULT_ORGANIZE_OPTIONS.tableThreshold}{' '}
              of them) would be grouped into folders. Nothing is written until you apply.
            </Text>
          </div>
        )}

        {nothingFound && (
          <div className={styles.empty}>
            <Info20Regular style={{ width: 32, height: 32, color: '#107c10' }} />
            <Text>Nothing to organize — no folder-less object families found in large tables.</Text>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.table} className={styles.group}>
            <div className={styles.groupHead}>
              <span>{g.table}</span>
              <Badge appearance="tint" color="informative">
                {g.count} object{g.count === 1 ? '' : 's'} → {g.folders.length} folder
                {g.folders.length === 1 ? '' : 's'}
              </Badge>
            </div>
            {g.folders.map((f) => (
              <div key={f.folder} className={styles.folderRow}>
                <span className={styles.folderName}>
                  <Folder20Regular style={{ width: 15, height: 15 }} />
                  {f.folder}
                </span>
                <span className={styles.folderItems}>
                  {f.items.map((it) => (
                    <span key={`${it.kind}\u0000${it.name}`}>
                      {it.name}
                      {it.kind === 'column' ? ' (col)' : ''}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {plan !== null && !nothingFound && (
        <div className={styles.toolbar}>
          <span className={styles.grow} />
          <Button
            appearance="primary"
            icon={applying ? <Spinner size="tiny" /> : <Folder20Regular />}
            disabled={busy || plan.assignments.length === 0}
            onClick={() => void runApply()}
          >
            Apply {plan.assignments.length} folder assignment{plan.assignments.length === 1 ? '' : 's'}
          </Button>
        </div>
      )}
    </div>
  );
}
