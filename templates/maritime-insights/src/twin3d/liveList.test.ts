import { describe, expect, it } from "vitest";
import {
  checkUrl, formatAge, isUnderWay, LIVE_STALE_MS, summariseLiveVessels, verificationUrl,
  vesselUrl, withinBounds,
} from "./liveList";
import type { LiveVessel } from "./liveSource";

function vessel(id: string, points: [number, number, number, number][],
                klass = "Cargo", lengthM: number | null = 100): LiveVessel {
  return { id, class: klass, lengthM, points };
}

// A fixed clock. The fixtures use small timestamps, so every call passes NOW explicitly; relying
// on the real clock would let the staleness window silently drop the whole fixture.
const NOW = 10_000;

// The Kieler Förde tile, near enough. Only the containment decision matters here.
const BOUNDS = { west: 10.0, south: 54.25, east: 10.35, north: 54.55 };

describe("summariseLiveVessels", () => {
  it("reports each vessel at its most recent position", () => {
    const list = summariseLiveVessels(new Map([
      ["a", vessel("a", [
        [54.30, 10.10, 1_000, 4],
        [54.40, 10.20, 3_000, 9],
        [54.35, 10.15, 2_000, 6],
      ])],
    ]), NOW).entries;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ lat: 54.40, lon: 10.20, atMs: 3_000, knots: 9, reports: 3 });
  });

  it("does not assume the feed appends in order", () => {
    // ⚠️ A relay that ever delivered out of order would otherwise place the vessel at an old
    // position, with nothing on screen to say so.
    const list = summariseLiveVessels(new Map([
      ["a", vessel("a", [[54.9, 10.9, 9_000, 12], [54.1, 10.1, 1_000, 2]])],
    ]), NOW).entries;
    expect(list[0].atMs).toBe(9_000);
    expect(list[0].lat).toBe(54.9);
  });

  it("puts vessels under way first", () => {
    const list = summariseLiveVessels(new Map([
      ["moored", vessel("moored", [[54.3, 10.1, 5_000, 0.1]])],
      ["fast", vessel("fast", [[54.4, 10.2, 5_000, 14]])],
      ["slow", vessel("slow", [[54.5, 10.3, 5_000, 3]])],
    ]), NOW).entries;
    expect(list.map((entry) => entry.id)).toEqual(["fast", "slow", "moored"]);
  });

  it("orders identically for identical input, so rows do not swap under the pointer", () => {
    const build = () => new Map([
      ["b", vessel("b", [[54.4, 10.2, 5_000, 6]])],
      ["a", vessel("a", [[54.3, 10.1, 5_000, 6]])],
      ["c", vessel("c", [[54.5, 10.3, 5_000, 6]])],
    ]);
    // Same speed and same timestamp: without a final tiebreak the order would be whatever the
    // sort happened to do this frame.
    const once = summariseLiveVessels(build(), NOW).entries.map((entry) => entry.id);
    const twice = summariseLiveVessels(build(), NOW).entries.map((entry) => entry.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a", "b", "c"]);
  });

  it("skips a vessel that has no position yet rather than inventing one", () => {
    const list = summariseLiveVessels(new Map([
      ["empty", vessel("empty", [])],
      ["real", vessel("real", [[54.4, 10.2, 5_000, 6]])],
    ]), NOW).entries;
    expect(list.map((entry) => entry.id)).toEqual(["real"]);
  });

  it("carries no field that could identify the ship", () => {
    const list = summariseLiveVessels(
      new Map([["a", vessel("a", [[54.4, 10.2, 5, 6]])]]), NOW).entries;
    // 🔴 The list is rendered and could be copied out of the app. If an identifying field ever
    // reaches it, the privacy guarantee is broken at the last possible moment.
    const keys = Object.keys(list[0]);
    for (const forbidden of ["mmsi", "name", "callSign", "imo", "destination", "shipName"]) {
      expect(keys.map((k) => k.toLowerCase())).not.toContain(forbidden.toLowerCase());
    }
  });

  // 🔴 The client's vessel map only ever grows — `connectLive` adds on first sight and nothing
  // removes. Measured against the running relay: 20 s after connecting the map held 33 vessels
  // while the relay reported 6 present. Without these tests the list quietly fills with ships
  // that have long since left, every one of them presented as live.
  it("drops a vessel that has stopped reporting", () => {
    const now = 10_000_000;
    const list = summariseLiveVessels(new Map([
      ["gone", vessel("gone", [[54.3, 10.1, now - LIVE_STALE_MS - 1, 12]])],
      ["here", vessel("here", [[54.4, 10.2, now - 30_000, 3]])],
    ]), now).entries;
    expect(list.map((entry) => entry.id)).toEqual(["here"]);
  });

  it("keeps a moored vessel that is merely quiet", () => {
    // AIS at anchor can go three minutes between reports. Dropping those would empty every
    // harbour on screen — the one mistake a shorter window would make.
    const now = 10_000_000;
    const list = summariseLiveVessels(new Map([
      ["moored", vessel("moored", [[54.3, 10.1, now - 3 * 60_000, 0.0]])],
    ]), now).entries;
    expect(list).toHaveLength(1);
  });

  it("reports how old each position is", () => {
    const now = 10_000_000;
    const list = summariseLiveVessels(new Map([
      ["a", vessel("a", [[54.3, 10.1, now - 45_000, 8]])],
    ]), now).entries;
    expect(list[0].ageMs).toBe(45_000);
  });

  it("does not hide a vessel whose clock runs ahead", () => {
    // A report stamped in the future is a clock problem, not a reason to make a ship vanish.
    const now = 10_000_000;
    const list = summariseLiveVessels(new Map([
      ["ahead", vessel("ahead", [[54.3, 10.1, now + 20_000, 8]])],
    ]), now).entries;
    expect(list).toHaveLength(1);
    expect(list[0].ageMs).toBe(0);
  });

  // 🔴 The relay subscribes to the *shell* bbox — measured live, ~300 vessels across the western
  // Baltic against a handful in the modelled water. Every one of those rows answers a click with
  // "outside the model", so an unscoped list is both useless and misleading about what the app
  // can actually show.
  it("lists only vessels inside the modelled area, and counts the rest", () => {
    const now = 10_000_000;
    const summary = summariseLiveVessels(new Map([
      ["inside", vessel("inside", [[54.40, 10.20, now - 10_000, 6]])],
      ["north", vessel("north", [[54.90, 10.20, now - 10_000, 9]])],
      ["west", vessel("west", [[54.40, 9.10, now - 10_000, 9]])],
    ]), now, BOUNDS);
    expect(summary.entries.map((entry) => entry.id)).toEqual(["inside"]);
    expect(summary.outsideCount).toBe(2);
  });

  it("does not count a stale vessel as outside", () => {
    // It is gone, not elsewhere. Counting it would inflate the "weitere" figure with ships that
    // stopped reporting long ago.
    const now = 10_000_000;
    const summary = summariseLiveVessels(new Map([
      ["old", vessel("old", [[54.90, 10.20, now - LIVE_STALE_MS - 1, 9]])],
    ]), now, BOUNDS);
    expect(summary.entries).toHaveLength(0);
    expect(summary.outsideCount).toBe(0);
  });

  it("lists everything when no bounds are known", () => {
    const now = 10_000_000;
    const summary = summariseLiveVessels(new Map([
      ["far", vessel("far", [[54.90, 10.20, now - 10_000, 9]])],
    ]), now, null);
    expect(summary.entries).toHaveLength(1);
    expect(summary.outsideCount).toBe(0);
  });
});

