// Workspace editor tab — multi-select workspace items and copy / move / delete
// them. Copy is the primary, safe operation (clone into the same folder or a
// subfolder). Delete is guarded: it refuses to remove every item in a
// workspace and requires an explicit typed-style confirmation.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  Text,
  Badge,
  Input,
  Checkbox,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  RadioGroup,
  Radio,
  Switch,
  Link,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import {
  ArrowClockwise20Regular,
  Copy20Regular,
  FolderArrowRight20Regular,
  Delete20Regular,
  Warning20Regular,
  Checkmark20Filled,
  DismissCircle20Filled,
  ChevronRight20Regular,
  ChevronDown20Regular,
  Folder20Regular,
  FolderAdd20Regular,
  Broom20Regular,
  Sparkle20Regular,
  Open20Regular,
  Apps20Regular,
} from '@fluentui/react-icons';

import {
  loadWorkspaceContents,
  copyItem,
  moveItem,
  deleteItem,
  createFolder,
  isCopyable,
  type WorkspaceContents,
  type WorkspaceFolder,
} from '@/services/workspaceEditor';
import {
  planCleanup,
  buildAiCleanupPlan,
  applyCleanupPlan,
  type CleanupGroup,
  type CleanupMode,
  type CleanupResult,
} from '@/services/workspaceCleanup';
import {
  planTopics,
  buildAiTopicPlan,
  createOrgApp,
  isOrgAppReport,
  type TopicGroup,
  type TopicMode,
  type OrgAppStepResult,
} from '@/services/orgAppBuilder';
import { startGithubDeviceFlow, isGithubSignedIn } from '@/services/githubAuth';
import { GithubAuthRequiredError } from '@/services/mCommenter';
import { PbiSignInRequiredError } from '@/services/fabricAuth';
import { BORDER_COLOR, SECTION_BG, GRAY_COLOR, ICON_ACCENT } from '@/explorer/theme';

interface WorkspaceEditorTabProps {
  workspaceId: string;
  workspaceName: string;
}

/** Per-item result of a batch copy / move / delete run. */
interface OpResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const SAME = '__same__';
const ROOT = '__root__';
const NEW = '__new__';

