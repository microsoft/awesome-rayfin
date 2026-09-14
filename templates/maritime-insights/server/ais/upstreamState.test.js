import { describe, expect, it } from "vitest";
import {
  nextSilenceBackoffMs, shouldStandIn, silenceSince, upstreamState,
} from "./upstreamState.js";

const SILENCE_MS = 120_000;

describe("upstreamState", () => {
  it("reports a connected socket that is receiving nothing as SILENT, not connected", () => {
    // 🔴 The whole point. Measured on the deployed relay: socket open, subscription accepted,
    // `messages: 0` after ten minutes. Calling that "connected" is what let the app print
    // "0 Schiffe" about a bay it had received no data on.
    expect(upstreamState({
      mode: "live", connected: true, silentForMs: 10 * 60_000, silenceMs: SILENCE_MS,
    })).toBe("silent");
  });

  it("still reports a working feed as connected", () => {
    expect(upstreamState({
      mode: "live", connected: true, silentForMs: 3_000, silenceMs: SILENCE_MS,
    })).toBe("connected");
  });

  it("keeps a dead socket distinct from a mute one — the causes differ", () => {
    expect(upstreamState({
      mode: "live", connected: false, silentForMs: 10 * 60_000, silenceMs: SILENCE_MS,
    })).toBe("down");
  });

  it("does not call a brand-new socket silent", () => {
    // A socket that opened two seconds ago has legitimately not said anything yet.
    expect(upstreamState({
      mode: "live", connected: true, silentForMs: 2_000, silenceMs: SILENCE_MS,
    })).toBe("connected");
  });

  it("never reports replay as anything else, whatever the socket is doing", () => {
    expect(upstreamState({
      mode: "replay", connected: false, silentForMs: null, silenceMs: SILENCE_MS,
    })).toBe("replay");
  });

  it("treats an unmeasurable silence as not-yet-silent rather than as a fault", () => {
    expect(upstreamState({
      mode: "live", connected: true, silentForMs: null, silenceMs: SILENCE_MS,
    })).toBe("connected");
  });
});

describe("nextSilenceBackoffMs", () => {
  it("doubles, and stops at the cap", () => {
    expect(nextSilenceBackoffMs(120_000, 900_000)).toBe(240_000);
    expect(nextSilenceBackoffMs(480_000, 900_000)).toBe(900_000);
    expect(nextSilenceBackoffMs(900_000, 900_000)).toBe(900_000);
  });

  it("turns an all-day outage into a handful of reconnects, not hundreds", () => {
    // 🔴 The old behaviour reset the backoff on `open`, and the socket always opened — a mute
    // upstream therefore got a reconnect every ~150 s forever: ~576 in 24 h against a service that
    // rate-limits per key. Count what the backoff schedule actually costs over the same day.
    let waited = 0;
    let window = 120_000;
    let reconnects = 0;
    while (waited < 24 * 3_600_000) {
      waited += window;
      reconnects += 1;
      window = nextSilenceBackoffMs(window, 900_000);
    }
    expect(reconnects).toBeLessThan(100);
    expect(24 * 3_600_000 / 120_000).toBeGreaterThan(500); // what it used to be
  });
});

describe("silenceSince", () => {
  it("measures from the last frame when one has arrived", () => {
    expect(silenceSince({ lastMessageMs: 1_000, openedAtMs: 500, nowMs: 6_000 })).toBe(5_000);
  });

  it("measures from the socket opening when none has", () => {
    // ⚠️ Not from process start: after a reconnect the clock has to restart, or every fresh socket
    // inherits the previous one's silence and is condemned before it has had a chance.
    expect(silenceSince({ lastMessageMs: 0, openedAtMs: 4_000, nowMs: 9_000 })).toBe(5_000);
  });

  it("returns null when there is nothing to measure from, which is not zero", () => {
    expect(silenceSince({ lastMessageMs: 0, openedAtMs: 0, nowMs: 9_000 })).toBeNull();
  });
});

describe("shouldStandIn", () => {
  const AFTER = 180_000;
  const base = { mode: "live", silentForMs: 0, alreadyStandingIn: false, afterMs: AFTER };

  it("puts the recording on air once the live source has been mute long enough", () => {
    // The live provider is a free beta with no SLA and no second supplier, and it has already been
    // mute for a whole day — subscription accepted, zero frames, not even an error frame. "Their
    // service is down" must not render as an empty sea in front of a customer.
    expect(shouldStandIn({ ...base, silentForMs: AFTER + 1 })).toBe(true);
  });

  it("waits, rather than reacting to an ordinary gap", () => {
    expect(shouldStandIn({ ...base, silentForMs: AFTER })).toBe(false);
    expect(shouldStandIn({ ...base, silentForMs: 5_000 })).toBe(false);
  });

  it("is idempotent — a watchdog must not restart the day on every tick", () => {
    // The watchdog runs every 30 s. Without this guard the recording would rewind under the
    // viewer twice a minute, which looks exactly like the broken feed it is meant to paper over.
    expect(shouldStandIn({ ...base, silentForMs: 10 * AFTER, alreadyStandingIn: true }))
      .toBe(false);
  });

  it("never fires in replay mode, where the recording IS the source", () => {
    // 🔴 The dangerous inversion. Treating the recording as a substitute there would have the
    // relay present itself as a live feed that had merely gone quiet — a claim it never had.
    expect(shouldStandIn({ ...base, mode: "replay", silentForMs: 10 * AFTER })).toBe(false);
  });

  it("does nothing when the silence cannot be measured", () => {
    expect(shouldStandIn({ ...base, silentForMs: null })).toBe(false);
  });
});
