import { describe, expect, it } from 'vitest';

import { gatedFacts, isReleaseReady } from '../facts';

/**
 * The sourcing rule (PLAN §4.8) is a promise the app makes on every screen, so it is pinned here
 * rather than left to review. These tests deliberately assert the *rule*, not any particular
 * figure — figures come and go, the rule does not.
 */
describe('fact sourcing', () => {
  it('every gated fact carries a source', () => {
    for (const fact of gatedFacts()) {
      expect(fact.source).not.toBeNull();
    }
  });

  it('a reconstructed figure states its range', () => {
    // A single confident number for something that was derived rather than measured is the exact
    // false precision §4.8 exists to prevent.
    for (const fact of gatedFacts()) {
      if (fact.source?.reconstruction) expect(fact.range).toBeDefined();
    }
  });

  it('an empty registry does not count as release ready', () => {
    // `[].every()` is true, so the naive gate would pass an app that has registered nothing at
    // all. Phase 0 quotes no external figures, so this is the current state and it must read as
    // "not ready" rather than as a clean bill of health.
    expect(gatedFacts()).toHaveLength(0);
    expect(isReleaseReady()).toBe(false);
  });
});