const useStyles = makeStyles({
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
    ...shorthands.padding('2px'),
  },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  spacer: { flex: 1 },
  actions: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  listCard: {
    flex: 1,
    minHeight: '180px',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.padding('0'),
    ...shorthands.overflow('hidden'),
  },
  headRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('8px', '12px'),
    backgroundColor: SECTION_BG,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    fontSize: '11px',
    color: GRAY_COLOR,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flexShrink: 0,
  },
  rows: { flex: 1, minHeight: 0, overflowY: 'auto' },
  row: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '12px'),
    borderBottom: `1px solid ${BORDER_COLOR}`,
    ':hover': { backgroundColor: SECTION_BG },
  },
  colCheck: { width: '28px', flexShrink: 0, display: 'flex', alignItems: 'center' },
  colName: { flex: 2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  colType: { flex: 1, minWidth: '120px' },
  colFolder: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: GRAY_COLOR, fontSize: '12px' },
  summary: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap', fontSize: '13px' },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px'), marginBottom: '10px' },
  fieldLabel: { fontSize: '12px', fontWeight: 600 },
  resultList: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px'), maxHeight: '220px', overflowY: 'auto' },
  planList: { display: 'flex', flexDirection: 'column', ...shorthands.gap('8px'), maxHeight: '320px', overflowY: 'auto' },
  planGroup: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    ...shorthands.overflow('hidden'),
  },
  planGroupHead: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
    ...shorthands.padding('6px', '10px'),
    backgroundColor: SECTION_BG,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    fontWeight: 600,
    fontSize: '13px',
  },
  planGroupName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  planItem: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
    ...shorthands.padding('4px', '10px'),
    fontSize: '12px',
    color: GRAY_COLOR,
  },
  signin: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('4px'),
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderRadius('6px'),
    backgroundColor: SECTION_BG,
    border: `1px solid ${BORDER_COLOR}`,
  },
  code: {
    fontFamily: 'Consolas, monospace',
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.12em',
  },
  resultRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px'), fontSize: '13px' },
  dangerBox: {
    ...shorthands.padding('8px', '12px'),
    ...shorthands.borderRadius('4px'),
    backgroundColor: '#fdf3f4',
    border: '1px solid #f3c9cd',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('6px'),
  },
  itemNames: { fontFamily: 'Consolas, monospace', fontSize: '12px', maxHeight: '160px', overflowY: 'auto', whiteSpace: 'pre-wrap' },
  treeBox: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    ...shorthands.padding('4px'),
    maxHeight: '300px',
    overflowY: 'auto',
    backgroundColor: '#fff',
  },
  treeRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    ...shorthands.padding('4px', '6px'),
    ...shorthands.borderRadius('4px'),
    cursor: 'pointer',
    userSelect: 'none',
    ':hover': { backgroundColor: SECTION_BG },
  },
  treeRowSelected: {
    backgroundColor: '#e6f0fb',
    ':hover': { backgroundColor: '#e6f0fb' },
  },
  treeChevron: {
    width: '20px',
    height: '20px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: GRAY_COLOR,
    cursor: 'pointer',
    ...shorthands.border('none'),
    ...shorthands.padding('0'),
    backgroundColor: 'transparent',
  },
  treeChevronSpacer: { width: '20px', flexShrink: 0 },
  treeIcon: { flexShrink: 0, color: ICON_ACCENT, display: 'flex', alignItems: 'center' },
  treeName: { fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  folderHeader: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
    ...shorthands.padding('6px', '12px'),
    borderBottom: `1px solid ${BORDER_COLOR}`,
    backgroundColor: SECTION_BG,
    cursor: 'pointer',
    userSelect: 'none',
  },
  folderIcon: { flexShrink: 0, color: ICON_ACCENT, display: 'flex', alignItems: 'center' },
  folderName: { flex: 1, minWidth: 0, fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/** Pseudo-node shown above the folder tree (e.g. Workspace root, New subfolder…). */
interface TreeTopNode {
  value: string;
  label: string;
}

/**
 * Collapsible folder picker. Renders each folder by its own name (no repeated
 * parent prefix), indented by depth, with expand / collapse chevrons. Clicking a
 * row selects it as the destination.
 */
function FolderTreePicker({
  folders,
  value,
  onChange,
  topNodes = [],
}: {
  folders: WorkspaceFolder[];
  value: string;
  onChange: (value: string) => void;
  topNodes?: TreeTopNode[];
}) {
  const styles = useStyles();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const childrenByParent = useMemo(() => {
    const known = new Set(folders.map((f) => f.id));
    const map = new Map<string, WorkspaceFolder[]>();
    for (const f of folders) {
      const parent = f.parentFolderId && known.has(f.parentFolderId) ? f.parentFolderId : '';
      const arr = map.get(parent) ?? [];
      arr.push(f);
      map.set(parent, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    }
    return map;
  }, [folders]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (
    rowValue: string,
    label: string,
    depth: number,
    hasKids: boolean,
    open: boolean,
    onToggle: (() => void) | null,
  ): ReactElement => (
    <div
      className={mergeClasses(styles.treeRow, value === rowValue ? styles.treeRowSelected : undefined)}
      style={{ paddingLeft: 6 + depth * 18 }}
      role="button"
      tabIndex={0}
      onClick={() => onChange(rowValue)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(rowValue);
        }
      }}
    >
      {hasKids && onToggle ? (
        <button
          type="button"
          className={styles.treeChevron}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </button>
      ) : (
        <span className={styles.treeChevronSpacer} />
      )}
      <span className={styles.treeIcon}>
        <Folder20Regular />
      </span>
      <span className={styles.treeName}>{label}</span>
    </div>
  );

  const renderFolder = (f: WorkspaceFolder, depth: number): ReactElement => {
    const kids = childrenByParent.get(f.id) ?? [];
    const hasKids = kids.length > 0;
    const open = !collapsed.has(f.id);
    return (
      <div key={f.id}>
        {renderRow(f.id, f.displayName, depth, hasKids, open, () => toggle(f.id))}
        {hasKids && open && kids.map((k) => renderFolder(k, depth + 1))}
      </div>
    );
  };

  const roots = childrenByParent.get('') ?? [];

  return (
    <div className={styles.treeBox}>
      {topNodes.map((n) => (
        <div key={n.value}>{renderRow(n.value, n.label, 0, false, false, null)}</div>
      ))}
      {roots.map((f) => renderFolder(f, 0))}
    </div>
  );
}

export function WorkspaceEditorTab({ workspaceId, workspaceName }: WorkspaceEditorTabProps) {
  const styles = useStyles();

  const [contents, setContents] = useState<WorkspaceContents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Copy dialog
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySuffix, setCopySuffix] = useState(' (Copy)');
  const [copyDest, setCopyDest] = useState<string>(SAME);
  const [newFolderName, setNewFolderName] = useState('');
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyResults, setCopyResults] = useState<OpResult[] | null>(null);

  // Move dialog
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDest, setMoveDest] = useState<string>(ROOT);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveResults, setMoveResults] = useState<OpResult[] | null>(null);

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteResults, setDeleteResults] = useState<OpResult[] | null>(null);

  // New-folder dialog
  const [nfOpen, setNfOpen] = useState(false);
  const [nfName, setNfName] = useState('');
  const [nfParent, setNfParent] = useState<string>(ROOT);
  const [nfBusy, setNfBusy] = useState(false);
  const [nfError, setNfError] = useState<string | null>(null);

  // Tidy-up dialog (organise loose items into freshly created folders)
  const [tidyOpen, setTidyOpen] = useState(false);
  const [tidyScope, setTidyScope] = useState<string>(ROOT);
  const [tidyMode, setTidyMode] = useState<CleanupMode>('type');
  const [tidyUseAi, setTidyUseAi] = useState(false);
  const [tidyPlan, setTidyPlan] = useState<CleanupGroup[] | null>(null);
  const [tidyBusy, setTidyBusy] = useState(false);
  const [tidyResults, setTidyResults] = useState<CleanupResult[] | null>(null);
  const [tidyError, setTidyError] = useState<string | null>(null);
  const [tidyDevice, setTidyDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);

  // Org-app dialog (package reports into an org app with one audience per topic)
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgScope, setOrgScope] = useState<string>(ROOT);
  const [orgMode, setOrgMode] = useState<TopicMode>('folder');
  const [orgUseAi, setOrgUseAi] = useState(false);
  const [orgPlan, setOrgPlan] = useState<TopicGroup[] | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgResults, setOrgResults] = useState<OrgAppStepResult[] | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgDevice, setOrgDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setContents(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsSignIn(false);
    try {
      const c = await loadWorkspaceContents(workspaceId);
      setContents(c);
      setSelected(new Set());
    } catch (e: unknown) {
      if (e instanceof PbiSignInRequiredError) setNeedsSignIn(true);
      else setError(e instanceof Error ? e.message : String(e));
      setContents(null);
    } finally {
      setBusy(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = contents?.items ?? [];
  const folders = contents?.folders ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.displayName.toLowerCase().includes(q) ||
        it.type.toLowerCase().includes(q) ||
        it.folderPath.toLowerCase().includes(q)
    );
  }, [items, search]);

  const selectedItems = useMemo(
    () => items.filter((it) => selected.has(it.id)),
    [items, selected]
  );
  const nonCopyableSelected = selectedItems.filter((it) => !isCopyable(it.type)).length;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allFilteredSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.id));
  const toggleAllFiltered = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const everySelected = filtered.length > 0 && filtered.every((it) => next.has(it.id));
      if (everySelected) filtered.forEach((it) => next.delete(it.id));
      else filtered.forEach((it) => next.add(it.id));
      return next;
    });
  }, [filtered]);

  // ---- Folder-tree overview ------------------------------------------------
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const searching = search.trim().length > 0;

  const itemsByPath = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const it of filtered) {
      const arr = m.get(it.folderPath) ?? [];
      arr.push(it);
      m.set(it.folderPath, arr);
    }
    return m;
  }, [filtered]);

  const childFoldersByParent = useMemo(() => {
    const known = new Set(folders.map((f) => f.id));
    const m = new Map<string, WorkspaceFolder[]>();
    for (const f of folders) {
      const parent = f.parentFolderId && known.has(f.parentFolderId) ? f.parentFolderId : '';
      const arr = m.get(parent) ?? [];
      arr.push(f);
      m.set(parent, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    }
    return m;
  }, [folders]);

  // Filtered item ids contained in each folder (direct + descendants), by path.
  const idsUnderPath = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of folders) {
      const prefix = `${f.path} / `;
      m.set(
        f.path,
        filtered.filter((it) => it.folderPath === f.path || it.folderPath.startsWith(prefix)).map((it) => it.id)
      );
    }
    return m;
  }, [folders, filtered]);

  const toggleFolder = useCallback((id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFolderItems = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSel = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const renderItemRow = (it: (typeof items)[number], depth: number): ReactElement => (
    <div key={it.id} className={styles.row} style={{ paddingLeft: 12 + depth * 18 }}>
      <span className={styles.colCheck}>
        <Checkbox
          checked={selected.has(it.id)}
          onChange={() => toggle(it.id)}
          aria-label={`Select ${it.displayName}`}
        />
      </span>
      <span className={styles.colName} title={it.displayName}>
        {it.displayName}
      </span>
      <span className={styles.colType}>
        <Badge appearance="outline" color={isCopyable(it.type) ? 'brand' : 'informative'}>
          {it.type}
        </Badge>
      </span>
    </div>
  );

  const renderFolderNode = (f: WorkspaceFolder, depth: number): ReactElement | null => {
    const under = idsUnderPath.get(f.path) ?? [];
    if (searching && under.length === 0) return null;
    const open = !collapsedFolders.has(f.id);
    const childFs = childFoldersByParent.get(f.id) ?? [];
    const directItems = itemsByPath.get(f.path) ?? [];
    const allSel = under.length > 0 && under.every((id) => selected.has(id));
    const someSel = !allSel && under.some((id) => selected.has(id));
    return (
      <div key={f.id}>
        <div
          className={styles.folderHeader}
          style={{ paddingLeft: 12 + depth * 18 }}
          role="button"
          tabIndex={0}
          onClick={() => toggleFolder(f.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleFolder(f.id);
            }
          }}
        >
          <span className={styles.treeIcon}>
            {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
          </span>
          <span className={styles.colCheck} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={allSel ? true : someSel ? 'mixed' : false}
              disabled={under.length === 0}
              onChange={() => toggleFolderItems(under)}
              aria-label={`Select all in ${f.displayName}`}
            />
          </span>
          <span className={styles.folderIcon}>
            <Folder20Regular />
          </span>
          <span className={styles.folderName} title={f.path}>
            {f.displayName}
          </span>
          <Badge appearance="tint" color="informative">
            {under.length}
          </Badge>
        </div>
        {open && (
          <>
            {childFs.map((cf) => renderFolderNode(cf, depth + 1))}
            {directItems.map((it) => renderItemRow(it, depth + 1))}
          </>
        )}
      </div>
    );
  };

  // Resolve a destination dropdown value to a target folder id (undefined = root).
  const resolveFolderId = useCallback(
    async (dest: string, perItemFolderId?: string): Promise<string | undefined> => {
      if (dest === SAME) return perItemFolderId;
      if (dest === ROOT) return undefined;
      if (dest === NEW) {
        const name = newFolderName.trim();
        if (!name) throw new Error('Enter a name for the new subfolder.');
        const f = await createFolder(workspaceId, name);
        return f.id;
      }
      return dest; // an existing folder id
    },
    [newFolderName, workspaceId]
  );

  const runCopy = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setCopyBusy(true);
    setCopyResults(null);
    const results: OpResult[] = [];
    try {
      // Create the new subfolder once (shared by all copies) when requested.
      let sharedFolderId: string | undefined;
      let sharedResolved = false;
      for (const it of selectedItems) {
        try {
          let target: string | undefined;
          if (copyDest === NEW) {
            if (!sharedResolved) {
              sharedFolderId = await resolveFolderId(NEW);
              sharedResolved = true;
            }
            target = sharedFolderId;
          } else {
            target = await resolveFolderId(copyDest, it.folderId);
          }
          const created = await copyItem(workspaceId, it, `${it.displayName}${copySuffix}`, target);
          results.push({ name: it.displayName, ok: true, detail: `→ ${created.displayName}` });
        } catch (e: unknown) {
          results.push({
            name: it.displayName,
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setCopyResults(results);
      await load();
    } finally {
      setCopyBusy(false);
    }
  }, [selectedItems, copyDest, copySuffix, resolveFolderId, workspaceId, load]);

  const runMove = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setMoveBusy(true);
    setMoveResults(null);
    const results: OpResult[] = [];
    try {
      const target = moveDest === ROOT ? undefined : moveDest;
      for (const it of selectedItems) {
        try {
          await moveItem(workspaceId, it.id, target);
          results.push({ name: it.displayName, ok: true });
        } catch (e: unknown) {
          results.push({
            name: it.displayName,
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setMoveResults(results);
      await load();
    } finally {
      setMoveBusy(false);
    }
  }, [selectedItems, moveDest, workspaceId, load]);

  // Hard safety guard: never allow deleting every item in the workspace.
  const wouldDeleteAll = items.length > 0 && selectedItems.length >= items.length;

  const runDelete = useCallback(async () => {
    if (selectedItems.length === 0 || wouldDeleteAll) return;
    setDeleteBusy(true);
    setDeleteResults(null);
    const results: OpResult[] = [];
    try {
      for (const it of selectedItems) {
        try {
          await deleteItem(workspaceId, it.id);
          results.push({ name: it.displayName, ok: true });
        } catch (e: unknown) {
          results.push({
            name: it.displayName,
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setDeleteResults(results);
      await load();
    } finally {
      setDeleteBusy(false);
    }
  }, [selectedItems, wouldDeleteAll, workspaceId, load]);

  const openCopy = () => {
    setCopyResults(null);
    setCopyDest(SAME);
    setNewFolderName('');
    setCopyOpen(true);
  };
  const openMove = () => {
    setMoveResults(null);
    setMoveDest(ROOT);
    setMoveOpen(true);
  };
  const openDelete = () => {
    setDeleteResults(null);
    setDeleteConfirm(false);
    setDeleteOpen(true);
  };

  const openNewFolder = () => {
    setNfName('');
    setNfParent(ROOT);
    setNfError(null);
    setNfOpen(true);
  };

  const runCreateFolder = useCallback(async () => {
    const name = nfName.trim();
    if (!name) {
      setNfError('Enter a folder name.');
      return;
    }
    setNfBusy(true);
    setNfError(null);
    try {
      await createFolder(workspaceId, name, nfParent === ROOT ? undefined : nfParent);
      setNfOpen(false);
      await load();
    } catch (e: unknown) {
      setNfError(e instanceof Error ? e.message : String(e));
    } finally {
      setNfBusy(false);
    }
  }, [nfName, nfParent, workspaceId, load]);

  // ---- Tidy up (organise loose items into folders) -------------------------
  // Items that live directly in the chosen scope (root or one folder). Items
  // already inside a subfolder of the scope are left untouched.
  const tidyScopeFolderId = tidyScope === ROOT ? undefined : tidyScope;
  const tidyScopeItems = useMemo(
    () => items.filter((it) => (it.folderId ?? undefined) === tidyScopeFolderId),
    [items, tidyScopeFolderId]
  );

  const openTidy = () => {
    setTidyScope(ROOT);
    setTidyMode('type');
    setTidyUseAi(false);
    setTidyPlan(null);
    setTidyResults(null);
    setTidyError(null);
    setTidyDevice(null);
    setTidyOpen(true);
  };

  const beginTidySignIn = useCallback(async () => {
    setTidyDevice(null);
    try {
      const handle = await startGithubDeviceFlow();
      setTidyDevice({ userCode: handle.userCode, verificationUri: handle.verificationUri });
      handle.completion
        .then(() => {
          setTidyDevice(null);
          setTidyError('Signed in to GitHub. Click "Preview plan" again to generate the AI grouping.');
        })
        .catch((e: unknown) => setTidyError(e instanceof Error ? e.message : String(e)));
    } catch (e) {
      setTidyError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const previewTidy = useCallback(async () => {
    setTidyBusy(true);
    setTidyError(null);
    setTidyResults(null);
    try {
      const plan = tidyUseAi
        ? await buildAiCleanupPlan(tidyScopeItems)
        : planCleanup(tidyScopeItems, tidyMode);
      setTidyPlan(plan);
    } catch (e) {
      if (e instanceof GithubAuthRequiredError) await beginTidySignIn();
      else setTidyError(e instanceof Error ? e.message : String(e));
    } finally {
      setTidyBusy(false);
    }
  }, [tidyUseAi, tidyScopeItems, tidyMode, beginTidySignIn]);

  const applyTidy = useCallback(async () => {
    if (!tidyPlan || tidyPlan.length === 0) return;
    setTidyBusy(true);
    setTidyError(null);
    try {
      const results = await applyCleanupPlan(workspaceId, tidyPlan, tidyScopeFolderId, folders);
      setTidyResults(results);
      await load();
    } catch (e) {
      setTidyError(e instanceof Error ? e.message : String(e));
    } finally {
      setTidyBusy(false);
    }
  }, [tidyPlan, workspaceId, tidyScopeFolderId, folders, load]);

  // ---- Create org app (package reports + audiences per topic) ---------------
  // Reports in scope: the whole workspace (root) or one folder + its subfolders.
  const orgScopePath = useMemo(
    () => (orgScope === ROOT ? undefined : folders.find((f) => f.id === orgScope)?.path),
    [orgScope, folders]
  );
  const orgScopeReports = useMemo(
    () =>
      items.filter((it) => {
        if (!isOrgAppReport(it.type)) return false;
        if (orgScope === ROOT) return true;
        if (orgScopePath === undefined) return false;
        return it.folderPath === orgScopePath || it.folderPath.startsWith(`${orgScopePath} / `);
      }),
    [items, orgScope, orgScopePath]
  );

  const openOrgApp = () => {
    setOrgName(workspaceName ? `${workspaceName} App` : 'Org app');
    setOrgScope(ROOT);
    setOrgMode('folder');
    setOrgUseAi(false);
    setOrgPlan(null);
    setOrgResults(null);
    setOrgError(null);
    setOrgDevice(null);
    setOrgOpen(true);
  };

  const beginOrgSignIn = useCallback(async () => {
    setOrgDevice(null);
    try {
      const handle = await startGithubDeviceFlow();
      setOrgDevice({ userCode: handle.userCode, verificationUri: handle.verificationUri });
      handle.completion
        .then(() => {
          setOrgDevice(null);
          setOrgError('Signed in to GitHub. Click "Preview app" again to generate the AI topics.');
        })
        .catch((e: unknown) => setOrgError(e instanceof Error ? e.message : String(e)));
    } catch (e) {
      setOrgError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const previewOrgApp = useCallback(async () => {
    setOrgBusy(true);
    setOrgError(null);
    setOrgResults(null);
    try {
      const plan = orgUseAi
        ? await buildAiTopicPlan(orgScopeReports)
        : planTopics(orgScopeReports, orgMode);
      setOrgPlan(plan);
    } catch (e) {
      if (e instanceof GithubAuthRequiredError) await beginOrgSignIn();
      else setOrgError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrgBusy(false);
    }
  }, [orgUseAi, orgScopeReports, orgMode, beginOrgSignIn]);

  const applyOrgApp = useCallback(async () => {
    if (!orgPlan || orgPlan.length === 0) return;
    setOrgBusy(true);
    setOrgError(null);
    try {
      const { results } = await createOrgApp(workspaceId, orgName, orgPlan);
      setOrgResults(results);
      await load();
    } catch (e) {
      setOrgError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrgBusy(false);
    }
  }, [orgPlan, workspaceId, orgName, load]);

  if (!workspaceId) {
    return (
      <div className={styles.root}>
        <MessageBar intent="info">
          <MessageBarBody>Select a workspace above to manage its items.</MessageBarBody>
        </MessageBar>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {needsSignIn && (
        <MessageBar intent="warning">
          <MessageBarBody>Sign in to Power BI to manage workspace items.</MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => void load()}>
              Retry
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}

      <div className={styles.toolbar}>
        <Button
          icon={<ArrowClockwise20Regular />}
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh
        </Button>
        <Input
          placeholder="Filter by name, type or folder…"
          value={search}
          onChange={(_, d) => setSearch(d.value)}
          style={{ minWidth: '260px' }}
        />
        {busy && <Spinner size="tiny" label="Loading…" />}
        <div className={styles.spacer} />
        <div className={styles.actions}>
          <Button icon={<FolderAdd20Regular />} disabled={busy} onClick={openNewFolder}>
            New folder
          </Button>
          <Button icon={<Broom20Regular />} disabled={busy || items.length === 0} onClick={openTidy}>
            Tidy up
          </Button>
          <Button icon={<Apps20Regular />} disabled={busy || items.length === 0} onClick={openOrgApp}>
            Create org app
          </Button>
          <Button appearance="primary" icon={<Copy20Regular />} disabled={selected.size === 0 || busy} onClick={openCopy}>
            Copy ({selected.size})
          </Button>
          <Button icon={<FolderArrowRight20Regular />} disabled={selected.size === 0 || busy} onClick={openMove}>
            Move
          </Button>
          <Button
            icon={<Delete20Regular />}
            disabled={selected.size === 0 || busy}
            onClick={openDelete}
            style={{ color: selected.size > 0 ? '#b10e1c' : undefined }}
          >
            Delete
          </Button>
        </div>
      </div>

      <div className={styles.summary}>
        <Text>
          {workspaceName ? `${workspaceName}: ` : ''}
          {items.length} item{items.length === 1 ? '' : 's'}
          {search ? ` · ${filtered.length} shown` : ''} · {selected.size} selected
        </Text>
        {nonCopyableSelected > 0 && (
          <Badge appearance="tint" color="warning">
            {nonCopyableSelected} not copyable
          </Badge>
        )}
      </div>

      <Card className={styles.listCard}>
        <div className={styles.headRow}>
          <span className={styles.colCheck}>
            <Checkbox
              checked={allFilteredSelected ? true : selected.size > 0 ? 'mixed' : false}
              onChange={toggleAllFiltered}
              aria-label="Select all"
            />
          </span>
          <span className={styles.colName}>Name</span>
          <span className={styles.colType}>Type</span>
        </div>
        <div className={styles.rows}>
          {filtered.length === 0 && !busy && (
            <div style={{ padding: '20px', color: GRAY_COLOR }}>
              {items.length === 0 ? 'No items in this workspace.' : 'No items match the filter.'}
            </div>
          )}
          {(childFoldersByParent.get('') ?? []).map((f) => renderFolderNode(f, 0))}
          {(itemsByPath.get('') ?? []).map((it) => renderItemRow(it, 0))}
        </div>
      </Card>

      {/* ---------------------------------------------------------- New folder */}
      <Dialog open={nfOpen} onOpenChange={(_, d) => setNfOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <FolderAdd20Regular style={{ color: ICON_ACCENT, verticalAlign: 'middle', marginRight: 6 }} />
              New folder
            </DialogTitle>
            <DialogContent>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Folder name</span>
                <Input
                  value={nfName}
                  onChange={(_, d) => setNfName(d.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !nfBusy) void runCreateFolder();
                  }}
                  autoFocus
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Parent folder</span>
                <FolderTreePicker
                  folders={folders}
                  value={nfParent}
                  onChange={setNfParent}
                  topNodes={[{ value: ROOT, label: 'Workspace root' }]}
                />
              </div>
              {nfError && (
                <MessageBar intent="error">
                  <MessageBarBody>{nfError}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setNfOpen(false)} disabled={nfBusy}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                icon={nfBusy ? <Spinner size="tiny" /> : <FolderAdd20Regular />}
                disabled={nfBusy || !nfName.trim()}
                onClick={() => void runCreateFolder()}
              >
                {nfBusy ? 'Creating…' : 'Create folder'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* -------------------------------------------------------------- Tidy up */}
      <Dialog open={tidyOpen} onOpenChange={(_, d) => setTidyOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Broom20Regular style={{ color: ICON_ACCENT, verticalAlign: 'middle', marginRight: 6 }} />
              Tidy up workspace
            </DialogTitle>
            <DialogContent>
              {tidyResults ? (
                <ResultsView results={tidyResults} />
              ) : tidyPlan ? (
                <>
                  <Text size={200} style={{ color: GRAY_COLOR }}>
                    {tidyPlan.length === 0
                      ? 'Nothing to organise in this scope.'
                      : `${tidyPlan.reduce((n, g) => n + g.items.length, 0)} item${
                          tidyPlan.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 's'
                        } will move into ${tidyPlan.length} folder${tidyPlan.length === 1 ? '' : 's'}.`}
                  </Text>
                  <div className={styles.planList} style={{ marginTop: 8 }}>
                    {tidyPlan.map((g) => (
                      <div key={g.folder} className={styles.planGroup}>
                        <div className={styles.planGroupHead}>
                          <Folder20Regular style={{ color: ICON_ACCENT }} />
                          <span className={styles.planGroupName}>{g.folder}</span>
                          <Badge appearance="tint" color="informative">
                            {g.items.length}
                          </Badge>
                        </div>
                        {g.items.map((it) => (
                          <div key={it.id} className={styles.planItem}>
                            <ChevronRight20Regular />
                            <span>{it.displayName}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Scope</span>
                    <FolderTreePicker
                      folders={folders}
                      value={tidyScope}
                      onChange={setTidyScope}
                      topNodes={[{ value: ROOT, label: 'Workspace root' }]}
                    />
                    <Text size={200} style={{ color: GRAY_COLOR }}>
                      {tidyScopeItems.length} loose item{tidyScopeItems.length === 1 ? '' : 's'} directly in this scope. Items
                      already inside subfolders are left untouched.
                    </Text>
                  </div>

                  <div className={styles.field}>
                    <Switch
                      checked={tidyUseAi}
                      onChange={(_, d) => setTidyUseAi(d.checked)}
                      label={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Sparkle20Regular style={{ color: ICON_ACCENT }} />
                          Group with AI (by subject / project)
                        </span>
                      }
                    />
                    <Text size={200} style={{ color: GRAY_COLOR }}>
                      {tidyUseAi
                        ? 'Copilot suggests folders grouping related items (e.g. a report with its semantic model). Requires GitHub sign-in.'
                        : 'Pick a simple grouping rule below.'}
                    </Text>
                  </div>

                  {!tidyUseAi && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Group by</span>
                      <RadioGroup value={tidyMode} onChange={(_, d) => setTidyMode(d.value as CleanupMode)}>
                        <Radio value="type" label="Type of item (recommended)" />
                        <Radio value="name" label="Name prefix" />
                      </RadioGroup>
                    </div>
                  )}

                  {tidyDevice && (
                    <div className={styles.signin}>
                      <Text size={200} style={{ color: GRAY_COLOR }}>
                        Enter this code at GitHub to sign in:
                      </Text>
                      <span className={styles.code}>{tidyDevice.userCode}</span>
                      <Link href={tidyDevice.verificationUri} target="_blank" rel="noreferrer">
                        <Open20Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {tidyDevice.verificationUri}
                      </Link>
                    </div>
                  )}
                </>
              )}

              {tidyError && (
                <MessageBar intent="error" style={{ marginTop: 8 }}>
                  <MessageBarBody>{tidyError}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              {tidyResults ? (
                <Button appearance="primary" onClick={() => setTidyOpen(false)}>
                  Done
                </Button>
              ) : tidyPlan ? (
                <>
                  <Button appearance="secondary" onClick={() => setTidyPlan(null)} disabled={tidyBusy}>
                    Back
                  </Button>
                  <Button
                    appearance="primary"
                    icon={tidyBusy ? <Spinner size="tiny" /> : <FolderArrowRight20Regular />}
                    disabled={tidyBusy || tidyPlan.length === 0}
                    onClick={() => void applyTidy()}
                  >
                    {tidyBusy ? 'Organising…' : 'Apply'}
                  </Button>
                </>
              ) : (
                <>
                  <Button appearance="secondary" onClick={() => setTidyOpen(false)} disabled={tidyBusy}>
                    Cancel
                  </Button>
                  {tidyUseAi && !isGithubSignedIn() && !tidyDevice && (
                    <Button appearance="secondary" onClick={() => void beginTidySignIn()} disabled={tidyBusy}>
                      Sign in to GitHub
                    </Button>
                  )}
                  <Button
                    appearance="primary"
                    icon={tidyBusy ? <Spinner size="tiny" /> : <Broom20Regular />}
                    disabled={tidyBusy || tidyScopeItems.length === 0}
                    onClick={() => void previewTidy()}
                  >
                    {tidyBusy ? 'Planning…' : 'Preview plan'}
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* ------------------------------------------------------------ Org app */}
      <Dialog open={orgOpen} onOpenChange={(_, d) => setOrgOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Apps20Regular style={{ color: ICON_ACCENT, verticalAlign: 'middle', marginRight: 6 }} />
              Create org app
            </DialogTitle>
            <DialogContent>
              {orgResults ? (
                <ResultsView results={orgResults} />
              ) : orgPlan ? (
                <>
                  <Text size={200} style={{ color: GRAY_COLOR }}>
                    {orgPlan.length === 0
                      ? 'No reports found in this scope.'
                      : `"${orgName.trim() || 'Org app'}" — ${orgPlan.reduce(
                          (n, g) => n + g.reports.length,
                          0
                        )} report${
                          orgPlan.reduce((n, g) => n + g.reports.length, 0) === 1 ? '' : 's'
                        } across ${orgPlan.length} audience${orgPlan.length === 1 ? '' : 's'}.`}
                  </Text>
                  <div className={styles.planList} style={{ marginTop: 8 }}>
                    {orgPlan.map((g) => (
                      <div key={g.topic} className={styles.planGroup}>
                        <div className={styles.planGroupHead}>
                          <Apps20Regular style={{ color: ICON_ACCENT }} />
                          <span className={styles.planGroupName}>{g.topic}</span>
                          <Badge appearance="tint" color="informative">
                            {g.reports.length}
                          </Badge>
                        </div>
                        {g.reports.map((r) => (
                          <div key={r.id} className={styles.planItem}>
                            <ChevronRight20Regular />
                            <span>{r.displayName}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>App name</span>
                    <Input value={orgName} onChange={(_, d) => setOrgName(d.value)} />
                  </div>

                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Reports to include</span>
                    <FolderTreePicker
                      folders={folders}
                      value={orgScope}
                      onChange={setOrgScope}
                      topNodes={[{ value: ROOT, label: 'Whole workspace' }]}
                    />
                    <Text size={200} style={{ color: GRAY_COLOR }}>
                      {orgScopeReports.length} report{orgScopeReports.length === 1 ? '' : 's'} in this scope
                      {orgScope === ROOT ? '' : ' (folder and its subfolders)'}.
                    </Text>
                  </div>

                  <div className={styles.field}>
                    <Switch
                      checked={orgUseAi}
                      onChange={(_, d) => setOrgUseAi(d.checked)}
                      label={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Sparkle20Regular style={{ color: ICON_ACCENT }} />
                          Group topics with AI (by subject)
                        </span>
                      }
                    />
                    <Text size={200} style={{ color: GRAY_COLOR }}>
                      {orgUseAi
                        ? 'Copilot groups the reports into topic-based audiences. Requires GitHub sign-in.'
                        : 'Pick a simple grouping rule below. One audience is created per topic.'}
                    </Text>
                  </div>

                  {!orgUseAi && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Group by</span>
                      <RadioGroup value={orgMode} onChange={(_, d) => setOrgMode(d.value as TopicMode)}>
                        <Radio value="folder" label="Folder (recommended)" />
                        <Radio value="name" label="Name prefix" />
                      </RadioGroup>
                    </div>
                  )}

                  {orgDevice && (
                    <div className={styles.signin}>
                      <Text size={200} style={{ color: GRAY_COLOR }}>
                        Enter this code at GitHub to sign in:
                      </Text>
                      <span className={styles.code}>{orgDevice.userCode}</span>
                      <Link href={orgDevice.verificationUri} target="_blank" rel="noreferrer">
                        <Open20Regular style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        {orgDevice.verificationUri}
                      </Link>
                    </div>
                  )}
                </>
              )}

              {orgError && (
                <MessageBar intent="error" style={{ marginTop: 8 }}>
                  <MessageBarBody>{orgError}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              {orgResults ? (
                <Button appearance="primary" onClick={() => setOrgOpen(false)}>
                  Done
                </Button>
              ) : orgPlan ? (
                <>
                  <Button appearance="secondary" onClick={() => setOrgPlan(null)} disabled={orgBusy}>
                    Back
                  </Button>
                  <Button
                    appearance="primary"
                    icon={orgBusy ? <Spinner size="tiny" /> : <Apps20Regular />}
                    disabled={orgBusy || orgPlan.length === 0 || !orgName.trim()}
                    onClick={() => void applyOrgApp()}
                  >
                    {orgBusy ? 'Creating…' : 'Create app'}
                  </Button>
                </>
              ) : (
                <>
                  <Button appearance="secondary" onClick={() => setOrgOpen(false)} disabled={orgBusy}>
                    Cancel
                  </Button>
                  {orgUseAi && !isGithubSignedIn() && !orgDevice && (
                    <Button appearance="secondary" onClick={() => void beginOrgSignIn()} disabled={orgBusy}>
                      Sign in to GitHub
                    </Button>
                  )}
                  <Button
                    appearance="primary"
                    icon={orgBusy ? <Spinner size="tiny" /> : <Apps20Regular />}
                    disabled={orgBusy || orgScopeReports.length === 0 || !orgName.trim()}
                    onClick={() => void previewOrgApp()}
                  >
                    {orgBusy ? 'Planning…' : 'Preview app'}
                  </Button>
                </>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* ---------------------------------------------------------------- Copy */}
      <Dialog open={copyOpen} onOpenChange={(_, d) => setCopyOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Copy20Regular style={{ color: ICON_ACCENT, verticalAlign: 'middle', marginRight: 6 }} />
              Copy {(copyResults?.length ?? selectedItems.length)} item{(copyResults?.length ?? selectedItems.length) === 1 ? '' : 's'}
            </DialogTitle>
            <DialogContent>
              {!copyResults && (
                <>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Name suffix</span>
                    <Input value={copySuffix} onChange={(_, d) => setCopySuffix(d.value)} />
                    <Text size={200} style={{ color: GRAY_COLOR }}>
                      Each copy is named "&lt;original&gt;{copySuffix}".
                    </Text>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Destination</span>
                    <FolderTreePicker
                      folders={folders}
                      value={copyDest}
                      onChange={setCopyDest}
                      topNodes={[
                        { value: SAME, label: 'Same folder as source' },
                        { value: ROOT, label: 'Workspace root' },
                        { value: NEW, label: 'New subfolder…' },
                      ]}
                    />
                  </div>
                  {copyDest === NEW && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>New subfolder name</span>
                      <Input
                        value={newFolderName}
                        onChange={(_, d) => setNewFolderName(d.value)}
                        placeholder="e.g. Copies"
                      />
                      <Text size={200} style={{ color: GRAY_COLOR }}>
                        Created at the workspace root; all copies go into it.
                      </Text>
                    </div>
                  )}
                  {nonCopyableSelected > 0 && (
                    <MessageBar intent="warning">
                      <MessageBarBody>
                        {nonCopyableSelected} selected item{nonCopyableSelected === 1 ? '' : 's'} can't be
                        copied (no portable definition) and will be skipped.
                      </MessageBarBody>
                    </MessageBar>
                  )}
                </>
              )}
              {copyResults && <ResultsView results={copyResults} />}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCopyOpen(false)} disabled={copyBusy}>
                {copyResults ? 'Close' : 'Cancel'}
              </Button>
              {!copyResults && (
                <Button
                  appearance="primary"
                  icon={copyBusy ? <Spinner size="tiny" /> : <Copy20Regular />}
                  disabled={copyBusy || (copyDest === NEW && !newFolderName.trim())}
                  onClick={() => void runCopy()}
                >
                  {copyBusy ? 'Copying…' : 'Copy'}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* ---------------------------------------------------------------- Move */}
      <Dialog open={moveOpen} onOpenChange={(_, d) => setMoveOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <FolderArrowRight20Regular style={{ color: ICON_ACCENT, verticalAlign: 'middle', marginRight: 6 }} />
              Move {(moveResults?.length ?? selectedItems.length)} item{(moveResults?.length ?? selectedItems.length) === 1 ? '' : 's'}
            </DialogTitle>
            <DialogContent>
              {!moveResults && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Destination folder</span>
                  <FolderTreePicker
                    folders={folders}
                    value={moveDest}
                    onChange={setMoveDest}
                    topNodes={[{ value: ROOT, label: 'Workspace root' }]}
                  />
                </div>
              )}
              {moveResults && <ResultsView results={moveResults} />}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setMoveOpen(false)} disabled={moveBusy}>
                {moveResults ? 'Close' : 'Cancel'}
              </Button>
              {!moveResults && (
                <Button
                  appearance="primary"
                  icon={moveBusy ? <Spinner size="tiny" /> : <FolderArrowRight20Regular />}
                  disabled={moveBusy}
                  onClick={() => void runMove()}
                >
                  {moveBusy ? 'Moving…' : 'Move'}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* -------------------------------------------------------------- Delete */}
      <Dialog open={deleteOpen} onOpenChange={(_, d) => setDeleteOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <Warning20Regular style={{ color: '#b10e1c', verticalAlign: 'middle', marginRight: 6 }} />
              Delete {(deleteResults?.length ?? selectedItems.length)} item{(deleteResults?.length ?? selectedItems.length) === 1 ? '' : 's'}
            </DialogTitle>
            <DialogContent>
              {!deleteResults && (
                <div className={styles.dangerBox}>
                  {wouldDeleteAll ? (
                    <Text style={{ color: '#b10e1c', fontWeight: 600 }}>
                      Refusing to delete every item in this workspace. Deselect at least one item to
                      continue. This guard prevents wiping out a whole workspace.
                    </Text>
                  ) : (
                    <>
                      <Text style={{ fontWeight: 600 }}>
                        This permanently deletes the following {selectedItems.length} item
                        {selectedItems.length === 1 ? '' : 's'}. This cannot be undone.
                      </Text>
                      <div className={styles.itemNames}>
                        {selectedItems.map((it) => `• ${it.displayName}  (${it.type})`).join('\n')}
                      </div>
                      <Divider />
                      <Checkbox
                        checked={deleteConfirm}
                        onChange={(_, d) => setDeleteConfirm(!!d.checked)}
                        label={`I understand this permanently deletes ${selectedItems.length} item${
                          selectedItems.length === 1 ? '' : 's'
                        }.`}
                      />
                    </>
                  )}
                </div>
              )}
              {deleteResults && <ResultsView results={deleteResults} />}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
                {deleteResults ? 'Close' : 'Cancel'}
              </Button>
              {!deleteResults && (
                <Button
                  appearance="primary"
                  icon={deleteBusy ? <Spinner size="tiny" /> : <Delete20Regular />}
                  disabled={deleteBusy || wouldDeleteAll || !deleteConfirm}
                  onClick={() => void runDelete()}
                  style={{ backgroundColor: deleteConfirm && !wouldDeleteAll ? '#b10e1c' : undefined }}
                >
                  {deleteBusy ? 'Deleting…' : 'Delete'}
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function ResultsView({ results }: { results: OpResult[] }) {
  const styles = useStyles();
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  return (
    <div>
      <MessageBar intent={failed === 0 ? 'success' : ok === 0 ? 'error' : 'warning'} style={{ marginBottom: 8 }}>
        <MessageBarBody>
          {ok} succeeded{failed > 0 ? `, ${failed} failed` : ''}.
        </MessageBarBody>
      </MessageBar>
      <div className={styles.resultList}>
        {results.map((r, i) => (
          <div key={i} className={styles.resultRow}>
            {r.ok ? (
              <Checkmark20Filled style={{ color: '#107c10' }} />
            ) : (
              <DismissCircle20Filled style={{ color: '#b10e1c' }} />
            )}
            <Text>
              {r.name}
              {r.detail ? ` — ${r.detail}` : ''}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
