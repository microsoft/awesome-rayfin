import { describe, expect, it } from "vitest";
import {
  advanceReplay, REPLAY_SPEED_UP, REPLAY_TICK_MS, startReplayState,
} from "./replayClock.js";

/** A day of positions at a steady one every two simulated seconds. */
function day(stepS = 2, spanS = 86_400) {
  const times = [];
  for (let s = 0; s < spanS; s += stepS) times.push(s);
  return times;
}

/**
 * Drive the clock the way the relay does and report what actually went on air.
 *
 * The point of running many ticks rather than asserting on one is that the bug this file exists
 * for was invisible in a single tick — the first pass through the day was completely correct, and
 * only the wrap turned it into a firehose.
 */
function run(times, { ticks, tickMs = REPLAY_TICK_MS, startAtS = 0, speedUp = REPLAY_SPEED_UP }) {
  let now = 1_000_000;
  let state = startReplayState(times, startAtS, now);
  let emitted = 0;
  let wraps = 0;
  let worstTick = 0;
  for (let i = 0; i < ticks; i += 1) {
    now += tickMs;
    const step = advanceReplay(times, state, now, speedUp);
    const count = step.to - step.from;
    emitted += count;
    worstTick = Math.max(worstTick, count);
    if (step.wrapped) wraps += 1;
    state = step.state;
  }
  return { emitted, wraps, worstTick, seconds: (ticks * tickMs) / 1000 };
}

describe("replay clock", () => {
  it("plays the recording at the speed-up, not faster", () => {
    const times = day();
    // 60 s of wall time at 60x = one simulated hour = 1800 positions at one per 2 s.
    const { emitted, wraps } = run(times, { ticks: (60 * 1000) / REPLAY_TICK_MS });
    expect(wraps).toBe(0);
    expect(emitted).toBeGreaterThan(1700);
    expect(emitted).toBeLessThan(1900);
  });

  it("🔴 keeps that rate AFTER wrapping — the runaway that shipped", () => {
    const times = day();
    // Start 10 simulated minutes before the end so the wrap happens early, then keep going for a
    // wall minute. Before the fix this emitted the entire day on every tick from the wrap onward.
    const ticks = (90 * 1000) / REPLAY_TICK_MS;
    const { emitted, wraps, worstTick } = run(times, { ticks, startAtS: 86_400 - 600 });

    expect(wraps).toBeGreaterThan(0);
    // 90 s at 60x = 5400 simulated seconds = ~2700 positions, wrap or no wrap.
    expect(emitted).toBeLessThan(3200);
    // The decisive one: no single tick may ever dump the whole recording.
    expect(worstTick).toBeLessThan(times.length / 10);
  });

  it("never lets a tick emit more than the speed-up allows", () => {
    const times = day();
    const perTick = (REPLAY_TICK_MS / 1000) * REPLAY_SPEED_UP; // simulated seconds per tick
    const { worstTick } = run(times, { ticks: 4000, startAtS: 86_400 - 60 });
    // One position every 2 simulated seconds, plus a little slack for the wrap boundary.
    expect(worstTick).toBeLessThanOrEqual(perTick / 2 + 2);
  });

  it("wraps back to the beginning of the day, not to where it started", () => {
    const times = day();
    const state = startReplayState(times, 19 * 3600, 0);
    expect(times[state.cursor]).toBe(19 * 3600);

    // One tick far enough in the future to run off the end.
    const step = advanceReplay(times, state, 10_000_000, REPLAY_SPEED_UP);
    expect(step.wrapped).toBe(true);
    expect(step.state.cursor).toBe(0);
    expect(step.state.startSim).toBe(times[0]);
    // 🔴 The wall clock must be re-anchored too, or the next tick is unbounded again.
    expect(step.state.startWall).toBe(10_000_000);
  });

  it("emits every position exactly once per pass, in order", () => {
    const times = day(2, 600);
    let now = 0;
    let state = startReplayState(times, 0, now);
    const seen = [];
    for (let i = 0; i < 200; i += 1) {
      now += REPLAY_TICK_MS;
      const step = advanceReplay(times, state, now, REPLAY_SPEED_UP);
      for (let k = step.from; k < step.to; k += 1) seen.push(k);
      state = step.state;
      if (step.wrapped) break;
    }
    expect(seen).toEqual(times.map((_, index) => index));
  });

  it("survives an empty recording instead of dividing by it", () => {
    const state = startReplayState([], 0, 5);
    const step = advanceReplay([], state, 10_000);
    expect(step.to - step.from).toBe(0);
    expect(step.wrapped).toBe(false);
  });
});
