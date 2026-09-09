import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Quaternion,
  Ray,
  type Camera,
  type Scene,
} from 'cesium';

/**
 * The merged map + drone camera, ported to Cesium.
 *
 * The interaction model is the one used across the Rayfin twins (Flut, Gleitschirm, Campus ×2,
 * Maritime), where it lives in `src/twin3d/flyControls.ts` and imports nothing but `three`. That
 * module cannot be reused here — it drives a `THREE.PerspectiveCamera` and an `OrbitControls`
 * instance, and this app has a Cesium `Camera` and a `ScreenSpaceCameraController`. So this is a
 * port of the *behaviour*, deliberately keeping the names, the option set and the defaults so the
 * two read the same way.
 *
 * ## The latch, not a toggle
 * A drone camera and a map camera bind the same inputs, so something has to decide which one the
 * viewer is driving. That decision is a **latch**:
 *
 * - not engaged → the map. Drag orbits, wheel zooms. Unchanged for anyone who never flies.
 * - press `W A S D Q E R F` → engaged. Drag looks, wheel is the throttle.
 * - {@link DISENGAGE_MS} with no movement key and no drag → hands the camera back, in place.
 *
 * ⚠️ "Flying" is NOT defined as `speed > 0`. Meaning that changes on a timer the viewer did not
 * set is a mode error; the grace window is the design, and touching the wheel resets it.
 *
 * ## Six behaviours from eight keys
 * W A S D translate, Q and E translate vertically, and R and F **swing the camera around whatever
 * is in the middle of the view**. R and F used to be a second pair of up/down keys — literally
 * `held.has('e') || held.has('r')` — which is a key doing nothing, because nobody presses two keys
 * for one thing. Circling the thing you are looking at is the one camera move a drone cannot
 * otherwise make: W A S D + drag can approach it and can look at it, but keeping it centred while
 * going round it needs both at once, in opposite directions, at a rate that depends on the
 * distance. See {@link SPIN_PER_SECOND}.
 *
 * ## What this port does NOT need
 * The Three.js original spends ~120 lines handing the camera back to `OrbitControls`, because
 * `OrbitControls.update()` re-clamps its polar angle every frame and enforces it by *moving the
 * camera* — so any view pitched up snapped on hand-back. Cesium's `ScreenSpaceCameraController`
 * has no orbit target and no polar clamp: it resumes from wherever the camera is left. Re-enabling
 * its inputs IS the hand-back, and the jump is structurally zero rather than measured to be.
 */

/** Slowest cruise, m/s. */
export const CRUISE_MIN_MS = 25;
/** Fastest cruise, m/s. */
export const CRUISE_MAX_MS = 900;
/** Opening cruise, m/s. */
export const CRUISE_DEFAULT_MS = 180;
/** Multiplier per wheel notch. Geometric, so the same flick means the same thing at any speed. */
export const CRUISE_STEP = 1.18;
/** Shift multiplier. */
export const BOOST = 3;

/**
 * How fast R and F swing the camera around the point in the middle of the view, radians per second.
 *
 * ⚠️ Deliberately slow — a shade over a third of a turn per second held down. Fast enough that a
 * full circle round a building is a few seconds rather than a wait, slow enough that a tap nudges
 * the view rather than spinning it.
 */
export const SPIN_PER_SECOND = 0.6;

/**
 * Distance in front of the camera to circle when the view ray hits nothing.
 *
 * Looking at the sky, or past the horizon, leaves no ground point to orbit. Rather than doing
 * nothing — which reads as a broken key — the camera circles a point hanging this far in front of
 * it, which is still the right shape of motion.
 */
export const SPIN_FALLBACK_DISTANCE_M = 600;

/**
 * How long the latch stays engaged after the last movement key or drag.
 *
 * ⚠️ 1000, not 2000. Two seconds read as slow when flown: going back to the map is the common
 * case, and adjusting the throttle between hops resets the window anyway. Do not raise it back
 * without flying it.
 */
export const DISENGAGE_MS = 1_000;

/** Height above ground at which the cruise setting is taken at face value. */
export const REFERENCE_AGL_M = 400;
export const AGL_SCALE_MIN = 0.22;
export const AGL_SCALE_MAX = 2.6;

