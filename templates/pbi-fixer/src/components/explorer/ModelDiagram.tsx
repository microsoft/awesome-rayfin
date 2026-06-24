// ModelDiagram — interactive ER diagram of the semantic model (PKG-15 · D3).
//
// Renders every table as a draggable SVG box and every relationship as a
// connector with cardinality markers (1 / *). The whole canvas pans and
// zooms; individual tables can be repositioned and their positions persist
// to localStorage (per dataset). Active relationships are solid, inactive are
// dashed; bi-directional cross-filter is shown with a double arrow head.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Spinner,
  Text,
  Switch,
  MessageBar,
  MessageBarBody,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import {
  Organization20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular,
  ScaleFit20Regular,
  ArrowReset20Regular,
  ArrowSync20Regular,
} from '@fluentui/react-icons';
import { BORDER_COLOR, GRAY_COLOR, PANEL_BG } from '@/explorer/theme';
import {
  loadDiagramModel,
  loadPositions,
  savePositions,
  clearPositions,
  applyPositions,
  type DiagramNode,
  type DiagramEdge,
} from '@/services/modelDiagram';

export interface ModelDiagramProps {
  workspaceId: string;
  datasetId: string;
  datasetName: string;
}

const HEADER_H = 30;
const ROW_H = 18;

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, ...shorthands.gap('10px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap', flexShrink: 0 },
  status: { fontSize: '12px', color: GRAY_COLOR },
  spacer: { flex: 1 },
  canvasWrap: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('8px'),
    backgroundColor: PANEL_BG,
    overflow: 'hidden',
  },
  svg: { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' },
  svgDragging: { cursor: 'grabbing' },
  placeholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    color: GRAY_COLOR,
  },
});

interface Drag {
  mode: 'pan' | 'node';
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  table?: string;
  nodeX?: number;
  nodeY?: number;
}

