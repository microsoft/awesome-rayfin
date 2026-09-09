import {
  Cartesian3,
  Cartographic,
  Ellipsoid,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Transforms,
} from 'cesium';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AGL_SCALE_MAX,
  AGL_SCALE_MIN,
  BOOST,
  CRUISE_DEFAULT_MS,
  CRUISE_MAX_MS,
  CRUISE_MIN_MS,
  CRUISE_STEP,
  DISENGAGE_MS,
  REFERENCE_AGL_M,
  SPIN_FALLBACK_DISTANCE_M,
  SPIN_PER_SECOND,
  createFlyControls,
  type FlyControls,
  type FlyControlsOptions,
} from '../flyControls';

/**
 * Unit tests for the Cesium build of the merged map + drone camera.
 *
 * ⚠️ **A deliberate mirror of `twin3d/__tests__/flyControls.test.ts`**, which covers the Three.js
 * build used by the eight terrain twins. The two modules cannot be merged — one is a Y-up flat
 * world with a constant `up` and a heightmap, the other is ECEF on an ellipsoid where "up" differs
 * at every point — so these tests are what keep the two honest about *behaviour*. Change a rule
 * here, change it there.
 *
 * Nothing below needs WebGL. Cesium's maths is plain arithmetic, and `scene` / `camera` arrive as
 * options, so both are stubbed.
 */

/** Sydney Harbour, which is where the app this was written for actually flies. */
const ORIGIN_LON = 151.21;
const ORIGIN_LAT = -33.855;

interface StubCamera {
  positionWC: Cartesian3;
  directionWC: Cartesian3;
  heading: number;
  pitch: number;
  setView(options: {
    destination: Cartesian3;
    orientation: { heading: number; pitch: number; roll: number };
  }): void;
  lookAtTransform(transform: Matrix4): void;
  /** Counts frame resets, so the engage-time `lookAtTransform(IDENTITY)` can be asserted. */
  lookAtTransformCalls: number;
  /** Every roll the module has ever asked for. Must stay all-zero. */
  rolls: number[];
}

/**
 * The east/north/up basis at a point, as three ECEF unit vectors.
 *
 * This is precisely why the Three.js module cannot be reused: there this basis is a compile-time
 * constant, and here it is a function of position.
 */
function enuBasis(position: Cartesian3) {
  const frame = Transforms.eastNorthUpToFixedFrame(position);
  const rotation = Matrix4.getMatrix3(frame, new Matrix3());
  return {
    east: Matrix3.getColumn(rotation, 0, new Cartesian3()),
    north: Matrix3.getColumn(rotation, 1, new Cartesian3()),
    up: Matrix3.getColumn(rotation, 2, new Cartesian3()),
  };
}

/** Cesium's convention: heading 0 = north, positive clockwise; pitch 0 = level, negative = down. */
function directionFrom(position: Cartesian3, heading: number, pitch: number): Cartesian3 {
  const { east, north, up } = enuBasis(position);
  const out = Cartesian3.multiplyByScalar(
    east,
    Math.sin(heading) * Math.cos(pitch),
    new Cartesian3(),
  );
  Cartesian3.add(
    out,
    Cartesian3.multiplyByScalar(north, Math.cos(heading) * Math.cos(pitch), new Cartesian3()),
    out,
  );
  Cartesian3.add(out, Cartesian3.multiplyByScalar(up, Math.sin(pitch), new Cartesian3()), out);
  return Cartesian3.normalize(out, out);
}

function stubCamera(heightM = 500, heading = 0, pitch = 0): StubCamera {
  const camera: StubCamera = {
    positionWC: Cartesian3.fromDegrees(ORIGIN_LON, ORIGIN_LAT, heightM),
    directionWC: new Cartesian3(),
    heading,
    pitch,
    lookAtTransformCalls: 0,
    rolls: [],
    setView({ destination, orientation }) {
      // ⚠️ CLONE. The module passes a shared scratch vector; storing the reference would alias the
      // camera's position to it, and the next scratch write would teleport the camera.
      this.positionWC = Cartesian3.clone(destination, new Cartesian3());
      this.heading = CesiumMath.zeroToTwoPi(orientation.heading);
      this.pitch = orientation.pitch;
      this.rolls.push(orientation.roll);
      this.directionWC = directionFrom(this.positionWC, this.heading, this.pitch);
    },
    lookAtTransform() {
      this.lookAtTransformCalls += 1;
    },
  };
  camera.directionWC = directionFrom(camera.positionWC, heading, pitch);
  return camera;
}

