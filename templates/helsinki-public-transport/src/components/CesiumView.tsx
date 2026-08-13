import {
  Cartesian3,
  Cartographic,
  CameraEventType,
  Cesium3DTileset,
  Cesium3DTileStyle,
  CesiumTerrainProvider,
  Color,
  HeightReference,
  Ion,
  ImageryLayer,
  KeyboardEventModifier,
  Math as CesiumMath,
  NearFarScalar,
  ScreenSpaceEventType,
  Viewer,
  WebMapServiceImageryProvider,
} from 'cesium';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import 'cesium/Build/Cesium/Widgets/widgets.css';

import { createFlyControls, type FlyControls, type FlyTelemetry } from '@/cesium/flyControls';
import { DroneHud } from '@/components/DroneHud';
import type { PathPoint, Vehicle } from '@/data/model';
import { speedColor, trackColor } from '@/theme';
import {
  BUILDING_TINT,
  HELSINKI_ATTRIBUTION,
  HOME_VIEW,
  LOD2_TEXTURED_TILESET,
  ORTHO_WMS_LAYER,
  ORTHO_WMS_URL,
  TERRAIN_URL,
} from '@/cesium/helsinkiOpenData';

/**
 * No Cesium ion asset is ever requested - terrain, imagery and the buildings all come from the
 * City of Helsinki. Blanking the token makes that guarantee explicit rather than implicit.
 */
Ion.defaultAccessToken = '';

export interface CesiumViewProps {
  vehicles: Vehicle[];
  /** Compared vehicles, in tab order - the order also picks each track's colour. */
  selectedIds: string[];
  activeVehicleId: string | null;
  paths: Map<string, PathPoint[]>;
  onSelect: (vehicleId: string | null, additive: boolean) => void;
}

interface VehicleEntityState {
  lon: number;
  lat: number;
}

const VEHICLE_ID_PROPERTY = 'hslVehicleId';
/** Track entities are prefixed so they can be told apart from the vehicle points. */
const TRACK_ID_PREFIX = '__track:';

