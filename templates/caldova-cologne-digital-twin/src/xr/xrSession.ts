import * as THREE from 'three';
import {
  altitudeCorrection,
  deadZone,
  desiredVelocity,
  smoothVelocity,
  SnapTurn,
  turnRigAboutHead,
  vignetteFor,
  xrSpeedForAgl,
} from './xrLocomotion';
import {
  createExitButton,
  createMenuPanel,
  createSyntheticBanner,
  createVignette,
  createWristPanel,
  MENU_M,
  ANSWER_M,
  createAnswerPanel,
  type AnswerPanel,
  type ExitButton,
  type MenuPanel,
  type MenuRow,
  type PanelLine,
  type SyntheticBanner,
  type Vignette,
  type WristPanel,
} from './xrPanel';
import {
  aheadFor,
  applyTabletop,
  initialTable,
  liftStep,
  scaleLabel,
  scaleStep,
  TABLETOP_DEFAULT_SCALE,
  TabletopGrab,
  yawStep,
  type TabletopPose,
} from './xrTabletop';

/**
 * The twin in a headset: Meta Quest 3 / 3S in the Quest browser, or any WebXR headset. Two kinds
 * of session, one rig:
 *
 * **Fly (immersive-vr).** The viewer stands in Köln at 1:1 and flies with the controllers:
 *
 * | control | does |
 * |---|---|
 * | left stick | fly: forward follows the head, so look down and push to dive |
 * | right stick left/right | snap turn 30 degrees |
 * | right stick up/down | climb / descend |
 * | either grip | boost |
 * | either trigger | select the object the ray points at |
 * | A | layer menu: aim at a row and pull the trigger |
 * | B | next site |
 * | X | wrist panel on/off |
 * | Y | back to the start view |
 * | trigger on "Exit" | leave the headset, back to the page |
 *
 * **Tabletop (immersive-ar, passthrough).** The real surroundings stay visible and one core of the twin
 * stands in it as a model at one uniform scale (1:5000 to start):
 *
 * | control | does |
 * |---|---|
 * | either grip, held | grab the model and move it, e.g. onto a real table |
 * | right stick left/right | turn the model |
 * | right stick up/down | bigger / smaller (1:1000 to 1:50000) |
 * | left stick up/down | raise / lower |
 * | either trigger | select the object the ray points at |
 * | A | layer menu: aim at a row and pull the trigger |
 * | B | next site on the table |
 * | X | wrist panel on/off |
 * | Y | put the model back in front of you |
 * | trigger on "Exit" | leave the headset, back to the page |
 *
 * The Exit button sits right of the banner, which is in view in both kinds of session.
 * The headset's own pose moves the camera inside a RIG, and the sticks move the rig. That is the
 * standard WebXR shape and the only one that works: three.js composes every eye from
 * `camera.parent.matrixWorld x pose`, so whatever the rig does, the head is never overridden.
 *
 * ⚠️ The fly rig has no world scale, on purpose (see `xrLocomotion.ts`). The tabletop rig has
 * exactly one, uniform on all axes and always stated (see `xrTabletop.ts`).
 */

export type XrKind = 'fly' | 'tabletop';
const SESSION_MODE: Record<XrKind, XRSessionMode> = { fly: 'immersive-vr', tabletop: 'immersive-ar' };

export type XrayPreset = 'solid' | 'ground' | 'full';
export const XRAY_PRESETS: Record<XrayPreset, { ground: number; buildings: number }> = {
  solid: { ground: 1, buildings: 1 },
  // The ground thin enough to read the network under the street, the city still a city.
  ground: { ground: 0.3, buildings: 1 },
  full: { ground: 0.12, buildings: 0.18 },
};

export interface XrStartPose {
  /** Head position, world metres. */
  position: THREE.Vector3;
  /** Facing, radians about Y; 0 is north (−Z). */
  yaw: number;
}

export interface XrHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  groundAt(x: number, z: number): number | null;
  /** Nearest pickable object to a ray, or null. Picking tolerance is the host's business. */
  pick(ray: THREE.Ray): number | null;
  select(index: number | null): void;
  setXray(preset: XrayPreset): void;
  /** B in the fly session. Return true when the viewer should be moved to the new start pose. */
  nextLens(): boolean | void;
  /** Lines for the wrist panel. Called at a few hertz, and only while presenting. */
  panelLines(state: XrPanelState): PanelLine[];
  bannerText(kind: XrKind, tabletopScale?: number): { title: string; body: string };
  /** Label of the in-headset exit button, in the page language. */
  exitLabel(): string;
  /** Label of the tour's next button; `last` on the final stop. */
  nextLabel?(last: boolean): string;
  /**
   * The layer menu on A. Rows with ids starting `__` are the rig's own: `__buttons` (button size)
   * and `__close`; every other row is handed back to `toggle`.
   */
  menu?: {
    title(): string;
    rows(state: { smallButtons: boolean; compact: boolean }): MenuRow[];
    toggle(id: string): void;
  };
  /**
   * Spoken questions (optional). Absent or `enabled() === false` means the right stick press does
   * nothing and no microphone is touched.
   */
  voice?: {
    enabled(): boolean;
    start(): Promise<void>;
    /** Stop recording and ask. Resolves with what was heard and the answer, or null. */
    finish(): Promise<{ frage: string; antwort: string } | null>;
    cancel(): void;
    labels(): { listening: string; thinking: string; you: string; note: string; nothing: string; failed: string };
  };
  /** Where the viewer should appear when the session starts, and when Y is pressed. */
  startPose(): XrStartPose;
  onPresentingChange(presenting: boolean, lastHead: { position: THREE.Vector3; forward: THREE.Vector3 } | null): void;
  /** Present only when the host supports the tabletop session. */
  tabletop?: XrTabletopHost;
}

export interface XrTabletopHost {
  /** The world point of the active site that goes on the table. */
  anchor(): THREE.Vector3;
  /** Show the scene as a table model (true) or as the 1:1 world (false). */
  setActive(active: boolean): void;
  /** World metres across the current table model, so a large one is placed far enough ahead. */
  extentM?(): number;
  /** B: put the next site on the table. Returns its anchor, or its anchor and the scale it needs. */
  nextSite(): THREE.Vector3 | { anchor: THREE.Vector3; scale: number };
}

export interface XrPanelState {
  kind: XrKind;
  altitudeM: number;
  aglM: number | null;
  speedMs: number;
  headingDeg: number;
  xray: XrayPreset;
  /** Scale denominator of the tabletop model, null in the fly session. */
  tabletopScale: number | null;
}

/** One stop of a guided headset tour, already in world metres. */
export interface XrTourStep {
  kind: XrKind;
  title(): string;
  body(): string;
  /** Tabletop: the world point in the middle of the table, and the scale denominator. */
  table?: { anchor: THREE.Vector3; scale: number };
  /** Fly: where the head goes. */
  pose?: XrStartPose;
  xray?: XrayPreset;
  /** Open the wrist panel on arrival: the stop selects something worth reading. */
  showPanel?: boolean;
  /** Autoplay: seconds to stay at the stop before the tour moves on by itself. */
  holdS?: number;
  /** Fly: circle this world point slowly during the stop (degrees per second, positive = clockwise from above). */
  orbit?: { target: THREE.Vector3; degPerS: number };
  /** Tabletop: turn the model slowly during the stop (degrees per second). */
  spinDegPerS?: number;
  /** Side effects of arriving at this stop (the layers). */
  enter(): void;
}

/** Options of a guided tour. */
export interface XrTourOptions {
  /** Move on by itself after each stop's `holdS`; the Next button still skips ahead. */
  autoplay?: boolean;
}

/**
 * A rig state: where the world sits around the viewer. `scale` is the denominator k (1 = 1:1).
 * World point = position + k * rotation * real point.
 */
interface RigState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}

export interface XrTourState {
  index: number;
  count: number;
  /** The next stop needs the other session kind: waiting for a tap on the page to open it. */
  waiting: boolean;
  kind: XrKind;
  title: string;
}

/** xr-standard gamepad mapping indices. */
const BUTTON = { trigger: 0, squeeze: 1, thumbstick: 3, primary: 4, secondary: 5 } as const;

