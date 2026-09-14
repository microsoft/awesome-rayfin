import { describe, expect, it } from 'vitest';

import { compassPoint } from '../bearing';

describe('compassPoint', () => {
  it('maps the eight cardinal and intercardinal points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(135)).toBe('SE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(225)).toBe('SW');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(315)).toBe('NW');
  });

  it('rounds to the nearest point', () => {
    expect(compassPoint(22)).toBe('N');
    expect(compassPoint(23)).toBe('NE');
    expect(compassPoint(101)).toBe('E');
    expect(compassPoint(348)).toBe('N');
  });

  it('wraps back onto N instead of running off the table', () => {
    // 337.5 and up round to index 8, which must fold to 0 rather than be undefined.
    expect(compassPoint(355)).toBe('N');
    expect(compassPoint(360)).toBe('N');
    expect(compassPoint(720)).toBe('N');
  });

  it('accepts negative bearings', () => {
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(-45)).toBe('NW');
  });

  it('degrades to a dash when the feed sends nothing usable', () => {
    expect(compassPoint(Number.NaN)).toBe('-');
  });
});
