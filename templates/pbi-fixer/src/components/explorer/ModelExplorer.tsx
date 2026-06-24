// ModelExplorer — FluentUI tree explorer for a semantic model.
// Adapted from the standalone "TS PBI Fixer" rewrite: driven directly by the
// workspaceId + datasetId already selected in the connection bar (no name
// resolution), reading through the server-side fabric_proxy UDF.

import React, { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from 'react';
import {
  Button,
  Input,
  Textarea,
  Spinner,
  Switch,
  Dropdown,
  Option,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuPopover,
  MenuList,
  MenuItem,
  makeStyles,
  shorthands,
  Tooltip,
  TabList,
  Tab,
} from '@fluentui/react-components';
import {
  Search20Regular,
  Copy20Regular,
  Table20Regular,
  Open20Regular,
  Flash20Regular,
  Save20Regular,
  CommentAdd20Regular,
  Add20Regular,
  Delete20Regular,
  Dismiss20Regular,
  TextGrammarWand20Regular,
  ArrowSwap20Regular,
  Calculator20Regular,
  FolderSwap20Regular,
} from '@fluentui/react-icons';
import type { ModelData, TreeBuildResult } from '@/explorer/types';
import {
  FONT_FAMILY,
  BORDER_COLOR,
  GRAY_COLOR,
  ICON_ACCENT,
  SECTION_BG,
  HOVER_BG,
  PANEL_BG,
} from '@/explorer/theme';
import { buildMultiModelTree, getModelPreviewText, getDaxReference, MODEL_KEY_SEP } from '@/explorer/modelTree';
import { filterTreeOptions } from '@/explorer/treeUtils';
import { loadModelData, executeDax } from '@/services/fabricRest';
import { runModelBpa, type BpaFinding, type BpaSeverity } from '@/services/modelBpaApi';
import { applyModelBpaFix } from '@/services/modelBpaFix';
import {
  loadMeasures,
  createMeasure,
  updateMeasure,
  updateMeasures,
  deleteMeasure,
  formatAllMeasures,
  findReplaceInMeasures,
  type MeasureValues,
  type MeasureBatchEdit,
} from '@/services/measureEditor';
import { formatDax } from '@/services/daxFormat';
import {
  scanDisplayFolders,
  applyDisplayFolders,
  DEFAULT_ORGANIZE_OPTIONS,
  type FolderAssignment,
} from '@/services/displayFolders';
import { setColumnProperty, setTableProperty, setMeasureProperty, setModelProperty, setPartitionExpression } from '@/services/modelPropertyEditor';
import { triggerRefresh, type RefreshObject, type RefreshType } from '@/services/refreshModel';
import { createWarmNotebook, runWarmNotebook } from '@/services/directLakeWarm';
import { isGithubSignedIn, startGithubDeviceFlow, type DeviceFlowHandle } from '@/services/githubAuth';
import { commentMExpression, GithubAuthRequiredError } from '@/services/mCommenter';
import { DefinitionSource } from './DefinitionSource';

// Lazy-loaded model tools surfaced as tabs alongside the explorer tree.
const TranslationsTab = lazy(() =>
  import('./TranslationsTab').then((m) => ({ default: m.TranslationsTab }))
);
const MemoryAnalyzer = lazy(() =>
  import('./MemoryAnalyzer').then((m) => ({ default: m.MemoryAnalyzer }))
);
const ModelBpa = lazy(() => import('./ModelBpa').then((m) => ({ default: m.ModelBpa })));

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', ...shorthands.gap('8px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  mainLayout: { display: 'flex', ...shorthands.gap('8px'), flex: 1, minHeight: 0 },
  treePanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '340px',
    minWidth: '280px',
    ...shorthands.gap('4px'),
  },
  treeList: {
    flex: 1,
    minHeight: '200px',
    overflowY: 'auto',
    overflowX: 'hidden',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  treeItem: {
    ...shorthands.padding('2px', '8px'),
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    '&:hover': { backgroundColor: HOVER_BG },
  },
  treeItemSelected: { backgroundColor: `${ICON_ACCENT}22`, fontWeight: '600' },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    ...shorthands.gap('8px'),
    minWidth: 0,
  },
  previewPanel: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('8px'),
    backgroundColor: SECTION_BG,
    minHeight: '160px',
    display: 'flex',
    flexDirection: 'column',
  },
  propertiesPanel: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('8px'),
    backgroundColor: SECTION_BG,
    flex: 1,
    overflowY: 'auto',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: ICON_ACCENT,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  propRow: { display: 'flex', ...shorthands.padding('3px', '0'), fontSize: '13px' },
  propLabel: {
    fontWeight: '600',
    color: GRAY_COLOR,
    whiteSpace: 'nowrap',
    minWidth: '120px',
    paddingRight: '10px',
  },
  propValue: { wordBreak: 'break-word' },
  propEditRow: { display: 'flex', alignItems: 'center', ...shorthands.padding('2px', '0'), fontSize: '13px' },
  propEditControl: { flex: 1, minWidth: 0 },
  statusBar: { fontSize: '13px', ...shorthands.padding('4px', '8px'), ...shorthands.borderRadius('6px') },
  propsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  propGroupLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: GRAY_COLOR,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    marginTop: '10px',
    marginBottom: '2px',
  },
  propTextBlock: {
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: 'rgba(0,0,0,0.04)',
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('6px', '8px'),
    marginTop: '2px',
    maxHeight: '180px',
    overflowY: 'auto',
  },
  // Integrated measure editor (right panel when a measure is selected / new).
  measurePanel: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    ...shorthands.gap('12px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('16px'),
    backgroundColor: '#ffffff',
    overflowY: 'auto',
  },
  measureHead: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px') },
  measureTitle: { fontSize: '15px', fontWeight: '700' },
  mField: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  mLabel: { fontSize: '12px', fontWeight: '600', color: '#333' },
  mHint: { fontSize: '11px', color: GRAY_COLOR },
  mDax: { fontFamily: 'monospace', fontSize: '13px' },
  mRow: { display: 'flex', ...shorthands.gap('12px'), flexWrap: 'wrap' },
  mRowItem: { flex: '1 1 220px', minWidth: 0 },
  mActions: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    marginTop: 'auto',
    paddingTop: '10px',
    ...shorthands.borderTop('1px', 'solid', BORDER_COLOR),
  },
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
  grow: { flex: 1, minWidth: '120px' },
  dfPreview: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    maxHeight: '320px',
    overflowY: 'auto',
  },
  dfGroup: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('4px'),
    ...shorthands.padding('8px'),
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    backgroundColor: PANEL_BG,
  },
  dfGroupHead: { fontSize: '12px', fontWeight: 600 },
  dfFolderRow: { display: 'flex', alignItems: 'baseline', ...shorthands.gap('8px') },
  dfFolderName: {
    display: 'inline-flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    fontSize: '12px',
    fontWeight: 500,
    color: ICON_ACCENT,
    flexShrink: 0,
    minWidth: '120px',
  },
  dfFolderItems: { fontSize: '11px', color: GRAY_COLOR },
});

/** Blank measure form used by "New measure" and as a safe default. */
const EMPTY_MEASURE: MeasureValues = {
  name: '',
  expression: '',
  formatString: '',
  displayFolder: '',
  description: '',
  isHidden: false,
};

/**
 * A staged ("pending") edit to an existing measure. Edits are accumulated in a
 * map keyed by `${modelId}::${table}::${originalName}` so the user can change
 * several measures and commit them all with one batch save.
 */
interface PendingMeasure {
  id: string;
  modelName: string;
  table: string;
  /** Name the measure had when staging began (identifies the block to rewrite). */
  originalName: string;
  values: MeasureValues;
}

/** Uppercase sub-heading that groups related property rows. */
const PropGroupLabel: React.FC<{ label: string }> = ({ label }) => {
  const styles = useStyles();
  return <div className={styles.propGroupLabel}>{label}</div>;
};

/** Read-only multi-line block (DAX / M expressions). Hidden when empty. */
const PropTextBlock: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const styles = useStyles();
  if (!value) return null;
  return (
    <div>
      <span className={styles.propLabel} style={{ display: 'block', marginBottom: '2px' }}>
        {label}
      </span>
      <div className={styles.propTextBlock}>{value}</div>
    </div>
  );
};

const PropRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const styles = useStyles();
  if (!value) return null;
  return (
    <div className={styles.propRow}>
      <span className={styles.propLabel}>{label}</span>
      <span className={styles.propValue}>{value}</span>
    </div>
  );
};

