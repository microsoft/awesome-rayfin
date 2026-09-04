import { describe, expect, it } from "vitest";
import { readFrames } from "./api";
import { buildViewSnapshot } from "./viewSnapshot";
import type { ReportModel } from "../twin3d/report";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out = [];
  for await (const frame of readFrames(stream(chunks))) out.push(frame);
  return out;
}

describe("readFrames", () => {
  it("reads one frame per line", async () => {
    const frames = await collect([
      '{"type":"status","message":"a"}\n{"type":"delta","text":"hi"}\n{"type":"done"}\n',
    ]);
    expect(frames.map((f) => f.type)).toEqual(["status", "delta", "done"]);
  });

  it("holds a frame split across two chunks until it is complete", async () => {
    // 🔴 The bug this pins is invisible until a frame happens to straddle a chunk boundary, which
    // under load is exactly when it happens. Parsing the partial line throws, and the answer stops
    // mid-sentence with no error anyone can act on.
    const frames = await collect(['{"type":"delta","te', 'xt":"split"}\n']);
    expect(frames).toEqual([{ type: "delta", text: "split" }]);
  });

  it("emits a trailing frame that never got its newline", async () => {
    const frames = await collect(['{"type":"done"}']);
    expect(frames).toEqual([{ type: "done" }]);
  });

  it("skips a corrupt line rather than losing the rest of the answer", async () => {
    const frames = await collect(['not json\n{"type":"delta","text":"ok"}\n']);
    expect(frames).toEqual([{ type: "delta", text: "ok" }]);
  });

  it("ignores blank lines", async () => {
    const frames = await collect(['\n\n{"type":"done"}\n\n']);
    expect(frames).toEqual([{ type: "done" }]);
  });
});

const REPORT: ReportModel = {
  generatedUtc: "2026-08-04T18:00:00Z",
  aoiName: "Kieler Förde",
  scenario: "maritime",
  trackDate: "2026-07-01",
  targetM: 2,
  sites: [{
    index: 1, lat: 54.4, lon: 10.2, col: 400, row: 500, mastM: 25, groundM: 7.1, eyeM: 32.1,
    horizonKm: 24.6, observedPassages: 99, uniquePassages: 40,
  }],
  traffic: {
    passages: 137, observedPassages: 99, missedPassages: 38,
    passageShare: 0.7226, positionShare: 0.6812,
  },
  network: null,
  areaVisibleKm2: 55.53,
  areaShadowedKm2: 12.2,
  missed: [],
  missedShown: 40,
  excludedStationary: 108,
  stationaryBelowKm: 0.5,
  surface: { includesBuildings: true, includesVegetation: false, vegetationStats: null },
  variants: [],
};

const CTX = {
  aoi: { id: "kieler-foerde", name: "Kieler Förde" },
  scenario: "maritime",
  recordedDate: "2026-07-01",
  includesVegetation: true,
};

describe("buildViewSnapshot", () => {
  it("sends the AOI id, not its display name", () => {
    // 🔴 The backend keys its areas by folder id. Sending "Kieler Förde" misses the lookup and
    // falls back to whichever area loaded first — so a Schlei question would be answered with
    // Förde traffic, with nothing on screen to say so.
    const view = buildViewSnapshot(REPORT, null, { ...CTX, aoi: { id: "schlei", name: "Schlei" } })!;
    expect(view.aoi).toBe("schlei");
    expect(view.aoiLabel).toBe("Kieler Förde");
  });

  it("carries the coverage denominator with its meaning, never a bare percentage", () => {
    // 🔴 The app has two denominators — every transit, and the transits that entered the modelled
    // grid — and 137 vs 153 is exactly the pair an assistant would mix up. The number travels with
    // a sentence saying which one it is.
    const view = buildViewSnapshot(REPORT, null, CTX)!;
    expect(view.coverage!.traffic).toMatchObject({
      denominator: 137, observed: 99, missed: 38, observedShare: 0.723,
    });
    expect(view.coverage!.traffic!.denominatorMeaning).toMatch(/entered the/i);
    expect(view.coverage!.traffic!.denominatorMeaning).toMatch(/0\.5 km/);
  });

  it("states the upper bound when the surface has no vegetation", () => {
    const view = buildViewSnapshot(REPORT, null, CTX)!;
    expect(view.surface!.caveat).toMatch(/UPPER BOUND/);
  });

  it("drops the upper-bound caveat when vegetation is modelled", () => {
    // ⚠️ The caveat follows the data. A fixed string here would eventually be the same class of
    // untruth as the identity notice that outlived the identity rule.
    const view = buildViewSnapshot(
      { ...REPORT, surface: { includesBuildings: true, includesVegetation: true } },
      null, CTX)!;
    expect(view.surface!.caveat).not.toMatch(/UPPER BOUND/);
  });

  it("discloses the excluded stationary passages", () => {
    const view = buildViewSnapshot(REPORT, null, CTX)!;
    expect(view.excludedStationary).toBe(108);
    expect(view.transitMinKm).toBe(0.5);
  });

  it("tells the assistant what to say when no site is placed", () => {
    const view = buildViewSnapshot({ ...REPORT, sites: [], traffic: null }, null, CTX)!;
    expect(view.hint).toMatch(/No sensor site is placed/);
    expect(view.coverage!.traffic).toBeNull();
  });

  it("still names the area when no coverage analysis exists yet", () => {
    // 🔴 `reportData()` is null until a site is placed — it describes a coverage analysis, and
    // there is none. Returning null for the whole view made the assistant answer "I cannot tell
    // which area you are in" while the title bar said Schlei. Found by asking it exactly that.
    const view = buildViewSnapshot(null, null, { ...CTX, aoi: { id: "schlei", name: "Schlei" } });
    expect(view.aoi).toBe("schlei");
    expect(view.aoiLabel).toBe("Schlei");
    expect(view.recordedDate).toBe("2026-07-01");
    // What is genuinely missing is missing, and says so.
    expect(view.coverage).toBeNull();
    expect(view.sites).toEqual([]);
    expect(view.hint).toMatch(/No sensor site is placed/);
    expect(view.hint).toMatch(/area and the recorded day above are still accurate/);
  });

  it("keeps a selected vessel even with no coverage analysis", () => {
    // Clicking a ship and asking about it must work before any site exists.
    const view = buildViewSnapshot(null, {
      name: "LITTORINA", mmsi: "211214250", type: "Dredging", destination: "RESEARCH",
      speedKn: 8.2, distanceKm: 17.28, observed: null,
    } as never, CTX);
    expect(view.selectedVessel).toMatchObject({ name: "LITTORINA", mmsi: "211214250" });
  });

  it("passes the per-site exclusive contribution through", () => {
    const view = buildViewSnapshot(REPORT, null, CTX)!;
    expect(view.sites[0]).toMatchObject({ index: 1, mastM: 25, exclusiveTransits: 40 });
  });
});
