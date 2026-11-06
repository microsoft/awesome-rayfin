// Small IBCS building blocks shared by table, cards and charts.

import { cn } from '@finance/lib/utils';

export type Scenario = 'AC' | 'FC' | 'ACFC' | 'PL' | 'PY' | 'SIM';

/** Scenario swatch in IBCS notation: AC solid, PY grey, PL outlined, FC hatched. */
export function ScenarioMark({ s, className }: { s: Scenario; className?: string }) {
  const base = 'inline-block size-[10px] shrink-0 align-middle';
  if (s === 'AC') return <span className={cn(base, 'bg-ac', className)} aria-hidden="true" />;
  if (s === 'PY') return <span className={cn(base, 'bg-py', className)} aria-hidden="true" />;
  if (s === 'PL') return <span className={cn(base, 'border-[1.5px] border-pl', className)} aria-hidden="true" />;
  if (s === 'FC') return <span className={cn(base, 'hatch border border-fc', className)} aria-hidden="true" />;
  if (s === 'SIM') return <span className={cn(base, 'hatch-sim border border-sim', className)} aria-hidden="true" />;
  return (
    <span className={cn(base, 'flex overflow-hidden border border-ac', className)} aria-hidden="true">
      <span className="h-full w-1/2 bg-ac" />
      <span className="hatch h-full w-1/2" />
    </span>
  );
}

export function ScenarioLabel({ s, label }: { s: Scenario; label?: string }) {
  const text = label ?? (s === 'ACFC' ? 'AC+FC' : s);
  return (
    <span className="inline-flex items-center gap-100 font-monospace text-100 font-medium tracking-wide">
      <ScenarioMark s={s} />
      {text}
    </span>
  );
}

/**
 * Horizontal variance bar around a zero axis. `value` is the variance as shown
 * (its sign sets the direction), `good` its impact (the colour; defaults to
 * value >= 0), `max` the shared scale of the column. IBCS: a cost increase
 * points right and is red.
 */
export function VarianceBar({ value, max, width = 90, good = value >= 0 }: { value: number; max: number; width?: number; good?: boolean }) {
  const half = width / 2;
  const len = max > 0 && Number.isFinite(value) ? Math.min(half, (Math.abs(value) / max) * half) : 0;
  return (
    <svg width={width} height={12} aria-hidden="true" className="block">
      <rect
        x={value >= 0 ? half : half - len}
        y={2}
        width={len}
        height={8}
        fill={good ? 'var(--color-good)' : 'var(--color-bad)'}
      />
      <line x1={half} x2={half} y1={0} y2={12} stroke="var(--color-foreground)" strokeWidth={1} />
    </svg>
  );
}

/**
 * Relative variance as pin (IBCS "needle"): direction by sign. The STEM carries the impact (green or red by `good`),
 * the square HEAD carries the scenario of the minuend, in ink: solid for AC, hatched for FC and AC+FC.
 */
export function VariancePin({
  value,
  max,
  width = 70,
  good = value >= 0,
  minuend = 'AC',
}: {
  value: number;
  max: number;
  width?: number;
  good?: boolean;
  minuend?: Scenario;
}) {
  const half = width / 2;
  if (!Number.isFinite(value) || max <= 0) return <svg width={width} height={12} aria-hidden="true" />;
  const len = Math.min(half - 4, (Math.abs(value) / max) * (half - 4));
  const x = value >= 0 ? half + len : half - len;
  const color = good ? 'var(--color-good)' : 'var(--color-bad)';
  const hatched = minuend === 'FC' || minuend === 'ACFC';
  return (
    <svg width={width} height={12} aria-hidden="true" className="block">
      {hatched && (
        <defs>
          <pattern id="pin-head-fc" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="var(--color-card)" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="var(--color-fc)" strokeWidth="1.5" />
          </pattern>
        </defs>
      )}
      <line x1={half} x2={x} y1={6} y2={6} stroke={color} strokeWidth={2} />
      <rect
        x={x - 3.5}
        y={2.5}
        width={7}
        height={7}
        fill={hatched ? 'url(#pin-head-fc)' : 'var(--color-ac)'}
        stroke="var(--color-ac)"
        strokeWidth={hatched ? 0.9 : 0}
      />
      <line x1={half} x2={half} y1={0} y2={12} stroke="var(--color-foreground)" strokeWidth={1} />
    </svg>
  );
}

/** SVG <defs> with the hatch patterns used by charts. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-fc`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="var(--color-card)" />
        <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-fc)" strokeWidth="2" />
      </pattern>
      <pattern id={`${id}-sim`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="var(--color-card)" />
        <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-sim)" strokeWidth="2" />
      </pattern>
    </defs>
  );
}
