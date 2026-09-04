/**
 * What a *network* of sites observes, as distinct from what one site observes.
 *
 * 🔴 Nobody buys one mast. A tender is a chain of sites, and the argument a buyer actually has is
 * not "how much can it see" but three harder questions:
 *
 *   * **together** — what does the chain hold that no single site does;
 *   * **redundantly** — what survives one site being down, jammed or out for maintenance;
 *   * **uniquely** — what would be lost if *this* site were struck from the bill of materials.
 *
 * The third is the one that decides a purchase, and it is the reason this file exists. A combined
 * coverage figure alone flatters a network: adding a fourth site to a well-placed three will barely
 * move it, and the number gives no hint whether that is because the site is redundant or because
 * it is holding ground alone.
 *
 * Everything here is pure counting over one input: for each passage, a **bitmask of which sites
 * observed it**. Deciding *that* needs the tracks and the viewshed fields and lives in the scene;
 * deciding what it means does not, so it lives here where it can be tested against hand-worked
 * examples rather than against a screenshot.
 */

/** What one site contributes to the network it is part of. */
export interface SiteContribution {
  /** Index of the site in the network, matching the bit position in the masks. */
  index: number;
  /** Passages this site sees at all, alone or alongside others. */
  observedPassages: number;
  /**
   * Passages **only** this site sees.
   *
   * The procurement number: strike this site and these passages stop being observed by anything.
   * A site with a high observed count and zero unique count is pure redundancy — which may be
   * exactly what was wanted, but it should be a decision rather than a surprise.
   */
  uniquePassages: number;
  /** `uniquePassages` as a share of all passages that entered the area. */
  uniqueShare: number;
}

export interface NetworkCoverage {
  siteCount: number;
  /** Passages that entered the modelled area at all. The denominator for every share here. */
  passages: number;
  /** Passages observed by at least one site. */
  observedPassages: number;
  missedPassages: number;
  /** Share observed by the network as a whole. */
  passageShare: number;
  /**
   * Passages held by two or more sites — what the network still observes after losing any one
   * site. This is the resilience argument, and it is always ≤ `observedPassages`.
   */
  redundantPassages: number;
  redundantShare: number;
  /**
   * Passages held by exactly one site: the single points of failure. Lose the wrong site and
   * these go dark. `redundantPassages + singleCoverPassages === observedPassages`.
   */
  singleCoverPassages: number;
  /**
   * The worst single-site loss: how many passages the network would stop observing if the most
   * load-bearing site were removed. Equal to the largest `uniquePassages` across sites.
   */
  worstCaseLossPassages: number;
  worstCaseLossShare: number;
  perSite: SiteContribution[];
}

/** Number of set bits. Networks here are ≤ 8 sites, so the naive loop is the honest one. */
function popcount(mask: number): number {
  let n = 0;
  for (let bit = mask; bit; bit >>= 1) n += bit & 1;
  return n;
}

/**
 * Summarise a network from one bitmask per passage.
 *
 * `masks[p]` has bit *i* set when site *i* observed passage *p*. Only passages that entered the
 * modelled area should be in the array at all — a passage that never came near is not a failure of
 * the network, exactly as in the single-site figure, and including it would quietly deflate every
 * share here.
 */
export function summariseNetwork(masks: number[], siteCount: number): NetworkCoverage {
  const passages = masks.length;
  let observedPassages = 0;
  let redundantPassages = 0;
  let singleCoverPassages = 0;
  const observedBySite = new Array<number>(siteCount).fill(0);
  const uniqueBySite = new Array<number>(siteCount).fill(0);

  for (const mask of masks) {
    if (!mask) continue;
    observedPassages += 1;
    const holders = popcount(mask);
    if (holders >= 2) redundantPassages += 1;
    else singleCoverPassages += 1;

    for (let i = 0; i < siteCount; i += 1) {
      if (!(mask & (1 << i))) continue;
      observedBySite[i] += 1;
      // Sole holder: this passage is this site's alone.
      if (holders === 1) uniqueBySite[i] += 1;
    }
  }

  const perSite: SiteContribution[] = [];
  for (let i = 0; i < siteCount; i += 1) {
    perSite.push({
      index: i,
      observedPassages: observedBySite[i],
      uniquePassages: uniqueBySite[i],
      uniqueShare: passages ? uniqueBySite[i] / passages : 0,
    });
  }

  const worstCaseLossPassages = perSite.reduce((worst, s) =>
    Math.max(worst, s.uniquePassages), 0);

  return {
    siteCount,
    passages,
    observedPassages,
    missedPassages: passages - observedPassages,
    passageShare: passages ? observedPassages / passages : 0,
    redundantPassages,
    redundantShare: passages ? redundantPassages / passages : 0,
    singleCoverPassages,
    worstCaseLossPassages,
    worstCaseLossShare: passages ? worstCaseLossPassages / passages : 0,
    perSite,
  };
}