const NEAR_XR_M = 0.1;
const FAR_XR_M = 25_000;
/** In the tabletop session the view space is REAL space, in metres: hands are 30 cm away. */
const NEAR_TABLETOP_M = 0.03;
const FAR_TABLETOP_M = 200;
/** The pointer ray in real space, metres. Forty would cross the walls. */
const TABLETOP_RAY_M = 1.5;
const RAY_M = 40;
/** Exit button centre relative to the banner centre, metres: just right of its 0.96 m width. */
const EXIT_OFFSET = new THREE.Vector3(0.66, 0, 0.001);
/** The tour's next button, mirrored on the left. */
const NEXT_OFFSET = new THREE.Vector3(-0.66, 0, 0.001);
/** Banner half-width plus a gap: where a banner button's inner edge sits. */
const BUTTON_INNER_X = 0.51;
const BUTTON_HALF_W = 0.15;
/** "Small" banner buttons, as a fraction of the normal size. Remembered on this device. */
const SMALL_BUTTONS = 0.6;
const BUTTONS_KEY = 'caldova-koeln.xr.buttons';
const COMPACT_KEY = 'caldova-koeln.xr.compact';

function storedCompact(): boolean {
  try { return window.localStorage.getItem(COMPACT_KEY) === 'on'; } catch { return false; }
}

function storedSmallButtons(): boolean {
  try { return window.localStorage.getItem(BUTTONS_KEY) === 'small'; } catch { return false; }
}