interface SceneStubOptions {
  groundHeight?: number | undefined;
  pickResult?: Cartesian3 | undefined;
  onPick?: () => void;
}

function stubScene(options: SceneStubOptions = {}) {
  return {
    globe: {
      ellipsoid: Ellipsoid.WGS84,
      getHeight: () => options.groundHeight,
      pick: () => {
        options.onPick?.();
        return options.pickResult;
      },
    },
    screenSpaceCameraController: { enableInputs: true },
  };
}

/** Everything a test built, so `afterEach` can dispose it — window listeners leak otherwise. */
const live: FlyControls[] = [];

interface HarnessOptions {
  options?: Partial<FlyControlsOptions>;
  scene?: SceneStubOptions;
  camera?: { heightM?: number; heading?: number; pitch?: number };
}

function harness({ options = {}, scene: sceneOptions = {}, camera: cameraOptions = {} }: HarnessOptions = {}) {
  const camera = stubCamera(
    cameraOptions.heightM ?? 500,
    cameraOptions.heading ?? 0,
    cameraOptions.pitch ?? 0,
  );
  const scene = stubScene(sceneOptions);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const fly = createFlyControls({
    scene: scene as unknown as FlyControlsOptions['scene'],
    camera: camera as unknown as FlyControlsOptions['camera'],
    canvas,
    ...options,
  });
  live.push(fly);
  return { fly, camera, scene, canvas };
}

/** A point `distance` m due north of the camera at the same height, so a level camera looks at it. */
function centreAhead(camera: StubCamera, distance = 1000) {
  const { north } = enuBasis(camera.positionWC);
  return Cartesian3.add(
    camera.positionWC,
    Cartesian3.multiplyByScalar(north, distance, new Cartesian3()),
    new Cartesian3(),
  );
}

/** A harness whose globe pick returns a fixed centre — the shape every spin test needs. */
function harnessAround(camera: StubCamera, centre: Cartesian3, onPick?: () => void) {
  const scene = stubScene({ pickResult: centre, onPick });
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const fly = createFlyControls({
    scene: scene as unknown as FlyControlsOptions['scene'],
    camera: camera as unknown as FlyControlsOptions['camera'],
    canvas,
  });
  live.push(fly);
  return { fly, scene, canvas };
}

afterEach(() => {
  while (live.length) live.pop()!.dispose();
  document.body.innerHTML = '';
});

const keyDown = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));
const keyUp = (key: string) => window.dispatchEvent(new KeyboardEvent('keyup', { key }));

/**
 * jsdom has no usable `PointerEvent`, and `pointerId` / `pointerType` / `movementX` are readonly
 * accessors on `MouseEvent` — assigning to them throws, so they have to be defined.
 */
function pointer(
  type: string,
  init: { pointerType?: string; movementX?: number; movementY?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'movementX', { value: init.movementX ?? 0 });
  Object.defineProperty(event, 'movementY', { value: init.movementY ?? 0 });
  return event;
}

const heightOf = (position: Cartesian3) =>
  Cartographic.fromCartesian(position, Ellipsoid.WGS84, new Cartographic())!.height;

const travelled = (camera: StubCamera, from: Cartesian3) =>
  Cartesian3.distance(camera.positionWC, from);

const mark = (camera: StubCamera) => Cartesian3.clone(camera.positionWC, new Cartesian3());

