import type { AdjustmentRecord, SignOffRecord } from './records';
import type { Snapshot } from './types';

/**
 * The close lock as a READ-TIME rule.
 *
 * A month-end close is named by its last closed month (the snapshot's cut-off). Signing it off freezes the
 * forecast of that close. Writes cannot be refused server-side for "the close is signed off" (the data API's row
 * policies compare fields with the caller's claims, nothing more), two people can race (A opens the drawer, B
 * signs off, A saves), and every field of a row is written by the browser: `created_at` can be backdated and
 * `period` can name another close.
 *
 * So nothing in the adjustment row decides. Only adjustments of the CURRENT close count (a new close starts a new
 * forecast version), and the sign-off row names what it freezes: `frozenIds`, the adjustments that applied when the
 * controller signed. Only controllers can write sign-off rows (row policy). While the close is signed off exactly
 * those apply; any other row is shown, never applied, however it is dated. A reopen hands the close back.
 */

const byTime = <T extends { createdAt: Date }>(a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();

/** Sign-offs and reopens of one close, oldest first (their order is the controllers' own). */
const ofPeriod = (signOffs: SignOffRecord[], period: string) => signOffs.filter((x) => x.month === period).sort(byTime);

/** The latest sign-off or reopen of a close, if any. */
export function latestSignOff(signOffs: SignOffRecord[], period: string): SignOffRecord | undefined {
  return ofPeriod(signOffs, period).at(-1);
}

/** Is the close signed off now? The latest sign-off or reopen decides. */
export function isSignedOff(signOffs: SignOffRecord[], period: string): boolean {
  return latestSignOff(signOffs, period)?.action === 'sign-off';
}

export type AdjustmentStatus = 'applied' | 'actual-month' | 'signed-off' | 'other-close' | 'invalid';

/** The accounts an adjustment may target: P&L leaves except taxes (they follow from the result). */
export function adjustableIds(snapshot: Snapshot): ReadonlySet<string> {
  return new Set(
    snapshot.accounts.filter((a) => a.statement === 'PL' && a.rowType === 'Account' && a.id !== '8000' && a.id !== '8010').map((a) => a.id)
  );
}

/** Why an adjustment does or does not count against the snapshot with this cut-off. */
export function adjustmentStatus(
  a: AdjustmentRecord,
  signOffs: SignOffRecord[],
  cutoff: string,
  adjustable?: ReadonlySet<string>
): AdjustmentStatus {
  if (adjustable && !adjustable.has(a.accountId)) return 'invalid';
  if (!Number.isFinite(a.amount) || !/^\d{4}-\d{2}$/.test(a.month)) return 'invalid';
  if (a.month <= cutoff) return 'actual-month';
  if (a.period !== cutoff) return 'other-close';
  const latest = latestSignOff(signOffs, cutoff);
  if (latest?.action !== 'sign-off') return 'applied';
  return latest.frozenIds?.includes(a.id) ? 'applied' : 'signed-off';
}

/** The adjustments the engine applies. */
export function effectiveAdjustments(adjustments: AdjustmentRecord[], signOffs: SignOffRecord[], cutoff: string, adjustable?: ReadonlySet<string>) {
  return adjustments.filter((a) => adjustmentStatus(a, signOffs, cutoff, adjustable) === 'applied');
}

/** The data API's text limit for `frozen_ids`; a close with more adjustments cannot be signed off in one row. */
export const FROZEN_IDS_MAX = 4000;

/** The ids a new sign-off freezes: the adjustments that apply right now. */
export function frozenIdsFor(adjustments: AdjustmentRecord[], signOffs: SignOffRecord[], cutoff: string, adjustable?: ReadonlySet<string>): string[] {
  const ids = effectiveAdjustments(adjustments, signOffs, cutoff, adjustable).map((a) => a.id);
  if (ids.join(',').length > FROZEN_IDS_MAX) throw new Error(`Too many adjustments in this close to sign off at once (${ids.length}).`);
  return ids;
}
