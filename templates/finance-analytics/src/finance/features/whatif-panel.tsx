import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AnimatedNumber } from "../components/animated-number";
import { formatCompact, formatSignedCompact } from "../lib/format";
import { cn } from "../lib/cn";

export interface WhatIfDriver {
  label: string;
  /** Signed downside fraction of base at full-low (e.g. -0.085 = −8.5%). */
  down: number;
  /** Signed upside fraction of base at full-high (e.g. 0.12 = +12%). */
  up: number;
}

export interface WhatIfPanelProps {
  /** Base-case outcome the sliders swing around. */
  base: number;
  drivers: WhatIfDriver[];
  valuePrefix?: string;
  /** Fired (with the recomputed scenario total) whenever a slider moves — wire it to
   *  re-center the paired tornado / any downstream visual. */
  onScenarioChange?: (total: number, positions: number[]) => void;
}

/** Per-driver delta at slider position t ∈ [-1,1]: linear toward up (t≥0) or down (t<0). */
const driverDelta = (base: number, d: WhatIfDriver, t: number) => base * (t >= 0 ? t * d.up : -t * d.down);

/**
 * What-if scenario controls. One slider per driver (full-downside ← base → full-upside),
 * live-recomputing a scenario total with an animated headline + signed delta vs base.
 * Deterministic, dependency-free; emits the new total so a host can drive the tornado.
 */
export function WhatIfPanel({ base, drivers, valuePrefix = "", onScenarioChange }: WhatIfPanelProps) {
  const [pos, setPos] = useState<number[]>(() => drivers.map(() => 0));

  const total = useMemo(
    () => base + drivers.reduce((s, d, i) => s + driverDelta(base, d, pos[i] ?? 0), 0),
    [base, drivers, pos],
  );
  const delta = total - base;
  const pct = base !== 0 ? delta / base : 0;
  const dirty = pos.some((t) => t !== 0);

  const update = (next: number[]) => {
    setPos(next);
    onScenarioChange?.(base + drivers.reduce((s, d, i) => s + driverDelta(base, d, next[i] ?? 0), 0), next);
  };
  const setAt = (i: number, t: number) => update(pos.map((p, j) => (j === i ? t : p)));
  const reset = () => update(drivers.map(() => 0));

  const tone = delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-100 uppercase tracking-wide text-muted-foreground">Scenario outcome</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              <AnimatedNumber value={total} format={(v) => formatCompact(v, valuePrefix)} />
            </span>
            <span className={cn("text-200 font-semibold tabular-nums", tone)}>
              {formatSignedCompact(delta, valuePrefix)} ({pct >= 0 ? "+" : ""}{(pct * 100).toFixed(1)}%)
            </span>
          </div>
          <div className="text-100 text-muted-foreground tabular-nums">
            vs base {formatCompact(base, valuePrefix)}
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={!dirty}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-100 font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw size={12} aria-hidden="true" /> Reset
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        {drivers.map((d, i) => {
          const t = pos[i] ?? 0;
          const dd = driverDelta(base, d, t);
          return (
            <div key={d.label} className="grid grid-cols-[minmax(84px,120px)_1fr_auto] items-center gap-x-3">
              <label htmlFor={`whatif-${i}`} className="truncate text-200 text-muted-foreground">{d.label}</label>
              <input
                id={`whatif-${i}`}
                type="range"
                min={-100}
                max={100}
                step={5}
                value={Math.round(t * 100)}
                onChange={(e) => setAt(i, Number(e.target.value) / 100)}
                aria-label={`${d.label} scenario setting`}
                aria-valuetext={`${formatSignedCompact(dd, valuePrefix)} vs base`}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span
                className={cn(
                  "w-16 text-right text-200 font-semibold tabular-nums",
                  dd > 0 ? "text-success" : dd < 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {dd === 0 ? "—" : formatSignedCompact(dd, valuePrefix)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
