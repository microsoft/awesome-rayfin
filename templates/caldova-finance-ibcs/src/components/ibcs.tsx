// IBCS building blocks, after Michael Tenner's Finance Cockpit (MIT, see NOTICE): scenario notation
// AC solid, PY grey, PL outlined, FC hatched; variances point by their sign and are coloured by their impact.

import type { CurrentCode } from '@/hooks/FinanceContext';

export type Mark = 'AC' | 'PY' | 'PL' | 'FC' | 'AC&FC';

/** Scenario swatch for table heads and legends. */
export function ScenarioMark({ s }: { s: Mark | CurrentCode }) {
  const base = 'inline-block size-[10px] shrink-0 align-[-1px]';
  if (s === 'AC') return <span className={`${base} bg-ac`} aria-hidden="true" />;
  if (s === 'PY') return <span className={`${base} bg-py`} aria-hidden="true" />;
  if (s === 'PL') return <span className={`${base} border-[1.5px] border-ac bg-paper`} aria-hidden="true" />;
  if (s === 'FC') return <span className={`${base} hatch border border-ac`} aria-hidden="true" />;
  return (
    <span className={`${base} flex overflow-hidden border border-ac`} aria-hidden="true">
      <span className="h-full w-1/2 bg-ac" />
      <span className="hatch h-full w-1/2" />
    </span>
  );
}

export function ScenarioLabel({ s, children }: { s: Mark | CurrentCode; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold tracking-wide">
      <ScenarioMark s={s} />
      {children ?? s}
    </span>
  );
}

/** SVG hatch patterns; put once into every chart svg with its own id prefix. */
export function HatchDefs({ id }: { id: string }) {
  const pat = (name: string, color: string) => (
    <pattern id={`${id}-${name}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="4" fill="var(--paper)" />
      <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
    </pattern>
  );
  return (
    <defs>
      {pat('fc', 'var(--ac)')}
      {pat('good', 'var(--good)')}
      {pat('bad', 'var(--bad)')}
    </defs>
  );
}

/** good / bad by impact; neutral for lines without a direction and for zero. */
export type Tone = 'good' | 'bad' | 'neutral';

/** The tone of a variance: by impact, neutral when the line has no direction or the variance rounds to zero. */
export function toneOf(delta: number | undefined, goodUp: boolean | null, zero = 500): Tone {
  if (delta === undefined || !Number.isFinite(delta) || goodUp === null || Math.abs(delta) < zero) return 'neutral';
  return (delta > 0) === goodUp ? 'good' : 'bad';
}

const toneColor = (t: Tone) => (t === 'good' ? 'var(--good)' : t === 'bad' ? 'var(--bad)' : 'var(--py)');

/** Absolute variance bar around a zero axis. Direction by sign, colour by impact, one scale per column. */
export function VarianceBar({ value, max, width, tone, hatched }: { value: number | undefined; max: number; width: number; tone: Tone; hatched?: boolean }) {
  const half = width / 2;
  if (value === undefined || !Number.isFinite(value)) return <svg width={width} height={12} aria-hidden="true" />;
  const len = max > 0 ? Math.min(half - 1, (Math.abs(value) / max) * (half - 1)) : 0;
  const color = toneColor(tone);
  return (
    <svg width={width} height={12} aria-hidden="true" className="block">
      {hatched && (
        <defs>
          <pattern id={`vb-${tone}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--paper)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
          </pattern>
        </defs>
      )}
      <rect x={value >= 0 ? half : half - len} y={2} width={len} height={8} fill={hatched ? `url(#vb-${tone})` : color} stroke={hatched ? color : 'none'} strokeWidth={hatched ? 0.8 : 0} />
      <line x1={half} x2={half} y1={0} y2={12} stroke="var(--ink)" strokeWidth={1} />
    </svg>
  );
}

/**
 * Relative variance as a pin ("needle"); nothing for a variance that rounds to zero.
 *
 * IBCS: colour carries the impact, the head carries the scenario. The STEM is green, red, or grey for lines without
 * a direction; the HEAD is in the notation of the minuend (the scenario compared): solid ink for AC, hatched with an
 * ink outline for FC and for AC&FC periods that contain forecast months. Same split as the ChartKitchen visuals.
 */
export function VariancePin({ value, max, width, tone, minuend = 'AC' }: { value: number | undefined; max: number; width: number; tone: Tone; minuend?: Mark }) {
  const half = width / 2;
  if (value === undefined || !Number.isFinite(value) || max <= 0 || Math.abs(value) < 0.0005)
    return (
      <svg width={width} height={12} aria-hidden="true" className="block">
        <line x1={half} x2={half} y1={0} y2={12} stroke="var(--ink)" strokeWidth={1} />
      </svg>
    );
  const capped = Math.abs(value) > max;
  const len = Math.min(half - 5, (Math.abs(value) / max) * (half - 5));
  const x = value >= 0 ? half + len : half - len;
  const hatched = minuend === 'FC' || minuend === 'AC&FC';
  const head = { fill: hatched ? 'url(#pin-head-fc)' : 'var(--ink)', stroke: 'var(--ink)', strokeWidth: hatched ? 0.9 : 0 };
  return (
    <svg width={width} height={12} aria-hidden="true" className="block">
      {hatched && (
        <defs>
          <pattern id="pin-head-fc" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="var(--paper)" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="var(--ink)" strokeWidth="1.5" />
          </pattern>
        </defs>
      )}
      <line x1={half} x2={x} y1={6} y2={6} stroke={toneColor(tone)} strokeWidth={2} />
      {capped ? (
        <path d={value >= 0 ? `M${x - 3.5},1.5 L${x + 3.5},6 L${x - 3.5},10.5 Z` : `M${x + 3.5},1.5 L${x - 3.5},6 L${x + 3.5},10.5 Z`} {...head} />
      ) : (
        <rect x={x - 3.5} y={2.5} width={7} height={7} {...head} />
      )}
      <line x1={half} x2={half} y1={0} y2={12} stroke="var(--ink)" strokeWidth={1} />
    </svg>
  );
}

/**
 * Outlier cap for a column of relative variances: with at least 4 values, if the largest is more than 2.5x the
 * next one, scale to the next one (the capped pin gets an arrow head).
 */
export function relCap(values: (number | undefined)[]): number {
  const a = values.filter((v): v is number => v !== undefined && Number.isFinite(v)).map(Math.abs).sort((x, y) => y - x);
  if (a.length === 0) return 1;
  if (a.length >= 4 && a[0] > 2.5 * a[1] && a[1] > 0) return a[1];
  return a[0] || 1;
}
