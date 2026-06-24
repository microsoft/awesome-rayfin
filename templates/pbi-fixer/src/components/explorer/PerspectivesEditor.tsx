// PerspectivesEditor — view/create/edit model perspectives (PKG-15 · D1).
//
// Left rail: list of perspectives + a "New" box. Right pane: a tri-state
// checkbox tree (table → columns / measures / hierarchies) for the selected
// perspective. Saving round-trips the model TMDL: a new perspective gets its
// own `definition/perspectives/<name>.tmdl` part plus a `ref perspective` line
// in model.tmdl; an existing one is overwritten.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Input,
  Checkbox,
  Text,
  Badge,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Eye20Regular,
  Add20Regular,
  Delete20Regular,
  Save20Regular,
  ChevronRight16Regular,
  ChevronDown16Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, PANEL_BG } from '@/explorer/theme';
import {
  loadPerspectiveEditorData,
  savePerspective,
  deletePerspective,
  type ModelInventory,
  type PerspectiveDef,
} from '@/services/perspectivesApi';

export interface PerspectivesEditorProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

interface Result {
  ok: boolean;
  text: string;
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  split: { flex: 1, minHeight: 0, display: 'flex', ...shorthands.gap('12px') },
  rail: {
    width: '260px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: PANEL_BG,
    ...shorthands.padding('10px'),
    overflowY: 'auto',
  },
  railHead: { fontSize: '12px', fontWeight: '700', color: '#333' },
  newRow: { display: 'flex', ...shorthands.gap('6px'), alignItems: 'center' },
  pItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.gap('6px'),
    ...shorthands.padding('6px', '8px'),
    ...shorthands.borderRadius('6px'),
    cursor: 'pointer',
  },
  pItemActive: { backgroundColor: 'rgba(37,99,235,0.12)' },
  pName: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pane: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: PANEL_BG,
    ...shorthands.padding('12px'),
  },
  paneHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  paneTitle: { fontSize: '14px', fontWeight: '700' },
  tree: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  tableRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('4px'), ...shorthands.padding('2px', '0') },
  caret: { cursor: 'pointer', display: 'flex', alignItems: 'center', color: GRAY_COLOR },
  objRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px'), paddingLeft: '34px', ...shorthands.padding('1px', '0', '1px', '34px') },
  kind: { fontSize: '10px', color: GRAY_COLOR, width: '24px', flexShrink: 0 },
  placeholder: { fontSize: '13px', color: GRAY_COLOR, ...shorthands.padding('20px') },
});

interface TriState {
  checked: boolean;
  mixed: boolean;
}

