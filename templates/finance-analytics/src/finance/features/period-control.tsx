import { useEffect, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Select } from "../primitives";
import { cn } from "../lib/cn";
import {
  PERIOD_PRESETS,
  GRANULARITIES,
  periodSummary,
  type PeriodValue,
  type Granularity,
  type PeriodPresetId,
} from "../lib/period";

export interface PeriodControlProps {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  /** Restrict the offered grains (defaults to all four). */
  granularities?: Granularity[];
  /** Restrict the offered presets (defaults to all). */
  presets?: PeriodPresetId[];
}

/**
 * Global period + granularity control, rendered as pinned pills inside the filter
 * bar (not a separate surface). A preset range dropdown, an optional custom
 * start/end, and a D/W/M/Q grain toggle. State is owned by the app (URL-persisted)
 * and applied to the shared table when a date column is configured.
 */
export function PeriodControl({ value, onChange, granularities, presets }: PeriodControlProps) {
  const grains = GRANULARITIES.filter((g) => !granularities || granularities.includes(g.id));
  const presetOpts = PERIOD_PRESETS.filter((p) => !presets || presets.includes(p.id)).map((p) => ({ value: p.id, label: p.label }));
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const startRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setShowCustom(value.preset === "custom"), [value.preset]);
  useEffect(() => {
    if (showCustom) startRef.current?.focus();
  }, [showCustom]);

  const setPreset = (preset: string) => onChange({ ...value, preset: preset as PeriodPresetId });
  const setGran = (granularity: Granularity) => onChange({ ...value, granularity });

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={`Period: ${periodSummary(value)}`}>
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 py-1 pl-3 pr-1 text-sm">
        <CalendarRange size={14} className="text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">Period</span>
        <Select aria-label="Period range" value={value.preset} onChange={setPreset} options={presetOpts} className="min-w-[9.5rem]" />
      </div>

      {showCustom ? (
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/70 px-2 py-1 text-sm">
          <input
            ref={startRef}
            type="date"
            aria-label="Period start"
            value={value.start ?? ""}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            className="rounded bg-transparent px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [color-scheme:light_dark]"
          />
          <span className="text-muted-foreground" aria-hidden="true">→</span>
          <input
            type="date"
            aria-label="Period end"
            value={value.end ?? ""}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            className="rounded bg-transparent px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [color-scheme:light_dark]"
          />
        </div>
      ) : null}

      {/* Granularity toggle only renders when the app offers more than one grain.
          A single-grain config (e.g. month-only) has nothing to switch, so the
          control is omitted entirely rather than hidden — a `hidden` utility can
          lose to `inline-flex` in the compiled order and leak a lone "M" pill. */}
      {grains.length > 1 ? (
        <div role="group" aria-label="Granularity" className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card/70 p-0.5">
          {grains.map((g) => {
            const active = value.granularity === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGran(g.id)}
                aria-pressed={active}
                title={g.label}
                className={cn(
                  "min-w-[1.9rem] rounded-full px-2 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {g.short}
                <span className="sr-only"> {g.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