describe('the latch', () => {
  it('starts on the map, not on the drone', () => {
    const { fly, scene } = harness();
    expect(fly.engaged).toBe(false);
    expect(scene.screenSpaceCameraController.enableInputs).toBe(true);
  });

  it('engages on a movement key and takes Cesium’s own controller off the inputs', () => {
    const { fly, scene } = harness();
    keyDown('w');
    expect(fly.engaged).toBe(true);
    // ⚠️ Not cosmetic: leaving it on means every drag both looks AND spins the globe underneath.
    expect(scene.screenSpaceCameraController.enableInputs).toBe(false);
  });

  it.each([...'wasdqerf'])('engages on %s, because all eight keys fly', (key) => {
    const { fly } = harness();
    keyDown(key);
    expect(fly.engaged).toBe(true);
  });

  it('ignores a movement key held with a modifier, so Ctrl+S still saves', () => {
    const { fly } = harness();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(fly.engaged).toBe(false);
  });

  it('hands the camera back after the grace window, and not before', () => {
    const { fly, scene } = harness();
    keyDown('w');
    keyUp('w');

    fly.update((DISENGAGE_MS - 100) / 1000);
    expect(fly.engaged).toBe(true);

    fly.update(0.2);
    expect(fly.engaged).toBe(false);
    expect(scene.screenSpaceCameraController.enableInputs).toBe(true);
  });

  it('treats the wheel as activity, so trimming the speed between hops does not drop the latch', () => {
    const { fly, canvas } = harness();
    keyDown('w');
    keyUp('w');
    fly.update(0.9);

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    fly.update(0.9);
    // Without the reset this would already have handed back.
    expect(fly.engaged).toBe(true);
  });

  it('lets Escape hand back at once, for anyone who does not want to wait', () => {
    const { fly } = harness();
    keyDown('w');
    keyDown('Escape');
    expect(fly.engaged).toBe(false);
  });

  it('resets the reference frame on engage, or the first keypress teleports the camera', () => {
    // ⚠️ The orbit buttons use `lookAtTransform`, and moving `position` while a transform is set
    // moves it in THAT frame — the camera ends up somewhere unrelated.
    const { camera } = harness();
    expect(camera.lookAtTransformCalls).toBe(0);
    keyDown('w');
    expect(camera.lookAtTransformCalls).toBe(1);
  });

  it('drops a Shift held for a map pan, so it does not arrive as an instant boost', () => {
    const { fly, camera } = harness();
    keyDown('Shift');
    keyDown('w');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });

  it('never flips mid-drag — the flip is queued to pointerup', () => {
    // ⚠️ Cesium holds a captured pointer and drag state. Flipping mid-gesture applies the whole
    // accumulated delta on the next move and the view snaps.
    const { fly, canvas } = harness();
    keyDown('w');
    canvas.dispatchEvent(pointer('pointerdown'));
    keyDown('Escape');
    expect(fly.engaged).toBe(true);

    window.dispatchEvent(pointer('pointerup'));
    expect(fly.engaged).toBe(false);
  });

  it('clears held keys on blur, so alt-tabbing mid-flight does not leave the camera running', () => {
    const { fly, camera } = harness();
    keyDown('w');
    window.dispatchEvent(new Event('blur'));
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(0, 3);
  });

  it('does nothing on update when it does not own the camera', () => {
    const { fly, camera } = harness();
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBe(0);
  });

  it('leaves the map camera usable when disposed mid-flight', () => {
    const { fly, scene } = harness();
    keyDown('w');
    expect(scene.screenSpaceCameraController.enableInputs).toBe(false);
    fly.dispose();
    live.pop();
    expect(scene.screenSpaceCameraController.enableInputs).toBe(true);
  });
});