describe("identity in the list", () => {
  const now = 10_000_000;

  function named(id: string, extra: Partial<LiveVessel>): LiveVessel {
    return {
      id, class: "Cargo", lengthM: 190,
      points: [[54.4, 10.2, now - 5_000, 8]],
      ...extra,
    } as LiveVessel;
  }

  it("carries the identity the relay sent", () => {
    const [entry] = summariseLiveVessels(new Map([
      ["a", named("211476060", {
        mmsi: "211476060", name: "NILS HOLGERSSON", callSign: "DGNH", destination: "TRAVEMUNDE",
      })],
    ]), now).entries;
    expect(entry).toMatchObject({
      mmsi: "211476060", name: "NILS HOLGERSSON", callSign: "DGNH", destination: "TRAVEMUNDE",
    });
  });

  it("leaves identity undefined rather than blank when the relay is anonymised", () => {
    // 🔴 The row renders `entry.name ?? class`, so an empty string would print nothing at all and
    // look like a rendering fault instead of falling back to the class.
    const [entry] = summariseLiveVessels(new Map([["a", named("abc123", {})]]), now).entries;
    expect(entry.name).toBeUndefined();
    expect(entry.mmsi).toBeUndefined();
  });
});

describe("checkUrl", () => {
  const base = { id: "x", class: "Cargo", lengthM: null, lat: 54.4, lon: 10.2,
                 knots: 6, atMs: 1, ageMs: 0, reports: 1 };

  it("opens the ship itself once an MMSI is known", () => {
    // 🔴 This is the link the app could not previously offer, and the reason was never technical:
    // every public AIS service addresses a vessel by MMSI, and the MMSI used to be discarded.
    const url = new URL(checkUrl({ ...base, mmsi: "211476060" }));
    // ⚠️ Host changed 2026-08-10 after measuring it, not by preference: MarineTraffic's search
    // endpoint now answers **404** for `?keyword=` and `?mmsi=` alike, so this link had been dead
    // in the deployed app. VesselFinder returns the vessel page for an MMSI. MarineTraffic's
    // *area* view still works, which is why `verificationUrl` still uses it.
    expect(url.hostname).toBe("www.vesselfinder.com");
    expect(url.pathname).toBe("/vessels/details/211476060");
  });

  it("falls back to the position when the vessel is not identified", () => {
    const url = checkUrl(base);
    expect(url).toContain("centery:54.40000");
    expect(url).not.toContain("keyword");
  });

  it("escapes what it puts in the query", () => {
    // AIS text is untrusted input; it reaches this function from the wire.
    expect(vesselUrl("2114 60&x=1")).toContain("2114%2060%26x%3D1");
  });
});

