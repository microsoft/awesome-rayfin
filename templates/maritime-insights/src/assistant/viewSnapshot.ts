import type { ReportModel } from "../twin3d/report";
import type { VesselDetails } from "../twin3d/scene";

/**
 * What the assistant is told about the user's screen.
 *
 * 🔴 **This is the only place coverage figures may come from.** The viewshed is solved in the
 * browser against the sites the user placed, so the backend cannot know them. Left to infer a
 * percentage the model would produce one, and it would be wrong in a way that reads as
 * authoritative. `get_current_view` returns exactly this object and the instructions forbid
 * estimating any part of it.
 *
 * 🔴 **Derived from `reportData()`, not collected independently.** That model is what the exported
 * annex is built from, and it already carries every figure *with* the caveat that qualifies it —
 * the denominator, the excluded stationary passages, whether vegetation is in the blocking
 * surface. Assembling a second set of numbers here is how the assistant and the annex would come
 * to disagree, which is precisely the failure §14.12 was about.
 */
export interface ViewSnapshot {
  /**
   * 🔴 The AOI **id** (`kieler-foerde`), not its display name.
   *
   * The backend keys its loaded areas by folder id, so sending "Kieler Förde" or "Schlei" here
   * misses the lookup and silently falls back to the first area loaded — the assistant would then
   * answer Schlei questions with Förde traffic, confidently and with no symptom at all.
   */
  aoi: string;
  /** What to call it in prose. */
  aoiLabel: string;
  scenario: string;
  recordedDate: string;
  targetM: number | null;
  sites: {
    /** 1-based, matching the number the panel shows the user. */
    index: number;
    mastM: number;
    lat: number;
    lon: number;
    groundM: number;
    eyeM: number;
    horizonKm: number;
    observedTransits: number;
    /** Transits this site alone holds — the figure that says whether it is load-bearing. */
    exclusiveTransits: number;
  }[];
  coverage: {
    visibleKm2: number;
    shadowedKm2: number;
    traffic: {
      denominator: number;
      observed: number;
      missed: number;
      observedShare: number;
      positionShare: number;
      denominatorMeaning: string;
    } | null;
    network: {
      observedShare: number;
      redundantShare: number;
      singleCoverPassages: number;
      worstCaseLossShare: number;
    } | null;
  } | null;
  excludedStationary: number | null;
  transitMinKm: number | null;
  surface: {
    includesBuildings: boolean;
    includesVegetation: boolean;
    caveat: string;
  } | null;
  selectedVessel: {
    name: string | null;
    mmsi: string | null;
    class: string;
    destination: string | null;
    speedKn: number;
    distanceKm: number;
    observedByNetwork: boolean | null;
  } | null;
  /** Named so the model can say "place a site" instead of inventing a coverage figure. */
  hint: string;
}

/** What the app knows about the current view whether or not a site has been placed. */
export interface ViewContext {
  aoi: { id: string; name: string };
  scenario: string;
  recordedDate: string | null;
  includesVegetation: boolean | null;
}

/**
 * 🔴 Returns a snapshot even when there is no report.
 *
 * `reportData()` is null until a site exists — it describes a *coverage analysis*, and there is
 * none yet. But the area, the scenario and the recorded day are known from the moment the terrain
 * loads, and returning null for all of it made the assistant answer "I cannot tell which area you
 * are in" while the title bar said Schlei. The coverage block is what goes missing before a site
 * is placed, not the whole view.
 */
