import * as THREE from 'three';

/**
 * One camera, two behaviours — the orbit map and the drone, merged into a single mode.
 *
 * This replaces the separate free-camera module these apps used to carry, and the toggle that had
 * to guard it. The toggle was never really a feature: it existed because the two camera models
 * bind the same inputs and one of them had to be switched off. Counting them precisely, they
 * collided in four places, not one:
 *
 *   left drag   orbit around the target  ·  look around from where you are
 *   wheel       zoom towards the target  ·  set the cruise speed
 *   Shift+drag  pan (OrbitControls binds ctrl/meta/shift on the left button)  ·  boost
 *   arrow keys  pan (OrbitControls' `keys`, dormant only because `listenToKeyEvents()`
 *               is never called)        ·  look
 *
 * Everything else was already free: W A S D Q E R F mean nothing to OrbitControls, and the middle
 * and right buttons and every touch gesture mean nothing to the drone.
 *
 * So the merge is not "put both sets of bindings on at once" — that is impossible. It is: **decide
 * which of the two the viewer is doing right now, and bind the four contested inputs accordingly.**
 * The decision is a latch, not a toggle, and the viewer sets it with the keys they were going to
 * press anyway:
 *
 *   not engaged → the map. Drag orbits, the wheel zooms. Exactly as before.
 *   press W A S D Q E R F → engaged. The camera is now flying, so drag looks and the wheel is the
 *     throttle — because while you are flying there is no orbit centre for either of them to mean
 *     anything against.
 *   stop pressing → after {@link DISENGAGE_MS} it hands the camera back to the map, in place.
 *     Escape hands it back at once, for anyone who does not want to wait.
 *
 * The eight movement keys are six behaviours, not four: W A S D translate, Q and E translate
 * vertically, and R and F **swing the camera around whatever is in the middle of the view**. R and
 * F used to be a second pair of up/down keys — literally `held.has('e') || held.has('r')` — which
 * is a key doing nothing, because nobody presses two keys for one thing. Circling the thing you
 * are looking at is the one camera move a drone cannot otherwise make: W A S D + drag can approach
 * it and can look at it, but keeping it centred while going round it needs both at once, in
 * opposite directions, at a rate that depends on the distance. See {@link SPIN_PER_SECOND}.
 *
 * ⚠️ **The grace window is the whole design, not a detail.** Disengaging the moment the keys come
 * up would mean the wheel changed meaning while the viewer was still flying — reach for it to trim
 * the speed between two hops and you would zoom the map instead. So there has to be a window; the
 * only question is how long.
 *
 * It is a second. Two was the first guess and it was measurably too slow in use: the overwhelmingly
 * common thing to do after flying is to go back to the map, and every one of those is spent waiting
 * for a control that has already made up its mind. Adjusting the throttle *between* two hops is the
 * rarer case, and it is covered anyway — touching the wheel resets the window, so the only exposure
 * is the reach itself.
 *
 * ⚠️ **Nothing here is app-specific.** It imports `three` and nothing else, talks to the orbit
 * camera through the structural {@link OrbitLike} interface rather than through the
 * `three/examples` class, and takes every number as an option. Porting it to another twin is:
 * copy this file, and in the host scene replace the `enable/disable` calls with one
 * `createFlyControls(...)` and one `if (fly.engaged)` in the render loop. `groundAt` is optional,
 * so an app with no heightmap to hand still gets everything except the height-scaled speed.
 *
 * Two of those options exist purely so the port does not change how an app already felt:
 * {@link FlyControlsOptions.accelerateTauS} gives the camera mass, and
 * {@link FlyControlsOptions.lookTauS} puts the look on a stabiliser. A twin whose drone had them
 * before the merge passes them in and keeps its feel exactly; a map camera that never eased leaves
 * them out and the arithmetic collapses to what it was.
 *
 * ⚠️ **Keep this file identical across the apps that use it.** Every app-specific number is an
 * option and every app-specific fact is in the host scene, so there is nothing here to tailor —
 * and the moment one copy is edited in place, the next fix has to be found and re-made in each of
 * them separately.
 */

