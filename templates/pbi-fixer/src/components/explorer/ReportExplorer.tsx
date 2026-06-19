// ReportExplorer — FluentUI tree + live preview + editable properties.
// Adapted from the standalone "TS PBI Fixer" rewrite: driven directly by the
// workspaceId + reportId selected in the connection bar, reading and writing
// the PBIR definition through the server-side fabric_proxy UDF.

import React, { useState, useCallback, useMemo } from 'react';
import {
  Button,
  Input,
  Spinner,
  Checkbox,
  Field,
  SpinButton,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Search20Regular,
  ArrowExpand20Regular,
  ArrowCollapseAll20Regular,
  Save20Regular,
  ChartMultiple20Regular,
  Code20Regular,
} from '@fluentui/react-icons';
import type { ReportData, PageInfo } from '@/explorer/types';
import { FONT_FAMILY, BORDER_COLOR, GRAY_COLOR, ICON_ACCENT, SECTION_BG, HOVER_BG } from '@/explorer/theme';
import { buildReportTree, getPageProperties, getVisualProperties } from '@/explorer/reportTree';
import { filterTreeOptions } from '@/explorer/treeUtils';
import { loadReportDefinition, saveReportDefinition, type ReportEdits } from '@/services/fabricRest';
import { ReportPreview } from './ReportPreview';
import { LiveReportPreview } from './LiveReportPreview';
import { DefinitionSource } from './DefinitionSource';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', ...shorthands.gap('8px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap' },
  mainLayout: { display: 'flex', ...shorthands.gap('8px'), flex: 1, minHeight: 0 },
  treePanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '320px',
    minWidth: '260px',
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
  rightPanel: { display: 'flex', flexDirection: 'column', flex: 1, ...shorthands.gap('8px'), minWidth: 0 },
  previewPanel: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('8px'),
    backgroundColor: SECTION_BG,
    minHeight: '320px',
    overflow: 'auto',
  },
  propertiesPanel: {
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('8px'),
    backgroundColor: SECTION_BG,
    minWidth: '280px',
    width: '320px',
    overflowY: 'auto',
  },
  contentRow: { display: 'flex', ...shorthands.gap('8px'), flex: 1, minHeight: 0 },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  previewToggle: { display: 'flex', ...shorthands.gap('4px') },
  previewNote: {
    fontSize: '12px',
    color: '#b35900',
    marginBottom: '6px',
    fontStyle: 'italic',
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
    minWidth: '110px',
    paddingRight: '10px',
  },
  propValue: { wordBreak: 'break-word' },
  statusBar: { fontSize: '13px', ...shorthands.padding('4px', '8px'), ...shorthands.borderRadius('6px') },
  editField: { marginBottom: '6px' },
  saveRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px'), marginTop: '10px', flexWrap: 'wrap' },
});

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

export interface ReportExplorerProps {
  workspaceId: string;
  reportId: string;
  reportName: string;
  onNavigateToModel?: (key: string) => void;
}

