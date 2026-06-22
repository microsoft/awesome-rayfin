// ForwardPrototype — a blank-canvas wireframe builder. Lay out pages and
// visual placeholders by hand (add / drag / resize / retitle), then export the
// layout as PBIR-lite JSON, an Excalidraw scene, or an SVG — the same three
// exporters the Reverse Prototype uses, just driven from a document the user
// builds instead of one parsed from an existing report.
//
// Field bindings are out of scope (consistent with Reverse Prototype): the
// boxes are placeholders to be re-bound in the target tool.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Input,
  Dropdown,
  Option,
  Text,
  Tooltip,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Add20Regular,
  Delete20Regular,
  ArrowDownload20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular,
  ScaleFit20Regular,
  DocumentAdd20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, SECTION_BG } from '@/explorer/theme';
import {
  exportPrototypeToExcalidraw,
  exportPrototypeToSvg,
  downloadText,
  PROTOTYPE_VISUAL_FILL,
  type PrototypeDocument,
  type PrototypePage,
  type PrototypeVisual,
  type VisualType,
} from '@/services/prototypeApi';
import { downloadPrototypePbip } from '@/services/pbirExport';

export interface ForwardPrototypeProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const VISUAL_TYPES: { type: VisualType; label: string }[] = [
  { type: 'card', label: 'Card' },
  { type: 'table', label: 'Table' },
  { type: 'matrix', label: 'Matrix' },
  { type: 'barChart', label: 'Bar' },
  { type: 'columnChart', label: 'Column' },
  { type: 'lineChart', label: 'Line' },
  { type: 'pieChart', label: 'Pie' },
  { type: 'slicer', label: 'Slicer' },
];

const PAGE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '16:9 (1280×720)', width: 1280, height: 720 },
  { label: '4:3 (1024×768)', width: 1024, height: 768 },
  { label: 'Letter (816×1056)', width: 816, height: 1056 },
];

let uidCounter = 1;
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;
}

function blankPage(name: string): PrototypePage {
  return { id: uid('page'), name, width: 1280, height: 720, visuals: [] };
}

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('8px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), flexWrap: 'wrap', flexShrink: 0 },
  palette: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px'), flexWrap: 'wrap', flexShrink: 0 },
  paletteLabel: { fontSize: '12px', color: GRAY_COLOR, marginRight: '2px' },
  grow: { flex: 1 },
  pageTabs: { display: 'flex', alignItems: 'center', ...shorthands.gap('6px'), flexWrap: 'wrap', flexShrink: 0 },
  body: { flex: 1, minHeight: 0, display: 'flex', ...shorthands.gap('8px') },
  canvasWrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: SECTION_BG,
    ...shorthands.padding('16px'),
  },
  canvas: {
    position: 'relative',
    backgroundColor: '#ffffff',
    ...shorthands.border('1px', 'solid', '#cbd5e1'),
    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    transformOrigin: 'top left',
  },
  visual: {
    position: 'absolute',
    boxSizing: 'border-box',
    ...shorthands.border('1px', 'solid', '#475569'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('6px', '8px'),
    fontSize: '12px',
    color: '#0f172a',
    overflow: 'hidden',
    cursor: 'move',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('2px'),
  },
  visualSelected: { ...shorthands.border('2px', 'solid', '#2563eb'), boxShadow: '0 0 0 2px rgba(37,99,235,0.25)' },
  visualTitle: { fontWeight: '600', fontSize: '12px', lineHeight: '14px' },
  visualType: { fontSize: '10px', color: '#475569', lineHeight: '12px' },
  resizeHandle: {
    position: 'absolute',
    right: '-5px',
    bottom: '-5px',
    width: '12px',
    height: '12px',
    backgroundColor: '#2563eb',
    ...shorthands.borderRadius('2px'),
    cursor: 'nwse-resize',
  },
  side: {
    width: '230px',
    flexShrink: 0,
    overflowY: 'auto',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    ...shorthands.padding('12px'),
    backgroundColor: SECTION_BG,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('10px'),
  },
  sideTitle: { fontWeight: '600', fontSize: '13px' },
  field: { display: 'flex', flexDirection: 'column', ...shorthands.gap('3px') },
  fieldLabel: { fontSize: '11px', color: GRAY_COLOR },
  numRow: { display: 'flex', ...shorthands.gap('6px') },
  empty: { color: GRAY_COLOR, fontSize: '12px' },
  stat: { fontSize: '12px', color: GRAY_COLOR },
});

