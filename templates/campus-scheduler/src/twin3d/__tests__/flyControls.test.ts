import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOST,
  CRUISE_DEFAULT_MS,
  CRUISE_MAX_MS,
  CRUISE_MIN_MS,
  CRUISE_STEP,
  DISENGAGE_MS,
  HANDOFF_DISTANCE_M,
  REFERENCE_AGL_M,
  SPIN_PER_SECOND,
  createFlyControls,
  type FlyControls,
  type OrbitLike,
} from '../flyControls';

/**
 * The merged camera, tested where it is testable.
 *
 * Two things are covered here that the old `freeFly.test.ts` could not be, because they did not
 * exist: **the latch** — which of the two behaviours the contested inputs currently have — and
 * **the hand-back**, which is the moment the orbit camera is given a target it has to accept.
 *
 * The hand-back is the important one. It carried a snap for as long as free flight existed, and it
 * is invisible in a unit test only if you assert the thing that actually goes wrong: not "is there
 * a target" but "is the offset from that target one that `OrbitControls.update()` will leave
 * alone". `update()` clamps the polar angle *unconditionally, every frame*, so a target derived
 * from a level view is out of bounds and the camera jumps on the very next frame.
 *
 * Looking around still needs a real pointer, so drag-to-look stays in `freefly.spec.ts`.
 */

/** A flat world at 100 m with a hole east of x = 5 000, so the off-map branch is reachable. */
const GROUND_M = 100;
const flatGround = (x: number, _z: number) => (x > 5_000 ? null : GROUND_M);

/**
 * OrbitControls as this module actually uses it: a target, four limits and an `update()`.
 *
 * A stub rather than the real class, which is the point of `OrbitLike` being structural — and it
 * lets the tests assert that `enabled` is driven, which is the invariant that keeps the two camera
 * models from fighting over the same camera.
 */
function stubOrbit(overrides: Partial<OrbitLike> = {}): OrbitLike & { updates: number } {
  return {
    enabled: true,
    target: new THREE.Vector3(),
    minDistance: 50,
    maxDistance: 20_000,
    minPolarAngle: 0,
    maxPolarAngle: Math.PI * 0.48,
    updates: 0,
    update() {
      this.updates++;
    },
    ...overrides,
  };
}

