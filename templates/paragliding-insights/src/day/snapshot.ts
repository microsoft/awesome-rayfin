/**
 * The Mode D snapshot — PLAN §3, phase 5.
 *
 * Lives in its own module rather than beside the panel because **two** consumers read it: the panel
 * draws it, and the Mode E assistant quotes it. An assistant answering from a second, slightly
 * different source would eventually contradict the screen it is sitting on, which is a worse
 * failure than not answering at all.
 */

export interface DayHour {
  validTs: string;
  stepH: number;
  cloudBaseM: number | null;
  cloudCoverage: number;
  cloudTopM: number | null;
  capeJkg: number;
  cloudPct: number;
  gustMs: number;
  tempC: number;
  freezingM: number;
}

export interface DaySnapshot {
  aoi: string;
  source: string;
  modelRun: string;
  exportedAt: string;
  /**
   * The flights flown here. A site can legitimately have none — the Tegelberg does — so `count` is
   * 0 and the rest are null rather than absent. Nullable on purpose: `bestClimbMs.toFixed(1)` on a
   * site with no flights is a crash, and a zero would be a claim that somebody flew and climbed at
   * exactly 0.0 m/s.
   */
  flights: {
    count: number;
    ceilingM: number | null;
    bestClimbMs: number | null;
    distanceKm: number | null;
    measuredWindMs: number | null;
  };
  hours: DayHour[];
  windAloft: { levelHpa: number; stepH: number; u: number; v: number }[];
}

/**
 * Fetch it, or null if the Fabric tooling has not run.
 *
 * A missing snapshot is a first-run state, like missing terrain, not a failure — so this resolves
 * null rather than throwing.
 */
export async function loadDaySnapshot(aoiId: string): Promise<DaySnapshot | null> {
  try {
    const response = await fetch(`/day/${aoiId}.json`);
    if (!response.ok) return null;
    return (await response.json()) as DaySnapshot;
  } catch {
    return null;
  }
}
