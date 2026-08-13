/**
 * The replay clock: which recorded positions are due to go on air right now.
 *
 * This lives in its own module for the same reason `upstreamState.js` does — `relay.js` starts an
 * HTTP server the moment it is imported, so nothing in it can be unit-tested, and the decisions
 * that turn out to be wrong are always the arithmetic ones rather than the plumbing.
 *
 * 🔴 **The bug this module exists to make impossible.** The loop used to keep `startWall` and
 * `startSim` fixed for the lifetime of the timer and, on reaching the end of the day, reset only
 * the cursor:
 *
 * ```js
 * if (cursor >= points.length) { cursor = 0; }   // ← simNow keeps growing
 * ```
 *
 * `simNow` is derived from `startWall`, so after the first wrap it is permanently far beyond every
 * timestamp in the recording. Every subsequent tick therefore satisfied `times[cursor] <= simNow`
 * for *every* point and drained the whole day — 44 084 positions — four times a second, for as
 * long as the process lived.
 *
 * Measured on the deployed relay before the fix: **96 517 messages/second**, against an intended
 * ~31/s. It never threw, never logged an error, and the health endpoint went on reporting a
 * healthy relay. What it did instead was subtler and worse: because clients receive a batched
 * delta once a second, each vessel's broadcast position became wherever it happened to be at the
 * end of a whole day of replay — so ships **teleported** around the fjord instead of sailing.
 * A recording that stands in for a live feed has one job, to be indistinguishable from real
 * traffic, and this failed it while looking like it worked.
 */

/** Simulated seconds per wall-clock second. A recorded day plays in 24 minutes. */
export const REPLAY_SPEED_UP = 60;

/** How often the relay asks what is due. Anything under a second keeps vessels moving smoothly. */
export const REPLAY_TICK_MS = 250;

/**
 * Where to start playing.
 *
 * `startAtS` picks a point in the recorded day (the relay starts at the busiest hour so a demo has
 * traffic immediately). Returns the state `advanceReplay` threads through each tick.
 */
export function startReplayState(times, startAtS, nowMs) {
  if (!times.length) return { cursor: 0, startSim: 0, startWall: nowMs };
  let cursor = times.findIndex((t) => t >= startAtS);
  if (cursor < 0) cursor = 0;
  return { cursor, startSim: times[cursor], startWall: nowMs };
}

/**
 * Which positions are due, and the state for the next tick.
 *
 * Returns the half-open range `[from, to)` into `times` rather than an array of indices — the
 * caller already holds the points, and allocating a 44 000-element array every 250 ms to say
 * "these ones" would be its own small disaster.
 *
 * 🔴 On wrap the wall clock is re-anchored (`startWall = nowMs`) as well as the cursor. That single
 * line is the whole fix: without it the elapsed term never restarts and the recording plays at
 * whatever rate the CPU can manage.
 */
export function advanceReplay(times, state, nowMs, speedUp = REPLAY_SPEED_UP) {
  if (!times.length) return { from: 0, to: 0, wrapped: false, state };

  const simNow = state.startSim + ((nowMs - state.startWall) / 1000) * speedUp;
  const from = state.cursor;
  let cursor = state.cursor;
  while (cursor < times.length && times[cursor] <= simNow) cursor += 1;
  const to = cursor;

  if (cursor >= times.length) {
    return {
      from,
      to,
      wrapped: true,
      state: { cursor: 0, startSim: times[0], startWall: nowMs },
    };
  }
  return { from, to, wrapped: false, state: { ...state, cursor } };
}