function press(key: string) {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  window.dispatchEvent(event);
  return event;
}
function release(key: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

describe('fly controls', () => {
  let camera: THREE.PerspectiveCamera;
  let dom: HTMLElement;
  let controls: ReturnType<typeof stubOrbit>;
  let fly: FlyControls;

  function build(options: Partial<Parameters<typeof createFlyControls>[0]> = {}) {
    return createFlyControls({ camera, domElement: dom, controls, ...options });
  }

  /** Advance in frames, the way the render loop would. */
  function tick(seconds: number, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) fly.update(step);
  }

  function wheel(deltaY: number) {
    const event = new WheelEvent('wheel', { deltaY, cancelable: true });
    dom.dispatchEvent(event);
    return event;
  }

  function pointer(type: string, { button = 0, pointerType = 'mouse' } = {}) {
    // jsdom has no PointerEvent constructor, and the module only reads `button`, `pointerId` and
    // `pointerType` — so a MouseEvent carrying those is a faithful stand-in. `button` goes through
    // the constructor and the other two through `defineProperty`, because assigning to a
    // MouseEvent's own readonly accessors throws under the strict mode a module is always in.
    const event = new MouseEvent(type, { bubbles: true, button }) as unknown as PointerEvent;
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
  }

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(50, 1.6, 1, 40_000);
    camera.position.set(0, GROUND_M + REFERENCE_AGL_M, 0);
    // Look down −Z, the Three.js default, so "forward" is unambiguous in the assertions.
    camera.lookAt(0, GROUND_M + REFERENCE_AGL_M, -1_000);

    dom = document.createElement('div');
    dom.setPointerCapture = () => {};
    dom.releasePointerCapture = () => {};
    dom.hasPointerCapture = () => false;

    controls = stubOrbit();
    fly = build();
  });

  // ⚠️ Every instance listens on `window`. Leaving one behind means the next test is driving two
  // cameras at once — which showed up as arrow keys being swallowed on a map nobody was flying,
  // by a controls object the test had already forgotten about.
  afterEach(() => {
    fly.dispose();
  });

  // ── The latch ────────────────────────────────────────────────────────────

  describe('the latch', () => {
    it('starts on the map, with the orbit camera in charge', () => {
      expect(fly.engaged).toBe(false);
      expect(controls.enabled).toBe(true);
    });

    /** The whole merge, in one assertion: the key you were going to press is the mode switch. */
    it('engages on a movement key and takes the orbit camera out of the loop', () => {
      press('w');
      expect(fly.engaged).toBe(true);
      // ⚠️ Both live at once means OrbitControls drags the camera back towards its target as fast
      // as the keys push it away.
      expect(controls.enabled).toBe(false);
    });

    it('does not engage on a key that means nothing to it', () => {
      press('k');
      press('Shift');
      press('ArrowUp');
      expect(fly.engaged).toBe(false);
    });

    it('does not engage from a text field, or under a browser shortcut', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      expect(fly.engaged).toBe(false);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
      expect(fly.engaged).toBe(false);
      input.remove();
    });

    /**
     * ⚠️ The grace window is the design. Handing back the moment the key comes up would change what
     * the wheel does while the viewer is still flying — reach for it to trim the speed between two
     * hops and the map would zoom instead.
     */
    it('keeps the camera through a pause shorter than the grace window', () => {
      press('w');
      tick(0.5);
      release('w');
      tick(DISENGAGE_MS / 1000 - 0.5);
      expect(fly.engaged).toBe(true);
    });

    it('hands the camera back after the grace window', () => {
      press('w');
      tick(0.5);
      release('w');
      tick(DISENGAGE_MS / 1000 + 0.2);
      expect(fly.engaged).toBe(false);
      expect(controls.enabled).toBe(true);
    });

    it('restarts the grace window on every key, so a long flight never times out', () => {
      press('w');
      tick(DISENGAGE_MS / 1000 * 3);
      expect(fly.engaged).toBe(true);
    });

    it('counts touching the throttle as flying', () => {
      press('w');
      release('w');
      tick(DISENGAGE_MS / 1000 - 0.3);
      wheel(-1);
      tick(DISENGAGE_MS / 1000 - 0.3);
      expect(fly.engaged).toBe(true);
    });

    it('reports every flip, including the ones it makes itself', () => {
      const onEngagedChange = vi.fn();
      fly.dispose();
      fly = build({ onEngagedChange });

      press('w');
      expect(onEngagedChange).toHaveBeenLastCalledWith(true);
      release('w');
      tick(DISENGAGE_MS / 1000 + 0.2);
      expect(onEngagedChange).toHaveBeenLastCalledWith(false);
      expect(onEngagedChange).toHaveBeenCalledTimes(2);
    });

    it('can be driven explicitly, for a button or a tour taking the camera', () => {
      fly.setEngaged(true);
      expect(fly.engaged).toBe(true);
      fly.setEngaged(false);
      expect(fly.engaged).toBe(false);
    });

    /**
     * ⚠️ Flipping inside a gesture leaves OrbitControls holding a captured pointer and a stale drag
     * state; the first move after it comes back applies the whole accumulated delta at once and the
     * view snaps sideways for no reason the viewer can see.
     */
    it('waits for the button to come up before flipping', () => {
      dom.dispatchEvent(pointer('pointerdown', { button: 0 }));
      press('w');
      expect(fly.engaged).toBe(false);

      dom.dispatchEvent(pointer('pointerup', { button: 0 }));
      expect(fly.engaged).toBe(true);
    });

    it('flips on a button released outside the canvas too', () => {
      dom.dispatchEvent(pointer('pointerdown', { button: 0 }));
      press('w');
      window.dispatchEvent(pointer('pointerup', { button: 0 }));
      expect(fly.engaged).toBe(true);
    });

    it('does not hand back mid-drag, because looking around is flying too', () => {
      press('w');
      release('w');
      dom.dispatchEvent(pointer('pointerdown', { button: 0 }));
      tick(DISENGAGE_MS / 1000 + 1);
      expect(fly.engaged).toBe(true);
    });

    /**
     * ⚠️ This matters more than it looks now that there is no button: without it the only way to
     * give the map back is to stop touching anything and count to two.
     */
    it('hands back at once on Escape', () => {
      press('w');
      expect(fly.engaged).toBe(true);
      press('Escape');
      expect(fly.engaged).toBe(false);
      expect(controls.enabled).toBe(true);
    });

    it('leaves Escape alone while the map already has the camera', () => {
      // Something else on the page owns it then — a dialog, a panel — and this must not swallow it.
      expect(press('Escape').defaultPrevented).toBe(false);
      expect(fly.engaged).toBe(false);
    });

    it('does not swallow Escape even while flying, because other things close on it too', () => {
      press('w');
      expect(press('Escape').defaultPrevented).toBe(false);
    });
  });

  // ── The hand-back ────────────────────────────────────────────────────────

  describe('the hand-back', () => {
    /** The polar angle `OrbitControls.update()` would compute, and then clamp. */
    function phi() {
      return new THREE.Spherical()
        .setFromVector3(camera.position.clone().sub(controls.target)).phi;
    }

    /**
     * ⚠️ The regression this module exists to fix. `update()` clamps the polar angle every frame,
     * so a target derived from a level view — offset exactly on the horizon, phi = 90° — is already
     * out of bounds against a 0.48π limit and the camera jumps on the next frame. That fired for
     * any view pitched up by more than −3.6°, which is nearly all of them.
     */
    it('gives back a target the orbit camera will accept from a level view', () => {
      fly.setEngaged(true);
      fly.setEngaged(false);
      expect(phi()).toBeLessThanOrEqual(controls.maxPolarAngle);
    });

    it('gives back a target the orbit camera will accept from a view pitched up at the sky', () => {
      fly.setEngaged(true);
      camera.lookAt(0, camera.position.y + 1_000, -1_000);
      fly.setEngaged(false);
      expect(phi()).toBeLessThanOrEqual(controls.maxPolarAngle);
    });

    it('keeps the bearing while it tilts the target down', () => {
      fly.setEngaged(true);
      // Looking east, level.
      camera.lookAt(1_000, camera.position.y, 0);
      fly.setEngaged(false);
      const offset = controls.target.clone().sub(camera.position);
      expect(Math.atan2(offset.z, offset.x)).toBeCloseTo(0, 3);
      expect(offset.y).toBeLessThan(0);
    });

    it('stays inside the orbit distance limits', () => {
      controls.maxDistance = 400;
      fly.setEngaged(true);
      fly.setEngaged(false);
      const distance = camera.position.distanceTo(controls.target);
      expect(distance).toBeLessThanOrEqual(controls.maxDistance);
      expect(distance).toBeGreaterThanOrEqual(controls.minDistance);
    });

    it('lands the orbit centre on the terrain the viewer was looking at', () => {
      fly.dispose();
      fly = build({ groundAt: flatGround });
      fly.setEngaged(true);
      // Pitched well down, so the ray meets the flat ground long before the fallback distance.
      camera.lookAt(0, GROUND_M, -400);
      fly.setEngaged(false);
      // Within a few metres, not exact: the march stops at the first sample past the surface and
      // being slightly inside the hillside is invisible — what matters is that the orbit centre is
      // on the ground rather than hanging in the air in front of it.
      expect(Math.abs(controls.target.y - GROUND_M)).toBeLessThan(5);
    });

    it('falls back to a fixed distance with no terrain to aim at', () => {
      fly.setEngaged(true);
      fly.setEngaged(false);
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(HANDOFF_DISTANCE_M, 3);
    });

    it('leaves the camera exactly where it was, both ways', () => {
      camera.position.set(1_200, 900, -400);
      camera.lookAt(0, GROUND_M, 0);
      const before = camera.position.clone();
      fly.setEngaged(true);
      expect(camera.position.distanceTo(before)).toBe(0);
      fly.setEngaged(false);
      expect(camera.position.distanceTo(before)).toBe(0);
    });

    it('tells the orbit camera to recompute, so the new target is in force', () => {
      fly.setEngaged(true);
      const before = controls.updates;
      fly.setEngaged(false);
      expect(controls.updates).toBeGreaterThan(before);
    });
  });

  // ── Movement ─────────────────────────────────────────────────────────────

  describe('movement', () => {
    it('does nothing while the map has the camera', () => {
      const parked = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(parked)).toBe(0);
    });

    it('moves along the view direction', () => {
      press('w');
      fly.update(1);
      expect(camera.position.z).toBeLessThan(0);
      expect(Math.abs(camera.position.x)).toBeLessThan(1e-6);
    });

    /**
     * ⚠️ The classic free-camera bug: two keys add two full-length vectors, so a diagonal is 1.41x
     * faster than a straight line. Impossible to unsee once noticed, and trivial to reintroduce.
     */
    it('travels the same distance diagonally as it does straight', () => {
      press('w');
      let before = camera.position.clone();
      fly.update(1);
      const straight = camera.position.distanceTo(before);

      press('d');
      before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(straight, 5);
    });

    it('scales with delta time rather than with frames', () => {
      press('w');
      let before = camera.position.clone();
      fly.update(0.5);
      const half = camera.position.distanceTo(before);

      before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(half * 2, 4);
    });

    it('moves in world up and down regardless of where it is looking', () => {
      press('e');
      camera.lookAt(0, -1_000, -1_000);
      const before = camera.position.clone();
      fly.update(1);
      expect(camera.position.y).toBeGreaterThan(before.y);
      expect(Math.abs(camera.position.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(camera.position.z - before.z)).toBeLessThan(1e-6);
    });

    it('stops when the key is released', () => {
      press('w');
      fly.update(1);
      const moved = camera.position.clone();
      release('w');
      fly.update(1);
      expect(camera.position.distanceTo(moved)).toBe(0);
    });

    /**
     * ⚠️ Losing focus with a key down used to leave it stuck: the camera drifted away on its own
     * for ever, which looks exactly like a crash rather than like input.
     */
    it('drops held keys when the window loses focus', () => {
      press('w');
      window.dispatchEvent(new Event('blur'));
      const before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBe(0);
    });

    it('goes BOOST times faster with shift', () => {
      press('w');
      let before = camera.position.clone();
      fly.update(1);
      // One second at the cruise speed, so this also pins the default. Both are read from the
      // module rather than retyped, because the literal 4 in this assertion was the only thing
      // that had to be found and changed the last time the boost moved.
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS, 3);

      press('Shift');
      before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS * BOOST, 3);
    });

    /**
     * ⚠️ Shift is contested: held down it means "pan" to the orbit camera and "boost" to this one.
     * Somebody shift-dragging the map who then presses W would otherwise get a sprint they never
     * asked for, from a key they were holding for something else entirely.
     */
    it('ignores a shift that was already held when the camera was taken', () => {
      press('Shift');
      press('w');
      const before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS, 3);
    });

    it('boosts on a shift pressed while flying', () => {
      press('w');
      press('Shift');
      const before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS * BOOST, 3);
    });

    it('flies more slowly near the ground than high above it', () => {
      fly.dispose();
      fly = build({ groundAt: flatGround });
      press('w');

      camera.position.set(0, GROUND_M + 30, 0);
      let before = camera.position.clone();
      fly.update(1);
      const low = camera.position.distanceTo(before);

      camera.position.set(0, GROUND_M + 4_000, 0);
      before = camera.position.clone();
      fly.update(1);
      const high = camera.position.distanceTo(before);

      expect(low).toBeGreaterThan(0);
      expect(high).toBeGreaterThan(low * 3);
    });

    it('takes the cruise setting at face value off the edge of the map', () => {
      fly.dispose();
      fly = build({ groundAt: flatGround });
      press('w');
      camera.position.set(6_000, GROUND_M + 30, 0);
      const before = camera.position.clone();
      fly.update(1);
      // No ground below means no height above it, so there is nothing to scale by and guessing
      // would be worse than not scaling.
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS, 3);
      expect(fly.telemetry().aglM).toBeNull();
    });

    /**
     * ⚠️ A twin whose reference height is a mast top rather than a hillside needs to reach much
     * further up than 2.6x, because everything above the mast is *far* above it. Hard-coding the
     * range would have meant a harbour camera that crawls at altitude.
     */
    it('honours the scaling range the host asked for', () => {
      fly.dispose();
      fly = build({ groundAt: flatGround, referenceAglM: 25, aglScaleMin: 0.3, aglScaleMax: 14 });
      press('w');

      camera.position.set(0, GROUND_M + 5_000, 0);
      let before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS * 14, 2);

      camera.position.set(0, GROUND_M, 0);
      before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(CRUISE_DEFAULT_MS * 0.3, 2);
    });
  });

  // ── The spin ─────────────────────────────────────────────────────────────

  /**
   * R and F used to be a duplicate of E and Q — a key doing nothing, because nobody presses two
   * keys for one thing. They now swing the camera around whatever is in the middle of the view,
   * which is the one move W A S D plus drag cannot make: an arc needs a translation and a rotation
   * at once, in opposite directions, at a rate that depends on the radius.
   *
   * The assertions are all about the *shape* of the motion rather than the speed, because the
   * speed is a constant anybody may retune and the shape is the contract.
   */
  describe('the spin', () => {
    /**
     * Where the view ray meets `flatGround`, solved rather than marched.
     *
     * The module finds the same point by marching and bisecting, so it lands a metre or two short
     * of this — which is why the assertions below are in metres and not in decimals. Solving it
     * here keeps the expectation independent of how the module searches.
     */
    function viewCentre() {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const t = (camera.position.y - GROUND_M) / -direction.y;
      return camera.position.clone().addScaledVector(direction, t);
    }

    /** Horizontal distance only: the orbit is a circle on the map, not a sphere. */
    function radiusFrom(centre: THREE.Vector3) {
      return Math.hypot(camera.position.x - centre.x, camera.position.z - centre.z);
    }

    /**
     * Perched at 200 m AGL looking down 45° at the ground 200 m to the north.
     *
     * ⚠️ Tilted, not level, and it has to be: a level ray over flat ground never meets it, so the
     * module would fall back to its fixed hand-off distance and the test would be measuring the
     * fallback instead of the feature. Aimed before the first key press, because engaging adopts
     * the camera's orientation and every frame after that writes it back from the module's own
     * yaw and pitch — a `lookAt` mid-flight is overwritten before it can be observed.
     */
    function aimAtGround() {
      fly.dispose();
      fly = build({ groundAt: flatGround });
      camera.position.set(0, GROUND_M + 200, 0);
      camera.lookAt(0, GROUND_M, -200);
    }

    /** A whole number of frames, so a "full lap" really is 2π and not 2π plus a frame. */
    function spinFor(seconds: number, frames = 240) {
      for (let i = 0; i < frames; i++) fly.update(seconds / frames);
    }

    const LAP_S = (Math.PI * 2) / SPIN_PER_SECOND;

    it('keeps its distance from the point it is circling', () => {
      aimAtGround();
      const centre = viewCentre();
      const before = radiusFrom(centre);

      press('r');
      spinFor(1);

      expect(radiusFrom(centre)).toBeCloseTo(before, 0);
      // Actually went somewhere: standing still would also keep the distance.
      expect(Math.abs(camera.position.x)).toBeGreaterThan(50);
    });

    it('keeps the centre in the centre by turning as much as it travels', () => {
      aimAtGround();
      const centre = viewCentre();

      press('r');
      spinFor(1);

      const ray = new THREE.Vector3();
      camera.getWorldDirection(ray);
      const toCentre = centre.clone().sub(camera.position).normalize();
      // A hundredth of a radian at 280 m is under three metres of drift across a quarter turn —
      // the residue of the module's marched centre, not of the rotation.
      expect(ray.angleTo(toCentre)).toBeLessThan(0.01);
    });

    it('leaves height and pitch alone', () => {
      aimAtGround();
      const y = camera.position.y;
      // ⚠️ Pitch off the world direction, not off `camera.rotation.x`: the module writes a YXZ
      // Euler and `rotation` is read back as the default XYZ, so its x only equals the pitch while
      // the yaw is zero — which is exactly what a spin stops being true.
      const before = new THREE.Vector3();
      camera.getWorldDirection(before);

      press('r');
      spinFor(1);

      const after = new THREE.Vector3();
      camera.getWorldDirection(after);
      expect(camera.position.y).toBeCloseTo(y, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    });

    it('goes the other way round on f', () => {
      aimAtGround();
      press('r');
      spinFor(0.5);
      const oneWay = camera.position.x;

      aimAtGround();
      press('f');
      spinFor(0.5);

      expect(Math.sign(camera.position.x)).toBe(-Math.sign(oneWay));
      expect(Math.abs(camera.position.x)).toBeCloseTo(Math.abs(oneWay), 3);
    });

    it('cancels out when both keys are held', () => {
      aimAtGround();
      const before = camera.position.clone();
      press('r');
      press('f');
      spinFor(1);
      expect(camera.position.distanceTo(before)).toBe(0);
    });

    /**
     * ⚠️ The bug this replaced: R and F used to add to the world-up vector alongside E and Q, so
     * they were a second, undiscoverable way to do the thing two other keys already did.
     */
    it('no longer doubles as up and down', () => {
      aimAtGround();
      const y = camera.position.y;
      press('f');
      spinFor(1);
      expect(camera.position.y).toBeCloseTo(y, 6);
    });

    /**
     * ⚠️ The subtle one. Re-deriving the centre from the view ray every frame walks it across the
     * map — the ray lands further away as the terrain falls off — and the "orbit" becomes a drift.
     * Sampling once and latching it while the key is held is what makes it a circle, and a circle
     * closes: a full lap has to come back to where it started, whatever the radius turned out to be.
     */
    it('comes back to where it started after a full lap', () => {
      aimAtGround();
      const before = camera.position.clone();
      press('r');
      spinFor(LAP_S);
      expect(camera.position.distanceTo(before)).toBeLessThan(0.5);
    });

    /** A fresh press picks up whatever is centred *then*, not whatever was centred last time. */
    it('re-samples the centre on the next press', () => {
      aimAtGround();
      press('r');
      spinFor(0.2);
      release('r');
      // One frame with nothing held is what drops the latched centre.
      fly.update(1 / 60);

      // Moved, not re-aimed: the orientation is still the module's, so the ray still meets the
      // ground — 2 km away from anything the first press could have sampled.
      camera.position.set(2_000, GROUND_M + 200, 2_000);
      const centre = viewCentre();
      const radius = radiusFrom(centre);
      expect(centre.distanceTo(new THREE.Vector3(0, GROUND_M, -200))).toBeGreaterThan(1_000);

      press('r');
      spinFor(0.5);
      expect(radiusFrom(centre)).toBeCloseTo(radius, 0);
    });

    /** Nothing under the ray is not a reason to do nothing — it orbits a point out in front. */
    it('spins around a point in front of it with no ground below the ray', () => {
      fly.dispose();
      fly = build({ groundAt: flatGround });
      camera.position.set(6_000, GROUND_M + 200, 0);
      camera.lookAt(6_000, GROUND_M + 200, -1_000);
      const before = camera.position.clone();

      press('r');
      spinFor(0.5);

      expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
      expect(camera.position.y).toBeCloseTo(before.y, 6);
    });

    /**
     * ⚠️ Spinning moves the camera without ever touching `velocity`, so an idle check that only
     * watches the move vector would hand the camera back mid-orbit — the wheel would change
     * meaning under a viewer who is still flying.
     */
    it('holds the latch while it is spinning', () => {
      aimAtGround();
      press('r');
      tick(DISENGAGE_MS / 1000 + 1);
      expect(fly.engaged).toBe(true);
    });
  });

  // ── The contested inputs ─────────────────────────────────────────────────

  describe('the wheel', () => {
    it('starts at the cruise default', () => {
      expect(fly.cruiseMs).toBe(CRUISE_DEFAULT_MS);
    });

    /**
     * ⚠️ With the map in charge OrbitControls owns the wheel and it is the zoom. Swallowing it here
     * would break zooming for everyone who never flies — which is most people.
     */
    it('belongs to the map zoom while the map has the camera', () => {
      const event = wheel(-1);
      expect(fly.cruiseMs).toBe(CRUISE_DEFAULT_MS);
      expect(event.defaultPrevented).toBe(false);
    });

    it('becomes the throttle while flying', () => {
      press('w');
      const event = wheel(-1);
      expect(event.defaultPrevented).toBe(true);
      expect(fly.cruiseMs).toBeCloseTo(CRUISE_DEFAULT_MS * CRUISE_STEP, 6);
    });

    it('goes back to the map zoom once the camera is handed back', () => {
      press('w');
      release('w');
      tick(DISENGAGE_MS / 1000 + 0.2);
      const event = wheel(-1);
      expect(event.defaultPrevented).toBe(false);
    });

    it('clamps at both ends rather than running away', () => {
      press('w');
      for (let i = 0; i < 200; i++) wheel(-1);
      expect(fly.cruiseMs).toBe(CRUISE_MAX_MS);
      for (let i = 0; i < 400; i++) wheel(1);
      expect(fly.cruiseMs).toBe(CRUISE_MIN_MS);
    });

    it('actually changes how far a keypress travels', () => {
      press('w');
      let before = camera.position.clone();
      fly.update(1);
      const atDefault = camera.position.distanceTo(before);

      wheel(-1);
      before = camera.position.clone();
      fly.update(1);
      expect(camera.position.distanceTo(before)).toBeCloseTo(atDefault * CRUISE_STEP, 3);
    });

    it('keeps the chosen speed across a hand-back and a re-engage', () => {
      press('w');
      wheel(-1);
      const chosen = fly.cruiseMs;
      release('w');
      tick(DISENGAGE_MS / 1000 + 0.2);
      press('w');
      expect(fly.cruiseMs).toBe(chosen);
    });
  });

  describe('the arrow keys', () => {
    /**
     * ⚠️ Swallowing them on a page nobody is flying takes them away from anyone navigating it with
     * a keyboard — and from the timeline scrubber, which is a range input.
     */
    it('are left alone while the map has the camera', () => {
      expect(press('ArrowLeft').defaultPrevented).toBe(false);
    });

    it('turn the camera while flying', () => {
      press('w');
      const before = new THREE.Vector3();
      camera.getWorldDirection(before);
      expect(press('ArrowLeft').defaultPrevented).toBe(true);
      fly.update(0.5);
      const after = new THREE.Vector3();
      camera.getWorldDirection(after);
      expect(after.angleTo(before)).toBeGreaterThan(0.1);
    });

    it('hold the camera on their own, without a movement key', () => {
      press('w');
      release('w');
      press('ArrowLeft');
      tick(DISENGAGE_MS / 1000 + 1);
      expect(fly.engaged).toBe(true);
    });
  });

  describe('the right button', () => {
    it('leaves the browser menu alone while the map has the camera', () => {
      const event = new MouseEvent('contextmenu', { cancelable: true });
      dom.dispatchEvent(event);
      // OrbitControls suppresses it for its own right-drag pan while it is enabled.
      expect(event.defaultPrevented).toBe(false);
    });

    it('suppresses the browser menu while flying, where there is no pan to reach for', () => {
      press('w');
      const event = new MouseEvent('contextmenu', { cancelable: true });
      dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  // ── The optional feel ────────────────────────────────────────────────────

  /**
   * Both of these are off in this app and on in the twins whose drone had them before the merge.
   * They are tested here rather than there because this file is the one that gets copied.
   */
  describe('inertia, when an app asks for it', () => {
    beforeEach(() => {
      fly.dispose();
      fly = build({ accelerateTauS: 0.28, brakeTauS: 0.16 });
    });

    it('eases up to speed instead of snapping to it', () => {
      press('w');
      let before = camera.position.clone();
      fly.update(1 / 60);
      const firstFrame = camera.position.distanceTo(before) * 60;

      tick(2);
      before = camera.position.clone();
      fly.update(1 / 60);
      const cruising = camera.position.distanceTo(before) * 60;

      expect(firstFrame).toBeGreaterThan(0);
      expect(firstFrame).toBeLessThan(cruising * 0.2);
      expect(cruising).toBeCloseTo(CRUISE_DEFAULT_MS, -1);
    });

    it('coasts to a stop rather than stopping dead', () => {
      press('w');
      tick(2);
      release('w');

      // Still moving one frame later — that is the whole point of braking taking time.
      const before = camera.position.clone();
      fly.update(1 / 60);
      expect(camera.position.distanceTo(before)).toBeGreaterThan(0.01);

      tick(2);
      expect(fly.telemetry().speedMs).toBe(0);
    });

    /**
     * ⚠️ The reason the hand-back is counted from the last key and not from the last movement.
     * With inertia the camera is still coasting for a moment after the keys come up, and a grace
     * window that started when the motion stopped would be a timer the viewer never set.
     */
    it('does not have its grace window shortened by the coast', () => {
      press('w');
      tick(1);
      release('w');
      tick(DISENGAGE_MS / 1000 - 0.3);
      expect(fly.engaged).toBe(true);
      tick(0.6);
      expect(fly.engaged).toBe(false);
    });

    it('is not left coasting into the next engagement', () => {
      press('w');
      tick(2);
      fly.setEngaged(false);
      fly.setEngaged(true);
      const parked = camera.position.clone();
      fly.update(1 / 60);
      expect(camera.position.distanceTo(parked)).toBe(0);
    });
  });

  describe('a stabilised look, when an app asks for it', () => {
    it('chases the arrow keys rather than being pinned to them', () => {
      fly.dispose();
      fly = build({ lookTauS: 0.07 });
      press('w');
      press('ArrowLeft');

      const lagged = new THREE.Vector3();
      fly.update(1 / 60);
      camera.getWorldDirection(lagged);

      fly.dispose();
      controls = stubOrbit();
      camera.lookAt(0, camera.position.y, -1_000);
      fly = build();
      press('w');
      press('ArrowLeft');
      const direct = new THREE.Vector3();
      fly.update(1 / 60);
      camera.getWorldDirection(direct);

      // Same input, same frame: the stabilised one has turned less far.
      const north = new THREE.Vector3(0, 0, -1);
      expect(lagged.angleTo(north)).toBeLessThan(direct.angleTo(north));
    });

    it('still arrives where the pointer asked, given a moment', () => {
      fly.dispose();
      fly = build({ lookTauS: 0.07 });
      press('w');
      press('ArrowLeft');
      tick(0.5);
      const turning = new THREE.Vector3();
      camera.getWorldDirection(turning);

      release('ArrowLeft');
      tick(0.5);
      const settled = new THREE.Vector3();
      camera.getWorldDirection(settled);

      // It kept turning after the key came up — that is the lag being paid back, not drift.
      expect(settled.angleTo(turning)).toBeGreaterThan(0.01);

      tick(0.5);
      const later = new THREE.Vector3();
      camera.getWorldDirection(later);
      // And then it stops, rather than easing on for ever.
      expect(later.angleTo(settled)).toBeLessThan(1e-4);
    });
  });

  // ── Instruments and lifecycle ────────────────────────────────────────────

  it('reports where it is, how high above the ground, and which way it points', () => {
    fly.dispose();
    fly = build({ groundAt: flatGround });
    const telemetry = fly.telemetry();
    expect(telemetry.altitudeM).toBeCloseTo(GROUND_M + REFERENCE_AGL_M, 3);
    expect(telemetry.aglM).toBeCloseTo(REFERENCE_AGL_M, 3);
    // North is −Z.
    expect(telemetry.headingDeg).toBeCloseTo(0, 0);
    expect(telemetry.engaged).toBe(false);
  });

  it('removes its listeners on dispose', () => {
    fly.dispose();
    press('w');
    expect(fly.engaged).toBe(false);
    const event = wheel(-1);
    expect(event.defaultPrevented).toBe(false);
  });
});
