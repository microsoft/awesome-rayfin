// MeasureEditor — Tabular-Editor-style measure authoring.
//
// Browse every measure in the model (grouped by table, filtered by name),
// edit its DAX expression and properties (format string, display folder,
// description, hidden), create new measures and delete existing ones. Saves
// are written back to the model's TMDL definition via updateDefinition.
//
// Writing a measure mutates the live semantic model — Save / Delete are
// explicit, user-initiated actions and the model is reloaded afterwards so the
// UI always reflects the persisted definition.

import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Spinner,
  Input,
  Textarea,
  Switch,
  Dropdown,
  Option,
  Text,
  Badge,
  Tooltip,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Calculator20Regular,
  Add20Regular,
  Delete20Regular,
  Save20Regular,
  Search20Regular,
  ArrowClockwise20Regular,
  Dismiss20Regular,
  TextGrammarWand20Regular,
  ArrowSwap20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  loadMeasures,
  updateMeasure,
  createMeasure,
  deleteMeasure,
  formatAllMeasures,
  findReplaceInMeasures,
  type MeasureValues,
  type LoadedMeasure,
  type LoadedMeasures,
} from '@/services/measureEditor';
import { formatDax } from '@/services/daxFormat';

export interface MeasureEditorProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const EMPTY_VALUES: MeasureValues = {
  name: '',
  expression: '',
  formatString: '',
  displayFolder: '',
  description: '',
  isHidden: false,
};

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
  status: { fontSize: '12px', color: GRAY_COLOR, flexShrink: 0 },
  bulkPanel: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    ...shorthands.padding('12px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    flexShrink: 0,
  },
  bulkRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap' },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    ...shorthands.gap('10px'),
  },
  list: {
    width: '300px',
    flexShrink: 0,
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
  },
  tableHead: {
    ...shorthands.padding('6px', '12px'),
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
    ...shorthands.padding('6px', '12px'),
    cursor: 'pointer',
    fontSize: '13px',
    ...shorthands.borderBottom('1px', 'solid', '#f0f0f0'),
    ':hover': { backgroundColor: '#f3f3f3' },
  },
  measureRowActive: { backgroundColor: '#fff3e0', ':hover': { backgroundColor: '#ffe9cc' } },
  measureName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  folder: { fontSize: '11px', color: GRAY_COLOR },
  editor: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: '#ffffff',
    ...shorthands.padding('16px'),
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('12px'),
  },
  editorHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px') },
  editorTitle: { fontSize: '15px', fontWeight: '700' },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  label: { fontSize: '12px', fontWeight: '600', color: '#333' },
  hint: { fontSize: '11px', color: GRAY_COLOR },
  dax: { fontFamily: 'monospace', fontSize: '13px' },
  row: { display: 'flex', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  rowItem: { flex: '1 1 220px', minWidth: 0 },
  actions: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    marginTop: 'auto',
    paddingTop: '10px',
    ...shorthands.borderTop('1px', 'solid', BORDER_COLOR),
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: GRAY_COLOR,
    fontSize: '13px',
  },
});

