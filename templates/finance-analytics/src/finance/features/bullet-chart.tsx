import { memo, useEffect, useRef, useState } from "react";
import { formatCompact, formatSignedPercent } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export interface BulletDatum {
  label: string;
  /** Realized value (the measure bar). */
  actual: number;
  /** Target / plan the actual is measured against (the marker). */
  target: number;
  /**
   * Qualitative band thresholds as fractions of target, ascending — e.g.
   * [0.7, 0.9] renders <70% poor, 70–90% satisfactory, ≥90% good. Defaults to
   * [0.7, 0.9].
   */
  ranges?: [number, number];
}

export interface BulletChartProps {
  data: BulletDatum[];
  valuePrefix?: string;
  rowHeight?: number;
  onSelect?: (datum: BulletDatum, index: number) => void;
}

const attain = (d: BulletDatum) => (d.target === 0 ? 0 : d.actual / d.target);

/**
 * Bullet chart — the compact "am I on plan?" visual. Each row overlays an actual
 * bar on qualitative background bands with a target marker, so attainment reads at
 * a glance. Favourable (≥ target) bars are green, short-of-target amber/red. Rich
 * tooltip, keyboard traversal, screen-reader table. Pure HTML/CSS, zero deps.
 */
function BulletChartImpl({ data, valuePrefix = "", rowHeight = 34, onSelect }: BulletChartProps) {
  const { tip, show, hide } = useChartCursor();
  const { active, setActive, onKeyDown } = useRovingIndex(
    data.length,
    onSelect ? (i) => onSelect(data[i], i) : undefined,
  );
  const [focused, setFocused] = useState(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const content = (i: number) => {
    const d = data[i];
    if (!d) return null;
    const pct = attain(d);
    const hit = pct >= 1;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{d.label}</span>
        <span className="tabular-nums text-muted-foreground">
          Actual {formatCompact(d.actual, valuePrefix)} · Target {formatCompact(d.target, valuePrefix)}
        </span>
        <span className={"font-medium tabular-nums " + (hit ? "text-success" : pct >= 0.9 ? "text-foreground" : "text-destructive")}>
          {Math.round(pct * 100)}% of target ({formatSignedPercent(pct - 1)} vs plan)
        </span>
      </div>
    );
  };

  useEffect(() => {
    if (!focused) return;
    const el = rowRefs.current[active];
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(r.left + r.width / 2, r.top, content(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focused]);

  if (data.length === 0) return null;

  // Shared scale so bars are comparable across rows.
  const scaleMax = Math.max(...data.map((d) => Math.max(d.actual, d.target)), 1) * 1.08;

  return (
    <div className="flex h-full flex-col justify-center">
      <div
        role="group"
        tabIndex={0}
        aria-label="Attainment vs target by category. Use arrow keys to explore."
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); hide(); }}
        className="flex flex-col gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {data.map((d, i) => {
          const pct = attain(d);
          const hit = pct >= 1;
          const [lo, hiThr] = d.ranges ?? [0.7, 0.9];
          const barPct = Math.min(d.actual / scaleMax, 1) * 100;
          const targetPct = Math.min(d.target / scaleMax, 1) * 100;
          const band1 = Math.min((d.target * lo) / scaleMax, 1) * 100;
          const band2 = Math.min((d.target * hiThr) / scaleMax, 1) * 100;
          const isActive = focused && i === active;
          const barCls = hit
            ? "from-success/60 to-success"
            : pct >= hiThr
              ? "from-chart-5/60 to-chart-5"
              : "from-destructive/60 to-destructive";
          return (
            <div
              key={d.label}
              ref={(el) => { rowRefs.current[i] = el; }}
              role={onSelect ? "button" : undefined}
              aria-label={onSelect ? `${d.label}: ${Math.round(pct * 100)}% of target` : undefined}
              onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
              onMouseLeave={() => { if (!focused) hide(); }}
              onClick={onSelect ? () => onSelect(d, i) : undefined}
              className={
                "grid grid-cols-[minmax(72px,116px)_1fr_auto] items-center gap-x-m rounded-md px-xs transition-colors " +
                (onSelect ? "cursor-pointer hover:bg-accent/60 " : "") +
                (isActive ? "bg-accent/70 ring-1 ring-ring " : "")
              }
              style={{ height: rowHeight }}
            >
              <span className="truncate text-200 text-muted-foreground">{d.label}</span>
              <div className="relative h-[18px] overflow-hidden rounded-[4px] bg-secondary/50" aria-hidden="true">
                {/* qualitative bands (poor → satisfactory → good) */}
                <span className="absolute inset-y-0 left-0 bg-muted-foreground/[0.16]" style={{ width: `${band1}%` }} />
                <span className="absolute inset-y-0 bg-muted-foreground/[0.09]" style={{ left: `${band1}%`, width: `${Math.max(band2 - band1, 0)}%` }} />
                {/* actual measure bar */}
                <span
                  className={"bar-grow-x absolute inset-y-[3px] left-0 rounded-r-[3px] bg-gradient-to-r shadow-sm " + barCls}
                  style={{ width: `${barPct}%`, transformOrigin: "left", animationDelay: `${i * 45}ms` }}
                />
                {/* target marker */}
                <span
                  className="absolute inset-y-0 w-[2.5px] -translate-x-1/2 rounded bg-foreground/85"
                  style={{ left: `${targetPct}%` }}
                />
              </div>
              <span className={"w-10 text-right text-200 font-semibold tabular-nums " + (hit ? "text-success" : pct >= hiThr ? "text-foreground" : "text-destructive")}>
                {Math.round(pct * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Attainment vs target</caption>
        <thead>
          <tr><th scope="col">Category</th><th scope="col">Actual</th><th scope="col">Target</th><th scope="col">Attainment</th></tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.label}</th>
              <td>{formatCompact(d.actual, valuePrefix)}</td>
              <td>{formatCompact(d.target, valuePrefix)}</td>
              <td>{Math.round(attain(d) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const BulletChart = memo(BulletChartImpl);
