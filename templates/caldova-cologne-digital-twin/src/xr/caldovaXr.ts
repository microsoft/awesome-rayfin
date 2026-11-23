import * as THREE from 'three';

import type { Twin3DHandle, TwinTableView, TwinXrPick } from '@/twin3d/scene';

import { HEADSET_TOURS, type TourStop } from './tours';
import type { PanelLine } from './xrPanel';
import { scaleLabel } from './xrTabletop';
import { XrMode, type XrHost, type XrKind, type XrTourStep } from './xrSession';

/**
 * The Caldova twin in a Meta Quest. The rig, locomotion, tabletop arithmetic, wrist panel and tour
 * engine are generic (shared with other twins, `xrSession.ts` and friends); this file
 * only tells them what this scene is.
 *
 * - Tabletop: the photoreal core on the table at 1:5000; B swaps to the whole delivery region at
 *   1:20000 with the coarse ring mesh. One uniform scale on all axes, always stated.
 * - Fly: 1:1 through Köln.
 * - Trigger on the hall opens or closes it; on a van shows its tour on the wrist panel.
 * - A opens the menu: clock play or pause, faster, slower, tours on or off, hall.
 *
 * ⚠️ THE PAGE'S rAF STOPS DURING A SESSION, so the day scrubber cannot drive the clock in the
 * headset. The clock lives here while presenting and is handed back to the page on exit.
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface CaldovaImmersiveOptions {
  handle: Twin3DHandle;
  /** Current translation function and language, read at call time so a switch applies at once. */
  t(): Translate;
  locale(): 'de' | 'en';
  onPresentingChange(presenting: boolean, kind: XrKind): void;
  /** The session ended: tell the page where the clock and the layers stand now. */
  onSync(state: { slot: number; tours: boolean; hall: boolean }): void;
}

/** Simulated seconds per real second the menu steps through. 0 is paused. */
const SPEEDS = [1, 10, 60, 300, 900] as const;
const SECONDS_PER_SLOT = 15 * 60;
/** Scale denominator per table view: the core on a desk, the region on the same desk. */
const TABLE_SCALE: Record<TwinTableView, number> = { small: 5000, medium: 5000, big: 5000 };
/** B and the menu step through the table sizes in this order. */
const TABLE_ORDER: readonly TwinTableView[] = ['small', 'medium', 'big'];
const SLOTS = 96;

export class CaldovaImmersive {
  readonly mode: XrMode;
  private picked: TwinXrPick | null = null;
  private view: TwinTableView = 'medium';
  private slot: number;
  private speedIndex = 2;
  private playing = false;

