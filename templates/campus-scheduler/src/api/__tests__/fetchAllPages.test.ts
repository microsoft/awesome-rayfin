import { describe, expect, it } from 'vitest';

import { fetchAllPages } from '@/api/planStore';

/**
 * Reading a table means reading ALL of it — PLAN §24.5.
 *
 * ⚠️ THIS IS THE TEST THAT WAS MISSING WHEN A RESET DELETED ONE ROW OUT OF THREE AND SAID IT HAD
 * SUCCEEDED. Every list in `planStore.ts` used to end in `.execute()`. The Data API Builder applies
 * its OWN default page — 100 rows — when a query names no `first:`, and it returns that page as a
 * plain array with nothing to mark it as partial. So `listPlanAssignments` described the first 100
 * rows of a 1 925-row table as the whole table, and `clearPlanStore` filtered a truncated read for
 * non-baseline rows, found one of the three that existed, deleted it, and reported success.
 *
 * A truncated READ is survivable. A read-modify-write over a truncated read is data loss that
 * looks like a completed operation, which is why this is tested at the paging helper rather than
 * only where it is used: every future list gets the guarantee by construction.
 *
 * The tests below drive a fake builder, because the failure is in the CONTROL FLOW — whether the
 * cursor is followed — and not in anything the network does.
 */

/** A stand-in for the query builder: hands out fixed pages and records how it was asked. */
function fakePages(pages: { items: number[]; endCursor?: string; hasNextPage?: boolean }[]) {
  const asked: { first?: number; after?: string }[] = [];
  let call = 0;
  const build = () => {
    const state: { first?: number; after?: string } = {};
    const q = {
      first(n: number) {
        state.first = n;
        return q;
      },
      after(c: string) {
        state.after = c;
        return q;
      },
      async executePaginated() {
        asked.push({ ...state });
        const page = pages[call];
        call += 1;
        return page ?? { items: [], hasNextPage: false };
      },
    };
    return q;
  };
  return { build, asked, calls: () => call };
}

describe('reading every page', () => {
  it('follows the cursor to the end instead of stopping at the first page', async () => {
    const { build } = fakePages([
      { items: [1, 2, 3], endCursor: 'c1', hasNextPage: true },
      { items: [4, 5], endCursor: 'c2', hasNextPage: true },
      { items: [6], hasNextPage: false },
    ]);

    // The measured bug in one line: taking only the first page would return [1, 2, 3] — a
    // plausible-looking answer that is missing half the table.
    expect(await fetchAllPages<number>(build as never)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('passes the previous page cursor to the next request', async () => {
    const { build, asked } = fakePages([
      { items: [1], endCursor: 'c1', hasNextPage: true },
      { items: [2], hasNextPage: false },
    ]);
    await fetchAllPages<number>(build as never);

    expect(asked[0].after, 'the first page must not ask to continue from anywhere').toBeUndefined();
    expect(asked[1].after, 'the second page must continue from the first page cursor').toBe('c1');
  });

  it('asks for an explicit page size, because the default is the bug', async () => {
    const { build, asked } = fakePages([{ items: [1], hasNextPage: false }]);
    await fetchAllPages<number>(build as never);

    // Not "some number": leaving `first` unset is precisely what let DAB decide, and DAB decides
    // 100. The value must also stay inside DAB's own ceiling of 1 000, or the query is an error
    // rather than a bigger page.
    expect(asked[0].first).toBe(1000);
  });

  it('stops when the server reports no further page, even with a cursor in hand', async () => {
    // A server that returns `hasNextPage: false` WITH an `endCursor` is describing the last page.
    // Continuing on the cursor alone would re-request forever.
    const { build, calls } = fakePages([{ items: [1, 2], endCursor: 'c1', hasNextPage: false }]);

    expect(await fetchAllPages<number>(build as never)).toEqual([1, 2]);
    expect(calls()).toBe(1);
  });

  it('stops when a page claims more rows but hands back no cursor', async () => {
    // Contradictory, and the only safe reading is "this is the end" — the alternative is asking
    // for the same page forever.
    const { build, calls } = fakePages([{ items: [1], hasNextPage: true }]);

    expect(await fetchAllPages<number>(build as never)).toEqual([1]);
    expect(calls()).toBe(1);
  });

  it('cannot loop forever against a server that always claims another page', async () => {
    // A browser tab that never comes back is a worse failure than a short read, so the loop has a
    // ceiling. It is high enough (1 000 pages = 1 000 000 rows) that no real timetable reaches it.
    let call = 0;
    const build = () => {
      const q = {
        first: () => q,
        after: () => q,
        async executePaginated() {
          call += 1;
          return { items: [call], endCursor: `c${call}`, hasNextPage: true };
        },
      };
      return q;
    };

    const all = await fetchAllPages<number>(build as never);
    expect(call).toBe(1000);
    expect(all).toHaveLength(1000);
  });

  it('survives a page with no items array at all', async () => {
    const { build } = fakePages([
      { items: undefined as never, endCursor: 'c1', hasNextPage: true },
      { items: [7], hasNextPage: false },
    ]);

    expect(await fetchAllPages<number>(build as never)).toEqual([7]);
  });
});
