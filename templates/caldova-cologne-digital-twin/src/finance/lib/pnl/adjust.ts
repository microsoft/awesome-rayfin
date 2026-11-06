// Applies forecast adjustments (app SQL database) on top of the model's values:
// each effective adjustment moves the account's FC by (new - base) in its month.
// Account values stay unsigned like fact-guv; monthly line values are signed
// with the account's SignConvention, exactly as parseMonate builds them.

import type { MonatsWert } from './data';
import type { KontoRow, KontoWert } from './engine';

export interface AdjustmentLike {
  account_id: string;
  month: string;
  base_value: number;
  new_value: number;
}

export interface AdjustResult {
  werte: Map<string, KontoWert>;
  monate: MonatsWert[];
  /** Number of effective adjustments that hit an account of this year. */
  applied: number;
  /** Sum of all deltas (unsigned, EUR). */
  delta: number;
}

export function applyAdjustments(
  year: number,
  konten: KontoRow[],
  werte: Map<string, KontoWert>,
  monate: MonatsWert[],
  adjustments: Iterable<AdjustmentLike>
): AdjustResult {
  const byId = new Map(konten.map((k) => [k.id, k]));
  const nextWerte = new Map(werte);
  const monthIndex = new Map(monate.map((m, i) => [`${m.monat}|${m.line}`, i]));
  const nextMonate = monate.map((m) => ({ ...m }));
  let applied = 0;
  let delta = 0;
  for (const a of adjustments) {
    if (!a.month.startsWith(`${year}-`)) continue;
    const k = byId.get(a.account_id);
    const w = nextWerte.get(a.account_id);
    if (!k || !w) continue;
    const d = a.new_value - a.base_value;
    if (!d) continue;
    nextWerte.set(a.account_id, { ...w, fc: w.fc + d });
    const key = `${a.month}|${k.l1}`;
    const i = monthIndex.get(key);
    if (i !== undefined) nextMonate[i] = { ...nextMonate[i], fc: nextMonate[i].fc + (k.sign || 1) * d };
    else {
      monthIndex.set(key, nextMonate.length);
      nextMonate.push({ monat: a.month, line: k.l1, ac: 0, fc: (k.sign || 1) * d, pl: 0, py: 0 });
    }
    applied++;
    delta += d;
  }
  nextMonate.sort((x, y) => x.monat.localeCompare(y.monat));
  return { werte: nextWerte, monate: nextMonate, applied, delta };
}