interface Drag {
  mode: 'move' | 'resize';
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

export function ForwardPrototype({ workspaceId, datasetId, datasetName }: ForwardPrototypeProps) {
  const styles = useStyles();

  const [pages, setPages] = useState<PrototypePage[]>(() => [blankPage('Page 1')]);
  const [activeId, setActiveId] = useState<string>(() => pages[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(0.55);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const activePage = useMemo(() => pages.find((p) => p.id === activeId) ?? pages[0], [pages, activeId]);
  const selected = useMemo(
    () => activePage?.visuals.find((v) => v.id === selectedId) ?? null,
    [activePage, selectedId]
  );

  const updatePage = useCallback(
    (id: string, fn: (p: PrototypePage) => PrototypePage) => {
      setPages((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
    },
    []
  );

  const updateVisual = useCallback(
    (vid: string, fn: (v: PrototypeVisual) => PrototypeVisual) => {
      updatePage(activeId, (p) => ({ ...p, visuals: p.visuals.map((v) => (v.id === vid ? fn(v) : v)) }));
    },
    [activeId, updatePage]
  );

  const addVisual = useCallback(
    (type: VisualType) => {
      const n = activePage.visuals.length;
      const v: PrototypeVisual = {
        id: uid('vis'),
        type,
        title: VISUAL_TYPES.find((t) => t.type === type)?.label ?? type,
        x: 40 + (n % 6) * 28,
        y: 40 + (n % 6) * 28,
        width: type === 'slicer' ? 200 : 260,
        height: type === 'card' ? 110 : 180,
        fields: [],
      };
      updatePage(activeId, (p) => ({ ...p, visuals: [...p.visuals, v] }));
      setSelectedId(v.id);
    },
    [activePage.visuals.length, activeId, updatePage]
  );

  const addPage = useCallback(() => {
    const p = blankPage(`Page ${pages.length + 1}`);
    setPages((prev) => [...prev, p]);
    setActiveId(p.id);
    setSelectedId(null);
  }, [pages.length]);

  const deletePage = useCallback(() => {
    if (pages.length <= 1) return;
    setPages((prev) => {
      const next = prev.filter((p) => p.id !== activeId);
      setActiveId(next[0].id);
      return next;
    });
    setSelectedId(null);
  }, [pages.length, activeId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    updatePage(activeId, (p) => ({ ...p, visuals: p.visuals.filter((v) => v.id !== selectedId) }));
    setSelectedId(null);
  }, [selectedId, activeId, updatePage]);

  // ── drag / resize ──
  const onVisualPointerDown = useCallback(
    (e: React.PointerEvent, v: PrototypeVisual, mode: 'move' | 'resize') => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelectedId(v.id);
      dragRef.current = {
        mode,
        id: v.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: v.x,
        origY: v.y,
        origW: v.width,
        origH: v.height,
      };
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;
      if (d.mode === 'move') {
        updateVisual(d.id, (v) => ({ ...v, x: Math.max(0, Math.round(d.origX + dx)), y: Math.max(0, Math.round(d.origY + dy)) }));
      } else {
        updateVisual(d.id, (v) => ({
          ...v,
          width: Math.max(60, Math.round(d.origW + dx)),
          height: Math.max(40, Math.round(d.origH + dy)),
        }));
      }
    },
    [scale, updateVisual]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const fitView = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !activePage) return;
    const avail = wrap.clientWidth - 32;
    setScale(Math.min(1, Math.max(0.2, avail / activePage.width)));
  }, [activePage]);

  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── export ──
  const buildDoc = useCallback((): PrototypeDocument => {
    return {
      version: 'pbir-skeleton/1.0',
      reportName: datasetName ? `${datasetName} Prototype` : 'Forward-prototype',
      datasetName: datasetName || undefined,
      datasetId: datasetId || undefined,
      workspaceId: workspaceId || undefined,
      pages,
    };
  }, [pages, datasetName, datasetId, workspaceId]);

  const exportPbir = useCallback(() => {
    const doc = buildDoc();
    const base = (doc.reportName || 'forward-prototype').replace(/[^A-Za-z0-9._-]+/g, '_') || 'forward-prototype';
    downloadPrototypePbip(doc, base);
  }, [buildDoc]);
  const exportExcalidraw = useCallback(() => {
    downloadText('forward-prototype.excalidraw', exportPrototypeToExcalidraw(buildDoc()), 'application/json');
  }, [buildDoc]);
  const exportSvg = useCallback(() => {
    downloadText('forward-prototype.svg', exportPrototypeToSvg(buildDoc()), 'image/svg+xml');
  }, [buildDoc]);

  const totalVisuals = useMemo(() => pages.reduce((s, p) => s + p.visuals.length, 0), [pages]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button icon={<DocumentAdd20Regular />} onClick={addPage}>
          Add page
        </Button>
        <Button icon={<Delete20Regular />} disabled={pages.length <= 1} onClick={deletePage}>
          Delete page
        </Button>
        <div className={styles.grow} />
        <Button icon={<ZoomOut20Regular />} aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.2, s / 1.15))} />
        <Text className={styles.stat}>{Math.round(scale * 100)}%</Text>
        <Button icon={<ZoomIn20Regular />} aria-label="Zoom in" onClick={() => setScale((s) => Math.min(1.5, s * 1.15))} />
        <Button icon={<ScaleFit20Regular />} onClick={fitView}>
          Fit
        </Button>
      </div>

