// UnusedCleanup — guarded deletion of unused columns (E23) and measures (E24).
//
// The destructive corner of the model fixer (PKG-2). Workflow is deliberately
// gated so a delete can never happen by accident:
//   1. Scan — list every column / measure nothing in the model references.
//   2. Review — every candidate is UNCHECKED by default; the user opts in.
//   3. Allow — a separate "Allow deletes" switch arms the Delete button.
//   4. Confirm — a final dialog states the exact count and irreversibility.
// This surface is never part of any batch "Fix all" run.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Switch,
  Checkbox,
  Text,
  Badge,
  Tooltip,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Delete20Regular,
  Broom20Regular,
  Warning20Regular,
  Info20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  scanUnusedObjects,
  deleteUnusedObjects,
  type UnusedScan,
} from '@/services/unusedObjects';

export interface UnusedCleanupProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const colKey = (table: string, column: string) => `col\u0000${table}\u0000${column}`;
const measKey = (table: string, measure: string) => `meas\u0000${table}\u0000${measure}`;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  grow: { flex: 1 },
  status: { fontSize: '12px', color: GRAY_COLOR, flexShrink: 0 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('14px') },
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
  row: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('5px', '12px'),
    ...shorthands.borderBottom('1px', 'solid', BORDER_COLOR),
  },
  rowName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' },
  rowMeta: { fontSize: '11px', color: GRAY_COLOR },
  footer: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('14px'),
    ...shorthands.padding('10px', '12px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    flexShrink: 0,
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

export function UnusedCleanup({ workspaceId, datasetId, datasetName }: UnusedCleanupProps) {
  const styles = useStyles();
  const [scan, setScan] = useState<UnusedScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runScan = useCallback(async () => {
    if (!workspaceId || !datasetId) return;
    setScanning(true);
    setErr(null);
    setStatus(null);
    setSelected(new Set());
    setAllowDeletes(false);
    try {
      const result = await scanUnusedObjects(workspaceId, datasetId, datasetName);
      setScan(result);
      setStatus(
        `${datasetName || 'Model'} · ${result.columns.length} unused column${result.columns.length === 1 ? '' : 's'}, ` +
          `${result.measures.length} unused measure${result.measures.length === 1 ? '' : 's'} ` +
          `(scanned ${result.scannedColumns} columns, ${result.scannedMeasures} measures).`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [workspaceId, datasetId, datasetName]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allColKeys = useMemo(() => (scan?.columns ?? []).map((c) => colKey(c.table, c.column)), [scan]);
  const allMeasKeys = useMemo(() => (scan?.measures ?? []).map((m) => measKey(m.table, m.measure)), [scan]);

  const setGroup = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const runDelete = useCallback(async () => {
    if (!scan || !allowDeletes || selected.size === 0) return;
    setConfirmOpen(false);
    setDeleting(true);
    setErr(null);
    setStatus(null);
    try {
      const cols = scan.columns
        .filter((c) => selected.has(colKey(c.table, c.column)))
        .map((c) => ({ table: c.table, column: c.column }));
      const meas = scan.measures
        .filter((m) => selected.has(measKey(m.table, m.measure)))
        .map((m) => ({ table: m.table, measure: m.measure }));
      const res = await deleteUnusedObjects(workspaceId, datasetId, cols, meas);
      setStatus(res.detail);
      // Re-scan so deleted rows drop off and the model reflects reality.
      const result = await scanUnusedObjects(workspaceId, datasetId, datasetName);
      setScan(result);
      setSelected(new Set());
      setAllowDeletes(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [scan, allowDeletes, selected, workspaceId, datasetId, datasetName]);

  if (!workspaceId || !datasetId) {
    return (
      <div className={styles.empty}>
        <Broom20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
        <Text>Select a workspace and a semantic model in the connection bar, then scan for unused columns and measures.</Text>
      </div>
    );
  }

  const busy = scanning || deleting;
  const nothingFound = scan !== null && scan.columns.length === 0 && scan.measures.length === 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={scanning ? <Spinner size="tiny" /> : <Broom20Regular />}
          disabled={busy}
          onClick={() => void runScan()}
        >
          {scan === null ? 'Scan for unused objects' : 'Re-scan'}
        </Button>
        <span className={styles.grow} />
        {status && <span className={styles.status}>{status}</span>}
      </div>

      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Destructive — review carefully.</MessageBarTitle>
          Deleting columns and measures permanently changes the semantic model. Detection only
          covers in-model references; <b>cross-report and cross-model usage cannot be checked</b>.
          Verify each object is truly unused before deleting. Every item is unchecked by default.
        </MessageBarBody>
      </MessageBar>

      {err && (
        <MessageBar intent="error">
          <MessageBarBody>{err}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        {scan === null && !scanning && (
          <div className={styles.empty}>
            <Broom20Regular style={{ width: 32, height: 32, color: GRAY_COLOR }} />
            <Text>Click “Scan for unused objects” to find columns and measures nothing in the model references.</Text>
          </div>
        )}

        {nothingFound && (
          <div className={styles.empty}>
            <Info20Regular style={{ width: 32, height: 32, color: '#107c10' }} />
            <Text>No unused columns or measures found in the model.</Text>
          </div>
        )}

        {scan !== null && scan.columns.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHead}>
              <span>Unused columns</span>
              <Badge appearance="tint" color="informative">
                {scan.columns.length}
              </Badge>
              <span className={styles.grow} />
              <Button size="small" appearance="subtle" disabled={busy} onClick={() => setGroup(allColKeys, true)}>
                Select all
              </Button>
              <Button size="small" appearance="subtle" disabled={busy} onClick={() => setGroup(allColKeys, false)}>
                Clear
              </Button>
            </div>
            {scan.columns.map((c) => {
              const key = colKey(c.table, c.column);
              return (
                <div key={key} className={styles.row}>
                  <Checkbox checked={selected.has(key)} disabled={busy} onChange={() => toggle(key)} />
                  <Tooltip content={c.reason} relationship="description">
                    <span className={styles.rowName}>
                      {c.table}[{c.column}]
                    </span>
                  </Tooltip>
                  <span className={styles.rowMeta}>
                    {c.dataType}
                    {c.isCalculated ? ' · calculated' : ''}
                    {c.isHidden ? ' · hidden' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {scan !== null && scan.measures.length > 0 && (
          <div className={styles.group}>
            <div className={styles.groupHead}>
              <span>Unused measures</span>
              <Badge appearance="tint" color="informative">
                {scan.measures.length}
              </Badge>
              <span className={styles.grow} />
              <Button size="small" appearance="subtle" disabled={busy} onClick={() => setGroup(allMeasKeys, true)}>
                Select all
              </Button>
              <Button size="small" appearance="subtle" disabled={busy} onClick={() => setGroup(allMeasKeys, false)}>
                Clear
              </Button>
            </div>
            {scan.measures.map((m) => {
              const key = measKey(m.table, m.measure);
              return (
                <div key={key} className={styles.row}>
                  <Checkbox checked={selected.has(key)} disabled={busy} onChange={() => toggle(key)} />
                  <Tooltip content={m.reason} relationship="description">
                    <span className={styles.rowName}>
                      {m.table}[{m.measure}]
                    </span>
                  </Tooltip>
                  <span className={styles.rowMeta}>{m.isHidden ? 'hidden' : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {scan !== null && !nothingFound && (
        <div className={styles.footer}>
          <Switch
            label="Allow deletes"
            checked={allowDeletes}
            disabled={busy}
            onChange={(_, d) => setAllowDeletes(!!d.checked)}
          />
          <span className={styles.grow} />
          <span className={styles.status}>{selected.size} selected</span>
          <Button
            appearance="primary"
            icon={deleting ? <Spinner size="tiny" /> : <Delete20Regular />}
            disabled={busy || !allowDeletes || selected.size === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Delete selected
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(_, d) => setConfirmOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Warning20Regular style={{ verticalAlign: 'middle', marginRight: 6, color: '#b35900' }} />
              Delete {selected.size} object{selected.size === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogContent>
              This permanently removes the selected columns and measures from{' '}
              <b>{datasetName || 'the model'}</b>. This cannot be undone from here. Make sure none of
              them are used in any report connected to this model.
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" icon={<Delete20Regular />} onClick={() => void runDelete()}>
                Delete {selected.size}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
