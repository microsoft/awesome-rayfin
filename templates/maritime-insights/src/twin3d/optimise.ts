/**
 * Where should the masts go?
 *
 * 🔴 PLAN §13 tier 1 #4 — and the reason it is worth building is that it is a question the customer
 * currently cannot ask anyone. Placement today is expert intuition defended after the fact; this
 * turns it into a search whose every step is inspectable.
 *
 * It is deliberately **not** a black box. The method is greedy maximum coverage: solve the viewshed
 * for every candidate position once, then repeatedly take the position that adds the most traffic
 * nothing has covered yet. Two properties make that honest to put in front of a customer:
 *
 *   * every step is explainable in one sentence — *this mast adds these 23 passages* — rather than
 *     being the output of an opaque optimiser;
 *   * greedy maximum coverage is provably within **1 − 1/e ≈ 63 %** of the best achievable set, so
 *     "near-optimal" is a statement with a proof behind it rather than a hope. It is still not
 *     optimal, and the UI says so.
 *
 * The expensive half — one viewshed per candidate — belongs to the caller. This module does the
 * counting, so it can be tested against hand-worked sets instead of against a rendered frame.
 */

export interface CoverageCandidate {
  /** Opaque handle the caller maps back to a position. */
  id: number;
  /** One byte per passage: 1 where this candidate observes it. Length must be `passageCount`. */
  observes: Uint8Array;
}

export interface OptimisationPick {
  id: number;
  /** Passages this pick adds that no earlier pick already covered. The marginal value. */
  newlyCovered: number;
  /** Passages covered by this pick and every earlier one. */
  cumulative: number;
}

/**
 * Choose up to `pick` candidates by greedy maximum coverage.
 *
 * Stops early when the best remaining candidate would add **nothing**: returning a third mast that
 * covers no traffic the first two miss would be a recommendation the model does not support, and
 * saying "only two of these are worth placing" is the more useful answer. The caller can still add
 * more by hand if redundancy rather than reach is the goal.
 *
 * Ties are broken by the earlier candidate, which makes the result reproducible — the same inputs
 * must always produce the same recommendation, or it cannot be put in a document.
 */
export function greedyMaxCoverage(
  candidates: CoverageCandidate[],
  passageCount: number,
  pick: number,
): OptimisationPick[] {
  const covered = new Uint8Array(passageCount);
  const taken = new Set<number>();
  const picks: OptimisationPick[] = [];
  let cumulative = 0;

  for (let round = 0; round < pick; round += 1) {
    let bestCandidate: CoverageCandidate | null = null;
    let bestGain = 0;

    for (const candidate of candidates) {
      if (taken.has(candidate.id)) continue;
      let gain = 0;
      for (let p = 0; p < passageCount; p += 1) {
        if (!covered[p] && candidate.observes[p]) gain += 1;
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate || bestGain === 0) break;
    for (let p = 0; p < passageCount; p += 1) {
      if (bestCandidate.observes[p]) covered[p] = 1;
    }
    cumulative += bestGain;
    taken.add(bestCandidate.id);
    picks.push({ id: bestCandidate.id, newlyCovered: bestGain, cumulative });
  }

  return picks;
}

/** How many passages a set of candidates covers between them. Used to score a hand-placed network. */
export function coverageOf(
  candidates: CoverageCandidate[],
  passageCount: number,
): number {
  const covered = new Uint8Array(passageCount);
  for (const candidate of candidates) {
    for (let p = 0; p < passageCount; p += 1) {
      if (candidate.observes[p]) covered[p] = 1;
    }
  }
  let total = 0;
  for (let p = 0; p < passageCount; p += 1) total += covered[p];
  return total;
}
