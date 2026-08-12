/**
 * A number that knows where it came from.
 *
 * This project renders three kinds of figure side by side and the difference between them is the
 * whole credibility of the demo:
 *
 *   - **measured**  — it is in the survey or the booking system. Room polygons, floor levels,
 *                     lecture bookings, building geometry.
 *   - **derived**   — computed from measured data by a rule stated in the config. Room area from
 *                     the polygon, storey height from LoD2 height ÷ level count.
 *   - **synthetic** — invented, however plausibly. Seat counts, Zustandsnoten, Sanierungskosten,
 *                     cohort sizes.
 *
 * A viewer cannot tell these apart by looking, and a real university's name is on the screen. So
 * provenance travels *with* the number rather than living in a footnote, and `SourcedFigure`
 * renders an unsourced figure as a visible defect rather than as a clean number.
 */

export type Provenance = 'measured' | 'derived' | 'synthetic';

export interface FactSource {
  /** Who published it, or which rule produced it. */
  issuer: string;
  year: number;
  provenance: Provenance;
  title?: string;
  /** Free-text qualifier shown after the year, e.g. "Stand WS 2025/26". */
  status?: string;
  /** True where a figure reconstructs something rather than reporting it. */
  reconstruction?: boolean;
  url?: string;
}

export interface Fact<T> {
  value: T;
  unit?: string;
  /** Where a source publishes a range rather than a point value. */
  range?: [number, number];
  source?: FactSource;
}

export const OSM_SOURCE: FactSource = {
  issuer: 'OpenStreetMap contributors (ODbL 1.0)',
  year: 2026,
  provenance: 'measured',
  title: 'OpenStreetMap Simple Indoor Tagging',
};

export const NAVIGATUM_SOURCE: FactSource = {
  issuer: 'NavigaTUM / TUMonline',
  year: 2026,
  provenance: 'measured',
  title: 'NavigaTUM API — Raum- und Belegungsdaten',
  url: 'https://nav.tum.de/api',
};

export const LDBV_SOURCE: FactSource = {
  issuer: 'Bayerische Vermessungsverwaltung (LDBV)',
  year: 2026,
  provenance: 'measured',
  title: 'DGM1 / DOP20 / LoD2',
};

export const LGL_SOURCE: FactSource = {
  issuer: 'LGL Baden-Württemberg (dl-de/by-2-0)',
  year: 2026,
  provenance: 'measured',
  title: 'DGM1 / DOP20 / LoD2 / nDOM',
};

/** Marks a figure this project invented. Never omit it to make a panel look tidier. */
export function synthetic(rule: string, year = 2026): FactSource {
  return {
    issuer: 'Campus-Scheduler',
    year,
    provenance: 'synthetic',
    title: rule,
    status: 'synthetisch',
  };
}

/** Marks a figure computed from measured data by a stated rule. */
export function derived(rule: string, year = 2026): FactSource {
  return {
    issuer: 'Campus-Scheduler',
    year,
    provenance: 'derived',
    title: rule,
    status: 'abgeleitet',
  };
}

export function isSynthetic(fact: Fact<unknown>): boolean {
  return fact.source?.provenance === 'synthetic';
}
