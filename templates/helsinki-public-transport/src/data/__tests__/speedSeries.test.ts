import { describe, expect, it } from 'vitest';

import type { PathPoint } from '../model';
import { areaPath, buildSpeedSeries, linePath, nearestSample } from '../speedSeries';

function point(speed: number, timestamp: string): PathPoint {
  return { lat: 60.17, lon: 24.94, bearing: 0, speed, timestamp };
}

describe('buildSpeedSeries', () => {
  it('returns null for a track that cannot be drawn', () => {
    expect(buildSpeedSeries([])).toBeNull();
    expect(buildSpeedSeries([point(5, '2026-08-13T06:00:00Z')])).toBeNull();
  });

  it('converts m/s to km/h and summarises the track', () => {
    const series = buildSpeedSeries([
      point(0, '2026-08-13T06:00:00Z'),
      point(10, '2026-08-13T06:10:00Z'),
      point(5, '2026-08-13T06:20:00Z'),
    ])!;

    expect(series.samples.map((s) => s.kmh)).toEqual([0, 36, 18]);
    expect(series.minKmh).toBe(0);
    expect(series.maxKmh).toBe(36);
    expect(series.avgKmh).toBeCloseTo(18, 5);
  });

  it('spaces x by time, not by index', () => {
    // The middle sample arrives after a quarter of the window, not half of it.
    const series = buildSpeedSeries([
      point(1, '2026-08-13T06:00:00Z'),
      point(2, '2026-08-13T06:15:00Z'),
      point(3, '2026-08-13T07:00:00Z'),
    ])!;

    expect(series.timeScaled).toBe(true);
    expect(series.samples.map((s) => s.x)).toEqual([0, 0.25, 1]);
    expect(series.spanMs).toBe(60 * 60 * 1000);
  });

  it('falls back to index spacing when a timestamp will not parse', () => {
    const series = buildSpeedSeries([
      point(1, 'not a date'),
      point(2, '2026-08-13T06:15:00Z'),
      point(3, '2026-08-13T07:00:00Z'),
    ])!;

    expect(series.timeScaled).toBe(false);
    expect(series.samples.map((s) => s.x)).toEqual([0, 0.5, 1]);
  });

  it('falls back to index spacing when the whole track shares one timestamp', () => {
    const series = buildSpeedSeries([
      point(1, '2026-08-13T06:00:00Z'),
      point(2, '2026-08-13T06:00:00Z'),
    ])!;

    expect(series.timeScaled).toBe(false);
    expect(series.samples.map((s) => s.x)).toEqual([0, 1]);
  });

  it('keeps the ceiling above the peak and never below 10 km/h', () => {
    const parked = buildSpeedSeries([
      point(0, '2026-08-13T06:00:00Z'),
      point(0, '2026-08-13T06:10:00Z'),
    ])!;
    expect(parked.ceilingKmh).toBe(10);
    expect(parked.samples.every((s) => s.y === 0)).toBe(true);

    const fast = buildSpeedSeries([
      point(0, '2026-08-13T06:00:00Z'),
      point(25, '2026-08-13T06:10:00Z'), // 90 km/h
    ])!;
    expect(fast.ceilingKmh).toBeGreaterThan(fast.maxKmh);
    expect(fast.samples[1].y).toBeLessThanOrEqual(1);
  });

  it('treats a negative or missing speed as standing still', () => {
    const series = buildSpeedSeries([
      point(-3, '2026-08-13T06:00:00Z'),
      point(Number.NaN, '2026-08-13T06:10:00Z'),
      point(10, '2026-08-13T06:20:00Z'),
    ])!;
    expect(series.samples.map((s) => s.kmh)).toEqual([0, 0, 36]);
  });
});

describe('nearestSample', () => {
  const series = buildSpeedSeries([
    point(1, '2026-08-13T06:00:00Z'),
    point(2, '2026-08-13T06:30:00Z'),
    point(3, '2026-08-13T07:00:00Z'),
  ])!;

  it('snaps to the closest sample', () => {
    expect(nearestSample(series, 0)).toBe(0);
    expect(nearestSample(series, 0.4)).toBe(1);
    expect(nearestSample(series, 0.9)).toBe(2);
  });

  it('clamps a pointer that leaves the chart', () => {
    expect(nearestSample(series, -2)).toBe(0);
    expect(nearestSample(series, 5)).toBe(2);
  });
});

describe('svg geometry', () => {
  const series = buildSpeedSeries([
    point(0, '2026-08-13T06:00:00Z'),
    point(10, '2026-08-13T07:00:00Z'),
  ])!;

  it('draws left to right with y flipped for the SVG axis', () => {
    // 36 km/h against a ceiling of 40 sits at 90% height, i.e. y = 10 from the top.
    expect(linePath(series)).toBe('M0.00 100.00 L100.00 10.00');
  });

  it('closes the area along the baseline', () => {
    expect(areaPath(series)).toBe('M0.00 100.00 L100.00 10.00 L100.00 100 L0.00 100 Z');
  });
});
