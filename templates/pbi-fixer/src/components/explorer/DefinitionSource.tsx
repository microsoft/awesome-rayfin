// DefinitionSource — raw editable TMDL (semantic model) / PBIR (report) source
// view. Lists the definition parts on the left, shows the selected part in an
// editable text area, and writes changes back to Fabric via updateDefinition
// (routed through the fabric_proxy UDF).

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Spinner,
  Textarea,
  Input,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Save20Regular,
  ArrowClockwise20Regular,
  Code20Regular,
  Table20Regular,
  Search20Regular,
  TextGrammarWand20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, ICON_ACCENT, SECTION_BG } from '@/explorer/theme';
import {
  loadDefinitionParts,
  saveDefinitionParts,
  type DefinitionKind,
  type RawDefinitionPart,
} from '@/services/fabricRest';
import { formatTmdlMeasures } from '@/services/measureEditor';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', ...shorthands.gap('8px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  kindToggle: { display: 'flex', ...shorthands.gap('4px') },
  status: { fontSize: '13px', marginLeft: 'auto' },
  layout: { display: 'flex', ...shorthands.gap('8px'), flex: 1, minHeight: 0 },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
    minWidth: '240px',
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  fileItem: {
    ...shorthands.padding('3px', '8px'),
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    '&:hover': { backgroundColor: '#f0f0f0' },
  },
  fileItemSelected: { backgroundColor: `${ICON_ACCENT}22`, fontWeight: '600' },
  fileItemDirty: { color: ICON_ACCENT },
  editorPanel: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, ...shorthands.gap('4px') },
  editorPath: { fontSize: '12px', color: GRAY_COLOR, fontFamily: 'monospace', wordBreak: 'break-all' },
  editor: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    '& textarea': {
      height: '100%',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      whiteSpace: 'pre',
      overflowWrap: 'normal',
      overflowX: 'auto',
      overflowY: 'auto',
    },
  },
  placeholder: { color: GRAY_COLOR, fontStyle: 'italic', ...shorthands.padding('20px') },
  fileListWrap: {
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
    minWidth: '240px',
    minHeight: 0,
    ...shorthands.gap('4px'),
  },
  diffScroll: { maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', ...shorthands.gap('14px') },
  diffPart: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  diffPath: { fontSize: '12px', fontFamily: 'monospace', color: ICON_ACCENT, wordBreak: 'break-all' },
  diffCols: { display: 'flex', ...shorthands.gap('8px') },
  diffCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', ...shorthands.gap('2px') },
  diffColHead: { fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: GRAY_COLOR },
  diffBefore: {
    margin: 0,
    ...shorthands.padding('6px'),
    fontFamily: 'monospace',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '320px',
    overflow: 'auto',
    backgroundColor: '#fff1f0',
    ...shorthands.border('1px', 'solid', '#ffd6d2'),
    ...shorthands.borderRadius('6px'),
  },
  diffAfter: {
    margin: 0,
    ...shorthands.padding('6px'),
    fontFamily: 'monospace',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '320px',
    overflow: 'auto',
    backgroundColor: '#eefbf0',
    ...shorthands.border('1px', 'solid', '#c9efce'),
    ...shorthands.borderRadius('6px'),
  },
});

export interface DefinitionSourceProps {
  workspaceId: string;
  reportId?: string;
  datasetId?: string;
  /** Locks the view to a single kind and hides the Model/Report toggle. */
  only?: DefinitionKind;
  /** Loads the definition automatically on mount (used by the standalone window). */
  autoLoad?: boolean;
  /** Deep-link: pre-select this definition part path after load. */
  initialPath?: string;
  /** Deep-link: scroll to / place the caret on this 1-based line after load. */
  initialLine?: number;
}

