import { useCallback, useEffect, useRef, useState } from "react";
import { loadTerrain, type TerrainData } from "./twin3d/loader";
import { createScene, landCoverage, type SceneHandle, type Scenario, type AltitudeRung,
         type OptimisationResult } from "./twin3d/scene";
import type { ProtectedAsset, LosMeta } from "./twin3d/loader";
import type { ApproachCoverage } from "./twin3d/viewshed";
import type { NetworkCoverage } from "./twin3d/network";
import { renderReportHtml } from "./twin3d/report";
import { compareVariants, ppPerMastMetre, variantCost, observedShare,
         type Variant } from "./twin3d/variants";
import { AOIS, AOI_ORDER, activeAoiId, writeAoiToUrl } from "./config/aoi";

/** One site as the scene reports it. */
type SceneSite = ReturnType<SceneHandle["sites"]>[number];
import type { FlyTelemetry } from "./twin3d/flyControls";
import type { VesselDetails } from "./twin3d/scene";
import { vesselClass } from "./twin3d/vesselClasses";
import { connectLive, type LiveSource, type LiveState, type LiveStatus } from "./twin3d/liveSource";
import { checkUrl, describeLiveFeed, formatAge, hasSyntheticIdentity, isUnderWay, LIVE_STALE_MS,
         summariseLiveVessels, verificationUrl,
         type LiveBounds, type LiveListEntry } from "./twin3d/liveList";
import { ChatPanel } from "./assistant/ChatPanel";
import { buildViewSnapshot } from "./assistant/viewSnapshot";
import { PlansPanel } from "./plans/PlansPanel";
import {
  applyUiTheme, LIGHT_THEME_CAVEAT, storeTheme, THEME_LABELS, type ThemeName,
} from "./theme";

/**
 * Where the live relay listens.
 *
 * The relay is deliberately not part of the deployed bundle: static hosting cannot hold a socket
 * open, and aisstream.io forbids browser connections anyway. It runs instead as a container that a
 * visitor can reach — see `server/ais/README` and `docs/phase5-live.md` for how to build and host
 * one.
 *
 * 🔴 **The default is localhost on purpose.** An earlier version defaulted to the author's own
 * container, which meant every clone of this template pointed its visitors at one private endpoint
 * and spent someone else's quota. Set `VITE_AIS_RELAY` to your own deployed relay. With nothing
 * listening the app stays in replay and says so — a missing relay is a supported state, not an
 * error.
 */
const RELAY_URL = (import.meta.env.VITE_AIS_RELAY as string | undefined)
  ?? "http://127.0.0.1:8788";

interface Status {
  stage: string;
  done: number;
  total: number;
}

const DAY_S = 86_400;
/** Replay rate: a whole day in about two and a half minutes. */
const SECONDS_PER_SECOND = 600;

/**
 * How often the replay clock is PUBLISHED into React state.
 *
 * 🔴 The clock used to call `setNow` inside `requestAnimationFrame`, which re-rendered this whole
 * component 60 times a second. React reported *"Maximum update depth exceeded"* — and that is not
 * cosmetic: when React bails out of a runaway update chain it **stops committing**, so the canvas
 * stayed `data-ready="false"` forever on an app whose terrain had actually finished loading. That
 * was the intermittent "the app never loads" hang.
 *
 * The scene does not need the state at all — it reads the clock as a uniform, so it can follow
 * every frame for free. Only the on-screen label and the scrubber need a React value, and 10 Hz is
 * past the point anyone can read a changing time.
 */
const CLOCK_PUBLISH_MS = 100;

