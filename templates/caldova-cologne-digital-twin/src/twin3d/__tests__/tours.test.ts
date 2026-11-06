import { describe, expect, it } from 'vitest';

import { buildTimeline, nightAt, tourProgress } from '@/twin3d/tours';

/**
 * The operating day wraps, and most of the arithmetic that touches it is wrong if you forget.
 */

describe('a round is drive, stop, drive, stop', () => {
  // Four legs: hub → A → B → C → hub. Three of those arrivals are pharmacies; the last is home.
  const legs = [1000, 500, 1500, 2000];

  it('puts a stop at every pharmacy and none at the warehouse', () => {
    const { events } = buildTimeline(legs, 0.4);
    const dwells = events.filter((e) => e.kind === 'dwell');
    // ⚠️ Three, not four. The final leg ends at the warehouse, which is not a delivery.
    expect(dwells).toHaveLength(3);
    expect(dwells.map((e) => e.index)).toEqual([1, 2, 3]);
  });

  it('spends the asked-for share of the round standing still', () => {
    const share = 0.4;
    const { events, total } = buildTimeline(legs, share);
    const standing = events
      .filter((e) => e.kind === 'dwell')
      .reduce((sum, e) => sum + e.duration, 0);
    // This is what makes the stopping VISIBLE. If it ever silently drops to nothing the vans
    // glide through the pharmacies without pausing, and the layer stops answering the question
    // it exists to answer.
    expect(standing / total).toBeCloseTo(share, 6);
  });

  it('lays events end to end with no gap and no overlap', () => {
    const { events, total } = buildTimeline(legs, 0.4);
    let cursor = 0;
    for (const event of events) {
      expect(event.start).toBeCloseTo(cursor, 6);
      cursor += event.duration;
    }
    expect(cursor).toBeCloseTo(total, 6);
  });

  it('gives a longer leg proportionally more of the round', () => {
    const { events } = buildTimeline(legs, 0.4);
    const drives = events.filter((e) => e.kind === 'drive');
    // The 2000 m leg takes twice as long as the 1000 m one: the van moves at one speed.
    expect(drives[3].duration / drives[0].duration).toBeCloseTo(2, 6);
  });

  it('has no stops at all on a round with a single leg', () => {
    const { events } = buildTimeline([1200], 0.4);
    expect(events.filter((e) => e.kind === 'dwell')).toHaveLength(0);
  });

  it('degenerates safely when nothing is meant to stand still', () => {
    const { events, total } = buildTimeline(legs, 0);
    expect(events.filter((e) => e.kind === 'dwell')).toHaveLength(0);
    expect(total).toBeCloseTo(5000, 6);
  });

  it('survives a zero-length leg without dividing by zero', () => {
    // Two pharmacies at the same address is not a data error; it happens.
    const { events, total } = buildTimeline([1000, 0, 1000], 0.4);
    expect(Number.isFinite(total)).toBe(true);
    for (const event of events) expect(event.duration).toBeGreaterThan(0);
  });
});

describe('a routed path is road geometry, not a list of customers', () => {
  // Ten legs of road, but only three of the eleven points are deliveries.
  const legs = [200, 150, 300, 250, 180, 220, 400, 160, 300, 240];
  const stops = [3, 6, 9];

  it('stops only where the data says a delivery happens', () => {
    const { events } = buildTimeline(legs, 0.4, stops);
    const dwells = events.filter((e) => e.kind === 'dwell');
    // ⚠️ THREE, NOT NINE. Without being told, the old rule put a stop at the end of every leg but
    // the last — which on a real routed round of ~1 400 points would have the van pausing at every
    // bend in the road. The picture would look like a delivery to every junction in the region.
    expect(dwells.map((e) => e.index)).toEqual([3, 6, 9]);
  });

  it('still spends the asked-for share of the round standing still', () => {
    const { events, total } = buildTimeline(legs, 0.4, stops);
    const standing = events
      .filter((e) => e.kind === 'dwell')
      .reduce((sum, e) => sum + e.duration, 0);
    expect(standing / total).toBeCloseTo(0.4, 6);
  });

  it('ignores a stop index outside the path', () => {
    // A malformed index must not create an event at a point that does not exist.
    const { events } = buildTimeline([100, 100], 0.4, [1, 99, -4]);
    expect(events.filter((e) => e.kind === 'dwell').map((e) => e.index)).toEqual([1]);
  });

  it('drives straight through when nothing on the path is a stop', () => {
    const { events, total } = buildTimeline(legs, 0.4, []);
    expect(events.every((e) => e.kind === 'drive')).toBe(true);
    expect(total).toBeCloseTo(2400, 6);
  });

  it('can deliver at the last point before returning', () => {
    // The old rule could never place a stop on the final leg's end. A routed round ends at the
    // warehouse, but a fallback round ends at a customer.
    const { events } = buildTimeline([100, 100], 0.4, [1, 2]);
    expect(events.filter((e) => e.kind === 'dwell').map((e) => e.index)).toEqual([1, 2]);
  });
});

describe('where a tour is at a given quarter-hour', () => {
  // 04:15 is slot 17; a six-hour tour returns at slot 41.
  const depart = 17;
  const back = 41;

  it('is null before it leaves and after it returns', () => {
    expect(tourProgress(16, depart, back)).toBeNull();
    expect(tourProgress(42, depart, back)).toBeNull();
  });

  it('runs 0 to 1 across the tour', () => {
    expect(tourProgress(17, depart, back)).toBe(0);
    expect(tourProgress(29, depart, back)).toBeCloseTo(0.5, 6);
    expect(tourProgress(41, depart, back)).toBe(1);
  });

  it('⚠️ handles a tour that crosses midnight', () => {
    // The evening wave leaves at 16:45 (slot 67) and gets back at 01:00 (slot 4). `returnSlot` is
    // numerically SMALLER than `departSlot`, and plain `slot >= depart && slot <= return` makes the
    // whole late wave invisible — which reads as missing data, not as modular arithmetic.
    const evening = { depart: 67, back: 4 };
    expect(tourProgress(67, evening.depart, evening.back)).toBe(0);
    expect(tourProgress(90, evening.depart, evening.back)).not.toBeNull();
    expect(tourProgress(2, evening.depart, evening.back)).not.toBeNull();
    expect(tourProgress(4, evening.depart, evening.back)).toBe(1);
    // …and it is genuinely off the road in the middle of the afternoon.
    expect(tourProgress(50, evening.depart, evening.back)).toBeNull();
  });

  it('advances monotonically across midnight', () => {
    const a = tourProgress(90, 67, 4) ?? -1;
    const b = tourProgress(95, 67, 4) ?? -1;
    const c = tourProgress(2, 67, 4) ?? -1;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('how dark it is', () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h * 60 + m) / 15;
  };

  it('is fully dark when the night shift is picking', () => {
    // The demo opens at 03:40, which is the busiest the hall gets.
    expect(nightAt(at('03:40'))).toBe(1);
    expect(nightAt(at('23:00'))).toBe(1);
  });

  it('is fully light through the working day', () => {
    expect(nightAt(at('09:00'))).toBe(0);
    expect(nightAt(at('17:00'))).toBe(0);
  });

  it('passes through twilight rather than snapping', () => {
    const dawn = nightAt(at('05:00'));
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(1);
    const dusk = nightAt(at('21:00'));
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });
});
