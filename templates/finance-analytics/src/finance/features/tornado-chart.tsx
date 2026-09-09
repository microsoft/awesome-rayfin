import { memo, useEffect, useRef, useState } from "react";
import { formatCompact, formatSignedCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export interface TornadoDatum {
  label: string;
  /** Outcome when this driver is at its low / downside setting. */
  low: number;
  /** Outcome when this driver is at its high / upside setting. */
  high: number;
}

export interface TornadoChartProps {
  /** The base-case outcome the swings are measured around. */
  base: number;
  drivers: TornadoDatum[];
  valuePrefix?: string;
  rowHeight?: number;
  onSelect?: (datum: TornadoDatum, index: number) => void;
}

const swing = (d: TornadoDatum) => Math.abs(d.high - d.low);

/**
 * Tornado / sensitivity chart — one horizontal bar per driver spanning its downside
 * to upside outcome around a shared base line, sorted by swing so the widest sits on
 * top (the tornado shape). The portion below base is red, above base green, so the
 * biggest risk/opportunity levers read instantly. Rich tooltip, keyboard, SR table.
 */
function TornadoChartImpl({ base, drivers, valuePrefix = "", rowHeight = 34, onSelect }: TornadoChartProps) {
  const { tip, show, hide } = useChartCursor();
  const sorted = [...drivers].sort((a, b) => swing(b) - swing(a));
  const { active, setActive, onKeyDown } = useRovingIndex(
    sorted.length,
    onSelect ? (i) => onSelect(sorted[i], i) : undefined,
  );
  const [focused, setFocused] = useState(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const content = (i: number) => {
    const d = sorted[i];
    if (!d) return null;
    const loD = d.low - base;
    const hiD = d.high - base;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{d.label}</span>
        <span className="tabular-nums text-muted-foreground">
          Low {formatCompact(d.low, valuePrefix)} · High {formatCompact(d.high, valuePrefix)}
        </span>
        <span className="tabular-nums">
          <span className="text-destructive">{formatSignedCompact(loD, valuePrefix)}</span>
          {" / "}
          <span className="text-success">{formatSignedCompact(hiD, valuePrefix)}</span>
          <span className="text-muted-foreground"> vs base</span>
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

  if (sorted.length === 0) return null;

  const maxAbs = Math.max(...sorted.map((d) => Math.max(Math.abs(d.low - base), Math.abs(d.high - base))), 1);
  const HALF = 46; // percent each side of the centre baseline

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mb-1.5 flex justify-center text-100 text-muted-foreground tabular-nums">
        Base case {formatCompact(base, valuePrefix)}
      </div>
      <div
        role="group"
        tabIndex={0}
        aria-label="Driver sensitivity around the base case. Use arrow keys to explore."
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); hide(); }}
        className="flex flex-col gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {sorted.map((d, i) => {
          const loD = d.low - base;
          const hiD = d.high - base;
          const lo = Math.min(loD, hiD);
          const hi = Math.max(loD, hiD);
          const negSpan = Math.max(-Math.min(lo, 0), 0);
          const posSpan = Math.max(hi, 0);
          const negPct = (negSpan / maxAbs) * HALF;
          const posPct = (posSpan / maxAbs) * HALF;
          const isActive = focused && i === active;
          return (
            <div
              key={d.label}
              ref={(el) => { rowRefs.current[i] = el; }}
              role={onSelect ? "button" : undefined}
              aria-label={onSelect ? `${d.label}: swing ${formatCompact(swing(d), valuePrefix)}` : undefined}
              onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
              onMouseLeave={() => { if (!focused) hide(); }}
              onClick={onSelect ? () => onSelect(d, i) : undefined}
              className={
                "grid grid-cols-[minmax(84px,132px)_1fr] items-center gap-x-m rounded-md px-xs transition-colors " +
                (onSelect ? "cursor-pointer hover:bg-accent/60 " : "") +
                (isActive ? "bg-accent/70 ring-1 ring-ring " : "")
              }
              style={{ height: rowHeight }}
            >
              <span className="truncate text-200 text-muted-foreground">{d.label}</span>
              <div className="relative h-4" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/40" />
                {/* downside (left, red) */}
                <div className="absolute inset-y-0 right-1/2 flex items-center justify-end">
                  {negPct > 0 ? (
                    <>
                      <span className="mr-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-destructive">
                        {formatSignedCompact(Math.min(loD, hiD), valuePrefix)}
                      </span>
                      <span className="bar-grow-x h-3 rounded-l-[3px] bg-gradient-to-l from-destructive/55 to-destructive shadow-sm"
                        style={{ width: `${negPct}%`, transformOrigin: "right", animationDelay: `${i * 45}ms` }} />
                    </>
                  ) : null}
                </div>
                {/* upside (right, green) */}
                <div className="absolute inset-y-0 left-1/2 flex items-center">
                  {posPct > 0 ? (
                    <>
                      <span className="bar-grow-x h-3 rounded-r-[3px] bg-gradient-to-r from-success/55 to-success shadow-sm"
                        style={{ width: `${posPct}%`, transformOrigin: "left", animationDelay: `${i * 45}ms` }} />
                      <span className="ml-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-success">
                        {formatSignedCompact(Math.max(loD, hiD), valuePrefix)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Driver sensitivity vs base case {formatCompact(base, valuePrefix)}</caption>
        <thead>
          <tr><th scope="col">Driver</th><th scope="col">Low</th><th scope="col">High</th><th scope="col">Swing</th></tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.label}</th>
              <td>{formatCompact(d.low, valuePrefix)}</td>
              <td>{formatCompact(d.high, valuePrefix)}</td>
              <td>{formatCompact(swing(d), valuePrefix)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const TornadoChart = memo(TornadoChartImpl);
