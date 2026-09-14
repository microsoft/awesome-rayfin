import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AOIS, activeAoiId } from '@/config/aoi';
import { WORLD, inWorld } from '@/config/world';
import { useI18n } from '@/i18n';
import { parseIgc } from '@/flight/igc';
import { buildTrack, type FlightTrack } from '@/flight/track';
import { deriveWind, type WindProfile } from '@/flight/wind';
import { initTwin3D, type Twin3DHandle } from '@/twin3d/scene';
import type { FlyTelemetry } from '@/twin3d/flyControls';
import {
  connectLiveTraffic,
  FREE_FLIGHT_TYPES,
  type LiveAircraft,
  type LiveStatus,
} from '@/live/ogn';
import { loadDaySnapshot, type DaySnapshot } from '@/day/snapshot';
import {
  startAssistant,
  type AssistantFacts,
  type AssistantHandle,
  type AssistantStatus,
} from '@/voice/assistant';
import {
  TerrainNotBuiltError,
  type LoadStageProgress,
  type TerrainFocusPlace,
} from '@/twin3d/terrainLoader';

import { Barogram } from './Barogram';
import { AssistantPanel } from './AssistantPanel';
import { DayPanel } from './DayPanel';
import { AircraftDetail } from './AircraftDetail';
import { LivePanel } from './LivePanel';
import { WebcamCard } from './WebcamCard';
import type { WebcamMarker } from '@/twin3d/webcamLayer';
import { SetupNotice } from './SetupNotice';
import { WindProfilePanel } from './WindProfilePanel';

/**
 * Replay speeds, as multiples of real time.
 *
 * The hero flight is 209 minutes. At 1× that is an afternoon; at 60× it is three and a half
 * minutes, which is about as long as anyone watches a replay without touching anything. 60× is
 * therefore the default, and 1× exists because a single thermal entry at real speed is worth
 * seeing once.
 */
const SPEEDS = [1, 10, 30, 60, 120];
const DEFAULT_SPEED_INDEX = 3;

/**
 * Where the OGN relay lives — PLAN §5.3.
 *
 * Same-origin by default, which the Vite dev server proxies to the relay on 8787. In the deployed
 * build there is nothing behind this path, the request 404s, and Mode C reports itself unavailable
 * — which is the designed behaviour, not a misconfiguration. Point `VITE_OGN_RELAY_URL` at a
 * hosted relay to change that.
 */
const RELAY_URL = import.meta.env.VITE_OGN_RELAY_URL ?? '/ogn/stream';

/** Progress across all stages, so the bar advances continuously rather than per stage. */
function stagePercent(progress: LoadStageProgress): number {
  const withinStage =
    progress.totalBytes > 0 ? Math.min(1, progress.loadedBytes / progress.totalBytes) : 0;
  return ((progress.step - 1 + withinStage) / progress.stepCount) * 100;
}

/** Megabytes, one decimal — the unit the wait is actually felt in. */
function formatMegabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bytes / 1024 / 1024);
}

/** h:mm:ss of elapsed flight time. */
function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * The 3D view — PLAN §6, modes A and B.
 *
 * Mode A is the terrain: two tiers, land cover, and framed presets for the places in the AOI
 * config. Mode B is the flight: a track ribbon coloured by vertical speed, a barogram that doubles
 * as the scrubber, and the wind the flight measured about itself.
 */