  constructor(private readonly options: CaldovaImmersiveOptions) {
    const twin = options.handle;
    const xr = twin.xr;
    this.slot = twin.dcSlot();
    const t = () => options.t();

    const host: XrHost = {
      renderer: xr.renderer,
      scene: xr.scene,
      camera: xr.camera,
      groundAt: (x, z) => xr.groundAt(x, z),
      pick: (ray) => {
        this.picked = xr.pickRay(ray);
        return this.picked ? 0 : null;
      },
      select: (index) => {
        if (index === null) {
          this.picked = null;
          return;
        }
        // The hall answers the trigger by opening or closing, like its label on the map.
        if (this.picked?.kind === 'hall') xr.setHall(!twin.dcOpen());
      },
      // Nothing in this scene thins out; the presets stay solid.
      setXray: () => undefined,
      nextLens: () => false,
      panelLines: (state) => this.panelLines(state.kind, state.tabletopScale, state.altitudeM, state.aglM),
      bannerText: (kind, scale) =>
        kind === 'tabletop'
          ? { title: t()('xr.bannerTable', { scale: scaleLabel(scale ?? 5000, this.localeTag()) }), body: t()('xr.bannerTableHelp') }
          : { title: t()('xr.bannerFly'), body: t()('xr.bannerFlyHelp') },
      exitLabel: () => t()('xr.exit'),
      nextLabel: (last) => t()(last ? 'xr.tourEnd' : 'xr.tourNext'),
      menu: {
        title: () => t()('xr.menuTitle'),
        rows: ({ smallButtons, compact }) => [
          { id: 'clock', label: t()(this.playing ? 'xr.menuPause' : 'xr.menuPlay', { time: clockLabel(this.slot) }) },
          { id: 'faster', label: t()('xr.menuFaster', { speed: SPEEDS[this.speedIndex] }) },
          { id: 'slower', label: t()('xr.menuSlower') },
          { id: 'tours', label: t()('xr.menuTours'), on: twin.toursVisible() },
          { id: 'hall', label: t()('xr.menuHall'), on: twin.dcOpen() },
          // Only while the viewer is at the table: in the 1:1 city of an AR session it would clip the world.
          ...(this.mode.viewKind === 'tabletop'
            ? [{ id: 'table', label: t()('xr.menuTable', { size: t()(`xr.table_${this.view}`) }) }]
            : []),
          { id: '__compact', label: t()(compact ? 'xr.menuExpand' : 'xr.menuCompact') },
          { id: '__buttons', label: t()(smallButtons ? 'xr.menuButtonsLarge' : 'xr.menuButtonsSmall') },
          { id: '__close', label: t()('xr.menuClose') },
        ],
        toggle: (id) => {
          if (id === 'clock') this.playing = !this.playing;
          else if (id === 'faster') {
            this.speedIndex = Math.min(this.speedIndex + 1, SPEEDS.length - 1);
            this.playing = true;
          } else if (id === 'slower') this.speedIndex = Math.max(this.speedIndex - 1, 0);
          else if (id === 'tours') xr.setTours(!twin.toursVisible());
          else if (id === 'hall') xr.setHall(!twin.dcOpen());
          else if (id === 'table' && this.mode.viewKind === 'tabletop') this.mode.retable(this.switchTable());
        },
      },
      startPose: () => {
        // South of the hall, high enough to see the site, facing north onto it.
        const hall = xr.hallCentre() ?? xr.tableAnchor('small');
        const position = new THREE.Vector3(hall.x, 0, hall.z + 700);
        position.y = xr.groundAt(position.x, position.z) + 420;
        return { position, yaw: 0 };
      },
      onPresentingChange: (presenting) => {
        // ⚠️ The desktop view is saved BEFORE the session opens (see `begin`): by the time this runs
        // the rig has already taken the camera and zeroed it (found 2026-11-20).
        if (!presenting) {
          this.picked = null;
          xr.restoreDesktop();
          options.onSync({ slot: this.slot, tours: twin.toursVisible(), hall: twin.dcOpen() });
        }
        options.onPresentingChange(presenting, this.mode.sessionKind);
      },
      tabletop: {
        anchor: () => xr.tableAnchor(this.view),
        setActive: (active) => xr.setTabletop(active ? this.view : null),
        extentM: () => xr.tableExtent(this.view),
        nextSite: () => this.switchTable(),
      },
    };
    this.mode = new XrMode(host);

    xr.setXrFrame((dt, frame) => {
      if (this.mode.isPresenting && this.playing) {
        this.slot = (this.slot + (dt * SPEEDS[this.speedIndex]) / SECONDS_PER_SLOT + SLOTS) % SLOTS;
        twin.setDcSlot(this.slot);
      }
      this.mode.update(dt, frame);
      return this.mode.isPresenting && this.mode.hasPose ? this.mode.headWorld() : null;
    });
  }

  static supported(kind: XrKind): Promise<boolean> {
    return XrMode.supported(kind);
  }

  enter(kind: XrKind): Promise<void> {
    // A plain session starts from the page's clock, paused.
    this.slot = this.options.handle.dcSlot();
    this.playing = false;
    if (kind === 'tabletop') this.view = 'medium';
    return this.begin(() => this.mode.enter(kind));
  }

  startTour(id: string): Promise<void> {
    const tour = HEADSET_TOURS.find((entry) => entry.id === id);
    if (!tour) return Promise.reject(new Error(`Unknown tour ${id}`));
    return this.begin(() => this.mode.startTour(tour.stops.map((stop) => this.tourStep(stop)), { autoplay: tour.autoplay }));
  }

  /** After an AR/VR handoff: the page's tap opens the next stop's session. */
  continueTour(): Promise<void> {
    return this.begin(() => this.mode.continueTour());
  }

  /**
   * Save the desktop view while the camera still holds it, then open the session. A refused or
   * failed session gives the view straight back.
   */
  private async begin(open: () => Promise<void>): Promise<void> {
    const xr = this.options.handle.xr;
    xr.saveDesktop();
    try {
      await open();
    } catch (error) {
      if (!this.mode.isPresenting) xr.restoreDesktop();
      throw error;
    }
  }

  telemetry(): Record<string, unknown> {
    return {
      ...this.mode.telemetry(),
      clock: { slot: Math.round(this.slot * 100) / 100, time: clockLabel(this.slot), playing: this.playing, speed: SPEEDS[this.speedIndex] },
      view: this.view,
      picked: this.picked,
      hallOpen: this.options.handle.dcOpen(),
    };
  }

  dispose() {
    this.options.handle.xr.setXrFrame(null);
    this.mode.dispose();
  }

