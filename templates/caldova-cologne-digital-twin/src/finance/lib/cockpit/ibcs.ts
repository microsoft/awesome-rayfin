// IBCS notation helpers following the ChartKitchen chart builder
// (business-chart-builder.html: scenPaint, varPaint, refAxis, relCap, pinHead).
// Colours are CSS variables from global.css so light and dark mode both work.

export type Code = 'AC' | 'PY' | 'PL' | 'FC';

export const C = {
  ac: 'var(--ibcs-ac)', // #404040
  py: 'var(--ibcs-py)', // #a8a8a8
  paper: 'var(--ibcs-paper)', // white
  good: 'var(--ibcs-good)', // kitchen teal #117865
  bad: 'var(--ibcs-bad)', // #c0392b
  cat: 'var(--ibcs-cat)', // #555555 category labels
  sub: 'var(--ibcs-sub)', // #9a9a9a secondary labels
  hair: 'var(--ibcs-hair)', // #b4b4b4
  conn: 'var(--ibcs-conn)', // #c2c2c2 waterfall connectors
  fcInk: 'var(--ibcs-fcink)', // #6f6f6f FC value text
  hilite: 'var(--ibcs-hilite)', // #1a6fb5 highlight ellipse
};

export interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/** Scenario fill: AC solid, PY light solid, PL white outline, FC hatched. */
export function scenPaint(code: Code, uid: string): Paint {
  switch (code) {
    case 'AC':
      return { fill: C.ac, stroke: 'none', strokeWidth: 0 };
    case 'PY':
      return { fill: C.py, stroke: 'none', strokeWidth: 0 };
    case 'PL':
      return { fill: C.paper, stroke: C.ac, strokeWidth: 1.3 };
    case 'FC':
      return { fill: `url(#${uid}-h-dark)`, stroke: C.ac, strokeWidth: 0.8 };
  }
}

/** Variance fill follows the minuend's notation (AC solid, PL outline, FC hatched). */
export function varPaint(minuend: Code, good: boolean, uid: string): Paint {
  const col = good ? C.good : C.bad;
  if (minuend === 'FC') return { fill: `url(#${uid}-h-${good ? 'pos' : 'neg'})`, stroke: col, strokeWidth: 0.8 };
  if (minuend === 'PL') return { fill: C.paper, stroke: col, strokeWidth: 1.3 };
  return { fill: col, stroke: 'none', strokeWidth: 0 };
}

/**
 * Outlier cap for Δ% tiers: with at least 4 values, if the largest |value| is
 * more than 2.5x the next one, cap at that next one (capped pins get an arrow).
 */
export function relCap(values: number[]): number {
  const a = values.filter(Number.isFinite).map(Math.abs).sort((x, y) => y - x);
  if (a.length === 0) return 1;
  if (a.length >= 4) {
    if (a[0] > 2.5 * a[1] && a[1] > 0) return a[1];
    if (a[1] > 2.5 * a[2] && a[2] > 0) return a[2];
  }
  return a[0] || 1;
}

/** Symmetric linear scale that always includes 0, padded by padFrac. */
export function makeScale(values: number[], range: [number, number], padFrac = 0.1) {
  const fin = values.filter(Number.isFinite);
  const max = Math.max(0, ...fin);
  const min = Math.min(0, ...fin);
  const span = max - min || 1;
  const lo = min < 0 ? min - span * padFrac : 0;
  const hi = max > 0 ? max + span * padFrac : 0;
  const d = hi - lo || 1;
  const [r0, r1] = range;
  const f = (v: number) => r0 + ((v - lo) / d) * (r1 - r0);
  return Object.assign(f, { lo, hi });
}

/** Pixel pattern ids rendered by <IbcsDefs uid>. */
export const patternIds = (uid: string) => ({ dark: `${uid}-h-dark`, pos: `${uid}-h-pos`, neg: `${uid}-h-neg` });
