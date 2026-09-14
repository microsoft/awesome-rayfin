import { memo, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex, niceTicks } from "./chart-shared";

export interface StackSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface StackedBarProps {
  categories: string[];
  series: StackSeries[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a bar drills into that category. */
  onSelect?: (category: string, index: number) => void;
}

const DEFAULTS = [
  "#4f7cf7", "#9b6ef0", "#26c0a6", "#f2b45c", "#f0688a", "#3cc6e0",
];

/** Glossy top-lit fill so segments read with depth instead of flat colour. */
const sheen = (c: string) =>
  `linear-gradient(180deg, color-mix(in srgb, ${c} 76%, #fff 24%) 0%, ${c} 58%, color-mix(in srgb, ${c} 90%, #000 10%) 100%)`;

/**
 * Stacked bar chart — composition of several series per category with a nice-scaled
 * total axis, legend, per-segment hover tooltip (value + share of the stack) and
 * keyboard traversal across categories. Segments grow from the baseline. Pure HTML.
 */
function StackedBarImpl({ categories, series, height = 240, valuePrefix = "", onSelect }: StackedBarProps) {
  const { tip, show, hide } = useChartCursor();
  const n = categories.length;
  const { active, setActive, onKeyDown } = useRovingIndex(n, onSelect ? (i) => onSelect(categories[i], i) : undefined);
  const [focused, setFocused] = useState(false);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  const totals = categories.map((_, ci) => series.reduce((s, se) => s + (se.values[ci] ?? 0), 0));
  const max = Math.max(...totals, 0);
  const { ticks, niceMax } = niceTicks(0, max, 4);
  const domain = niceMax || 1;
  const color = (i: number, s: StackSeries) => s.color ?? DEFAULTS[i % DEFAULTS.length];

  const columnTip = (ci: number) => (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{categories[ci]}</span>
      {series.map((s, si) => {
        const v = s.values[ci] ?? 0;
        const share = totals[ci] ? Math.round((v / totals[ci]) * 100) : 0;
        return (
          <span key={s.name} className="flex items-center gap-1.5 tabular-nums">
            <span className="size-2 rounded-sm" style={{ background: color(si, s) }} aria-hidden="true" />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="ml-auto font-medium">{formatCompact(v, valuePrefix)}</span>
            <span className="text-[11px] text-muted-foreground">{share}%</span>
          </span>
        );
      })}
      <span className="mt-0.5 flex justify-between border-t border-border pt-1 tabular-nums">
        <span className="text-muted-foreground">Total</span>
        <span className="font-medium">{formatCompact(totals[ci], valuePrefix)}</span>
      </span>
    </div>
  );

  const showCol = (ci: number) => {
    const el = colRefs.current[ci];
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(r.left + r.width / 2, r.top, columnTip(ci));
  };

  if (n === 0 || series.length === 0) return null;

  return (
    <div className="flex flex-col gap-s">
      <div className="flex flex-wrap items-center gap-x-l gap-y-1">
        {series.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1.5 text-100 text-muted-foreground">
            <span className="size-2.5 rounded-sm" style={{ background: sheen(color(si, s)) }} aria-hidden="true" />
            {s.name}
          </span>
        ))}
      </div>

      <div className="flex flex-col" style={{ height: height + 24 }}>
        <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-m">
          <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
            {ticks.map((t, i) => <span key={i}>{formatCompact(t, valuePrefix)}</span>)}
          </div>

          <div
            role="group"
            tabIndex={0}
            aria-label={`Stacked bar chart with ${series.length} series across ${n} categories. Use arrow keys to explore.`}
            onKeyDown={onKeyDown}
            onFocus={() => { setFocused(true); showCol(active); }}
            onBlur={() => { setFocused(false); hide(); }}
            className="relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
              {ticks.map((t, i) => <span key={i} className="h-px w-full bg-border/40" />)}
            </div>

            <div className="relative flex h-full items-end gap-4">
              {categories.map((cat, ci) => {
                const isActive = focused && ci === active;
                return (
                  <div
                    key={cat}
                    ref={(el) => { colRefs.current[ci] = el; }}
                    className={"relative flex h-full flex-1 flex-col-reverse gap-[3px] " + (isActive ? "z-10" : "")}
                    onMouseMove={() => { setActive(ci); showCol(ci); }}
                    onMouseLeave={() => { if (!focused) hide(); }}
                  >
                    {series.map((s, si) => {
                      const v = s.values[ci] ?? 0;
                      const pct = (v / domain) * 100;
                      if (pct <= 0) return null;
                      return (
                        <div
                          key={s.name}
                          role={onSelect ? "button" : undefined}
                          aria-label={onSelect ? `${cat}, ${s.name}: ${formatCompact(v, valuePrefix)}` : undefined}
                          onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(cat, ci); } : undefined}
                          className={
                            "bar-grow w-full rounded-[5px] shadow-sm transition-[filter,transform] duration-200 hover:brightness-110 " +
                            (onSelect ? "cursor-pointer " : "")
                          }
                          style={{ height: `${pct}%`, background: sheen(color(si, s)), animationDelay: `${ci * 45 + si * 30}ms` }}
                        />
                      );
                    })}
                    {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-ring ring-offset-2 ring-offset-background" /> : null}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 -translate-y-1 text-center text-[10px] font-semibold tabular-nums text-foreground"
                      style={{ bottom: `${(totals[ci] / domain) * 100}%` }}
                    >
                      {formatCompact(totals[ci], valuePrefix)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div aria-hidden="true" />
          <div className="mt-xs flex gap-3">
            {categories.map((c, i) => (
              <span key={c} className={"flex-1 truncate text-center text-100 " + (focused && i === active ? "font-medium text-foreground" : "text-muted-foreground")}>{c}</span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Stacked bar chart data</caption>
        <thead>
          <tr><th scope="col">Category</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}<th scope="col">Total</th></tr>
        </thead>
        <tbody>
          {categories.map((c, i) => (
            <tr key={c}><th scope="row">{c}</th>{series.map((s) => <td key={s.name}>{formatCompact(s.values[i] ?? 0, valuePrefix)}</td>)}<td>{formatCompact(totals[i], valuePrefix)}</td></tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const StackedBar = memo(StackedBarImpl);