/**
 * The part of OrbitControls this needs, as a shape rather than as a class.
 *
 * Structural on purpose: it keeps this file out of the `three/examples/jsm` import path, so it also
 * works with MapControls, with a vendored fork, and with a stub in a unit test. Every field here is
 * read, not assumed — the polar and distance limits in particular, because the hand-back has to
 * respect limits it did not set.
 */
export interface OrbitLike {
  enabled: boolean;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update(): unknown;
}

/**
 * Terrain elevation under a world position, in the same units the camera uses, or null off the map.
 *
 * Optional. Supplied it does two things: scales the flying speed by height above ground, and lets
 * the hand-back put the orbit centre on the terrain the viewer was looking at rather than at a
 * fixed distance in mid-air.
 *
 * ⚠️ If the host draws its terrain with vertical exaggeration, this must return the **drawn**
 * elevation, not the surveyed one. It is compared against `camera.position.y`, which is in drawn
 * units.
 */
export type GroundSampler = (x: number, z: number) => number | null;

export interface FlyTelemetry {
  /** Whether the drone currently owns the camera. */
  engaged: boolean;
  /** The wheel's throttle setting in m/s, before the boost. */
  cruiseMs: number;
  /**
   * The same setting as 0..1 across the usable range, for a throttle bar.
   *
   * Absolute metres per second mean nothing to anyone; where the setting sits in its range is
   * exactly what you want to know before reaching for the wheel again. Computed here because only
   * this module knows what range the host configured, and it is a geometric scale, so the fraction
   * is logarithmic rather than linear.
   */
  cruise: number;
  /** How fast the camera moved on the last frame, m/s. Zero whenever no key is held. */
  speedMs: number;
  /** The camera's height in world units — metres above sea level in a true-scale scene. */
  altitudeM: number;
  /** Height above the terrain below, or null with no sampler or off the map. */
  aglM: number | null;
  /** Compass heading of the view direction, degrees clockwise from north (−Z). */
  headingDeg: number;
}

export interface FlyControls {
  /** Whether the drone owns the camera. Flips by itself — subscribe via `onEngagedChange`. */
  readonly engaged: boolean;
  /** Current cruise speed in m/s, before the shift boost. Moved by the wheel while engaged. */
  readonly cruiseMs: number;
  /**
   * Engage or hand back explicitly — for a button, a voice command, or a tour taking the camera.
   * Deferred to the end of the gesture if a pointer is currently down.
   */
  setEngaged(on: boolean): void;
  /** Advance the camera, and run the disengage timer. Call only while `engaged`. */
  update(dt: number): void;
  /** Read the instruments. Cheap — returns what the last update already computed. */
  telemetry(): FlyTelemetry;
  dispose(): void;
}