  private tourStep(stop: TourStop): XrTourStep {
    const twin = this.options.handle;
    const xr = twin.xr;
    const text = (value: { de: string; en: string }) => value[this.options.locale()];
    let pose: XrTourStep['pose'];
    if (stop.kind === 'fly' && stop.lat !== undefined && stop.lon !== undefined) {
      const at = xr.worldOf(stop.lat, stop.lon);
      // Yaw 0 faces north (-Z) and turns counter-clockwise; a compass heading turns clockwise.
      pose = { position: new THREE.Vector3(at.x, at.y + (stop.aglM ?? 60), at.z), yaw: -THREE.MathUtils.degToRad(stop.headingDeg ?? 0) };
    }
    return {
      kind: stop.kind,
      title: () => text(stop.title),
      body: () => text(stop.body),
      table: stop.table ? { anchor: xr.tableAnchor(stop.table.view), scale: stop.table.scale } : undefined,
      pose,
      showPanel: stop.showPanel,
      holdS: stop.holdS,
      spinDegPerS: stop.spinDegPerS,
      orbit: stop.orbit
        ? (() => {
            const at = xr.worldOf(stop.orbit.lat, stop.orbit.lon);
            return { target: at, degPerS: stop.orbit.degPerS };
          })()
        : undefined,
      enter: () => {
        // Only the choice: XrMode shows the table when the viewer is actually at it (after a rise,
        // not at its start, or the 1:1 city would vanish under a table clip mid-air).
        if (stop.table) this.view = stop.table.view;
        this.slot = stop.slot;
        twin.setDcSlot(stop.slot);
        this.playing = stop.speed > 0;
        if (stop.speed > 0) {
          const nearest = SPEEDS.reduce((best, s, i) => (Math.abs(s - stop.speed) < Math.abs(SPEEDS[best] - stop.speed) ? i : best), 0);
          this.speedIndex = nearest;
        }
        xr.setTours(stop.tours);
        if (twin.dcOpen() !== stop.hall) xr.setHall(stop.hall);
        this.picked = stop.hall ? { kind: 'hall' } : null;
      },
    };
  }

  /** Next table size: small (fine core), medium (7 km), big (the whole ring), all at 1:5000. */
  private switchTable(): { anchor: THREE.Vector3; scale: number } {
    const xr = this.options.handle.xr;
    this.view = TABLE_ORDER[(TABLE_ORDER.indexOf(this.view) + 1) % TABLE_ORDER.length];
    xr.setTabletop(this.view);
    return { anchor: xr.tableAnchor(this.view), scale: TABLE_SCALE[this.view] };
  }

  private localeTag(): string {
    return this.options.locale() === 'de' ? 'de-DE' : 'en-GB';
  }

  private panelLines(kind: XrKind, tabletopScale: number | null, altitudeM: number, aglM: number | null): PanelLine[] {
    const t = this.options.t();
    const twin = this.options.handle;
    const lines: PanelLine[] = [
      { text: t('xr.panelTitle'), size: 'title' },
      { text: t('xr.panelClock'), value: `${clockLabel(this.slot)}${this.playing ? ` · ${SPEEDS[this.speedIndex]}x` : ''}` },
      { text: t('xr.panelActive'), value: String(twin.activeTours()) },
      { text: t('xr.panelAtStop'), value: String(twin.vansAtStop()) },
    ];
    if (kind === 'tabletop' && tabletopScale !== null) {
      lines.push({ text: t('xr.panelScale'), value: scaleLabel(tabletopScale, this.localeTag()) });
      lines.push({ text: t('xr.panelTable'), value: t(`xr.table_${this.view}`) });
    } else {
      lines.push(
        { text: t('xr.panelAltitude'), value: `${Math.round(altitudeM)} m` },
        { text: t('xr.panelAgl'), value: aglM === null ? '' : `${Math.round(aglM)} m` },
      );
    }
    if (this.picked?.kind === 'hall') {
      lines.push({ text: t('xr.pickHall'), size: 'body', colour: '#2fbf71' });
      for (const zone of (twin.dcInterior?.meta.zones ?? []).slice(0, 8)) {
        lines.push({ text: zoneName(zone, this.options.locale()), size: 'small' });
      }
      lines.push({ text: t('xr.pickHallNote'), size: 'small', colour: '#9fb3b8' });
    } else if (this.picked?.kind === 'van') {
      const fleet = twin.tours?.fleet()[this.picked.index];
      if (fleet) {
        lines.push({ text: t('xr.pickVan', { tour: fleet.tourId }), size: 'body', colour: '#f2b84b' });
        lines.push({ text: t('xr.pickVanType'), value: t(fleet.vehicleType === 'electric' ? 'xr.electric' : 'xr.diesel'), size: 'small' });
        lines.push({ text: t('xr.pickVanKm'), value: `${Math.round(fleet.distanceKm)} km`, size: 'small' });
        lines.push({ text: t('xr.pickVanNote'), size: 'small', colour: '#9fb3b8' });
      }
    }
    return lines;
  }
}

function clockLabel(slot: number): string {
  const minutes = Math.floor((((slot % SLOTS) + SLOTS) % SLOTS) * 15);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function zoneName(zone: { id: string; name: { de?: string; en: string } }, locale: 'de' | 'en'): string {
  return zone.name?.[locale] ?? zone.name?.en ?? zone.id;
}
