/**
 * Comparing configurations.
 *
 * 🔴 PLAN §13 tier 2 #5. **Procurement is comparative.** Nobody asks "is this good"; they ask "is
 * this better than that, by how much, and for what". The app could show one configuration at a
 * time, so comparing two meant writing numbers on paper and trusting the transcription — which is
 * exactly where a demo stops being evidence.
 *
 * 🔴 **There are no prices in here, and there will not be.** The roadmap phrased the goal as
 * "+9 % traffic for +€X", and the euros are the part this app has no basis for: mast cost depends
 * on the customer's civil works, their frame agreements and their site access, none of which is in
 * any dataset here. Inventing a figure would be the one kind of dishonesty a bid annex cannot
 * survive. What the app *can* state is the physical quantity that drives the cost — how many sites,
 * how many metres of mast in total, how tall the tallest one is — and let the reader apply their
 * own prices to it. That is a more useful column than a fabricated euro anyway, because it is the
 * one they can check.
 *
 * ⚠️ Differences between shares are in **percentage points**, never percent. "72 % to 90 %" is
 * +18 pp and +25 %, and quoting the second as the first is the most common way a comparison
 * table misleads. The type name says `Pp` so a caller cannot forget.
 */

export interface Variant {
  /** Short handle shown to the reader: "A", "B", "C". */
  id: string;
  /** Positions and heights, enough to restore the configuration exactly. */
  sites: { col: number; row: number; mastM: number }[];
  targetM: number;
  /** Denominator: transits that entered the modelled area. */
  transits: number;
  observedTransits: number;
  redundantTransits: number;
  worstCaseLossTransits: number;
  visibleKm2: number;
}

export interface VariantCost {
  siteCount: number;
  /** Total metres of mast across the network — the quantity a price list is applied to. */
  totalMastM: number;
  tallestMastM: number;
}

export interface VariantDelta {
  /** Difference in observed share, in **percentage points**. */
  observedPp: number;
  redundantPp: number;
  /** Positive means the *worse* case got worse. */
  worstCaseLossPp: number;
  visibleKm2: number;
  siteCount: number;
  totalMastM: number;
}

export function variantCost(variant: Variant): VariantCost {
  let totalMastM = 0;
  let tallestMastM = 0;
  for (const site of variant.sites) {
    totalMastM += site.mastM;
    if (site.mastM > tallestMastM) tallestMastM = site.mastM;
  }
  return { siteCount: variant.sites.length, totalMastM, tallestMastM };
}

const share = (part: number, whole: number) => (whole ? part / whole : 0);

export function observedShare(variant: Variant): number {
  return share(variant.observedTransits, variant.transits);
}

export function redundantShare(variant: Variant): number {
  return share(variant.redundantTransits, variant.transits);
}

export function worstCaseLossShare(variant: Variant): number {
  return share(variant.worstCaseLossTransits, variant.transits);
}

/**
 * What `other` buys over `base`.
 *
 * Shares are differenced as percentage points; counts and areas as plain differences. Both
 * variants must have been measured against the same denominator — they are, because the transit
 * rule is a property of the recorded day rather than of the configuration.
 */
export function compareVariants(base: Variant, other: Variant): VariantDelta {
  const baseCost = variantCost(base);
  const otherCost = variantCost(other);
  return {
    observedPp: (observedShare(other) - observedShare(base)) * 100,
    redundantPp: (redundantShare(other) - redundantShare(base)) * 100,
    worstCaseLossPp: (worstCaseLossShare(other) - worstCaseLossShare(base)) * 100,
    visibleKm2: other.visibleKm2 - base.visibleKm2,
    siteCount: otherCost.siteCount - baseCost.siteCount,
    totalMastM: otherCost.totalMastM - baseCost.totalMastM,
  };
}

/**
 * Traffic bought per metre of mast, in percentage points.
 *
 * The closest thing to a value-for-money number that this app can honestly produce: it uses only
 * quantities it measured. A variant with a higher figure delivers more observed traffic for the
 * same amount of structure, whatever a metre of structure happens to cost.
 */
export function ppPerMastMetre(variant: Variant): number {
  const { totalMastM } = variantCost(variant);
  if (!totalMastM) return 0;
  return (observedShare(variant) * 100) / totalMastM;
}