export const ReportExplorer: React.FC<ReportExplorerProps> = ({
  workspaceId,
  reportId,
  onNavigateToModel,
}) => {
  const styles = useStyles();

  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ msg: string; color: string }>({ msg: '', color: GRAY_COLOR });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMode, setPreviewMode] = useState<'live' | 'wireframe'>('live');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; key: string } | null>(null);

  const [pendingPages, setPendingPages] = useState<NonNullable<ReportEdits['pages']>>({});
  const [pendingVisuals, setPendingVisuals] = useState<NonNullable<ReportEdits['visuals']>>({});

  const treeResult = useMemo(() => {
    if (!reportData) return { options: [], keyMap: {}, iconMap: {} };
    return buildReportTree(reportData, expanded, {});
  }, [reportData, expanded]);

  const filteredOptions = useMemo(
    () => filterTreeOptions(treeResult.options, searchQuery),
    [treeResult.options, searchQuery]
  );

  const pageProps = useMemo(() => {
    if (!selectedKey || !reportData || !selectedKey.startsWith('page:')) return null;
    return getPageProperties(reportData, selectedKey);
  }, [selectedKey, reportData]);

  const visualProps = useMemo(() => {
    if (!selectedKey || !reportData || !selectedKey.startsWith('visual:')) return null;
    return getVisualProperties(reportData, selectedKey);
  }, [selectedKey, reportData]);

  // The page currently shown in the preview (page node or a visual's page).
  const currentPage: PageInfo | null = useMemo(() => {
    if (!selectedKey || !reportData) return null;
    const parts = selectedKey.split(':');
    const pName = parts[1];
    return reportData.pages[pName] ?? null;
  }, [selectedKey, reportData]);

  const selectedVisualName = useMemo(() => {
    if (!selectedKey?.startsWith('visual:')) return null;
    return selectedKey.split(':')[2] ?? null;
  }, [selectedKey]);

  // The PBIR page (section) name for the current selection, for live nav.
  const currentPageName = useMemo(
    () => (selectedKey ? (selectedKey.split(':')[1] ?? null) : null),
    [selectedKey]
  );

  const handleLiveError = useCallback((msg: string) => setLiveError(msg), []);

  const handleLoad = useCallback(async () => {
    if (!workspaceId || !reportId) {
      setStatus({ msg: 'Select a workspace and report first', color: '#ff3b30' });
      return;
    }
    setLoading(true);
    setStatus({ msg: 'Loading report...', color: GRAY_COLOR });
    try {
      const data = await loadReportDefinition(workspaceId, reportId);
      setReportData(data);
      setExpanded(new Set(Object.keys(data.pages)));
      setPendingPages({});
      setPendingVisuals({});
      setLiveError(null);
      setStatus({ msg: `Loaded ${Object.keys(data.pages).length} pages`, color: '#34c759' });
    } catch (err) {
      setStatus({ msg: `Error: ${err instanceof Error ? err.message : String(err)}`, color: '#ff3b30' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, reportId]);

  const handleToggleNode = useCallback((key: string) => {
    const parts = key.split(':');
    if (parts[0] !== 'page') return;
    const toggleKey = parts[1];
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toggleKey)) next.delete(toggleKey);
      else next.add(toggleKey);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (option: string) => {
      const key = treeResult.keyMap[option];
      if (!key) return;
      setSelectedKey(key);
      handleToggleNode(key);
    },
    [treeResult.keyMap, handleToggleNode]
  );

  const handleExpandAll = useCallback(() => {
    if (!reportData) return;
    setExpanded(new Set(Object.keys(reportData.pages)));
  }, [reportData]);

  const handleCollapseAll = useCallback(() => setExpanded(new Set()), []);

  // ---- editing helpers (mutate in-memory reportData + record pending) ----
  const editPage = useCallback(
    (pageName: string, field: 'displayName' | 'width' | 'height' | 'hidden', value: string | number | boolean) => {
      setReportData((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev) as ReportData;
        const pg = next.pages[pageName];
        if (pg) (pg as unknown as Record<string, unknown>)[field] = value;
        return next;
      });
      setPendingPages((prev) => ({ ...prev, [pageName]: { ...prev[pageName], [field]: value } }));
    },
    []
  );

  const editVisual = useCallback(
    (
      pageName: string,
      visualName: string,
      field: 'hidden' | 'x' | 'y' | 'width' | 'height',
      value: number | boolean
    ) => {
      setReportData((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev) as ReportData;
        const v = next.pages[pageName]?.visuals[visualName];
        if (v) (v as unknown as Record<string, unknown>)[field] = value;
        return next;
      });
      const k = `${pageName}:${visualName}`;
      setPendingVisuals((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));
    },
    []
  );

  const pendingCount = Object.keys(pendingPages).length + Object.keys(pendingVisuals).length;
  const hasPending = pendingCount > 0;

  const handleDiscard = useCallback(() => {
    setPendingPages({});
    setPendingVisuals({});
    setStatus({ msg: 'Discarded pending changes — reload to refresh', color: GRAY_COLOR });
  }, []);

  const handleSave = useCallback(async () => {
    if (!hasPending) return;
    setSaving(true);
    setStatus({ msg: 'Saving changes...', color: GRAY_COLOR });
    try {
      const changed = await saveReportDefinition(workspaceId, reportId, {
        pages: pendingPages,
        visuals: pendingVisuals,
      });
      setPendingPages({});
      setPendingVisuals({});
      setStatus({ msg: `Saved ${changed} part(s)`, color: '#34c759' });
    } catch (err) {
      setStatus({ msg: `Save failed: ${err instanceof Error ? err.message : String(err)}`, color: '#ff3b30' });
    } finally {
      setSaving(false);
    }
  }, [hasPending, workspaceId, reportId, pendingPages, pendingVisuals]);

  return (
    <div className={styles.root} style={showSource ? { overflowY: 'auto' } : undefined}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          onClick={handleLoad}
          disabled={loading || !reportId}
          icon={loading ? <Spinner size="tiny" /> : undefined}
        >
          Load Report
        </Button>
        <Button appearance="subtle" icon={<ArrowExpand20Regular />} onClick={handleExpandAll} disabled={!reportData}>
          Expand All
        </Button>
        <Button
          appearance="subtle"
          icon={<ArrowCollapseAll20Regular />}
          onClick={handleCollapseAll}
          disabled={!reportData}
        >
          Collapse All
        </Button>
        <Button
          appearance="primary"
          icon={saving ? <Spinner size="tiny" /> : <Save20Regular />}
          onClick={handleSave}
          disabled={!hasPending || saving}
        >
          Save{hasPending ? ` (${pendingCount})` : ''}
        </Button>
        {hasPending && (
          <Button appearance="secondary" onClick={handleDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button
          appearance={showSource ? 'primary' : 'subtle'}
          icon={<Code20Regular />}
          onClick={() => setShowSource((v) => !v)}
          disabled={!reportId}
        >
          {showSource ? 'Hide PBIR View' : 'PBIR View'}
        </Button>
        {status.msg && (
          <span className={styles.statusBar} style={{ background: `${status.color}1a`, color: status.color }}>
            {status.msg}
          </span>
        )}
      </div>

      <div
        className={styles.mainLayout}
        style={showSource ? { minHeight: 420, flexShrink: 0 } : undefined}
      >
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
                  {iconKey === 'page' ? (
                    <>
                      <span style={{ whiteSpace: 'pre' }}>{indent}</span>
                      <ChartMultiple20Regular primaryFill={ICON_ACCENT} style={{ flexShrink: 0 }} />
                      <span>{labelText}</span>
                    </>
                  ) : (
                    option
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
                {reportData ? 'No matching items' : 'Click Load Report to explore'}
              </div>
            )}
          </div>
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.contentRow}>
            <div className={styles.previewPanel} style={{ flex: 1 }}>
              <div className={styles.previewHeader}>
                <div className={styles.sectionLabel}>Preview</div>
                <div className={styles.previewToggle}>
                  <Button
                    size="small"
                    appearance={previewMode === 'live' && !liveError ? 'primary' : 'secondary'}
                    onClick={() => {
                      setLiveError(null);
                      setPreviewMode('live');
                    }}
                  >
                    Live
                  </Button>
                  <Button
                    size="small"
                    appearance={previewMode === 'wireframe' || liveError ? 'primary' : 'secondary'}
                    onClick={() => setPreviewMode('wireframe')}
                  >
                    Wireframe
                  </Button>
                </div>
              </div>
              {previewMode === 'live' && !liveError ? (
                reportId ? (
                  <LiveReportPreview
                    workspaceId={workspaceId}
                    reportId={reportId}
                    pageName={currentPageName}
                    onError={handleLiveError}
                  />
                ) : (
                  <div className={styles.previewNote}>Select a report to see the live preview</div>
                )
              ) : (
                <>
                  {liveError && previewMode === 'live' && (
                    <div className={styles.previewNote}>
                      Live preview unavailable ({liveError}). Showing wireframe.
                    </div>
                  )}
                  <ReportPreview
                    page={currentPage}
                    selectedVisual={selectedVisualName}
                    onSelectVisual={(vName) => {
                      const pName = selectedKey?.split(':')[1];
                      if (pName) setSelectedKey(`visual:${pName}:${vName}`);
                    }}
                  />
                </>
              )}
            </div>

            <div className={styles.propertiesPanel} style={{ order: -1 }}>
              <div className={styles.sectionLabel}>Properties</div>

              {pageProps && (
                <>
                  <PropRow label="Internal Name" value={pageProps.internalName} />
                  <PropRow label="Visual Count" value={String(pageProps.visualCount)} />
                  <PropRow label="Visual Types" value={pageProps.visualTypeSummary} />
                  <Field label="Display Name" className={styles.editField}>
                    <Input
                      value={pageProps.displayName}
                      onChange={(_, d) => editPage(pageProps.internalName, 'displayName', d.value)}
                    />
                  </Field>
                  <Field label="Width" className={styles.editField}>
                    <SpinButton
                      value={pageProps.width}
                      onChange={(_, d) =>
                        d.value != null && editPage(pageProps.internalName, 'width', d.value)
                      }
                    />
                  </Field>
                  <Field label="Height" className={styles.editField}>
                    <SpinButton
                      value={pageProps.height}
                      onChange={(_, d) =>
                        d.value != null && editPage(pageProps.internalName, 'height', d.value)
                      }
                    />
                  </Field>
                  <Checkbox
                    label="Hidden"
                    checked={pageProps.hidden}
                    onChange={(_, d) => editPage(pageProps.internalName, 'hidden', !!d.checked)}
                  />
                </>
              )}

              {visualProps && (
                <>
                  <PropRow label="Type" value={visualProps.displayType} />
                  <PropRow label="Internal Name" value={visualProps.internalName} />
                  <PropRow label="Page" value={visualProps.pageName} />
                  <PropRow label="Title" value={visualProps.title} />
                  <Field label="X" className={styles.editField}>
                    <SpinButton
                      value={visualProps.x}
                      onChange={(_, d) =>
                        d.value != null && editVisual(visualProps.pageName, visualProps.internalName, 'x', d.value)
                      }
                    />
                  </Field>
                  <Field label="Y" className={styles.editField}>
                    <SpinButton
                      value={visualProps.y}
                      onChange={(_, d) =>
                        d.value != null && editVisual(visualProps.pageName, visualProps.internalName, 'y', d.value)
                      }
                    />
                  </Field>
                  <Field label="Width" className={styles.editField}>
                    <SpinButton
                      value={visualProps.width}
                      onChange={(_, d) =>
                        d.value != null &&
                        editVisual(visualProps.pageName, visualProps.internalName, 'width', d.value)
                      }
                    />
                  </Field>
                  <Field label="Height" className={styles.editField}>
                    <SpinButton
                      value={visualProps.height}
                      onChange={(_, d) =>
                        d.value != null &&
                        editVisual(visualProps.pageName, visualProps.internalName, 'height', d.value)
                      }
                    />
                  </Field>
                  <Checkbox
                    label="Hidden"
                    checked={visualProps.hidden}
                    onChange={(_, d) =>
                      editVisual(visualProps.pageName, visualProps.internalName, 'hidden', !!d.checked)
                    }
                  />

                  {visualProps.usedObjects.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div className={styles.sectionLabel} style={{ marginBottom: '4px' }}>
                        Used Objects
                      </div>
                      {visualProps.usedObjects.map((obj, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: '12px',
                            padding: '2px 0',
                            cursor: onNavigateToModel ? 'pointer' : 'default',
                            color: onNavigateToModel ? ICON_ACCENT : 'inherit',
                          }}
                          onClick={() => {
                            if (onNavigateToModel) {
                              const key =
                                obj.type === 'Measure'
                                  ? `measure:${obj.table}:${obj.object}`
                                  : `column:${obj.table}:${obj.object}`;
                              onNavigateToModel(key);
                            }
                          }}
                        >
                          {obj.icon} {obj.table}[{obj.object}] ({obj.type})
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {!pageProps && !visualProps && (
                <div style={{ padding: '12px', color: GRAY_COLOR, fontSize: '13px', fontStyle: 'italic' }}>
                  Select a page or visual to view and edit properties
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSource && reportId && (
        <div style={{ marginTop: 8, height: 480, minHeight: 480, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <DefinitionSource workspaceId={workspaceId} reportId={reportId} only="report" />
        </div>
      )}

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
              minWidth: '210px',
              padding: '4px',
              fontSize: '13px',
              fontFamily: FONT_FAMILY,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const key = ctxMenu.key;
              const isPage = key.startsWith('page:');
              const isVisual = key.startsWith('visual:');
              const pp = isPage && reportData ? getPageProperties(reportData, key) : null;
              const vp = isVisual && reportData ? getVisualProperties(reportData, key) : null;
              const copy = (t: string) => {
                navigator.clipboard.writeText(t).catch(() => undefined);
                setCtxMenu(null);
              };
              return (
                <>
                  {pp && (
                    <>
                      <CtxItem label="Copy page name" onClick={() => copy(pp.displayName)} />
                      <CtxItem label="Copy internal name" onClick={() => copy(pp.internalName)} />
                    </>
                  )}
                  {vp && (
                    <>
                      <CtxItem label="Copy visual title" onClick={() => copy(vp.title || vp.displayType)} />
                      <CtxItem label="Copy internal name" onClick={() => copy(vp.internalName)} />
                      <CtxItem label="Copy visual type" onClick={() => copy(vp.type)} />
                    </>
                  )}
                  <CtxItem label="Copy node key" onClick={() => copy(key)} />
                  {vp && vp.usedObjects.length > 0 && (
                    <>
                      <CtxDivider />
                      <CtxHeader label="Navigate to model object" />
                      {vp.usedObjects.map((obj, i) => (
                        <CtxItem
                          key={i}
                          dotColor={ICON_ACCENT}
                          disabled={!onNavigateToModel}
                          label={`${obj.table}[${obj.object}]`}
                          title={onNavigateToModel ? 'Open in Model Explorer' : 'Model navigation unavailable'}
                          onClick={() => {
                            const mKey =
                              obj.type === 'Measure'
                                ? `measure:${obj.table}:${obj.object}`
                                : `column:${obj.table}:${obj.object}`;
                            onNavigateToModel?.(mKey);
                            setCtxMenu(null);
                          }}
                        />
                      ))}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

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
