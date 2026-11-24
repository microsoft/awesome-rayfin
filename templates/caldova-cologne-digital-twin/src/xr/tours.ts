import type { XrKind } from './xrSession';

/**
 * The headset tours of the Caldova twin, in WGS84 and quarter-hours so they survive a rebuild of
 * the terrain. Each stop sets the one clock (slot, speed) together with the place, so the picture
 * never contradicts itself: the vans at the docks are the vans of that minute.
 *
 * ⚠️ EVERY 1:1 VIEWPOINT IS MEASURED SHARP, NOT PICKED BY EYE. The 2025 NRW mesh carries 0.25 m texels around the Messe and
 * the Confex, 0.5 m around the Dom, 1.6 m everywhere else and 5 m in the ring. From a few dozen metres
 * a 1.6 m texel fills 50+ Quest pixels: the first bridge stop (24 m over the Rhine) was 90 % smeared.
 * A ray-cast probe checks each view and counts the mesh it sees at more than
 * 6 Quest pixels per texel; the VR stops below score 0 to 3 % (bridge stop: 90 %). Re-run it before
 * adding a VR stop. The table stops are sharp at any of their scales (a 1.6 m texel is 0.3 mm at 1:5000).
 *
 * ⚠️ AND EACH WAS LOOKED AT IN THE EMULATED QUEST: a view can
 * score sharp and still be dull. A 1:1 convoy at the docks never read (6 m vans behind halls), so
 * the first wave is shown from above the Messe, where its routes light up towards the Dom. Pharmacy
 * pins are switched off at the cathedral: 120 blue cones over a postcard view are clutter.
 * The first wave leaves the hall at 05:30 (slot 22.0).
 *
 * ⚠️ THE MORNING TOUR IS ONE AR SESSION, PACED BY THE VIEWER (A or Next); dives, flights, circles and the rise play by themselves. The 1:1 stops are reached by DIVING into the table and left by RISING back
 * onto it (`XrMode.startTransition`), so there is no session handoff and no tap on the page. Each 1:1
 * stop circles slowly (`orbit`); the orbit's whole arc was blur-checked too, not just its start:
 * the panorama circles clockwise because counter-clockwise drifts over 1.6 m tiles (16 % blurry).
 */

export interface Text {
  de: string;
  en: string;
}

export interface TourStop {
  kind: XrKind;
  title: Text;
  body: Text;
  /** Tabletop: which part of the city stands on the table, and at which scale denominator. */
  table?: { view: 'small' | 'medium' | 'big'; scale: number };
  /** Fly: where the head goes, its height above ground and its compass heading. */
  lat?: number;
  lon?: number;
  aglM?: number;
  headingDeg?: number;
  /** The clock: fractional quarter-hour of the day, and simulated seconds per real second (0 = paused). */
  slot: number;
  speed: number;
  hall: boolean;
  tours: boolean;
  /** Open the wrist panel on arrival. */
  showPanel?: boolean;
  /** Autoplay: seconds at this stop before the tour moves on. */
  holdS?: number;
  /** Fly: slowly circle this point (degrees per second; positive = clockwise seen from above). */
  orbit?: { lat: number; lon: number; degPerS: number };
  /** Tabletop: turn the model slowly (degrees per second). */
  spinDegPerS?: number;
}

export interface HeadsetTour {
  id: string;
  name: Text;
  /** Plays by itself: each stop holds for `holdS`, then dives, flies or rises to the next. */
  autoplay?: boolean;
  stops: TourStop[];
}

