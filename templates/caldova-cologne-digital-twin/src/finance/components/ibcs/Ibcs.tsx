// Shared IBCS SVG building blocks (ChartKitchen grammar).

import type { ReactNode } from 'react';

import { C, scenPaint, type Code } from '@finance/lib/cockpit/ibcs';
import { cn } from '@finance/lib/utils';

/** Hatch patterns: 5x5 tile rotated 45°, one 2.4 px line on paper (≈50 % ink). */
export function IbcsDefs({ uid }: { uid: string }) {
  const pat = (id: string, col: string) => (
    <pattern id={`${uid}-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="5" height="5" fill={C.paper} />
      <line x1="0" y1="0" x2="0" y2="5" stroke={col} strokeWidth="2.4" />
    </pattern>
  );
  return (
    <defs>
      {pat('h-dark', C.ac)}
      {pat('h-pos', C.good)}
      {pat('h-neg', C.bad)}
    </defs>
  );
}

/**
 * Zero line of a variance tier in reference notation: PY light bar 3.5 px,
 * PL double line ±1.6 px, otherwise a single dark line 1.4 px.
 * `orient="h"` draws a horizontal axis (column charts), `"v"` a vertical one (bar charts).
 */
export function RefAxis({
  code,
  orient,
  at,
  from,
  to,
}: {
  code: Code;
  orient: 'h' | 'v';
  at: number;
  from: number;
  to: number;
}) {
  const line = (o: number, w: number, col: string) =>
    orient === 'h' ? (
      <line x1={from} x2={to} y1={at + o} y2={at + o} stroke={col} strokeWidth={w} />
    ) : (
      <line y1={from} y2={to} x1={at + o} x2={at + o} stroke={col} strokeWidth={w} />
    );
  if (code === 'PY') return line(0, 3.5, C.py);
  if (code === 'PL')
    return (
      <g>
        {line(-1.6, 1, C.ac)}
        {line(1.6, 1, C.ac)}
      </g>
    );
  return line(0, 1.4, C.ac);
}

/**
 * Pin head in the minuend's notation, in ink: AC solid, FC hatched, PL outlined. IBCS: the stem carries the impact
 * (green or red, drawn by the caller), the head carries the scenario, as in the ChartKitchen visuals.
 */
export function PinHead({ cx, cy, r, minuend, uid }: { cx: number; cy: number; r: number; minuend: Code; uid: string }) {
  if (minuend === 'PL') return <circle cx={cx} cy={cy} r={r} fill={C.paper} stroke={C.ac} strokeWidth={1.4} />;
  if (minuend === 'FC') return <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-h-dark)`} stroke={C.ac} strokeWidth={1} />;
  return <circle cx={cx} cy={cy} r={r} fill={C.ac} />;
}

/** HTML scenario swatch for legends and titles. */
export function ScenarioSwatch({ code, className }: { code: Code | 'AC&FC'; className?: string }) {
  const base = 'inline-block size-[10px] shrink-0 align-middle';
  if (code === 'AC&FC')
    return (
      <span className={cn(base, 'flex overflow-hidden border border-[color:var(--ibcs-ac)]', className)} aria-hidden="true">
        <span className="h-full w-1/2 bg-[color:var(--ibcs-ac)]" />
        <span className="hatch h-full w-1/2" />
      </span>
    );
  const p = scenPaint(code, 'x');
  if (code === 'FC') return <span className={cn(base, 'hatch border border-[color:var(--ibcs-ac)]', className)} aria-hidden="true" />;
  return (
    <span
      className={cn(base, className)}
      style={{ background: p.fill, border: p.stroke !== 'none' ? `1.3px solid ${p.stroke}` : undefined }}
      aria-hidden="true"
    />
  );
}

export function ScenarioTag({ code, children }: { code: Code | 'AC&FC'; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-100 font-monospace text-100 font-medium tracking-wide">
      <ScenarioSwatch code={code} />
      {children ?? code}
    </span>
  );
}

/** Δ% pill like the ChartKitchen KPI card: rounded, white text on good/bad. */
export function VariancePill({ value, good, children }: { value: number; good: boolean; children: ReactNode }) {
  if (!Number.isFinite(value)) return <span className="font-monospace text-100 text-muted-foreground">n. a.</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-200-nudge py-100-nudge font-monospace text-100 font-bold text-white"
      style={{ background: good ? C.good : C.bad }}
    >
      {good ? '▲' : '▼'} {children}
    </span>
  );
}
