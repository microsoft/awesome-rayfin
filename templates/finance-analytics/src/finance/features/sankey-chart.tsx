import { memo, useMemo, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export interface SankeyNode {
  id: string;
  label: string;
  /** Column index (0 = left). Nodes flow left→right by increasing depth. */
  depth: number;
  color?: string;
}
export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}
export interface SankeyChartProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a node drills into it. */
  onSelect?: (node: SankeyNode, throughput: number) => void;
}

const PALETTE = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)",
  "var(--color-chart-5)", "var(--color-chart-6)", "var(--color-chart-7)", "var(--color-chart-8)",
];

/**
 * Sankey flow diagram — proportional ribbons route value across columns of nodes
 * (e.g. Revenue → Segment → Region). Node heights encode throughput; ribbon widths
 * encode flow. Hovering a ribbon reads the source→target value, hovering/selecting
 * a node reads its total. Keyboard traversal across nodes. Pure SVG, no deps.
 */
function SankeyChartImpl({ nodes, links, height = 260, valuePrefix = "", onSelect }: SankeyChartProps) {
  const { tip, show, hide } = useChartCursor();
  const [focused, setFocused] = useState(false);
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const w = 640;
  const h = height;
  const nodeW = 11;
  const padX = 4;
  const padY = 8;
  const gap = 12;

  const layout = useMemo(() => {
    const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
    const lastDepth = depths[depths.length - 1];
    const colOf = new Map<string, SankeyNode[]>();
    for (const d of depths) colOf.set(String(d), nodes.filter((n) => n.depth === d));

    const throughput = (id: string) => {
      const inV = links.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0);
      const outV = links.filter((l) => l.source === id).reduce((s, l) => s + l.value, 0);
      return Math.max(inV, outV, 1);
    };

    // factor so the busiest column fills the usable height
    let factor = Infinity;
    for (const d of depths) {
      const col = colOf.get(String(d))!;
      const total = col.reduce((s, n) => s + throughput(n.id), 0);
      const avail = h - 2 * padY - (col.length - 1) * gap;
      factor = Math.min(factor, avail / (total || 1));
    }
    if (!isFinite(factor)) factor = 1;

    const geo = new Map<string, { x: number; y: number; h: number; color: string; tp: number; depthIndex: number }>();
    depths.forEach((d, di) => {
      const col = colOf.get(String(d))!;
      const colH = col.reduce((s, n) => s + throughput(n.id) * factor, 0) + (col.length - 1) * gap;
      let yy = padY + (h - 2 * padY - colH) / 2;
      const x = depths.length <= 1 ? padX : padX + (di / (depths.length - 1)) * (w - 2 * padX - nodeW);
      col.forEach((n) => {
        const tp = throughput(n.id);
        const nh = tp * factor;
        geo.set(n.id, { x, y: yy, h: nh, color: n.color ?? PALETTE[[...geo.keys()].length % PALETTE.length], tp, depthIndex: di });
        yy += nh + gap;
      });
    });

    const outOff = new Map<string, number>();
    const inOff = new Map<string, number>();
    const ribbons = links.map((l) => {
      const s = geo.get(l.source);
      const t = geo.get(l.target);
      if (!s || !t) return null;
      const lw = l.value * factor;
      const y0 = s.y + (outOff.get(l.source) ?? 0);
      const y1 = t.y + (inOff.get(l.target) ?? 0);
      outOff.set(l.source, (outOff.get(l.source) ?? 0) + lw);
      inOff.set(l.target, (inOff.get(l.target) ?? 0) + lw);
      const x0 = s.x + nodeW;
      const x1 = t.x;
      const xm = (x0 + x1) / 2;
      const path = `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + lw} C${xm},${y1 + lw} ${xm},${y0 + lw} ${x0},${y0 + lw} Z`;
      return { path, color: s.color, targetColor: t.color, x0, x1, link: l };
    });

    return { geo, ribbons, lastDepth, throughput, depthCount: depths.length };
  }, [nodes, links, h]);

  const nodeList = nodes;
  const { active, setActive, onKeyDown } = useRovingIndex(
    nodeList.length,
    onSelect ? (i) => { const n = nodeList[i]; onSelect(n, layout.geo.get(n.id)?.tp ?? 0); } : undefined,
  );

  const nodeTip = (id: string, label: string) => {
    const g = layout.geo.get(id);
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">Throughput {formatCompact(g?.tp ?? 0, valuePrefix)}</span>
      </div>
    );
  };
  const linkTip = (l: SankeyLink) => {
    const s = nodes.find((n) => n.id === l.source)?.label ?? l.source;
    const t = nodes.find((n) => n.id === l.target)?.label ?? l.target;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{s} → {t}</span>
        <span className="tabular-nums text-muted-foreground">{formatCompact(l.value, valuePrefix)}</span>
      </div>
    );
  };

  const showNode = (i: number) => {
    const n = nodeList[i];
    const g = layout.geo.get(n.id);
    if (!g || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    show(r.left + ((g.x + nodeW / 2) / w) * r.width, r.top + ((g.y) / h) * r.height, nodeTip(n.id, n.label));
  };

  if (nodes.length === 0) return null;

  return (
    <div className="flex flex-col" style={{ height: h + 4 }}>
      <div
        role="group"
        tabIndex={0}
        aria-label={`Sankey flow diagram with ${nodes.length} nodes. Use arrow keys to move between nodes.`}
        onKeyDown={onKeyDown}
        onFocus={() => { setFocused(true); showNode(active); }}
        onBlur={() => { setFocused(false); hide(); }}
        className="relative min-h-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" className="relative overflow-visible" role="img" aria-hidden="true">
          <defs>
            {layout.ribbons.map((rb, i) =>
              rb ? (
                <linearGradient key={i} id={`sk-grad-${i}`} gradientUnits="userSpaceOnUse" x1={rb.x0} y1="0" x2={rb.x1} y2="0">
                  <stop offset="0%" stopColor={rb.color} />
                  <stop offset="100%" stopColor={rb.targetColor} />
                </linearGradient>
              ) : null,
            )}
          </defs>
          {(() => {
            const activeId = hoverNode ?? (focused ? nodeList[active]?.id : null);
            return layout.ribbons.map((rb, i) => {
              if (!rb) return null;
              const opacity =
                hoverLink !== null
                  ? hoverLink === i ? 0.9 : 0.1
                  : activeId
                    ? rb.link.source === activeId || rb.link.target === activeId ? 0.85 : 0.1
                    : 0.5;
              return (
                <path
                  key={i}
                  d={rb.path}
                  fill={`url(#sk-grad-${i})`}
                  className="chart-draw-dash transition-opacity duration-150"
                  style={{ animationDelay: `${i * 40}ms` }}
                  opacity={opacity}
                  onMouseMove={(e) => { setHoverLink(i); show(e.clientX, e.clientY, linkTip(rb.link)); }}
                  onMouseLeave={() => { setHoverLink(null); if (!focused) hide(); }}
                />
              );
            });
          })()}
          {nodeList.map((n, i) => {
            const g = layout.geo.get(n.id);
            if (!g) return null;
            const isActive = (focused && i === active) || hoverNode === n.id;
            return (
              <rect
                key={n.id}
                x={g.x}
                y={g.y}
                width={nodeW}
                height={Math.max(g.h, 1)}
                rx="3"
                fill={g.color}
                className="chart-pop"
                stroke={isActive ? "var(--color-ring)" : "transparent"}
                strokeWidth={isActive ? 2 : 0}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: onSelect ? "pointer" : "default", animationDelay: `${i * 45}ms` }}
                onMouseMove={() => { setActive(i); setHoverNode(n.id); showNode(i); }}
                onMouseLeave={() => { setHoverNode(null); if (!focused) hide(); }}
                onClick={onSelect ? () => onSelect(n, g.tp) : undefined}
              />
            );
          })}
        </svg>

        {nodeList.map((n) => {
          const g = layout.geo.get(n.id);
          if (!g) return null;
          const isLast = g.depthIndex === layout.depthCount - 1;
          const left = ((g.x + (isLast ? 0 : nodeW)) / w) * 100;
          const top = ((g.y + g.h / 2) / h) * 100;
          return (
            <span
              key={n.id}
              aria-hidden="true"
              className="pointer-events-none absolute -translate-y-1/2 truncate text-100 font-semibold text-foreground"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                maxWidth: "40%",
                transform: `translateY(-50%) ${isLast ? "translateX(-100%)" : ""}`,
                paddingLeft: isLast ? 0 : 4,
                paddingRight: isLast ? 4 : 0,
                textAlign: isLast ? "right" : "left",
                textShadow: "0 1px 3px var(--color-background), 0 0 2px var(--color-background)",
              }}
            >
              {n.label}
            </span>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Sankey flow data</caption>
        <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {links.map((l, i) => (
            <tr key={i}>
              <th scope="row">{nodes.find((n) => n.id === l.source)?.label ?? l.source}</th>
              <td>{nodes.find((n) => n.id === l.target)?.label ?? l.target}</td>
              <td>{formatCompact(l.value, valuePrefix)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const SankeyChart = memo(SankeyChartImpl);