// Point on a node's border in the direction of (tx, ty).
function borderPoint(n: DiagramNode, tx: number, ty: number): { x: number; y: number } {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = n.width / 2;
  const hh = n.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function ModelDiagram({ workspaceId, datasetId, datasetName }: ModelDiagramProps) {
  const styles = useStyles();
  const ready = !!datasetId;

  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<DiagramNode[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showHidden, setShowHidden] = useState(true);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const nodeByTable = useMemo(() => {
    const m = new Map<string, DiagramNode>();
    for (const n of nodes) m.set(n.table, n);
    return m;
  }, [nodes]);

  const visibleNodes = useMemo(
    () => (showHidden ? nodes : nodes.filter((n) => !n.hidden)),
    [nodes, showHidden]
  );
  const visibleTables = useMemo(() => new Set(visibleNodes.map((n) => n.table)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleTables.has(e.fromTable) && visibleTables.has(e.toTable)),
    [edges, visibleTables]
  );

  const fitView = useCallback(
    (ns: DiagramNode[]) => {
      const svg = svgRef.current;
      if (!svg || ns.length === 0) return;
      const rect = svg.getBoundingClientRect();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of ns) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
      const pad = 40;
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      const s = Math.min(rect.width / w, rect.height / h, 1.5);
      setScale(s);
      setPan({
        x: (rect.width - w * s) / 2 - (minX - pad) * s,
        y: (rect.height - h * s) / 2 - (minY - pad) * s,
      });
    },
    []
  );

  const load = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const dm = await loadDiagramModel(workspaceId, datasetId, datasetName);
      applyPositions(dm.nodes, loadPositions(datasetId));
      setNodes(dm.nodes);
      setEdges(dm.edges);
      setLoaded(true);
      // Defer fit until the SVG has its size.
      requestAnimationFrame(() => fitView(dm.nodes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ready, workspaceId, datasetId, datasetName, fitView]);

  const persist = useCallback(
    (ns: DiagramNode[]) => {
      const pos: Record<string, { x: number; y: number }> = {};
      for (const n of ns) pos[n.table] = { x: n.x, y: n.y };
      savePositions(datasetId, pos);
    },
    [datasetId]
  );

  const resetLayout = useCallback(() => {
    clearPositions(datasetId);
    // Rebuild auto-layout by reloading from the already-fetched structure.
    void load();
  }, [datasetId, load]);

  // ── pointer interactions ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent, table?: string) => {
      if (e.button !== 0) return;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      if (table) {
        const n = nodeByTable.get(table);
        dragRef.current = {
          mode: 'node',
          startX: e.clientX,
          startY: e.clientY,
          panX: pan.x,
          panY: pan.y,
          table,
          nodeX: n?.x ?? 0,
          nodeY: n?.y ?? 0,
        };
      } else {
        dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      }
      setDragging(true);
    },
    [nodeByTable, pan.x, pan.y]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'pan') {
      setPan({ x: d.panX + dx, y: d.panY + dy });
    } else if (d.table) {
      setScale((s) => {
        const table = d.table!;
        setNodes((prev) =>
          prev.map((n) =>
            n.table === table ? { ...n, x: (d.nodeX ?? 0) + dx / s, y: (d.nodeY ?? 0) + dy / s } : n
          )
        );
        return s;
      });
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d && d.mode === 'node') {
      setNodes((prev) => {
        persist(prev);
        return prev;
      });
    }
  }, [persist]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setScale((s) => {
      const ns = Math.min(3, Math.max(0.2, s * factor));
      const ratio = ns / s;
      setPan((p) => ({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio }));
      return ns;
    });
  }, []);

  const zoom = useCallback((factor: number) => {
    setScale((s) => Math.min(3, Math.max(0.2, s * factor)));
  }, []);

  // Reset state when the dataset changes.
  useEffect(() => {
    setNodes([]);
    setEdges([]);
    setLoaded(false);
    setError(null);
  }, [datasetId]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
          disabled={!ready || loading}
          onClick={load}
        >
          {loaded ? 'Reload diagram' : 'Load diagram'}
        </Button>
        {loaded && (
          <>
            <Button icon={<ZoomIn20Regular />} disabled={loading} onClick={() => zoom(1.2)} aria-label="Zoom in" />
            <Button icon={<ZoomOut20Regular />} disabled={loading} onClick={() => zoom(1 / 1.2)} aria-label="Zoom out" />
            <Button icon={<ScaleFit20Regular />} disabled={loading} onClick={() => fitView(visibleNodes)}>
              Fit
            </Button>
            <Button icon={<ArrowReset20Regular />} disabled={loading} onClick={resetLayout}>
              Reset layout
            </Button>
            <Switch checked={showHidden} onChange={(_, d) => setShowHidden(!!d.checked)} label="Show hidden" />
          </>
        )}
        <div className={styles.spacer} />
        {loaded && (
          <Text className={styles.status}>
            {visibleNodes.length} table(s) · {visibleEdges.length} relationship(s) · {Math.round(scale * 100)}%
          </Text>
        )}
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.canvasWrap}>
        <svg
          ref={svgRef}
          className={dragging ? `${styles.svg} ${styles.svgDragging}` : styles.svg}
          onPointerDown={(e) => onPointerDown(e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <defs>
            <marker id="diag-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,3 L0,6 Z" fill="#64748b" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {/* edges first so nodes paint on top */}
            {visibleEdges.map((edge) => {
              const a = nodeByTable.get(edge.fromTable);
              const b = nodeByTable.get(edge.toTable);
              if (!a || !b) return null;
              const acx = a.x + a.width / 2;
              const acy = a.y + a.height / 2;
              const bcx = b.x + b.width / 2;
              const bcy = b.y + b.height / 2;
              const pa = borderPoint(a, bcx, bcy);
              const pb = borderPoint(b, acx, acy);
              const midX = (pa.x + pb.x) / 2;
              const midY = (pa.y + pb.y) / 2;
              // Cardinality labels just inside each endpoint.
              const fromLbl = edge.fromCard === 'many' ? '*' : '1';
              const toLbl = edge.toCard === 'many' ? '*' : '1';
              const la = { x: pa.x + (midX - pa.x) * 0.18, y: pa.y + (midY - pa.y) * 0.18 };
              const lb = { x: pb.x + (midX - pb.x) * 0.18, y: pb.y + (midY - pb.y) * 0.18 };
              return (
                <g key={edge.id}>
                  <line
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke={edge.isActive ? '#64748b' : '#cbd5e1'}
                    strokeWidth={1.5}
                    strokeDasharray={edge.isActive ? undefined : '5,4'}
                    markerEnd="url(#diag-arrow)"
                    markerStart={edge.bothDirections ? 'url(#diag-arrow)' : undefined}
                  />
                  <text x={la.x} y={la.y - 2} fontSize={11} fontWeight={700} fill="#475569" textAnchor="middle">
                    {fromLbl}
                  </text>
                  <text x={lb.x} y={lb.y - 2} fontSize={11} fontWeight={700} fill="#475569" textAnchor="middle">
                    {toLbl}
                  </text>
                </g>
              );
            })}

            {/* nodes */}
            {visibleNodes.map((n) => {
              const isCalcGroup = n.type === 'CalculationGroup';
              const headerFill = isCalcGroup ? '#7c3aed' : n.hidden ? '#94a3b8' : '#2563eb';
              return (
                <g
                  key={n.table}
                  transform={`translate(${n.x},${n.y})`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onPointerDown(e, n.table);
                  }}
                  style={{ cursor: 'move' }}
                >
                  <rect
                    width={n.width}
                    height={n.height}
                    rx={6}
                    fill="#ffffff"
                    stroke={BORDER_COLOR}
                    strokeWidth={1}
                  />
                  <path
                    d={`M0,6 a6,6 0 0 1 6,-6 h${n.width - 12} a6,6 0 0 1 6,6 v${HEADER_H - 6} h${-n.width} Z`}
                    fill={headerFill}
                  />
                  <text x={10} y={HEADER_H / 2 + 4} fontSize={12} fontWeight={700} fill="#ffffff">
                    {n.table.length > 26 ? n.table.slice(0, 25) + '…' : n.table}
                  </text>
                  {n.rows.map((r, i) => {
                    const isKey = n.keyColumns.has(r);
                    return (
                      <text
                        key={r + i}
                        x={10}
                        y={HEADER_H + 13 + i * ROW_H}
                        fontSize={11}
                        fontWeight={isKey ? 700 : 400}
                        fill={isKey ? '#0f172a' : '#475569'}
                      >
                        {isKey ? '🔑 ' : ''}
                        {r.length > 26 ? r.slice(0, 25) + '…' : r}
                      </text>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
        {!loaded && !loading && (
          <div className={styles.placeholder}>
            {ready ? (
              <span>
                <Organization20Regular style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Click “Load diagram” to render the model ER diagram.
              </span>
            ) : (
              'Select a workspace and semantic model first.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