export function buildViewSnapshot(
  report: ReportModel | null,
  vessel: VesselDetails | null,
  context: ViewContext,
): ViewSnapshot {
  const surfaceCaveat = (includesVegetation: boolean | null) =>
    includesVegetation === false
      ? "No vegetation in the blocking surface, so every coverage figure here is an UPPER BOUND — "
        + "vegetation can only block further, never open a sight line."
      : "Blocking surface includes terrain, buildings and the measured vegetation top.";

  const selectedVessel = vessel
    ? {
        name: vessel.name ?? null,
        mmsi: vessel.mmsi ?? null,
        class: vessel.type,
        destination: vessel.destination ?? null,
        speedKn: Number(vessel.speedKn.toFixed(1)),
        distanceKm: Number(vessel.distanceKm.toFixed(2)),
        observedByNetwork: vessel.observed ? vessel.observed.seen : null,
      }
    : null;

  if (!report) {
    return {
      aoi: context.aoi.id,
      aoiLabel: context.aoi.name,
      scenario: context.scenario,
      recordedDate: context.recordedDate ?? "unknown",
      targetM: null,
      sites: [],
      coverage: null,
      excludedStationary: null,
      transitMinKm: null,
      surface: context.includesVegetation === null ? null : {
        includesBuildings: true,
        includesVegetation: context.includesVegetation,
        caveat: surfaceCaveat(context.includesVegetation),
      },
      selectedVessel,
      hint: "No sensor site is placed, so there are no coverage figures at all. Suggest a "
        + "double-click on the water to place one, or the optimiser to propose positions. The "
        + "area and the recorded day above are still accurate.",
    };
  }

  return {
    aoi: context.aoi.id,
    aoiLabel: report.aoiName || context.aoi.name,
    scenario: report.scenario,
    recordedDate: report.trackDate,
    targetM: report.targetM,
    // ⚠️ `uniquePassages` comes straight off the report site rather than being looked up in the
    // network summary — the report model already joined them, and joining them a second time here
    // is how the two would come to disagree about which site is which.
    sites: report.sites.map((site) => ({
      index: site.index,
      mastM: site.mastM,
      lat: Number(site.lat.toFixed(5)),
      lon: Number(site.lon.toFixed(5)),
      groundM: Number(site.groundM.toFixed(1)),
      eyeM: Number(site.eyeM.toFixed(1)),
      horizonKm: Number(site.horizonKm.toFixed(1)),
      observedTransits: site.observedPassages,
      exclusiveTransits: site.uniquePassages,
    })),
    coverage: {
      visibleKm2: Number(report.areaVisibleKm2.toFixed(1)),
      shadowedKm2: Number(report.areaShadowedKm2.toFixed(1)),
      traffic: report.traffic
        ? {
            denominator: report.traffic.passages,
            observed: report.traffic.observedPassages,
            missed: report.traffic.missedPassages,
            observedShare: Number(report.traffic.passageShare.toFixed(3)),
            positionShare: Number(report.traffic.positionShare.toFixed(3)),
            // ⚠️ Spelled out on the object rather than left to the instructions, because this is
            // the number most likely to be quoted and the easiest one to quote against the wrong
            // total. The day has more transits than this; only these entered the modelled grid.
            denominatorMeaning:
              `Transits (travelled at least ${report.stationaryBelowKm} km) that entered the `
              + "modelled line-of-sight grid. Fewer than the day's total transits, and far fewer "
              + "than its total passages.",
          }
        : null,
      network: report.network
        ? {
            observedShare: Number(report.network.passageShare.toFixed(3)),
            redundantShare: Number(report.network.redundantShare.toFixed(3)),
            singleCoverPassages: report.network.singleCoverPassages,
            worstCaseLossShare: Number(report.network.worstCaseLossShare.toFixed(3)),
          }
        : null,
    },
    excludedStationary: report.excludedStationary,
    transitMinKm: report.stationaryBelowKm,
    surface: report.surface
      ? {
          includesBuildings: report.surface.includesBuildings,
          includesVegetation: report.surface.includesVegetation,
          caveat: surfaceCaveat(report.surface.includesVegetation),
        }
      : null,
    selectedVessel,
    hint: report.sites.length
      ? "Coverage figures above are live for the sites the user has placed."
      : "No sensor site is placed, so there are no coverage figures. Suggest a double-click on "
        + "the water to place one, or the optimiser to propose positions.",
  };
}
