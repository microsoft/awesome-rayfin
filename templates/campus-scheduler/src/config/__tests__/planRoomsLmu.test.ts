import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import buildings from '@config/buildings-lmu.json';
import planRooms from '@config/rooms-plan-lmu.json';

/**
 * ⚠️ READ AT RUNTIME BECAUSE `/data/` IS GITIGNORED — see the note in `planRooms.test.ts`. A
 * static import of the generated dataset makes the whole suite fail to LOAD on a fresh clone,
 * which is the first thing anyone does with a template.
 */
const generated = (rel: string): unknown | null => {
  const path = resolve(process.cwd(), rel);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as unknown) : null;
};

const synthetic = generated('data/synthetic-lmu/room.json');
const DATASET = synthetic !== null;
const NEEDS_DATASET = 'run `python tools/data/generate_timetable.py --site lmu` first';

/**
 * The rooms read off LMU's own published floor plans — PLAN §5.4.
 *
 * ⚠️ THIS PROJECT SPENT WEEKS RECORDING THAT "LMU HAS NO PLANS AT ALL", and it was never checked.
 * LMU runs a Raumfinder that serves, for every one of its 87 buildings, a floor plan as map tiles
 * AND every room's coordinate inside that plan. The assumption is what cost this site its
 * interiors, not the data — and the same class of assumption is what this file guards against
 * next time: the extractor is an image pipeline, so its output is tested as data.
 *
 * The failure modes are the OTH ones, because it is the same watershed:
 *
 *   - a wall threshold that misses the wall fuses neighbouring rooms into one region;
 *   - a region that escapes the drawing comes back as a confident room in a car park;
 *   - a simplified contour can fold over itself and still report a plausible area;
 *   - and a room that joins nothing in the dataset is decoration, however well it is drawn.
 *
 * What makes LMU's version checkable at all is that two independent sources name the same rooms:
 * 521 of the 526 rooms OpenStreetMap surveyed inside Oettingenstraße 67 carry a ref that is also a
 * room name in the Raumfinder. That agreement is the anchor the extractor fits on, and the reason
 * these outlines can be trusted where Galgenbergstraße 30's could not.
 */

interface PlanRoom {
  ref: string;
  building: string;
  level: number;
  areaM2: number;
  polygonUtm32: number[][];
}

const payload = planRooms as unknown as {
  refScope: string;
  buildings: Record<string, string>;
  rooms: PlanRoom[];
};
const rooms = payload.rooms;

const unwrap = <T,>(value: unknown, key: string): T[] =>
  Array.isArray(value) ? (value as T[]) : ((value as Record<string, T[]>)[key] ?? []);

const surveyed = unwrap<{ osmId?: string; polygonUtm32?: number[][] }>(buildings, 'buildings');

/** The surveyed polygon each published building code IS — declared by the extractor, not derived. */
const ringOf = (code: string) => {
  const osmId = payload.buildings[code];
  const match = surveyed.find((b) => b.osmId === osmId);
  expect(match, `no surveyed footprint for ${code} (${osmId})`).toBeTruthy();
  return match!.polygonUtm32 as number[][];
};

const areaOf = (poly: number[][]) =>
  Math.abs(
    poly.reduce((sum, [x, y], i) => {
      const [px, py] = poly[(i + 1) % poly.length];
      return sum + (x * py - px * y);
    }, 0) / 2
  );

const inside = (x: number, y: number, poly: number[][]) => {
  let hit = false;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit;
  }
  return hit;
};

const distanceTo = (x: number, y: number, poly: number[][]) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / span));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
};

const simple = (poly: number[][]) => {
  const side = (a: number[], b: number[], c: number[]) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const [p, p2, q, q2] = [poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]];
      if (side(p, p2, q) !== side(p, p2, q2) && side(q, q2, p) !== side(q, q2, p2)) return false;
    }
  }
  return true;
};

describe('rooms read from LMU floor plans', () => {
  it('covers three storeys of Oettingenstraße 67', () => {
    expect(rooms.length).toBeGreaterThanOrEqual(600);
    expect(new Set(rooms.map((r) => r.building))).toEqual(new Set(Object.keys(payload.buildings)));
    // ⚠️ Including the BASEMENT, which is not a rounding detail: LMU teaches in it, and the level
    // must survive as −1 rather than being folded onto the ground floor, or two storeys of rooms
    // stack through each other in the twin.
    expect(new Set(rooms.map((r) => r.level))).toEqual(new Set([-1, 0, 1]));
  });

  it('says whether its room numbers are unique across the university', () => {
    // ⚠️ NOT COSMETIC. LMU numbers by Trakt, so `A 001` exists here and in the Hauptgebäude; the
    // generator has to namespace these and it reads that from this field. Getting it wrong is how
    // 125 duplicate room ids reached the validator once already, and a duplicate key is what
    // Direct Lake refuses outright at refresh.
    expect(payload.refScope).toBe('building');
  });

  it('places every room inside the surveyed building footprint', () => {
    // Vertices, not centroids: a ring that pokes out of the building can have a centroid that does
    // not, and the vertices are what the 3D view actually draws. The tolerance is a wall.
    const strays = rooms
      .map((room) => {
        const ring = ringOf(room.building);
        return {
          ref: room.ref,
          out: room.polygonUtm32.filter(
            ([x, y]) => !inside(x, y, ring) && distanceTo(x, y, ring) > 1
          ),
        };
      })
      .filter((r) => r.out.length > 0);
    expect(strays.map((s) => s.ref)).toEqual([]);
  });

  it('traces rings that do not cross themselves', () => {
    expect(rooms.filter((room) => !simple(room.polygonUtm32)).map((r) => r.ref)).toEqual([]);
  });

  it('produces rooms of a plausible size', () => {
    const areas = rooms.map((r) => r.areaM2).sort((a, b) => a - b);
    expect(areas[0]).toBeGreaterThan(4);
    expect(areas[areas.length - 1]).toBeLessThan(400);
  });

  it('states an area that matches the ring it stores', () => {
    for (const room of rooms) {
      expect(Math.abs(areaOf(room.polygonUtm32) - room.areaM2)).toBeLessThan(1);
    }
  });

  it.skipIf(!DATASET)(`names rooms the timetable actually knows (${NEEDS_DATASET})`, () => {
    // Geometry that joins nothing in the dataset can never be coloured by its bookings, which is
    // the entire point of drawing it. The join is on what the PLAN calls the room, because the
    // dataset had to rename it — `A 001` there is `ax A 001` here.
    const known = new Set(
      unwrap<{ roomId: string; buildingId: string; level: number; planRef?: string | null }>(
        synthetic,
        'rooms'
      )
        .filter((r) => r.planRef)
        .map((r) => `${r.planRef}|${r.level}`)
    );
    const orphans = rooms.filter((r) => !known.has(`${r.ref}|${r.level}`));
    expect(orphans.map((r) => r.ref)).toEqual([]);
  });
});