export function PerspectivesEditor({ workspaceId, datasetId, datasetName }: PerspectivesEditorProps) {
  const styles = useStyles();
  const ready = !!datasetId;

  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<ModelInventory | null>(null);
  const [perspectives, setPerspectives] = useState<PerspectiveDef[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await loadPerspectiveEditorData(workspaceId, datasetId, datasetName);
      setInventory(data.inventory);
      setPerspectives(data.perspectives);
      if (data.perspectives.length > 0) {
        setActiveName(data.perspectives[0].name);
        setSelected(new Set(data.perspectives[0].selected));
      } else {
        setActiveName(null);
        setSelected(new Set());
      }
      setDirty(false);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [ready, workspaceId, datasetId, datasetName]);

  const selectPerspective = useCallback(
    (name: string) => {
      const p = perspectives.find((x) => x.name === name);
      setActiveName(name);
      setSelected(new Set(p ? p.selected : []));
      setDirty(false);
      setResult(null);
    },
    [perspectives]
  );

  const createNew = useCallback(() => {
    const n = newName.trim();
    if (!n) return;
    if (perspectives.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      setResult({ ok: false, text: `A perspective named "${n}" already exists.` });
      return;
    }
    const def: PerspectiveDef = { name: n, selected: new Set(), path: '' };
    setPerspectives((prev) => [...prev, def].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveName(n);
    setSelected(new Set());
    setNewName('');
    setDirty(true);
    setResult(null);
  }, [newName, perspectives]);

  const tableState = useCallback(
    (tableKeys: string[]): TriState => {
      if (tableKeys.length === 0) return { checked: false, mixed: false };
      let on = 0;
      for (const k of tableKeys) if (selected.has(k)) on++;
      if (on === 0) return { checked: false, mixed: false };
      if (on === tableKeys.length) return { checked: true, mixed: false };
      return { checked: false, mixed: true };
    },
    [selected]
  );

  const toggleObj = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  }, []);

  const toggleTable = useCallback(
    (tableKeys: string[], turnOn: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of tableKeys) {
          if (turnOn) next.add(k);
          else next.delete(k);
        }
        return next;
      });
      setDirty(true);
    },
    []
  );

  const toggleExpand = useCallback((table: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  }, []);

  const visibleTables = useMemo(() => {
    if (!inventory) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return inventory.tables;
    return inventory.tables
      .map((t) => ({
        table: t.table,
        objects: t.table.toLowerCase().includes(f)
          ? t.objects
          : t.objects.filter((o) => o.name.toLowerCase().includes(f)),
      }))
      .filter((t) => t.table.toLowerCase().includes(f) || t.objects.length > 0);
  }, [inventory, filter]);

  const selectedCount = useMemo(() => {
    if (!inventory) return 0;
    return inventory.allKeys.filter((k) => selected.has(k)).length;
  }, [inventory, selected]);

  const save = useCallback(async () => {
    if (!activeName || !inventory) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await savePerspective(workspaceId, datasetId, activeName, selected, inventory);
      setResult({ ok: r.changed > 0, text: r.detail });
      if (r.changed > 0) {
        setPerspectives((prev) => {
          const idx = prev.findIndex((p) => p.name === activeName);
          const def: PerspectiveDef = { name: activeName, selected: new Set(selected), path: r.path || prev[idx]?.path || '' };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = def;
            return copy;
          }
          return [...prev, def];
        });
        setDirty(false);
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [activeName, inventory, selected, workspaceId, datasetId]);

  const removeActive = useCallback(async () => {
    if (!activeName) return;
    const target = perspectives.find((p) => p.name === activeName);
    setBusy(true);
    setResult(null);
    try {
      // A perspective that was never saved (no path) is dropped locally only.
      if (!target || !target.path) {
        setPerspectives((prev) => prev.filter((p) => p.name !== activeName));
        setActiveName(null);
        setSelected(new Set());
        setResult({ ok: true, text: `Removed unsaved perspective "${activeName}".` });
        return;
      }
      const r = await deletePerspective(workspaceId, datasetId, activeName);
      setResult({ ok: r.changed > 0, text: r.detail });
      if (r.changed > 0) {
        setPerspectives((prev) => prev.filter((p) => p.name !== activeName));
        setActiveName(null);
        setSelected(new Set());
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [activeName, perspectives, workspaceId, datasetId]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button appearance="primary" icon={<Eye20Regular />} onClick={load} disabled={!ready || loading}>
          {perspectives.length > 0 || inventory ? 'Reload perspectives' : 'Load perspectives'}
        </Button>
        {loading && <Spinner size="tiny" />}
        {inventory && (
          <Text className={styles.status}>
            {perspectives.length} perspective(s) · {inventory.tables.length} table(s)
          </Text>
        )}
        {!ready && <Text className={styles.status}>Select a semantic model first.</Text>}
      </div>

      {result && (
        <MessageBar intent={result.ok ? 'success' : 'error'}>
          <MessageBarBody>{result.text}</MessageBarBody>
        </MessageBar>
      )}

      {inventory && (
        <div className={styles.split}>
          <div className={styles.rail}>
            <div className={styles.railHead}>Perspectives</div>
            <div className={styles.newRow}>
              <Input
                size="small"
                placeholder="New perspective name"
                value={newName}
                onChange={(_, d) => setNewName(d.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createNew();
                }}
              />
              <Button size="small" icon={<Add20Regular />} onClick={createNew} disabled={!newName.trim()} />
            </div>
            {perspectives.length === 0 && <Text className={styles.status}>No perspectives yet.</Text>}
            {perspectives.map((p) => (
              <div
                key={p.name}
                className={`${styles.pItem} ${p.name === activeName ? styles.pItemActive : ''}`}
                onClick={() => selectPerspective(p.name)}
              >
                <span className={styles.pName}>
                  {p.name}
                  {p.name === activeName && dirty ? ' \u25CF' : ''}
                </span>
                <Badge appearance="tint" color="informative" size="small">
                  {inventory.allKeys.filter((k) => (p.name === activeName ? selected : p.selected).has(k)).length}
                </Badge>
              </div>
            ))}
          </div>

          <div className={styles.pane}>
            {activeName ? (
              <>
                <div className={styles.paneHead}>
                  <span className={styles.paneTitle}>{activeName}</span>
                  <Badge appearance="tint" color="brand">
                    {selectedCount} object(s)
                  </Badge>
                  <Button
                    appearance="primary"
                    size="small"
                    icon={busy ? <Spinner size="tiny" /> : <Save20Regular />}
                    onClick={save}
                    disabled={busy || !dirty}
                  >
                    Save
                  </Button>
                  <Button
                    size="small"
                    icon={<Delete20Regular />}
                    onClick={removeActive}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                  <Input
                    size="small"
                    contentBefore={<Search20Regular />}
                    placeholder="Filter objects"
                    value={filter}
                    onChange={(_, d) => setFilter(d.value)}
                    style={{ marginLeft: 'auto', width: '200px' }}
                  />
                </div>
                <div className={styles.tree}>
                  {visibleTables.map((t) => {
                    const keys = t.objects.map((o) => o.key);
                    const ts = tableState(keys);
                    const isOpen = expanded.has(t.table) || !!filter.trim();
                    return (
                      <div key={t.table}>
                        <div className={styles.tableRow}>
                          <span className={styles.caret} onClick={() => toggleExpand(t.table)}>
                            {isOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                          </span>
                          <Checkbox
                            checked={ts.mixed ? 'mixed' : ts.checked}
                            onChange={(_, d) => toggleTable(keys, d.checked === true)}
                            label={<span style={{ fontWeight: 600 }}>{'\u{1F4C1} ' + t.table}</span>}
                          />
                        </div>
                        {isOpen &&
                          t.objects.map((o) => (
                            <div key={o.key} className={styles.objRow}>
                              <span className={styles.kind}>{o.kind === 'Column' ? 'col' : o.kind === 'Measure' ? 'msr' : 'hir'}</span>
                              <Checkbox
                                checked={selected.has(o.key)}
                                onChange={() => toggleObj(o.key)}
                                label={o.name}
                              />
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={styles.placeholder}>
                Select a perspective on the left, or create a new one to start choosing objects.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PerspectivesEditor;
