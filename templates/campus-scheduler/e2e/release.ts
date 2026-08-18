import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The publication switch, as the end-to-end suite sees it.
 *
 * ⚠️ THE SUITE USED TO BE PINNED TO ONE POSTURE, AND IT WAS THE ONE WE DO NOT PUBLISH.
 * `tum.spec.ts` opened Garching's week and `twin-sites.spec.ts` declared `planner: true` and
 * `lens: 'flow'` for it — all correct with `navigatumData: "include"`, and all impossible under
 * `"synthetic"`, which is the posture the template actually ships. A gallery template whose own
 * test suite is red on arrival is worse than one with fewer tests, and nothing in the repository
 * would have said so: the unit suite runs in all six postures (`tools/test_release_switch.py`),
 * the end-to-end suite ran in none.
 *
 * ⚠️ READ FROM THE FILE, NOT FROM `src/config/release.ts`. A spec is Node and the app module is
 * bundled through Vite aliases; importing it drags the whole config graph into the test runner.
 * The fail-closed rule is small enough to mirror, and `release.test.ts` already guards that the
 * app's own copy agrees with the file.
 */
const RAW = JSON.parse(
  readFileSync(resolve(process.cwd(), 'config/release.json'), 'utf-8'),
) as { navigatumData?: string; excludeAois?: string[]; realCustomerData?: string };

export type NavigatumMode = 'include' | 'synthetic' | 'exclude';

/** An unrecognised value fails CLOSED, exactly as `src/config/release.ts` does. */
export const NAVIGATUM_MODE: NavigatumMode =
  RAW.navigatumData === 'include' || RAW.navigatumData === 'synthetic'
    ? RAW.navigatumData
    : 'exclude';

export const EXCLUDED_AOIS: readonly string[] = RAW.excludeAois ?? [];

export const SHIPS_REAL_CUSTOMER_DATA = RAW.realCustomerData === 'include';

export const GARCHING_SHIPS = !EXCLUDED_AOIS.includes('garching');

/**
 * Garching's planner exists only where its TUMonline-derived dataset does.
 *
 * `hasPlanner` is `Boolean(schedulerSite)` and `applyRelease()` strips that field in both
 * non-`include` modes, so this is the one fact the rail, the week drawer, the assistant and the
 * walk list all follow from.
 */
export const GARCHING_HAS_PLANNER = GARCHING_SHIPS && NAVIGATUM_MODE === 'include';

/** Its interiors survive `synthetic` — the room polygons are OpenStreetMap's, not TUM's. */
export const GARCHING_HAS_INTERIORS = GARCHING_SHIPS && NAVIGATUM_MODE !== 'exclude';

/** The flow lens goes in `synthetic` too: it is routed from real consecutive bookings. */
export const GARCHING_LENS: 'flow' | 'occupancy' | null = !GARCHING_HAS_INTERIORS
  ? null
  : NAVIGATUM_MODE === 'include'
    ? 'flow'
    : 'occupancy';

/**
 * A one-line description of the posture, for skip reasons.
 *
 * ⚠️ EVERY SKIP IN THIS SUITE CARRIES ONE. A silently skipped spec is how four tests once sat
 * disabled while the run stayed green; Playwright prints the reason next to the skip, so the
 * report says *why* coverage is smaller rather than just being smaller.
 */
export const POSTURE = `navigatumData=${NAVIGATUM_MODE}, realCustomerData=${
  SHIPS_REAL_CUSTOMER_DATA ? 'include' : 'exclude'
}${EXCLUDED_AOIS.length ? `, excluded=${EXCLUDED_AOIS.join('/')}` : ''}`;