export const HEADSET_TOURS: readonly HeadsetTour[] = [
  {
    id: 'morgen',
    name: { de: 'Bevor Köln aufwacht', en: 'Before Cologne wakes up' },
    // Paced by the viewer (A or Weiter), so there is time to look and grab; the dive, the flights,
    // the slow circles and the rise still play by themselves.
    autoplay: false,
    stops: [
      {
        kind: 'tabletop',
        title: { de: 'Halb fünf. Köln schläft.', en: 'Half past four. Cologne is asleep.' },
        body: {
          de: 'Nur ein Gebäude ist wach: das Logistikzentrum in der Messe. Reales Gebäude, fiktive Firma.',
          en: 'Only one building is awake: the logistics centre at the trade fair. Real building, fictional company.',
        },
        table: { view: 'medium', scale: 5000 },
        slot: 18,
        speed: 0,
        hall: false,
        tours: true,
        holdS: 14,
        spinDegPerS: 1.5,
      },
      {
        kind: 'tabletop',
        title: { de: 'Nachtkommissionierung', en: 'Night picking' },
        body: {
          de: 'Das Dach hebt sich: Wareneingang, Lager, Kühlraum mit 2 bis 8 °C, BtM-Tresor, Rampen. Der Aufbau ist synthetisch.',
          en: 'The roof lifts: goods in, storage, the cold room at 2 to 8 °C, the narcotics vault, the docks. The layout is synthetic.',
        },
        table: { view: 'medium', scale: 5000 },
        slot: 18.1,
        speed: 10,
        hall: true,
        tours: true,
        showPanel: true,
        holdS: 14,
        spinDegPerS: 1,
      },
      {
        kind: 'fly',
        title: { de: 'Hinein, im echten Maßstab', en: 'Inside, at true scale' },
        body: {
          de: 'Die Halle, 1:1. Rundherum schläft die Stadt.',
          en: 'The hall, 1:1. Around it, the city sleeps.',
        },
        lat: 50.94629,
        lon: 6.97355,
        aglM: 120,
        headingDeg: 158,
        orbit: { lat: 50.9441324, lon: 6.9747092, degPerS: -2 },
        slot: 18.6,
        speed: 10,
        hall: true,
        tours: true,
        holdS: 14,
      },
      {
        kind: 'fly',
        title: { de: 'Halb sechs: die erste Welle', en: 'Half past five: the first wave' },
        body: {
          de: 'Die Fahrzeuge verlassen die Rampen, bevor die erste Apotheke öffnet (die Touren sind ein Modell). Rhein, Hohenzollernbrücke, Dom.',
          en: 'The vans leave the docks before the first pharmacy opens (the tours are a model). The Rhine, the Hohenzollern bridge, the cathedral.',
        },
        lat: 50.94508,
        lon: 6.97645,
        aglM: 120,
        headingDeg: 253,
        orbit: { lat: 50.9413, lon: 6.95828, degPerS: 0.5 },
        slot: 21.9,
        speed: 10,
        hall: false,
        tours: true,
        holdS: 18,
      },
      {
        kind: 'fly',
        title: { de: 'Der Dom', en: 'The cathedral' },
        body: {
          de: '157 m Kathedrale, im echten Maßstab. Gemessenes 3D-Mesh, Bildflug 2025. Nichts ist überhöht.',
          en: 'A 157 m cathedral at true scale. Measured 3D mesh, 2025 survey flight. Nothing is exaggerated.',
        },
        lat: 50.943,
        lon: 6.9606,
        aglM: 200,
        headingDeg: 222,
        orbit: { lat: 50.9413, lon: 6.95828, degPerS: -3 },
        slot: 24,
        speed: 60,
        hall: false,
        tours: false,
        holdS: 16,
      },
      {
        kind: 'tabletop',
        title: { de: 'Der ganze Ring, der ganze Tag', en: 'The whole ring, the whole day' },
        body: {
          de: 'Alle Touren in der Region, als Modell. Ein Zwilling, eine Datenbasis: eine Fabric App.',
          en: 'Every tour in the region, as a model. One twin, one data platform: one Fabric App.',
        },
        table: { view: 'big', scale: 10000 },
        slot: 32,
        speed: 300,
        hall: false,
        tours: true,
        holdS: 20,
        spinDegPerS: 2,
      },
    ],
  },
  {
    id: 'tisch',
    name: { de: 'Köln auf dem Tisch', en: 'Cologne on the table' },
    stops: [
      {
        kind: 'tabletop',
        title: { de: 'Köln auf dem Tisch', en: 'Cologne on the table' },
        body: {
          de: 'Messe, Deutz, Rhein und Altstadt fein in der Mitte, rundherum gröber: 7 km gemessenes 3D-Mesh auf 1,4 m. B: Tisch klein, mittel, groß.',
          en: 'The trade fair, Deutz, the Rhine and the old town in fine detail, coarser around them: 7 km of measured 3D mesh on 1.4 m. B: table small, medium, big.',
        },
        table: { view: 'medium', scale: 5000 },
        slot: 36,
        speed: 0,
        hall: false,
        tours: false,
      },
    ],
  },
];
