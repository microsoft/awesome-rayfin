import { memo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { formatCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor } from "./chart-shared";

export interface HeatmapChartProps {
  rows: string[];
  cols: string[];
  /** values[rowIndex][colIndex]. */
  values: number[][];
  valuePrefix?: string;
  /**
   * Show the numeric value inside each cell. Rendered in a translucent chip whose
   * composited background always clears WCAG AA against the cell fill, so values
   * stay legible across the whole intensity ramp (in both themes).
   */
  showValues?: boolean;
  /** Click / Enter on a cell drills into it. */
  onSelect?: (info: { row: string; col: string; value: number; rowIndex: number; colIndex: number }) => void;
}

/**
 * Heatmap matrix — a rows×cols grid where a single-hue intensity encodes each value.
 * Cells are hover- and keyboard-focusable (2-D arrow navigation) with a tooltip and
 * an onSelect drill; a gradient legend anchors the scale. Pure HTML/CSS grid.
 */
function HeatmapChartImpl({ rows, cols, values, valuePrefix = "", showValues = false, onSelect }: HeatmapChartProps) {
  const { tip, show, hide } = useChartCursor();
  const [active, setActive] = useState<[number, number] | null>(null);
  const [focused, setFocused] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const flat = values.flat();
  // Frame across the actual data range (not anchored to zero) so intensity spreads.
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;
  const intensity = (v: number) => 0.12 + 0.86 * Math.pow((v - min) / span, 0.85);
  // Deep-navy → azure ramp. The top anchor (#0f6cbd) is deliberately kept dark
  // enough that plain white text clears WCAG AA (~5.4:1) on the brightest cell,
  // so values sit directly on the fill — no translucent chip needed.
  const RAMP_LO = "#0a1a33";
  const RAMP_HI = "#0f6cbd";
  const cellFill = (v: number) => `color-mix(in srgb, ${RAMP_HI} ${Math.round(intensity(v) * 100)}%, ${RAMP_LO})`;

  const content = (r: number, c: number) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{rows[r]} · {cols[c]}</span>
      <span className="tabular-nums text-muted-foreground">{formatCompact(values[r]?.[c] ?? 0, valuePrefix)}</span>
    </div>
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!rows.length || !cols.length) return;
    let [r, c] = active ?? [0, 0];
    switch (e.key) {
      case "ArrowRight": c = Math.min(cols.length - 1, c + 1); break;
      case "ArrowLeft": c = Math.max(0, c - 1); break;
      case "ArrowDown": r = Math.min(rows.length - 1, r + 1); break;
      case "ArrowUp": r = Math.max(0, r - 1); break;
      case "Home": c = 0; break;
      case "End": c = cols.length - 1; break;
      case "Enter":
      case " ":
        if (onSelect && active) { e.preventDefault(); onSelect({ row: rows[r], col: cols[c], value: values[r]?.[c] ?? 0, rowIndex: r, colIndex: c }); }
        return;
      default: return;
    }
    e.preventDefault();
    setActive([r, c]);
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`);
    if (cell) { const b = cell.getBoundingClientRect(); show(b.left + b.width / 2, b.top, content(r, c)); }
  };

  if (rows.length === 0 || cols.length === 0) return null;

  return (
    <div className="flex flex-col gap-s">
      <div
        ref={gridRef}
        role="group"
        tabIndex={0}
        aria-label={`Heatmap, ${rows.length} rows by ${cols.length} columns. Use arrow keys to explore.`}
        onKeyDown={onKeyDown}
        onFocus={() => { if (!active) setActive([0, 0]); setFocused(true); }}
        onBlur={() => { setFocused(false); hide(); }}
        className="grid gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ gridTemplateColumns: `minmax(56px,auto) repeat(${cols.length}, minmax(0,1fr))` }}
      >
        <span aria-hidden="true" />
        {cols.map((c) => (
          <span key={c} className="truncate px-1 pb-0.5 text-center text-100 font-medium text-muted-foreground">{c}</span>
        ))}

        {rows.map((rlabel, r) => (
          <div key={rlabel} className="contents">
            <span className="flex items-center truncate pr-1 text-100 font-medium text-muted-foreground">{rlabel}</span>
            {cols.map((clabel, c) => {
              const v = values[r]?.[c] ?? 0;
              const isActive = active && active[0] === r && active[1] === c;
              return (
                <button
                  key={clabel}
                  data-cell={`${r}-${c}`}
                  type="button"
                  aria-label={`${rlabel}, ${clabel}: ${formatCompact(v, valuePrefix)}`}
                  onMouseMove={(e) => { setActive([r, c]); show(e.clientX, e.clientY, content(r, c)); }}
                  onMouseLeave={() => { if (!focused) hide(); }}
                  onClick={onSelect ? () => onSelect({ row: rlabel, col: clabel, value: v, rowIndex: r, colIndex: c }) : undefined}
                  className={
                    "chart-draw-dash flex h-9 items-center justify-center rounded-md ring-1 ring-inset ring-border/40 transition-transform duration-150 hover:scale-[1.06] hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                    (isActive ? "scale-[1.06] ring-2 ring-ring " : "") +
                    (onSelect ? "cursor-pointer " : "")
                  }
                  style={{
                    background: cellFill(v),
                    animationDelay: `${(r * cols.length + c) * 18}ms`,
                  }}
                >
                  {showValues ? (
                    <span
                      className="text-[10.5px] font-semibold leading-none tabular-nums text-white"
                      style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
                    >
                      {formatCompact(v, valuePrefix)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-100 text-muted-foreground">
        <span className="tabular-nums">{formatCompact(min, valuePrefix)}</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${RAMP_LO}, ${RAMP_HI})` }} aria-hidden="true" />
        <span className="tabular-nums">{formatCompact(max, valuePrefix)}</span>
      </div>

      <table className="sr-only">
        <caption>Heatmap data</caption>
        <thead><tr><th scope="col"></th>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((rlabel, r) => (
            <tr key={rlabel}><th scope="row">{rlabel}</th>{cols.map((clabel, c) => <td key={clabel}>{formatCompact(values[r]?.[c] ?? 0, valuePrefix)}</td>)}</tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const HeatmapChart = memo(HeatmapChartImpl);
