import { memo, useEffect, useRef, useState } from "react";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export interface VarianceDatum {
  label: string;
  /** The realized value. */
  actual: number;
  /** The plan/budget it is compared against. */
  budget: number;
}

export interface VarianceBarProps {
  data: VarianceDatum[];
  valuePrefix?: string;
  /** Row height in px (compact by default). */
  rowHeight?: number;
  /** Click / Enter on a row drills into that category. */
  onSelect?: (datum: VarianceDatum, index: number) => void;
}

const variance = (d: VarianceDatum) => d.actual - d.budget;
const ratio = (d: VarianceDatum) => (d.budget === 0 ? 0 : variance(d) / Math.abs(d.budget));

/**
 * Diverging variance bar — favourable variance grows right in green, unfavourable
 * grows left in red from a shared centre baseline. Each row is hover/keyboard
 * focusable with a rich tooltip (actual vs budget, absolute + % variance) and an
 * onSelect drill. Pure HTML/CSS, zero chart-library weight.
 */
function VarianceBarImpl({ data, valuePrefix = "", rowHeight = 30, onSelect }: VarianceBarProps) {
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
    const v = variance(d);
    const fav = v >= 0;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{d.label}</span>
        <span className="tabular-nums text-muted-foreground">
          Actual {formatCompact(d.actual, valuePrefix)} · Budget {formatCompact(d.budget, valuePrefix)}
        </span>
        <span className={"font-numeric font-medium tabular-nums " + (fav ? "text-success" : "text-destructive")}>
          {formatSignedCompact(v, valuePrefix)} ({formatSignedPercent(ratio(d))}) {fav ? "favourable" : "unfavourable"}
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

  const maxAbs = Math.max(...data.map((d) => Math.abs(variance(d))), 1);

  return (
    <div className="flex h-full flex-col justify-center">
      <div
        role="group"
        tabIndex={0}
        aria-label="Variance to budget by category. Use arrow keys to explore."
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); hide(); }}
        className="flex flex-col gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {data.map((d, i) => {
          const v = variance(d);
          const fav = v >= 0;
          const barPct = (Math.abs(v) / maxAbs) * 72;
          const isActive = focused && i === active;
          return (
            <div
              key={d.label}
              ref={(el) => { rowRefs.current[i] = el; }}
              role={onSelect ? "button" : undefined}
              aria-label={onSelect ? `${d.label}: ${formatSignedCompact(v, valuePrefix)} variance` : undefined}
              onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
              onMouseLeave={() => { if (!focused) hide(); }}
              onClick={onSelect ? () => onSelect(d, i) : undefined}
              className={
                "grid grid-cols-[minmax(72px,116px)_1fr] items-center gap-x-m rounded-md px-xs transition-colors " +
                (onSelect ? "cursor-pointer hover:bg-accent/60 " : "") +
                (isActive ? "bg-accent/70 ring-1 ring-ring " : "")
              }
              style={{ height: rowHeight }}
            >
              <span className="truncate text-200 text-muted-foreground">{d.label}</span>
              <div className="relative h-5" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
                {fav ? (
                  <div className="absolute inset-y-0 left-1/2 right-0 flex items-center">
                    <span
                      className="bar-grow-x h-3.5 rounded-r-[3px] bg-gradient-to-r from-success/60 to-success shadow-sm"
                      style={{ width: `${barPct}%`, transformOrigin: "left", animationDelay: `${i * 45}ms` }}
                    />
                    <span className="ml-1.5 whitespace-nowrap text-200 font-semibold tabular-nums text-success">
                      {formatSignedCompact(v, valuePrefix)}
                    </span>
                  </div>
                ) : (
                  <div className="absolute inset-y-0 left-0 right-1/2 flex items-center justify-end">
                    <span className="mr-1.5 whitespace-nowrap text-200 font-semibold tabular-nums text-destructive">
                      {formatSignedCompact(v, valuePrefix)}
                    </span>
                    <span
                      className="bar-grow-x h-3.5 rounded-l-[3px] bg-gradient-to-l from-destructive/60 to-destructive shadow-sm"
                      style={{ width: `${barPct}%`, transformOrigin: "right", animationDelay: `${i * 45}ms` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Variance to budget</caption>
        <thead>
          <tr><th scope="col">Category</th><th scope="col">Actual</th><th scope="col">Budget</th><th scope="col">Variance</th><th scope="col">Variance %</th></tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.label}</th>
              <td>{formatCompact(d.actual, valuePrefix)}</td>
              <td>{formatCompact(d.budget, valuePrefix)}</td>
              <td>{formatSignedCompact(variance(d), valuePrefix)}</td>
              <td>{formatSignedPercent(ratio(d))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const VarianceBar = memo(VarianceBarImpl);