export function Twin3DView({ site }: { site: string }) {
  const { t, locale } = useI18n();
  /**
   * The site the SCENE was built around — PLAN §8.
   *
   * ⚠️ **Fixed for the lifetime of the component, and `site` is not.** The world is one scene, so
   * choosing another site flies the camera rather than rebuilding anything; if the scene-init
   * effect depended on the live `site` it would tear down the renderer and reload tens of
   * megabytes on every change, which is precisely the page reload this phase removed.
   */
  const sceneSite = useMemo(() => activeAoiId(), []);
  const aoi = AOIS[site] ?? AOIS[sceneSite];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelHostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<Twin3DHandle | null>(null);

  const [places, setPlaces] = useState<TerrainFocusPlace[]>([]);
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadStageProgress | null>(null);
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [showTrees, setShowTrees] = useState(true);
  const [showLanduse, setShowLanduse] = useState(true);
  const [showCableway, setShowCableway] = useState(true);
  const [hasCableway, setHasCableway] = useState(false);
  const [showWebcams, setShowWebcams] = useState(true);
  const [hasWebcams, setHasWebcams] = useState(false);
  const [selectedWebcam, setSelectedWebcam] = useState<WebcamMarker | null>(null);
  const [showDrape, setShowDrape] = useState(true);
  const [hasDrape, setHasDrape] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [droneMode, setDroneMode] = useState(false);
  const [droneHud, setDroneHud] = useState<FlyTelemetry | null>(null);
  const [tourCaption, setTourCaption] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState({ index: 0, total: 0 });

  const [track, setTrack] = useState<FlightTrack | null>(null);
  const [wind, setWind] = useState<WindProfile | null>(null);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [headS, setHeadS] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [follow, setFollow] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  const [liveAircraft, setLiveAircraft] = useState<LiveAircraft[]>([]);
  const [liveFreeFlightOnly, setLiveFreeFlightOnly] = useState(true);
  const [followLiveId, setFollowLiveId] = useState<string | null>(null);

  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus>('idle');
  const [assistantDetail, setAssistantDetail] = useState<string | undefined>();
  const [transcript, setTranscript] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const assistantRef = useRef<AssistantHandle | null>(null);
  const dayRef = useRef<DaySnapshot | null>(null);
  const liveRef = useRef<LiveAircraft[]>([]);
  const trackRef = useRef<FlightTrack | null>(null);
  const headRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // React 18+ runs effects twice in development. Without this guard the second run adopts a
    // canvas the first run is still initialising, and two WebGL contexts fight over it.
    let cancelled = false;

    initTwin3D(
      canvas,
      sceneSite,
      (update) => {
        if (!cancelled) setProgress(update);
      },
      labelHostRef.current ?? undefined
    )      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        // The latch flips on its own — W takes the camera, a couple of seconds of nothing gives it
        // back — so the panel has to follow the scene rather than command it. There is no button
        // left to press; this is the only thing keeping the interface honest about which behaviour
        // the mouse currently has.
        handle.onDroneMode((engaged) => {
          setDroneMode(engaged);
          // The scene drops the follows itself when the camera is taken — two things cannot drive
          // it at once — so this is only the panel's own checkbox catching up with that.
          if (engaged) setFollow(false);
        });
        setPlaces(handle.assets.terrain.focusPlaces);
        setActivePlace(handle.assets.terrain.focusPlaces[0]?.id ?? null);
        setHasCableway(handle.hasCableway);
        setHasWebcams(handle.hasWebcams);
        setHasDrape(handle.hasDrape);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A fresh clone has no terrain until the pipeline has run. That is a first-run state, not
        // a failure, so it gets an explanation rather than a stack trace.
        if (!(error instanceof TerrainNotBuiltError)) console.error(error);
        setNeedsSetup(true);
      });

    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // The scene is built once, around `sceneSite`. Choosing another site flies the camera; it does
    // not rebuild anything, which is the whole point of phase 8.
  }, [sceneSite]);

  /**
   * Follow the chosen site — PLAN §8.
   *
   * Flies there and re-points the places list at that site. Everything else that is per-site (the
   * bundled flight, the day snapshot, the tour, the live filter) keys off `aoi`, which now follows
   * `site` — so arriving at the Tegelberg cannot leave Oberstdorf's flight on screen. That is the
   * same AOI leak §4.4 caught once already, and flying between sites is a brand new way to cause it.
   */
  useEffect(() => {
    if (!ready) return;
    const handle = handleRef.current;
    if (!handle) return;
    let cancelled = false;

    void handle.flyToSite(site).then((arrived) => {
      if (cancelled || !arrived) return;
      const sitePlaces = handle.placesForSite(site);
      if (sitePlaces.length) {
        setPlaces(sitePlaces);
        setActivePlace(sitePlaces[0]?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, site]);

  /** Parse an IGC and hand it to the scene. Shared by the bundled flight and drag & drop. */
  const adoptFlight = useCallback((text: string, id: string) => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const parsed = parseIgc(text);
      const built = buildTrack(parsed, handle.worldOrigin, id);
      handle.setFlight(built);
      handle.setFlightTime(built.durationS);
      setTrack(built);
      setWind(deriveWind(built.points));
      setHeadS(built.durationS);
      setPlaying(false);
      setFlightError(null);
    } catch (error) {
      setFlightError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /**
   * The bundled flight, once the scene exists — it needs the world origin the scene computes.
   *
   * ⚠️ **Named by the AOI, not "whichever is first".** This used to take `flights[0]` from a global
   * index, so the second site — which has no flight of its own and says so in its config — silently
   * showed the *Oberstdorf* track: a 98 km cross-country drawn through terrain 35 km away, with a
   * scrubber and an elevation profile that looked entirely convincing. A site with no flight must
   * show no flight, which is what its `heroFlight: null` has always meant.
   */
  useEffect(() => {
    if (!ready) return;
    const wanted = aoi.flights.heroFlight;

    // ⚠️ **Clear first, and clear on the way out too.** Before phase 8 a site change was a page
    // reload, so "no flight here" needed no cleanup — the whole app went away. Flying between
    // sites keeps the component alive, so arriving at a site with no flight simply left the
    // PREVIOUS site's track on screen: a 98 km cross-country and its barogram, sitting under a
    // header naming a different mountain. Exactly the leak §4.4 caught once already, reintroduced
    // by the one change that made it possible again.
    if (!wanted) {
      handleRef.current?.setFlight(null);
      setTrack(null);
      setWind(null);
      setHeadS(0);
      setPlaying(false);
      setFlightError(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const index = await fetch('/flights/index.json');
      if (!index.ok) return;
      const { flights } = (await index.json()) as { flights: { id: string; file: string }[] };
      const hero = flights.find((flight) => flight.id === wanted);
      if (!hero || cancelled) return;
      const response = await fetch(`/flights/${hero.file}`);
      if (!response.ok || cancelled) return;
      adoptFlight(await response.text(), hero.id);
    })().catch(() => {
      // No bundled flight is a perfectly good state — the terrain is the app's floor, not the
      // flight. Mode A stands on its own.
    });

    return () => {
      cancelled = true;
    };
  }, [ready, adoptFlight, aoi.flights.heroFlight]);

  /**
   * Live traffic — Mode C.
   *
   * Connected automatically once the scene exists rather than behind a button, because the
   * fallback has to be automatic to be honest: the app should already know whether anyone is
   * flying by the time someone asks. The scene is fed directly while React state is updated in the
   * same breath — at the relay's 1 Hz that is a cheap re-render, and it keeps the panel and the
   * markers from ever disagreeing.
   */
  useEffect(() => {
    if (!ready) return;
    const connection = connectLiveTraffic(RELAY_URL, {
      aoiId: aoi.id,
      worldId: inWorld(aoi.id) ? WORLD.id : null,
      onStatus: (status) => {
        setLiveStatus(status);
        handleRef.current?.setLiveVisible(status === 'live');
      },
      onTraffic: (aircraft) => {
        setLiveAircraft(aircraft);
      },
    });
    return () => connection.close();
  }, [ready, aoi.id]);

  /**
   * What the SCENE draws — the same list the panel lists, filtered the same way.
   *
   * ⚠️ **The filter used to stop at the panel.** `onTraffic` fed the scene the raw list while the
   * panel filtered its own copy, so switching "nur Freiflug" back on removed the airliners from
   * the list and left them flying over the mountain. The control appeared to do half its job, and
   * the half it did was the half nobody was looking at.
   */
  const visibleAircraft = useMemo(
    () =>
      liveFreeFlightOnly
        ? liveAircraft.filter((craft) => FREE_FLIGHT_TYPES.has(craft.type))
        : liveAircraft,
    [liveAircraft, liveFreeFlightOnly]
  );

  useEffect(() => {
    handleRef.current?.setLiveTraffic(visibleAircraft);
  }, [visibleAircraft]);

  /**
   * Click an aircraft in the scene to open its details.
   *
   * Selection is by id rather than by object, so an aircraft that leaves receiver range while
   * selected simply resolves to nothing on the next update instead of pinning a stale copy of
   * itself on screen.
   */
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    handleRef.current?.onLiveSelect((id) => setSelectedLiveId(id));
    return () => handleRef.current?.onLiveSelect(null);
  }, [ready]);

  /** Clicking a webcam marker opens its card — and closes any aircraft card, so one thing is open. */
  useEffect(() => {
    if (!ready) return;
    handleRef.current?.onWebcamSelect((camera) => {
      setSelectedWebcam(camera);
      if (camera) setSelectedLiveId(null);
    });
    return () => handleRef.current?.onWebcamSelect(null);
  }, [ready]);

  // A selected aircraft that is filtered out, or has gone out of range, stops being selected.
  const selectedAircraft = useMemo(
    () => visibleAircraft.find((craft) => craft.id === selectedLiveId) ?? null,
    [visibleAircraft, selectedLiveId]
  );

  /**
   * Drone instruments.
   *
   * Polled at 10 Hz rather than pushed from the render loop, and that is a readability decision as
   * much as a performance one: altitude and speed changing sixty times a second are a blur nobody
   * can read, and it would cost sixty React renders a second to produce that blur. The scene keeps
   * the values current; this just looks at them occasionally, the way an instrument is read.
   */
  useEffect(() => {
    if (!droneMode) {
      setDroneHud(null);
      return;
    }
    const timer = window.setInterval(() => {
      setDroneHud(handleRef.current?.droneTelemetry() ?? null);
    }, 100);
    return () => window.clearInterval(timer);
  }, [droneMode]);

  // The day snapshot, kept here as well as in the panel so the assistant quotes the same figures.
  useEffect(() => {
    loadDaySnapshot(aoi.id).then((data) => {
      dayRef.current = data;
    });
  }, [aoi.id]);

  // Refs rather than state, because `facts()` is called from inside a WebRTC event handler that
  // closes over whatever it captured — reading state there would hand the assistant the values
  // from whenever the session started.
  useEffect(() => {
    liveRef.current = liveAircraft;
  }, [liveAircraft]);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);
  useEffect(() => {
    headRef.current = headS;
  }, [headS]);

  /**
   * Everything the assistant is permitted to state as fact.
   *
   * ⚠️ Assembled at call time from what is actually on screen. Nothing here is a constant about the
   * Allgäu that the model could have been told once and then repeated after it stopped being true.
   */
  const facts = useCallback((): AssistantFacts => {
    const day = dayRef.current;
    const currentTrack = trackRef.current;
    const best = day?.hours.filter((h) => h.cloudBaseM !== null) ?? [];
    const peak = best.length
      ? best.reduce((a, b) => ((b.cloudBaseM ?? 0) > (a.cloudBaseM ?? 0) ? b : a))
      : null;

    const types: Record<string, number> = {};
    for (const craft of liveRef.current) types[craft.type] = (types[craft.type] ?? 0) + 1;

    return {
      places: places.map((p) => ({ id: p.id, name: p.name, groundM: Math.round(p.groundM) })),
      flight: currentTrack
        ? {
            date: currentTrack.date || null,
            durationS: Math.round(currentTrack.durationS),
            ceilingM: Math.round(currentTrack.altMaxM),
            bestClimbMs: Number(currentTrack.varioMaxMs.toFixed(1)),
            distanceKm: Number((currentTrack.trackDistanceM / 1000).toFixed(1)),
            headS: Math.round(headRef.current),
          }
        : null,
      day: day
        ? {
            modelRun: day.modelRun,
            cloudBaseM: peak?.cloudBaseM ?? null,
            cloudCoveragePct: peak ? Math.round(peak.cloudCoverage * 100) : null,
            capeJkg: day.hours.reduce((max, h) => Math.max(max, h.capeJkg), 0) || null,
            freezingM: day.hours.find((h) => h.freezingM > 0)?.freezingM ?? null,
          }
        : null,
      live: { status: liveStatus, count: liveRef.current.length, types },
    };
  }, [places, liveStatus]);

  const followLive = useCallback((id: string | null) => {
    setFollowLiveId(id);
    if (id) {
      // Live and replay cannot both own the camera.
      setFollow(false);
      setDroneMode(false);
      handleRef.current?.setFollowGlider(false);
      handleRef.current?.setDroneMode(false);
      handleRef.current?.stopTour();
    }
    handleRef.current?.setFollowLive(id);
  }, []);

  // Playback.
  useEffect(() => {
    if (!playing || !track) return;
    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const deltaS = ((now - last) / 1000) * SPEEDS[speedIndex];
      last = now;
      setHeadS((current) => {
        const next = current + deltaS;
        if (next >= track.durationS) {
          setPlaying(false);
          return track.durationS;
        }
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speedIndex, track]);

  useEffect(() => {
    handleRef.current?.setFlightTime(headS);
  }, [headS]);

  const focus = useCallback((placeId: string) => {
    setActivePlace(placeId);
    setFollow(false);
    setDroneMode(false);
    handleRef.current?.stopTour();
    handleRef.current?.setDroneMode(false);
    handleRef.current?.setFollowGlider(false);
    handleRef.current?.focusPlace(placeId);
  }, []);

  const toggleTour = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (tourCaption !== null) {
      handle.stopTour();
      setTourCaption(null);
      return;
    }
    setDroneMode(false);
    setFollow(false);
    handle.startTour((key, index, total) => {
      setTourCaption(key);
      setTourStep({ index, total });
    });
  }, [tourCaption]);

  /**
   * Start or stop the assistant.
   *
   * Defined after `focus` and `toggleTour` because it hands them to the assistant as actions — the
   * whole point of Mode E is that it drives the same controls a person would press, rather than
   * having a private path into the scene that could drift from what the buttons do.
   */
  const toggleAssistant = useCallback(() => {
    if (assistantRef.current) {
      assistantRef.current.stop();
      assistantRef.current = null;
      return;
    }
    setTranscript([]);
    setAssistantDetail(undefined);
    void startAssistant(
      locale,
      {
        focusPlace: (id) => focus(id),
        setTour: (on) => {
          if (on !== (tourCaption !== null)) toggleTour();
        },
        setDroneMode: (on) => {
          setDroneMode(on);
          handleRef.current?.setDroneMode(on);
        },
        setFlightTime: (seconds) => {
          setPlaying(false);
          setHeadS(seconds);
        },
        setPlaying: (playing) => setPlaying(playing),
        setFollow: (on) => {
          setFollow(on);
          handleRef.current?.setFollowGlider(on);
        },
        facts,
      },
      {
        onStatus: (status, detail) => {
          setAssistantStatus(status);
          setAssistantDetail(detail);
          if (status === 'idle' || status === 'unavailable') assistantRef.current = null;
        },
        onTranscript: (role, text) => setTranscript((lines) => [...lines, { role, text }]),
      }
    ).then((handle) => {
      assistantRef.current = handle;
    });
  }, [locale, facts, focus, toggleTour, tourCaption]);

  const toggleTrees = useCallback(() => {
    setShowTrees((visible) => {
      handleRef.current?.setVegetationVisible(!visible);
      return !visible;
    });
  }, []);

  const toggleLanduse = useCallback(() => {
    setShowLanduse((visible) => {
      handleRef.current?.setLanduseVisible(!visible);
      return !visible;
    });
  }, []);

  const toggleFollow = useCallback(() => {
    setFollow((on) => {
      handleRef.current?.setFollowGlider(!on);
      return !on;
    });
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (!file) return;
      // ⚠️ Read locally and never uploaded. An IGC is personal location history — where somebody
      // was, on which day — so a design with no server leg has no retention question to answer.
      file.text().then((text) => adoptFlight(text, file.name.replace(/\.igc$/i, '')));
    },
    [adoptFlight]
  );

  const loading = !ready && !needsSetup;
  const point = track ? track.points[Math.max(0, indexAt(track, headS))] : null;

  return (
    <section
      className="relative flex-1 overflow-hidden bg-stone-100"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        data-testid="twin3d-canvas"
        className="block h-full w-full"
        // `role="img"` so the label is actually announced: on a bare <canvas> an aria-label is
        // attached to an element with no implicit role, and assistive technology is free to ignore
        // it. The label names the site, so without the role a screen-reader user is told nothing at
        // all about the largest thing on the page.
        role="img"
        aria-label={t('twin.canvasLabel', { site: aoi.site.name[locale] })}
      />

      {/* Labels live outside the canvas, positioned over it. See labelLayer.ts for why. */}
      <div ref={labelHostRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

      {needsSetup && <SetupNotice />}

      {dragging && (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded border-2 border-dashed border-stone-500 bg-stone-100/70 text-sm text-stone-700">
          {t('flight.dropHere')}
        </div>
      )}

      {droneHud && <DroneHud telemetry={droneHud} />}

      {tourCaption && (
        <div
          data-testid="tour-caption"
          // Anchored clear of the controls panel rather than centred on the viewport: the panel is
          // 15 rem wide and a viewport-centred caption slides underneath it, which cost the first
          // two words of every stop.
          className="pointer-events-none absolute left-[17rem] right-4 top-6 mx-auto max-w-xl rounded border border-stone-300/70 bg-stone-50/92 px-4 py-3 shadow-sm backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-stone-500">
            {t('tour.label')} · {tourStep.index + 1}/{tourStep.total}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-stone-800">{t(tourCaption)}</p>
        </div>
      )}

      {loading && (
        <div
          data-testid="twin3d-loading"
          data-stage={progress?.stage ?? ''}
          className="absolute inset-0 flex items-center justify-center bg-stone-100 px-6"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-sm">
            <p className="text-sm text-stone-700">{t('twin.loading')}</p>
            <p className="mt-1 text-xs text-stone-500">
              {progress
                ? `${t(`twin.loading_${progress.stage}`)} · ${t('twin.loadingStep', {
                    step: String(progress.step),
                    of: String(progress.stepCount),
                  })}`
                : t('twin.loadingStart')}
            </p>
            <div className="mt-3 h-px w-full bg-stone-300">
              <div
                data-testid="twin3d-loading-bar"
                className="h-px bg-stone-700 transition-[width] duration-200"
                style={{ width: `${progress ? stagePercent(progress) : 0}%` }}
              />
            </div>
            {/* Bytes, not just a bar. "Is it stuck?" is the only question this element exists to
                answer, and a number that keeps changing answers it far more directly than a bar
                whose total the server never declared. */}
            <p data-testid="twin3d-loading-bytes" className="mt-2 text-xs tabular-nums text-stone-500">
              {progress && progress.loadedBytes > 0
                ? `${formatMegabytes(progress.loadedBytes, locale)} / ${formatMegabytes(
                    progress.totalBytes,
                    locale
                  )} MB`
                : ''}
            </p>
          </div>
        </div>
      )}

      {ready && (
        <div
          data-testid="twin3d-controls"
          // The wind profile grows with the flight — a three-hour climb-heavy day fills twenty
          // altitude bands — so the panel has to be allowed to scroll rather than run off the
          // bottom of the screen behind the flight controls.
          className="absolute left-4 top-4 flex max-h-[calc(100%-2rem)] w-60 flex-col overflow-y-auto rounded border border-stone-300 bg-stone-50/95 p-3 text-sm text-stone-700 shadow-sm backdrop-blur"
          style={{ maxHeight: track ? 'calc(100% - 13rem)' : 'calc(100% - 2rem)' }}
        >
          <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{t('twin.places')}</p>
          <ul className="mt-2 space-y-1">
            {places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  data-testid={`focus-${place.id}`}
                  onClick={() => focus(place.id)}
                  aria-pressed={activePlace === place.id}
                  className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${
                    activePlace === place.id ? 'bg-stone-800 text-stone-50' : 'hover:bg-stone-200/70'
                  }`}
                >
                  <span>{place.name}</span>
                  {/* Ground elevation, from the heightmap the camera is flying over — the one
                      number that makes a launch site and a landing field comparable at a glance. */}
                  <span className="shrink-0 text-xs tabular-nums opacity-70">
                    {Math.round(place.groundM)} m
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1 border-t border-stone-300 pt-3">
            {hasDrape && (
              <LayerToggle
                testId="toggle-drape"
                label={t('twin.drape')}
                on={showDrape}
                onClick={() =>
                  setShowDrape((visible) => {
                    handleRef.current?.setDrapeVisible(!visible);
                    return !visible;
                  })
                }
              />
            )}
            <LayerToggle testId="toggle-landuse" label={t('twin.landuse')} on={showLanduse} onClick={toggleLanduse} />
            <LayerToggle testId="toggle-trees" label={t('twin.trees')} on={showTrees} onClick={toggleTrees} />
            {hasCableway && (
              <LayerToggle
                testId="toggle-cableway"
                label={t('twin.cableway')}
                on={showCableway}
                onClick={() =>
                  setShowCableway((visible) => {
                    handleRef.current?.setCablewayVisible(!visible);
                    return !visible;
                  })
                }
              />
            )}
            {hasWebcams && (
              <LayerToggle
                testId="toggle-webcams"
                label={t('webcam.layer')}
                on={showWebcams}
                onClick={() =>
                  setShowWebcams((visible) => {
                    handleRef.current?.setWebcamsVisible(!visible);
                    // Hiding the layer closes the card: a card for a marker that is no longer on
                    // screen is the same mistake as the flight panel that outlived its site.
                    if (visible) setSelectedWebcam(null);
                    return !visible;
                  })
                }
              />
            )}
          </div>

          {selectedWebcam && (
            <WebcamCard
              camera={selectedWebcam}
              onClose={() => setSelectedWebcam(null)}
              onFocus={(camera) => handleRef.current?.focusWebcam(camera.id)}
            />
          )}

          <div className="mt-3 space-y-1 border-t border-stone-300 pt-3">
            <button
              type="button"
              data-testid="toggle-tour"
              onClick={toggleTour}
              aria-pressed={tourCaption !== null}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${
                tourCaption !== null ? 'bg-stone-800 text-stone-50' : 'hover:bg-stone-200/70'
              }`}
            >
              <span>{t('tour.label')}</span>
              <span className="text-xs tabular-nums opacity-70">
                {tourCaption !== null ? `${tourStep.index + 1}/${tourStep.total}` : '▶'}
              </span>
            </button>
            <LayerToggle
              testId="toggle-labels"
              label={t('twin.labels')}
              on={showLabels}
              onClick={() =>
                setShowLabels((visible) => {
                  handleRef.current?.setLabelsVisible(!visible);
                  return !visible;
                })
              }
            />
            {/*
              ⚠️ There is no drone toggle here any more, and that is the point of the merge rather
              than a casualty of it. W A S D takes the camera and a second of stillness gives it
              back, so a button was a second way to say what the keys already said — and a worse
              one, because it could disagree with them: pressed mid-drag, the controls defer the
              flip to the end of the gesture and the button would claim a state the camera is not
              in.

              What is left is what the button could not do on its own: say that the keys exist, and
              say which behaviour the mouse currently has. The drone HUD over the map is the second
              half of that, and `drone-hud` appearing is how the e2e specs know the camera is
              flying.
            */}
            <div
              data-testid="drone-state"
              data-flying={droneMode ? 'true' : 'false'}
              role="status"
              aria-live="off"
              className="px-2 pt-1 text-[0.7rem] leading-relaxed text-stone-500"
            >
              {droneMode ? t('drone.help') : t('drone.hint')}
            </div>
          </div>

          <div className="mt-3 border-t border-stone-300 pt-3">
            <AssistantPanel
              status={assistantStatus}
              detail={assistantDetail}
              transcript={transcript}
              onToggle={toggleAssistant}
            />
          </div>

          <div className="mt-3 border-t border-stone-300 pt-3">
            <DayPanel site={site} />
          </div>

          {liveStatus !== 'idle' && (
            <div className="mt-3 border-t border-stone-300 pt-3">
              <LivePanel
                status={liveStatus}
                aircraft={liveAircraft}
                freeFlightOnly={liveFreeFlightOnly}
                onToggleFreeFlightOnly={() => setLiveFreeFlightOnly((on) => !on)}
                followId={followLiveId}
                onFollow={(id: string | null) => {
                  // Selecting from the list as well as from the scene, because an aircraft at
                  // 11 km is a few pixels across and "click the aeroplane" is not a reasonable
                  // instruction at that size. The list is the same set, already sorted.
                  setSelectedLiveId(id);
                  followLive(id);
                }}
              />
              {selectedAircraft && (
                <AircraftDetail
                  aircraft={selectedAircraft}
                  following={followLiveId === selectedAircraft.id}
                  onFollow={(id: string) => followLive(followLiveId === id ? null : id)}
                  onClose={() => setSelectedLiveId(null)}
                />
              )}            </div>
          )}

          {wind && (
            <div className="mt-3 border-t border-stone-300 pt-3">
              <WindProfilePanel profile={wind} />
            </div>
          )}
        </div>
      )}

      {ready && track && (
        <div
          data-testid="flight-panel"
          className="absolute bottom-0 left-0 right-0 border-t border-stone-300 bg-stone-50/95 px-4 py-3 backdrop-blur"
        >
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              data-testid="flight-play"
              onClick={() => {
                if (headS >= track.durationS) setHeadS(0);
                setPlaying((on) => !on);
              }}
              className="rounded border border-stone-400 px-3 py-1 hover:bg-stone-200/70"
            >
              {playing ? t('flight.pause') : t('flight.play')}
            </button>
            <button
              type="button"
              data-testid="flight-speed"
              onClick={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)}
              className="rounded border border-stone-400 px-3 py-1 tabular-nums hover:bg-stone-200/70"
              aria-label={t('flight.speed')}
            >
              {SPEEDS[speedIndex]}×
            </button>
            <button
              type="button"
              data-testid="flight-follow"
              onClick={toggleFollow}
              aria-pressed={follow}
              className={`rounded border px-3 py-1 ${
                follow ? 'border-stone-800 bg-stone-800 text-stone-50' : 'border-stone-400 hover:bg-stone-200/70'
              }`}
            >
              {t('flight.follow')}
            </button>

            <span className="ml-auto flex flex-wrap items-baseline gap-4 text-xs tabular-nums text-stone-600">
              <span>{formatElapsed(headS)}</span>
              {point && (
                <>
                  <span>{Math.round(point.altM)} m</span>
                  <span className={point.varioMs >= 0 ? 'text-amber-700' : 'text-sky-800'}>
                    {point.varioMs >= 0 ? '+' : ''}
                    {point.varioMs.toFixed(1)} m/s
                  </span>
                  <span>{Math.round(point.groundMs * 3.6)} km/h</span>
                </>
              )}
              <span className="text-stone-500">
                {t('flight.label')} · {track.date} · {(track.trackDistanceM / 1000).toFixed(1)} km
              </span>
            </span>
          </div>

          <Barogram
            track={track}
            headS={headS}
            onScrub={(seconds) => {
              setPlaying(false);
              setHeadS(seconds);
            }}
          />

          <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
            {t('flight.notice')}
          </p>
        </div>
      )}

      {ready && !track && (
        <p
          data-testid="twin3d-model-notice"
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-stone-50/95 to-stone-50/0 px-4 pb-3 pt-8 text-xs leading-relaxed text-stone-600"
        >
          {t('twin.modelNotice')}
          {flightError ? ` — ${flightError}` : ''}
        </p>
      )}
    </section>
  );
}

/**
 * The drone HUD.
 *
 * Four numbers, chosen because they are the ones you cannot infer from the picture: how high you
 * are, how far above the ground that is, how fast you are going, and which way you are pointing.
 *
 * ⚠️ **Height above ground can go negative, and it is shown rather than hidden.** Decision 19 says
 * this camera has no terrain collision, so flying inside the mountain is allowed — but a viewer who
 * ends up there sees an unlit void and reasonably concludes the app has broken. One negative number
 * turns that from a bug into a position.
 */
function DroneHud({ telemetry }: { telemetry: FlyTelemetry }) {
  const { t } = useI18n();
  const underground = telemetry.aglM !== null && telemetry.aglM < 0;

  return (
    <div
      data-testid="drone-hud"
      // The speed the instruments are showing, unrounded, for the e2e specs. This camera has mass,
      // so "the keys are up" and "the camera has stopped" are a second or so apart — and a spec
      // that samples positions to tell them apart can be fooled by a single dropped frame under
      // GPU contention, which is what made two of them flake in the full suite and pass alone.
      data-speed-ms={telemetry.speedMs.toFixed(2)}
      // Top right. The bottom right looks like the natural home for a HUD and is not: the flight
      // panel is anchored to the bottom edge across the full width, so a HUD there is hidden behind
      // the barogram the moment a flight is loaded — which is almost always.
      className="pointer-events-none absolute right-4 top-4 rounded border border-stone-300/70 bg-stone-50/90 px-3 py-2 text-xs tabular-nums text-stone-700 shadow-sm backdrop-blur"
      role="status"
      aria-live="off"
    >
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <span className="text-stone-500">{t('drone.altitude')}</span>
        <span className="text-right">{Math.round(telemetry.altitudeM)} m</span>

        <span className="text-stone-500">{t('drone.agl')}</span>
        <span className={`text-right ${underground ? 'text-amber-700' : ''}`}>
          {telemetry.aglM === null ? '—' : `${Math.round(telemetry.aglM)} m`}
        </span>

        <span className="text-stone-500">{t('drone.speed')}</span>
        <span className="text-right">{Math.round(telemetry.speedMs * 3.6)} km/h</span>

        <span className="text-stone-500">{t('drone.heading')}</span>
        <span className="text-right">{String(Math.round(telemetry.headingDeg)).padStart(3, '0')}°</span>
      </div>

      {/* The throttle, as a bar rather than a number: its absolute value means nothing to anyone,
          but where it sits in its range is exactly what you want to know before reaching for the
          wheel again. */}
      <div className="mt-1.5 h-px w-full bg-stone-300">
        <div
          className="h-px bg-stone-700"
          style={{ width: `${Math.round(telemetry.cruise * 100)}%` }}
        />
      </div>
    </div>
  );
}

function LayerToggle({
  testId,
  label,
  on,
  onClick,
}: {
  testId: string;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-stone-200/70"
    >
      <span>{label}</span>
      <span className="text-xs opacity-70">{on ? 'on' : 'off'}</span>
    </button>
  );
}

function indexAt(track: FlightTrack, t: number): number {
  const points = track.points;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
