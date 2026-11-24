import { describe, expect, it } from 'vitest';

import { HEADSET_TOURS } from '../tours';

describe('headset tours', () => {
  it('every stop is complete for its kind', () => {
    for (const tour of HEADSET_TOURS) {
      expect(tour.stops.length).toBeGreaterThan(0);
      for (const stop of tour.stops) {
        expect(stop.slot).toBeGreaterThanOrEqual(0);
        expect(stop.slot).toBeLessThan(96);
        expect(stop.speed).toBeGreaterThanOrEqual(0);
        if (stop.kind === 'tabletop') {
          expect(stop.table).toBeDefined();
          // One uniform scale, never 1:1 on a table and never past the 1:50 000 the rig allows.
          expect(stop.table!.scale).toBeGreaterThanOrEqual(1000);
          expect(stop.table!.scale).toBeLessThanOrEqual(50000);
        } else {
          // Fly stops stand inside the photoreal core around the Koelnmesse.
          expect(stop.lat).toBeGreaterThan(50.92);
          expect(stop.lat).toBeLessThan(50.96);
          expect(stop.lon).toBeGreaterThan(6.94);
          expect(stop.lon).toBeLessThan(6.99);
          expect(stop.aglM).toBeGreaterThan(0);
        }
      }
    }
  });

  it('speaks both languages without dashes', () => {
    for (const tour of HEADSET_TOURS) {
      for (const text of [tour.name, ...tour.stops.flatMap((s) => [s.title, s.body])]) {
        for (const value of [text.de, text.en]) {
          expect(value.trim().length).toBeGreaterThan(0);
          expect(value).not.toMatch(/[\u2013\u2014]/);
        }
      }
    }
  });

  it('the morning tour runs night to day, and the first-wave stop starts just before it', () => {
    const morning = HEADSET_TOURS.find((t) => t.id === 'morgen')!;
    const slots = morning.stops.map((s) => s.slot);
    expect([...slots].sort((a, b) => a - b)).toEqual(slots);
    // The first wave leaves the hall at slot 22.0 (05:30); the docks stop starts just before it.
    const wave = morning.stops.find((s) => s.kind === 'fly' && s.slot > 21.5 && s.slot < 22.5)!;
    expect(wave.slot).toBeGreaterThanOrEqual(21.8);
    expect(wave.slot).toBeLessThan(22.0);
  });

  it('the morning tour starts on the table, so it never needs a session handoff', () => {
    const morning = HEADSET_TOURS.find((t) => t.id === 'morgen')!;
    expect(morning.stops[0].kind).toBe('tabletop');
    for (const stop of morning.stops) expect(stop.holdS).toBeGreaterThan(5);
    for (const stop of morning.stops.filter((s) => s.orbit)) expect(Math.abs(stop.orbit!.degPerS)).toBeLessThanOrEqual(4);
  });
});