const LOOK_PER_PIXEL = 0.0022;
const LOOK_PER_SECOND = 1.1;

const MOVEMENT_KEYS = 'wasdqerf';
const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** Below this the camera is parked, so an exponential approach is cut to zero. */
const PARKED_MS = 0.1;
/** Keeps the camera off the poles of its own orientation. */
const PITCH_LIMIT = Math.PI / 2 - 0.02;

export interface FlyTelemetry {
  engaged: boolean;
  /** Configured cruise, m/s — the speed the throttle is *set* to. */
  cruiseMs: number;
  /** Cruise as 0..1 on the log scale the wheel walks, for a throttle bar. */
  cruise: number;
  /** Speed the camera is *actually* moving at, m/s. Differs from `cruiseMs` under inertia. */
  speedMs: number;
  /** Ellipsoidal height, m. */
  altitudeM: number;
  /** Height above terrain, m. Null where the globe has no height to give. */
  aglM: number | null;
  /** Compass heading, degrees, 0 = north. */
  headingDeg: number;
}

export interface FlyControls {
  readonly engaged: boolean;
  readonly cruiseMs: number;
  /** Ask for the latch to flip. Queued to the next `pointerup` if a drag is in progress. */
  setEngaged(on: boolean): void;
  telemetry(): FlyTelemetry;
  /** Advance the camera and run the disengage timer. Safe to call when not engaged. */
  update(dt: number): void;
  dispose(): void;
}

export interface FlyControlsOptions {
  scene: Scene;
  camera: Camera;
  canvas: HTMLCanvasElement;
  /**
   * ⚠️ The UI must FOLLOW the latch, never command it. The keys engage it, so anything drawn from
   * a local `useState` will be wrong the moment someone presses W.
   */
  onEngagedChange?: (engaged: boolean) => void;
  cruiseMinMs?: number;
  cruiseMaxMs?: number;
  cruiseDefaultMs?: number;
  cruiseStep?: number;
  boost?: number;
  /** Radians per second that R and F swing the camera around the view centre. */
  spinPerSecond?: number;
  disengageMs?: number;
  referenceAglM?: number;
  aglScaleMin?: number;
  aglScaleMax?: number;
  /** Seconds to reach ~63 % of cruise. Omit for instant. */
  accelerateTauS?: number;
  /** Seconds to shed ~63 % of speed. Omit for instant. */
  brakeTauS?: number;
  /** Seconds for the gimbal to catch up with the pointer. Omit for a rigid mount. */
  lookTauS?: number;
}

/** Frame-rate independent exponential approach. */
const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const clampPitch = (p: number) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));