function clock(seconds: number): string {
  const s = Math.max(0, Math.min(DAY_S - 1, Math.round(seconds)));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface Beat {
  label: string;
  atS: number;
  vessels: number;
}

/**
 * Story beats are read out of the day, never written into it. Each track carries the interval it
 * was under way, so counting overlaps per hour gives the busy and quiet moments for whatever day
 * happens to be loaded. Hard-coding "the evening peak is at 19:00" would be a caption pretending
 * to be a finding.
 */
function deriveBeats(tracks: { fromS: number; toS: number }[]): Beat[] {
  if (!tracks.length) return [];
  const perHour = new Array<number>(24).fill(0);
  for (let hour = 0; hour < 24; hour += 1) {
    const from = hour * 3600;
    const to = from + 3600;
    perHour[hour] = tracks.filter((t) => t.fromS < to && t.toS >= from).length;
  }
  let busiest = 0;
  let quietest = 0;
  for (let hour = 1; hour < 24; hour += 1) {
    if (perHour[hour] > perHour[busiest]) busiest = hour;
    if (perHour[hour] < perHour[quietest]) quietest = hour;
  }
  const firstMove = Math.min(...tracks.map((t) => t.fromS));
  return [
    { label: `Erste Fahrt ${clock(firstMove)}`, atS: firstMove, vessels: 1 },
    { label: `Ruhigste Stunde ${clock(quietest * 3600)}`, atS: quietest * 3600 + 1800, vessels: perHour[quietest] },
    { label: `Verkehrsspitze ${clock(busiest * 3600)}`, atS: busiest * 3600 + 1800, vessels: perHour[busiest] },
  ];
}

export default function App({ initialTheme = "dark" }: { initialTheme?: ThemeName }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  /**
   * Which site is on screen.
   *
   * 🔴 State rather than a URL read, so switching never reloads the page — the two cores sit
   * inside one shared coarse shell 32 km apart, and a reload would assert two separate worlds
   * where there is one. `?aoi=` still decides where a fresh load starts, so existing links keep
   * working, and the address bar is kept in step below.
   */
  const [aoiId, setAoiId] = useState(() => activeAoiId());
  const aoi = AOIS[aoiId];
  const [status, setStatus] = useState<Status>({ stage: "Start", done: 0, total: 5 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string>("");
  const [tracksMeta, setTracksMeta] = useState<{ date: string; count: number } | null>(null);
  /**
   * The blocking surface's own descriptor, so the model notice can state what *this* site's
   * surface actually contains instead of repeating a figure from another one.
   */
  const [losMeta, setLosMeta] = useState<LosMeta | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [now, setNow] = useState(8 * 3600);
  /**
   * The active palette.
   *
   * ⚠️ `themeRef` exists so the scene loader can read the current palette **without the palette
   * becoming a dependency of it**. That effect downloads ~52 MB; if it re-ran on a colour change
   * the app would refetch the entire terrain to repaint a hairline.
   */
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const themeRef = useRef<ThemeName>(initialTheme);
  themeRef.current = theme;
  /**
   * The authoritative replay clock. `now` is a {@link CLOCK_PUBLISH_MS} publication of this value,
   * kept only so the label and the scrubber have something to render.
   */
  const clockRef = useRef(8 * 3600);
  const [playing, setPlaying] = useState(true);
  const [vessels, setVessels] = useState(0);
  const [sitePlaced, setSitePlaced] = useState(false);
  const [mastM, setMastM] = useState(25);
  const [targetM, setTargetM] = useState(2);
  const [gapMode, setGapMode] = useState(false);
  const [droneMode, setDroneMode] = useState(false);
  const [hud, setHud] = useState<FlyTelemetry | null>(null);
  const [hudCoverage, setHudCoverage] = useState<string | null>(null);
  const [vessel, setVessel] = useState<VesselDetails | null>(null);
  const [liveWanted, setLiveWanted] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [livePoints, setLivePoints] = useState(0);
  /**
   * The live vessels, as a list the panel can show.
   *
   * Mirrored out of the feed rather than read from the scene: the scene holds them as packed
   * float buffers for the GPU, which is the right shape for drawing and the wrong one for a list.
   */
  const [liveList, setLiveList] = useState<LiveListEntry[]>([]);
  const [liveOutsideCount, setLiveOutsideCount] = useState(0);
  const boundsRef = useRef<LiveBounds | null>(null);
  const [liveSelected, setLiveSelected] = useState<string | null>(null);
  /**
   * The vessel the camera could not reach.
   *
   * 🔴 A live feed is bounded by the **relay's** box, which is the coarse shell; this app only
   * draws the high-resolution core. A vessel can therefore be perfectly real, listed, and outside
   * everything that is modelled. Saying so is better than a click that appears to do nothing.
   */
  const [liveOutside, setLiveOutside] = useState<string | null>(null);
  const liveRef = useRef<LiveSource | null>(null);
  const [cover, setCover] = useState<{
    visibleKm2: number; shadowedKm2: number; siteGroundM: number;
    eyeM: number; horizonM: number; elapsedMs: number;
    traffic: {
      passages: number; observedPassages: number; missedPassages: number;
      passageShare: number; positionShare: number;
    } | null;
    approach: ApproachCoverage | null;
  } | null>(null);

  // ── scenario ────────────────────────────────────────────────────────────
  // Two questions over one model. `targetM` is the same lever in both — a hull height or a flight
  // altitude — so the slider is relabelled and re-ranged rather than duplicated.
  const [scenario, setScenario] = useState<Scenario>("maritime");
  const [assets, setAssets] = useState<ProtectedAsset[]>([]);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [radiusM, setRadiusM] = useState(3000);
  const [showVessels, setShowVessels] = useState(true);
  const [ladder, setLadder] = useState<AltitudeRung[] | null>(null);
  const [ladderBusy, setLadderBusy] = useState(false);
  const [assetAttribution, setAssetAttribution] = useState<string | null>(null);
  /**
   * Who surveyed the ground under this AOI, and who owns the horizon tier.
   *
   * 🔴 Both were **typed into the footer** as "LVermGeo SH" and "Copernicus DEM © DLR/Airbus/ESA".
   * That is only true of the two coasts this repo happens to ship. The whole claim of the app is
   * that an AOI is configuration, so the first fork onto another coast would have kept crediting a
   * German state survey for Danish or Norwegian data — a false licence attribution, which is a
   * worse failure than a wrong number because it is the part a data owner checks. Same bug class as
   * the hardcoded "30 m" horizon posting a few lines below, and as the vegetation caveat before it.
   */
  const [geobasis, setGeobasis] = useState<{ core: string; shell: string | null } | null>(null);
  const selected = assets.find((a) => a.id === assetId) ?? null;

  // ── the network ────────────────────────────────────────────────────────
  // Mirrored from the scene rather than owned here: the scene decides what a site is, and two
  // copies of that would drift the moment one of them forgot a re-solve.
  const [siteList, setSiteList] = useState<SceneSite[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [network, setNetwork] = useState<NetworkCoverage | null>(null);
  const [overlapMode, setOverlapMode] = useState(false);
  const maxSites = handleRef.current?.maxSites() ?? 5;

  // ── site optimisation ─────────────────────────────────────────────────────
  const [optimiseCount, setOptimiseCount] = useState(3);
  /**
   * Mast height the search assumes.
   *
   * 🔴 Separate from `mastM`, which belongs to the *selected site* and therefore does not exist
   * until something has been placed. The optimiser has to be answerable with an empty map, and
   * "best places for 3 masts" is not a question until you say how tall they are — the answer moves
   * a long way with height, which is the whole point of §13.3. It follows the site slider while a
   * site is selected, so the panel never shows two different heights at once.
   */
  const [optimiseMastM, setOptimiseMastM] = useState(25);
  const [optimising, setOptimising] = useState(false);
  const [optimiseProgress, setOptimiseProgress] = useState(0);
  const [optimiseResult, setOptimiseResult] = useState<OptimisationResult | null>(null);
  const cancelOptimise = useRef(false);

  // ── A/B variants ────────────────────────────────────────────────────────
  // Procurement is comparative: a configuration only means something next to another one.
  const [variants, setVariants] = useState<Variant[]>([]);

  const runOptimise = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || optimising) return;
    cancelOptimise.current = false;
    setOptimising(true);
    setOptimiseProgress(0);
    setOptimiseResult(null);
    const result = await handle.optimiseSites(
      optimiseCount,
      optimiseMastM,
      (done, total) => setOptimiseProgress(total ? done / total : 0),
      () => cancelOptimise.current,
    );
    setOptimiseResult(result);
    setOptimising(false);
  }, [optimiseCount, optimiseMastM, optimising]);

  const applyOptimised = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !optimiseResult) return;
    handle.applySites(optimiseResult.picks.map((p) => ({
      col: p.col, row: p.row, mastM: optimiseResult.mastM,
    })));
    // The slider now has sites to describe, and they are all at the height the search assumed.
    setMastM(optimiseResult.mastM);
    // Defined below; a callback body runs long after this module has finished evaluating.
    syncNetworkRef.current();
    setOptimiseResult(null);
  }, [optimiseResult]);

  /**
   * Export the annex.
   *
   * 🔴 PLAN §13 tier 1 #3. A blob download rather than a print dialogue or a server round-trip:
   * the file has to be forwardable to people who were never in the room, and it has to work with
   * no backend, no login and no network — which also means it must not reference anything it does
   * not carry. The document prints to PDF from any browser.
   */
  const exportReport = useCallback(() => {
    const data = handleRef.current?.reportData();
    if (!data) return;
    const html = renderReportHtml({ ...data, variants });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Sichtbarkeitsanalyse-${aoi.slug}-${data.trackDate}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download in some browsers; one frame is enough.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }, [variants, aoi]);

  /**
   * What the assistant is allowed to know about the current screen.
   *
   * 🔴 Built from `reportData()` — the same model the exported annex is rendered from — rather
   * than from the panels. The annex exists precisely because those figures must not drift, and
   * assembling a third copy for the assistant would reintroduce the drift the annex prevents.
   * Called fresh on every prompt, so moving a mast between two questions changes the answer.
   */
  const assistantView = useCallback(() => {
    const data = handleRef.current?.reportData() ?? null;
    return buildViewSnapshot(data, handleRef.current?.selectedVessel() ?? null, {
      aoi,
      scenario,
      recordedDate: tracksMeta?.date ?? null,
      includesVegetation: losMeta?.includesVegetation ?? null,
    });
  }, [aoi, scenario, tracksMeta, losMeta]);

  /** Pull site list, network figures and coverage back out of the scene in one place. */
  const syncNetwork = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const list = handle.sites();
    setSiteList(list);
    setSelectedSite(handle.selectedSiteId());
    setNetwork(handle.networkStats());
    setCover(handle.coverageStats());
    setSitePlaced(list.length > 0);
    // The mast slider always shows the selected site's own height.
    const current = list.find((s) => s.id === handle.selectedSiteId());
    if (current) setMastM(current.mastM);
  }, []);

  /**
   * A stable handle to `syncNetwork` for callbacks declared above it.
   *
   * The optimiser's apply step needs it and is declared earlier for readability; a ref keeps the
   * ordering a presentation choice rather than a constraint on where the function may live.
   */
  const syncNetworkRef = useRef(syncNetwork);
  syncNetworkRef.current = syncNetwork;

  /**
   * Freeze the current configuration and its measured figures as a variant.
   *
   * The numbers are stored, not recomputed later: a variant has to keep the answer it was measured
   * with, or a comparison table silently re-scores an old configuration against a new target
   * height and reports a difference that nobody made.
   */
  const saveVariant = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const stats = handle.coverageStats();
    const net = handle.networkStats();
    const list = handle.sites();
    if (!stats || !list.length) return;
    setVariants((current) => {
      if (current.length >= 3) return current;
      const id = String.fromCharCode(65 + current.length);   // A, B, C
      return [...current, {
        id,
        sites: list.map((s) => ({ col: s.col, row: s.row, mastM: s.mastM })),
        targetM,
        transits: stats.traffic?.passages ?? 0,
        observedTransits: stats.traffic?.observedPassages ?? 0,
        redundantTransits: net?.redundantPassages ?? 0,
        worstCaseLossTransits: net?.worstCaseLossPassages ?? stats.traffic?.observedPassages ?? 0,
        visibleKm2: stats.visibleKm2,
      }];
    });
  }, [targetM]);

  const restoreVariant = useCallback((variant: Variant) => {
    const handle = handleRef.current;
    if (!handle) return;
    setTargetM(variant.targetM);
    handle.applySites(variant.sites);
    syncNetworkRef.current();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 🔴 Everything derived from the previous core has to go before the next one arrives.
    // Sites, variants, the optimiser result and the network figures are all expressed in the
    // *core's own* grid cells, so carrying any of them across would silently reinterpret a
    // Kieler Förde mast as a cell reference on the Schlei — a plausible-looking site in the wrong
    // country, with a coverage percentage attached to it.
    setReady(false);
    setError(null);
    setSiteList([]);
    setSelectedSite(null);
    setNetwork(null);
    setCover(null);
    setSitePlaced(false);
    setVariants([]);
    setOptimiseResult(null);
    setLadder(null);
    setAssets([]);
    setAssetId(null);
    setAssetAttribution(null);
    setGeobasis(null);
    setTracksMeta(null);
    setBeats([]);
    (async () => {
      try {
        const data: TerrainData = await loadTerrain(aoiId, (stage, done, total) => {
          if (!cancelled) setStatus({ stage, done, total });
        });
        if (cancelled || !canvasRef.current) return;
        setStatus({ stage: "Szene", done: 5, total: 5 });
        handleRef.current = createScene(canvasRef.current, data);
        // 🔴 Measurement hook. Every figure published in PLAN §13 is re-measured whenever the
        // blocking surface changes, and clicking a site into place by hand cannot reproduce a
        // position to the cell — so the numbers would stop being comparable across rebuilds.
        // Exposing the handle keeps the published figures auditable; it adds no behaviour.
        (window as unknown as Record<string, unknown>).__maritimeScene = handleRef.current;
        setInfo(
          `${data.meta.width} × ${data.meta.height} @ ${data.meta.resolutionM} m · `
          + `${data.meta.heightMinM.toFixed(1)} … ${data.meta.heightMaxM.toFixed(1)} m ü. NHN · `
          + `Land ${(landCoverage(data.land) * 100).toFixed(0)} % · `
          + `${data.buildings ? data.buildings.meta.count.toLocaleString("de-DE") : 0} Gebäude`
          // Read the horizon tier's posting from its own descriptor. It was hardcoded to "30 m"
          // and silently became a lie the moment the shell was rebuilt at 90 m.
          + `${data.shell ? ` · Horizont ${data.shell.meta.resolutionM ?? "?"} m` : ""}`,
        );
        // Attribution follows the data that is actually on screen, per AOI, exactly as the
        // horizon posting above does. `shell` is optional, so its credit is too.
        setGeobasis({
          core: data.meta.attribution,
          shell: data.shell?.meta.attribution ?? null,
        });
        if (data.tracks) {
          setTracksMeta({
            date: data.tracks.meta.date,
            count: data.tracks.meta.trackCount,
          });
          setBeats(deriveBeats(data.tracks.meta.tracks));
        }
        setLosMeta(data.los?.meta ?? null);
        // The live list is scoped to this. The relay's own bbox is the far wider shell tier, so
        // without the terrain's bounds the list fills with ships the camera cannot even reach.
        boundsRef.current = data.meta.boundsWgs84 ?? null;
        if (data.assets?.assets.length) {
          setAssets(data.assets.assets);
          setAssetId(data.assets.assets[0].id);
          setRadiusM(data.assets.assets[0].protectionRadiusM);
          setAssetAttribution(data.assets.attribution);
        }
        setReady(true);
      } catch (exception) {
        if (!cancelled) setError(String(exception));
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [aoiId]);

  // Keep the address bar honest without reloading: someone who switches to the Schlei and then
  // copies the URL should hand over the Schlei.
  useEffect(() => {
    writeAoiToUrl(aoiId);
    document.title = `Maritime-Insights — ${aoi.name}`;
  }, [aoiId, aoi]);

  /**
   * Push the palette into the document and into the scene.
   *
   * ⚠️ Depends on `ready` as well as `theme`, because switching site tears the scene down and
   * builds a new one. Without that dependency the palette would apply once and silently revert on
   * the second thing the user does — which is exactly the failure `e2e/theme.spec.ts` pins.
   */
  useEffect(() => {
    applyUiTheme(theme, document.documentElement, document.body);
    storeTheme(theme);
    handleRef.current?.setTheme(theme);
  }, [theme, ready]);

  // The clock drives the scene through a uniform, so a re-render costs a label update, not a
  // rebuild of 44 000 positions.
  //
  // ⚠️ Reads `clockRef`, **never `now`**. `now` is only a 10 Hz publication of the ref, so pushing
  // it into the scene would rewind the fjord by up to `CLOCK_PUBLISH_MS` on every publish — 600×
  // per replayed day at this playback rate, which reads as a visible stutter in the traffic.
  useEffect(() => {
    handleRef.current?.setTime(clockRef.current);
    setVessels(handleRef.current?.vesselsVisible() ?? 0);
  }, [now, ready]);

  useEffect(() => {
    if (!ready || !playing) return;
    let raf = 0;
    let last = performance.now();
    let lastPublish = last;
    const step = () => {
      const t = performance.now();
      const delta = ((t - last) / 1000) * SECONDS_PER_SECOND;
      last = t;
      clockRef.current = (clockRef.current + delta) % DAY_S;
      // Every frame for the scene (a uniform write), 10 Hz for React (a re-render).
      handleRef.current?.setTime(clockRef.current);
      if (t - lastPublish >= CLOCK_PUBLISH_MS) {
        lastPublish = t;
        setNow(clockRef.current);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready, playing]);

  // Scrubbing always wins: touching the slider stops playback rather than fighting it.
  //
  // ⚠️ The ref is the authoritative clock, so every writer must move it — setting only the state
  // would leave the scene on the old time until playback resumed and overwrote it.
  const scrub = useCallback((value: number) => {
    setPlaying(false);
    clockRef.current = value;
    setNow(value);
  }, []);

  // Moving a lever re-runs the viewshed at reduced ray density; releasing it re-runs in full.
  //
  // ⚠️ Not gated on a site existing. `setLevers` also carries the **target height**, which is a
  // property of the whole network and which the optimiser reads — so skipping this while the map
  // is empty would have the search silently assume the default target while the panel showed
  // something else.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setLevers(mastM, targetM);
    syncNetwork();
  }, [mastM, targetM, sitePlaced, syncNetwork]);

  const settle = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !sitePlaced) return;
    handle.settleLevers();
    syncNetwork();
  }, [sitePlaced, syncNetwork]);

  useEffect(() => {
    handleRef.current?.setGapMode(gapMode);
  }, [gapMode, ready]);

  useEffect(() => {
    handleRef.current?.setOverlapMode(overlapMode);
  }, [overlapMode, ready]);

  // The scenario switch. Presets the target lever to something meaningful for the new question:
  // a 2 m hull means nothing to a counter-UAS argument, and a 60 m drone means nothing to a ship.
  useEffect(() => {
    const handle = handleRef.current;
    if (!ready || !handle) return;
    handle.setScenario(scenario);
    setShowVessels(handle.vesselsShown());
    setLadder(null);
    // 30 m is a low-flying drone rather than a comfortable one, and it sits inside the band where
    // the answer actually moves. 60 m was the first default and returned 100 % almost everywhere.
    setTargetM(scenario === "counterUas" ? 30 : 2);
    setCover(handle.coverageStats());
  }, [scenario, ready]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!ready || !handle) return;
    handle.setSelectedAsset(assetId);
    setRadiusM(handle.protectionRadiusM());
    setLadder(null);
    setCover(handle.coverageStats());
  }, [assetId, ready]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!ready || !handle) return;
    handle.setProtectionRadius(radiusM);
    setLadder(null);
    setCover(handle.coverageStats());
  }, [radiusM, ready]);

  useEffect(() => {
    handleRef.current?.setVesselsVisible(showVessels);
  }, [showVessels, ready]);

  /**
   * Run the altitude ladder.
   *
   * 🔴 The rungs are measured, not chosen by taste. A first attempt ran 25 … 300 m and returned a
   * column of 100 %: over terrain this flat a 25 m mast sees everything airborne, so the whole
   * ladder sat above the interesting band and said nothing. Sweeping the real surface showed the
   * response lives between 5 and 150 m — at the hospital pad, coverage moves from 6 % to 44 %
   * across it and then stops rising at all. These rungs straddle that.
   *
   * Deferred by one frame so the button can render its busy state first: each rung is a full
   * viewshed solve and the browser is single-threaded, so without the yield the UI freezes with
   * the old label still on screen and the click looks lost.
   */
  const runLadder = useCallback(() => {
    const handle = handleRef.current;
    if (!handle || !sitePlaced) return;
    setLadderBusy(true);
    requestAnimationFrame(() => {
      setLadder(handle.sweepAltitudes([5, 10, 20, 30, 50, 75, 100, 150]));
      setLadderBusy(false);
    });
  }, [sitePlaced]);

  // The live feed. Connecting is the only thing that can tell us whether a relay is there, so the
  // toggle attempts it and the UI reports what happened rather than pretending to know in advance.
  useEffect(() => {
    const handle = handleRef.current;
    if (!ready || !handle) return;
    if (!liveWanted) {
      liveRef.current?.close();
      liveRef.current = null;
      handle.setLiveMode(false);
      setLiveState("idle");
      setLiveStatus(null);
      setLivePoints(0);
      setLiveList([]);
      setLiveOutsideCount(0);
      setLiveSelected(null);
      return;
    }

    setLiveState("connecting");
    const source = connectLive(RELAY_URL, (vessels, status) => {
      setLiveState(source.state());
      setLiveStatus(status);
      setLivePoints(handle.setLiveVessels(vessels));
      const summary = summariseLiveVessels(vessels, Date.now(), boundsRef.current);
      setLiveList(summary.entries);
      setLiveOutsideCount(summary.outsideCount);
    });
    liveRef.current = source;
    handle.setLiveMode(true);
    setPlaying(false);

    return () => {
      source.close();
      handle.setLiveMode(false);
    };
  }, [liveWanted, ready]);

  /**
   * Age the list out on a clock, not only when a frame arrives.
   *
   * ⚠️ Without this a quiet feed leaves the list frozen. `summariseLiveVessels` only runs in the
   * stream callback, so a vessel that stops reporting is never re-examined — the moment the last
   * frame lands, whatever was on screen stays there, ageing silently, still headed "Live-Schiffe".
   * The failure looks like nothing at all, which is what makes it worth a timer.
   *
   * Five seconds is well below the staleness window, so a row disappears close to when it earns
   * it, and the cost is one pass over a map that holds tens of entries.
   */
  useEffect(() => {
    if (!liveWanted || liveState !== "open") return;
    const id = window.setInterval(() => {
      const source = liveRef.current;
      if (!source) return;
      const summary = summariseLiveVessels(source.vessels(), Date.now(), boundsRef.current);
      setLiveList(summary.entries);
      setLiveOutsideCount(summary.outsideCount);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [liveWanted, liveState]);

  /**
   * Follow the camera latch, rather than drive it.
   *
   * ⚠️ There is no drone button any more. W A S D takes the camera, Escape or two seconds of
   * stillness gives it back, so a toggle was a second way to say what the keys already said — and
   * one that could disagree with them, because a flip requested mid-drag is deferred to the end of
   * the gesture. The scene is the only authority on whether the camera is flying.
   */
  useEffect(() => {
    if (!ready) return;
    const handle = handleRef.current;
    if (!handle) return;
    handle.onDroneMode(setDroneMode);
    setDroneMode(handle.droneEngaged());
    return () => handle.onDroneMode(null);
  }, [ready]);

  useEffect(() => {
    if (!droneMode) {
      setHud(null);
      setHudCoverage(null);
      return;
    }
    // Polled rather than pushed: the instruments are read from values the render loop has already
    // computed, so this costs a state update and never drives the camera.
    const id = window.setInterval(() => {
      setHud(handleRef.current?.droneTelemetry() ?? null);
      setHudCoverage(handleRef.current?.coverageAtCamera() ?? null);
    }, 120);
    return () => window.clearInterval(id);
  }, [droneMode, ready]);

  /** Pointer position on the canvas in normalised device coordinates, or null off-canvas. */
  const pointerNdc = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    };
  }, []);

  /**
   * Single click: inspect a vessel. Nothing is created and nothing is destroyed.
   *
   * 🔴 This used to also place a sensor site, and placing one is the *only* irreversible-feeling
   * action on the map — the coverage field re-solves, the panel changes shape, and every figure on
   * screen now describes a mast nobody meant to put there. Orbiting a 3D scene involves a great
   * many clicks that were only ever meant to be drags, so the gesture that changes the model has
   * to be the deliberate one. Selecting a ship stays on a single click precisely because it costs
   * nothing to undo.
   */
  const inspectVessel = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const handle = handleRef.current;
    // In drone mode the pointer is the gimbal, so a click is a look, not a selection.
    if (!handle || droneMode) return;
    const ndc = pointerNdc(event);
    if (!ndc) return;
    setVessel(handle.pickVesselFromPointer(ndc.x, ndc.y));
  }, [droneMode, pointerNdc]);

  /** Double click: place a site. The deliberate gesture, for the change that matters. */  const placeSite = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const handle = handleRef.current;
    if (!handle || droneMode) return;
    const ndc = pointerNdc(event);
    if (!ndc) return;

    // A vessel still wins over the ground beneath it. Double-clicking a ship you can see and
    // getting a sensor site dropped on the water instead would be the wrong answer to an
    // unambiguous gesture.
    const picked = handle.pickVesselFromPointer(ndc.x, ndc.y);
    if (picked) {
      setVessel(picked);
      return;
    }
    setVessel(null);

    if (handle.placeSiteFromPointer(ndc.x, ndc.y)) {
      syncNetwork();
    }
  }, [droneMode, pointerNdc, syncNetwork]);

  // The selected vessel keeps moving, so its readout is polled off the replay clock rather than
  // frozen at the moment of the click.
  useEffect(() => {
    if (!vessel) return;
    const id = window.setInterval(() => {
      setVessel((current) => (current ? handleRef.current?.selectedVessel() ?? current : current));
    }, 250);
    return () => window.clearInterval(id);
  }, [vessel !== null]);

  const clearVessel = useCallback(() => {
    handleRef.current?.clearVessel();
    setVessel(null);
  }, []);

  /**
   * Pick a live vessel out of the list and bring the camera to it.
   *
   * ⚠️ The camera goes to where the vessel **was last reported**, which for a ship at 12 kn is a
   * few tens of metres behind where it is now. That is honest and unavoidable — the app cannot
   * know a position it has not been told — and at the range this frames to, it is well inside the
   * view. Chasing the extrapolated position instead would be inventing data to make a camera move
   * look better.
   */
  const flyToLiveVessel = useCallback((entry: LiveListEntry) => {
    setLiveSelected(entry.id);
    const moved = handleRef.current?.flyToLonLat(entry.lon, entry.lat) ?? false;
    if (!moved) setLiveOutside(entry.id);
    else setLiveOutside(null);
  }, []);

  /** Put the scene back to plain terrain. Clears the whole network, not one mast. */
  const clearSite = useCallback(() => {
    handleRef.current?.clearSite();
    setSitePlaced(false);
    setCover(null);
    setGapMode(false);
    setOverlapMode(false);
    setSiteList([]);
    setSelectedSite(null);
    setNetwork(null);
  }, []);

  // Escape is what people already press to get out of a mode, so it costs nothing to honour it.
  // A selected vessel is dismissed first: it is the more recent, more transient selection, and
  // clearing the whole site because someone wanted to close a ship panel would be infuriating.
  useEffect(() => {
    if (!sitePlaced && !vessel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (vessel) clearVessel();
      else clearSite();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sitePlaced, vessel, clearSite, clearVessel]);

  // 🔴 What decides whether the replay controls belong on screen is not what the user asked for,
  // it is what is actually being rendered. Keying this off `liveWanted` stranded the user in the
  // one state that matters most: live requested, no relay reachable, the recorded day still
  // playing underneath — with the scrubber gone, while the caption promised the recording was
  // still running. The panel follows the scene now, not the intent.
  /**
   * Whether the recorded-day controls have anything to drive.
   *
   * The live feed takes the clock when it is open — but so does hiding the vessel layer, which the
   * counter-UAS scenario does by default. A scrubber over an empty sea still counting "12 Schiffe
   * unterwegs" is a readout contradicting the picture it sits under.
   */
  const replayDriving = liveState !== "open" && showVessels;

  /**
   * Enter pauses and resumes the recorded day.
   *
   * Space would be the obvious key and is the wrong one: the page is a full-screen canvas, Space
   * still scrolls, and it activates whichever control last had focus. Enter is free here — the
   * fly controls use W A S D, Q, E, R, F and Shift, and Escape already means "get me out".
   *
   * ⚠️ A focused control owns its own Enter. Without the guard, pressing Enter after clicking
   * "Verkehrsspitze 19:00" would jump to the beat *and* toggle playback, which reads as the button
   * being broken rather than as a shortcut firing.
   */
  useEffect(() => {
    if (!ready || !tracksMeta || !replayDriving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a[href], [contenteditable]")) return;
      event.preventDefault();
      setPlaying((on) => !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, tracksMeta, replayDriving]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--mi-bg)", color: "var(--mi-text)",
                  fontFamily: "system-ui, sans-serif" }}>
      <canvas
        ref={canvasRef}
        data-testid="twin3d-canvas"
        data-ready={ready}
        onClick={inspectVessel}
        onDoubleClick={placeSite}
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      <header style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "10px 16px",
                       display: "flex", gap: 16, alignItems: "baseline",
                       background: "linear-gradient(var(--mi-bg-fade), var(--mi-bg-clear))" }}>
        <strong style={{ fontSize: 15 }}>Maritime-Insights</strong>
        {/*
          The site switch.

          A plain `<select>`: one control, keyboard-accessible for free, and it makes the list of
          shipped sites self-evident. It does **not** reload the page — the two cores sit inside one
          shared coarse shell, so switching swaps the analysis core while the horizon stays put.

          ⚠️ It is a shared *shell*, not a shared analysis. Coverage, traffic and the optimiser stay
          scoped to one core, because a percentage computed across two inlets a ship cannot sail
          between would be arithmetic rather than a measurement.
        */}
        <label style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13 }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden",
                         clip: "rect(0 0 0 0)" }}>Standort</span>
          <select
            data-testid="twin3d-aoi-switcher"
            aria-label="Standort"
            value={aoiId}
            onChange={(event) => setAoiId(event.target.value)}
            style={{ background: "var(--mi-panel)", color: "var(--mi-text)", border: "1px solid var(--mi-line20)",
                     borderRadius: 4, padding: "2px 6px", fontSize: 13, fontFamily: "inherit",
                     pointerEvents: "auto", cursor: "pointer" }}
          >
            {AOI_ORDER.map((id) => (
              <option key={id} value={id}>{AOIS[id].name}</option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{aoi.region}</span>
        {/*
          🔴 `pointerEvents: "auto"` is mandatory, not defensive. This bar is a full-width overlay
          set `pointerEvents: "none"` so drags reach the fjord behind it, and that property
          INHERITS — the last two controls that forgot it shipped dead and said nothing.

          The label names what pressing it will DO, not what is currently on. A button reading
          "Dunkel" while the app is dark is ambiguous in exactly the moment someone is looking for
          the switch.
        */}
        <button
          data-testid="twin3d-theme-toggle"
          onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          title={`Auf ${THEME_LABELS[theme === "dark" ? "light" : "dark"]} umschalten`}
          style={{ background: "var(--mi-panel)", color: "var(--mi-text)",
                   border: "1px solid var(--mi-line20)", borderRadius: 4, padding: "2px 8px",
                   fontSize: 12, fontFamily: "inherit", pointerEvents: "auto", cursor: "pointer" }}
        >
          {THEME_LABELS[theme === "dark" ? "light" : "dark"]}
        </button>
        {/*
          ⚠️ Shown only while the bright theme is on, and it says what that costs. The shadow tint
          reads less strongly on a light surface, so a viewer comparing screenshots deserves to
          know — and the sentence has to close off the obvious wrong inference, that the *numbers*
          changed. They cannot: `e2e/theme.spec.ts` asserts the coverage figures are identical
          either side of a switch.
        */}
        {theme === "light" && (
          <span data-testid="twin3d-theme-caveat"
                style={{ fontSize: 11, opacity: 0.7, maxWidth: 420 }}>
            {LIGHT_THEME_CAVEAT}
          </span>
        )}
        <span data-testid="twin3d-info" style={{ fontSize: 12, opacity: 0.6, marginLeft: "auto" }}>
          {info}
        </span>
      </header>

      {!ready && !error && (
        <div data-testid="twin3d-loading"
             style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div style={{ background: "var(--mi-panel-soft)", padding: "18px 24px", borderRadius: 8,
                        minWidth: 280 }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>{status.stage}</div>
            <div style={{ height: 4, background: "var(--mi-line13)", borderRadius: 2 }}>
              <div style={{ height: 4, borderRadius: 2, background: "var(--mi-accent)",
                            width: `${(status.done / status.total) * 100}%`,
                            transition: "width .2s" }} />
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
              Schritt {status.done} von {status.total}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div data-testid="twin3d-error"
             style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div style={{ background: "var(--mi-panel-error)", padding: "18px 24px", borderRadius: 8,
                        maxWidth: 620, fontSize: 13, lineHeight: 1.5 }}>
            <strong>Die Geländedaten fehlen.</strong>
            <p style={{ opacity: 0.8 }}>
              Ein frischer Klon enthält kein Gelände — die abgeleiteten Daten sind zig Megabyte groß
              und jederzeit aus offenen Quellen reproduzierbar. Zum Erzeugen:
              <code style={{ display: "block", marginTop: 8, opacity: 0.9 }}>
                python tools/geodata/pipeline.py
              </code>
            </p>
            <p style={{ opacity: 0.55, fontSize: 12 }}>{error}</p>
          </div>
        </div>
      )}

      {ready && (
        <aside data-testid="twin3d-site"
               /*
                 🔴 The panel must scroll, and it did not.
                 Measured on the shipped build at 912 px tall: the panel rendered **1393 px** and
                 the page cannot scroll (`position: fixed; inset: 0`), so 537 px simply had no way
                 of being reached — including the whole site-optimiser block and the "Vorschlag
                 übernehmen" button, which sat at y=930 and failed a hit test. The optimiser was
                 not broken; its answer was below the floor. A fixed panel that grows with its
                 content needs a ceiling and an overflow, or the feature at the bottom silently
                 stops existing on smaller screens.
               */
               style={{ position: "absolute", top: 56, left: 16, width: 288, padding: "14px 16px",
                        background: "var(--mi-panel-strong)", borderRadius: 8, fontSize: 13,
                        display: "flex", flexDirection: "column", gap: 10,
                        // border-box, or the 28 px of padding is added on top of the cap and the
                        // panel hangs off the bottom by exactly that much.
                        boxSizing: "border-box",
                        maxHeight: "calc(100vh - 72px)", overflowY: "auto", overscrollBehavior: "contain",
                        scrollbarWidth: "thin", scrollbarColor: "var(--mi-accent33) transparent" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Sichtbarkeit</strong>
            {sitePlaced && (
              <button
                data-testid="twin3d-clear-site"
                onClick={clearSite}
                title="Alle Standorte entfernen (Esc)"
                style={{ marginLeft: "auto", background: "var(--mi-line07)", color: "var(--mi-text-muted)",
                         border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "3px 9px",
                         cursor: "pointer", fontSize: 11 }}
              >
                {siteList.length > 1 ? "Alle entfernen" : "Standort entfernen"}
              </button>
            )}
          </div>

          {/*
            The scenario switch. Two questions share one model, and showing both at once put ship
            trails, protection rings and two different coverage figures on the same fjord — which
            is precisely what makes a demo unreadable.
          */}
          {assets.length > 0 && (
            <div data-testid="twin3d-scenario"
                 style={{ display: "flex", gap: 0, border: "1px solid var(--mi-line17)",
                          borderRadius: 6, overflow: "hidden" }}>
              {([
                ["maritime", "Seeverkehr"],
                ["counterUas", "Drohnenabwehr"],
              ] as [Scenario, string][]).map(([id, label]) => (
                <button
                  key={id}
                  data-testid={`twin3d-scenario-${id}`}
                  onClick={() => setScenario(id)}
                  aria-pressed={scenario === id}
                  style={{ flex: 1, padding: "6px 4px", fontSize: 11.5, cursor: "pointer",
                           border: "none", color: scenario === id ? "var(--mi-well)" : "var(--mi-text-muted)",
                           background: scenario === id ? "var(--mi-accent)" : "transparent",
                           fontWeight: scenario === id ? 600 : 400 }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {scenario === "counterUas" && (
            <div data-testid="twin3d-asset-picker"
                 style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>Schutzobjekt</span>
                <select
                  data-testid="twin3d-asset-select"
                  value={assetId ?? ""}
                  onChange={(e) => setAssetId(e.target.value)}
                  style={{ background: "var(--mi-bg)", color: "var(--mi-text)", fontSize: 12,
                           border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "5px 7px" }}
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>

              {selected && (
                <div style={{ fontSize: 11, opacity: 0.62, lineHeight: 1.45 }}>
                  {selected.icao && <>{selected.icao} · {selected.iata} · </>}
                  {selected.runway && (
                    <>Piste {selected.runway.ref} · {selected.runway.lengthM} m · </>
                  )}
                  OSM {selected.osm.split(",")[0]}
                </div>
              )}

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>Schutzradius <strong data-testid="twin3d-radius">
                  {(radiusM / 1000).toFixed(1)} km
                </strong></span>
                <input
                  data-testid="twin3d-radius-slider"
                  type="range" min={500} max={8000} step={250} value={radiusM}
                  onChange={(e) => setRadiusM(Number(e.target.value))}
                />
                <span style={{ fontSize: 10.5, opacity: 0.55 }}>
                  Frei gewählter Planungswert — <strong>keine Rechtsvorschrift</strong>.
                </span>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                <input data-testid="twin3d-vessels-toggle" type="checkbox" checked={showVessels}
                       onChange={(e) => setShowVessels(e.target.checked)} />
                <span style={{ opacity: 0.85 }}>Schiffsverkehr einblenden</span>
              </label>
            </div>
          )}

          {!sitePlaced && (
            <p data-testid="twin3d-site-hint" style={{ margin: 0, opacity: 0.8, lineHeight: 1.5 }}>
              <strong>Doppelklick</strong> auf eine beliebige Stelle der Karte setzt einen
              <strong> fiktiven Standort</strong> — oder lassen Sie sich unten
              <strong> Standorte vorschlagen</strong>. Einfacher Klick wählt ein Schiff aus; die
              Karte bleibt unverändert, bis Sie doppelklicken.
            </p>
          )}

          {/*
            🔴 The live vessels, as a list you can act on.

            The feed was previously visible only as two numbers on the bottom bar — "2 Schiffe,
            90 Positionen" — and as moving dots somewhere on a 200 km² map. Knowing that two ships
            exist is not the same as being able to find them. Each row selects and brings the
            camera; each row also links out, because a live figure nobody can check against an
            independent source is a figure that has to be taken on trust.
          */}
          {liveState === "open" && (
            <div data-testid="twin3d-live-list"
                 style={{ display: "flex", flexDirection: "column", gap: 5,
                          borderTop: "1px solid var(--mi-line13)", paddingTop: 9 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6,
                            flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13, whiteSpace: "nowrap" }}>Live-Schiffe</strong>
                <span data-testid="twin3d-live-count"
                      title={`Schiffe im Modellgebiet mit einer Meldung aus den letzten `
                             + `${Math.round(LIVE_STALE_MS / 60_000)} Minuten. Die Zahl in der `
                             + `Leiste oben zählt alle Spuren im Speicher — auch die von Schiffen `
                             + `weit außerhalb, weil das Relay das größere Horizontgebiet abonniert.`}
                      style={{ fontSize: 11, opacity: 0.6 }}>
                  {liveList.length === 0 ? "keine im Modellgebiet"
                    : `${liveList.length} im Modellgebiet`}
                </span>
                {/*
                  The area link needs a place, and the only place this component knows for certain
                  is where a vessel actually is. With nothing in the feed there is nothing honest
                  to centre on, so the link is simply absent rather than pointing at a guess.
                */}
                {liveList.length > 0 && (
                  <a
                    data-testid="twin3d-live-verify-area"
                    href={verificationUrl(liveList[0].lat, liveList[0].lon, 11)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Dasselbe Seegebiet bei einem unabhängigen AIS-Dienst öffnen"
                    style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--mi-accent)",
                             textDecoration: "none", pointerEvents: "auto" }}
                  >
                    Seegebiet prüfen ↗
                  </a>
                )}
              </div>

              {liveList.length === 0 && (
                <div style={{ fontSize: 10.5, opacity: 0.55, lineHeight: 1.45 }}>
                  Die Verbindung steht, es liegt aber noch keine Position im Modellgebiet vor.
                </div>
              )}

              {/*
                Named rather than hidden. The relay listens to the whole horizon tile, so most of
                what arrives is outside the modelled water — the list would otherwise look as if
                it were losing ships that the status bar above plainly counts.
              */}
              {liveOutsideCount > 0 && (
                <div data-testid="twin3d-live-outside-count"
                     style={{ fontSize: 10, opacity: 0.5, lineHeight: 1.45 }}>
                  {liveOutsideCount.toLocaleString("de-DE")} weitere Schiffe melden aus dem
                  Empfangsgebiet außerhalb des Modells — nicht anfliegbar, daher nicht gelistet.
                </div>
              )}

              {liveList.map((entry) => {
                const selected = entry.id === liveSelected;
                const underWay = isUnderWay(entry);
                return (
                  <div key={entry.id} data-testid="twin3d-live-row"
                       style={{ display: "flex", alignItems: "center", gap: 6,
                                background: selected ? "var(--mi-accent12)" : "transparent",
                                border: `1px solid ${selected ? "var(--mi-accent33)" : "transparent"}`,
                                borderRadius: 5, padding: "3px 5px" }}>
                    <button
                      data-testid="twin3d-live-goto"
                      onClick={() => flyToLiveVessel(entry)}
                      title="Kamera zu diesem Schiff bewegen"
                      style={{ flex: 1, textAlign: "left", background: "transparent",
                               border: "none", color: "var(--mi-text)", cursor: "pointer",
                               fontSize: 11.5, padding: 0, fontFamily: "inherit",
                               display: "flex", flexDirection: "column", gap: 1,
                               minWidth: 0, pointerEvents: "auto" }}
                    >
                      {/*
                        Two deliberate lines rather than one that wraps. In a panel this narrow a
                        single run of text broke mid-phrase — "vor 3" above "min" — and every row
                        took a different height, so the list jittered as speeds changed.
                      */}
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden",
                                     textOverflow: "ellipsis" }}
                            title={entry.destination
                              ? `${entry.name ?? vesselClass(entry.class).label} → ${entry.destination}`
                              : undefined}>
                        <span style={{ color: underWay ? "var(--mi-good)" : "var(--mi-line53)" }}>●</span>{" "}
                        {/*
                          The name when the vessel has sent one, the class when it has not. A row
                          reading "—" would suggest the ship is unidentifiable rather than that its
                          static report has not come round yet.
                        */}
                        {entry.name ?? vesselClass(entry.class).label}
                      </span>
                      <span style={{ opacity: 0.55, fontSize: 10.5, whiteSpace: "nowrap",
                                     overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.name ? `${vesselClass(entry.class).label} · ` : ""}
                        {entry.knots.toFixed(1)} kn
                        {entry.lengthM ? ` · ${entry.lengthM} m` : ""}
                        {" · "}
                        {/*
                          The age belongs next to the speed it qualifies. A marker is where the
                          ship last *reported*, not where it is: at 15 kn a two-minute-old position
                          is already a kilometre out — the margin that decides whether a vessel
                          counts as covered.
                        */}
                        <span data-testid="twin3d-live-age">{formatAge(entry.ageMs)}</span>
                      </span>
                    </button>
                    <a
                      data-testid="twin3d-live-verify"
                      href={checkUrl(entry, hasSyntheticIdentity(liveStatus ?? null))}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={entry.mmsi && !hasSyntheticIdentity(liveStatus ?? null)
                        ? `MMSI ${entry.mmsi} bei einem unabhängigen AIS-Dienst öffnen`
                        : "Diese Position bei einem unabhängigen AIS-Dienst öffnen"}
                      style={{ fontSize: 10.5, color: "var(--mi-accent)", textDecoration: "none",
                               pointerEvents: "auto" }}
                    >
                      prüfen ↗
                    </a>
                  </div>
                );
              })}

              {liveOutside && (
                <div data-testid="twin3d-live-outside"
                     style={{ fontSize: 10.5, color: "var(--mi-warn)", lineHeight: 1.45 }}>
                  Dieses Schiff liegt außerhalb des modellierten Gebiets — der Empfangsbereich des
                  Relays ist größer als die hochaufgelöste Karte. Über „prüfen“ ist es trotzdem
                  einsehbar.
                </div>
              )}

              {/*
                ⚠️ The note follows the data. With identity in the feed "prüfen" opens the ship
                itself; with an anonymised relay it can only open the water. Stating the wrong one
                would teach the reader to distrust the rest of the panel.
              */}
              <div style={{ fontSize: 10, opacity: 0.5, lineHeight: 1.45 }}>
                {liveList.some((entry) => entry.mmsi) ? (
                  <>„prüfen“ öffnet <strong>das Schiff</strong> bei einem unabhängigen AIS-Dienst.
                  Kennungen kommen unverändert vom Schiff selbst; ohne Namen heißt, dass im
                  Modellgebiet noch keine AIS-Statusmeldung empfangen wurde.</>
                ) : (
                  <>„prüfen“ öffnet <strong>die Position</strong>, nicht das Schiff: dieser Relay
                  liefert keine Kennungen, daher kann diese App kein bestimmtes Schiff verlinken.</>
                )}
              </div>
            </div>
          )}

          {sitePlaced && (
            <>
              {/*
                🔴 The site list, and the reason tier 1 #2 exists: nobody buys one mast. Each row
                carries what that site is *worth* to the chain — the passages nothing else sees —
                because a combined percentage alone cannot tell a redundant site from a
                load-bearing one.
              */}
              <div data-testid="twin3d-site-list"
                   style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {siteList.map((s, index) => {
                  const contribution = network?.perSite[index];
                  const isSelected = s.id === selectedSite;
                  return (
                    <div key={s.id} data-testid="twin3d-site-row"
                         style={{ display: "flex", alignItems: "center", gap: 6,
                                  background: isSelected ? "var(--mi-accent12)" : "transparent",
                                  border: `1px solid ${isSelected ? "var(--mi-accent33)" : "transparent"}`,
                                  borderRadius: 6, padding: "4px 6px" }}>
                      <button
                        onClick={() => {
                          handleRef.current?.selectSite(s.id);
                          syncNetwork();
                        }}
                        title="Diesen Standort bearbeiten"
                        style={{ flex: 1, textAlign: "left", background: "transparent",
                                 border: "none", color: "var(--mi-text)", cursor: "pointer",
                                 fontSize: 12, padding: 0 }}
                      >
                        <strong>Standort {index + 1}</strong>
                        <span style={{ opacity: 0.7 }}> · {s.mastM} m</span>
                        {contribution && (
                          <span style={{ opacity: 0.75,
                                         color: contribution.uniquePassages ? "var(--mi-good)" : "var(--mi-warn)" }}>
                            {" "}· {contribution.uniquePassages} exklusiv
                          </span>
                        )}
                      </button>
                      <button
                        data-testid="twin3d-site-remove"
                        onClick={() => {
                          handleRef.current?.removeSite(s.id);
                          syncNetwork();
                        }}
                        title="Diesen Standort entfernen"
                        style={{ background: "transparent", border: "none", color: "var(--mi-warn)",
                                 cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 1 }}>
                  {siteList.length < maxSites
                    ? `Doppelklick für Standort ${siteList.length + 1} von ${maxSites}.`
                    : `Maximal ${maxSites} Standorte.`}
                </div>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>
                  Masthöhe <strong data-testid="twin3d-mast">{mastM} m</strong>
                  {siteList.length > 1 && (
                    <span style={{ opacity: 0.6, fontSize: 11 }}>
                      {" "}· Standort {siteList.findIndex((s) => s.id === selectedSite) + 1}
                    </span>
                  )}
                </span>
                <input
                  data-testid="twin3d-mast-slider"
                  type="range" min={2} max={120} step={1} value={mastM}
                  // Keep the search's assumed height in step with the one on screen, so the panel
                  // can never show two different mast heights and mean both of them.
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setMastM(value);
                    setOptimiseMastM(value);
                  }}
                  onMouseUp={settle}
                  onTouchEnd={settle}
                />
              </label>

              {/*
                One lever, two readings. The solver takes a target height above whatever surface
                the target sits on, so a hull and an airframe are the same parameter — only the
                sensible range and the words differ.
              */}
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>
                  {scenario === "counterUas" ? "Flughöhe" : "Zielhöhe"}{" "}
                  <strong data-testid="twin3d-target">{targetM} m</strong>
                </span>
                <input
                  data-testid="twin3d-target-slider"
                  type="range"
                  min={scenario === "counterUas" ? 5 : 1}
                  max={scenario === "counterUas" ? 200 : 40}
                  step={scenario === "counterUas" ? 5 : 1}
                  value={targetM}
                  onChange={(e) => setTargetM(Number(e.target.value))}
                  onMouseUp={settle}
                  onTouchEnd={settle}
                />
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {scenario === "counterUas"
                    ? (targetM <= 30 ? "tief fliegend, geländefolgend"
                      : targetM >= 150 ? "hoch — für die meisten Anflüge unrealistisch"
                      : "typische Anflughöhe einer kleinen Drohne")
                    : (targetM <= 3 ? "Schlauchboot"
                      : targetM >= 20 ? "Containerschiff" : "Küstenmotorschiff")}
                </span>
                {scenario === "counterUas" && (
                  <span style={{ fontSize: 10.5, opacity: 0.5, lineHeight: 1.4 }}>
                    Höhe <strong>über Grund</strong>. Bei maximal 61 m Geländehöhe im Gebiet liegt
                    das nah an der Höhe über NHN, aber gleich ist es nicht.
                  </span>
                )}
              </label>

              {scenario === "maritime" && cover?.traffic && cover.traffic.passages > 0 && (
                /*
                  🔴 The headline, above the km². A requirement can be written against "observed
                  traffic" and checked against it; it cannot be written against an area. Both
                  halves of this number already existed — the viewshed field and the recorded day —
                  and had never been multiplied together.
                */
                <div data-testid="twin3d-traffic"
                     style={{ background: "var(--mi-accent08)", border: "1px solid var(--mi-accent20)",
                              borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Vom aufgezeichneten Tag beobachtet
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2 }}>
                    <strong data-testid="twin3d-traffic-share"
                            style={{ fontSize: 25, color: "var(--mi-good)" }}>
                      {(cover.traffic.passageShare * 100).toFixed(0)} %
                    </strong>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      der Durchfahrten
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    <strong>{cover.traffic.observedPassages}</strong> von{" "}
                    {cover.traffic.passages} gesehen ·{" "}
                    <strong style={{ color: cover.traffic.missedPassages ? "var(--mi-warn)" : undefined }}>
                      {cover.traffic.missedPassages}
                    </strong>{" "}
                    verpasst
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>
                    {(cover.traffic.positionShare * 100).toFixed(0)} % aller Meldungen — also wie
                    durchgehend der Verkehr gehalten wird
                  </div>
                  <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 5, lineHeight: 1.45 }}>
                    Eine Fahrt gilt als beobachtet, sobald mindestens eine ihrer Positionen in
                    einer einsehbaren Zelle liegt. Gezählt werden nur <strong>Durchfahrten</strong>
                    {" "}— Fahrten über 0,5 km. Liegende Fahrzeuge senden den ganzen Tag und würden
                    sonst als verpasster Verkehr erscheinen. Fahrten, die das Gebiet nie erreichen,
                    zählen ebenfalls nicht mit. Gilt für die eingestellte <strong>Zielhöhe</strong>.
                  </div>
                </div>
              )}

              {scenario === "counterUas" && cover?.approach && cover.approach.bearings > 0 && (
                /*
                  🔴 The counter-UAS headline, and the counterpart to the traffic figure above.
                  There is no recorded drone traffic to measure against — inventing some would be
                  fabrication — so the threat is parametric: a target at the chosen height, on
                  every bearing, walking in. What is real is the terrain, the object and the
                  geometry between them.
                */
                <div data-testid="twin3d-approach"
                     style={{ background: "var(--mi-accent08)", border: "1px solid var(--mi-accent20)",
                              borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Anflüge auf {selected?.name ?? "das Schutzobjekt"}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 2 }}>
                    <strong data-testid="twin3d-approach-share"
                            style={{ fontSize: 25, color: "var(--mi-good)" }}>
                      {(cover.approach.share * 100).toFixed(0)} %
                    </strong>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      der Anflugrichtungen
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    <strong>{cover.approach.observedBearings}</strong> von{" "}
                    {cover.approach.bearings} erfasst ·{" "}
                    <strong style={{ color: cover.approach.missedBearings ? "var(--mi-warn)" : undefined }}>
                      {cover.approach.missedBearings}
                    </strong>{" "}
                    offen
                  </div>
                  {cover.approach.widestGapDeg > 0 && (
                    <div data-testid="twin3d-approach-gap"
                         style={{ fontSize: 12, opacity: 0.85, marginTop: 3 }}>
                      Größte zusammenhängende Lücke{" "}
                      <strong style={{ color: "var(--mi-warn)" }}>
                        {cover.approach.widestGapDeg.toFixed(0)}°
                      </strong>
                      {cover.approach.widestGapCentreDeg !== null && (
                        <> um {cover.approach.widestGapCentreDeg.toFixed(0)}°</>
                      )}
                    </div>
                  )}
                  {cover.approach.medianFirstSeenM !== null && (
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>
                      Erfassung im Median{" "}
                      <strong>
                        {(cover.approach.medianFirstSeenM / 1000).toFixed(1)} km
                      </strong>{" "}
                      vor dem Objekt — also wie viel Vorwarnzeit bleibt
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 5, lineHeight: 1.45 }}>
                    Eine Anflugrichtung gilt als erfasst, sobald das Ziel auf dem Weg nach innen
                    mindestens einmal in einer einsehbaren Zelle liegt. Richtungen, deren Anflug
                    überwiegend außerhalb des Modellgebiets liegt, zählen nicht mit. Gilt für die
                    eingestellte <strong>Flughöhe</strong>.
                  </div>
                </div>
              )}

              {scenario === "counterUas" && (
                /*
                  The altitude ladder — the number the scenario exists to produce. A site that
                  covers an approach at 300 m and not at 30 m has not covered the approach.
                */
                <div data-testid="twin3d-ladder"
                     style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    data-testid="twin3d-ladder-run"
                    onClick={runLadder}
                    disabled={ladderBusy}
                    style={{ background: "var(--mi-line07)", color: "var(--mi-text-muted)",
                             border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "5px 9px",
                             cursor: ladderBusy ? "wait" : "pointer", fontSize: 11.5 }}
                  >
                    {ladderBusy ? "rechnet …" : "Ab welcher Flughöhe schließt die Lücke?"}
                  </button>

                  {ladder && ladder.length > 0 && (() => {
                    const closes = ladder.find((r) => r.share >= 0.95);
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {ladder.map((rung) => (
                          <div key={rung.heightM}
                               style={{ display: "flex", alignItems: "center", gap: 6,
                                        fontSize: 11 }}>
                            <span style={{ width: 42, opacity: 0.75, textAlign: "right" }}>
                              {rung.heightM} m
                            </span>
                            <span style={{ flex: 1, height: 8, background: "var(--mi-line08)",
                                           borderRadius: 4, overflow: "hidden" }}>
                              <span style={{ display: "block", height: "100%",
                                             width: `${rung.share * 100}%`,
                                             background: rung.share >= 0.95 ? "var(--mi-good)"
                                               : rung.share >= 0.6 ? "var(--mi-accent)" : "var(--mi-warn)" }} />
                            </span>
                            <span style={{ width: 34, opacity: 0.8, textAlign: "right" }}>
                              {(rung.share * 100).toFixed(0)} %
                            </span>
                          </div>
                        ))}
                        <div data-testid="twin3d-ladder-verdict"
                             style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.45 }}>
                          {closes
                            ? <>Ab <strong style={{ color: "var(--mi-good)" }}>{closes.heightM} m</strong>{" "}
                                sind mindestens 95 % der Anflugrichtungen erfasst.</>
                            : <>Auch bei {ladder[ladder.length - 1].heightM} m bleiben Richtungen
                                offen — mit diesem Standort schließt sich die Lücke nicht. Mehr
                                Flughöhe hilft dann nicht weiter, ein höherer Sensor schon.</>}
                        </div>
                        <div style={{ fontSize: 10.5, opacity: 0.5, lineHeight: 1.4 }}>
                          Jede Stufe ist ein eigener Sichtbarkeitslauf mit reduzierter
                          Strahldichte — die Stufen sind untereinander vergleichbar, im Absolutwert
                          etwas gröber als die Anzeige oben.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {scenario === "maritime" && network && network.siteCount > 1
                && network.passages > 0 && (
                /*
                  🔴 The network argument, and the one figure a combined percentage cannot give:
                  what happens when a site is lost. A chain that observes 90 % of traffic but holds
                  most of it on a single mast is a different purchase from one that holds the same
                  90 % twice over, and only this panel tells them apart.
                */
                <div data-testid="twin3d-network"
                     style={{ background: "var(--mi-warn06)", border: "1px solid var(--mi-warn20)",
                              borderRadius: 6, padding: "9px 11px" }}>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>
                    Netz aus {network.siteCount} Standorten
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
                    Doppelt abgedeckt{" "}
                    <strong data-testid="twin3d-network-redundant" style={{ color: "var(--mi-good)" }}>
                      {(network.redundantShare * 100).toFixed(0)} %
                    </strong>{" "}
                    der Durchfahrten — bleibt bei Ausfall eines Standorts beobachtet
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                    Nur von einem Standort gehalten{" "}
                    <strong style={{ color: network.singleCoverPassages ? "var(--mi-warn)" : "var(--mi-good)" }}>
                      {network.singleCoverPassages}
                    </strong>{" "}
                    Fahrten
                  </div>
                  <div data-testid="twin3d-network-worst"
                       style={{ fontSize: 12, marginTop: 4, paddingTop: 4,
                                borderTop: "1px solid var(--mi-line10)" }}>
                    Schlechtester Einzelausfall:{" "}
                    <strong style={{ color: "var(--mi-warn)" }}>
                      −{(network.worstCaseLossShare * 100).toFixed(0)} %
                    </strong>{" "}
                    ({network.worstCaseLossPassages} Fahrten)
                  </div>
                  <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: 5, lineHeight: 1.45 }}>
                    „Exklusiv" in der Liste oben = Fahrten, die <strong>nur</strong> dieser
                    Standort sieht. Ein Standort mit 0 exklusiven Fahrten ist reine Redundanz —
                    das kann gewollt sein, sollte aber eine Entscheidung sein.
                  </div>
                </div>
              )}

              {siteList.length > 1 && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
                  <input data-testid="twin3d-overlap-toggle" type="checkbox" checked={overlapMode}
                         onChange={(e) => setOverlapMode(e.target.checked)} />
                  <span>
                    Überlappung zeigen — <span style={{ color: "var(--mi-good)" }}>grün</span> doppelt
                    gehalten, <span style={{ color: "var(--mi-warn)" }}>orange</span> nur ein Standort
                  </span>
                </label>
              )}

              {cover && (
                <div data-testid="twin3d-coverage"
                     style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.6 }}>
                  <div>Einsehbar <strong>{cover.visibleKm2.toFixed(1)} km²</strong></div>
                  <div>Abgeschattet <strong>{cover.shadowedKm2.toFixed(1)} km²</strong></div>
                  <div style={{ opacity: 0.7 }}>
                    Standort {cover.siteGroundM.toFixed(1)} m ü. NHN · Auge {cover.eyeM.toFixed(1)} m ·
                    Horizont {(cover.horizonM / 1000).toFixed(1)} km
                  </div>
                  <div style={{ opacity: 0.5 }}>
                    berechnet in {cover.elapsedMs.toFixed(0)} ms
                  </div>
                </div>
              )}

              {scenario === "maritime" && tracksMeta && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
                  <input data-testid="twin3d-gap-toggle" type="checkbox" checked={gapMode}
                         onChange={(e) => setGapMode(e.target.checked)} />
                  <span>Nur Verkehr <strong>außerhalb</strong> der modellierten Sicht</span>
                </label>
              )}

              {scenario === "maritime" && gapMode && (
                <p data-testid="twin3d-gap-caption"
                   style={{ margin: 0, fontSize: 11, lineHeight: 1.5, opacity: 0.75,
                            borderLeft: "2px solid var(--mi-warn-strong)", paddingLeft: 8 }}>
                  Eine Lücke ist <strong>kein unentdecktes Schiff</strong>. Sie ist eine Lücke:
                  Geländeabschattung, Empfangsreichweite, eine Antenne, ein Schalter oder eine
                  Meldepflicht, die für diese Schiffsklasse nicht gilt. Die App zeigt die Lücke und
                  deutet sie nicht.
                </p>
              )}

              {/*
                🔴 Procurement is comparative. A single configuration answers "is this any good",
                which is not the question anyone is actually asking.

                🔴 There are no euros here on purpose: mast cost depends on the customer's civil
                works and frame agreements, none of which is in any dataset this app has. Mast
                metres are the quantity their price list is applied to, and it is checkable.
              */}
              {scenario === "maritime" && (
                <div data-testid="twin3d-variants"
                     style={{ display: "flex", flexDirection: "column", gap: 6,
                              borderTop: "1px solid var(--mi-line13)", paddingTop: 9 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>Varianten</strong>
                    <button
                      data-testid="twin3d-variant-save"
                      onClick={saveVariant}
                      disabled={variants.length >= 3}
                      title="Aktuelle Konfiguration als Vergleichsvariante festhalten"
                      style={{ marginLeft: "auto", background: "var(--mi-line07)", color: "var(--mi-text-muted)",
                               border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "3px 9px",
                               cursor: variants.length >= 3 ? "not-allowed" : "pointer",
                               fontSize: 11, opacity: variants.length >= 3 ? 0.5 : 1 }}
                    >
                      als {String.fromCharCode(65 + variants.length)} sichern
                    </button>
                    {variants.length > 0 && (
                      <button
                        data-testid="twin3d-variant-clear"
                        onClick={() => setVariants([])}
                        title="Varianten verwerfen"
                        style={{ background: "transparent", color: "var(--mi-warn)", border: "none",
                                 cursor: "pointer", fontSize: 13, lineHeight: 1 }}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {variants.length === 0 ? (
                    <div style={{ fontSize: 10.5, opacity: 0.55, lineHeight: 1.4 }}>
                      Konfiguration sichern, etwas ändern, erneut sichern — dann steht der
                      Unterschied als Zahl da statt auf einem Zettel.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {variants.map((v, i) => {
                        const cost = variantCost(v);
                        const base = variants[0];
                        const delta = i > 0 ? compareVariants(base, v) : null;
                        return (
                          <div key={v.id} data-testid="twin3d-variant-row"
                               style={{ display: "flex", alignItems: "baseline", gap: 6,
                                        fontSize: 11.5, padding: "3px 5px", borderRadius: 5,
                                        background: i === 0 ? "var(--mi-line05)" : "transparent" }}>
                            <strong style={{ width: 12 }}>{v.id}</strong>
                            <span style={{ color: "var(--mi-good)", minWidth: 34 }}>
                              {(observedShare(v) * 100).toFixed(0)} %
                            </span>
                            <span style={{ opacity: 0.7, minWidth: 76 }}>
                              {cost.siteCount} × Mast · {cost.totalMastM} m
                            </span>
                            {delta && (
                              <span data-testid="twin3d-variant-delta"
                                    style={{ color: delta.observedPp > 0.5 ? "var(--mi-good)"
                                      : delta.observedPp < -0.5 ? "var(--mi-warn)" : undefined }}>
                                {delta.observedPp >= 0 ? "+" : ""}{delta.observedPp.toFixed(0)} pp
                                <span style={{ opacity: 0.7, color: "var(--mi-text-muted)" }}>
                                  {" "}bei {delta.totalMastM >= 0 ? "+" : ""}{delta.totalMastM} m
                                </span>
                              </span>
                            )}
                            <button
                              onClick={() => restoreVariant(v)}
                              title="Diese Variante wiederherstellen"
                              style={{ marginLeft: "auto", background: "transparent",
                                       border: "none", color: "var(--mi-accent)", cursor: "pointer",
                                       fontSize: 11 }}
                            >
                              laden
                            </button>
                          </div>
                        );
                      })}

                      {variants.length > 1 && (
                        <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 3,
                                      lineHeight: 1.45 }}>
                          Bezug ist Variante A. <strong>pp</strong> = Prozentpunkte, nicht Prozent.
                          Beste Ausbeute je Mastmeter:{" "}
                          <strong style={{ color: "var(--mi-good)" }}>
                            {variants.reduce((best, v) =>
                              ppPerMastMetre(v) > ppPerMastMetre(best) ? v : best).id}
                          </strong>
                          . Preise sind bewusst nicht enthalten — Maststrecke ist die Größe, auf
                          die Ihre Preisliste angewandt wird.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/*
                🔴 The artefact that outlives the meeting. Everything on this panel disappears when
                the tab closes, and the people who decide were usually not in the room.
              */}
              <button
                data-testid="twin3d-export"
                onClick={exportReport}
                title="Konfiguration, Messwerte, verpasste Fahrten und Vorbehalte als HTML — im Browser als PDF druckbar"
                style={{ background: "var(--mi-accent13)", color: "var(--mi-text)", border: "1px solid var(--mi-accent33)",
                         borderRadius: 6, padding: "7px 10px", cursor: "pointer", fontSize: 12 }}
              >
                Bericht exportieren
              </button>
              <div style={{ fontSize: 10.5, opacity: 0.55, marginTop: -4, lineHeight: 1.4 }}>
                Eigenständige HTML-Datei mit Konfiguration, Zahlen, den nicht beobachteten Fahrten
                und allen Vorbehalten. Im Browser als PDF druckbar.
              </div>

              {/*
                🔴 The same idea as the export, one step further: the annex travels to people, a
                committed plan travels to the customer's own estate. Renders nothing when no
                write-back backend is configured, so a build without one is unchanged.
              */}
              <PlansPanel
                aoi={aoi.id}
                report={handleRef.current?.reportData() ?? null}
                onRestore={(restored) => {
                  handleRef.current?.applySites(restored);
                  syncNetwork();
                }}
              />
            </>
          )}

          {/*
            🔴 The credible AI moment, and it is honest AI: a search over a solver that is already
            pinned by tests, whose every step reads as one sentence — this mast adds these N
            transits. Placement today is expert intuition defended after the fact.

            ⚠️ It renders **whether or not a site has been placed**, and that is the correction.
            It used to live inside the "a site exists" branch, so the one feature that can answer
            *"where should these go?"* was only offered to someone who had already answered it.
            With nothing placed it now proposes from scratch, and applying the proposal is how the
            first masts get onto the map.

            It also carries its own mast height. Without a site there is no mast slider on screen,
            so the height the search assumes has to be visible and adjustable right here — asking
            for "the best places" without saying how tall is a question with no answer.
          */}
          {scenario === "maritime" && (
            <div data-testid="twin3d-optimise"
                 style={{ display: "flex", flexDirection: "column", gap: 6,
                          borderTop: "1px solid var(--mi-line13)", paddingTop: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>Beste Plätze für</span>
                <select
                  data-testid="twin3d-optimise-count"
                  value={optimiseCount}
                  onChange={(e) => setOptimiseCount(Number(e.target.value))}
                  disabled={optimising}
                  style={{ background: "var(--mi-bg)", color: "var(--mi-text)", fontSize: 12,
                           border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "3px 5px" }}
                >
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span style={{ fontSize: 12, opacity: 0.85 }}>Masten à</span>
                <select
                  data-testid="twin3d-optimise-mast"
                  value={optimiseMastM}
                  onChange={(e) => setOptimiseMastM(Number(e.target.value))}
                  disabled={optimising}
                  style={{ background: "var(--mi-bg)", color: "var(--mi-text)", fontSize: 12,
                           border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "3px 5px" }}
                >
                  {[5, 10, 15, 25, 40, 60, 80, 120].map((n) => (
                    <option key={n} value={n}>{n} m</option>
                  ))}
                </select>
              </div>

              <button
                data-testid="twin3d-optimise-run"
                onClick={optimising ? () => { cancelOptimise.current = true; } : runOptimise}
                style={{ background: "var(--mi-accent13)", color: "var(--mi-text)",
                         border: "1px solid var(--mi-accent33)", borderRadius: 6, padding: "6px 10px",
                         cursor: "pointer", fontSize: 12 }}
              >
                {optimising
                  ? `sucht … ${(optimiseProgress * 100).toFixed(0)} % — abbrechen`
                  : sitePlaced ? "Standorte vorschlagen" : "Standorte vorschlagen lassen"}
              </button>

              {optimising && (
                <span style={{ height: 4, background: "var(--mi-line08)", borderRadius: 2,
                               overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%",
                                 width: `${optimiseProgress * 100}%`, background: "var(--mi-accent)" }} />
                </span>
              )}

              {!sitePlaced && !optimiseResult && !optimising && (
                <div style={{ fontSize: 10.5, opacity: 0.55, lineHeight: 1.45 }}>
                  Sucht die Positionen, die von den aufgezeichneten Durchfahrten am meisten sehen —
                  ohne dass vorher ein Standort gesetzt sein muss.
                </div>
              )}

              {optimiseResult && (() => {
                const best = optimiseResult.picks.length
                  ? optimiseResult.picks[optimiseResult.picks.length - 1].cumulative : 0;
                const share = optimiseResult.transits ? best / optimiseResult.transits : 0;
                const currentShare = optimiseResult.transits
                  ? optimiseResult.currentCovered / optimiseResult.transits : 0;
                const delta = share - currentShare;
                return (
                  <div data-testid="twin3d-optimise-result"
                       style={{ background: "var(--mi-accent08)", border: "1px solid var(--mi-accent20)",
                                borderRadius: 6, padding: "8px 10px",
                                display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 12 }}>
                      Vorschlag{" "}
                      <strong data-testid="twin3d-optimise-share"
                              style={{ color: "var(--mi-good)", fontSize: 15 }}>
                        {(share * 100).toFixed(0)} %
                      </strong>{" "}
                      der Durchfahrten
                      {optimiseResult.currentSites > 0 && (
                        <>
                          {" · aktuell "}
                          <strong>{(currentShare * 100).toFixed(0)} %</strong>
                          {" "}
                          <strong style={{ color: delta > 0.005 ? "var(--mi-good)"
                            : delta < -0.005 ? "var(--mi-warn)" : undefined }}>
                            ({delta >= 0 ? "+" : ""}{(delta * 100).toFixed(0)} pp)
                          </strong>
                        </>
                      )}
                    </div>

                    {optimiseResult.picks.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, opacity: 0.85 }}>
                        {i + 1}. {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                        <span style={{ opacity: 0.7 }}> · {p.groundM.toFixed(0)} m ü. NHN</span>
                        <span style={{ color: "var(--mi-good)" }}> · +{p.newlyCovered}</span>
                      </div>
                    ))}

                    {optimiseResult.picks.length < optimiseCount && (
                      <div style={{ fontSize: 11, color: "var(--mi-warn)" }}>
                        Nur {optimiseResult.picks.length} Mast
                        {optimiseResult.picks.length === 1 ? "" : "en"} sinnvoll — weitere
                        würden nichts abdecken, was die ersten nicht schon sehen.
                      </div>
                    )}

                    <button
                      data-testid="twin3d-optimise-apply"
                      onClick={applyOptimised}
                      style={{ background: "var(--mi-good13)", color: "var(--mi-text-muted)",
                               border: "1px solid var(--mi-good33)", borderRadius: 6,
                               padding: "5px 9px", cursor: "pointer", fontSize: 11.5 }}
                    >
                      {sitePlaced ? "Vorschlag übernehmen" : "Vorschlag als Standorte setzen"}
                    </button>

                    <div style={{ fontSize: 10.5, opacity: 0.55, lineHeight: 1.45 }}>
                      Greedy-Suche über {optimiseResult.candidatesTried} Landpositionen im
                      Raster von {optimiseResult.candidateSpacingM} m, Masthöhe{" "}
                      {optimiseResult.mastM} m. Nachweislich nahe am Optimum
                      (1−1/e), aber <strong>nicht garantiert optimal</strong> — und nur so fein
                      wie das Raster.
                      <br />
                      Gezählt werden <strong>{optimiseResult.transits} Durchfahrten</strong>,
                      also Fahrten über 0,5 km — dieselbe Grundlage wie die Quote oben.
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <p data-testid="twin3d-model-notice"
             style={{ margin: 0, fontSize: 11, lineHeight: 1.5, opacity: 0.7,
                      borderTop: "1px solid var(--mi-line13)", paddingTop: 8 }}>
            <strong>Geometrie, kein Radarmodell.</strong> Sichtlinie gegen ein gemessenes
            Geländemodell bei Standardrefraktion (4/3-Erdradius). Ohne Rückstreuquerschnitt,
            Seegangsclutter, Mehrwegeausbreitung, Ducting oder Entdeckungswahrscheinlichkeit.
            Standorte sind frei gesetzt und <strong>fiktiv</strong>.
            <br /><br />
            {/*
              🔴 Read from the blocking surface's own descriptor, never written here. These two
              sentences used to be literals quoting the first AOI's vegetation figures — which the
              second site displayed verbatim while its surface carried no vegetation at all: a
              precise, confident and entirely false claim about the ground on screen.
            */}
            {losMeta?.includesVegetation && losMeta.vegetationStats ? (
              <>
                Berücksichtigt Gelände, Gebäude <strong>und Bewuchs</strong> (bDOM 20 cm, auf das
                4-m-Raster per Blockmaximum reduziert). Der Bewuchs hebt{" "}
                {(losMeta.vegetationStats.cellsRaised / 1e6).toLocaleString("de-DE",
                  { maximumFractionDigits: 1 })} Mio. Zellen über die Gebäudehöhe hinaus an, im
                Median um {losMeta.vegetationStats.medianLiftM.toLocaleString("de-DE")} m, im
                90. Perzentil um {losMeta.vegetationStats.p90LiftM.toLocaleString("de-DE")} m.
                Über Wasser wird die gemessene Oberfläche bewusst verworfen — dort liefert das
                Bildmatching Wellentextur, und ein Phantomhindernis auf dem Wasser würde jede Zahl
                verfälschen.
              </>
            ) : (
              <>
                Berücksichtigt Gelände und Gebäude, <strong>keine Vegetation</strong>. Die
                angezeigte Sicht ist daher eine <strong>Obergrenze</strong>: Bewuchs kann
                Sichtlinien nur zusätzlich blockieren, nie freigeben.
              </>
            )}
          </p>
        </aside>
      )}

      {/*
        Right-hand column. The drone HUD and the vessel panel both want the top-right corner, so
        they share one stack rather than two absolute anchors — the same fix the bottom bars
        needed, applied before it could bite a second time.
      */}
      <div data-testid="twin3d-right-stack"
           style={{ position: "absolute", top: 56, right: 16, width: 320, display: "flex",
                    flexDirection: "column", gap: 10, alignItems: "flex-end",
                    pointerEvents: "none" }}>

      {/*
        ⚠️ `order: 3` puts the assistant below the drone HUD (1) and the vessel panel (2), and it
        joins the same stack rather than taking its own absolute anchor — the third panel to want
        this corner, and the reason the stack exists at all. It renders nothing when no backend is
        configured, so a build without one is unchanged.
      */}
      {ready && <ChatPanel getView={assistantView} />}


      {ready && vessel && (() => {
        const cls = vesselClass(vessel.type);
        const durationMin = Math.round((vessel.toS - vessel.fromS) / 60);
        return (
          <aside data-testid="twin3d-vessel"
                 style={{ order: 2, width: "100%", padding: "14px 16px",
                          background: "var(--mi-panel-strong)", borderRadius: 8,
                          fontSize: 13, display: "flex", flexDirection: "column", gap: 10,
                          pointerEvents: "auto" }}>
            {/*
              ⚠️ The name leads, the class follows. When there is no name the class leads instead —
              a header reading "—" would suggest the vessel is unidentified rather than that this
              particular hull never transmitted a static report.
            */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}
                      data-testid="twin3d-vessel-name"
                      title={vessel.name ?? cls.label}>
                {vessel.name ?? cls.label}
              </strong>
              <span style={{ opacity: 0.5, fontSize: 11, whiteSpace: "nowrap" }}
                    data-testid="twin3d-vessel-class">
                {vessel.name ? cls.label : vessel.type}
              </span>
              <button
                data-testid="twin3d-vessel-close"
                onClick={clearVessel}
                title="Auswahl aufheben (Esc)"
                style={{ marginLeft: "auto", background: "var(--mi-line07)", color: "var(--mi-text-muted)",
                         border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "2px 8px",
                         cursor: "pointer", fontSize: 11 }}
              >
                Schließen
              </button>
            </div>

            {/* A silhouette of the CLASS. There is no photograph of this vessel to show, and the
                note at the bottom says why rather than leaving the reader to assume. */}
            <svg viewBox="0 0 120 44" width="100%" height="72" role="img"
                 aria-label={`Silhouette: ${cls.label}`}
                 style={{ background: "var(--mi-bg)", borderRadius: 6 }}>
              <path d="M0 34 H120" stroke="var(--mi-accent27)" strokeWidth="1" fill="none" />
              <path d={cls.silhouette} fill="var(--mi-text-muted)" />
            </svg>

            <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.85 }}>{cls.description}</p>

            {/*
              Identity as transmitted, kept in its own block above the derived facts so the two are
              never confused. Everything here came off the air from the vessel itself; everything
              below it was computed from the track. A row is omitted rather than shown empty — AIS
              sends static data every few minutes against a position every few seconds, so "no
              destination" usually means "not received in this passage", not "none".
            */}
            {(vessel.mmsi || vessel.callSign || vessel.imo || vessel.destination
              || vessel.lengthM || vessel.draughtM) && (
              <div data-testid="twin3d-vessel-identity"
                   style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12,
                            rowGap: 3, fontSize: 12, fontVariantNumeric: "tabular-nums",
                            background: "var(--mi-accent06)", border: "1px solid var(--mi-accent20)",
                            borderRadius: 6, padding: "7px 9px" }}>
                {vessel.mmsi && (<>
                  <span style={{ opacity: 0.6 }}>MMSI</span>
                  <span style={{ textAlign: "right" }}>{vessel.mmsi}</span>
                </>)}
                {vessel.callSign && (<>
                  <span style={{ opacity: 0.6 }}>Rufzeichen</span>
                  <span style={{ textAlign: "right" }}>{vessel.callSign}</span>
                </>)}
                {vessel.imo && (<>
                  <span style={{ opacity: 0.6 }}>IMO</span>
                  <span style={{ textAlign: "right" }}>{vessel.imo}</span>
                </>)}
                {vessel.destination && (<>
                  <span style={{ opacity: 0.6 }}>Ziel laut AIS</span>
                  <span style={{ textAlign: "right", overflow: "hidden",
                                 textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={vessel.destination}>{vessel.destination}</span>
                </>)}
                {vessel.lengthM && (<>
                  <span style={{ opacity: 0.6 }}>Länge × Breite</span>
                  <span style={{ textAlign: "right" }}>
                    {vessel.lengthM} m{vessel.beamM ? ` × ${vessel.beamM} m` : ""}
                  </span>
                </>)}
                {vessel.draughtM && (<>
                  <span style={{ opacity: 0.6 }}>Tiefgang</span>
                  <span style={{ textAlign: "right" }}>{vessel.draughtM} m</span>
                </>)}
              </div>
            )}

            <div data-testid="twin3d-vessel-facts"
                 style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12,
                          rowGap: 3, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ opacity: 0.6 }}>{vessel.mmsi ? "Fahrt-Nr." : "Fahrt"}</span>
              <span style={{ textAlign: "right" }}>{vessel.vessel}</span>
              <span style={{ opacity: 0.6 }}>Geschwindigkeit</span>
              <span style={{ textAlign: "right" }}>
                {vessel.speedKn.toFixed(1)} kn
              </span>
              <span style={{ opacity: 0.6 }}>Kurs</span>
              <span style={{ textAlign: "right" }}>
                {vessel.courseDeg === null
                  ? "—"
                  : `${String(Math.round(vessel.courseDeg)).padStart(3, "0")}°`}
              </span>
              <span style={{ opacity: 0.6 }}>Position</span>
              <span style={{ textAlign: "right" }}>
                {vessel.lat.toFixed(4)}° N  {vessel.lon.toFixed(4)}° E
              </span>
              <span style={{ opacity: 0.6 }}>Im Gebiet</span>
              <span style={{ textAlign: "right" }}>
                {clock(vessel.fromS)}–{clock(vessel.toS)} ({durationMin} min)
              </span>
              <span style={{ opacity: 0.6 }}>Zurückgelegt</span>
              <span style={{ textAlign: "right" }}>{vessel.distanceKm.toFixed(1)} km</span>
              <span style={{ opacity: 0.6 }}>Ø / max Fahrt</span>
              <span style={{ textAlign: "right" }}>
                {vessel.avgSpeedKn.toFixed(1)} / {vessel.maxSpeedKn.toFixed(1)} kn
              </span>
              {vessel.stoppedShare > 0.02 && (
                <>
                  <span style={{ opacity: 0.6 }}>Davon stillliegend</span>
                  <span style={{ textAlign: "right" }}>
                    {(vessel.stoppedShare * 100).toFixed(0)} %
                  </span>
                </>
              )}
              <span style={{ opacity: 0.6 }}>AIS-Meldungen</span>
              <span style={{ textAlign: "right" }}>
                {vessel.reportCount}
                {vessel.medianReportGapS !== null
                  ? ` · alle ${vessel.medianReportGapS < 60
                      ? `${Math.round(vessel.medianReportGapS)} s`
                      : `${Math.round(vessel.medianReportGapS / 60)} min`}`
                  : ""}
              </span>
              <span style={{ opacity: 0.6 }}>Typische Länge</span>
              <span style={{ textAlign: "right" }}>{cls.typicalLength}</span>
            </div>

            {vessel.observed && (
              /*
                The per-vessel view of the fleet figure in the Sichtbarkeit panel. This is what
                makes "84 % beobachtet" interrogable rather than merely quotable: click the ones
                that were missed and see where they actually went.
              */
              <div data-testid="twin3d-vessel-observed"
                   style={{ fontSize: 11.5, lineHeight: 1.5, borderRadius: 6, padding: "7px 9px",
                            background: vessel.observed.seen ? "var(--mi-good09)" : "var(--mi-warn09)",
                            border: `1px solid ${vessel.observed.seen ? "var(--mi-good27)" : "var(--mi-warn27)"}` }}>
                <strong style={{ color: vessel.observed.seen ? "var(--mi-good)" : "var(--mi-warn)" }}>
                  {vessel.observed.seen ? "Vom Standort beobachtet" : "Vom Standort nicht gesehen"}
                </strong>
                {vessel.observed.seen && (
                  <span style={{ opacity: 0.75 }}>
                    {" "}— {(vessel.observed.share * 100).toFixed(0)} % der Fahrt einsehbar
                  </span>
                )}
              </div>
            )}

            {!vessel.underWay && (
              <p style={{ margin: 0, fontSize: 11, opacity: 0.7, lineHeight: 1.5 }}>
                Zu dieser Uhrzeit nicht unterwegs — die Werte oben gelten für den
                <strong> angeklickten Punkt der Fahrtspur</strong>. Zum Mitfahren die Zeitleiste
                auf {clock(vessel.fromS)}–{clock(vessel.toS)} stellen.
              </p>
            )}

            {/*
              🔴 The note now says what the build actually does, and it changes with the build.
              An app that carries a name while printing "no name, deliberately" is worse than one
              that does neither: the reader stops believing the other notices too.
            */}
            <p data-testid="twin3d-vessel-privacy"
               style={{ margin: 0, fontSize: 11, lineHeight: 1.5, opacity: 0.7,
                        borderTop: "1px solid var(--mi-line13)", paddingTop: 8 }}>
              {vessel.mmsi ? (
                <>
                  <strong>Kennung wie gesendet.</strong> MMSI, Name, Rufzeichen, IMO und Ziel
                  werden von jedem Schiff offen ausgestrahlt und vom dänischen Seeamt frei
                  veröffentlicht — diese App gibt sie unverändert wieder.{" "}
                  {vessel.name && (
                    <a
                      data-testid="twin3d-vessel-verify"
                      href={`https://www.marinetraffic.com/en/ais/index/search/all?keyword=${
                        encodeURIComponent(vessel.mmsi)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--mi-accent)", textDecoration: "none" }}
                    >
                      {vessel.name} extern prüfen ↗
                    </a>
                  )}
                  {" "}Silhouette und Beschreibung zeigen weiterhin die <strong>Klasse</strong>,
                  nicht diesen Rumpf.
                </>
              ) : (
                <>
                  <strong>Für dieses Schiff liegt keine Kennung vor.</strong> AIS sendet Name und
                  MMSI in einer eigenen Statusmeldung alle paar Minuten, Positionen dagegen im
                  Sekundentakt — wird die Statusmeldung im Modellgebiet nie empfangen, bleibt die
                  Fahrt unbenannt. „Fahrt“ ist dann ein Code, der nur innerhalb dieses Tages zwei
                  Schiffe unterscheidet.
                </>
              )}
            </p>
          </aside>
        );
      })()}


      {ready && (
        <div data-testid="twin3d-drone-controls"
             data-flying={droneMode ? "true" : "false"}
             /*
               ⚠️ `pointerEvents: none` here is deliberate — the column is full-height and a solid
               one would swallow every drag aimed at the fjord behind it. It is also INHERITED, so
               anything in here that is meant to be clicked has to say `pointerEvents: "auto"` for
               itself. Both buttons below once forgot, and were dead for it: the click fell through
               to the canvas, which ignores clicks in drone mode, so nothing happened at all and
               nothing said why. Same rule as the vessel panel and the replay bar.
             */
             style={{ order: 1, display: "flex", flexDirection: "column", gap: 8,
                      alignItems: "flex-end", pointerEvents: "none" }}>
          {/*
            ⚠️ This was a toggle button and deliberately is not one any more. The camera and the map
            are one mode: W A S D takes the camera, Escape or a second of stillness gives it
            back, and while it is theirs the wheel is a throttle rather than the map zoom and a
            drag looks rather than orbits.

            The line stays because a button is not what it was for. Nothing else on the page says
            the keys exist, and nothing else says which of those two behaviours the mouse currently
            has — and a mode that is never mentioned is a mode the viewer discovers by being
            confused.
          */}
          {!droneMode && (
            <div
              data-testid="twin3d-drone-hint"
              style={{ background: "var(--mi-panel-strong)", color: "var(--mi-text-faint)",
                       border: "1px solid var(--mi-line20)", borderRadius: 6,
                       padding: "7px 13px", fontSize: 13 }}
            >
              W A S D drücken zum Fliegen
            </div>
          )}

          {droneMode && hud && (
            <div data-testid="twin3d-drone-hud"
                 style={{ background: "var(--mi-panel-strong)", borderRadius: 8, padding: "10px 14px",
                          fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 186 }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12,
                            rowGap: 3 }}>
                <span style={{ opacity: 0.6 }}>Höhe</span>
                <span style={{ textAlign: "right" }}>{Math.round(hud.altitudeM)} m</span>
                <span style={{ opacity: 0.6 }}>über Grund</span>
                <span style={{ textAlign: "right",
                               color: hud.aglM !== null && hud.aglM < 0 ? "var(--mi-warn)" : undefined }}>
                  {hud.aglM === null ? "—" : `${Math.round(hud.aglM)} m`}
                </span>
                <span style={{ opacity: 0.6 }}>Fahrt</span>
                <span style={{ textAlign: "right" }}>{Math.round(hud.speedMs * 3.6)} km/h</span>
                <span style={{ opacity: 0.6 }}>Kurs</span>
                <span style={{ textAlign: "right" }}>
                  {String(Math.round(hud.headingDeg)).padStart(3, "0")}°
                </span>
              </div>

              {/* The throttle as a bar rather than a number: its absolute value means nothing to
                  anyone, but where it sits in its range is exactly what you want to know. */}
              <div style={{ marginTop: 7, height: 2, background: "var(--mi-line13)" }}>
                <div style={{ height: 2, background: "var(--mi-accent)",
                              width: `${Math.round(hud.cruise * 100)}%` }} />
              </div>

              {hudCoverage && (
                <div data-testid="twin3d-drone-coverage"
                     style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid var(--mi-line13)",
                              fontSize: 11 }}>
                  <span style={{ opacity: 0.6 }}>Vom Standort </span>
                  <strong style={{ color: hudCoverage === "visible" ? "var(--mi-good)" : "var(--mi-warn)" }}>
                    {hudCoverage === "visible" ? "einsehbar" : "abgeschattet"}
                  </strong>
                  {/*
                    Naming the height matters: the panel on the left carries a Zielhöhe slider, and
                    without this the reader has every reason to assume this line follows it. It
                    does not — it is a line of sight to the camera itself.
                  */}
                  <span style={{ opacity: 0.6 }}> auf {Math.round(hud.altitudeM)} m</span>
                </div>
              )}

              <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid var(--mi-line13)",
                            fontSize: 10.5, opacity: 0.6, lineHeight: 1.5 }}>
                W A S D fliegen · Q E steigen/sinken · R F um die Bildmitte kreisen ·
                Shift schnell · ziehen zum Umsehen · Mausrad Reisegeschwindigkeit
              </div>
            </div>
          )}

          {droneMode && sitePlaced && (
            <button
              data-testid="twin3d-fly-to-mast"
              onClick={() => handleRef.current?.flyToMast()}
              style={{ background: "var(--mi-panel-strong)", color: "var(--mi-text-muted)", border: "1px solid var(--mi-accent20)",
                       borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12,
                       pointerEvents: "auto" }}
            >
              Auf Mastspitze
            </button>
          )}

          {droneMode && (
            <button
              data-testid="twin3d-site-here"
              onClick={() => {
                if (handleRef.current?.placeSiteAtCamera()) {
                  syncNetwork();
                }
              }}
              style={{ background: "var(--mi-panel-strong)", color: "var(--mi-text-muted)", border: "1px solid var(--mi-accent20)",
                       borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12,
                       pointerEvents: "auto" }}
            >
              Standort hier setzen
            </button>
          )}
        </div>
      )}

      </div>

      {/*
        🔴 One bottom stack, not three absolutely-positioned bars.

        The live bar, the story beats and the replay scrubber were each anchored to their own
        `bottom` offset, 4 px apart. That held only while every bar stayed one line high — and the
        "Kein Relay erreichbar" explanation wraps to three, so it grew upwards straight through the
        beat buttons. Hand-tuned offsets cannot survive variable-height content; a flex column
        makes the overlap impossible instead of merely unlikely.
      */}
      <div data-testid="twin3d-bottom-stack"
           style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex",
                    flexDirection: "column", alignItems: "center", gap: 8,
                    pointerEvents: "none" }}>

      {ready && tracksMeta && replayDriving && (
        <div data-testid="twin3d-replay"
             style={{ order: 3, display: "flex", justifyContent: "center",
                      pointerEvents: "none" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", pointerEvents: "auto",
                        background: "var(--mi-panel-soft)", padding: "10px 16px", borderRadius: 8,
                        width: "min(760px, 92vw)" }}>
            <button
              data-testid="twin3d-play"
              onClick={() => setPlaying((p) => !p)}
              aria-pressed={playing}
              aria-keyshortcuts="Enter"
              title={`${playing ? "Pause" : "Wiedergabe"} — oder Eingabetaste`}
              style={{ background: "var(--mi-accent13)", color: "var(--mi-text)", border: "1px solid var(--mi-accent33)",
                       borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span data-testid="twin3d-clock"
                  style={{ fontVariantNumeric: "tabular-nums", fontSize: 15, minWidth: 52 }}>
              {clock(now)}
            </span>
            <input
              data-testid="twin3d-scrubber"
              type="range"
              min={0}
              max={DAY_S - 1}
              step={60}
              value={Math.round(now)}
              onChange={(event) => scrub(Number(event.target.value))}
              style={{ flex: 1 }}
            />
            <span data-testid="twin3d-vessels"
                  style={{ fontSize: 12, opacity: 0.75, minWidth: 132, textAlign: "right" }}>
              {vessels} Schiffe unterwegs
            </span>
          </div>
        </div>
      )}

      {ready && showVessels && (
        <div data-testid="twin3d-live"
             style={{ order: 1, display: "flex", justifyContent: "center",
                      pointerEvents: "none" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", pointerEvents: "auto",
                        background: "var(--mi-panel-soft)", padding: "8px 14px", borderRadius: 8,
                        fontSize: 12, maxWidth: "min(760px, 92vw)" }}>
            <button
              data-testid="twin3d-live-toggle"
              onClick={() => setLiveWanted((on) => !on)}
              aria-pressed={liveWanted}
              style={{ background: liveWanted ? "var(--mi-accent20)" : "var(--mi-line07)", color: "var(--mi-text)",
                       border: `1px solid ${liveWanted ? "var(--mi-accent)" : "var(--mi-line20)"}`,
                       borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}
            >
              {liveWanted ? "Live" : "Aufzeichnung"}
            </button>

            {!liveWanted && (
              <span style={{ opacity: 0.7 }}>
                Aufgezeichneter Tag {tracksMeta?.date}
              </span>
            )}

            {liveWanted && liveState === "connecting" && (
              <span data-testid="twin3d-live-state" style={{ opacity: 0.75 }}>
                Verbinde mit Relay …
              </span>
            )}

            {liveWanted && liveState === "unavailable" && (
              // Kept to one line. The full explanation lives in the tooltip: the fallback is a
              // normal operating state, and a three-line paragraph shouting about it every time
              // was both wrong in tone and the thing that made this bar tall enough to collide
              // with the controls above it.
              <span data-testid="twin3d-live-state"
                    title={"Die Live-Quelle lässt keine Direktverbindung aus dem Browser zu; "
                           + "sie läuft über einen eigenen Relay-Prozess (server/ais/relay.js). "
                           + "Ohne ihn bleibt die Aufzeichnung aktiv — ein regulärer "
                           + "Betriebszustand, kein Fehler."}
                    style={{ whiteSpace: "nowrap" }}>
                <strong style={{ color: "var(--mi-warn)" }}>Kein Relay erreichbar</strong>
                <span style={{ opacity: 0.7 }}> — Aufzeichnung bleibt aktiv</span>
              </span>
            )}

            {liveWanted && liveState === "open" && (() => {
              /*
                🔴 This block used to read `{liveStatus?.vessels ?? 0} Schiffe`, and it was wrong
                twice over. It quoted the RELAY's count — the whole coarse shell box, several
                hundred vessels — as though it described the modelled water; and when the upstream
                had sent nothing at all it rendered "0 Schiffe", which is a claim about the Kieler
                Förde produced by a feed that had said nothing about anywhere. Measured on the
                deployed relay: socket open, subscription accepted, `messages: 0` after ten
                minutes. Same rule as the coverage field — *not observed* is not *not there*.
              */
              const feed = describeLiveFeed(liveStatus ?? null, liveList.length);
              const colour = feed.warn ? "var(--mi-warn)" : "var(--mi-good)";
              return (
                <span data-testid="twin3d-live-state"
                      data-feed-kind={feed.kind}
                      title={feed.detail}
                      style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: colour }}>●</span>
                  <span data-testid="twin3d-live-vessels"
                        style={{ color: feed.warn ? colour : undefined,
                                 fontWeight: feed.warn ? 600 : undefined }}>
                    {feed.headline}
                  </span>
                  {!feed.warn && (
                    <span style={{ opacity: 0.55 }}>
                      {livePoints.toLocaleString("de-DE")} Positionen
                    </span>
                  )}
                  {liveOutsideCount > 0 && !feed.warn && (
                    <span style={{ opacity: 0.55 }}>
                      +{liveOutsideCount} außerhalb
                    </span>
                  )}
                  {feed.warn && (
                    <span data-testid="twin3d-live-synthetic"
                          style={{ opacity: 0.75, maxWidth: 460, whiteSpace: "nowrap",
                                   overflow: "hidden", textOverflow: "ellipsis" }}>
                      {feed.detail}
                    </span>
                  )}
                  {/*
                    🔴 "There are ships" and "I can see them" are different things. The default
                    camera sits about 9 km back, where a vessel marker is a few pixels, so the
                    first reaction to switching Live on was that nothing had happened. This flies
                    to the median vessel — see `focusOnTraffic`, which deliberately avoids the
                    centroid.
                  */}
                  {liveList.length > 0 && (
                    <button data-testid="twin3d-live-focus"
                            onClick={() => handleRef.current?.focusOnTraffic()}
                            style={{ pointerEvents: "auto" }}
                            title="Kamera auf die Schiffe richten, die gerade gemeldet werden">
                      Schiffe zeigen
                    </button>
                  )}
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {ready && beats.length > 0 && replayDriving && (
        <div data-testid="twin3d-beats"
             style={{ order: 2, display: "flex", justifyContent: "center", gap: 8,
                      pointerEvents: "none" }}>
          {beats.map((beat) => (
            <button
              key={beat.label}
              data-testid="twin3d-beat"
              onClick={() => scrub(beat.atS)}
              title={`${beat.vessels} Schiffe`}
              style={{ pointerEvents: "auto", background: "var(--mi-panel-soft)", color: "var(--mi-text-muted)",
                       border: "1px solid var(--mi-accent20)", borderRadius: 999, padding: "5px 12px",
                       cursor: "pointer", fontSize: 12 }}
            >
              {beat.label}
            </button>
          ))}
        </div>
      )}

      {/*
        Part of the stack, not floating over it. Anchoring the footer separately left it 11 px
        under the scrubber — the same class of bug as the beats collision, and found only because
        the check measured rectangles instead of trusting the screenshot.
      */}
      <footer data-testid="twin3d-notice"
              style={{ order: 4, alignSelf: "stretch", padding: "8px 16px",
                       fontSize: 11, lineHeight: 1.5, opacity: 0.65,
                       background: "linear-gradient(var(--mi-bg-clear), var(--mi-bg-fade))" }}>
        Demonstrations- und Anschauungszweck. Keine Navigationsgrundlage und keine verbindliche
        Verkehrs- oder Seeraumauskunft. Gelände unverzerrt dargestellt, ohne Überhöhung.
        {geobasis && <> · {geobasis.core}</>}
        {geobasis?.shell && <> · {geobasis.shell}</>}
        {/*
          🔴 Attribution has to name the source that is actually on screen. Crediting the recorded
          day while the relay is feeding the scene happened to be true only because the relay was
          replaying that same day — with a real upstream it would have credited the wrong provider
          on a permanent notice, which is the kind of quiet error NOTICE.md exists to prevent.

          ⚠️ Three source states, not two. A relay started in replay mode and a live relay whose
          recording has STOOD IN for a mute upstream are different sentences, and the second one
          used to fall through to `status.source` — which is the internal enum, so the footer read
          "Quelle replay": an untranslated code token presented to the reader as attribution.
        */}
        {liveState === "open" && liveStatus ? (
          <> · AIS-Daten live über eigenen Relay-Prozess, Quelle{" "}
            <strong>{liveStatus.mode === "replay"
              ? "aufgezeichneter Tag (Relay im Wiedergabemodus)"
              : liveStatus.fallback
                ? "aufgezeichneter Tag (Ersatz für die ausgefallene Live-Quelle)"
                : liveStatus.source ?? "aisstream.io"}</strong>{" "}
            {/*
              🔴 The identity claim BRANCHES, because the recording carries invented MMSIs
              (900000000 + index — see `startReplay` in the relay). "Kennungen wie gesendet" while a
              recording is on air is simply false, and a footer that states a falsehood about its own
              data discredits the true caveats standing next to it.
            */}
            — Kennungen {hasSyntheticIdentity(liveStatus) ? "synthetisch" : "wie gesendet"}</>
        ) : tracksMeta && showVessels && (
          <> · AIS-Daten: Danish Maritime Authority, {tracksMeta.date},
            {" "}{tracksMeta.count} Fahrten — Kennungen wie veröffentlicht</>
        )}
        {/* The objects are only on screen in one scenario, so the credit follows them. */}
        {scenario === "counterUas" && assetAttribution && <> · {assetAttribution}</>}
      </footer>
      </div>
    </div>
  );
}

