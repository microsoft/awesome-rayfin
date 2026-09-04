import { describe, expect, it } from "vitest";
import { checkUrl, describeLiveFeed, formatSilence, hasSyntheticIdentity } from "./liveList";
import type { LiveStatus } from "./liveSource";

/**
 * 🔴 The defect these tests exist for.
 *
 * With the relay running and the upstream sending **nothing**, the live bar read "0 Schiffe".
 * That is a claim about the Kieler Förde, produced by a feed that had said nothing about
 * anywhere — measured on the deployed relay as `messages: 0` after ten minutes with the socket
 * open and the subscription accepted. The subscribed box is the whole western Baltic, where
 * traffic never stops, so zero was not merely unhelpful: it was false.
 *
 * Same rule as the coverage field's three states — *we did not observe this* must never render as
 * *there is nothing there*.
 */

function status(patch: Partial<LiveStatus> = {}): LiveStatus {
  return {
    mode: "live",
    upstream: "connected",
    source: "aisstream.io",
    vessels: 0,
    aoi: "kieler-foerde",
    messages: 0,
    accepted: 0,
    privacy: "",
    everReceived: true,
    silentForMs: 1_000,
    ...patch,
  };
}

describe("describeLiveFeed", () => {
  it("refuses to state a ship count when the source has never sent anything", () => {
    const feed = describeLiveFeed(status({ everReceived: false, messages: 0 }), 0);
    expect(feed.kind).toBe("silent");
    expect(feed.warn).toBe(true);
    // The headline must not contain a number of ships — that is the false claim.
    expect(feed.headline).not.toMatch(/\d+\s*Schiffe/);
    expect(feed.headline).toMatch(/sendet nicht/);
    // …and the explanation has to say whose problem it is, and name the wrong answer.
    expect(feed.detail).toMatch(/Störung der Quelle/);
    expect(feed.detail).toMatch(/keine Aussage über das Modellgebiet/);
  });

  it("treats an explicitly silent upstream the same way, and says for how long", () => {
    const feed = describeLiveFeed(
      status({ upstream: "silent", silentForMs: 22 * 60_000 }), 0);
    expect(feed.kind).toBe("silent");
    expect(feed.headline).toContain("22 min");
    expect(feed.headline).not.toMatch(/\d+\s*Schiffe/);
  });

  it("separates a dead socket from a mute one — they have different causes", () => {
    const feed = describeLiveFeed(status({ upstream: "down", everReceived: false }), 0);
    expect(feed.kind).toBe("down");
    expect(feed.headline).toMatch(/nicht verbunden/);
    expect(feed.detail).toMatch(/sagt das nichts aus/);
  });

  it("allows a genuine zero only once the source is demonstrably sending", () => {
    const feed = describeLiveFeed(status({ upstream: "connected", everReceived: true }), 0);
    expect(feed.kind).toBe("quiet");
    expect(feed.warn).toBe(false);
    // This one IS a statement about the water, and it is now an earned one.
    expect(feed.headline).toMatch(/Keine Schiffe im Modellgebiet/);
  });

  it("reports the count the app derived for the modelled water, not the relay's own", () => {
    // ⚠️ The relay subscribes to the coarse shell box, so its `vessels` is much larger than what
    // the camera can reach. Quoting it would inflate every live figure in the app.
    const feed = describeLiveFeed(status({ vessels: 380, everReceived: true }), 12);
    expect(feed.kind).toBe("live");
    expect(feed.headline).toBe("12 Schiffe");
    expect(feed.warn).toBe(false);
  });

  it("keeps flagging replay as replay, whatever the counts say", () => {
    const feed = describeLiveFeed(status({ mode: "replay", upstream: "replay" }), 7);
    expect(feed.kind).toBe("replay");
    expect(feed.warn).toBe(true);
    expect(feed.detail).toMatch(/aufgezeichneten Tag/);
  });

  it("does not invent a fault when talking to an OLDER relay", () => {
    // 🔴 A deployed app and a deployed relay do not update in the same instant. An older relay
    // sends no `everReceived` and no `silentForMs`; the absence of a field is not evidence of
    // silence, and reading it as such would break live mode for everyone mid-rollout.
    const old = status();
    delete (old as Partial<LiveStatus>).everReceived;
    delete (old as Partial<LiveStatus>).silentForMs;
    expect(describeLiveFeed(old, 5).kind).toBe("live");
    expect(describeLiveFeed(old, 0).kind).toBe("quiet");
  });

  it("says something useful before any status has arrived", () => {
    expect(describeLiveFeed(null, 0).kind).toBe("down");
    expect(describeLiveFeed(null, 0).warn).toBe(true);
  });
});