export interface FlyControlsOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  controls: OrbitLike;
  /** Optional terrain sampler. See {@link GroundSampler}. */
  groundAt?: GroundSampler;
  /**
   * Called whenever the latch flips, for whatever reason — including by itself.
   *
   * The host uses this to cancel anything else that drives the camera (a flight in progress, a
   * tour, a follow) when the drone takes over, and to update whatever tells the viewer which
   * behaviour the mouse currently has.
   */
  onEngagedChange?: (engaged: boolean) => void;
  cruiseMinMs?: number;
  cruiseMaxMs?: number;
  cruiseDefaultMs?: number;
  cruiseStep?: number;
  boost?: number;
  /** Milliseconds of no movement key before the camera goes back to the map. */
  disengageMs?: number;
  /** Fallback orbit distance for the hand-back when there is no ground to aim at. */
  handoffDistanceM?: number;
  /** Height above ground at which the cruise setting means exactly what it says. */
  referenceAglM?: number;
  /**
   * How far the height-above-ground scaling is allowed to slow the camera down and speed it up.
   *
   * The defaults suit a landscape with hundreds of metres of relief. A twin working at a different
   * scale needs a different range — a harbour whose reference height is a mast top wants to reach
   * much further up than 2.6x, because everything above the mast is *far* above it.
   */
  aglScaleMin?: number;
  aglScaleMax?: number;
  /**
   * Give the camera mass. Seconds to close ~63 % of the gap to the speed the keys are asking for.
   *
   * Omitted, the camera reaches its speed on the frame the key goes down and stops on the frame it
   * comes up — which is what a map camera should do, and what this app has always done. Supplied,
   * velocity eases in and out instead, which is the difference between a camera that flies and one
   * that teleports. Apps that had that feel before the merge should keep it; see
   * {@link brakeTauS} for why the two are separate.
   */
  accelerateTauS?: number;
  /**
   * Seconds to shed speed once the keys are released. Only used when {@link accelerateTauS} is.
   *
   * Deliberately shorter than accelerating: coasting is what makes the camera feel like it weighs
   * something, but coasting *past* what you were trying to look at is just a fight.
   */
  brakeTauS?: number;
  /**
   * Put the look on a stabiliser. Seconds for the view to close ~63 % of the gap to the pointer.
   *
   * Omitted, the camera looks exactly where the pointer says, immediately. Supplied, it chases —
   * and although the lag is tiny (~70 ms is plenty) it is the whole difference between "mouse
   * attached to eyeballs" and "camera on a gimbal".
   */
  lookTauS?: number;
  /** Radians per second that R and F swing the camera around the view centre. */
  spinPerSecond?: number;
}

/**
 * The cruise range the wheel moves through, in metres per second.
 *
 * A single fixed speed was always going to be wrong twice: too fast to read a street, too slow to
 * get to the next valley. Steps are geometric because that is how speed is perceived — 40 to 80
 * feels like the same change as 400 to 800. These defaults suit an AOI of a few tens of
 * kilometres; a host with a different one passes its own.
 */
export const CRUISE_MIN_MS = 25;
export const CRUISE_MAX_MS = 1_200;
export const CRUISE_DEFAULT_MS = 200;
export const CRUISE_STEP = 1.18;

/**
 * Shift multiplier — a temporary sprint, not the way to set speed.
 *
 * ⚠️ Keep it modest. A boost large enough to be the *only* speed control, which is what it used to
 * be before the wheel became a throttle, leaves the AOI in a keystroke once it is multiplying a
 * throttle that already reaches the top of the cruise range.
 */
export const BOOST = 4;

/**
 * How long the drone keeps the camera after the last key comes up. See the header for why there is
 * a window at all, and why this is the length of it.
 *
 * ⚠️ Do not raise this back to two seconds without flying the thing first. It reads as the control
 * being slow to let go, because going back to the map is the common case and waiting for it is the
 * whole of the interaction.
 */
export const DISENGAGE_MS = 1_000;

/** Where the orbit centre lands on hand-back when there is no terrain under the view ray. */
export const HANDOFF_DISTANCE_M = 1_200;

/**
 * Height above ground at which the cruise setting means exactly what it says.
 *
 * Below it the camera slows down and above it speeds up, so that "close to the ground" and
 * "precise" become the same thing without the viewer having to manage a speed control at all. Only
 * active when the host supplies a {@link GroundSampler}.
 */
export const REFERENCE_AGL_M = 400;
export const AGL_SCALE_MIN = 0.22;
export const AGL_SCALE_MAX = 2.6;

/** Radians per pixel of pointer travel, and per second of held arrow key. */
const LOOK_PER_PIXEL = 0.0022;
const LOOK_PER_SECOND = 1.1;

/**
 * How fast R and F swing the camera around the point in the middle of the view, radians per second.
 *
 * ⚠️ Angular, not linear, and that is the point of the whole feature: the camera keeps its distance
 * from the centre, so the same key gives a slow crawl around a single building and a wide sweep
 * around a valley without anybody setting anything. It is deliberately **not** scaled by the cruise
 * throttle for the same reason — the throttle is metres per second, and metres per second around a
 * circle is a different lap time at every radius.
 *
 * A little over half a radian is ~10 s for a full lap: fast enough to see the far side without
 * waiting, slow enough that a tap nudges the view rather than spinning it.
 */
export const SPIN_PER_SECOND = 0.6;