export function MeasureEditor({ workspaceId, datasetId }: MeasureEditorProps) {
  const styles = useStyles();
  const [model, setModel] = useState<LoadedMeasures | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Selection / form state.
  const [selected, setSelected] = useState<{ table: string; name: string } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<MeasureValues>(EMPTY_VALUES);
  const [newTable, setNewTable] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Bulk utilities (PKG-11): format-all + find/replace panel.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ intent: 'success' | 'error'; text: string } | null>(null);
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frInExpr, setFrInExpr] = useState(true);
  const [frInName, setFrInName] = useState(false);
  const [frCase, setFrCase] = useState(false);
  const [frRegex, setFrRegex] = useState(false);

  const load = useCallback(async () => {
    if (!datasetId) {
      setError('Select a semantic model first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadMeasures(workspaceId, datasetId);
      setModel(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, datasetId]);

  const measures = useMemo<LoadedMeasure[]>(() => model?.measures ?? [], [model]);

  const tableNames = useMemo(() => model?.tables ?? [], [model]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return measures;
    return measures.filter(
      (m) => m.values.name.toLowerCase().includes(q) || m.table.toLowerCase().includes(q)
    );
  }, [measures, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, LoadedMeasure[]>();
    for (const m of filtered) {
      const arr = map.get(m.table) ?? [];
      arr.push(m);
      map.set(m.table, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const selectMeasure = useCallback((item: LoadedMeasure) => {
    setIsNew(false);
    setConfirmDelete(false);
    setSelected({ table: item.table, name: item.values.name });
    setForm({ ...item.values });
  }, []);

  const startNew = useCallback(() => {
    setIsNew(true);
    setConfirmDelete(false);
    setSelected(null);
    setForm(EMPTY_VALUES);
    setNewTable(tableNames[0] ?? '');
  }, [tableNames]);

  const patch = (p: Partial<MeasureValues>) => setForm((f) => ({ ...f, ...p }));

  const canSave = useMemo(() => {
    if (saving) return false;
    if (!form.name.trim() || !form.expression.trim()) return false;
    if (isNew && !newTable) return false;
    return true;
  }, [saving, form, isNew, newTable]);

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const table = isNew ? newTable : selected!.table;
      const result = isNew
        ? await createMeasure(workspaceId, datasetId, table, form)
        : await updateMeasure(workspaceId, datasetId, table, selected!.name, form);
      if (result.changed === 0) {
        setError(result.detail);
      }
      await load();
      setIsNew(false);
      setSelected({ table, name: form.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [canSave, isNew, newTable, selected, workspaceId, datasetId, form, load]);

  const doDelete = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const result = await deleteMeasure(workspaceId, datasetId, selected.table, selected.name);
      if (result.changed === 0) setError(result.detail);
      await load();
      setSelected(null);
      setConfirmDelete(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [selected, workspaceId, datasetId, load]);

  const runFormatAll = useCallback(async () => {
    if (!datasetId) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await formatAllMeasures(workspaceId, datasetId);
      setBulkResult({ intent: res.changed > 0 ? 'success' : 'error', text: res.detail });
      if (res.changed > 0) await load();
    } catch (e) {
      setBulkResult({ intent: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBulkBusy(false);
    }
  }, [workspaceId, datasetId, load]);

  const runFindReplace = useCallback(async () => {
    if (!datasetId) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await findReplaceInMeasures(workspaceId, datasetId, {
        find: frFind,
        replace: frReplace,
        inExpression: frInExpr,
        inName: frInName,
        caseSensitive: frCase,
        useRegex: frRegex,
      });
      setBulkResult({ intent: res.changed > 0 ? 'success' : 'error', text: res.detail });
      if (res.changed > 0) await load();
    } catch (e) {
      setBulkResult({ intent: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBulkBusy(false);
    }
  }, [workspaceId, datasetId, frFind, frReplace, frInExpr, frInName, frCase, frRegex, load]);

  const showForm = isNew || selected !== null;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowClockwise20Regular />}
          disabled={loading || !datasetId}
          onClick={load}
        >
          {model ? 'Reload' : 'Load measures'}
        </Button>
        <Button icon={<Add20Regular />} disabled={!model || loading} onClick={startNew}>
          New measure
        </Button>
        <Button
          icon={<TextGrammarWand20Regular />}
          disabled={!model || loading || bulkBusy}
          onClick={runFormatAll}
        >
          Format all
        </Button>
        <Button
          icon={<ArrowSwap20Regular />}
          disabled={!model || loading}
          appearance={bulkOpen ? 'primary' : 'secondary'}
          onClick={() => setBulkOpen((v) => !v)}
        >
          Find &amp; replace
        </Button>
        <Input
          className={styles.grow}
          contentBefore={<Search20Regular />}
          placeholder="Filter measures by name or table…"
          value={search}
          onChange={(_, d) => setSearch(d.value)}
          disabled={!model}
        />
        <span className={styles.status}>
          {model ? `${measures.length} measures in ${tableNames.length} tables` : 'not loaded'}
        </span>
      </div>

      {bulkOpen && (
        <div className={styles.bulkPanel}>
          <div className={styles.bulkRow}>
            <Input
              className={styles.grow}
              placeholder="Find…"
              value={frFind}
              onChange={(_, d) => setFrFind(d.value)}
              disabled={bulkBusy}
            />
            <Input
              className={styles.grow}
              placeholder="Replace with…"
              value={frReplace}
              onChange={(_, d) => setFrReplace(d.value)}
              disabled={bulkBusy}
            />
          </div>
          <div className={styles.bulkRow}>
            <Switch
              label="Expressions"
              checked={frInExpr}
              onChange={(_, d) => setFrInExpr(d.checked)}
              disabled={bulkBusy}
            />
            <Switch
              label="Names"
              checked={frInName}
              onChange={(_, d) => setFrInName(d.checked)}
              disabled={bulkBusy}
            />
            <Switch
              label="Case sensitive"
              checked={frCase}
              onChange={(_, d) => setFrCase(d.checked)}
              disabled={bulkBusy}
            />
            <Switch
              label="Regex"
              checked={frRegex}
              onChange={(_, d) => setFrRegex(d.checked)}
              disabled={bulkBusy}
            />
            <div className={styles.grow} />
            <Button
              appearance="primary"
              icon={bulkBusy ? <Spinner size="tiny" /> : <ArrowSwap20Regular />}
              disabled={!model || bulkBusy || !frFind.trim() || (!frInExpr && !frInName)}
              onClick={runFindReplace}
            >
              Replace in measures
            </Button>
          </div>
          <span className={styles.hint}>
            Renames change only the measure declaration — references in other DAX are not rewritten.
          </span>
        </div>
      )}

      {bulkResult && (
        <MessageBar intent={bulkResult.intent}>
          <MessageBarBody>{bulkResult.text}</MessageBarBody>
        </MessageBar>
      )}

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.body}>
        <div className={styles.list}>
          {!model && <div className={styles.empty}>Load the model to browse measures.</div>}
          {model &&
            grouped.map(([table, items]) => (
              <div key={table}>
                <div className={styles.tableHead}>{table}</div>
                {items.map((m) => {
                  const active = !isNew && selected?.table === m.table && selected?.name === m.values.name;
                  return (
                    <div
                      key={`${m.table}|${m.values.name}`}
                      className={`${styles.measureRow} ${active ? styles.measureRowActive : ''}`}
                      onClick={() => selectMeasure(m)}
                    >
                      <Calculator20Regular style={{ color: ICON_ACCENT, flexShrink: 0 }} />
                      <span className={styles.measureName}>{m.values.name}</span>
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
          {model && filtered.length === 0 && (
            <div className={styles.empty}>No measures match the filter.</div>
          )}
        </div>

        {showForm ? (
          <div className={styles.editor}>
            <div className={styles.editorHead}>
              <Calculator20Regular style={{ color: ICON_ACCENT }} />
              <span className={styles.editorTitle}>
                {isNew ? 'New measure' : `${selected!.table}[${selected!.name}]`}
              </span>
            </div>

            <div className={styles.row}>
              {isNew && (
                <div className={`${styles.field} ${styles.rowItem}`}>
                  <label className={styles.label}>Table</label>
                  <Dropdown
                    value={newTable}
                    selectedOptions={[newTable]}
                    onOptionSelect={(_, d) => setNewTable(d.optionValue ?? '')}
                  >
                    {tableNames.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              )}
              <div className={`${styles.field} ${styles.rowItem}`}>
                <label className={styles.label}>Measure name</label>
                <Input value={form.name} onChange={(_, d) => patch({ name: d.value })} />
                {!isNew && <span className={styles.hint}>Renaming may break visuals / DAX that reference this measure.</span>}
              </div>
            </div>

            <div className={styles.field}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className={styles.label}>DAX expression</label>
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={!form.expression.trim()}
                  onClick={() => patch({ expression: formatDax(form.expression) })}
                >
                  Format
                </Button>
              </div>
              <Textarea
                className={styles.dax}
                resize="vertical"
                rows={10}
                value={form.expression}
                onChange={(_, d) => patch({ expression: d.value })}
                placeholder="SUM ( Sales[Amount] )"
              />
            </div>

            <div className={styles.row}>
              <div className={`${styles.field} ${styles.rowItem}`}>
                <label className={styles.label}>Format string</label>
                <Input
                  value={form.formatString}
                  onChange={(_, d) => patch({ formatString: d.value })}
                  placeholder="#,0.00"
                />
              </div>
              <div className={`${styles.field} ${styles.rowItem}`}>
                <label className={styles.label}>Display folder</label>
                <Input
                  value={form.displayFolder}
                  onChange={(_, d) => patch({ displayFolder: d.value })}
                  placeholder="Folder\Subfolder"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Description</label>
              <Textarea
                resize="vertical"
                rows={2}
                value={form.description}
                onChange={(_, d) => patch({ description: d.value })}
              />
            </div>

            <Switch
              checked={form.isHidden}
              label="Hidden"
              onChange={(_, d) => patch({ isHidden: d.checked })}
            />

            <div className={styles.actions}>
              <Tooltip content="Write the measure to the model definition" relationship="label">
                <Button
                  appearance="primary"
                  icon={saving ? <Spinner size="tiny" /> : <Save20Regular />}
                  disabled={!canSave}
                  onClick={save}
                >
                  {isNew ? 'Create measure' : 'Save changes'}
                </Button>
              </Tooltip>
              {!isNew && !confirmDelete && (
                <Button
                  icon={<Delete20Regular />}
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
              {!isNew && confirmDelete && (
                <>
                  <Text size={200} style={{ color: '#a4262c' }}>
                    Delete this measure?
                  </Text>
                  <Button appearance="primary" disabled={saving} onClick={doDelete}>
                    Confirm
                  </Button>
                  <Button icon={<Dismiss20Regular />} disabled={saving} onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.editor}>
            <div className={styles.empty}>
              {model ? 'Select a measure to edit, or create a new one.' : 'Load the model to begin.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