describe("formatSilence", () => {
  it("rounds to the coarsest unit that is still honest", () => {
    expect(formatSilence(20_000)).toBe("unter einer Minute");
    expect(formatSilence(5 * 60_000)).toBe("5 min");
    expect(formatSilence(3 * 3_600_000)).toBe("3 h");
    expect(formatSilence(50 * 3_600_000)).toBe("2 d");
  });
});

describe("the recorded day standing in for a mute live source", () => {
  /**
   * The live provider is a free beta with no SLA and no second supplier, and it has been mute for
   * a whole day. When live traffic is what makes the app worth showing, an outage must not render
   * as an empty sea — but a recording must never be passed off as live either. These pin both.
   */
  it("shows the ships, and says in the same breath that they are a recording", () => {
    const feed = describeLiveFeed(status({ fallback: true, upstream: "silent" }), 14);
    expect(feed.kind).toBe("fallback");
    expect(feed.warn).toBe(true);
    // 🔴 The count and the caveat are in the SAME string. A number here with the caveat parked in
    // a tooltip would be read as live by anyone who does not hover.
    expect(feed.headline).toContain("Aufzeichnung");
    expect(feed.headline).toContain("14");
    expect(feed.detail).toContain("keine Echtzeitdaten");
    expect(feed.detail).toContain("automatisch umgeschaltet");
  });

  it("beats the silent state, because ships really are moving on screen", () => {
    // Reporting "Quelle sendet nicht" over a moving picture is its own kind of wrong.
    const feed = describeLiveFeed(
      status({ fallback: true, upstream: "silent", everReceived: false }), 9);
    expect(feed.kind).toBe("fallback");
  });

  it("goes back to plain live the moment the source returns", () => {
    const feed = describeLiveFeed(status({ fallback: false, upstream: "connected" }), 9);
    expect(feed.kind).toBe("live");
    expect(feed.headline).toBe("9 Schiffe");
  });

  it("keeps synthetic identities out of external vessel lookups", () => {
    // 🔴 The stand-in emits made-up MMSIs (900000000 + index). Handing one to a public AIS service
    // produces a failed lookup — and a verification link that fails is worse than none, because it
    // withdraws the offer the panel is making. The place is real even when the identity is not.
    const entry = { id: "x", class: "Cargo", lengthM: null, lat: 54.4, lon: 10.2,
                    knots: 6, atMs: 1, ageMs: 0, reports: 1, mmsi: "900000042" };
    expect(checkUrl(entry, true)).toContain("centery:54.40000");
    expect(checkUrl(entry, true)).not.toContain("900000042");
    // …and a real identity still gets the vessel page.
    //
    // ⚠️ Host changed 2026-08-10 after measuring it: MarineTraffic's search endpoint now answers
    // **404** for both `?keyword=` and `?mmsi=`, so every per-vessel link the app shipped was
    // dead. VesselFinder resolves an MMSI to the vessel page (200, checked with 211476060).
    expect(checkUrl({ ...entry, mmsi: "211476060" }, false))
      .toBe("https://www.vesselfinder.com/vessels/details/211476060");
  });

  it("knows which feed states carry invented identities", () => {
    expect(hasSyntheticIdentity(status({ fallback: true }))).toBe(true);
    expect(hasSyntheticIdentity(status({ mode: "replay" }))).toBe(true);
    expect(hasSyntheticIdentity(status())).toBe(false);
    expect(hasSyntheticIdentity(null)).toBe(false);
  });
});