describe('moving', () => {
  it('flies forward at the cruise setting', () => {
    const { fly, camera } = harness();
    keyDown('w');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });

  it('does not make a diagonal faster than a straight line', () => {
    // The classic free-camera bug, and impossible to unsee once noticed.
    const { fly, camera } = harness();
    keyDown('w');
    keyDown('d');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });

  it('climbs on E and descends on Q, along geodetic up rather than the gimbal', () => {
    const { fly, camera } = harness({ camera: { pitch: -0.6 } });
    const start = heightOf(camera.positionWC);

    keyDown('e');
    fly.update(1);
    // Pitched steeply down, yet E still gains very nearly the full cruise in height.
    expect(heightOf(camera.positionWC) - start).toBeCloseTo(CRUISE_DEFAULT_MS, 0);

    keyUp('e');
    keyDown('q');
    fly.update(1);
    expect(heightOf(camera.positionWC)).toBeCloseTo(start, 0);
  });

  it('boosts by exactly BOOST with shift', () => {
    const { fly, camera } = harness();
    keyDown('w');
    keyDown('Shift');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS * BOOST, 0);
  });

  it('slows down near the ground and speeds up high above it', () => {
    // What lets you cross the harbour in a few seconds makes it impossible to ease along a wharf.
    const low = harness({ scene: { groundHeight: 495 }, camera: { heightM: 500 } });
    keyDown('w');
    const lowBefore = mark(low.camera);
    low.fly.update(1);
    const lowMoved = travelled(low.camera, lowBefore);
    keyUp('w');

    const high = harness({ scene: { groundHeight: 0 }, camera: { heightM: REFERENCE_AGL_M * 3 } });
    keyDown('w');
    const highBefore = mark(high.camera);
    high.fly.update(1);
    const highMoved = travelled(high.camera, highBefore);

    expect(lowMoved).toBeCloseTo(CRUISE_DEFAULT_MS * AGL_SCALE_MIN, 0);
    expect(highMoved).toBeGreaterThan(lowMoved);
    expect(highMoved).toBeLessThanOrEqual(CRUISE_DEFAULT_MS * AGL_SCALE_MAX + 1);
  });

  it('takes the cruise at face value where the globe has no height to give', () => {
    // ⚠️ Undefined terrain means "nothing to be relative to", NOT sea level. Guessing would make
    // the camera crawl over tiles that simply have not loaded yet.
    const { fly, camera } = harness({ scene: { groundHeight: undefined } });
    keyDown('w');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });
});

