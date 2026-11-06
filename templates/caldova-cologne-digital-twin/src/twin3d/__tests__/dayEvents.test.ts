import { describe, expect, it } from 'vitest';

import { buildDayEvents, eventAt, stateAt, type TourTiming } from '@/twin3d/dayEvents';

/** A tour out from 04:15 (slot 17) to 10:15 (slot 41), standing still in the middle third. */
const morning: TourTiming = {
  departSlot: 17,
  returnSlot: 41,
  dwellSpans: [
    [0.3, 0.4],
    [0.6, 0.7],
  ],
};

/** A tour that leaves at 16:45 (slot 67) and comes back after midnight (slot 5). */
const evening: TourTiming = {
  departSlot: 67,
  returnSlot: 5,
  dwellSpans: [[0.5, 0.6]],
};

describe('the state of the fleet at a moment', () => {
  it('counts nothing before the wave leaves', () => {
    expect(stateAt(10, [morning])).toEqual({ active: 0, atStop: 0, atCoreStop: 0 });
  });

  it('counts the tour once it is out', () => {
    expect(stateAt(20, [morning])).toEqual({ active: 1, atStop: 0, atCoreStop: 0 });
  });

  it('knows when a van is standing at a pharmacy', () => {
    // A third of the way through a 24-slot round is slot 17 + 8 = 25.
    expect(stateAt(25.2, [morning])).toEqual({ active: 1, atStop: 1, atCoreStop: 0 });
  });

  it('separates a stop inside the modelled city from any other stop', () => {
    const withCore = { ...morning, coreDwellSpans: [[0.6, 0.7]] as [number, number][] };
    // The first stop is a stop, but not one in the photoreal core.
    expect(stateAt(25.2, [withCore])).toMatchObject({ atStop: 1, atCoreStop: 0 });
    // The second one is.
    expect(stateAt(32.6, [withCore])).toMatchObject({ atStop: 1, atCoreStop: 1 });
  });

  it('follows a tour across midnight', () => {
    // ⚠️ The evening wave returns at 05:00 the NEXT day. Treating a return slot lower than the
    // departure as "already finished" would make the whole wave invisible, and it would look
    // like missing data rather than like modular arithmetic.
    expect(stateAt(70, [evening]).active).toBe(1);
    expect(stateAt(2, [evening]).active).toBe(1);
    expect(stateAt(30, [evening]).active).toBe(0);
  });
});

describe('the named moments of the day', () => {
  const timings = [morning, evening];

  it('is empty when there is no fleet to describe', () => {
    expect(buildDayEvents([])).toEqual([]);
  });

  it('finds the first delivery of the day', () => {
    const events = buildDayEvents(timings, { minGapSlots: 0 });
    const first = events.find((e) => e.id === 'firstDrop');
    expect(first).toBeDefined();
    expect(first!.atStop).toBeGreaterThan(0);
    // It cannot happen before something is out.
    expect(first!.active).toBeGreaterThan(0);
  });

  it('finds the busiest moment on the road', () => {
    const events = buildDayEvents(timings, { minGapSlots: 0 });
    const peak = events.find((e) => e.id === 'peakOnRoad');
    expect(peak).toBeDefined();
    // Nothing in the day can beat the peak, by definition of a peak.
    for (let slot = 0; slot < 96; slot += 0.5) {
      expect(stateAt(slot, timings).active).toBeLessThanOrEqual(peak!.active);
    }
  });

  it('returns the moments in time order', () => {
    const events = buildDayEvents(timings, { minGapSlots: 0 });
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].slot).toBeGreaterThanOrEqual(events[i - 1].slot);
    }
  });

  it('keeps every marker inside the day', () => {
    const events = buildDayEvents(timings, { plannedWaves: [17, 46, 67], nightPickSlot: 84 });
    for (const event of events) {
      expect(event.slot).toBeGreaterThanOrEqual(0);
      expect(event.slot).toBeLessThan(96);
    }
  });

  it('keeps the planned name when a derived moment lands on top of it', () => {
    // ⚠️ The point of the collapse. A derived peak minutes away from a declared departure would
    // otherwise put two markers a pixel apart, and the one worth clicking is the one with a name.
    const events = buildDayEvents(timings, { plannedWaves: [17], minGapSlots: 4 });
    const near = events.filter((e) => Math.abs(e.slot - 17) < 4);
    expect(near).toHaveLength(1);
    expect(near[0].kind).toBe('planned');
  });

  it('never places two markers closer than the minimum gap', () => {
    const events = buildDayEvents(timings, { plannedWaves: [17, 46, 67], nightPickSlot: 84 });
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].slot - events[i - 1].slot).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('which moment the clock is in', () => {
  const events = buildDayEvents([morning, evening], { plannedWaves: [17, 67] });

  it('is nothing before the first moment', () => {
    expect(eventAt(-1, events)).toBeNull();
  });

  it('is the latest moment at or before the clock', () => {
    const found = eventAt(95, events);
    expect(found).not.toBeNull();
    expect(found!.slot).toBeLessThanOrEqual(95);
  });

  it('is the moment itself when the clock sits exactly on it', () => {
    const target = events[0];
    expect(eventAt(target.slot, events)?.id).toBe(target.id);
  });
});
