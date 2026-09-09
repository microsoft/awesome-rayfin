import { describe, expect, it } from 'vitest';

import { clampSize, nextPresetSize } from '../usePaneSize';

/**
 * The sizing rules behind the drag handles.
 *
 * The dragging itself is covered in Playwright, because a pointer gesture that survives crossing a
 * WebGL canvas is only meaningfully tested against a real browser. What is worth testing here is
 * the arithmetic that decides where a pane is allowed to end up — the part that, if wrong, strands
 * a pane off-screen or makes a double click appear to do nothing.
 */

describe('clampSize', () => {
  it('keeps a pane inside its bounds', () => {
    expect(clampSize(500, 300, 760)).toBe(500);
    expect(clampSize(120, 300, 760)).toBe(300);
    expect(clampSize(2000, 300, 760)).toBe(760);
  });

  it('rounds to whole pixels, because a fractional pane width blurs its own border', () => {
    expect(clampSize(384.4, 300, 760)).toBe(384);
    expect(clampSize(384.6, 300, 760)).toBe(385);
  });

  it('prefers the maximum when the bounds cross', () => {
    // Happens transiently on a very short window, where the minimum for the pane below exceeds
    // what is left. Returning the max keeps the pane on screen instead of overflowing it.
    expect(clampSize(400, 500, 200)).toBe(200);
  });
});

describe('nextPresetSize', () => {
  const stops = [200, 400, 800];

  it('steps up to the next stop', () => {
    expect(nextPresetSize(stops, 150)).toBe(200);
    expect(nextPresetSize(stops, 200)).toBe(400);
    expect(nextPresetSize(stops, 500)).toBe(800);
  });

  it('wraps at the top, so repeated double clicks cycle rather than stick', () => {
    expect(nextPresetSize(stops, 800)).toBe(200);
    expect(nextPresetSize(stops, 900)).toBe(200);
  });

  it('does not select the stop it is already on', () => {
    // Within the tolerance the pane counts as already AT that stop, from either side, so the cycle
    // moves past it. Choosing it again would look like a dead double click — which is the case
    // that made the tolerance necessary.
    expect(nextPresetSize(stops, 402)).toBe(800);
    expect(nextPresetSize(stops, 398)).toBe(800);
    // Comfortably below it, though, the stop is still the next one up.
    expect(nextPresetSize(stops, 380)).toBe(400);
  });

  it('sorts the stops, so callers may declare them in any order', () => {
    expect(nextPresetSize([800, 200, 400], 250)).toBe(400);
  });

  it('returns null when there are no stops', () => {
    expect(nextPresetSize([], 300)).toBeNull();
  });
});
