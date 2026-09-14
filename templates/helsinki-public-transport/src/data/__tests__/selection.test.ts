import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  MAX_TRACKED_VEHICLES,
  applySelect,
  closeTab,
  pruneSelection,
  type Selection,
} from '../selection';

const of = (ids: string[], activeId: string | null = ids[ids.length - 1] ?? null): Selection => ({
  ids,
  activeId,
});

describe('applySelect', () => {
  it('selects a single vehicle on a plain click', () => {
    expect(applySelect(EMPTY_SELECTION, 'a')).toEqual({ ids: ['a'], activeId: 'a' });
  });

  it('replaces the comparison on a plain click on something new', () => {
    expect(applySelect(of(['a', 'b']), 'c')).toEqual({ ids: ['c'], activeId: 'c' });
  });

  it('only activates on a plain click on something already selected', () => {
    // Collapsing the comparison here would throw away work the user has done.
    expect(applySelect(of(['a', 'b'], 'b'), 'a')).toEqual({ ids: ['a', 'b'], activeId: 'a' });
  });

  it('adds with a modifier and makes the newcomer active', () => {
    expect(applySelect(of(['a']), 'b', true)).toEqual({ ids: ['a', 'b'], activeId: 'b' });
  });

  it('removes with a modifier when already selected', () => {
    expect(applySelect(of(['a', 'b', 'c'], 'a'), 'b', true)).toEqual({
      ids: ['a', 'c'],
      activeId: 'a',
    });
  });

  it('moves the active tab to the left neighbour when the active one is removed', () => {
    expect(applySelect(of(['a', 'b', 'c'], 'b'), 'b', true)).toEqual({
      ids: ['a', 'c'],
      activeId: 'a',
    });
  });

  it('falls back to the new first tab when the active one was first', () => {
    expect(applySelect(of(['a', 'b'], 'a'), 'a', true)).toEqual({ ids: ['b'], activeId: 'b' });
  });

  it('clears on a click into empty space', () => {
    expect(applySelect(of(['a', 'b']), null)).toEqual(EMPTY_SELECTION);
  });

  it('ignores additions past the cap instead of evicting a track', () => {
    const full = of(Array.from({ length: MAX_TRACKED_VEHICLES }, (_, i) => `v${i}`));
    expect(applySelect(full, 'one-too-many', true)).toBe(full);
  });

  it('still allows a plain click when full', () => {
    const full = of(Array.from({ length: MAX_TRACKED_VEHICLES }, (_, i) => `v${i}`));
    expect(applySelect(full, 'fresh')).toEqual({ ids: ['fresh'], activeId: 'fresh' });
  });
});

describe('closeTab', () => {
  it('removes the tab and keeps the active one when it is untouched', () => {
    expect(closeTab(of(['a', 'b', 'c'], 'c'), 'a')).toEqual({ ids: ['b', 'c'], activeId: 'c' });
  });

  it('empties out when the last tab closes', () => {
    expect(closeTab(of(['a'], 'a'), 'a')).toEqual({ ids: [], activeId: null });
  });

  it('ignores an unknown id', () => {
    const selection = of(['a']);
    expect(closeTab(selection, 'nope')).toBe(selection);
  });
});

describe('pruneSelection', () => {
  it('is a no-op while every vehicle is still reporting', () => {
    const selection = of(['a', 'b']);
    expect(pruneSelection(selection, new Set(['a', 'b', 'c']))).toBe(selection);
  });

  it('drops vehicles that fell out of the feed', () => {
    expect(pruneSelection(of(['a', 'b'], 'b'), new Set(['a']))).toEqual({
      ids: ['a'],
      activeId: 'a',
    });
  });

  it('clears the active id when nothing is left', () => {
    expect(pruneSelection(of(['a'], 'a'), new Set())).toEqual({ ids: [], activeId: null });
  });
});