/** Keys that fly the camera. Pressing any of them is what engages the drone. */
const MOVEMENT_KEYS = 'wasdqerf';
const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/**
 * Angular margin kept clear of `maxPolarAngle` when handing the camera back, in radians.
 *
 * ⚠️ This is the fix for a snap that was in the app from the day free-fly landed. `update()` clamps
 * the polar angle **unconditionally, every frame** — not only when something rotated. So if the
 * hand-back derives an orbit target from a level or upward view direction, the offset from target
 * to camera points at or above the horizon, its polar angle exceeds `maxPolarAngle` (0.48π here),
 * the very next `update()` clamps it, and the camera jumps. With a 0.48π limit that fired for any
 * view pitched up by more than −3.6°, which is nearly all of them.
 */
const PHI_MARGIN_RAD = 0.03;

/** How many samples the hand-back ray takes against the terrain before giving up. */
const GROUND_MARCH_STEPS = 48;

/**
 * Below this speed the camera is parked, m/s.
 *
 * Only relevant with inertia: an exponential approach never actually reaches zero, and a camera
 * that is still moving by a millimetre a second is a scene that will not hold still.
 */
const PARKED_MS = 0.1;

/** Frame-rate-independent exponential approach. Without the exp, damping changes with frame rate. */
function approach(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

export function createFlyControls(options: FlyControlsOptions): FlyControls {
  const {
    camera,
    domElement,
    controls,
    groundAt,
    onEngagedChange,
    cruiseMinMs = CRUISE_MIN_MS,
    cruiseMaxMs = CRUISE_MAX_MS,
    cruiseDefaultMs = CRUISE_DEFAULT_MS,
    cruiseStep = CRUISE_STEP,
    boost = BOOST,
    disengageMs = DISENGAGE_MS,
    handoffDistanceM = HANDOFF_DISTANCE_M,
    referenceAglM = REFERENCE_AGL_M,
    aglScaleMin = AGL_SCALE_MIN,
    aglScaleMax = AGL_SCALE_MAX,
    accelerateTauS,
    brakeTauS = accelerateTauS,
    lookTauS,
    spinPerSecond = SPIN_PER_SECOND,
  } = options;

  // Both are opt-in, and both are read once here so the hot path is a boolean rather than a
  // pair of undefined checks per frame.
  const hasInertia = accelerateTauS !== undefined && accelerateTauS > 0;
  const hasLookLag = lookTauS !== undefined && lookTauS > 0;

  const held = new Set<string>();
  let engaged = false;
  let dragging = false;
  /**
   * Whether any pointer is down, of any button, whichever camera model it belongs to.
   *
   * ⚠️ The latch must never flip in the middle of a gesture. OrbitControls keeps its own drag state
   * and a captured pointer; disabling it mid-drag leaves that state stale, and the first move after
   * it comes back applies the whole accumulated delta at once — the view snaps sideways for no
   * reason the viewer can see. So a flip requested during a drag waits for the button to come up.
   */
  let pointerDown = false;
  let pendingEngaged: boolean | null = null;

  let yaw = 0;
  let pitch = 0;
  /**
   * Where the gimbal is being *asked* to point, as against where it points.
   *
   * The two are the same value without {@link FlyControlsOptions.lookTauS}; with it, the pointer
   * moves the target and the camera catches up in `update()`.
   */
  let targetYaw = 0;
  let targetPitch = 0;
  let cruiseMs = cruiseDefaultMs;
  /** Seconds since the last movement key was held. Drives the hand-back. */
  let idleS = 0;
  let speedMs = 0;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const move = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const targetVelocity = new THREE.Vector3();
  const spinAim = new THREE.Vector3();
  const spinOffset = new THREE.Vector3();
  /**
   * The point R and F are swinging around, latched while either is held.
   *
   * ⚠️ Latched on purpose, and this is the only subtle thing about the feature. Re-deriving the
   * centre from the view ray every frame sounds simpler and is wrong: the ray lands somewhere
   * slightly different from each new camera position — further away as the terrain falls off,
   * nearer as it rises — so the "circle" walks across the map and the thing being looked at slides
   * out of frame. Sampling once and holding it is what makes it an orbit rather than a drift.
   * Cleared when both keys come up, so the next press picks up whatever is centred *then*.
   */
  let spinCentre: THREE.Vector3 | null = null;

  /** Adopt the camera's current orientation, so engaging never snaps the view. */
  const syncFromCamera = () => {
    camera.getWorldDirection(scratch);
    targetYaw = Math.atan2(-scratch.x, -scratch.z);
    targetPitch = Math.asin(THREE.MathUtils.clamp(scratch.y, -1, 1));
    yaw = targetYaw;
    pitch = targetPitch;
  };

  const applyOrientation = () => {
    // Yaw then pitch, no roll. A camera that can roll tilts the horizon, and a tilted horizon in a
    // terrain app reads as the terrain being wrong rather than the camera.
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  };

  const clampPitch = (value: number) =>
    // Stop just short of vertical: passing straight through flips the yaw by 180°, which is
    // disorienting and has no use.
    THREE.MathUtils.clamp(value, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

  /**
   * Tilt a view direction just far enough below the horizon that the orbit camera will accept it.
   *
   * The bearing is kept; only the pitch moves, and only when it has to. See {@link PHI_MARGIN_RAD}
   * for why it has to at all.
   */
  const clampToOrbitablePitch = (direction: THREE.Vector3) => {
    // offset = camera − target = −direction · d, so the orbit polar angle is acos(−direction.y).
    // Requiring that to stay under maxPolarAngle means direction.y ≤ −cos(maxPolarAngle).
    const limit = Math.min(controls.maxPolarAngle, Math.PI - controls.minPolarAngle);
    const maxDirectionY = -Math.cos(Math.max(0, limit - PHI_MARGIN_RAD));
    if (direction.y <= maxDirectionY) return;

    const horizontal = Math.max(Math.hypot(direction.x, direction.z), 1e-4);
    const wantY = THREE.MathUtils.clamp(maxDirectionY, -0.999, 0.999);
    const scale = Math.sqrt(Math.max(0, 1 - wantY * wantY)) / horizontal;
    direction.set(direction.x * scale, wantY, direction.z * scale).normalize();
  };

  /**
   * How far along the view ray the terrain is, or null if the ray never reaches it.
   *
   * A coarse march then one bisection. Exactness does not matter — this only decides where the
   * orbit centre lands, and being a few metres inside the hillside is invisible. What matters is
   * that the centre ends up on the ground the viewer was looking at, so the first drag after the
   * hand-back orbits that rather than a point hanging in the air in front of them.
   */
  const groundDistanceAlong = (direction: THREE.Vector3): number | null => {
    if (!groundAt) return null;
    const far = Math.max(controls.maxDistance, handoffDistanceM);
    const step = far / GROUND_MARCH_STEPS;
    let previous = 0;
    for (let i = 1; i <= GROUND_MARCH_STEPS; i++) {
      const distance = i * step;
      scratch.copy(camera.position).addScaledVector(direction, distance);
      const ground = groundAt(scratch.x, scratch.z);
      if (ground === null) return null;
      if (scratch.y <= ground) {
        // Bisect once between the last miss and this hit.
        let low = previous;
        let high = distance;
        for (let k = 0; k < 8; k++) {
          const mid = (low + high) / 2;
          scratch.copy(camera.position).addScaledVector(direction, mid);
          const midGround = groundAt(scratch.x, scratch.z);
          if (midGround === null) return null;
          if (scratch.y <= midGround) high = mid;
          else low = mid;
        }
        return high;
      }
      previous = distance;
    }
    return null;
  };

  /**
   * Swing the camera around whatever is in the middle of the view, keeping it in the middle.
   *
   * Two things move together, by the same angle, or the centre does not stay centred: the camera's
   * position rotates about the vertical axis through the centre, and the yaw rotates with it. Both
   * `yaw` and `targetYaw` take the delta — adding it only to the target would make the spin fight
   * the look lag, and adding it only to `yaw` would have the lag undo it on the next frame.
   *
   * Height and pitch are untouched, so the camera travels a horizontal circle at a fixed distance
   * and a fixed angle. That is what makes this the move W A S D cannot do: an arc around a point
   * needs a translation and a rotation at rates that depend on the radius.
   */
  const spinAroundViewCentre = (delta: number) => {
    if (!spinCentre) {
      camera.getWorldDirection(spinAim);
      // No terrain under the ray — looking at the sky, or off the edge of the map — leaves nothing
      // to circle, so fall back to the same fixed distance the hand-back uses. The camera then
      // orbits a point hanging in front of it, which is still the right shape of motion.
      const distance = groundDistanceAlong(spinAim) ?? handoffDistanceM;
      spinCentre = new THREE.Vector3()
        .copy(camera.position)
        .addScaledVector(spinAim, distance);
    }

    spinOffset.subVectors(camera.position, spinCentre).setY(0);
    spinOffset.applyAxisAngle(up, delta);
    camera.position.x = spinCentre.x + spinOffset.x;
    camera.position.z = spinCentre.z + spinOffset.z;

    yaw += delta;
    targetYaw += delta;
    applyOrientation();
  };

  /**
   * Give the camera back to the orbit controls, in place.
   *
   * Two things have to be true afterwards or the hand-back is visible: the orbit centre must be
   * something the viewer was actually looking at, and the resulting offset must already satisfy
   * every limit `update()` will impose, because `update()` enforces them by moving the camera.
   */
  const handBackToOrbit = () => {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    clampToOrbitablePitch(direction);

    const hit = groundDistanceAlong(direction);
    const distance = THREE.MathUtils.clamp(
      hit ?? handoffDistanceM,
      // Inside the limits rather than on them: sitting exactly on `minDistance` means the first
      // scroll-in has nowhere to go and reads as a stuck wheel.
      controls.minDistance * 1.05,
      controls.maxDistance * 0.95
    );

    controls.target.copy(camera.position).addScaledVector(direction, distance);
    controls.enabled = true;
    controls.update();
  };

  const applyEngaged = (next: boolean) => {
    if (next === engaged) return;
    engaged = next;
    idleS = 0;
    speedMs = 0;
    // Never left coasting: the orbit camera takes over on the next frame, and a leftover velocity
    // would be applied the next time the drone is engaged, minutes later and somewhere else.
    velocity.set(0, 0, 0);
    // Same argument for the spin centre: it is a point in this scene at this moment, and holding it
    // across a hand-back would put the next spin around somewhere the viewer has long since left.
    spinCentre = null;
    if (engaged) {
      // ⚠️ The two camera models must never both be live. OrbitControls writes the camera's
      // position and quaternion every frame from its own target, so leaving it enabled would drag
      // the drone back towards the orbit centre as fast as the keys pushed it away.
      controls.enabled = false;
      // ⚠️ Shift is contested: held down it means "pan" to the orbit camera and "boost" to this
      // one. Somebody who was shift-dragging the map and then presses W would otherwise get a
      // 4x sprint they never asked for. Dropping it here means the boost only ever starts from a
      // Shift pressed *while flying*.
      held.delete('shift');
      syncFromCamera();
      applyOrientation();
    } else {
      held.clear();
      dragging = false;
      handBackToOrbit();
    }
    onEngagedChange?.(engaged);
  };

  /** Flip the latch, or queue the flip until the current gesture ends. */
  const requestEngaged = (next: boolean) => {
    if (pointerDown && next !== engaged) {
      pendingEngaged = next;
      return;
    }
    pendingEngaged = null;
    applyEngaged(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Never swallow the browser's own shortcuts, and never fight a text field or the timeline
    // scrubber — which is a range input and uses the arrow keys.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    const key = event.key.toLowerCase();

    if (MOVEMENT_KEYS.includes(key)) {
      held.add(key);
      idleS = 0;
      event.preventDefault();
      requestEngaged(true);
      return;
    }

    // ⚠️ Both of these are only claimed **while flying**. Shift belongs to the orbit camera's pan
    // otherwise, and swallowing the arrow keys on a page nobody is flying would take them away
    // from anyone navigating it with a keyboard.
    if (!engaged) return;

    // The way out for someone who does not want to wait out the grace window. It matters more
    // than it looks: there is no button any more, so without this the only way to give the map
    // back is to stop touching anything and wait it out.
    if (key === 'escape') {
      // Deliberately not prevented: a panel or a dialog listening for the same key should still
      // close. Escape means "out of whatever I am in", and this is only one of those things.
      requestEngaged(false);
      return;
    }

    if (key === 'shift') {
      held.add(key);
      return;
    }

    if (ARROW_KEYS.has(key)) {
      held.add(key);
      event.preventDefault();
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.key.toLowerCase());
  };

  // Losing focus with a key down leaves it stuck and the camera drifts away on its own for ever,
  // which looks exactly like a crash.
  const onBlur = () => held.clear();

  const onPointerDown = (event: PointerEvent) => {
    pointerDown = true;
    // Touch is left to the orbit camera entirely: `movementX` is not reported for touch pointers in
    // Chromium, so drag-to-look silently does nothing, and a tablet that engaged would be left with
    // no way to move the camera at all.
    if (!engaged || event.button !== 0 || event.pointerType === 'touch') return;
    dragging = true;
    domElement.setPointerCapture(event.pointerId);
  };

  const endPointer = (event: PointerEvent) => {
    pointerDown = false;
    dragging = false;
    if (domElement.hasPointerCapture?.(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
    if (pendingEngaged !== null) {
      const next = pendingEngaged;
      pendingEngaged = null;
      applyEngaged(next);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!engaged || !dragging) return;
    // Only the *target* moves here. With a look lag the camera catches up in `update()`, which is
    // what turns a twitchy mouse into a stabilised gimbal; without one `update()` copies it across
    // on the same frame, so this is the whole of the behaviour either way.
    targetYaw -= event.movementX * LOOK_PER_PIXEL;
    targetPitch = clampPitch(targetPitch - event.movementY * LOOK_PER_PIXEL);
  };

  const onWheel = (event: WheelEvent) => {
    // ⚠️ Only while flying. With the drone handed back, OrbitControls owns the wheel and it is the
    // map zoom — swallowing it here would break zooming for everyone who never flies.
    if (!engaged) return;
    event.preventDefault();
    const steps = event.deltaY > 0 ? -1 : 1;
    cruiseMs = THREE.MathUtils.clamp(cruiseMs * cruiseStep ** steps, cruiseMinMs, cruiseMaxMs);
    // Touching the throttle is flying, so it keeps the camera as surely as a key does.
    idleS = 0;
  };

  /**
   * The browser menu on a right-click, but only while flying.
   *
   * OrbitControls suppresses it for its own right-drag pan, and stops doing so the moment it is
   * disabled — so without this, reaching for the pan that is not there while flying pops a context
   * menu over the canvas.
   */
  const onContextMenu = (event: MouseEvent) => {
    if (engaged) event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  // ⚠️ Also on the window: a button released outside the canvas would otherwise leave `pointerDown`
  // stuck true for ever, and a stuck gesture means a latch that can never flip again.
  window.addEventListener('pointerup', endPointer);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', endPointer);
  domElement.addEventListener('pointercancel', endPointer);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('contextmenu', onContextMenu);
  // `passive: false` because the handler calls preventDefault: without it the browser scrolls the
  // page behind the canvas while the viewer thinks they are setting a speed.
  domElement.addEventListener('wheel', onWheel, { passive: false });

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
      camera.getWorldDirection(forward);
      const altitudeM = camera.position.y;
      const ground = groundAt?.(camera.position.x, camera.position.z) ?? null;
      return {
        engaged,
        cruiseMs,
        cruise: Math.log(cruiseMs / cruiseMinMs) / Math.log(cruiseMaxMs / cruiseMinMs),
        speedMs,
        altitudeM,
        aglM: ground === null ? null : altitudeM - ground,
        headingDeg: (THREE.MathUtils.radToDeg(Math.atan2(-forward.x, -forward.z)) + 360) % 360,
      };
    },

    update(dt: number) {
      if (!engaged) return;

      // ── Look ────────────────────────────────────────────────────────────
      // The arrow keys are the drag's equivalent for trackpads, and for anyone not using a mouse.
      if (held.has('arrowleft')) targetYaw += LOOK_PER_SECOND * dt;
      if (held.has('arrowright')) targetYaw -= LOOK_PER_SECOND * dt;
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
        const k = approach(dt, lookTauS!);
        yaw += (targetYaw - yaw) * k;
        pitch += (targetPitch - pitch) * k;
      } else {
        yaw = targetYaw;
        pitch = targetPitch;
      }
      applyOrientation();

      // ── Spin ────────────────────────────────────────────────────────────
      // Before the move, so W flies along the bearing this frame's spin produced rather than the
      // previous one's — a stale forward vector is what makes a combined key feel like it lags.
      const spin = (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0);
      if (spin !== 0) {
        idleS = 0;
        spinAroundViewCentre(spin * spinPerSecond * dt);
      } else {
        spinCentre = null;
      }

      // ── Move ────────────────────────────────────────────────────────────
      camera.getWorldDirection(forward);
      right.crossVectors(forward, up).normalize();

      move.set(0, 0, 0);
      if (held.has('w')) move.addScaledVector(forward, 1);
      if (held.has('s')) move.addScaledVector(forward, -1);
      if (held.has('d')) move.addScaledVector(right, 1);
      if (held.has('a')) move.addScaledVector(right, -1);
      if (held.has('e')) move.addScaledVector(up, 1);
      if (held.has('q')) move.addScaledVector(up, -1);

      const moving = move.lengthSq() > 0;
      if (moving) {
        idleS = 0;

        // Height above ground sets the scale, exactly as it does in every map globe: what lets you
        // cross the valley in a few seconds makes it impossible to ease along a street.
        let aglScale = 1;
        if (groundAt) {
          const ground = groundAt(camera.position.x, camera.position.z);
          // Off the edge of the map there is no ground to be relative to, so the cruise setting is
          // taken at face value rather than guessed at.
          if (ground !== null) {
            aglScale = THREE.MathUtils.clamp(
              Math.max(camera.position.y - ground, 0) / referenceAglM,
              aglScaleMin,
              aglScaleMax
            );
          }
        }

        // Normalising means a diagonal is not faster than a straight line — the classic free-camera
        // bug, and impossible to unsee once noticed.
        targetVelocity
          .copy(move.normalize())
          .multiplyScalar(cruiseMs * aglScale * (held.has('shift') ? boost : 1));
      } else {
        targetVelocity.set(0, 0, 0);
      }

      if (hasInertia) {
        velocity.lerp(targetVelocity, approach(dt, moving ? accelerateTauS! : brakeTauS!));
        // An exponential approach never actually arrives, and a camera still drifting by a
        // millimetre a second is a scene that will not hold still.
        if (velocity.lengthSq() < PARKED_MS * PARKED_MS) velocity.set(0, 0, 0);
      } else {
        velocity.copy(targetVelocity);
      }

      speedMs = velocity.length();
      if (speedMs > 0) camera.position.addScaledVector(velocity, dt);

      // ⚠️ The hand-back is counted from the last *key*, not from the last movement. With inertia
      // the camera coasts for a moment after the keys come up, and disengaging on "not moving any
      // more" would put the grace window on a timer the viewer never set — which is the one thing
      // this design is trying not to do. Dragging holds it too: looking around is flying, and the
      // latch must not flip inside a gesture. So does spinning, which moves the camera without
      // ever touching `velocity`.
      if (!moving && spin === 0 && !pointerDown) {
        idleS += dt;
        if (idleS >= disengageMs / 1000) applyEngaged(false);
      }
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerup', endPointer);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointerup', endPointer);
      domElement.removeEventListener('pointercancel', endPointer);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('contextmenu', onContextMenu);
      domElement.removeEventListener('wheel', onWheel);
    },
  };
}