export const DefinitionSource: React.FC<DefinitionSourceProps> = ({
  workspaceId,
  reportId,
  datasetId,
  only,
  autoLoad,
  initialPath,
  initialLine,
}) => {
  const styles = useStyles();

  const [kind, setKind] = useState<DefinitionKind>(only ?? (datasetId ? 'model' : 'report'));
  const [parts, setParts] = useState<RawDefinitionPart[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; color: string } | null>(null);
  const [search, setSearch] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Deep-link target captured at load time, applied once the parts arrive.
  const pendingDeepLink = useRef<{ path?: string; line?: number } | null>(null);

  const itemId = kind === 'model' ? datasetId : reportId;
  const formatLabel = kind === 'model' ? 'TMDL' : 'PBIR';

  // Invalidates any in-flight load whose result arrives after a kind/item switch.
  const loadToken = useRef(0);

  const dirtyPaths = useMemo(() => new Set(Object.keys(edits)), [edits]);

  // Friendly labels for the left list only (PBIR): pages and bookmarks are
  // stored under GUID folders/files, but each carries a `displayName`. Show
  // that name instead of the raw id. Selection/editing still use the real path.
  const labelByPath = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of parts) {
      const rel = p.path.replace(/^definition\//, '');
      let label = rel;
      if (!p.binary) {
        const isPage = /\/page\.json$/.test(rel);
        const isBookmark = /\.bookmark\.json$/.test(rel);
        if (isPage || isBookmark) {
          try {
            const dn = (JSON.parse(p.text) as { displayName?: unknown })?.displayName;
            if (typeof dn === 'string' && dn.trim()) {
              label = isPage ? `Page: ${dn}` : `Bookmark: ${dn}`;
            }
          } catch {
            /* malformed JSON — keep the raw path */
          }
        }
      }
      map[p.path] = label;
    }
    return map;
  }, [parts]);

  // Parts shown in the left list, filtered by the search box (path / label /
  // content match). Binary parts only match on path/label.
  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) => {
      const label = (labelByPath[p.path] ?? p.path).toLowerCase();
      if (label.includes(q) || p.path.toLowerCase().includes(q)) return true;
      if (!p.binary && p.text.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [parts, search, labelByPath]);

  // Changed parts (path + before/after text) for the diff-preview dialog.
  const changedParts = useMemo(
    () =>
      Object.keys(edits).map((path) => ({
        path,
        before: parts.find((p) => p.path === path)?.text ?? '',
        after: edits[path],
      })),
    [edits, parts]
  );

  // Place the caret on / scroll to a 1-based line in the editor textarea.
  const scrollToLine = useCallback((line: number) => {
    const ta = taRef.current;
    if (!ta || line < 1) return;
    const lines = ta.value.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i].length + 1;
    ta.focus();
    ta.setSelectionRange(offset, offset);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2);
  }, []);

  const handleLoad = useCallback(async () => {
    if (!itemId) return;
    const myToken = ++loadToken.current;
    setLoading(true);
    setStatus(null);
    setEdits({});
    setSelectedPath(null);
    setParts([]);
    try {
      const result = await loadDefinitionParts(kind, workspaceId, itemId);
      if (myToken !== loadToken.current) return;
      setParts(result);
      const dl = pendingDeepLink.current;
      let chosen = result.find((p) => !p.binary) ?? result[0];
      if (dl?.path) {
        const match = result.find(
          (p) => p.path === dl.path || p.path === `definition/${dl.path}` || p.path.endsWith(dl.path!)
        );
        if (match) chosen = match;
      }
      setSelectedPath(chosen?.path ?? null);
      setStatus({ msg: `Loaded ${result.length} ${formatLabel} parts`, color: '#34c759' });
      if (dl?.line && chosen && !chosen.binary) {
        const line = dl.line;
        setTimeout(() => scrollToLine(line), 60);
      }
      pendingDeepLink.current = null;
    } catch (err) {
      if (myToken !== loadToken.current) return;
      setStatus({ msg: err instanceof Error ? err.message : String(err), color: '#ff3b30' });
    } finally {
      if (myToken === loadToken.current) setLoading(false);
    }
  }, [kind, workspaceId, itemId, formatLabel, scrollToLine]);

  // Reset when the selected item or kind changes (require an explicit Load) and
  // invalidate any load still in flight for the previous kind/item.
  useEffect(() => {
    loadToken.current++;
    setParts([]);
    setSelectedPath(null);
    setEdits({});
    setStatus(null);
    setLoading(false);
  }, [kind, itemId]);

  // Standalone window: load on mount (and whenever the target item changes).
  useEffect(() => {
    if (autoLoad && itemId) {
      pendingDeepLink.current = { path: initialPath, line: initialLine };
      void handleLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, itemId]);

  const selectedPart = useMemo(
    () => parts.find((p) => p.path === selectedPath) ?? null,
    [parts, selectedPath]
  );
  const selectedText = selectedPath
    ? (edits[selectedPath] ?? selectedPart?.text ?? '')
    : '';

  const onEdit = useCallback(
    (path: string, original: string, next: string) => {
      setEdits((prev) => {
        const copy = { ...prev };
        if (next === original) delete copy[path];
        else copy[path] = next;
        return copy;
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!itemId || dirtyPaths.size === 0) return;
    setShowDiff(false);
    setSaving(true);
    setStatus(null);
    try {
      const changed = await saveDefinitionParts(kind, workspaceId, itemId, edits);
      setStatus({
        msg: changed > 0 ? `Saved ${changed} part(s) to Fabric` : 'No changes to save',
        color: '#34c759',
      });
      setEdits({});
      // Refresh from the server so the baseline reflects the saved state.
      const result = await loadDefinitionParts(kind, workspaceId, itemId);
      setParts(result);
    } catch (err) {
      setStatus({ msg: err instanceof Error ? err.message : String(err), color: '#ff3b30' });
    } finally {
      setSaving(false);
    }
  }, [kind, workspaceId, itemId, edits, dirtyPaths.size]);

  // Format every measure DAX expression in the currently-selected TMDL part
  // (in-memory, so it respects unsaved edits). The result is staged as a local
  // edit and flows through the same Review & Save dialog. Model/TMDL only.
  const handleFormat = useCallback(() => {
    if (kind !== 'model' || !selectedPath || !selectedPart || selectedPart.binary) return;
    const current = edits[selectedPath] ?? selectedPart.text;
    const res = formatTmdlMeasures(current);
    if (res.changed > 0) {
      onEdit(selectedPath, selectedPart.text, res.text);
      setStatus({ msg: `Formatted ${res.changed} of ${res.scanned} measure(s) in this part`, color: '#34c759' });
    } else {
      setStatus({
        msg: res.scanned === 0 ? 'No measures found in this part' : `All ${res.scanned} measure(s) already formatted`,
        color: GRAY_COLOR,
      });
    }
  }, [kind, selectedPath, selectedPart, edits, onEdit]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {!only && (
          <div className={styles.kindToggle}>
            <Button
              size="small"
              icon={<Table20Regular />}
              appearance={kind === 'model' ? 'primary' : 'secondary'}
              disabled={!datasetId}
              onClick={() => setKind('model')}
            >
              Model (TMDL)
            </Button>
            <Button
              size="small"
              icon={<Code20Regular />}
              appearance={kind === 'report' ? 'primary' : 'secondary'}
              disabled={!reportId}
              onClick={() => setKind('report')}
            >
              Report (PBIR)
            </Button>
          </div>
        )}
        <Button
          icon={<ArrowClockwise20Regular />}
          appearance="primary"
          disabled={!itemId || loading}
          onClick={() => void handleLoad()}
        >
          {loading ? 'Loading…' : parts.length ? 'Reload' : `Load ${formatLabel}`}
        </Button>
        <Button
          icon={<Save20Regular />}
          appearance="secondary"
          disabled={dirtyPaths.size === 0 || saving}
          onClick={() => setShowDiff(true)}
        >
          {saving ? 'Saving…' : `Review & Save${dirtyPaths.size ? ` (${dirtyPaths.size})` : ''}`}
        </Button>
        <Button
          appearance="subtle"
          disabled={dirtyPaths.size === 0 || saving}
          onClick={() => setEdits({})}
        >
          Discard
        </Button>
        {kind === 'model' && (
          <Button
            icon={<TextGrammarWand20Regular />}
            appearance="subtle"
            disabled={!selectedPart || selectedPart.binary || saving}
            onClick={handleFormat}
          >
            Format DAX
          </Button>
        )}
        {(loading || saving) && <Spinner size="tiny" />}
        {status && (
          <span className={styles.status} style={{ color: status.color }}>
            {status.msg}
          </span>
        )}
      </div>

      {!itemId ? (
        <div className={styles.placeholder}>
          Select a {kind === 'model' ? 'semantic model' : 'report'} in the connection bar above.
        </div>
      ) : parts.length === 0 ? (
        <div className={styles.placeholder}>
          Click <strong>Load {formatLabel}</strong> to view the editable {formatLabel} source.
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.fileListWrap}>
            <Input
              size="small"
              contentBefore={<Search20Regular />}
              placeholder="Search parts (name or content)…"
              value={search}
              onChange={(_, d) => setSearch(d.value)}
            />
            <div className={styles.fileList}>
              {filteredParts.map((p) => {
                const cls = [styles.fileItem];
                if (p.path === selectedPath) cls.push(styles.fileItemSelected);
                if (dirtyPaths.has(p.path)) cls.push(styles.fileItemDirty);
                return (
                  <div
                    key={p.path}
                    className={cls.join(' ')}
                    title={p.path}
                    onClick={() => setSelectedPath(p.path)}
                  >
                    {dirtyPaths.has(p.path) ? '● ' : ''}
                    {labelByPath[p.path] ?? p.path.replace(/^definition\//, '')}
                    {p.binary ? ' (binary)' : ''}
                  </div>
                );
              })}
              {filteredParts.length === 0 && (
                <div className={styles.placeholder}>No parts match the search.</div>
              )}
            </div>
          </div>
          <div className={styles.editorPanel}>
            {selectedPart && <div className={styles.editorPath}>{selectedPart.path}</div>}
            {selectedPart?.binary ? (
              <div className={styles.placeholder}>
                This part is binary (e.g. an image) and cannot be edited as text.
              </div>
            ) : (
              <Textarea
                className={styles.editor}
                value={selectedText}
                spellCheck={false}
                resize="vertical"
                textarea={{ ref: taRef }}
                onChange={(_, d) => {
                  if (selectedPath && selectedPart) {
                    onEdit(selectedPath, selectedPart.text, d.value);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      <Dialog open={showDiff} onOpenChange={(_, d) => setShowDiff(d.open)}>
        <DialogSurface style={{ maxWidth: '900px', width: '90vw' }}>
          <DialogBody>
            <DialogTitle>Review changes ({changedParts.length} part{changedParts.length === 1 ? '' : 's'})</DialogTitle>
            <DialogContent>
              <div className={styles.diffScroll}>
                {changedParts.map((c) => (
                  <div key={c.path} className={styles.diffPart}>
                    <div className={styles.diffPath}>{c.path}</div>
                    <div className={styles.diffCols}>
                      <div className={styles.diffCol}>
                        <div className={styles.diffColHead}>Before</div>
                        <pre className={styles.diffBefore}>{c.before}</pre>
                      </div>
                      <div className={styles.diffCol}>
                        <div className={styles.diffColHead}>After</div>
                        <pre className={styles.diffAfter}>{c.after}</pre>
                      </div>
                    </div>
                  </div>
                ))}
                {changedParts.length === 0 && (
                  <div className={styles.placeholder}>No pending changes.</div>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setShowDiff(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                icon={<Save20Regular />}
                disabled={changedParts.length === 0 || saving}
                onClick={() => void handleSave()}
              >
                Write {changedParts.length} part{changedParts.length === 1 ? '' : 's'} to Fabric
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