export class XrMode {
  readonly rig = new THREE.Group();
  private readonly host: XrHost;
  private readonly panel: WristPanel;
  private readonly banner: SyntheticBanner;
  private readonly exitButton: ExitButton;
  private readonly exitRaycaster = new THREE.Raycaster();
  private exitHover = false;
  private readonly nextButton: ExitButton;
  private nextHover = false;
  private readonly menu: MenuPanel;
  private readonly answer: AnswerPanel;
  /** idle -> recording (stick held) -> waiting (service) -> shown (answer on the panel). */
  private voiceState: 'idle' | 'recording' | 'waiting' | 'shown' = 'idle';
  private voicePressedAt = 0;
  private voiceSeq = 0;
  private voiceLast: { frage: string; antwort: string } | null = null;
  private menuHover: number | null = null;
  private menuClock = 0;
  private smallButtons = storedSmallButtons();
  /** Banner text hidden, only small buttons low in view: left stick press or the menu. */
  private compact = storedCompact();
  private tour: { steps: XrTourStep[]; index: number; handoff: boolean; autoplay: boolean; heldS: number } | null = null;
  /**
   * Inside an AR session, the 1:1 world: the table has been dived into. The tour no longer has to
   * end the passthrough session and ask the page for a VR one; the city simply grows around the
   * viewer until it is life size, and shrinks back onto the desk at the end.
   */
  private world = false;
  /** A dive into the table (to the world) or a rise out of it (back onto the table) in progress. */
  private transition: {
    from: RigState;
    to: () => RigState;
    toWorld: boolean;
    t: number;
    duration: number;
    switched: boolean;
  } | null = null;
  /** A tour flight in progress: the head is carried from one stop to the next. */
  private flight: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    turn: number;
    arc: number;
    duration: number;
    t: number;
    eased: number;
  } | null = null;
  /** Set by the host page: called whenever the tour moves, pauses for a handoff or ends. */
  onTourChange: ((state: XrTourState | null) => void) | null = null;
  private readonly vignette: Vignette;
  private readonly snap = new SnapTurn();
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly headPosition = new THREE.Vector3();
  private readonly headForward = new THREE.Vector3();
  private readonly headQuaternion = new THREE.Quaternion();
  private readonly controllers: THREE.Group[] = [];
  private readonly grips: THREE.Group[] = [];
  private readonly rays: THREE.Line[] = [];
  private readonly pressed = new Map<string, boolean>();
  private xray: XrayPreset = 'solid';
  private pendingStart: XrStartPose | null = null;
  private panelClock = 0;
  private savedProjection: { near: number; far: number; fov: number; zoom: number } = { near: 1, far: 30000, fov: 50, zoom: 1 };
  private presenting = false;
  private speedMs = 0;
  /** The kind requested by `enter`; the session events only react to sessions this rig opened. */
  private kind: XrKind = 'fly';
  private requested: XrKind | null = null;
  private tabletop: TabletopPose | null = null;
  private pendingTable = false;
  private readonly grab = new TabletopGrab();
  private readonly headReal = new THREE.Vector3();
  private readonly headForwardReal = new THREE.Vector3();
  private readonly handReal = new THREE.Vector3();
  private disposed = false;
  private bannerScale = '';
  private posed = false;

  constructor(host: XrHost) {
    this.host = host;
    const { renderer, scene } = host;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    this.rig.name = 'xr-rig';
    this.panel = createWristPanel();
    this.banner = createSyntheticBanner();
    this.vignette = createVignette();
    this.banner.mesh.visible = false;
    scene.add(this.banner.mesh);
    // A child of the banner: it follows the head with it, and in the tabletop session it lives in
    // real metres with it.
    this.exitButton = createExitButton();
    this.exitButton.mesh.position.copy(EXIT_OFFSET);
    this.banner.mesh.add(this.exitButton.mesh);
    this.nextButton = createExitButton('next');
    this.nextButton.mesh.position.copy(NEXT_OFFSET);
    this.nextButton.mesh.visible = false;
    this.banner.mesh.add(this.nextButton.mesh);
    this.banner.setCompact(this.compact);
    this.applyButtonSize();
    // Above the banner, in the same plane: opened with A, aimed at like the buttons.
    this.menu = createMenuPanel();
    this.menu.mesh.position.set(0, 0.095 + MENU_M.h / 2, 0.002);
    this.menu.mesh.visible = false;
    this.banner.mesh.add(this.menu.mesh);
    // The spoken answer: same place as the menu, which it closes while shown.
    this.answer = createAnswerPanel();
    this.answer.mesh.position.set(0, 0.095 + ANSWER_M.h / 2, 0.003);
    this.banner.mesh.add(this.answer.mesh);

    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      const ray = buildRay();
      controller.add(ray);
      controller.addEventListener('connected', (event) => {
        controller.userData.handedness = (event as unknown as { data: XRInputSource }).data.handedness;
      });
      controller.addEventListener('disconnected', () => {
        controller.userData.handedness = undefined;
      });
      controller.addEventListener('select', () => this.onSelect(controller));
      this.rig.add(controller);
      this.controllers.push(controller);
      this.rays.push(ray);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(buildHandle());
      grip.addEventListener('connected', (event) => {
        const handedness = (event as unknown as { data: XRInputSource }).data.handedness;
        grip.userData.handedness = handedness;
        // The panel lives on the LEFT hand, so the right one is free to point and select.
        if (handedness === 'left') grip.add(this.panel.mesh);
      });
      grip.addEventListener('disconnected', () => {
        if (this.panel.mesh.parent === grip) grip.remove(this.panel.mesh);
      });
      this.rig.add(grip);
      this.grips.push(grip);
    }

    renderer.xr.addEventListener('sessionstart', this.onSessionStart);
    renderer.xr.addEventListener('sessionend', this.onSessionEnd);
  }

  get isPresenting() {
    return this.presenting;
  }

  get sessionKind(): XrKind {
    return this.kind;
  }

  /** What the viewer sees: the table model, or the 1:1 world (a VR session, or an AR session after a dive). */
  get viewKind(): XrKind {
    return this.kind === 'tabletop' && !this.world ? 'tabletop' : 'fly';
  }

  /** Whether this session has delivered a head pose yet, i.e. whether {@link headWorld} is real. */
  get hasPose(): boolean {
    return this.posed;
  }

  /** Whether this browser can open this kind of immersive session at all. */
  static async supported(kind: XrKind = 'fly'): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported(SESSION_MODE[kind]);
    } catch {
      // Thrown, not rejected, when a permissions policy blocks WebXR (an iframe without
      // `xr-spatial-tracking`). Same answer for the viewer: no button.
      return false;
    }
  }

  /** Must be called from a user gesture (the button click), or the browser refuses. */
  async enter(kind: XrKind = 'fly'): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('WebXR is not available in this browser');
    if (kind === 'tabletop' && !this.host.tabletop) throw new Error('This scene has no tabletop mode');
    const session = await xr.requestSession(SESSION_MODE[kind], {
      optionalFeatures: kind === 'fly'
        ? ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
        : ['local-floor', 'hand-tracking', 'layers'],
    });
    // The scene may have been torn down (a city switch) while the browser was granting the
    // session. Nobody would ever end it then, so end it here.
    if (this.disposed) {
      void session.end().catch(() => undefined);
      throw new Error('The scene closed while the headset session was starting');
    }
    this.requested = kind;
    // Full resolution: the Quest's recommended framebuffer is already sized for its panels, and
    // the city is mostly thin lines and window grids that alias badly when undersampled. Fixed
    // foveation instead takes the cost out of the periphery, where the lenses blur it anyway.
    this.host.renderer.xr.setFramebufferScaleFactor(1);
    try {
      await this.host.renderer.xr.setSession(session);
    } catch (error) {
      this.requested = null;
      void session.end().catch(() => undefined);
      throw error;
    }
    if (this.disposed) {
      void session.end().catch(() => undefined);
      throw new Error('The scene closed while the headset session was starting');
    }
    this.host.renderer.xr.setFoveation(1);
  }

  exit() {
    void this.host.renderer.xr.getSession()?.end();
  }

  /** Start a guided tour at its first stop. Must be called from a user gesture, like `enter`. */
  async startTour(steps: XrTourStep[], options: XrTourOptions = {}): Promise<void> {
    if (steps.length === 0) return;
    this.tour = { steps, index: 0, handoff: false, autoplay: Boolean(options.autoplay), heldS: 0 };
    this.emitTour();
    try {
      await this.enter(steps[0].kind);
    } catch (error) {
      this.tour = null;
      this.emitTour();
      throw error;
    }
  }

  /** After an AR/VR handoff: open the session the next stop needs. From a user gesture. */
  continueTour(): Promise<void> {
    if (!this.tour) return Promise.resolve();
    return this.enter(this.tour.steps[this.tour.index].kind);
  }

  cancelTour() {
    this.tour = null;
    this.nextButton.mesh.visible = false;
    if (this.presenting) this.refreshBanner();
    this.emitTour();
  }

  tourState(): XrTourState | null {
    if (!this.tour) return null;
    const step = this.tour.steps[this.tour.index];
    return {
      index: this.tour.index,
      count: this.tour.steps.length,
      waiting: this.tour.handoff && !this.presenting,
      kind: step.kind,
      title: step.title(),
    };
  }

  private emitTour() {
    this.onTourChange?.(this.tourState());
  }

  /** The tour stop shown in this session, or null. */
  private tourStep(): XrTourStep | null {
    const step = this.tour?.steps[this.tour.index];
    return step && step.kind === this.viewKind ? step : null;
  }

  private advanceTour() {
    // A second trigger before the session has actually ended must not skip a stop, and nothing
    // skips a dive or a rise half way.
    if (!this.tour || this.tour.handoff || this.transition) return;
    const next = this.tour.index + 1;
    if (next >= this.tour.steps.length) {
      this.cancelTour();
      return;
    }
    this.tour.index = next;
    this.tour.heldS = 0;
    const step = this.tour.steps[next];
    // An AR session can show both: dive into the table for a 1:1 stop, rise out of it for a table
    // stop. Only a VR session has to hand over to the page for a table stop (no passthrough there).
    if (this.kind === 'tabletop' && step.kind !== this.viewKind && this.tabletop) {
      this.startTransition(step);
      this.emitTour();
      return;
    }
    if (step.kind !== this.viewKind) {
      // A VR session cannot show a table (no passthrough): end it, the page offers the button that
      // opens the AR session the next stop needs.
      this.tour.handoff = true;
      this.nextButton.mesh.visible = false;
      this.emitTour();
      this.exit();
      return;
    }
    this.applyTourStep(step);
    this.emitTour();
  }

  /** Arrive at a stop inside the running session. */
  private applyTourStep(step: XrTourStep) {
    this.velocity.set(0, 0, 0);
    this.applyXray(step.xray ?? 'solid');
    step.enter();
    if (step.showPanel) this.panel.mesh.visible = true;
    if (this.viewKind === 'tabletop' && this.tabletop && step.table) {
      this.tabletop.anchor.copy(step.table.anchor);
      this.tabletop.scale = step.table.scale;
      this.grab.reset();
      // The stop may have switched what stands on the table (core, ring): show it.
      this.host.tabletop?.setActive(true);
    }
    if (this.viewKind === 'fly' && step.pose) {
      if (this.posed) {
        this.startFlight(step.pose);
      } else {
        this.pendingStart = step.pose;
      }
    }
    this.refreshBanner();
  }

  /**
   * Fly the head to a pose instead of jumping: an arc over the roofs, eased in and out, with the
   * comfort vignette. The viewer keeps looking where they like; only the rig turns, by exactly the
   * amount that makes them face the stop's heading on arrival.
   */
  private startFlight(target: XrStartPose) {
    const from = this.headPosition.clone();
    const horizontal = Math.hypot(target.position.x - from.x, target.position.z - from.z);
    const currentYaw = Math.atan2(-this.headForward.x, -this.headForward.z);
    let turn = target.yaw - currentYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    this.flight = {
      from,
      to: target.position.clone(),
      turn,
      arc: THREE.MathUtils.clamp(horizontal * 0.12, 40, 350),
      duration: THREE.MathUtils.clamp(3 + horizontal / 600, 3, 9),
      t: 0,
      eased: 0,
    };
  }

  private updateFlight(dt: number) {
    const f = this.flight!;
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
    const turnNow = f.turn * (k - f.eased);
    f.eased = k;
    if (turnNow !== 0) {
      turnRigAboutHead(this.rig, this.headPosition, turnNow);
      this.headForward.applyAxisAngle(THREE.Object3D.DEFAULT_UP, turnNow);
    }
    const target = f.from.clone().lerp(f.to, k);
    target.y += f.arc * Math.sin(Math.PI * k);
    const before = this.headPosition.clone();
    this.rig.position.add(target.clone().sub(this.headPosition));
    this.headPosition.copy(target);
    this.speedMs = dt > 0 ? before.distanceTo(target) / dt : 0;
    this.vignette.setStrength(0.6 * Math.sin(Math.PI * f.t));
    if (f.t >= 1) {
      this.flight = null;
      this.speedMs = 0;
      this.vignette.setStrength(0);
      this.bannerSnap();
    }
  }

  /** The banner follows the head in whatever frame it lives in: the rig (AR session) or the scene. */
  private bannerSnap() {
    if (this.banner.mesh.parent === this.rig) this.banner.snap(this.headReal, this.headForwardReal);
    else this.banner.snap(this.headPosition, this.headForward);
  }

  private bannerFollow(dt: number) {
    if (this.banner.mesh.parent === this.rig) this.banner.follow(this.headReal, this.headForwardReal, dt);
    else this.banner.follow(this.headPosition, this.headForward, dt);
  }

  /** Current rig as a state. */
  private rigState(): RigState {
    return { position: this.rig.position.clone(), quaternion: this.rig.quaternion.clone(), scale: this.rig.scale.x };
  }

  /** The rig state a table pose produces (see `applyTabletop`). */
  private tableState(pose: TabletopPose): RigState {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -pose.yaw);
    const position = pose.anchor.clone().sub(pose.table.clone().applyQuaternion(quaternion).multiplyScalar(pose.scale));
    return { position, quaternion, scale: pose.scale };
  }

  /** The 1:1 rig state that puts the head at `pose`, facing its yaw, from where the head is now. */
  private worldState(pose: XrStartPose): RigState {
    const turn = pose.yaw - Math.atan2(-this.headForwardReal.x, -this.headForwardReal.z);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn);
    const position = pose.position.clone().sub(this.headReal.clone().applyQuaternion(quaternion));
    return { position, quaternion, scale: 1 };
  }

  /**
   * Dive into the table (next stop is 1:1) or rise out of it (next stop is a table), in one
   * continuous move of about eight seconds. The scale runs on a logarithmic curve, so every second
   * multiplies the size by the same factor: it reads as falling into the map, not as a zoom.
   */
  private startTransition(step: XrTourStep) {
    if (!this.tabletop) return;
    const toWorld = step.kind === 'fly';
    this.flight = null;
    this.velocity.set(0, 0, 0);
    const tabletop = this.tabletop;
    const from = this.rigState();
    const to = toWorld
      ? () => this.worldState(step.pose ?? this.host.startPose())
      : () => this.tableState({
          anchor: step.table?.anchor ?? tabletop.anchor,
          table: tabletop.table,
          yaw: tabletop.yaw,
          scale: step.table?.scale ?? tabletop.scale,
        });
    this.transition = { from, to, toWorld, t: 0, duration: toWorld ? 9 : 7, switched: false };
    this.grab.reset();
    // The layers and the clock of the next stop start with the move.
    this.applyXray(step.xray ?? 'solid');
    step.enter();
    if (!toWorld && step.table) {
      tabletop.anchor.copy(step.table.anchor);
      tabletop.scale = step.table.scale;
    }
    this.refreshBanner();
    this.nextButton.mesh.visible = false;
  }

  /** Per frame while diving or rising. Needs this frame's real head pose (`headReal`). */
  private updateTransition(dt: number) {
    const tr = this.transition!;
    tr.t = Math.min(1, tr.t + dt / tr.duration);
    const k = tr.t * tr.t * tr.t * (tr.t * (tr.t * 6 - 15) + 10);
    const to = tr.to();
    const scale = Math.exp(THREE.MathUtils.lerp(Math.log(tr.from.scale), Math.log(to.scale), k));
    const quaternion = tr.from.quaternion.clone().slerp(to.quaternion, k);
    // Interpolate where the HEAD is in the world, then derive the rig from it: the viewer travels
    // on a straight line from high above the table to the stop, whatever the scale does.
    const headFrom = tr.from.position.clone().add(this.headReal.clone().applyQuaternion(tr.from.quaternion).multiplyScalar(tr.from.scale));
    const headTo = to.position.clone().add(this.headReal.clone().applyQuaternion(to.quaternion).multiplyScalar(to.scale));
    const head = headFrom.lerp(headTo, k);
    this.rig.scale.setScalar(scale);
    this.rig.quaternion.copy(quaternion);
    this.rig.position.copy(head).sub(this.headReal.clone().applyQuaternion(quaternion).multiplyScalar(scale));
    this.rig.updateMatrixWorld(true);
    // Below about 1:40 the table edge is metres away and the sky can take over (and back).
    const worldNow = scale < 40;
    if (tr.toWorld && !tr.switched && worldNow) {
      tr.switched = true;
      this.host.tabletop?.setActive(false);
    } else if (!tr.toWorld && !tr.switched && !worldNow) {
      tr.switched = true;
      this.host.tabletop?.setActive(true);
    }
    // Clip planes follow the scale: a millimetre near plane on the table, a metre-scale one in the city.
    const camera = this.host.camera;
    const near = scale > 10 ? NEAR_TABLETOP_M : NEAR_XR_M;
    const far = Math.min(FAR_XR_M, Math.max(FAR_TABLETOP_M, 30000 / scale));
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    this.vignette.setStrength(0.35 * Math.sin(Math.PI * tr.t));
    if (tr.t >= 1) {
      this.transition = null;
      this.grab.reset();
      this.vignette.setStrength(0);
      if (tr.toWorld) {
        this.world = true;
        if (!tr.switched) this.host.tabletop?.setActive(false);
        this.rig.scale.setScalar(1);
      } else {
        this.world = false;
        if (!tr.switched) this.host.tabletop?.setActive(true);
        applyTabletop(this.rig, this.tabletop!);
      }
      for (const ray of this.rays) ray.scale.z = this.world ? 1 : TABLETOP_RAY_M / RAY_M;
      const step = this.tour?.steps[this.tour.index];
      if (step?.showPanel) this.panel.mesh.visible = true;
      this.refreshBanner();
      this.bannerSnap();
      this.emitTour();
    }
  }

  /** Autoplay and the slow motion inside a stop (orbit, table spin). */
  private updateStopMotion(dt: number) {
    const step = this.tourStep();
    if (!step || !this.tour || this.flight || this.transition) return;
    if (this.viewKind === 'fly' && step.orbit && this.speedMs < 0.5 && !this.sticksActive()) {
      const angle = -THREE.MathUtils.degToRad(step.orbit.degPerS) * dt;
      turnRigAboutHead(this.rig, step.orbit.target, angle);
      this.headPosition.sub(step.orbit.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle).add(step.orbit.target);
      this.headForward.applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    }
    if (this.viewKind === 'tabletop' && step.spinDegPerS && this.tabletop && !this.grab.holding) {
      this.tabletop.yaw += THREE.MathUtils.degToRad(step.spinDegPerS) * dt;
    }
    if (this.tour.autoplay && step.holdS !== undefined) {
      this.tour.heldS += dt;
      if (this.tour.heldS >= step.holdS) this.advanceTour();
    }
  }

  /**
   * A: during a guided tour, the next stop; otherwise the menu. Nothing during a dive or a rise.
   */
  private pressA() {
    if (this.transition) return;
    if (this.tour && this.tourStep()) {
      this.menu.mesh.visible = false;
      this.advanceTour();
      return;
    }
    this.toggleMenu();
  }

  /** Whether either thumbstick is out of its dead zone: the viewer is steering, the tour waits. */
  private sticksActive(): boolean {
    const { left, right } = this.gamepads();
    return [left, right].some((pad) => pad && (deadZone(axis(pad, 'x')) !== 0 || deadZone(axis(pad, 'y')) !== 0));
  }

  /** Banner and next button for the current state: a tour stop, or the plain session help. */
  private refreshBanner() {
    // During a dive or a rise the banner already names where the viewer is going.
    const step = this.tourStep() ?? (this.transition && this.tour ? this.tour.steps[this.tour.index] : null);
    const scale = this.tabletop?.scale;
    this.bannerScale = this.tabletop ? scaleLabel(this.tabletop.scale) : '';
    if (step && this.tour) {
      const n = this.tour.steps.length;
      const onTable = this.transition ? !this.transition.toWorld : this.viewKind === 'tabletop';
      const where = onTable && this.tabletop ? ` \u00B7 ${scaleLabel(this.tabletop.scale)}` : ' \u00B7 1:1';
      this.banner.setText(`${this.tour.index + 1}/${n} ${step.title()}${where}`, step.body(), '');
      const last = this.tour.index === n - 1;
      this.nextButton.setLabel(this.host.nextLabel?.(last) ?? (last ? 'Ende' : 'Weiter'));
      this.nextButton.mesh.visible = true;
    } else {
      const banner = this.host.bannerText(this.viewKind, scale);
      this.banner.setText(banner.title, banner.body);
      this.nextButton.mesh.visible = false;
    }
    this.panelClock = 0;
  }

  private onSessionStart = () => {
    const { camera, scene } = this.host;
    this.kind = this.requested ?? 'fly';
    this.world = false;
    this.transition = null;
    const tabletop = this.kind === 'tabletop';
    // A plain session opened while a tour waited for the other kind ends that tour.
    if (this.tour && this.tour.steps[this.tour.index].kind !== this.kind) this.tour = null;
    if (this.tour) this.tour.handoff = false;
    const step = this.tourStep();
    // Asked FIRST, while the camera still holds the desktop view: the host decides from it whether
    // to open right there or at the curated start, and the reparenting below zeroes it.
    this.pendingStart = tabletop ? null : (step?.pose ?? this.host.startPose());
    this.pendingTable = tabletop;
    this.posed = false;
    this.presenting = true;
    // ALL of the desktop projection: three's XR camera update overwrites fov and zoom as well as
    // the clip planes, and the desktop must come back with its own 42 degree view.
    this.savedProjection = { near: camera.near, far: camera.far, fov: camera.fov, zoom: camera.zoom };
    // A metre of near plane is fine for an overview and cuts your own hands off in a headset.
    camera.near = tabletop ? NEAR_TABLETOP_M : NEAR_XR_M;
    camera.far = tabletop ? FAR_TABLETOP_M : FAR_XR_M;
    camera.updateProjectionMatrix();

    // A previous session of the other kind may have left the rig turned or scaled.
    this.rig.position.set(0, 0, 0);
    this.rig.quaternion.identity();
    this.rig.scale.setScalar(1);
    scene.add(this.rig);
    this.rig.add(camera);
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.add(this.vignette.mesh);
    this.vignette.setStrength(0);
    for (const ray of this.rays) ray.scale.z = tabletop ? TABLETOP_RAY_M / RAY_M : 1;

    this.velocity.set(0, 0, 0);
    this.flight = null;
    this.pressed.clear();
    this.grab.reset();
    if (tabletop) {
      // The banner speaks in real metres here, so it lives in the rig with the hands.
      this.rig.add(this.banner.mesh);
      // The stop decides what stands on the table (core, ring): let it choose before the table shows.
      step?.enter();
      this.host.tabletop!.setActive(true);
      this.tabletop = {
        anchor: step?.table?.anchor.clone() ?? this.host.tabletop!.anchor(),
        table: new THREE.Vector3(0, 0.8, -0.6),
        yaw: 0,
        scale: step?.table?.scale ?? TABLETOP_DEFAULT_SCALE,
      };
      applyTabletop(this.rig, this.tabletop);
    }
    this.applyXray(step?.xray ?? 'solid');
    if (!tabletop) step?.enter();
    if (step?.showPanel) this.panel.mesh.visible = true;
    this.refreshBanner();
    this.exitButton.setLabel(this.host.exitLabel());
    this.setExitHover(false);
    this.banner.mesh.visible = true;
    this.host.onPresentingChange(true, null);
    this.emitTour();
  };

  private onSessionEnd = () => {
    // A session that failed to start never moved the camera; nothing to restore.
    if (!this.presenting) return;
    const { camera, scene } = this.host;
    const wasTabletop = this.kind === 'tabletop';
    this.world = false;
    this.transition = null;
    // Exit pressed mid-tour ends the tour; a handoff to the other kind keeps it waiting.
    if (this.tour && !this.tour.handoff) this.tour = null;
    this.nextButton.mesh.visible = false;
    this.presenting = false;
    this.requested = null;
    const last = { position: this.headPosition.clone(), forward: this.headForward.clone() };
    camera.remove(this.vignette.mesh);
    this.rig.remove(camera);
    scene.remove(this.rig);
    scene.add(camera);
    camera.near = this.savedProjection.near;
    camera.far = this.savedProjection.far;
    camera.fov = this.savedProjection.fov;
    camera.zoom = this.savedProjection.zoom;
    camera.updateProjectionMatrix();
    this.banner.mesh.visible = false;
    this.menu.mesh.visible = false;
    this.cancelVoice();
    this.setExitHover(false);
    if (wasTabletop) {
      scene.add(this.banner.mesh);
      this.rig.position.set(0, 0, 0);
      this.rig.quaternion.identity();
      this.rig.scale.setScalar(1);
      this.tabletop = null;
      this.host.tabletop?.setActive(false);
    }
    for (const ray of this.rays) ray.scale.z = 1;
    this.host.onPresentingChange(false, last);
    this.emitTour();
  };

  /** Call once per frame before rendering, while presenting. */
  update(dt: number, frame: XRFrame | undefined) {
    if (!this.presenting) return;
    if (this.kind === 'tabletop' && !this.world) {
      this.updateTabletop(dt, frame);
      return;
    }
    const xrCamera = this.host.renderer.xr.getCamera();

    // The first frames of a session can arrive without a pose yet. Nothing to steer from then.
    const pose = frame && this.host.renderer.xr.getReferenceSpace()
      ? frame.getViewerPose(this.host.renderer.xr.getReferenceSpace()!)
      : null;
    if (!pose) return;

    // Head in world space from THIS frame's pose, composed with the rig: never last frame's.
    const t = pose.transform;
    this.rig.updateMatrixWorld(true);
    this.headPosition
      .set(t.position.x, t.position.y, t.position.z)
      .applyMatrix4(this.rig.matrixWorld);
    this.headQuaternion
      .set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w)
      .premultiply(this.rig.quaternion);
    this.headForward.set(0, 0, -1).applyQuaternion(this.headQuaternion);
    this.headReal.set(t.position.x, t.position.y, t.position.z);
    this.headForwardReal
      .set(0, 0, -1)
      .applyQuaternion(new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w));
    this.posed = true;

    if (this.transition) {
      // Rising out of the city back onto the table (AR session).
      this.updateTransition(dt);
      this.bannerFollow(dt);
      this.updateExitHover();
      return;
    }

    if (this.pendingStart) {
      this.placeHead(this.pendingStart);
      this.pendingStart = null;
      this.bannerSnap();
    }
    this.setLineResolution(xrCamera);

    if (this.flight) {
      // The tour carries the viewer: no sticks, no buttons, until it lands.
      this.updateFlight(dt);
      this.bannerFollow(dt);
      this.updateExitHover();
      return;
    }
    this.updateStopMotion(dt);
    if (!this.presenting || this.kind === 'tabletop' && !this.world) return;

    const { left, right } = this.gamepads();
    const ground = this.host.groundAt(this.headPosition.x, this.headPosition.z);

    // Turn first, so this frame's movement goes the way the viewer is now facing.
    const turn = this.snap.update(right ? deadZone(axis(right, 'x')) : 0);
    if (turn !== 0) {
      turnRigAboutHead(this.rig, this.headPosition, turn);
      this.headForward.applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn);
      this.headQuaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, turn));
    }

    const boosted = Boolean(
      (left && left.buttons[BUTTON.squeeze]?.pressed) || (right && right.buttons[BUTTON.squeeze]?.pressed)
    );
    const aglM = ground === null ? null : this.headPosition.y - ground;
    const cruise = xrSpeedForAgl(aglM, boosted);
    desiredVelocity(
      {
        moveX: left ? deadZone(axis(left, 'x')) : 0,
        // Gamepad Y is down-positive; forward on the stick is negative.
        moveY: left ? -deadZone(axis(left, 'y')) : 0,
        climb: right ? -deadZone(axis(right, 'y')) : 0,
      },
      this.headForward,
      cruise,
      this.desired
    );
    smoothVelocity(this.velocity, this.desired, dt);
    this.speedMs = this.velocity.length();
    if (this.speedMs > 0) {
      this.rig.position.addScaledVector(this.velocity, dt);
      this.headPosition.addScaledVector(this.velocity, dt);
    }
    const correction = altitudeCorrection(
      this.headPosition.y,
      this.host.groundAt(this.headPosition.x, this.headPosition.z)
    );
    if (correction !== 0) {
      this.rig.position.y += correction;
      this.headPosition.y += correction;
      if (Math.sign(this.velocity.y) !== Math.sign(correction)) this.velocity.y = 0;
    }
    this.vignette.setStrength(vignetteFor(this.speedMs, xrSpeedForAgl(aglM, false)));

    // Buttons, on the press edge only.
    if (right && this.edge('A', right.buttons[BUTTON.primary]?.pressed)) this.pressA();
    if (right && this.edge('B', right.buttons[BUTTON.secondary]?.pressed)) {
      if (this.host.nextLens() === true) {
        this.velocity.set(0, 0, 0);
        this.placeHead(this.host.startPose());
        this.bannerSnap();
      }
    }
    if (left && this.edge('X', left.buttons[BUTTON.primary]?.pressed)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
    }
    if (left && this.edge('LS', left.buttons[BUTTON.thumbstick]?.pressed)) this.setCompact(!this.compact);
    this.voiceInput(right);
    if (left && this.edge('Y', left.buttons[BUTTON.secondary]?.pressed)) {
      this.velocity.set(0, 0, 0);
      this.placeHead(this.tourStep()?.pose ?? this.host.startPose());
      this.bannerSnap();
    }

    this.bannerFollow(dt);
    this.updateExitHover();
    this.updateMenu(dt);

    this.panelClock -= dt;
    if (this.panelClock <= 0 && this.panel.mesh.visible) {
      this.panelClock = 0.2;
      this.panel.draw(
        this.host.panelLines({
          kind: 'fly',
          altitudeM: this.headPosition.y,
          aglM,
          speedMs: this.speedMs,
          headingDeg: headingDeg(this.headForward),
          xray: this.xray,
          tabletopScale: null,
        })
      );
    }
  }

  /**
   * The tabletop frame: no locomotion, the surroundings stand still and the MODEL moves. Every
   * input is read in real metres (the controllers' own local poses), turned into a new tabletop pose, and
   * the rig is recomputed from it.
   */
  private updateTabletop(dt: number, frame: XRFrame | undefined) {
    const space = this.host.renderer.xr.getReferenceSpace();
    const pose = frame && space ? frame.getViewerPose(space) : null;
    if (!pose || !this.tabletop) return;
    const t = pose.transform;
    this.headReal.set(t.position.x, t.position.y, t.position.z);
    this.headForwardReal
      .set(0, 0, -1)
      .applyQuaternion(new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w));

    if (this.transition) {
      // Diving into the city (AR session): the table pose no longer drives the rig.
      this.updateTransition(dt);
      this.headPosition.copy(this.headReal).applyMatrix4(this.rig.matrixWorld);
      this.headForward.copy(this.headForwardReal).applyQuaternion(this.rig.quaternion);
      this.posed = true;
      this.banner.follow(this.headReal, this.headForwardReal, dt);
      this.updateExitHover();
      return;
    }

    if (this.pendingTable) {
      this.pendingTable = false;
      const start = initialTable(this.headReal, this.headForwardReal, aheadFor(this.host.tabletop?.extentM?.(), this.tabletop.scale));
      this.tabletop.table.copy(start.table);
      this.tabletop.yaw = start.yaw;
      this.banner.snap(this.headReal, this.headForwardReal);
    }

    const { left, right } = this.gamepads();
    // Grab with either hand. The grip's local position IS the real-space position: it is a child of the
    // rig, and three writes the controller pose into its local matrix.
    for (const grip of this.grips) {
      const hand = grip.userData.handedness as string | undefined;
      if (!hand) continue;
      const pad = hand === 'left' ? left : hand === 'right' ? right : null;
      this.handReal.setFromMatrixPosition(grip.matrix);
      const moved = this.grab.update(hand, Boolean(pad?.buttons[BUTTON.squeeze]?.pressed), this.handReal, this.tabletop.table);
      if (moved) this.tabletop.table.copy(moved);
    }

    if (right) {
      this.tabletop.yaw = yawStep(this.tabletop.yaw, deadZone(axis(right, 'x')), dt);
      this.tabletop.scale = scaleStep(this.tabletop.scale, -deadZone(axis(right, 'y')), dt);
    }
    if (left) this.tabletop.table.y = liftStep(this.tabletop.table.y, -deadZone(axis(left, 'y')), dt);

    if (right && this.edge('A', right.buttons[BUTTON.primary]?.pressed)) this.pressA();
    if (right && this.edge('B', right.buttons[BUTTON.secondary]?.pressed) && this.host.tabletop) {
      const next = this.host.tabletop.nextSite();
      if (next instanceof THREE.Vector3) this.tabletop.anchor.copy(next);
      else this.retable(next);
      this.panelClock = 0;
    }
    if (left && this.edge('X', left.buttons[BUTTON.primary]?.pressed)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
    }
    if (left && this.edge('LS', left.buttons[BUTTON.thumbstick]?.pressed)) this.setCompact(!this.compact);
    this.voiceInput(right);
    if (left && this.edge('Y', left.buttons[BUTTON.secondary]?.pressed)) {
      this.tabletop.scale = this.tourStep()?.table?.scale ?? TABLETOP_DEFAULT_SCALE;
      const start = initialTable(this.headReal, this.headForwardReal, aheadFor(this.host.tabletop?.extentM?.(), this.tabletop.scale));
      this.tabletop.table.copy(start.table);
      this.tabletop.yaw = start.yaw;
      this.grab.reset();
      this.banner.snap(this.headReal, this.headForwardReal);
    }

    this.updateStopMotion(dt);
    // Autoplay may just have started a dive: the rig belongs to the transition now.
    if (this.transition || !this.tabletop || this.world) return;
    applyTabletop(this.rig, this.tabletop);

    // The banner states the scale, so it must state the CURRENT one. Redrawn only when the
    // readable label changes, not on every frame of a stick push.
    if (scaleLabel(this.tabletop.scale) !== this.bannerScale) this.refreshBanner();

    // World-space head, for telemetry and for the host's camera uniforms.
    this.headPosition.copy(this.headReal).applyMatrix4(this.rig.matrixWorld);
    this.headForward.copy(this.headForwardReal).applyQuaternion(this.rig.quaternion);
    this.posed = true;
    this.banner.follow(this.headReal, this.headForwardReal, dt);
    this.updateExitHover();
    this.updateMenu(dt);

    this.panelClock -= dt;
    if (this.panelClock <= 0 && this.panel.mesh.visible) {
      this.panelClock = 0.2;
      this.panel.draw(
        this.host.panelLines({
          kind: 'tabletop',
          altitudeM: this.headPosition.y,
          aglM: null,
          speedMs: 0,
          headingDeg: headingDeg(this.headForward),
          xray: this.xray,
          tabletopScale: this.tabletop.scale,
        })
      );
    }
  }

  /** Head position in world metres, as of this frame's update. */
  headWorld(): THREE.Vector3 {
    return this.headPosition;
  }

  /**
   * Put a different model on the table (another extent or scale), from B or from the host's menu.
   * The table stays where the viewer put it, at its height and turn; only when the bigger model's
   * near edge would stand inside the viewer does its centre move away from them, just far enough.
   */
  retable(next: { anchor: THREE.Vector3; scale: number }) {
    if (!this.tabletop) return;
    this.tabletop.anchor.copy(next.anchor);
    this.tabletop.scale = next.scale;
    this.grab.reset();
    const need = aheadFor(this.host.tabletop?.extentM?.(), next.scale);
    const dx = this.tabletop.table.x - this.headReal.x;
    const dz = this.tabletop.table.z - this.headReal.z;
    const dist = Math.hypot(dx, dz);
    if (dist < need) {
      const fx = dist > 1e-3 ? dx / dist : this.headForwardReal.x;
      const fz = dist > 1e-3 ? dz / dist : this.headForwardReal.z;
      const len = Math.hypot(fx, fz) || 1;
      this.tabletop.table.x = this.headReal.x + (fx / len) * need;
      this.tabletop.table.z = this.headReal.z + (fz / len) * need;
    }
    this.panelClock = 0;
  }

  /** Height above ground of the head, for the host's level-of-detail choices. */
  headAglM(): number {
    const ground = this.host.groundAt(this.headPosition.x, this.headPosition.z);
    return ground === null ? this.headPosition.y : this.headPosition.y - ground;
  }

  telemetry() {
    return {
      presenting: this.presenting,
      kind: this.viewKind,
      session: this.kind,
      transition: this.transition ? { toWorld: this.transition.toWorld, t: Math.round(this.transition.t * 100) / 100, scale: Math.round(this.rig.scale.x) } : null,
      held: this.tour ? Math.round(this.tour.heldS * 10) / 10 : null,
      head: this.headPosition.toArray().map((v) => Math.round(v * 10) / 10),
      headingDeg: Math.round(headingDeg(this.headForward)),
      speedMs: Math.round(this.speedMs * 10) / 10,
      flying: this.flight !== null,
      xray: this.xray,
      rigYawDeg: Math.round(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(this.rig.quaternion, 'YXZ').y)),
      rigScale: Math.round(this.rig.scale.x),
      exit: this.exitTelemetry(),
      menu: this.presenting && this.menu.mesh.visible
        ? {
            rows: this.menuRows().map((row, i) => ({
              id: row.id,
              on: row.on ?? null,
              real: this.realOf(this.menu.mesh, this.menu.rowCentre(i)),
            })),
            hover: this.menuHover,
          }
        : null,
      smallButtons: this.smallButtons,
      voice: { state: this.voiceState, panel: this.answer.mesh.visible, last: this.voiceLast },
      compact: this.compact,
      tour: this.tour
        ? {
            ...this.tourState(),
            next: this.presenting && this.nextButton.mesh.visible ? this.realOf(this.nextButton.mesh) : null,
            nextHover: this.nextHover,
          }
        : null,
      tabletop: this.tabletop
        ? {
            scale: Math.round(this.tabletop.scale),
            table: this.tabletop.table.toArray().map((v) => Math.round(v * 1000) / 1000),
            yawDeg: Math.round(THREE.MathUtils.radToDeg(this.tabletop.yaw)),
            anchor: this.tabletop.anchor.toArray().map((v) => Math.round(v)),
            holding: this.grab.holding,
          }
        : null,
    };
  }

  /** Move the rig so the head lands exactly on a pose, wherever in the play space the viewer is. */
  private placeHead(target: XrStartPose) {
    const currentYaw = Math.atan2(-this.headForward.x, -this.headForward.z);
    turnRigAboutHead(this.rig, this.headPosition, target.yaw - currentYaw);
    const y = THREE.MathUtils.clamp(this.headForward.y, -1, 1);
    const h = Math.sqrt(1 - y * y);
    this.headForward.set(-Math.sin(target.yaw) * h, y, -Math.cos(target.yaw) * h);
    this.rig.position.add(target.position.clone().sub(this.headPosition));
    this.headPosition.copy(target.position);
  }

  private applyXray(preset: XrayPreset) {
    this.xray = preset;
    this.host.setXray(preset);
    this.panelClock = 0;
  }

  private onSelect(controller: THREE.Group) {
    if (!this.presenting) return;
    controller.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1)
      .transformDirection(controller.matrixWorld)
      .normalize();
    // The buttons are drawn over everything, so they win over whatever the ray meets behind them.
    const menuRow = this.menuHit(controller);
    if (menuRow !== null) {
      const source = this.inputSourceFor(controller.userData.handedness);
      void (source?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): unknown }[] }) | undefined)
        ?.hapticActuators?.[0]?.pulse(0.35, 30);
      this.chooseMenuRow(menuRow.row);
      return;
    }
    if (this.buttonHit(controller, this.nextButton) !== null) {
      const source = this.inputSourceFor(controller.userData.handedness);
      void (source?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): unknown }[] }) | undefined)
        ?.hapticActuators?.[0]?.pulse(0.5, 40);
      this.advanceTour();
      return;
    }
    if (this.buttonHit(controller, this.exitButton) !== null) {
      const source = this.inputSourceFor(controller.userData.handedness);
      void (source?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): unknown }[] }) | undefined)
        ?.hapticActuators?.[0]?.pulse(0.5, 40);
      this.exit();
      return;
    }
    const index = this.host.pick(new THREE.Ray(origin, direction));
    this.host.select(index);
    this.panelClock = 0;
    this.panel.mesh.visible = true;
    const source = this.inputSourceFor(controller.userData.handedness);
    const actuator = (source?.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): unknown }[] }) | undefined)
      ?.hapticActuators?.[0];
    // A tick when something was hit, nothing when the ray found nothing.
    if (index !== null) void actuator?.pulse(0.35, 30);
  }

  /**
   * World distance from the controller to where its ray meets a banner button, or null. Only a
   * connected controller with a visible button counts.
   */
  private buttonHit(controller: THREE.Group, button: ExitButton): number | null {
    if (!controller.userData.handedness || !this.banner.mesh.visible || !button.mesh.visible) return null;
    controller.updateMatrixWorld(true);
    button.mesh.updateWorldMatrix(true, false);
    const ray = this.exitRaycaster.ray;
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld).normalize();
    const hit = this.exitRaycaster.intersectObject(button.mesh, false)[0];
    return hit ? hit.distance : null;
  }

  /** The menu row a controller points at, with the ray's distance to it. */
  private menuHit(controller: THREE.Group): { row: number; distance: number } | null {
    if (!controller.userData.handedness || !this.banner.mesh.visible || !this.menu.mesh.visible) return null;
    controller.updateMatrixWorld(true);
    this.menu.mesh.updateWorldMatrix(true, false);
    const ray = this.exitRaycaster.ray;
    ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld).normalize();
    const hit = this.exitRaycaster.intersectObject(this.menu.mesh, false)[0];
    if (!hit?.uv) return null;
    const row = this.menu.rowAt(hit.uv);
    return row === null ? null : { row, distance: hit.distance };
  }

  private menuRows(): MenuRow[] {
    return this.host.menu?.rows({ smallButtons: this.smallButtons, compact: this.compact }) ?? [];
  }

  private toggleMenu(open = !this.menu.mesh.visible) {
    if (open && !this.host.menu) return;
    this.menu.mesh.visible = open;
    if (open && this.voiceState !== 'recording' && this.voiceState !== 'waiting') this.answer.mesh.visible = false;
    this.menuClock = 0;
    if (open) this.refreshMenu();
  }

  private refreshMenu() {
    if (!this.host.menu) return;
    this.menu.setRows(this.host.menu.title(), this.menuRows());
  }

  /** While open, a few times a second: a layer finishing its build changes its row. */
  private updateMenu(dt: number) {
    if (!this.menu.mesh.visible) return;
    this.menuClock -= dt;
    if (this.menuClock > 0) return;
    this.menuClock = 0.25;
    this.refreshMenu();
  }

  private chooseMenuRow(index: number) {
    const row = this.menuRows()[index];
    if (!row) return;
    // Nothing reshapes the table half way through a dive or a rise.
    if (this.transition && !row.id.startsWith('__')) return;
    if (row.id === '__close') {
      this.toggleMenu(false);
      return;
    }
    if (row.id === '__voice') {
      // Tap to start, tap again to send: the same as holding the right stick.
      this.toggleMenu(false);
      if (this.voiceState === 'recording') this.sendVoice();
      else this.startVoice();
      return;
    }
    if (row.id === '__buttons') {
      this.smallButtons = !this.smallButtons;
      try { window.localStorage.setItem(BUTTONS_KEY, this.smallButtons ? 'small' : 'large'); } catch { /* private mode */ }
      this.applyButtonSize();
    } else if (row.id === '__compact') {
      this.setCompact(!this.compact);
    } else {
      this.host.menu?.toggle(row.id);
      // Spoken questions switched off from the menu: drop a question in progress with them.
      if (!this.host.voice?.enabled() && this.voiceState !== 'idle') this.cancelVoice();
    }
    this.menuClock = 0.1;
    this.refreshMenu();
  }

  // ------------------------------------------------------------------ spoken questions

  /**
   * Right stick: hold to speak, release to ask. A short tap (under 0.35 s) asks nothing and
   * dismisses the answer panel instead, so the same control clears what it put there.
   */
  private voiceInput(right: Gamepad | null) {
    // Off (the default): return before touching anything, every frame.
    if (!this.host.voice?.enabled()) return;
    const down = Boolean(right?.buttons[BUTTON.thumbstick]?.pressed);
    const was = this.pressed.get('RS') ?? false;
    this.pressed.set('RS', down);
    if (down === was) return;
    if (down) {
      this.voicePressedAt = performance.now();
      if (this.voiceState !== 'recording') this.startVoice();
    } else if (this.voiceState === 'recording') {
      if (performance.now() - this.voicePressedAt < 350) this.cancelVoice();
      else this.sendVoice();
    }
  }

  private startVoice() {
    const voice = this.host.voice;
    if (!voice?.enabled()) return;
    const seq = ++this.voiceSeq;
    this.voiceState = 'recording';
    this.menu.mesh.visible = false;
    this.answer.show({ status: 'listening' }, voice.labels());
    voice.start().catch((error: unknown) => {
      if (seq !== this.voiceSeq) return;
      this.voiceState = 'shown';
      this.answer.show({ status: 'error', message: `${voice.labels().failed}: ${error instanceof Error ? error.message : String(error)}` }, voice.labels());
    });
  }

  private sendVoice() {
    const voice = this.host.voice;
    if (!voice || this.voiceState !== 'recording') return;
    const seq = ++this.voiceSeq;
    this.voiceState = 'waiting';
    const labels = voice.labels();
    this.answer.show({ status: 'thinking' }, labels);
    voice.finish().then((result) => {
      if (seq !== this.voiceSeq || !this.presenting) return;
      this.voiceState = 'shown';
      this.voiceLast = result;
      if (!result || !result.frage) {
        this.answer.show({ status: 'error', message: labels.nothing }, labels);
      } else {
        this.answer.show({ status: 'answer', frage: result.frage, antwort: result.antwort, note: labels.note }, labels);
      }
    }).catch((error: unknown) => {
      if (seq !== this.voiceSeq || !this.presenting) return;
      this.voiceState = 'shown';
      this.answer.show({ status: 'error', message: `${labels.failed}: ${error instanceof Error ? error.message : String(error)}` }, labels);
    });
  }

  /** Stop listening, forget any answer in flight, hide the panel. */
  private cancelVoice() {
    this.voiceSeq += 1;
    if (this.voiceState !== 'idle') this.host.voice?.cancel();
    this.voiceState = 'idle';
    this.answer.mesh.visible = false;
  }

  private setCompact(compact: boolean) {
    this.compact = compact;
    try { window.localStorage.setItem(COMPACT_KEY, compact ? 'on' : 'off'); } catch { /* private mode */ }
    this.banner.setCompact(compact);
    this.applyButtonSize();
    if (this.menu.mesh.visible) this.refreshMenu();
  }

  /**
   * Exit and Next at full or small size, their inner edges next to the banner. Compact: small
   * and side by side in the middle, where the hidden banner was.
   */
  private applyButtonSize() {
    const s = this.smallButtons || this.compact ? SMALL_BUTTONS : 1;
    const x = (this.compact ? 0.03 : BUTTON_INNER_X) + BUTTON_HALF_W * s;
    this.exitButton.mesh.scale.setScalar(s);
    this.exitButton.mesh.position.set(x, 0, EXIT_OFFSET.z);
    this.nextButton.mesh.scale.setScalar(s);
    this.nextButton.mesh.position.set(-x, 0, NEXT_OFFSET.z);
  }

  /**
   * Highlight the button while a ray points at it, and make that ray end ON the button: in the
   * tabletop session the drawn ray is shorter than the distance to the banner, in the fly session
   * far longer, and a ray that visibly touches the button is what says "pull the trigger now".
   */
  private updateExitHover() {
    let exit = false;
    let next = false;
    let menuRow: number | null = null;
    const tabletop = this.viewKind === 'tabletop';
    for (let i = 0; i < this.controllers.length; i += 1) {
      const toExit = this.buttonHit(this.controllers[i], this.exitButton);
      const toNext = this.buttonHit(this.controllers[i], this.nextButton);
      const toMenu = this.menuHit(this.controllers[i]);
      const distance = toMenu?.distance ?? toNext ?? toExit;
      const ray = this.rays[i];
      if (toExit !== null) exit = true;
      if (toNext !== null) next = true;
      if (toMenu !== null) menuRow = toMenu.row;
      if (distance !== null) {
        // Controller units are real metres in both sessions; the rig carries the world scale.
        ray.scale.z = distance / this.rig.scale.x / RAY_M;
      } else {
        ray.scale.z = tabletop ? TABLETOP_RAY_M / RAY_M : 1;
      }
    }
    this.setExitHover(exit);
    if (menuRow !== this.menuHover) {
      this.menuHover = menuRow;
      this.menu.setHover(menuRow);
    }
    if (next !== this.nextHover) {
      this.nextHover = next;
      this.nextButton.setHover(next);
    }
  }

  private setExitHover(hover: boolean) {
    this.exitHover = hover;
    this.exitButton.setHover(hover);
  }

  /** A mesh's position in the rig's own frame = the controllers' real space, for tests to aim at. */
  private realOf(mesh: THREE.Object3D, local?: THREE.Vector3) {
    this.rig.updateMatrixWorld(true);
    mesh.updateWorldMatrix(true, false);
    const world = local ? mesh.localToWorld(local.clone()) : new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const real = this.rig.worldToLocal(world);
    return real.toArray().map((n) => Math.round(n * 1000) / 1000);
  }

  private exitTelemetry() {
    if (!this.presenting) return null;
    this.rig.updateMatrixWorld(true);
    this.exitButton.mesh.updateWorldMatrix(true, false);
    // In the rig's own frame = the controllers' real space, so a test can aim a controller at it.
    const real = this.rig.worldToLocal(new THREE.Vector3().setFromMatrixPosition(this.exitButton.mesh.matrixWorld));
    const round = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n * 1000) / 1000);
    return {
      visible: this.banner.mesh.visible && this.exitButton.mesh.visible,
      hover: this.exitHover,
      real: round(real),
      controllers: this.controllers
        .filter((c) => c.userData.handedness)
        .map((c) => ({ hand: c.userData.handedness as string, real: round(new THREE.Vector3().setFromMatrixPosition(c.matrix)) })),
    };
  }

  private inputSourceFor(handedness: XRHandedness | undefined): XRInputSource | undefined {
    const session = this.host.renderer.xr.getSession();
    if (!session || !handedness) return undefined;
    return Array.from(session.inputSources).find((s) => s.handedness === handedness);
  }

  private gamepads(): { left: Gamepad | null; right: Gamepad | null } {
    const session = this.host.renderer.xr.getSession();
    let left: Gamepad | null = null;
    let right: Gamepad | null = null;
    if (session) {
      for (const source of session.inputSources) {
        if (!source.gamepad) continue;
        if (source.handedness === 'left') left = source.gamepad;
        else if (source.handedness === 'right') right = source.gamepad;
      }
    }
    return { left, right };
  }

  private edge(name: string, down: boolean | undefined): boolean {
    const was = this.pressed.get(name) ?? false;
    this.pressed.set(name, Boolean(down));
    return Boolean(down) && !was;
  }

  /**
   * The schematic network strokes are a fixed number of PIXELS wide, so they need the eye's
   * resolution, not the page's, or they come out several times too thin in the headset.
   */
  private setLineResolution(xrCamera: THREE.ArrayCamera) {
    const eye = xrCamera.cameras[0] as (THREE.Camera & { viewport?: THREE.Vector4 }) | undefined;
    if (eye?.viewport) this.onEyeResolution?.(eye.viewport.z, eye.viewport.w);
  }

  /** Set by the host: called with the per-eye resolution once the session has one. */
  onEyeResolution: ((width: number, height: number) => void) | null = null;

  dispose() {
    this.disposed = true;
    this.cancelVoice();
    const { renderer } = this.host;
    renderer.xr.removeEventListener('sessionstart', this.onSessionStart);
    renderer.xr.removeEventListener('sessionend', this.onSessionEnd);
    void renderer.xr.getSession()?.end();
    this.panel.dispose();
    this.exitButton.dispose();
    this.nextButton.dispose();
    this.menu.dispose();
    this.answer.dispose();
    this.banner.dispose();
    this.vignette.dispose();
    for (const ray of this.rays) {
      ray.geometry.dispose();
      (ray.material as THREE.Material).dispose();
    }
  }
}

function axis(pad: Gamepad, which: 'x' | 'y'): number {
  // xr-standard puts the thumbstick on axes 2 and 3 (0 and 1 are the touchpad Quest does not have).
  const base = pad.axes.length >= 4 ? 2 : 0;
  return pad.axes[base + (which === 'x' ? 0 : 1)] ?? 0;
}

/** Compass heading of a direction, degrees clockwise from north (−Z). */
function headingDeg(forward: THREE.Vector3): number {
  const deg = THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z));
  return (deg + 360) % 360;
}

function buildRay(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -40),
  ]);
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute([0.55, 0.95, 0.85, 0.55, 0.95, 0.85], 3)
  );
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    fog: false,
  });
  const line = new THREE.Line(geometry, material);
  line.name = 'xr-ray';
  line.frustumCulled = false;
  return line;
}

/**
 * A plain handle where the controller is. Deliberately not the controller's real model: three's
 * model factory downloads the meshes from a public CDN at runtime, and this app fetches nothing
 * from a third party at page load (see `vite.config.ts`).
 */
function buildHandle(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.11, 12),
    new THREE.MeshStandardMaterial({ color: 0x1b2a30, roughness: 0.5, metalness: 0.2 })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.name = 'xr-handle';
  return mesh;
}