export function CesiumView({
  vehicles,
  selectedIds,
  activeVehicleId,
  paths,
  onSelect,
}: CesiumViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const buildingsRef = useRef<Cesium3DTileset | null>(null);
  const stateRef = useRef(new Map<string, VehicleEntityState>());
  const flyRef = useRef<FlyControls | null>(null);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const readTelemetry = useCallback((): FlyTelemetry | null => flyRef.current?.telemetry() ?? null, []);

  // ---- viewer lifecycle ---------------------------------------------------
  useEffect(() => {
    if (viewerRef.current || !containerRef.current) return;
    let disposed = false;

    const viewer = new Viewer(containerRef.current, {
      // preserveDrawingBuffer keeps canvas.toDataURL() working, which is how the view gets
      // captured for screenshots and automated render checks.
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
      baseLayer: ImageryLayer.fromProviderAsync(
        Promise.resolve(
          new WebMapServiceImageryProvider({
            url: ORTHO_WMS_URL,
            layers: ORTHO_WMS_LAYER,
            parameters: { transparent: false, format: 'image/png' },
            credit: HELSINKI_ATTRIBUTION,
          }),
        ),
        {},
      ),
      // Cesium looks like a toy demo until every one of these is switched off.
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      timeline: false,
      animation: false,
      infoBox: false,
      selectionIndicator: false,
    });
    viewerRef.current = viewer;

    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    // Without this, clamped points show through hills and buildings.
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // Cesium's default credit is the Cesium *ion* logo. No ion asset is ever requested here, so
    // showing it would be misleading; attribution is rendered in the app chrome instead.
    const credits = viewer.cesiumWidget.creditContainer as HTMLElement;
    credits.style.display = 'none';

    void CesiumTerrainProvider.fromUrl(TERRAIN_URL, { requestVertexNormals: true })
      .then((terrain) => {
        if (!disposed && !viewer.isDestroyed()) viewer.terrainProvider = terrain;
      })
      .catch(() => {
        /* fall back to the plain ellipsoid - Helsinki is flat enough that it barely shows */
      });

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        HOME_VIEW.longitude,
        HOME_VIEW.latitude,
        HOME_VIEW.height,
      ),
      orientation: {
        heading: CesiumMath.toRadians(HOME_VIEW.heading),
        pitch: CesiumMath.toRadians(HOME_VIEW.pitch),
        roll: 0,
      },
    });

    // Cesium hands the pick position over without the DOM event, so "was a modifier held?" has
    // to come from separate registrations rather than from `event.ctrlKey`.
    const pickAt = (position: unknown, additive: boolean) => {
      const picked = viewer.scene.pick(position as never);
      const id = picked?.id?.properties?.[VEHICLE_ID_PROPERTY]?.getValue?.();
      const vehicleId = typeof id === 'string' ? id : null;
      // A modifier-click into empty space would otherwise wipe the whole comparison.
      if (additive && vehicleId === null) return;
      onSelectRef.current(vehicleId, additive);
    };

    viewer.screenSpaceEventHandler.setInputAction(
      (movement: { position: unknown }) => pickAt(movement.position, false),
      ScreenSpaceEventType.LEFT_CLICK,
    );
    // CTRL/SHIFT + LEFT_DRAG pan the camera, but a click without movement still lands here.
    viewer.screenSpaceEventHandler.setInputAction(
      (movement: { position: unknown }) => pickAt(movement.position, true),
      ScreenSpaceEventType.LEFT_CLICK,
      KeyboardEventModifier.CTRL,
    );
    viewer.screenSpaceEventHandler.setInputAction(
      (movement: { position: unknown }) => pickAt(movement.position, true),
      ScreenSpaceEventType.LEFT_CLICK,
      KeyboardEventModifier.SHIFT,
    );

    /*
     * ── Map navigation ─────────────────────────────────────────────────────────────────────
     * The shared bindings used across the twins:
     *
     *   left drag                 orbit around the picked point
     *   Shift / Ctrl + left drag  pan   <- "shift does the move"
     *   right drag                pan
     *   wheel, middle drag        zoom
     *
     * ⚠️ CESIUM NAMES THESE THE OTHER WAY ROUND, which is the trap. In a 3D scene Cesium's
     * `rotate` is the one that carries you ACROSS the globe - it spins the ellipsoid under the
     * camera, so it is the *pan* - while `tilt` swings the camera around the picked point, which
     * is the *orbit*. Binding by name rather than by behaviour gets it exactly backwards.
     *
     * ⚠️ `lookEventTypes` MUST BE CLEARED. Cesium binds free-look to Shift+left by default, which
     * is precisely the chord being claimed for pan; left as-is the two fight and the view yaws
     * instead of moving. Free look belongs to the drone, and only while it is engaged.
     */
    const camCtrl = viewer.scene.screenSpaceCameraController;
    camCtrl.tiltEventTypes = [CameraEventType.LEFT_DRAG, CameraEventType.PINCH];
    camCtrl.rotateEventTypes = [
      CameraEventType.RIGHT_DRAG,
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    ];
    camCtrl.zoomEventTypes = [
      CameraEventType.WHEEL,
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.PINCH,
    ];
    camCtrl.lookEventTypes = [];

    // The damped feel of the other twins (OrbitControls `dampingFactor 0.08`) rather than
    // Cesium's very slidey default.
    camCtrl.inertiaSpin = 0.7;
    camCtrl.inertiaTranslate = 0.7;
    camCtrl.inertiaZoom = 0.7;
    camCtrl.minimumZoomDistance = 40;
    camCtrl.maximumZoomDistance = 60_000;
    camCtrl.enableCollisionDetection = true;

    // ── Free flight ─────────────────────────────────────────────────────────
    // The same merged map+drone camera as the other twins: no button, the keys are the control.
    // Inertia and gimbal lag match the Campus/Gleitschirm feel rather than the rigid Flut default.
    const fly = createFlyControls({
      scene: viewer.scene,
      camera: viewer.camera,
      canvas: viewer.scene.canvas,
      cruiseMinMs: 25,
      cruiseMaxMs: 900,
      cruiseDefaultMs: 180,
      boost: 3,
      accelerateTauS: 0.28,
      brakeTauS: 0.16,
      lookTauS: 0.07,
    });
    flyRef.current = fly;

    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      flyRef.current?.update(Math.min((now - last) / 1000, 0.1));
      last = now;
    };
    viewer.scene.preUpdate.addEventListener(tick);

    /*
     * ── Orbit limit ────────────────────────────────────────────────────────────────────────
     * `OrbitControls` clamps the polar angle so an orbit can never sail over the zenith. Cesium's
     * tilt has NO equivalent property and will happily go over the top, leaving the camera at
     * roll 180 - silently inverted, with every later drag reading mirrored. There is nothing to
     * configure, so the limit is enforced by holding the last legal pose and snapping back to it
     * on the first frame that leaves the range.
     *
     * ⚠️ Not while flying. A drone legitimately pitches up and rolls; clamping then would fight
     * the pilot for the camera every single frame.
     */
    const MIN_PITCH = CesiumMath.toRadians(-89.5);
    const MAX_PITCH = CesiumMath.toRadians(-3.6);
    const MAX_ROLL = CesiumMath.toRadians(1);
    let lastLegal: { position: Cartesian3; heading: number; pitch: number } | null = null;
    const clampOrbit = () => {
      if (flyRef.current?.engaged) {
        lastLegal = null; // the pilot's pose is not a map pose; don't snap back to it later
        return;
      }
      const cam = viewer.camera;
      const legal =
        cam.pitch >= MIN_PITCH &&
        cam.pitch <= MAX_PITCH &&
        Math.abs(CesiumMath.negativePiToPi(cam.roll)) <= MAX_ROLL;
      if (legal) {
        lastLegal = {
          position: Cartesian3.clone(cam.positionWC, lastLegal?.position),
          heading: cam.heading,
          pitch: cam.pitch,
        };
      } else if (lastLegal) {
        cam.setView({
          destination: lastLegal.position,
          orientation: { heading: lastLegal.heading, pitch: lastLegal.pitch, roll: 0 },
        });
      } else {
        // No anchor to return to - the hand-back from a flight that ended nose-up. Ease the pitch
        // to the nearest legal value and keep everything else the pilot chose.
        const pitch = CesiumMath.clamp(cam.pitch, MIN_PITCH, MAX_PITCH);
        lastLegal = { position: Cartesian3.clone(cam.positionWC), heading: cam.heading, pitch };
        cam.setView({
          destination: lastLegal.position,
          orientation: { heading: lastLegal.heading, pitch, roll: 0 },
        });
      }
    };
    viewer.scene.preRender.addEventListener(clampOrbit);

    // Dev-only handle so the camera can be driven from an automated render check.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__cesiumViewer = viewer;
    }

    return () => {
      disposed = true;
      stateRef.current.clear();
      buildingsRef.current = null;
      flyRef.current?.dispose();
      flyRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ---- textured LoD2 buildings -------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;

    void Cesium3DTileset.fromUrl(LOD2_TEXTURED_TILESET, {
      // Cesium's default (16) is what keeps the facades crisp at street level; the cache cap keeps
      // a long session from growing without bound while panning across the city.
      maximumScreenSpaceError: 16,
      cacheBytes: 768 * 1024 * 1024,
      maximumCacheOverflowBytes: 256 * 1024 * 1024,
    })
      .then((tileset) => {
        if (cancelled || viewer.isDestroyed()) return;
        // Multiplies the facade textures, so it tints the untextured buildings without flattening
        // the textured ones. See BUILDING_TINT for why the dataset needs it.
        tileset.style = new Cesium3DTileStyle({ color: `color('${BUILDING_TINT}')` });
        viewer.scene.primitives.add(tileset);
        buildingsRef.current = tileset;
      })
      .catch((error) => {
        console.error('[cesium] buildings tileset failed to load', LOD2_TEXTURED_TILESET, error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- vehicles -----------------------------------------------------------
  const vehicleIndex = useMemo(() => new Map(vehicles.map((v) => [v.vehicleId, v])), [vehicles]);
  const selectedIndex = useMemo(
    () => new Map(selectedIds.map((id, index) => [id, index])),
    [selectedIds],
  );

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const entities = viewer.entities;
    const seen = stateRef.current;

    entities.suspendEvents();
    for (const vehicle of vehicles) {
      const trackIndex = selectedIndex.get(vehicle.vehicleId);
      const selected = trackIndex !== undefined;
      const active = vehicle.vehicleId === activeVehicleId;
      const position = Cartesian3.fromDegrees(vehicle.lon, vehicle.lat);
      const colour = Color.fromCssColorString(speedColor(vehicle.speedKmh));
      // Ring a compared vehicle in its track colour so the point and its trail read as one thing.
      const outline = selected
        ? Color.fromCssColorString(trackColor(trackIndex))
        : Color.BLACK;
      const size = active ? 18 : selected ? 15 : 9;

      const existing = entities.getById(vehicle.vehicleId);
      if (existing) {
        existing.position = position as never;
        if (existing.point) {
          existing.point.color = colour as never;
          existing.point.pixelSize = size as never;
          existing.point.outlineColor = outline as never;
          existing.point.outlineWidth = (selected ? 3 : 1) as never;
        }
      } else {
        entities.add({
          id: vehicle.vehicleId,
          position,
          point: {
            pixelSize: size,
            color: colour,
            outlineColor: outline,
            outlineWidth: selected ? 3 : 1,
            // Sit on the mesh surface rather than floating at ellipsoid height.
            heightReference: HeightReference.CLAMP_TO_GROUND,
            // Stay legible when zoomed out over the whole city.
            scaleByDistance: new NearFarScalar(500, 1.4, 25000, 0.5),
            disableDepthTestDistance: 0,
          },
          properties: { [VEHICLE_ID_PROPERTY]: vehicle.vehicleId },
        });
      }
      seen.set(vehicle.vehicleId, { lon: vehicle.lon, lat: vehicle.lat });
    }

    for (const id of [...seen.keys()]) {
      if (!vehicleIndex.has(id)) {
        entities.removeById(id);
        seen.delete(id);
      }
    }
    entities.resumeEvents();
  }, [vehicles, vehicleIndex, selectedIndex, activeVehicleId]);

  // ---- one track per compared vehicle -------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const entities = viewer.entities;
    entities.suspendEvents();

    for (const entity of [...entities.values]) {
      if (typeof entity.id === 'string' && entity.id.startsWith(TRACK_ID_PREFIX)) {
        entities.remove(entity);
      }
    }

    for (const [id, index] of selectedIndex) {
      const points = paths.get(id) ?? [];
      if (points.length < 2) continue;
      entities.add({
        id: TRACK_ID_PREFIX + id,
        polyline: {
          positions: Cartesian3.fromDegreesArray(points.flatMap((p) => [p.lon, p.lat])),
          width: id === activeVehicleId ? 5 : 3,
          material: Color.fromCssColorString(trackColor(index)),
          clampToGround: true,
        },
      });
    }

    entities.resumeEvents();
  }, [paths, selectedIndex, activeVehicleId]);

  // ---- fly to a newly selected vehicle ------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !activeVehicleId) return;
    const vehicle = vehicleIndex.get(activeVehicleId);
    if (!vehicle) return;

    // ⚠️ Hand the camera back FIRST. While the latch is engaged `applyOrientation()` runs every
    // frame and would override the flight immediately.
    flyRef.current?.setEngaged(false);

    const target = Cartographic.fromDegrees(vehicle.lon, vehicle.lat);
    const ground = viewer.scene.globe.getHeight(target) ?? 0;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, ground + 450),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(-45), roll: 0 },
      duration: 1.2,
    });
    // Deliberately keyed on the selection only - re-flying on every position poll would
    // fight the user for control of the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicleId]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="cesium-view" />
      <DroneHud read={readTelemetry} />
      {/*
        There is no drone button - the keys are the whole control - so something has to say that
        flying exists. The hint is the idle half of the pair; the HUD replacing it is the
        statement that the mouse now means something else.
      */}
      <p
        data-testid="drone-hint"
        className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 select-none rounded-full bg-black/45 px-3 py-1 text-[10px] text-white/70 backdrop-blur-sm"
      >
        Drag to orbit · Shift+drag to move · wheel to zoom · or press W A S D to fly
      </p>
    </div>
  );
}