describe('the throttle', () => {
  it('walks geometrically, so the same flick means the same thing at any speed', () => {
    const { fly, canvas } = harness();
    keyDown('w');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(fly.cruiseMs).toBeCloseTo(CRUISE_DEFAULT_MS * CRUISE_STEP, 6);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    expect(fly.cruiseMs).toBeCloseTo(CRUISE_DEFAULT_MS, 6);
  });

  it('clamps at both ends', () => {
    const { fly, canvas } = harness();
    keyDown('w');
    for (let i = 0; i < 80; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(fly.cruiseMs).toBeCloseTo(CRUISE_MAX_MS, 6);
    for (let i = 0; i < 160; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    expect(fly.cruiseMs).toBeCloseTo(CRUISE_MIN_MS, 6);
  });

  it('leaves the wheel to the map while not engaged', () => {
    const { fly, canvas } = harness();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(fly.cruiseMs).toBe(CRUISE_DEFAULT_MS);
  });
});

describe('R and F swing the camera around the middle of the view', () => {
  it('no longer duplicates E and Q — the bug this replaced', () => {
    // R and F used to be `held.has('e') || held.has('r')`: a key doing nothing, because nobody
    // presses two keys for one thing. R must now leave the height alone.
    const camera = stubCamera();
    const { fly } = harnessAround(camera, centreAhead(camera));
    const start = heightOf(camera.positionWC);
    keyDown('r');
    fly.update(0.5);
    expect(heightOf(camera.positionWC)).toBeCloseTo(start, 2);
  });

  it('keeps the centre centred, which is the whole point', () => {
    const camera = stubCamera();
    const centre = centreAhead(camera);
    const { fly } = harnessAround(camera, centre);

    keyDown('r');
    fly.update(0.4);

    const toCentre = Cartesian3.normalize(
      Cartesian3.subtract(centre, camera.positionWC, new Cartesian3()),
      new Cartesian3(),
    );
    // It must still be LOOKING at the point, not merely near it.
    expect(Cartesian3.dot(toCentre, camera.directionWC)).toBeCloseTo(1, 4);
  });

  it('travels a horizontal circle — fixed radius, fixed height', () => {
    const camera = stubCamera();
    const centre = centreAhead(camera);
    const { fly } = harnessAround(camera, centre);

    const radiusBefore = Cartesian3.distance(camera.positionWC, centre);
    const heightBefore = heightOf(camera.positionWC);

    keyDown('r');
    fly.update(0.5);

    expect(Cartesian3.distance(camera.positionWC, centre)).toBeCloseTo(radiusBefore, 2);
    expect(heightOf(camera.positionWC)).toBeCloseTo(heightBefore, 2);
  });

  it('turns by SPIN_PER_SECOND, and F is the opposite of R', () => {
    const camera = stubCamera();
    const { fly } = harnessAround(camera, centreAhead(camera));

    keyDown('r');
    fly.update(1);
    expect(CesiumMath.negativePiToPi(camera.heading)).toBeCloseTo(-SPIN_PER_SECOND, 3);

    keyUp('r');
    keyDown('f');
    fly.update(1);
    expect(CesiumMath.negativePiToPi(camera.heading)).toBeCloseTo(0, 3);
  });

  it('cancels itself when both are held, rather than picking a winner', () => {
    const camera = stubCamera();
    const { fly } = harnessAround(camera, centreAhead(camera));
    const before = mark(camera);
    keyDown('r');
    keyDown('f');
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(0, 2);
  });

  it('latches the centre while held, so the camera circles instead of spiralling', () => {
    // ⚠️ THE trap. Re-picking the view centre every frame lets it drift on to whatever the previous
    // frame's rotation brought into the middle, and the path opens out into a spiral.
    const camera = stubCamera();
    const centre = centreAhead(camera);
    let picks = 0;
    const { fly } = harnessAround(camera, centre, () => {
      picks += 1;
    });

    const radius = Cartesian3.distance(camera.positionWC, centre);
    keyDown('r');
    for (let i = 0; i < 30; i++) fly.update(1 / 60);

    expect(picks).toBe(1);
    expect(Cartesian3.distance(camera.positionWC, centre)).toBeCloseTo(radius, 2);
  });

  it('picks a fresh centre after the key comes up', () => {
    const camera = stubCamera();
    let picks = 0;
    const { fly } = harnessAround(camera, centreAhead(camera), () => {
      picks += 1;
    });

    keyDown('r');
    fly.update(0.1);
    keyUp('r');
    fly.update(0.1);
    keyDown('r');
    fly.update(0.1);
    expect(picks).toBe(2);
  });

  it('circles a point hanging in front of it when the view ray hits nothing', () => {
    // Looking at the sky, or past the horizon. Doing nothing would read as a broken key.
    const { fly, camera } = harness({ scene: { pickResult: undefined } });
    const expected = Cartesian3.add(
      camera.positionWC,
      Cartesian3.multiplyByScalar(camera.directionWC, SPIN_FALLBACK_DISTANCE_M, new Cartesian3()),
      new Cartesian3(),
    );

    keyDown('r');
    fly.update(0.5);
    expect(Cartesian3.distance(camera.positionWC, expected)).toBeCloseTo(
      SPIN_FALLBACK_DISTANCE_M,
      1,
    );
  });

  it('holds the latch open while spinning, even though it is not translating', () => {
    // The spin is not a "move", so without its own `idleS = 0` the grace window would expire under
    // a held key and the camera would be handed back mid-orbit.
    const camera = stubCamera();
    const { fly } = harnessAround(camera, centreAhead(camera));
    keyDown('r');
    for (let i = 0; i < 10; i++) fly.update(0.5);
    expect(fly.engaged).toBe(true);
  });

  it('leaves the pitch alone, so a tilted view stays tilted', () => {
    const camera = stubCamera(500, 0, -0.5);
    const { fly } = harnessAround(camera, centreAhead(camera));
    keyDown('r');
    fly.update(0.5);
    expect(camera.pitch).toBeCloseTo(-0.5, 4);
  });

  it('combines with W, flying along the bearing the spin just produced', () => {
    // The spin runs BEFORE the move for exactly this reason — a stale forward vector is what makes
    // a combined key feel like it lags.
    const camera = stubCamera();
    const { fly } = harnessAround(camera, centreAhead(camera));
    keyDown('r');
    keyDown('w');
    const before = mark(camera);
    fly.update(0.5);
    expect(travelled(camera, before)).toBeGreaterThan(0);
  });
});

describe('looking', () => {
  it('turns on a drag without moving the camera', () => {
    const { fly, camera, canvas } = harness();
    keyDown('w');
    keyUp('w');
    const before = mark(camera);

    canvas.dispatchEvent(pointer('pointerdown'));
    canvas.dispatchEvent(pointer('pointermove', { movementX: 100 }));
    fly.update(0.016);

    expect(camera.heading).toBeGreaterThan(0);
    expect(travelled(camera, before)).toBeCloseTo(0, 3);
  });

  it('ignores touch, because Chromium reports no movementX for it', () => {
    // ⚠️ Without the bail, drag-to-look silently does nothing AND the globe stops responding.
    const { fly, camera, canvas } = harness();
    keyDown('w');
    keyUp('w');
    const heading = camera.heading;

    canvas.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    canvas.dispatchEvent(pointer('pointermove', { pointerType: 'touch', movementX: 100 }));
    fly.update(0.016);
    expect(camera.heading).toBeCloseTo(heading, 6);
  });

  it('turns on the arrow keys, for trackpads and for anyone not using a mouse', () => {
    const { fly, camera } = harness();
    keyDown('w');
    keyUp('w');
    keyDown('ArrowRight');
    fly.update(1);
    expect(camera.heading).toBeGreaterThan(0);
  });

  it('keeps an arrow key resetting the grace window without moving the camera', () => {
    const { fly, camera } = harness();
    keyDown('w');
    keyUp('w');
    const before = mark(camera);
    keyDown('ArrowLeft');
    for (let i = 0; i < 10; i++) fly.update(0.5);
    expect(fly.engaged).toBe(true);
    expect(travelled(camera, before)).toBeCloseTo(0, 3);
  });

  it('never rolls — a tilted horizon reads as the terrain being wrong', () => {
    const { fly, camera, canvas } = harness();
    keyDown('w');
    canvas.dispatchEvent(pointer('pointerdown'));
    canvas.dispatchEvent(pointer('pointermove', { movementX: 250, movementY: 90 }));
    fly.update(0.016);
    expect(camera.rolls.length).toBeGreaterThan(0);
    expect(camera.rolls.every((roll) => roll === 0)).toBe(true);
  });

  it('stays off the poles of its own orientation', () => {
    const { fly, camera, canvas } = harness();
    keyDown('w');
    canvas.dispatchEvent(pointer('pointerdown'));
    for (let i = 0; i < 40; i++) {
      canvas.dispatchEvent(pointer('pointermove', { movementY: -300 }));
    }
    fly.update(0.016);
    expect(camera.pitch).toBeLessThan(Math.PI / 2);
    expect(camera.pitch).toBeGreaterThan(-Math.PI / 2);
  });
});

describe('telemetry', () => {
  it('reports the latch, the throttle and the heading', () => {
    const { fly } = harness();
    const idle = fly.telemetry();
    expect(idle.engaged).toBe(false);
    expect(idle.cruiseMs).toBe(CRUISE_DEFAULT_MS);
    expect(idle.headingDeg).toBeGreaterThanOrEqual(0);
    expect(idle.headingDeg).toBeLessThan(360);

    keyDown('w');
    expect(fly.telemetry().engaged).toBe(true);
  });

  it('puts the cruise on a 0..1 log scale, because only the module knows the range', () => {
    const { fly, canvas } = harness();
    keyDown('w');
    for (let i = 0; i < 80; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
    expect(fly.telemetry().cruise).toBeCloseTo(0, 6);
    for (let i = 0; i < 160; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(fly.telemetry().cruise).toBeCloseTo(1, 6);
  });

  it('reports AGL as null where the globe has no height, rather than guessing sea level', () => {
    const { fly } = harness({ scene: { groundHeight: undefined } });
    expect(fly.telemetry().aglM).toBeNull();
  });

  it('reports AGL as the gap above terrain where there is terrain', () => {
    const { fly } = harness({ scene: { groundHeight: 120 }, camera: { heightM: 500 } });
    expect(fly.telemetry().aglM).toBeCloseTo(380, 0);
  });

  it('reports the speed actually flown, which is zero before the first update', () => {
    const { fly } = harness();
    keyDown('w');
    expect(fly.telemetry().speedMs).toBe(0);
    fly.update(1);
    expect(fly.telemetry().speedMs).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });
});

describe('the feel is an option', () => {
  it('collapses to instant when no time constants are given', () => {
    const { fly, camera } = harness();
    keyDown('w');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, 0);
  });

  it('gives the camera mass when they are', () => {
    const { fly, camera } = harness({ options: { accelerateTauS: 0.28, brakeTauS: 0.16 } });
    keyDown('w');
    const before = mark(camera);
    fly.update(0.1);
    // Well short of a tenth of the cruise, because it is still spooling up.
    expect(travelled(camera, before)).toBeLessThan(CRUISE_DEFAULT_MS * 0.1);
  });

  it('coasts after the keys come up, then parks exactly at zero', () => {
    // An exponential approach never arrives, and a camera drifting by a millimetre a second is a
    // scene that will not hold still.
    const { fly } = harness({ options: { accelerateTauS: 0.28, brakeTauS: 0.16 } });
    keyDown('w');
    fly.update(1);
    keyUp('w');
    fly.update(0.1);
    expect(fly.telemetry().speedMs).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) fly.update(0.05);
    expect(fly.telemetry().speedMs).toBe(0);
  });

  it('puts the look on a stabiliser when lookTauS is given', () => {
    const { fly, camera, canvas } = harness({ options: { lookTauS: 0.07 } });
    keyDown('w');
    canvas.dispatchEvent(pointer('pointerdown'));
    canvas.dispatchEvent(pointer('pointermove', { movementX: 200 }));
    const rigid = 200 * 0.0022;
    fly.update(0.016);
    // Lagging behind the pointer, which is the entire point of the option.
    expect(camera.heading).toBeLessThan(rigid);
    expect(camera.heading).toBeGreaterThan(0);
  });
});

describe('every app-specific number is an option', () => {
  it('takes the cruise and the boost from the host', () => {
    const { fly, camera } = harness({ options: { cruiseDefaultMs: 42, boost: 2 } });
    keyDown('w');
    const before = mark(camera);
    fly.update(1);
    expect(travelled(camera, before)).toBeCloseTo(42, 1);
    expect(fly.cruiseMs).toBe(42);
  });

  it('takes the spin rate from the host', () => {
    const camera = stubCamera();
    const scene = stubScene({ pickResult: centreAhead(camera) });
    const canvas = document.createElement('canvas');
    const fly = createFlyControls({
      scene: scene as unknown as FlyControlsOptions['scene'],
      camera: camera as unknown as FlyControlsOptions['camera'],
      canvas,
      spinPerSecond: 0.2,
    });
    live.push(fly);

    keyDown('r');
    fly.update(1);
    expect(CesiumMath.negativePiToPi(camera.heading)).toBeCloseTo(-0.2, 3);
  });

  it('tells the host when the latch flips, so the UI can follow rather than command', () => {
    const seen: boolean[] = [];
    const { fly } = harness({ options: { onEngagedChange: (on) => seen.push(on) } });
    keyDown('w');
    keyUp('w');
    fly.update(2);
    expect(seen).toEqual([true, false]);
  });

  it('can be driven explicitly, for a button or a tour taking the camera', () => {
    const { fly } = harness();
    fly.setEngaged(true);
    expect(fly.engaged).toBe(true);
    fly.setEngaged(false);
    expect(fly.engaged).toBe(false);
  });

  it('keeps its metres honest across many small frames', () => {
    const { fly, camera } = harness();
    keyDown('w');
    const before = mark(camera);
    for (let i = 0; i < 60; i++) fly.update(1 / 60);
    expect(travelled(camera, before)).toBeCloseTo(CRUISE_DEFAULT_MS, -1);
  });
});
