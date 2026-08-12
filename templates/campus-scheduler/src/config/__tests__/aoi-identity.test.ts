import { afterEach, describe, expect, it } from 'vitest';

import { activeAoi, AOIS, DEFAULT_AOI } from '@/config/aoi';

/**
 * The AOI object's IDENTITY, not its contents.
 *
 * `Twin3DView` builds the 3D campus in an effect keyed on `[aoi]`. That makes referential
 * stability a functional requirement rather than a performance nicety: a new object per render
 * disposes the WebGL scene and builds it again, taking every bit of interaction state with it.
 *
 * That is not hypothetical. `activeAoi()` used to spread a fresh `{ ...aoi, schedulerSite }`
 * whenever `?scheduler=` was set, and the campus rebuilt about once a second on an idle page —
 * measured at 25 rebuilds in 25 seconds. Symptoms were everywhere except where the cause was:
 * the e2e suite took 27 minutes, camera and label specs failed on timeouts, and clicking a
 * session in the calendar opened its building and lost it a second later.
 *
 * Nothing else in the suite would notice this. Every existing assertion is about the CONTENT of
 * the config, and the content was always correct.
 */
function setSearch(search: string) {
  window.history.replaceState({}, '', search === '' ? '/' : `/?${search}`);
}

afterEach(() => setSearch(''));

describe('activeAoi identity', () => {
  it('returns the very same object across calls when no override is set', () => {
    setSearch(`aoi=${DEFAULT_AOI}`);
    expect(activeAoi()).toBe(activeAoi());
    // The plain path is stable because it hands back the shared registry entry.
    expect(activeAoi()).toBe(AOIS[DEFAULT_AOI]);
  });

  it('returns the very same object across calls when ?scheduler= IS set', () => {
    setSearch(`aoi=${DEFAULT_AOI}&scheduler=oth`);
    const first = activeAoi();
    const second = activeAoi();

    // ⚠️ `toBe`, not `toEqual`. The bug this guards produced two objects that were deeply equal
    // and referentially different, so `toEqual` passes on the broken version and proves nothing.
    expect(second).toBe(first);
    expect(first.schedulerSite).toBe('oth');
  });

  it('still swaps object when the override itself changes', () => {
    /*
     * ⚠️ TWO SITES THAT SHIP IN EVERY POSTURE, DELIBERATELY. This used to switch from `oth` to
     * `oth-real`, which reads well — one campus, two timetables — and stopped being available the
     * day `config/release.json` gained the lever that withholds a customer's own export. The
     * property under test is the CACHE KEY, not which sites exist, so pinning it to a site the
     * release switch can remove made a publication decision look like a caching regression.
     */
    setSearch(`aoi=${DEFAULT_AOI}&scheduler=oth`);
    const generated = activeAoi();
    expect(generated.schedulerSite).toBe('oth');

    setSearch(`aoi=${DEFAULT_AOI}&scheduler=lmu`);
    const other = activeAoi();

    // Caching must not go so far that switching backend stops working — the cache is keyed, not
    // a one-shot. Rebuilding the scene HERE is correct: it is a different timetable.
    expect(other).not.toBe(generated);
    expect(other.schedulerSite).toBe('lmu');
  });

  it('ignores an unknown override rather than caching a broken site', () => {
    setSearch(`aoi=${DEFAULT_AOI}&scheduler=not-a-site`);
    expect(activeAoi()).toBe(AOIS[DEFAULT_AOI]);
  });
});