      <div className={styles.palette}>
        <span className={styles.paletteLabel}>Add visual:</span>
        {VISUAL_TYPES.map((t) => (
          <Button key={t.type} size="small" icon={<Add20Regular />} onClick={() => addVisual(t.type)}>
            {t.label}
          </Button>
        ))}
        <div className={styles.grow} />
        <Tooltip content="Export PBIR-lite JSON" relationship="label">
          <Button size="small" icon={<ArrowDownload20Regular />} disabled={totalVisuals === 0} onClick={exportPbir}>
            PBIR
          </Button>
        </Tooltip>
        <Tooltip content="Export Excalidraw scene" relationship="label">
          <Button size="small" icon={<ArrowDownload20Regular />} disabled={totalVisuals === 0} onClick={exportExcalidraw}>
            Excalidraw
          </Button>
        </Tooltip>
        <Tooltip content="Export SVG" relationship="label">
          <Button size="small" icon={<ArrowDownload20Regular />} disabled={totalVisuals === 0} onClick={exportSvg}>
            SVG
          </Button>
        </Tooltip>
      </div>

      <div className={styles.pageTabs}>
        {pages.map((p) => (
          <Button
            key={p.id}
            size="small"
            appearance={p.id === activeId ? 'primary' : 'secondary'}
            onClick={() => {
              setActiveId(p.id);
              setSelectedId(null);
            }}
          >
            {p.name}
          </Button>
        ))}
        <Text className={styles.stat}>
          · {activePage?.visuals.length ?? 0} visual(s) on page · {pages.length} page(s) · {totalVisuals} total
        </Text>
      </div>

