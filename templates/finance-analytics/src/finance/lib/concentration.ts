/**
 * Tiny, dependency-free concentration primitive shared by the resting-rail insight
 * generators. It is deliberately NOT imported from `insights-kernel.ts` so the eager
 * app graph stays free of the (lazy) drill kernel. Everything here is honest: it only
 * reports what the numbers say, and it always carries the equal-share baseline so a
 * raw Herfindahl (HHI) value is never read out of context.
 *
 * HHI over shares s_i is Σ s_i². Its floor is 1/n (perfectly even split), NOT 0, so a
 * near-even mix of 5 groups sits at ~0.20 — labelling that "concentrated" would be a
 * lie. We therefore always surface `evenHhi = 1/n` and `effectiveN = 1/HHI` (the
 * count of equally-sized groups that would produce the same HHI), and only use the
 * normalized value `(HHI − 1/n)/(1 − 1/n)` when an adjective is unavoidable.
 */

export interface RankedShare {
  label: string;
  value: number;
  /** Share of the (positive) total, 0..1. */
  share: number;
}

export interface Concentration {
  /** Groups sorted by value, descending, each with its share of the total. */
  ranked: RankedShare[];
  total: number;
  /** Number of groups with a finite, positive value. */
  n: number;
  /** Raw Herfindahl index Σ shareᵢ² over positive shares (1/n … 1). */
  hhi: number;
  /** Equal-share baseline 1/n — the HHI a perfectly even split would produce. */
  evenHhi: number;
  /** Effective number of equally-sized groups (1/HHI). */
  effectiveN: number;
  /** HHI rescaled to 0 (perfectly even) … 1 (single group). */
  normalizedHhi: number;
  /** Largest single group's share of the total, 0..1. */
  topShare: number;
  /** How many of the ranked groups it takes to first reach ≥80% of the total. */
  vitalFew: number;
}

/** Aggregate `(label, value)` pairs into a concentration summary. Non-finite or
 *  non-positive values are dropped (they carry no share of a positive total). */
export function concentration(items: { label: string; value: number }[]): Concentration | null {
  const rows = items.filter((r) => Number.isFinite(r.value) && r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const n = rows.length;
  if (n === 0 || !Number.isFinite(total) || total <= 0) return null;

  const ranked: RankedShare[] = rows
    .map((r) => ({ label: r.label, value: r.value, share: r.value / total }))
    .sort((a, b) => b.value - a.value);

  const hhi = ranked.reduce((s, r) => s + r.share * r.share, 0);
  const evenHhi = 1 / n;
  const effectiveN = 1 / hhi;
  const normalizedHhi = n > 1 ? Math.max(0, (hhi - evenHhi) / (1 - evenHhi)) : 1;
  const topShare = ranked[0].share;

  let cum = 0;
  let vitalFew = 0;
  for (const r of ranked) {
    cum += r.share;
    vitalFew++;
    if (cum >= 0.8) break;
  }

  return { ranked, total, n, hhi, evenHhi, effectiveN, normalizedHhi, topShare, vitalFew };
}
