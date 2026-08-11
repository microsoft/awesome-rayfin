import * as THREE from 'three';

import { activeAoi } from '@/config/aoi';

import type { TerrainFocusPlace } from './terrainLoader';

/**
 * The guided tour — PLAN §7 phase 3.
 *
 * A demo has about fifteen seconds to earn attention, and "here is a mountain, please drag it
 * around" spends them badly. The tour is the answer to *what am I looking at* for somebody who has
 * never been to this valley and does not know why the mountain in front of them matters.
 *
 * Three rules it follows, all of which are about not being a video:
 *
 *  1. **It is interruptible at any moment.** Touching the controls stops it where it is rather than
 *     fighting for the camera or snapping back. A tour you cannot escape is a cutscene, and a
 *     cutscene in a data app is a way of saying the data does not matter.
 *  2. **It never invents a place.** Every stop is anchored to something already in the AOI config
 *     and already verified — a settlement, a station, a launch site — so the tour cannot drift out
 *     of step with the map the way a hard-coded list of coordinates would.
 *  3. **It respects `prefers-reduced-motion`.** Somebody who has asked the operating system not to
 *     animate things gets the stops without the flight between them.
 */

export interface TourStop {
  /** id of a focus place or flying site in the terrain metadata. */
  placeId: string;
  /** i18n key for the caption. */
  captionKey: string;
  /** How far back the camera sits, in metres. */
  rangeM: number;
  /** How long to hold once it arrives, in milliseconds. */
  holdMs: number;
}

/**
 * The route, per site.
 *
 * ⚠️ **This used to be a constant here, listing Oberstdorf place ids.** `createTour` skips stops the
 * AOI does not have — sound behaviour on its own — so the second site did not get a broken tour, it
 * got an *empty* one: a button that ran, did nothing, and reported no error. A route is a statement
 * about a particular mountain, so it belongs with the rest of that mountain's configuration.
 *
 * The shape is unchanged and Oberstdorf's stops moved across verbatim.
 */
export const TOUR: TourStop[] = activeAoi().tour;

export interface TourController {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface TourOptions {
  /** Everything the tour is allowed to point at. */
  places: TerrainFocusPlace[];
  /** Move the camera. Returns once the flight has been ordered, not once it has arrived. */
  flyTo(placeId: string, rangeM: number): void;
  /** Report the current caption, or null when the tour is not running. */
  onCaption(captionKey: string | null, index: number, total: number): void;
  /** Fired when the tour finishes or is interrupted. */
  onEnd(): void;
}

/** Roughly how long `flyTo` takes to settle, so a stop is held after arrival rather than during. */
const FLIGHT_MS = 1600;

export function createTour(options: TourOptions): TourController {
  // Skip stops the AOI does not have. A second site with no cable car should get a shorter tour,
  // not a broken one — and this is what keeps the tour honest about the map it is describing.
  const known = new Set(options.places.map((place) => place.id));
  const stops = TOUR.filter((stop) => known.has(stop.placeId));

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const advance = () => {
    if (!running) return;
    if (index >= stops.length) {
      stop();
      return;
    }

    const current = stops[index];
    options.flyTo(current.placeId, current.rangeM);
    options.onCaption(current.captionKey, index, stops.length);

    index += 1;
    timer = setTimeout(advance, current.holdMs + (reducedMotion ? 0 : FLIGHT_MS));
  };

  function stop() {
    if (!running) return;
    running = false;
    clear();
    options.onCaption(null, 0, stops.length);
    options.onEnd();
  }

  return {
    get running() {
      return running;
    },
    start() {
      if (running || stops.length === 0) return;
      running = true;
      index = 0;
      advance();
    },
    stop,
  };
}

/** Where the camera should sit for a place, at a given range. Shared with the observer camera. */
export function tourViewpoint(
  place: TerrainFocusPlace,
  widthM: number,
  depthM: number,
  rangeM: number
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = new THREE.Vector3(
    (place.u - 0.5) * widthM,
    place.groundM,
    (place.v - 0.5) * depthM
  );
  const position = new THREE.Vector3(
    target.x + rangeM * 0.45,
    target.y + rangeM * 0.75,
    target.z + rangeM * 0.65
  );
  return { position, target };
}