      <div className={styles.body}>
        <div ref={wrapRef} className={styles.canvasWrap}>
          {activePage && (
            <div
              className={styles.canvas}
              style={{
                width: activePage.width,
                height: activePage.height,
                transform: `scale(${scale})`,
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onPointerDown={() => setSelectedId(null)}
            >
              {activePage.visuals.map((v) => (
                <div
                  key={v.id}
                  className={v.id === selectedId ? `${styles.visual} ${styles.visualSelected}` : styles.visual}
                  style={{
                    left: v.x,
                    top: v.y,
                    width: v.width,
                    height: v.height,
                    backgroundColor: PROTOTYPE_VISUAL_FILL[v.type] ?? '#e2e8f0',
                  }}
                  onPointerDown={(e) => onVisualPointerDown(e, v, 'move')}
                >
                  <div className={styles.visualTitle}>{v.title}</div>
                  <div className={styles.visualType}>{v.type}</div>
                  {v.id === selectedId && (
                    <div
                      className={styles.resizeHandle}
                      onPointerDown={(e) => onVisualPointerDown(e, v, 'resize')}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.side}>
          {selected ? (
            <>
              <div className={styles.sideTitle}>Selected visual</div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Title</span>
                <Input
                  value={selected.title}
                  onChange={(_, d) => updateVisual(selected.id, (v) => ({ ...v, title: d.value }))}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Type</span>
                <Dropdown
                  value={VISUAL_TYPES.find((t) => t.type === selected.type)?.label ?? selected.type}
                  selectedOptions={[selected.type]}
                  onOptionSelect={(_, d) =>
                    updateVisual(selected.id, (v) => ({ ...v, type: (d.optionValue as VisualType) ?? v.type }))
                  }
                >
                  {VISUAL_TYPES.map((t) => (
                    <Option key={t.type} value={t.type}>
                      {t.label}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <div className={styles.numRow}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>X</span>
                  <Input
                    type="number"
                    value={String(selected.x)}
                    onChange={(_, d) => updateVisual(selected.id, (v) => ({ ...v, x: Number(d.value) || 0 }))}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Y</span>
                  <Input
                    type="number"
                    value={String(selected.y)}
                    onChange={(_, d) => updateVisual(selected.id, (v) => ({ ...v, y: Number(d.value) || 0 }))}
                  />
                </div>
              </div>
              <div className={styles.numRow}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Width</span>
                  <Input
                    type="number"
                    value={String(selected.width)}
                    onChange={(_, d) => updateVisual(selected.id, (v) => ({ ...v, width: Math.max(60, Number(d.value) || 60) }))}
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Height</span>
                  <Input
                    type="number"
                    value={String(selected.height)}
                    onChange={(_, d) => updateVisual(selected.id, (v) => ({ ...v, height: Math.max(40, Number(d.value) || 40) }))}
                  />
                </div>
              </div>
              <Button icon={<Delete20Regular />} onClick={deleteSelected}>
                Delete visual
              </Button>
            </>
          ) : (
            <>
              <div className={styles.sideTitle}>Page</div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Name</span>
                <Input
                  value={activePage?.name ?? ''}
                  onChange={(_, d) => activePage && updatePage(activePage.id, (p) => ({ ...p, name: d.value }))}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Canvas size</span>
                <Dropdown
                  value={
                    PAGE_PRESETS.find((p) => p.width === activePage?.width && p.height === activePage?.height)?.label ??
                    `${activePage?.width}×${activePage?.height}`
                  }
                  onOptionSelect={(_, d) => {
                    const preset = PAGE_PRESETS.find((p) => p.label === d.optionValue);
                    if (preset && activePage) updatePage(activePage.id, (p) => ({ ...p, width: preset.width, height: preset.height }));
                  }}
                >
                  {PAGE_PRESETS.map((p) => (
                    <Option key={p.label} value={p.label}>
                      {p.label}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <Text className={styles.empty}>Select a visual to edit its title, type, position and size.</Text>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