/** Editable text property. Commits on blur / Enter when the value changed. */
const EditTextRow: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onSave: (value: string) => void;
}> = ({ label, value, placeholder, disabled, onSave }) => {
  const styles = useStyles();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  return (
    <div className={styles.propEditRow}>
      <span className={styles.propLabel}>{label}</span>
      <Input
        size="small"
        className={styles.propEditControl}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(_, d) => setDraft(d.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
};

/** Editable boolean property rendered as a Switch. */
const EditBoolRow: React.FC<{
  label: string;
  value: boolean;
  disabled?: boolean;
  onSave: (value: boolean) => void;
}> = ({ label, value, disabled, onSave }) => {
  const styles = useStyles();
  return (
    <div className={styles.propEditRow}>
      <span className={styles.propLabel}>{label}</span>
      <Switch checked={value} disabled={disabled} onChange={(_, d) => onSave(d.checked)} />
    </div>
  );
};

/** TMDL `summarizeBy` tokens offered in the column property dropdown. */
const SUMMARIZE_OPTIONS = ['none', 'sum', 'average', 'min', 'max', 'count', 'distinctCount'];

/** Enum option lists for TE2-parity property dropdowns. */
const DATATYPE_OPTIONS = [
  'string',
  'int64',
  'double',
  'decimal',
  'dateTime',
  'boolean',
  'binary',
  'variant',
];
const DEFAULTMODE_OPTIONS = ['import', 'directQuery', 'dual', 'directLake', 'push'];
const DIRECTLAKE_BEHAVIOR_OPTIONS = ['automatic', 'directLakeOnly', 'directQueryOnly'];
const DEFAULTDATAVIEW_OPTIONS = ['full', 'sample'];
const PBI_DATASOURCE_VERSION_OPTIONS = ['powerBI_V1', 'powerBI_V2', 'powerBI_V3'];
const DSV_OVERRIDE_OPTIONS = ['disallow', 'allow'];

/** Normalise an INFO.VIEW SummarizeBy value (e.g. "Sum") to its TMDL token. */
function normalizeSummarizeBy(v: string): string {
  const s = (v || '').trim();
  if (!s) return 'none';
  const lower = s.charAt(0).toLowerCase() + s.slice(1);
  return SUMMARIZE_OPTIONS.includes(lower) ? lower : s;
}

/** Editable enum property rendered as a Dropdown. */
const EditSelectRow: React.FC<{
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onSave: (value: string) => void;
}> = ({ label, value, options, disabled, onSave }) => {
  const styles = useStyles();
  return (
    <div className={styles.propEditRow}>
      <span className={styles.propLabel}>{label}</span>
      <Dropdown
        size="small"
        className={styles.propEditControl}
        value={value}
        selectedOptions={[value]}
        disabled={disabled}
        onOptionSelect={(_, d) => {
          if (d.optionValue && d.optionValue !== value) onSave(d.optionValue);
        }}
      >
        {options.map((opt) => (
          <Option key={opt} value={opt}>
            {opt}
          </Option>
        ))}
      </Dropdown>
    </div>
  );
};

/** One model selected in the connection bar. */
export interface ModelExplorerModel {
  datasetId: string;
  datasetName: string;
}

/** The lens tabs shown inside Model Explorer. */
export type ModelViewTab = 'explorer' | 'tmdl' | 'translations' | 'memory' | 'bpa';

export interface ModelExplorerProps {
  workspaceId: string;
  /** Every selected model-bearing pair — all are loaded into the tree. */
  models: ModelExplorerModel[];
  /**
   * Optional controlled lens selection (Explorer / TMDL / Translations /
   * Memory Analyzer / Model BPA). When provided, the parent owns the active
   * lens — used by the left nav to deep-link into a specific lens.
   */
  viewTab?: ModelViewTab;
  /** Notified whenever the lens changes, so a parent can mirror it. */
  onViewTabChange?: (tab: ModelViewTab) => void;
}

/** A loaded model: its dataset id, display name and parsed data. */
interface LoadedModel {
  id: string;
  name: string;
  data: ModelData;
}

/** Split a namespaced tree key (`<modelId>\u241f<bareKey>`) into its parts. */
function splitNsKey(key: string): { id: string; bare: string } {
  const i = key.indexOf(MODEL_KEY_SEP);
  if (i < 0) return { id: '', bare: key };
  return { id: key.slice(0, i), bare: key.slice(i + 1) };
}

/** All foldable node keys for one table's measure/column display-folder tree. */
function foldableTableFolderKeys(md: ModelData, tName: string): string[] {
  const t = md.tables?.[tName];
  if (!t) return [];
  const keys: string[] = [];
  const addAncestors = (kind: 'folder' | 'colfolder', raw: string) => {
    const path = raw.replace(/\//g, '\\').trim();
    if (!path) return;
    const parts = path.split('\\');
    for (let d = 0; d < parts.length; d++) keys.push(`${kind}:${tName}:${parts.slice(0, d + 1).join('\\')}`);
  };
  for (const m of Object.values(t.measures ?? {})) {
    const df = (m as { displayFolder?: string }).displayFolder ?? '';
    if (df) addAncestors('folder', df);
  }
  for (const c of Object.values(t.columns ?? {})) {
    const df = (c as { displayFolder?: string }).displayFolder ?? '';
    if (df) addAncestors('colfolder', df.split(';')[0]);
  }
  return keys;
}

/** Every foldable node key for a whole model (model row, tables, folders, relationships). */
function foldableModelKeys(md: ModelData): string[] {
  const keys: string[] = [md.datasetName ?? 'Model'];
  for (const tName of Object.keys(md.tables ?? {})) {
    keys.push(tName);
    keys.push(...foldableTableFolderKeys(md, tName));
  }
  if ((md.relationships ?? []).length > 0) keys.push('rels:_single');
  return keys;
}

/**
 * Immutably patch a single metadata property on a table / column / measure in
 * loaded model data. Used for optimistic UI updates after a successful save so
 * the tree + properties reflect the change without a full model reload.
 */
function patchModelProperty(
  data: ModelData,
  kind: 'column' | 'measure' | 'table' | 'model',
  table: string,
  name: string,
  prop: string,
  value: string | boolean
): ModelData {
  if (kind === 'model') {
    return {
      ...data,
      modelProperties: { ...data.modelProperties, [prop]: value },
    };
  }
  const t = data.tables[table];
  if (!t) return data;
  if (kind === 'table') {
    const nextTable = { ...t, [prop]: value } as typeof t;
    return { ...data, tables: { ...data.tables, [table]: nextTable } };
  }
  if (kind === 'column') {
    const col = t.columns[name];
    if (!col) return data;
    const nextCol = { ...col, [prop]: value } as typeof col;
    const nextTable = { ...t, columns: { ...t.columns, [name]: nextCol } };
    return { ...data, tables: { ...data.tables, [table]: nextTable } };
  }
  const meas = t.measures[name];
  if (!meas) return data;
  const nextMeas = { ...meas, [prop]: value } as typeof meas;
  const nextTable = { ...t, measures: { ...t.measures, [name]: nextMeas } };
  return { ...data, tables: { ...data.tables, [table]: nextTable } };
}

/** BPA object path for a bare (un-namespaced) tree key, or null. */
function barePathForKey(bare: string): string | null {
  const p = bare.split(':');
  if (p[0] === 'table') return p[1];
  if (p[0] === 'column') return `${p[1]}[${p[2]}]`;
  if (p[0] === 'measure') return `[${p[2]}]`;
  return null;
}

/**
 * Immutably set the `displayFolder` of every column / measure named by a folder
 * plan in loaded model data. Used to preview an "organize display folders"
 * proposal directly in the tree (objects move into their new folders) before
 * anything is written, and to revert that preview on discard (folder `''`).
 */
function applyFolderAssignments(data: ModelData, assignments: FolderAssignment[]): ModelData {
  const tables = { ...data.tables };
  for (const a of assignments) {
    const t = tables[a.table];
    if (!t) continue;
    if (a.kind === 'column') {
      const col = t.columns[a.name];
      if (!col) continue;
      tables[a.table] = {
        ...t,
        columns: { ...t.columns, [a.name]: { ...col, displayFolder: a.folder } },
      };
    } else {
      const meas = t.measures[a.name];
      if (!meas) continue;
      tables[a.table] = {
        ...t,
        measures: { ...t.measures, [a.name]: { ...meas, displayFolder: a.folder } },
      };
    }
  }
  return { ...data, tables };
}

export const ModelExplorer: React.FC<ModelExplorerProps> = ({
  workspaceId,
  models,
  viewTab: controlledViewTab,
  onViewTabChange,
}) => {
  const styles = useStyles();

  const [modelsData, setModelsData] = useState<LoadedModel[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; color: string }>({ msg: '', color: GRAY_COLOR });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [daxRef, setDaxRef] = useState('');
  const [measureExprCache, setMeasureExprCache] = useState<Record<string, string>>({});
  const [measureExprLoading, setMeasureExprLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [fixing, setFixing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Lens selection: controlled by the parent when `viewTab` is supplied,
  // otherwise driven by internal state. Either way clicking a lens tab updates
  // internal state and notifies the parent so deep-linking stays in sync.
  const [viewTabInternal, setViewTabInternal] = useState<ModelViewTab>('explorer');
  const viewTab = controlledViewTab ?? viewTabInternal;
  const setViewTab = useCallback(
    (t: ModelViewTab) => {
      setViewTabInternal(t);
      onViewTabChange?.(t);
    },
    [onViewTabChange]
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savingProp, setSavingProp] = useState(false);
  const [savingExpr, setSavingExpr] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [ghFlow, setGhFlow] = useState<DeviceFlowHandle | null>(null);
  const [tablePreview, setTablePreview] = useState<
    Record<string, { loading: boolean; rows: Record<string, unknown>[]; error: string | null }>
  >({});
  const [warming, setWarming] = useState(false);
  const [warmInfo, setWarmInfo] = useState<{ msg: string; color: string; url?: string } | null>(null);

  // --- Integrated measure editor (formerly the standalone Measure Editor tab).
  const [isNewMeasure, setIsNewMeasure] = useState(false);
  const [newMeasureTable, setNewMeasureTable] = useState('');
  const [measureForm, setMeasureForm] = useState<MeasureValues>(EMPTY_MEASURE);
  const [measureBaseline, setMeasureBaseline] = useState<MeasureValues>(EMPTY_MEASURE);
  const [savingMeasure, setSavingMeasure] = useState(false);
  const [confirmDeleteMeasure, setConfirmDeleteMeasure] = useState(false);
  // Staged edits to existing measures — edit several, then commit with one save.
  const [pendingMeasures, setPendingMeasures] = useState<Record<string, PendingMeasure>>({});
  // Mirror of the staged edits read by the selection-sync effect without making
  // that effect re-run (and clobber the form) on every keystroke.
  const pendingRef = useRef<Record<string, PendingMeasure>>({});
  useEffect(() => {
    pendingRef.current = pendingMeasures;
  }, [pendingMeasures]);
  // Bulk utilities: format-all + find/replace.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ color: string; text: string } | null>(null);
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frInExpr, setFrInExpr] = useState(true);
  const [frInName, setFrInName] = useState(false);
  const [frCase, setFrCase] = useState(false);
  const [frRegex, setFrRegex] = useState(false);
  // Display folders: contextual auto-organize of the selected scope.
  const [dfBusy, setDfBusy] = useState(false);
  // Staged "organize display folders" proposal: previewed in the tree, written
  // only when the user clicks the blue Save button.
  const [dfStaged, setDfStaged] = useState<{
    datasetId: string;
    datasetName: string;
    assignments: FolderAssignment[];
  } | null>(null);
  const [dfSaving, setDfSaving] = useState(false);

  // Replace a single loaded model in place (after a fix / property edit reload).
  const setModelEntry = useCallback((id: string, data: ModelData) => {
    setModelsData((prev) => prev.map((m) => (m.id === id ? { ...m, data } : m)));
  }, []);

  // The model that owns the currently selected node — operations in the right
  // panel (preview, properties, BPA, warm-up, TMDL) target this model.
  const active = useMemo<LoadedModel | null>(() => {
    const id = selectedKey ? splitNsKey(selectedKey).id : models[0]?.datasetId ?? '';
    return modelsData.find((m) => m.id === id) ?? modelsData[0] ?? null;
  }, [selectedKey, modelsData, models]);
  const activeData = active?.data ?? null;
  const activeDatasetId = active?.id ?? '';
  const activeDatasetName = active?.name ?? '';
  // Fall back to the connection-bar selection so the tool tabs work even before
  // the tree's "Load Model" has been clicked.
  const tabDatasetId = activeDatasetId || models[0]?.datasetId || '';
  const tabDatasetName = activeDatasetName || models[0]?.datasetName || '';

  // Reset the loaded tree whenever the set of selected models changes.
  const modelIdsKey = useMemo(() => models.map((m) => m.datasetId).join('|'), [models]);
  useEffect(() => {
    setModelsData([]);
    setSelectedKey(null);
    setPreviewText('');
    setDaxRef('');
    setStatus({ msg: '', color: GRAY_COLOR });
  }, [modelIdsKey]);

  // Direct Lake models support cache warm-up; non-DL models don't, so the
  // toolbar action only appears for the active model when it is Direct Lake.
  const isDirectLake = useMemo(() => {
    if (!activeData) return false;
    if ((activeData.modelProperties.defaultMode || '').toLowerCase() === 'directlake') return true;
    return Object.values(activeData.tables).some((t) =>
      (t.partitions ?? []).some((p) => /directlake/i.test(p.sourceType))
    );
  }, [activeData]);

  const treeResult = useMemo<TreeBuildResult>(() => {
    if (modelsData.length === 0) return { options: [], keyMap: {}, iconMap: {} };
    return buildMultiModelTree(
      modelsData.map((m) => ({ id: m.id, data: m.data })),
      expanded,
      new Set()
    );
  }, [modelsData, expanded]);

  const filteredOptions = useMemo(
    () => filterTreeOptions(treeResult.options, searchQuery),
    [treeResult.options, searchQuery]
  );

  // Run the in-browser Model BPA per model so the right-click menu can expose
  // the issues + deterministic fixes for the clicked object.
  const findingsByModel = useMemo<Record<string, BpaFinding[]>>(() => {
    const map: Record<string, BpaFinding[]> = {};
    for (const m of modelsData) map[m.id] = runModelBpa(m.data);
    return map;
  }, [modelsData]);

  // Namespaced BPA object path for a tree node key, or null for nodes that are
  // not BPA-scoped objects (folders, the model root, relationships).
  const objectPathForKey = useCallback((key: string): string | null => {
    const { id, bare } = splitNsKey(key);
    const path = barePathForKey(bare);
    return path == null ? null : `${id}${MODEL_KEY_SEP}${path}`;
  }, []);

  // Namespaced object paths of objects in the staged display-folder proposal,
  // so the tree can flag each moved column / measure with a blue dot.
  const dfPendingPaths = useMemo(() => {
    const set = new Set<string>();
    if (!dfStaged) return set;
    for (const a of dfStaged.assignments) {
      const bare = a.kind === 'column' ? `${a.table}[${a.name}]` : `[${a.name}]`;
      set.add(`${dfStaged.datasetId}${MODEL_KEY_SEP}${bare}`);
    }
    return set;
  }, [dfStaged]);

  const findingsForKey = useCallback(
    (key: string): BpaFinding[] => {
      const { id, bare } = splitNsKey(key);
      const path = barePathForKey(bare);
      if (!path) return [];
      return (findingsByModel[id] ?? []).filter((f) => f.objectPath === path);
    },
    [findingsByModel]
  );

  // Namespaced object paths that carry at least one finding / one auto-fix, so
  // the tree can flag them with a dot (kept per model to avoid cross collisions).
  const { issuePaths, fixablePaths } = useMemo(() => {
    const issue = new Set<string>();
    const fix = new Set<string>();
    for (const m of modelsData) {
      for (const f of findingsByModel[m.id] ?? []) {
        const ns = `${m.id}${MODEL_KEY_SEP}${f.objectPath}`;
        issue.add(ns);
        if (f.rule.fixKind) fix.add(ns);
      }
    }
    return { issuePaths: issue, fixablePaths: fix };
  }, [modelsData, findingsByModel]);

  const handleLoad = useCallback(async () => {
    if (!workspaceId || models.length === 0) {
      setStatus({ msg: 'Select a workspace and at least one model first', color: '#ff3b30' });
      return;
    }
    setLoading(true);
    setStatus({
      msg: `Loading ${models.length} model${models.length > 1 ? 's' : ''}...`,
      color: GRAY_COLOR,
    });
    try {
      const loaded = await Promise.all(
        models.map(async (m) => ({
          id: m.datasetId,
          name: m.datasetName,
          data: await loadModelData(workspaceId, m.datasetId, m.datasetName),
        }))
      );
      setModelsData(loaded);
      // Expand every model root so all models are visible in the tree at once.
      setExpanded(new Set(loaded.map((m) => `${m.id}${MODEL_KEY_SEP}${m.name || 'Model'}`)));
      setSelectedKey(null);
      setMeasureExprCache({});
      setMeasureExprLoading(false);
      const totalTables = loaded.reduce((s, m) => s + Object.keys(m.data.tables).length, 0);
      setStatus({
        msg: `Loaded ${loaded.length} model${loaded.length > 1 ? 's' : ''} · ${totalTables} tables`,
        color: '#34c759',
      });
    } catch (err) {
      setStatus({ msg: `Error: ${err instanceof Error ? err.message : String(err)}`, color: '#ff3b30' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, models]);

  /**
   * INFO.VIEW frequently omits measure expressions in this environment. When a
   * selected measure has no expression yet, lazily hydrate expressions from
   * TMDL (same source as the dedicated measure editor) and cache them.
   */
  const hydrateMeasureExpression = useCallback(
    async (modelId: string, tableName: string, measureName: string, key: string) => {
      const cacheKey = `${modelId}::${tableName}::${measureName}`;
      const cached = measureExprCache[cacheKey];
      if (cached !== undefined) {
        if (selectedKey === key) setPreviewText(cached);
        return;
      }
      if (!workspaceId || !modelId) return;
      setMeasureExprLoading(true);
      try {
        const loaded = await loadMeasures(workspaceId, modelId);
        const map: Record<string, string> = {};
        for (const m of loaded.measures) {
          map[`${modelId}::${m.table}::${m.values.name}`] = m.values.expression || '';
        }
        setMeasureExprCache((prev) => ({ ...prev, ...map }));
        if (selectedKey === key) setPreviewText(map[cacheKey] ?? '');
      } catch {
        // Keep INFO.VIEW value on failure; no hard error needed.
      } finally {
        setMeasureExprLoading(false);
      }
    },
    [workspaceId, measureExprCache, selectedKey]
  );

  // ---------------------------------------------------------------------------
  // Integrated measure editor — selection, form sync, CRUD and bulk utilities.
  // (Replaces the formerly standalone "Measure Editor" tab.)
  // ---------------------------------------------------------------------------

  // The measure currently selected in the tree (null for non-measure nodes).
  const selectedMeasure = useMemo(() => {
    if (!selectedKey) return null;
    const { id, bare } = splitNsKey(selectedKey);
    if (!bare.startsWith('measure:')) return null;
    const p = bare.split(':');
    const table = p[1] ?? '';
    const name = p.length > 2 ? p.slice(2).join(':') : '';
    const measure = modelsData.find((x) => x.id === id)?.data?.tables[table]?.measures[name];
    if (!table || !name || !measure) return null;
    return { id, table, name, measure };
  }, [selectedKey, modelsData]);

  // Tables of the model that owns the selection — targets for "New measure".
  const activeTableNames = useMemo(
    () => (activeData ? Object.keys(activeData.tables).sort((a, b) => a.localeCompare(b)) : []),
    [activeData]
  );

  // Stable key for the selected measure, used to drive the form-sync effects.
  const selMeasureId = selectedMeasure
    ? `${selectedMeasure.id}::${selectedMeasure.table}::${selectedMeasure.name}`
    : '';

  // Load the selected measure's values into the editable form on selection.
  useEffect(() => {
    if (!selectedMeasure) return;
    setIsNewMeasure(false);
    setConfirmDeleteMeasure(false);
    const { id, table, name, measure } = selectedMeasure;
    const cached = measureExprCache[`${id}::${table}::${name}`];
    const expr = cached !== undefined ? cached : measure.expression || '';
    const vals: MeasureValues = {
      name,
      expression: expr,
      formatString: measure.formatString || '',
      displayFolder: measure.displayFolder || '',
      description: measure.description || '',
      isHidden: !!measure.isHidden,
    };
    // A staged edit for this measure (if any) wins over the model values so
    // unsaved changes survive switching between measures.
    const staged = pendingRef.current[selMeasureId];
    setMeasureForm(staged ? staged.values : vals);
    setMeasureBaseline(vals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMeasureId]);

  // Keep the staged-edits map in sync with the form: as the user edits an
  // existing measure, record (or clear) its pending entry. Driven by the form
  // value so edits are captured live, without losing them on selection change.
  useEffect(() => {
    if (isNewMeasure || !selectedMeasure || !selMeasureId) return;
    const dirty = JSON.stringify(measureForm) !== JSON.stringify(measureBaseline);
    const { id, table, name } = selectedMeasure;
    const modelName = modelsData.find((m) => m.id === id)?.name ?? '';
    setPendingMeasures((prev) => {
      if (dirty) {
        const entry: PendingMeasure = {
          id,
          modelName,
          table,
          originalName: name,
          values: measureForm,
        };
        const existing = prev[selMeasureId];
        if (existing && JSON.stringify(existing.values) === JSON.stringify(measureForm)) return prev;
        return { ...prev, [selMeasureId]: entry };
      }
      if (selMeasureId in prev) {
        const next = { ...prev };
        delete next[selMeasureId];
        return next;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureForm, measureBaseline, selMeasureId, isNewMeasure]);

  // When the expression hydrates after selection, fill it in if still untouched.
  useEffect(() => {
    if (!selectedMeasure) return;
    const cached =
      measureExprCache[`${selectedMeasure.id}::${selectedMeasure.table}::${selectedMeasure.name}`];
    if (cached === undefined) return;
    setMeasureForm((f) =>
      f.expression === '' && measureBaseline.expression === '' ? { ...f, expression: cached } : f
    );
    setMeasureBaseline((b) => (b.expression === '' ? { ...b, expression: cached } : b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureExprCache, selMeasureId]);

  const patchMeasure = useCallback(
    (p: Partial<MeasureValues>) => setMeasureForm((f) => ({ ...f, ...p })),
    []
  );

  const startNewMeasure = useCallback(() => {
    setIsNewMeasure(true);
    setSelectedKey(null);
    setConfirmDeleteMeasure(false);
    setMeasureForm(EMPTY_MEASURE);
    setMeasureBaseline(EMPTY_MEASURE);
    setNewMeasureTable(activeTableNames[0] ?? '');
  }, [activeTableNames]);

  const measureDirty = useMemo(
    () => isNewMeasure || JSON.stringify(measureForm) !== JSON.stringify(measureBaseline),
    [isNewMeasure, measureForm, measureBaseline]
  );

  const canSaveMeasure = useMemo(() => {
    if (savingMeasure) return false;
    if (!measureDirty) return false;
    if (!measureForm.name.trim() || !measureForm.expression.trim()) return false;
    if (isNewMeasure && !newMeasureTable) return false;
    return true;
  }, [savingMeasure, measureDirty, measureForm, isNewMeasure, newMeasureTable]);

  // Staged existing-measure edits, ready for a single batch commit.
  const pendingMeasureList = useMemo(() => Object.values(pendingMeasures), [pendingMeasures]);
  const pendingMeasureCount = pendingMeasureList.length;

  // Reload one model into the tree + drop its cached measure expressions.
  const reloadModelAndCache = useCallback(
    async (id: string, name: string) => {
      const data = await loadModelData(workspaceId, id, name);
      setModelEntry(id, data);
      setMeasureExprCache((prev) => {
        const next = { ...prev };
        const pfx = `${id}::`;
        for (const k of Object.keys(next)) if (k.startsWith(pfx)) delete next[k];
        return next;
      });
    },
    [workspaceId, setModelEntry]
  );

  // Patch just-saved measures into the in-memory tree WITHOUT re-querying the
  // server. The DAX and properties we wrote are already known locally, so a full
  // `loadModelData` (many executeQueries + a TMDL getDefinition export) after
  // every save is pure latency. Patching locally keeps saves snappy and leaves
  // the definition-parts cache warm for the next edit.
  const applyLocalMeasureEdits = useCallback(
    (
      id: string,
      edits: { table: string; originalName: string; values: MeasureValues }[]
    ) => {
      setModelsData((prev) =>
        prev.map((m) => {
          if (m.id !== id || !m.data) return m;
          const tables = { ...m.data.tables };
          for (const e of edits) {
            const tbl = tables[e.table];
            if (!tbl) continue;
            const measures = { ...tbl.measures };
            if (e.originalName && e.originalName !== e.values.name) delete measures[e.originalName];
            measures[e.values.name] = {
              expression: e.values.expression,
              formatString: e.values.formatString,
              description: e.values.description,
              displayFolder: e.values.displayFolder,
              isHidden: e.values.isHidden,
            };
            tables[e.table] = { ...tbl, measures };
          }
          return { ...m, data: { ...m.data, tables } };
        })
      );
    },
    []
  );

  const handleSaveMeasure = useCallback(async () => {
    if (!canSaveMeasure) return;
    const id = isNewMeasure ? activeDatasetId : selectedMeasure?.id;
    if (!id) return;
    const table = isNewMeasure ? newMeasureTable : selectedMeasure!.table;
    const originalName = isNewMeasure ? '' : selectedMeasure!.name;
    setSavingMeasure(true);
    setStatus({ msg: isNewMeasure ? 'Creating measure…' : 'Saving measure…', color: GRAY_COLOR });
    try {
      const res = isNewMeasure
        ? await createMeasure(workspaceId, id, table, measureForm)
        : await updateMeasure(workspaceId, id, table, originalName, measureForm);
      // Patch the tree locally instead of a full model reload.
      applyLocalMeasureEdits(id, [{ table, originalName, values: measureForm }]);
      // Seed the cache with the saved DAX so the form keeps showing it.
      setMeasureExprCache((prev) => ({
        ...prev,
        [`${id}::${table}::${measureForm.name}`]: measureForm.expression,
      }));
      setIsNewMeasure(false);
      setSelectedKey(`${id}${MODEL_KEY_SEP}measure:${table}:${measureForm.name}`);
      setMeasureBaseline(measureForm);
      setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
    } catch (err) {
      setStatus({
        msg: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        color: '#ff3b30',
      });
    } finally {
      setSavingMeasure(false);
    }
  }, [
    canSaveMeasure,
    isNewMeasure,
    activeDatasetId,
    selectedMeasure,
    newMeasureTable,
    workspaceId,
    measureForm,
    applyLocalMeasureEdits,
  ]);

  // Commit every staged measure edit. Edits are grouped by model so each model
  // is rewritten with a single TMDL load + save (instead of one per measure).
  const handleSaveAllMeasures = useCallback(async () => {
    if (pendingMeasureList.length === 0 || savingMeasure) return;
    const byModel = new Map<string, { edits: MeasureBatchEdit[] }>();
    for (const p of pendingMeasureList) {
      const g = byModel.get(p.id) ?? { edits: [] };
      g.edits.push({ table: p.table, originalName: p.originalName, values: p.values });
      byModel.set(p.id, g);
    }
    // Remember the current selection's staged edit before we clear the map so we
    // can retarget the tree if the open measure was renamed.
    const curStaged = pendingRef.current[selMeasureId];
    setSavingMeasure(true);
    setStatus({
      msg: `Saving ${pendingMeasureList.length} measure change${pendingMeasureList.length === 1 ? '' : 's'}…`,
      color: GRAY_COLOR,
    });
    try {
      let totalChanged = 0;
      const details: string[] = [];
      for (const [id, group] of byModel) {
        const res = await updateMeasures(workspaceId, id, group.edits);
        totalChanged += res.changed;
        details.push(res.detail);
        // Patch the tree locally instead of a full model reload per model.
        applyLocalMeasureEdits(id, group.edits);
        // Seed the cache with the saved DAX so forms keep showing it.
        setMeasureExprCache((prev) => {
          const next = { ...prev };
          for (const e of group.edits) next[`${id}::${e.table}::${e.values.name}`] = e.values.expression;
          return next;
        });
      }
      if (curStaged) {
        setMeasureBaseline(curStaged.values);
        if (curStaged.values.name !== curStaged.originalName) {
          setSelectedKey(
            `${curStaged.id}${MODEL_KEY_SEP}measure:${curStaged.table}:${curStaged.values.name}`
          );
        }
      }
      setPendingMeasures({});
      setStatus({ msg: details.join(' '), color: totalChanged > 0 ? '#34c759' : '#2563eb' });
    } catch (err) {
      setStatus({
        msg: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        color: '#ff3b30',
      });
    } finally {
      setSavingMeasure(false);
    }
  }, [pendingMeasureList, savingMeasure, selMeasureId, workspaceId, applyLocalMeasureEdits]);

  // Drop every staged measure edit and reset the open form to its model values.
  const handleDiscardAllMeasures = useCallback(() => {
    if (savingMeasure) return;
    setPendingMeasures({});
    setMeasureForm(measureBaseline);
    setConfirmDeleteMeasure(false);
    setStatus({ msg: 'Discarded all staged measure changes.', color: '#2563eb' });
  }, [savingMeasure, measureBaseline]);

  const handleDeleteMeasure = useCallback(async () => {
    if (!selectedMeasure) return;
    const { id, table, name } = selectedMeasure;
    const modelName = modelsData.find((m) => m.id === id)?.name ?? '';
    setSavingMeasure(true);
    setStatus({ msg: 'Deleting measure…', color: GRAY_COLOR });
    try {
      const res = await deleteMeasure(workspaceId, id, table, name);
      await reloadModelAndCache(id, modelName);
      setSelectedKey(null);
      setConfirmDeleteMeasure(false);
      setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
    } catch (err) {
      setStatus({
        msg: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        color: '#ff3b30',
      });
    } finally {
      setSavingMeasure(false);
    }
  }, [selectedMeasure, modelsData, workspaceId, reloadModelAndCache]);

  const handleFormatAll = useCallback(async () => {
    if (!activeDatasetId) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await formatAllMeasures(workspaceId, activeDatasetId);
      setBulkResult({ color: res.changed > 0 ? '#34c759' : '#2563eb', text: res.detail });
      if (res.changed > 0) await reloadModelAndCache(activeDatasetId, activeDatasetName);
    } catch (err) {
      setBulkResult({ color: '#ff3b30', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(false);
    }
  }, [activeDatasetId, activeDatasetName, workspaceId, reloadModelAndCache]);

  const handleFindReplace = useCallback(async () => {
    if (!activeDatasetId) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await findReplaceInMeasures(workspaceId, activeDatasetId, {
        find: frFind,
        replace: frReplace,
        inExpression: frInExpr,
        inName: frInName,
        caseSensitive: frCase,
        useRegex: frRegex,
      });
      setBulkResult({ color: res.changed > 0 ? '#34c759' : '#2563eb', text: res.detail });
      if (res.changed > 0) await reloadModelAndCache(activeDatasetId, activeDatasetName);
    } catch (err) {
      setBulkResult({ color: '#ff3b30', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBulkBusy(false);
    }
  }, [
    activeDatasetId,
    activeDatasetName,
    workspaceId,
    frFind,
    frReplace,
    frInExpr,
    frInName,
    frCase,
    frRegex,
    reloadModelAndCache,
  ]);

  // Resolve the display-folder organize scope for a tree node key. The model
  // node organizes every table; a table / column / measure scopes to that
  // (parent) table.
  const dfScopeForKey = useCallback(
    (key: string | null): { tables: 'all' | string[]; label: string } | null => {
      if (!key) return null;
      const np = splitNsKey(key).bare.split(':');
      if (np[0] === 'model') return { tables: 'all', label: 'the whole model' };
      if (np[0] === 'table') return { tables: [np[1]], label: `table "${np[1]}"` };
      if (np[0] === 'column' || np[0] === 'measure') return { tables: [np[1]], label: `table "${np[1]}"` };
      return null;
    },
    []
  );

  // Auto-organize columns + measures into display folders for the selected
  // scope. This only *proposes* the change: it scans the model, keeps the
  // in-scope assignments, and previews them directly in the tree (objects move
  // into their new folders) without writing anything. The user reviews the tree
  // and commits with the blue Save button — keeping the action fast and visible.
  const handleOrganizeFolders = useCallback(
    async (key: string) => {
      const scope = dfScopeForKey(key);
      const { id } = splitNsKey(key);
      const datasetId = id || activeDatasetId;
      const name = modelsData.find((m) => m.id === datasetId)?.name || activeDatasetName;
      if (!scope || !workspaceId || !datasetId) return;
      setCtxMenu(null);
      setDfBusy(true);
      setStatus({ msg: `Scanning ${scope.label} for display folders…`, color: GRAY_COLOR });
      try {
        const plan = await scanDisplayFolders(workspaceId, datasetId, name, {
          ...DEFAULT_ORGANIZE_OPTIONS,
          // An explicit table/column/measure pick organizes regardless of size.
          tableThreshold: scope.tables === 'all' ? DEFAULT_ORGANIZE_OPTIONS.tableThreshold : 0,
        });
        const assignments =
          scope.tables === 'all'
            ? plan.assignments
            : plan.assignments.filter((a) => (scope.tables as string[]).includes(a.table));
        if (assignments.length === 0) {
          setStatus({
            msg: `No folder-less object families to organize in ${scope.label}.`,
            color: '#2563eb',
          });
          return;
        }
        // Preview in the tree: patch the in-memory model so objects appear in
        // their proposed folders, and expand the affected tables so the change
        // is visible. Nothing is written until the user clicks Save.
        setModelsData((prev) =>
          prev.map((m) => (m.id === datasetId ? { ...m, data: applyFolderAssignments(m.data, assignments) } : m))
        );
        const affectedTables = new Set(assignments.map((a) => a.table));
        setExpanded((prev) => {
          const next = new Set(prev);
          const pfx = datasetId + MODEL_KEY_SEP;
          for (const tName of affectedTables) {
            next.add(pfx + tName);
            const md = modelsData.find((m) => m.id === datasetId)?.data;
            if (md) {
              const patched = applyFolderAssignments(md, assignments);
              for (const fk of foldableTableFolderKeys(patched, tName)) next.add(pfx + fk);
            }
          }
          return next;
        });
        setDfStaged({ datasetId, datasetName: name, assignments });
        setStatus({
          msg: `Proposed ${assignments.length} display-folder change${assignments.length === 1 ? '' : 's'} across ${affectedTables.size} table${affectedTables.size === 1 ? '' : 's'}. Review the tree, then Save.`,
          color: '#2563eb',
        });
      } catch (err) {
        setStatus({
          msg: `Organize failed: ${err instanceof Error ? err.message : String(err)}`,
          color: '#ff3b30',
        });
      } finally {
        setDfBusy(false);
      }
    },
    [dfScopeForKey, workspaceId, activeDatasetId, activeDatasetName, modelsData]
  );

  // Commit the staged display-folder proposal in one TMDL round-trip. The tree
  // already shows the change (previewed on propose), so no reload is needed.
  const handleSaveFolders = useCallback(async () => {
    if (!dfStaged || dfSaving) return;
    const { datasetId, assignments } = dfStaged;
    setDfSaving(true);
    setStatus({ msg: `Saving ${assignments.length} display-folder change(s)…`, color: GRAY_COLOR });
    try {
      const res = await applyDisplayFolders(workspaceId, datasetId, assignments);
      setDfStaged(null);
      setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
    } catch (err) {
      setStatus({
        msg: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        color: '#ff3b30',
      });
    } finally {
      setDfSaving(false);
    }
  }, [dfStaged, dfSaving, workspaceId]);

  // Discard the staged proposal: revert the tree preview (objects back to no
  // folder) and clear the staged plan. Nothing was written, so this is local.
  const handleDiscardFolders = useCallback(() => {
    if (!dfStaged || dfSaving) return;
    const { datasetId, assignments } = dfStaged;
    const reverts = assignments.map((a) => ({ ...a, folder: '' }));
    setModelsData((prev) =>
      prev.map((m) => (m.id === datasetId ? { ...m, data: applyFolderAssignments(m.data, reverts) } : m))
    );
    setDfStaged(null);
    setStatus({ msg: 'Discarded the staged display-folder changes.', color: '#2563eb' });
  }, [dfStaged, dfSaving]);


  // Create the Direct Lake warm-up notebook and open it for a manual "Run all".
  const handleCreateWarm = useCallback(async () => {
    if (!activeDatasetId) return;
    setWarming(true);
    setWarmInfo({ msg: 'Creating warm-up notebook…', color: GRAY_COLOR });
    try {
      const ref = await createWarmNotebook(workspaceId, activeDatasetId, activeDatasetName);
      setWarmInfo({ msg: `Created '${ref.notebookName}' — opening…`, color: '#34c759', url: ref.portalUrl });
      if (ref.portalUrl) window.open(ref.portalUrl, '_blank', 'noopener');
    } catch (err) {
      setWarmInfo({ msg: `Error: ${err instanceof Error ? err.message : String(err)}`, color: '#ff3b30' });
    } finally {
      setWarming(false);
    }
  }, [workspaceId, activeDatasetId, activeDatasetName]);

  // Create the warm-up notebook AND run it on Fabric now, reporting the outcome.
  const handleRunWarm = useCallback(async () => {
    if (!activeDatasetId) return;
    setWarming(true);
    setWarmInfo({ msg: 'Running cache warm-up on Fabric… (this can take a minute)', color: GRAY_COLOR });
    try {
      const res = await runWarmNotebook(workspaceId, activeDatasetId, activeDatasetName);
      const ok = res.run.status === 'Completed';
      const summary = res.summary;
      let msg: string;
      if (summary?.status === 'completed') {
        msg = summary.message || `Warmed ${summary.columns_warmed ?? '?'} column(s).`;
      } else if (summary?.status === 'skipped') {
        msg = summary.message || 'Skipped — not a Direct Lake model.';
      } else if (ok) {
        msg = 'Run completed.';
      } else {
        const reason = res.run.failureReason?.message;
        msg = `Run ${res.run.status}${reason ? `: ${reason}` : ''}.`;
      }
      setWarmInfo({ msg, color: ok ? '#34c759' : '#2563eb', url: res.portalUrl });
    } catch (err) {
      setWarmInfo({ msg: `Error: ${err instanceof Error ? err.message : String(err)}`, color: '#ff3b30' });
    } finally {
      setWarming(false);
    }
  }, [workspaceId, activeDatasetId, activeDatasetName]);

  const handleToggleNode = useCallback((key: string) => {
    const { id, bare } = splitNsKey(key);
    const modelPrefix = id ? id + MODEL_KEY_SEP : '';
    const parts = bare.split(':');
    const nodeType = parts[0];
    let toggleKey: string;
    if (nodeType === 'model') toggleKey = parts[1];
    else if (nodeType === 'table') toggleKey = parts[1];
    else if (nodeType === 'folder' || nodeType === 'colfolder') toggleKey = bare;
    else if (bare.startsWith('rels:')) toggleKey = bare;
    else return;

    const full = modelPrefix + toggleKey;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(full)) next.delete(full);
      else next.add(full);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (option: string) => {
      const key = treeResult.keyMap[option];
      if (!key) return;
      setSelectedKey(key);
      setIsNewMeasure(false);
      handleToggleNode(key);
      const { id, bare } = splitNsKey(key);
      const md = modelsData.find((m) => m.id === id)?.data;
      if (md) {
        const preview = getModelPreviewText(md, bare);
        setPreviewText(preview);
        setDaxRef(getDaxReference(bare));
        if (!preview && bare.startsWith('measure:')) {
          const p = bare.split(':');
          const tableName = p[1] ?? '';
          const measureName = p.length > 2 ? p.slice(2).join(':') : '';
          if (tableName && measureName) void hydrateMeasureExpression(id, tableName, measureName, key);
        }
      }
    },
    [treeResult.keyMap, modelsData, handleToggleNode, hydrateMeasureExpression]
  );

  const handleExpandScope = useCallback(
    (key: string) => {
      const { id, bare } = splitNsKey(key);
      const md = modelsData.find((m) => m.id === id)?.data;
      if (!md) return;
      const parts = bare.split(':');
      const pfx = id + MODEL_KEY_SEP;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (parts[0] === 'model') {
          for (const k of foldableModelKeys(md)) next.add(pfx + k);
        } else if (parts[0] === 'table') {
          const tName = parts[1];
          next.add(pfx + tName);
          for (const k of foldableTableFolderKeys(md, tName)) next.add(pfx + k);
        }
        return next;
      });
    },
    [modelsData]
  );

  const handleCollapseScope = useCallback((key: string) => {
    const { id, bare } = splitNsKey(key);
    const parts = bare.split(':');
    const pfx = id + MODEL_KEY_SEP;
    setExpanded((prev) => {
      if (parts[0] === 'model') {
        const next = new Set<string>();
        for (const k of prev) if (!k.startsWith(pfx)) next.add(k);
        return next;
      }
      if (parts[0] === 'table') {
        const tName = parts[1];
        const tableKey = pfx + tName;
        const fA = `${pfx}folder:${tName}:`;
        const fB = `${pfx}colfolder:${tName}:`;
        const next = new Set<string>();
        for (const k of prev) {
          if (k === tableKey || k.startsWith(fA) || k.startsWith(fB)) continue;
          next.add(k);
        }
        return next;
      }
      return prev;
    });
  }, []);

  const handleCopyRef = useCallback(() => {
    if (daxRef) navigator.clipboard.writeText(daxRef);
  }, [daxRef]);

  // Apply a deterministic BPA fix to the right-clicked object, then reload the
  // owning model so the findings (and the tree dots) refresh.
  const handleApplyFix = useCallback(
    async (finding: BpaFinding) => {
      if (!finding.rule.fixKind || !workspaceId || !selectedKey) return;
      const { id } = splitNsKey(selectedKey);
      const model = modelsData.find((m) => m.id === id);
      if (!id || !model) return;
      setCtxMenu(null);
      setFixing(true);
      setStatus({ msg: `Applying fix: ${finding.rule.name}\u2026`, color: GRAY_COLOR });
      try {
        const res = await applyModelBpaFix(
          workspaceId,
          id,
          finding.rule.fixKind,
          finding.objectPath
        );
        const data = await loadModelData(workspaceId, id, model.name);
        setModelEntry(id, data);
        setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
      } catch (err) {
        setStatus({
          msg: `Fix failed: ${err instanceof Error ? err.message : String(err)}`,
          color: '#ff3b30',
        });
      } finally {
        setFixing(false);
      }
    },
    [workspaceId, selectedKey, modelsData, setModelEntry]
  );

  // Trigger an enhanced refresh for the right-clicked node. `model:` refreshes
  // the whole model; `table:` refreshes that table; `partition:` refreshes a
  // single partition. The refresh runs server-side after the request is
  // accepted, so we report "started" without reloading the tree.
  const handleRefresh = useCallback(
    async (key: string, type: RefreshType = 'full') => {
      const { id, bare } = splitNsKey(key);
      const datasetId = id || activeDatasetId;
      if (!workspaceId || !datasetId) return;
      const parts = bare.split(':');
      let objects: RefreshObject[] | undefined;
      if (parts[0] === 'table' || parts[0] === 'column') objects = [{ table: parts[1] }];
      else if (parts[0] === 'partition') objects = [{ table: parts[1], partition: parts.slice(2).join(':') }];
      setCtxMenu(null);
      setRefreshing(true);
      setStatus({ msg: 'Requesting refresh\u2026', color: GRAY_COLOR });
      try {
        const res = await triggerRefresh(workspaceId, datasetId, objects, type);
        setStatus({ msg: res.detail, color: '#34c759' });
      } catch (err) {
        setStatus({
          msg: `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          color: '#ff3b30',
        });
      } finally {
        setRefreshing(false);
      }
    },
    [workspaceId, activeDatasetId]
  );

  // Persist a single edited property on the selected column / table / measure,
  // then reload the owning model so the tree + properties reflect the saved state.
  const handleEditProperty = useCallback(
    async (
      kind: 'column' | 'measure' | 'table' | 'model',
      table: string,
      name: string,
      prop: string,
      value: string | boolean
    ) => {
      if (!workspaceId || !selectedKey) return;
      const { id } = splitNsKey(selectedKey);
      const model = modelsData.find((m) => m.id === id);
      if (!id || !model) return;
      setSavingProp(true);
      setStatus({ msg: `Updating ${prop}\u2026`, color: GRAY_COLOR });
      try {
        const res =
          kind === 'measure'
            ? await setMeasureProperty(workspaceId, id, table, name, prop, value)
            : kind === 'column'
              ? await setColumnProperty(workspaceId, id, table, name, prop, value)
              : kind === 'model'
                ? await setModelProperty(workspaceId, id, prop, value)
                : await setTableProperty(workspaceId, id, table, prop, value);
        // Optimistic update: patch the changed field in-memory and skip the
        // full model reload. The save result is authoritative, so a metadata
        // edit no longer pays for a getDefinition export + INFO.VIEW requery.
        if (res.changed > 0) {
          setModelsData((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, data: patchModelProperty(m.data, kind, table, name, prop, value) }
                : m
            )
          );
        }
        setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
      } catch (err) {
        setStatus({
          msg: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
          color: '#ff3b30',
        });
      } finally {
        setSavingProp(false);
      }
    },
    [workspaceId, selectedKey, modelsData]
  );

  // Editable M expression for the selected table's import partition (null when
  // the node is not a table, or the table has no M / Power Query partition).
  const tableExpr = useMemo(() => {
    if (!selectedKey) return null;
    const { id, bare } = splitNsKey(selectedKey);
    if (!bare.startsWith('table:')) return null;
    const table = bare.split(':')[1] ?? '';
    const t = modelsData.find((m) => m.id === id)?.data?.tables[table];
    const p = t?.partitions?.find((part) => part.expression && part.expression.trim() !== '');
    if (!p) return null;
    return { id, table, original: p.expression };
  }, [selectedKey, modelsData]);

  // Persist the edited M expression back onto the table's partition, then reload
  // the owning model so the tree + preview reflect the saved source.
  const handleSaveExpression = useCallback(async () => {
    if (!tableExpr || !workspaceId) return;
    const { id, table } = tableExpr;
    const model = modelsData.find((m) => m.id === id);
    if (!model) return;
    setSavingExpr(true);
    setStatus({ msg: `Saving M expression for ${table}\u2026`, color: GRAY_COLOR });
    try {
      const res = await setPartitionExpression(workspaceId, id, table, previewText);
      const data = await loadModelData(workspaceId, id, model.name);
      setModelEntry(id, data);
      setStatus({ msg: res.detail, color: res.changed > 0 ? '#34c759' : '#2563eb' });
    } catch (err) {
      setStatus({
        msg: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        color: '#ff3b30',
      });
    } finally {
      setSavingExpr(false);
    }
  }, [tableExpr, workspaceId, modelsData, previewText, setModelEntry]);

  // Use GitHub Copilot to add one short `//` comment before each M step. The AI
  // only describes each step — the original M is never altered, only annotated.
  // Drives the GitHub device-flow sign-in first if needed. The annotated text
  // is staged in the textarea; the user reviews and Saves explicitly.
  const handleCommentSteps = useCallback(async () => {
    if (!tableExpr) return;
    setCommenting(true);
    try {
      if (!isGithubSignedIn()) {
        setStatus({ msg: 'GitHub sign-in required\u2026', color: GRAY_COLOR });
        const handle = await startGithubDeviceFlow();
        setGhFlow(handle);
        try {
          window.open(handle.verificationUri, '_blank', 'noopener');
        } catch {
          /* popup blocked — user can use the code below manually */
        }
        setStatus({
          msg: `Enter code ${handle.userCode} at ${handle.verificationUri} to authorize GitHub\u2026`,
          color: '#2563eb',
        });
        await handle.completion;
        setGhFlow(null);
      }
      setStatus({ msg: 'Generating step comments\u2026', color: GRAY_COLOR });
      const { text, stepCount, inserted } = await commentMExpression(previewText);
      if (stepCount === 0) {
        setStatus({ msg: 'No M steps found to comment.', color: '#2563eb' });
        return;
      }
      setPreviewText(text);
      setStatus({
        msg: `Added ${inserted} comment${inserted === 1 ? '' : 's'} across ${stepCount} step${stepCount === 1 ? '' : 's'}. Review, then Save.`,
        color: '#34c759',
      });
    } catch (err) {
      const msg =
        err instanceof GithubAuthRequiredError
          ? 'GitHub sign-in is required to generate comments.'
          : `Comment generation failed: ${err instanceof Error ? err.message : String(err)}`;
      setStatus({ msg, color: '#ff3b30' });
    } finally {
      setGhFlow(null);
      setCommenting(false);
    }
  }, [tableExpr, previewText]);

  // Load a TOP 100 preview for the table identified by a namespaced tree key.
  const handleLoadTablePreview = useCallback(
    async (nsKey: string) => {
      const { id, bare } = splitNsKey(nsKey);
      const tableName = bare.split(':')[1] ?? '';
      if (!workspaceId || !id || !tableName) return;
      const pk = `${id}::${tableName}`;
      setTablePreview((prev) => ({ ...prev, [pk]: { loading: true, rows: [], error: null } }));
      try {
        const escName = tableName.replace(/'/g, "''");
        const rows = await executeDax(workspaceId, id, `EVALUATE TOPN(100, '${escName}')`);
        setTablePreview((prev) => ({ ...prev, [pk]: { loading: false, rows, error: null } }));
      } catch (err) {
        setTablePreview((prev) => ({
          ...prev,
          [pk]: {
            loading: false,
            rows: [],
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [workspaceId]
  );

  const propertiesContent = useMemo(() => {
    if (!selectedKey) return null;
    const { id, bare } = splitNsKey(selectedKey);
    const modelData = modelsData.find((m) => m.id === id)?.data;
    if (!modelData) return null;
    const parts = bare.split(':');
    const nodeType = parts[0];
    const tableName = parts[1] ?? '';

    if (nodeType === 'column') {
      const c = modelData.tables[parts[1]]?.columns[parts[2]];
      if (!c) return null;
      return (
        <>
          <PropGroupLabel label="General" />
          <PropRow label="Table" value={parts[1]} />
          <PropRow label="Name" value={parts[2]} />
          <EditSelectRow
            label="Data Type"
            value={c.dataType || 'string'}
            options={DATATYPE_OPTIONS}
            disabled={savingProp || !!c.expression}
            onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'dataType', v)}
          />
          <PropRow label="Column Type" value={c.type} />
          <EditSelectRow
            label="Summarize By"
            value={normalizeSummarizeBy(c.summarizeBy)}
            options={SUMMARIZE_OPTIONS}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'summarizeBy', v)}
          />
          <EditTextRow
            label="Format String"
            value={c.formatString ?? ''}
            placeholder="(default)"
            disabled={savingProp}
            onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'formatString', v)}
          />
          <EditTextRow
            label="Display Folder"
            value={c.displayFolder}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'displayFolder', v)}
          />
          <EditBoolRow
            label="Hidden"
            value={c.isHidden}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'isHidden', v)}
          />
          {showAdvanced && (
            <>
              <PropGroupLabel label="Advanced" />
              <EditBoolRow
                label="Is Key"
                value={c.isKey}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'isKey', v)}
              />
              <EditBoolRow
                label="Is Available In MDX"
                value={c.isAvailableInMdx ?? true}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'isAvailableInMdx', v)}
              />
              <EditTextRow
                label="Data Category"
                value={c.dataCategory}
                placeholder="(none)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'dataCategory', v)}
              />
              <EditTextRow
                label="Sort By"
                value={c.sortByColumn}
                placeholder="(column name)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'sortByColumn', v)}
              />
              <EditTextRow
                label="Lineage Tag"
                value={c.lineageTag ?? ''}
                placeholder="(auto)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'lineageTag', v)}
              />
              <EditTextRow
                label="Source Lineage Tag"
                value={c.sourceLineageTag ?? ''}
                placeholder="(none)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('column', parts[1], parts[2], 'sourceLineageTag', v)}
              />
              <PropGroupLabel label="Advanced (read-only)" />
              <PropRow label="Encoding Hint" value={c.encodingHint || 'Default'} />
              <PropRow label="Nullable" value={c.isNullable ? 'Yes' : 'No'} />
              <PropTextBlock label="Calculated Expression" value={c.expression ?? ''} />
            </>
          )}
        </>
      );
    }
    if (nodeType === 'table') {
      const t = modelData.tables[parts[1]];
      if (!t) return null;
      return (
        <>
          <PropGroupLabel label="General" />
          <PropRow label="Name" value={parts[1]} />
          <PropRow label="Type" value={t.type} />
          <EditTextRow
            label="Description"
            value={t.description}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('table', parts[1], parts[1], 'description', v)}
          />
          <EditBoolRow
            label="Hidden"
            value={t.isHidden}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('table', parts[1], parts[1], 'isHidden', v)}
          />
          {showAdvanced && (
            <>
              <PropGroupLabel label="Options" />
              <EditTextRow
                label="Data Category"
                value={t.dataCategory ?? ''}
                placeholder="(none)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('table', parts[1], parts[1], 'dataCategory', v)}
              />
              <EditBoolRow
                label="Private"
                value={t.isPrivate ?? false}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('table', parts[1], parts[1], 'isPrivate', v)}
              />
              <EditBoolRow
                label="Exclude From Model Refresh"
                value={t.excludeFromModelRefresh ?? false}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('table', parts[1], parts[1], 'excludeFromModelRefresh', v)
                }
              />
              <EditBoolRow
                label="Exclude From Automatic Aggregations"
                value={t.excludeFromAutomaticAggregations ?? false}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty(
                    'table',
                    parts[1],
                    parts[1],
                    'excludeFromAutomaticAggregations',
                    v
                  )
                }
              />
              <EditBoolRow
                label="Show As Variations Only"
                value={t.showAsVariationsOnly ?? false}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('table', parts[1], parts[1], 'showAsVariationsOnly', v)
                }
              />
              <EditTextRow
                label="Lineage Tag"
                value={t.lineageTag ?? ''}
                placeholder="(auto)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('table', parts[1], parts[1], 'lineageTag', v)}
              />
              <EditTextRow
                label="Source Lineage Tag"
                value={t.sourceLineageTag ?? ''}
                placeholder="(none)"
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('table', parts[1], parts[1], 'sourceLineageTag', v)
                }
              />
              <PropGroupLabel label="Advanced (read-only)" />
              <PropRow label="Columns" value={String(Object.keys(t.columns).length)} />
              <PropRow label="Measures" value={String(Object.keys(t.measures).length)} />
              <PropRow label="Partitions" value={String(t.partitions?.length ?? 0)} />
              {(t.partitions ?? []).map((p) => (
                <PropRow
                  key={p.name}
                  label={`Partition · ${p.name}`}
                  value={p.sourceType || '(unknown)'}
                />
              ))}
            </>
          )}
        </>
      );
    }
    if (nodeType === 'model') {
      const mp = modelData.modelProperties;
      return (
        <>
          <PropGroupLabel label="General" />
          <PropRow label="Name" value={modelData.datasetName || tableName} />
          <PropRow label="Compatibility Level" value={mp.compatibilityLevel} />
          <EditSelectRow
            label="Default Mode"
            value={(mp.defaultMode || 'import').replace(/^([A-Z])/, (m) => m.toLowerCase())}
            options={DEFAULTMODE_OPTIONS}
            disabled={savingProp}
            onSave={(v) => handleEditProperty('model', '', '', 'defaultMode', v)}
          />
          <EditTextRow
            label="Culture"
            value={mp.culture ?? ''}
            placeholder="(e.g. en-US)"
            disabled={savingProp}
            onSave={(v) => handleEditProperty('model', '', '', 'culture', v)}
          />
          {showAdvanced && (
            <>
              <PropGroupLabel label="Data Access Options" />
              <EditBoolRow
                label="Enable Fast Combine"
                value={mp.fastCombine ?? false}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'fastCombine', v)}
              />
              <EditBoolRow
                label="Enable Legacy Redirects"
                value={mp.legacyRedirects ?? false}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'legacyRedirects', v)}
              />
              <EditBoolRow
                label="Return Error Values As Null"
                value={mp.returnErrorValuesAsNull ?? false}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'returnErrorValuesAsNull', v)}
              />
              <PropGroupLabel label="Options" />
              <EditTextRow
                label="Collation"
                value={mp.collation ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'collation', v)}
              />
              <EditTextRow
                label="Source Query Culture"
                value={mp.sourceQueryCulture ?? ''}
                placeholder="(inherits Culture)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'sourceQueryCulture', v)}
              />
              <EditSelectRow
                label="Default Data View"
                value={mp.defaultDataView ?? 'full'}
                options={DEFAULTDATAVIEW_OPTIONS}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'defaultDataView', v)}
              />
              <EditSelectRow
                label="Default Power BI Data Source Version"
                value={mp.defaultPowerBIDataSourceVersion ?? 'powerBI_V3'}
                options={PBI_DATASOURCE_VERSION_OPTIONS}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('model', '', '', 'defaultPowerBIDataSourceVersion', v)
                }
              />
              <EditSelectRow
                label="Direct Lake Behavior"
                value={mp.directLakeBehavior ?? 'automatic'}
                options={DIRECTLAKE_BEHAVIOR_OPTIONS}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'directLakeBehavior', v)}
              />
              <EditSelectRow
                label="Data Source Variables Override Behavior"
                value={mp.dataSourceVariablesOverrideBehavior ?? 'disallow'}
                options={DSV_OVERRIDE_OPTIONS}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('model', '', '', 'dataSourceVariablesOverrideBehavior', v)
                }
              />
              <EditTextRow
                label="Default Measure"
                value={mp.defaultMeasure ?? ''}
                placeholder="(none)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'defaultMeasure', v)}
              />
              <EditTextRow
                label="Storage Location"
                value={mp.storageLocation ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'storageLocation', v)}
              />
              <EditTextRow
                label="Max Parallelism Per Query"
                value={mp.maxParallelismPerQuery ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'maxParallelismPerQuery', v)}
              />
              <EditTextRow
                label="Max Parallelism Per Refresh"
                value={mp.maxParallelismPerRefresh ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'maxParallelismPerRefresh', v)}
              />
              <EditTextRow
                label="Data Source Default Max Connections"
                value={mp.dataSourceDefaultMaxConnections ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('model', '', '', 'dataSourceDefaultMaxConnections', v)
                }
              />
              <EditTextRow
                label="Disable Auto Exists"
                value={mp.disableAutoExists ?? ''}
                placeholder="(default)"
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'disableAutoExists', v)}
              />
              <EditBoolRow
                label="Discourage Implicit Measures"
                value={mp.discourageImplicitMeasures ?? false}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('model', '', '', 'discourageImplicitMeasures', v)
                }
              />
              <EditBoolRow
                label="Discourage Composite Models"
                value={mp.discourageCompositeModels ?? false}
                disabled={savingProp}
                onSave={(v) =>
                  handleEditProperty('model', '', '', 'discourageCompositeModels', v)
                }
              />
              <EditBoolRow
                label="Force Unique Names"
                value={mp.forceUniqueNames ?? false}
                disabled={savingProp}
                onSave={(v) => handleEditProperty('model', '', '', 'forceUniqueNames', v)}
              />
              <PropGroupLabel label="Advanced (read-only)" />
              <PropRow label="Tables" value={String(Object.keys(modelData.tables).length)} />
              <PropRow label="Relationships" value={String(modelData.relationships.length)} />
              <PropRow label="Perspectives" value={String(modelData.perspectives.length)} />
            </>
          )}
        </>
      );
    }
    return null;
  }, [selectedKey, modelsData, savingProp, showAdvanced, handleEditProperty]);

  const dfSelScope = dfScopeForKey(selectedKey);

  return (
    <div className={styles.root}>
      <TabList
        selectedValue={viewTab}
        onTabSelect={(_, d) => setViewTab(d.value as typeof viewTab)}
        size="small"
      >
        <Tab value="explorer">Explorer</Tab>
        <Tab value="tmdl" disabled={!tabDatasetId}>
          TMDL
        </Tab>
        <Tab value="translations" disabled={!tabDatasetId}>
          Translations
        </Tab>
        <Tab value="memory" disabled={!tabDatasetId}>
          Memory Analyzer
        </Tab>
        <Tab value="bpa" disabled={!tabDatasetId}>
          Model BPA
        </Tab>
      </TabList>
      {viewTab === 'tmdl' && tabDatasetId && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <DefinitionSource workspaceId={workspaceId} datasetId={tabDatasetId} only="model" />
        </div>
      )}
      {viewTab === 'translations' && (
        <Suspense fallback={<Spinner label="Loading translations…" />}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TranslationsTab workspaceId={workspaceId} datasetId={tabDatasetId} datasetName={tabDatasetName} />
          </div>
        </Suspense>
      )}
      {viewTab === 'memory' && (
        <Suspense fallback={<Spinner label="Loading memory analyzer…" />}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <MemoryAnalyzer workspaceId={workspaceId} datasetId={tabDatasetId} datasetName={tabDatasetName} />
          </div>
        </Suspense>
      )}
      {viewTab === 'bpa' && (
        <Suspense fallback={<Spinner label="Loading Model BPA…" />}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ModelBpa workspaceId={workspaceId} datasetId={tabDatasetId} datasetName={tabDatasetName} />
          </div>
        </Suspense>
      )}
      <div style={{ display: viewTab === 'explorer' ? 'contents' : 'none' }}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : undefined}
          onClick={handleLoad}
          disabled={loading || models.length === 0}
        >
          {loading ? 'Loading…' : 'Load Model'}
        </Button>
        <Tooltip content="Create a new measure on the selected model" relationship="label">
          <Button
            appearance="subtle"
            icon={<Add20Regular />}
            onClick={startNewMeasure}
            disabled={modelsData.length === 0}
          >
            New measure
          </Button>
        </Tooltip>
        <Tooltip content="Format every measure's DAX in the selected model" relationship="label">
          <Button
            appearance="subtle"
            icon={bulkBusy ? <Spinner size="tiny" /> : <TextGrammarWand20Regular />}
            onClick={handleFormatAll}
            disabled={!activeDatasetId || bulkBusy}
          >
            Format all
          </Button>
        </Tooltip>
        <Tooltip content="Find &amp; replace across measure expressions / names" relationship="label">
          <Button
            appearance={bulkOpen ? 'primary' : 'subtle'}
            icon={<ArrowSwap20Regular />}
            onClick={() => setBulkOpen((v) => !v)}
            disabled={!activeDatasetId}
          >
            Find &amp; replace
          </Button>
        </Tooltip>
        <Tooltip
          content={
            dfSelScope
              ? `Propose display folders for ${dfSelScope.label} — preview in the tree, then Save`
              : 'Select the model, a table, column or measure to propose its display folders'
          }
          relationship="label"
        >
          <Button
            appearance="subtle"
            icon={dfBusy ? <Spinner size="tiny" /> : <FolderSwap20Regular />}
            onClick={() => selectedKey && void handleOrganizeFolders(selectedKey)}
            disabled={!dfSelScope || dfBusy}
          >
            Organize display folders
          </Button>
        </Tooltip>
        {isDirectLake && (
          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Tooltip
                content="Pre-load Direct Lake columns into memory so users hit a warm cache"
                relationship="label"
              >
                <MenuButton
                  appearance="subtle"
                  icon={warming ? <Spinner size="tiny" /> : <Flash20Regular />}
                  disabled={warming || !activeDatasetId}
                >
                  Warm Direct Lake
                </MenuButton>
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem onClick={handleRunWarm}>Run on Fabric now</MenuItem>
                <MenuItem onClick={handleCreateWarm}>Create + open notebook</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
        {status.msg && (
          <span className={styles.statusBar} style={{ background: `${status.color}1a`, color: status.color }}>
            {status.msg}
          </span>
        )}
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
              disabled={!activeDatasetId || bulkBusy || !frFind.trim() || (!frInExpr && !frInName)}
              onClick={handleFindReplace}
            >
              Replace in measures
            </Button>
          </div>
          <span className={styles.mHint}>
            Renames change only the measure declaration — references in other DAX are not rewritten.
          </span>
        </div>
      )}

      {bulkResult && (
        <div
          className={styles.statusBar}
          style={{ background: `${bulkResult.color}1a`, color: bulkResult.color }}
        >
          {bulkResult.text}
        </div>
      )}

      {warmInfo && (
        <div
          className={styles.statusBar}
          style={{
            background: `${warmInfo.color}1a`,
            color: warmInfo.color,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Flash20Regular />
          <span style={{ flex: 1 }}>{warmInfo.msg}</span>
          {warmInfo.url && (
            <Button
              appearance="transparent"
              size="small"
              icon={<Open20Regular />}
              onClick={() => window.open(warmInfo.url!, '_blank', 'noopener')}
            >
              Open notebook
            </Button>
          )}
        </div>
      )}

      <div className={styles.mainLayout}>
        <div className={styles.treePanel}>
          <Input
            placeholder="Filter tree..."
            value={searchQuery}
            onChange={(_, data) => setSearchQuery(data.value)}
            contentBefore={<Search20Regular />}
          />
          <div className={styles.treeList}>
            {filteredOptions.map((option) => {
              const key = treeResult.keyMap[option];
              const iconKey = treeResult.iconMap[option];
              const isSelected = key === selectedKey;
              const indentMatch = option.match(/^[\u00A0]*/);
              const indent = indentMatch ? indentMatch[0] : '';
              const labelText = option.slice(indent.length);
              const path = key ? objectPathForKey(key) : null;
              const hasFix = !!path && fixablePaths.has(path);
              const hasIssue = !!path && issuePaths.has(path);
              const isStagedFolder = !!path && dfPendingPaths.has(path);
              return (
                <div
                  key={option}
                  className={`${styles.treeItem} ${isSelected ? styles.treeItemSelected : ''}`}
                  onClick={() => handleSelect(option)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (key) {
                      setSelectedKey(key);
                      setCtxMenu({ x: e.clientX, y: e.clientY, key });
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {iconKey === 'table' ? (
                    <>
                      <span style={{ whiteSpace: 'pre' }}>{indent}</span>
                      <Table20Regular primaryFill={ICON_ACCENT} style={{ flexShrink: 0 }} />
                      <span>{labelText}</span>
                    </>
                  ) : (
                    <span>{option}</span>
                  )}
                  {hasIssue && (
                    <span
                      title={
                        hasFix
                          ? 'Fixes available — right-click'
                          : 'Issues found — right-click'
                      }
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: hasFix ? ICON_ACCENT : GRAY_COLOR,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  {isStagedFolder && (
                    <span
                      title="Staged display-folder change — Save to apply"
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: '#2563eb',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </div>
              );
            })}
            {filteredOptions.length === 0 && !loading && (
              <div
                style={{
                  padding: '20px',
                  color: GRAY_COLOR,
                  textAlign: 'center',
                  fontStyle: 'italic',
                  fontFamily: FONT_FAMILY,
                }}
              >
                {modelsData.length > 0 ? 'No matching items' : 'Click Load Model to explore'}
              </div>
            )}
          </div>
        </div>

        <div className={styles.rightPanel}>
          {pendingMeasureCount > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '8px',
                borderRadius: '6px',
                background: '#fff7e6',
                border: '1px solid #ffd591',
                fontFamily: FONT_FAMILY,
                fontSize: '13px',
              }}
            >
              <span style={{ color: '#8a5a00' }}>
                {pendingMeasureCount} unsaved measure change{pendingMeasureCount === 1 ? '' : 's'} staged
              </span>
              <div className={styles.grow} />
              <Button
                appearance="primary"
                size="small"
                icon={savingMeasure ? <Spinner size="tiny" /> : <Save20Regular />}
                disabled={savingMeasure}
                onClick={handleSaveAllMeasures}
              >
                Save all ({pendingMeasureCount})
              </Button>
              <Button
                appearance="subtle"
                size="small"
                disabled={savingMeasure}
                onClick={handleDiscardAllMeasures}
              >
                Discard all
              </Button>
            </div>
          )}
          {dfStaged && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '8px',
                borderRadius: '6px',
                background: '#e8f0fe',
                border: '1px solid #aecbfa',
                fontFamily: FONT_FAMILY,
                fontSize: '13px',
              }}
            >
              <FolderSwap20Regular primaryFill="#2563eb" style={{ flexShrink: 0 }} />
              <span style={{ color: '#1a4480' }}>
                {dfStaged.assignments.length} display-folder change
                {dfStaged.assignments.length === 1 ? '' : 's'} proposed — shown in the tree (blue dots)
              </span>
              <div className={styles.grow} />
              <Button
                appearance="primary"
                size="small"
                icon={dfSaving ? <Spinner size="tiny" /> : <Save20Regular />}
                disabled={dfSaving}
                onClick={handleSaveFolders}
              >
                Save ({dfStaged.assignments.length})
              </Button>
              <Button
                appearance="subtle"
                size="small"
                disabled={dfSaving}
                onClick={handleDiscardFolders}
              >
                Discard
              </Button>
            </div>
          )}
          {isNewMeasure || selectedMeasure ? (
            <div className={styles.measurePanel}>
              <div className={styles.measureHead}>
                <Calculator20Regular primaryFill={ICON_ACCENT} />
                <span className={styles.measureTitle}>
                  {isNewMeasure
                    ? 'New measure'
                    : `${selectedMeasure!.table}[${selectedMeasure!.name}]`}
                </span>
                <div className={styles.grow} />
                <Tooltip content="Close editor" relationship="label">
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss20Regular />}
                    onClick={() => {
                      setIsNewMeasure(false);
                      setSelectedKey(null);
                      setConfirmDeleteMeasure(false);
                    }}
                  />
                </Tooltip>
              </div>

              {isNewMeasure && (
                <div className={styles.mField}>
                  <span className={styles.mLabel}>Table</span>
                  <Dropdown
                    value={newMeasureTable}
                    selectedOptions={newMeasureTable ? [newMeasureTable] : []}
                    onOptionSelect={(_, d) => setNewMeasureTable(d.optionValue ?? '')}
                    placeholder="Select a table…"
                  >
                    {activeTableNames.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              )}

              <div className={styles.mField}>
                <span className={styles.mLabel}>Name</span>
                <Input
                  value={measureForm.name}
                  onChange={(_, d) => patchMeasure({ name: d.value })}
                  disabled={savingMeasure}
                  placeholder="Measure name"
                />
              </div>

              <div className={styles.mField}>
                <div className={styles.mRow}>
                  <span className={styles.mLabel}>DAX expression</span>
                  <div className={styles.grow} />
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<TextGrammarWand20Regular />}
                    disabled={savingMeasure || !measureForm.expression.trim()}
                    onClick={() => patchMeasure({ expression: formatDax(measureForm.expression) })}
                  >
                    Format
                  </Button>
                </div>
                <Textarea
                  className={styles.mDax}
                  value={measureForm.expression}
                  onChange={(_, d) => patchMeasure({ expression: d.value })}
                  disabled={savingMeasure}
                  resize="vertical"
                  placeholder="= SUM ( Table[Column] )"
                  textarea={{ style: { fontFamily: 'monospace', fontSize: '12px' } }}
                />
              </div>

              <div className={styles.mRow}>
                <div className={styles.mRowItem}>
                  <span className={styles.mLabel}>Format string</span>
                  <Input
                    value={measureForm.formatString}
                    onChange={(_, d) => patchMeasure({ formatString: d.value })}
                    disabled={savingMeasure}
                    placeholder="#,0.00"
                  />
                </div>
                <div className={styles.mRowItem}>
                  <span className={styles.mLabel}>Display folder</span>
                  <Input
                    value={measureForm.displayFolder}
                    onChange={(_, d) => patchMeasure({ displayFolder: d.value })}
                    disabled={savingMeasure}
                    placeholder="Folder\\Subfolder"
                  />
                </div>
              </div>

              <div className={styles.mField}>
                <span className={styles.mLabel}>Description</span>
                <Textarea
                  value={measureForm.description}
                  onChange={(_, d) => patchMeasure({ description: d.value })}
                  disabled={savingMeasure}
                  resize="vertical"
                  placeholder="Optional description"
                />
              </div>

              <Switch
                label="Hidden"
                checked={measureForm.isHidden}
                onChange={(_, d) => patchMeasure({ isHidden: d.checked })}
                disabled={savingMeasure}
              />

              <div className={styles.mActions}>
                {isNewMeasure ? (
                  <Button
                    appearance="primary"
                    icon={savingMeasure ? <Spinner size="tiny" /> : <Save20Regular />}
                    disabled={!canSaveMeasure}
                    onClick={handleSaveMeasure}
                  >
                    Create measure
                  </Button>
                ) : (
                  <Button
                    appearance="primary"
                    icon={savingMeasure ? <Spinner size="tiny" /> : <Save20Regular />}
                    disabled={savingMeasure || pendingMeasureCount === 0}
                    onClick={handleSaveAllMeasures}
                  >
                    {pendingMeasureCount > 0 ? `Save all (${pendingMeasureCount})` : 'Save all'}
                  </Button>
                )}
                <Button
                  appearance="subtle"
                  disabled={savingMeasure || !measureDirty}
                  onClick={() => {
                    setMeasureForm(measureBaseline);
                    setConfirmDeleteMeasure(false);
                  }}
                >
                  Revert
                </Button>
                <div className={styles.grow} />
                {!isNewMeasure &&
                  (confirmDeleteMeasure ? (
                    <>
                      <span className={styles.mHint}>Delete this measure?</span>
                      <Button
                        appearance="primary"
                        icon={<Delete20Regular />}
                        disabled={savingMeasure}
                        onClick={handleDeleteMeasure}
                        style={{ background: '#ff3b30', borderColor: '#ff3b30' }}
                      >
                        Confirm
                      </Button>
                      <Button
                        appearance="subtle"
                        disabled={savingMeasure}
                        onClick={() => setConfirmDeleteMeasure(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      appearance="subtle"
                      icon={<Delete20Regular />}
                      disabled={savingMeasure}
                      onClick={() => setConfirmDeleteMeasure(true)}
                    >
                      Delete
                    </Button>
                  ))}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.previewPanel}>
                <div className={styles.sectionLabel}>Expression</div>
                {daxRef && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <code style={{ fontSize: '12px', color: '#555' }}>{daxRef}</code>
                    <Tooltip content="Copy DAX reference" relationship="label">
                      <Button appearance="subtle" size="small" icon={<Copy20Regular />} onClick={handleCopyRef} />
                    </Tooltip>
                  </div>
                )}
                <Textarea
                  value={previewText}
                  readOnly={!tableExpr}
                  onChange={tableExpr ? (_, d) => setPreviewText(d.value) : undefined}
                  resize="vertical"
                  style={{ width: '100%', flex: 1, minHeight: '120px', display: 'flex' }}
                  textarea={{ style: { height: '100%', fontFamily: 'monospace', fontSize: '12px' } }}
                  placeholder={
                    tableExpr
                      ? 'Edit the table M (Power Query) expression…'
                      : measureExprLoading
                        ? 'Loading measure definition from model…'
                        : 'Select a measure to view its DAX expression.'
                  }
                />
                {tableExpr && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <Button
                      appearance="primary"
                      size="small"
                      icon={savingExpr ? <Spinner size="tiny" /> : <Save20Regular />}
                      disabled={savingExpr || previewText === tableExpr.original}
                      onClick={handleSaveExpression}
                    >
                      Save Expression
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      disabled={savingExpr || previewText === tableExpr.original}
                      onClick={() => setPreviewText(tableExpr.original)}
                    >
                      Revert
                    </Button>
                    <Tooltip
                      content="Use GitHub Copilot to add one // comment before each M step. Only comments are added — your M code is never changed."
                      relationship="label"
                    >
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={commenting ? <Spinner size="tiny" /> : <CommentAdd20Regular />}
                        disabled={commenting || savingExpr}
                        onClick={handleCommentSteps}
                      >
                        {ghFlow ? `Authorize: ${ghFlow.userCode}` : 'Comment Steps (AI)'}
                      </Button>
                    </Tooltip>
                  </div>
                )}
              </div>

              <div className={styles.propertiesPanel}>
                <div className={styles.propsHeader}>
                  <div className={styles.sectionLabel}>Properties</div>
                  {propertiesContent && (
                    <Switch
                      label="Advanced"
                      checked={showAdvanced}
                      onChange={(_, d) => setShowAdvanced(d.checked)}
                    />
                  )}
                </div>
                {propertiesContent ?? (
                  <div style={{ padding: '12px', color: GRAY_COLOR, fontSize: '13px', fontStyle: 'italic' }}>
                    Select an object to view properties
                  </div>
                )}
                {selectedKey && splitNsKey(selectedKey).bare.startsWith('table:') &&
                  (() => {
                    const { id, bare } = splitNsKey(selectedKey);
                    const tName = bare.split(':')[1];
                    const preview = tablePreview[`${id}::${tName}`];
                    if (!preview) return null;
                    return (
                      <div style={{ marginTop: '12px' }}>
                        <div className={styles.sectionLabel}>Data Preview (TOP 100)</div>
                        {preview.loading && <Spinner size="tiny" label="Loading rows…" />}
                        {preview.error && (
                          <div style={{ color: '#ff3b30', fontSize: '12px' }}>{preview.error}</div>
                        )}
                        {!preview.loading && !preview.error && preview.rows.length > 0 && (
                          <div style={{ overflowX: 'auto', maxHeight: '260px', overflowY: 'auto' }}>
                            <table
                              style={{
                                borderCollapse: 'collapse',
                                fontSize: '12px',
                                fontFamily: 'monospace',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <thead>
                                <tr>
                                  {Object.keys(preview.rows[0]).map((col) => (
                                    <th
                                      key={col}
                                      style={{
                                        border: `1px solid ${BORDER_COLOR}`,
                                        padding: '3px 8px',
                                        background: `linear-gradient(${ICON_ACCENT}22, ${ICON_ACCENT}22), ${PANEL_BG}`,
                                        backgroundClip: 'padding-box',
                                        textAlign: 'left',
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 1,
                                      }}
                                    >
                                      {col.replace(/^[^[]*\[|\]$/g, '')}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {preview.rows.map((row, i) => (
                                  <tr key={i}>
                                    {Object.keys(preview.rows[0]).map((col) => (
                                      <td
                                        key={col}
                                        style={{ border: `1px solid ${BORDER_COLOR}`, padding: '3px 8px' }}
                                      >
                                        {row[col] == null ? '' : String(row[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!preview.loading && !preview.error && preview.rows.length === 0 && (
                          <div style={{ color: GRAY_COLOR, fontSize: '12px', fontStyle: 'italic' }}>
                            No rows returned
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </div>
            </>
          )}
        </div>
      </div>

      {ctxMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu(null);
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: ctxMenu.x,
              top: ctxMenu.y,
              background: '#ffffff',
              border: `1px solid ${BORDER_COLOR}`,
              borderRadius: '4px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
              minWidth: '200px',
              padding: '4px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <CtxItem
              label="Copy DAX reference"
              onClick={() => {
                const ref = getDaxReference(splitNsKey(ctxMenu.key).bare);
                if (ref) navigator.clipboard.writeText(ref);
                setCtxMenu(null);
              }}
            />
            <CtxItem
              label="Copy node key"
              onClick={() => {
                navigator.clipboard.writeText(splitNsKey(ctxMenu.key).bare);
                setCtxMenu(null);
              }}
            />
            {(() => {
              const pk = splitNsKey(ctxMenu.key).bare.split(':')[0];
              if (pk !== 'model' && pk !== 'table') return null;
              return (
                <>
                  <CtxDivider />
                  <CtxItem
                    label="Expand all"
                    title={pk === 'model' ? 'Expand the whole model' : 'Expand this table and its folders'}
                    onClick={() => {
                      handleExpandScope(ctxMenu.key);
                      setCtxMenu(null);
                    }}
                  />
                  <CtxItem
                    label="Collapse all"
                    title={pk === 'model' ? 'Collapse the whole model' : 'Collapse this table'}
                    onClick={() => {
                      handleCollapseScope(ctxMenu.key);
                      setCtxMenu(null);
                    }}
                  />
                </>
              );
            })()}
            {(() => {
              const pp = splitNsKey(ctxMenu.key).bare.split(':');
              const kind = pp[0];
              const scopeLabel =
                kind === 'model'
                  ? 'model'
                  : kind === 'table' || kind === 'column'
                    ? `table "${pp[1]}"`
                    : kind === 'partition'
                      ? `partition "${pp[2] ?? ''}"`
                      : null;
              if (!scopeLabel) return null;
              const modes: { type: RefreshType; label: string }[] = [
                { type: 'full', label: 'Full' },
                { type: 'automatic', label: 'Automatic' },
                { type: 'dataOnly', label: 'Data only' },
                { type: 'calculate', label: 'Calculate' },
                { type: 'clearValues', label: 'Clear values' },
                { type: 'defragment', label: 'Defragment' },
              ];
              return (
                <>
                  <CtxDivider />
                  <CtxHeader label={`Refresh ${scopeLabel}`} />
                  {modes.map((m) => (
                    <CtxItem
                      key={`refresh-${m.type}`}
                      label={m.label}
                      title={`Trigger an enhanced (async) ${m.label} refresh`}
                      disabled={refreshing}
                      onClick={() => void handleRefresh(ctxMenu.key, m.type)}
                    />
                  ))}
                </>
              );
            })()}
            {(() => {
              const scope = dfScopeForKey(ctxMenu.key);
              if (!scope) return null;
              return (
                <>
                  <CtxDivider />
                  <CtxItem
                    label="Organize display folders"
                    title={`Propose display folders for columns & measures in ${scope.label} — preview in the tree, then Save`}
                    dotColor={ICON_ACCENT}
                    disabled={dfBusy}
                    onClick={() => void handleOrganizeFolders(ctxMenu.key)}
                  />
                </>
              );
            })()}
            {splitNsKey(ctxMenu.key).bare.startsWith('table:') && (
              <CtxItem
                label="Preview data (TOP 100)"
                onClick={() => {
                  void handleLoadTablePreview(ctxMenu.key);
                  setCtxMenu(null);
                }}
              />
            )}
            {splitNsKey(ctxMenu.key).bare.startsWith('measure:') &&
              (() => {
                const { id, bare } = splitNsKey(ctxMenu.key);
                const p = bare.split(':');
                const tableName = p[1] ?? '';
                const measureName = p.length > 2 ? p.slice(2).join(':') : '';
                const md = modelsData.find((m) => m.id === id)?.data;
                const expr =
                  md?.tables[tableName]?.measures[measureName]?.expression ??
                  measureExprCache[`${id}::${tableName}::${measureName}`] ??
                  '';
                if (!expr) return null;
                return (
                  <CtxItem
                    label="Copy expression"
                    onClick={() => {
                      navigator.clipboard.writeText(expr);
                      setCtxMenu(null);
                    }}
                  />
                );
              })()}
            {(() => {
              const fs = findingsForKey(ctxMenu.key);
              if (objectPathForKey(ctxMenu.key) === null) return null;
              if (fs.length === 0) {
                return (
                  <>
                    <CtxDivider />
                    <CtxInfo label="No issues found" dotColor="#34c759" />
                  </>
                );
              }
              const fixable = fs.filter((f) => f.rule.fixKind);
              const readonly = fs.filter((f) => !f.rule.fixKind);
              return (
                <>
                  <CtxDivider />
                  <CtxHeader
                    label={`${fs.length} issue${fs.length > 1 ? 's' : ''}${
                      fixable.length ? ` · ${fixable.length} fixable` : ''
                    }`}
                  />
                  {fixable.map((f, i) => (
                    <CtxItem
                      key={`fix-${i}`}
                      label={`Fix: ${f.rule.name}`}
                      title={f.rule.description}
                      dotColor={ICON_ACCENT}
                      disabled={fixing}
                      onClick={() => void handleApplyFix(f)}
                    />
                  ))}
                  {readonly.map((f, i) => (
                    <CtxInfo
                      key={`ro-${i}`}
                      label={f.rule.name}
                      title={f.rule.description}
                      dotColor={severityColor(f.rule.severity)}
                    />
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

function severityColor(sev: BpaSeverity): string {
  if (sev === 'Error') return '#ff3b30';
  if (sev === 'Warning') return '#2563eb';
  return '#8e8e93';
}

const CtxDivider: React.FC = () => (
  <div style={{ height: '1px', backgroundColor: BORDER_COLOR, margin: '4px 0' }} />
);

const CtxHeader: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      padding: '4px 10px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: GRAY_COLOR,
    }}
  >
    {label}
  </div>
);

const CtxInfo: React.FC<{ label: string; title?: string; dotColor?: string }> = ({
  label,
  title,
  dotColor,
}) => (
  <div
    title={title}
    style={{
      padding: '6px 10px',
      fontSize: '12px',
      color: GRAY_COLOR,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      cursor: 'default',
    }}
  >
    {dotColor && (
      <span
        style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }}
      />
    )}
    <span>{label}</span>
  </div>
);

const CtxItem: React.FC<{
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  dotColor?: string;
}> = ({ label, onClick, title, disabled, dotColor }) => (
  <div
    role="menuitem"
    title={title}
    aria-disabled={disabled}
    style={{
      padding: '6px 10px',
      cursor: disabled ? 'default' : 'pointer',
      borderRadius: '3px',
      userSelect: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      opacity: disabled ? 0.5 : 1,
    }}
    onMouseEnter={(e) => {
      if (!disabled) e.currentTarget.style.background = '#f0f0f0';
    }}
    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    onClick={() => {
      if (!disabled) onClick();
    }}
  >
    {dotColor && (
      <span
        style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }}
      />
    )}
    <span>{label}</span>
  </div>
);