export function createFlyControls(options: FlyControlsOptions): FlyControls {
  const {
    scene,
    camera,
    canvas,
    onEngagedChange,
    cruiseMinMs = CRUISE_MIN_MS,
    cruiseMaxMs = CRUISE_MAX_MS,
    cruiseDefaultMs = CRUISE_DEFAULT_MS,
    cruiseStep = CRUISE_STEP,
    boost = BOOST,
    spinPerSecond = SPIN_PER_SECOND,
    disengageMs = DISENGAGE_MS,
    referenceAglM = REFERENCE_AGL_M,
    aglScaleMin = AGL_SCALE_MIN,
    aglScaleMax = AGL_SCALE_MAX,
    accelerateTauS,
    brakeTauS,
    lookTauS,
  } = options;

  const hasInertia = accelerateTauS !== undefined && brakeTauS !== undefined;
  const hasLookLag = lookTauS !== undefined;

  let engaged = false;
  let cruiseMs = cruiseDefaultMs;
  let speedMs = 0;
  let idleS = 0;
  let dragging = false;
  let pendingEngaged: boolean | null = null;

  const held = new Set<string>();

  let yaw = camera.heading;
  let pitch = camera.pitch;
  let targetYaw = yaw;
  let targetPitch = pitch;

  // Scratch, so a 60 Hz loop allocates nothing.
  const velocity = new Cartesian3();
  const move = new Cartesian3();
  const up = new Cartesian3();
  const right = new Cartesian3();
  const scratch = new Cartesian3();
  const carto = new Cartographic();

  /**
   * The point R and F are swinging around, latched while either is held.
   *
   * ⚠️ It has to be latched, not recomputed per frame. Re-picking the view centre every frame
   * would let it drift on to whatever the previous frame's rotation brought into the middle, and
   * the camera would spiral instead of circling.
   */
  let spinCentre: Cartesian3 | null = null;
  const spinRay = new Ray();
  const spinAxis = new Cartesian3();
  const spinOffset = new Cartesian3();
  const spinRotation = new Matrix3();
  const spinQuaternion = new Quaternion();

  function groundHeight(): number | null {
    const c = Cartographic.fromCartesian(camera.positionWC, scene.globe.ellipsoid, carto);
    if (!c) return null;
    // ⚠️ `getHeight` is undefined where no terrain tile is loaded — off the edge, or before the
    // first tiles arrive. Treated as "no ground to be relative to" rather than as sea level, so
    // the cruise setting is taken at face value instead of guessed at.
    const h = scene.globe.getHeight(c);
    return h === undefined ? null : h;
  }

  function altitude(): number {
    const c = Cartographic.fromCartesian(camera.positionWC, scene.globe.ellipsoid, carto);
    return c ? c.height : 0;
  }

  function applyOrientation(): void {
    camera.setView({
      destination: Cartesian3.clone(camera.positionWC, scratch),
      orientation: { heading: yaw, pitch, roll: 0 },
    });
  }

  /**
   * Swing the camera around whatever is in the middle of the view, keeping it in the middle.
   *
   * Two things move together, by the same angle, or the centre does not stay centred: the camera's
   * position rotates about the geodetic up through the centre, and the heading rotates with it.
   * Both `yaw` and `targetYaw` take the delta — adding it only to the target would make the spin
   * fight the look lag, and adding it only to `yaw` would have the lag undo it on the next frame.
   *
   * ⚠️ The heading moves by `-delta` while the position moves by `+delta`. Cesium measures heading
   * clockwise from north, which is the opposite handedness to a right-handed rotation about up; the
   * signs matching would swing the camera and its gaze apart instead of together.
   *
   * Rotating the whole offset about the up axis preserves both its component along that axis and
   * its distance from it, so the camera travels a horizontal circle at a fixed height and radius.
   * That is what makes this the move W A S D cannot do: an arc around a point needs a translation
   * and a rotation at rates that depend on the radius.
   */
  function spinAroundViewCentre(delta: number): void {
    if (!spinCentre) {
      Cartesian3.clone(camera.positionWC, spinRay.origin);
      Cartesian3.clone(camera.directionWC, spinRay.direction);
      const hit = scene.globe.pick(spinRay, scene);
      spinCentre =
        hit ??
        Cartesian3.add(
          camera.positionWC,
          Cartesian3.multiplyByScalar(
            camera.directionWC,
            SPIN_FALLBACK_DISTANCE_M,
            new Cartesian3(),
          ),
          new Cartesian3(),
        );
    }

    scene.globe.ellipsoid.geodeticSurfaceNormal(spinCentre, spinAxis);
    Quaternion.fromAxisAngle(spinAxis, delta, spinQuaternion);
    Matrix3.fromQuaternion(spinQuaternion, spinRotation);

    Cartesian3.subtract(camera.positionWC, spinCentre, spinOffset);
    Matrix3.multiplyByVector(spinRotation, spinOffset, spinOffset);

    yaw -= delta;
    targetYaw -= delta;

    camera.setView({
      destination: Cartesian3.add(spinCentre, spinOffset, scratch),
      orientation: { heading: yaw, pitch, roll: 0 },
    });
  }

  function setEngagedNow(on: boolean): void {
    if (on === engaged) return;
    engaged = on;

    // ⚠️ Cesium's own controller must be off while flying, or every drag both looks AND spins the
    // globe underneath. Re-enabling it IS the hand-back.
    scene.screenSpaceCameraController.enableInputs = !on;

    if (on) {
      // ⚠️ The camera may be sitting in a reference frame from an earlier `lookAtTransform` (the
      // orbit buttons use one). Moving `position` while a transform is set moves it in that frame,
      // which sends the camera somewhere unrelated on the first keypress.
      camera.lookAtTransform(Matrix4.IDENTITY);
      // ⚠️ Shift held for a map pan would otherwise arrive as an instant boost.
      held.delete('shift');
      yaw = targetYaw = camera.heading;
      pitch = targetPitch = clampPitch(camera.pitch);
      idleS = 0;
    } else {
      Cartesian3.clone(Cartesian3.ZERO, velocity);
      speedMs = 0;
      spinCentre = null;
    }
    onEngagedChange?.(on);
  }

  /**
   * ⚠️ NEVER FLIP THE LATCH MID-GESTURE. A pointer is captured and the controller holds drag
   * state; the first move after a flip applies the whole accumulated delta and the view snaps.
   */
  function requestEngaged(on: boolean): void {
    if (dragging) pendingEngaged = on;
    else setEngagedNow(on);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (key === 'shift') held.add('shift');
    if (MOVEMENT_KEYS.includes(key) && key.length === 1) {
      held.add(key);
      idleS = 0;
      requestEngaged(true);
    }
    if (ARROW_KEYS.has(key)) {
      held.add(key);
      // ⚠️ Only swallow the arrows WHILE ENGAGED. Doing it always breaks keyboard navigation and
      // every range slider in the side panel.
      if (engaged) e.preventDefault();
    }
    // ⚠️ Deliberately NOT preventDefault: Escape must still close dialogs and panels. The camera
    // simply takes its own meaning from it as well.
    if (key === 'escape' && engaged) requestEngaged(false);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    held.delete(key);
    if (key === 'shift') held.delete('shift');
  };

  // A window blur leaves keys stuck down for ever — alt-tab away mid-flight and the camera keeps
  // going when you come back.
  const onBlur = () => held.clear();

  const onPointerDown = (e: PointerEvent) => {
    // ⚠️ Touch stays on Cesium's controller unconditionally: Chromium does not report
    // `movementX` for touch, so drag-to-look silently does nothing and the globe stops responding.
    if (e.pointerType === 'touch') return;
    dragging = true;
    if (engaged) idleS = 0;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!engaged || !dragging || e.pointerType === 'touch') return;
    targetYaw += e.movementX * LOOK_PER_PIXEL;
    targetPitch = clampPitch(targetPitch - e.movementY * LOOK_PER_PIXEL);
    idleS = 0;
  };

  // ⚠️ On WINDOW, not the canvas: a drag that ends off the canvas would otherwise never end.
  const onPointerUp = () => {
    dragging = false;
    if (pendingEngaged !== null) {
      const next = pendingEngaged;
      pendingEngaged = null;
      setEngagedNow(next);
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!engaged) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? cruiseStep : 1 / cruiseStep;
    cruiseMs = Math.max(cruiseMinMs, Math.min(cruiseMaxMs, cruiseMs * factor));
    idleS = 0;
  };

  // Only while engaged — Cesium stops suppressing it the moment its own inputs are disabled.
  const onContextMenu = (e: MouseEvent) => {
    if (engaged) e.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('contextmenu', onContextMenu);
  // `passive: false` because the handler calls preventDefault; without it the page scrolls behind
  // the canvas while the viewer thinks they are setting a speed.
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    get engaged() {
      return engaged;
    },
    get cruiseMs() {
      return cruiseMs;
    },

    setEngaged(on: boolean) {
      requestEngaged(on);
    },

    telemetry(): FlyTelemetry {
      const altitudeM = altitude();
      const ground = groundHeight();
      return {
        engaged,
        cruiseMs,
        cruise: Math.log(cruiseMs / cruiseMinMs) / Math.log(cruiseMaxMs / cruiseMinMs),
        speedMs,
        altitudeM,
        aglM: ground === null ? null : altitudeM - ground,
        headingDeg: (CesiumMath.toDegrees(camera.heading) + 360) % 360,
      };
    },

    update(dt: number) {
      if (!engaged) return;

      // ── Look ──────────────────────────────────────────────────────────────
      // The arrows are the drag's equivalent for trackpads, and for anyone not using a mouse.
      if (held.has('arrowleft')) targetYaw -= LOOK_PER_SECOND * dt;
      if (held.has('arrowright')) targetYaw += LOOK_PER_SECOND * dt;
      if (held.has('arrowup')) targetPitch = clampPitch(targetPitch + LOOK_PER_SECOND * dt);
      if (held.has('arrowdown')) targetPitch = clampPitch(targetPitch - LOOK_PER_SECOND * dt);
      if (
        held.has('arrowleft') ||
        held.has('arrowright') ||
        held.has('arrowup') ||
        held.has('arrowdown')
      ) {
        idleS = 0;
      }

      if (hasLookLag) {
        const k = approach(dt, lookTauS);
        yaw += (targetYaw - yaw) * k;
        pitch += (targetPitch - pitch) * k;
      } else {
        yaw = targetYaw;
        pitch = targetPitch;
      }
      applyOrientation();

      // ── Spin ─────────────────────────────────────────────────────────
      // Before the move, so W flies along the bearing this frame's spin produced rather than the
      // previous one's — a stale forward vector is what makes a combined key feel like it lags.
      const spin = (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0);
      if (spin !== 0) {
        idleS = 0;
        spinAroundViewCentre(spin * spinPerSecond * dt);
      } else {
        spinCentre = null;
      }

      // ── Move ─────────────────────────────────────────────────────────
      // Geodetic up, not camera up: pressing E should climb away from the planet, not along
      // whatever the gimbal happens to be doing.
      scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, up);
      Cartesian3.normalize(Cartesian3.cross(camera.directionWC, up, right), right);

      Cartesian3.clone(Cartesian3.ZERO, move);
      if (held.has('w')) Cartesian3.add(move, camera.directionWC, move);
      if (held.has('s')) Cartesian3.subtract(move, camera.directionWC, move);
      if (held.has('d')) Cartesian3.add(move, right, move);
      if (held.has('a')) Cartesian3.subtract(move, right, move);
      if (held.has('e')) Cartesian3.add(move, up, move);
      if (held.has('q')) Cartesian3.subtract(move, up, move);

      const moving = Cartesian3.magnitudeSquared(move) > 0;
      const targetVelocity = scratch;
      if (moving) {
        idleS = 0;

        // Height above ground sets the scale, exactly as it does in every map globe: what lets you
        // cross the harbour in a few seconds makes it impossible to ease along a wharf.
        let aglScale = 1;
        const ground = groundHeight();
        if (ground !== null) {
          aglScale = CesiumMath.clamp(
            Math.max(altitude() - ground, 0) / referenceAglM,
            aglScaleMin,
            aglScaleMax,
          );
        }

        // Normalising means a diagonal is not faster than a straight line — the classic
        // free-camera bug, and impossible to unsee once noticed.
        Cartesian3.multiplyByScalar(
          Cartesian3.normalize(move, move),
          cruiseMs * aglScale * (held.has('shift') ? boost : 1),
          targetVelocity,
        );
      } else {
        Cartesian3.clone(Cartesian3.ZERO, targetVelocity);
      }

      if (hasInertia) {
        const k = approach(dt, moving ? accelerateTauS : brakeTauS);
        Cartesian3.lerp(velocity, targetVelocity, k, velocity);
        // An exponential approach never actually arrives, and a camera still drifting by a
        // millimetre a second is a scene that will not hold still.
        if (!moving && Cartesian3.magnitude(velocity) < PARKED_MS) {
          Cartesian3.clone(Cartesian3.ZERO, velocity);
        }
      } else {
        Cartesian3.clone(targetVelocity, velocity);
      }

      speedMs = Cartesian3.magnitude(velocity);
      if (speedMs > 0) {
        Cartesian3.add(
          camera.positionWC,
          Cartesian3.multiplyByScalar(velocity, dt, scratch),
          scratch,
        );
        camera.setView({
          destination: scratch,
          orientation: { heading: yaw, pitch, roll: 0 },
        });
      }

      // ── The latch ─────────────────────────────────────────────────────────
      if (!moving && !dragging) {
        idleS += dt;
        if (idleS * 1000 >= disengageMs) requestEngaged(false);
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      // ⚠️ Leave the map camera usable if this is disposed mid-flight.
      scene.screenSpaceCameraController.enableInputs = true;
    },
  };
}