describe("withinBounds", () => {
  it("includes the edges, so a vessel on the boundary is not lost", () => {
    expect(withinBounds(54.25, 10.0, BOUNDS)).toBe(true);
    expect(withinBounds(54.55, 10.35, BOUNDS)).toBe(true);
    expect(withinBounds(54.24, 10.2, BOUNDS)).toBe(false);
    expect(withinBounds(54.4, 10.36, BOUNDS)).toBe(false);
  });
});

describe("isUnderWay", () => {
  it("uses the same 0.5 kn threshold as the rest of the app", () => {
    expect(isUnderWay({ knots: 0.49 } as never)).toBe(false);
    expect(isUnderWay({ knots: 0.5 } as never)).toBe(true);
  });
});

describe("formatAge", () => {
  it("says how stale a position is in units a reader can act on", () => {
    expect(formatAge(2_000)).toBe("gerade eben");
    expect(formatAge(45_000)).toBe("vor 45 s");
    expect(formatAge(4 * 60_000)).toBe("vor 4 min");
  });
});

describe("verificationUrl", () => {
  it("addresses a place, never a vessel", () => {
    const url = verificationUrl(54.4022505, 10.2256598);
    expect(url).toContain("centery:54.40225");
    expect(url).toContain("centerx:10.22566");
    expect(url).toContain("zoom:13");
    // 🔴 The whole point: no identifier of any kind travels to the external service.
    expect(url).not.toMatch(/mmsi|imo|name|callsign/i);
  });

  it("is a plain https URL to one known host", () => {
    const url = new URL(verificationUrl(54.4, 10.2));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("www.marinetraffic.com");
  });
});
