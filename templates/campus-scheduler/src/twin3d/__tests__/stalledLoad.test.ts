import { describe, expect, it, vi } from 'vitest';

import { StageTracker } from '@/twin3d/terrainLoader';

/**
 * A stalled download must fail, not hang.
 *
 * ⚠️ THIS GUARDS A BUG THAT WAS SEEN ONCE AND NEVER REPRODUCED. The live LMU build — the heaviest
 * asset in the app at 18.9 MB — sat at "Schritt 3 von 4, 18,9 / 18,9 MB" indefinitely, with the
 * rest of the UI alive and nothing in the console. `StageTracker.read` looped on `reader.read()`
 * with no timeout, so a body that stopped delivering was waited on forever.
 *
 * ⚠️ AND THE BAR LOOKED FULL, WHICH IS THE HALF THAT MADE IT UNDIAGNOSABLE. `totalBytes` is
 * declared from metadata rather than Content-Length, so a stall one chunk short of the end still
 * renders as "18,9 / 18,9". These tests therefore assert BOTH: that a dead stream fails, and that
 * a merely slow one does not — because a fix that just shortened the wait would break every load
 * on a conference network.
 */

/** A body that yields `chunks`, then never settles again. */
function stallingBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
        return;
      }
      // Never resolves, never closes — exactly what a dead connection looks like.
      return new Promise<void>(() => {});
    },
  });
}

function slowBody(chunks: Uint8Array[], gapMs: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(chunks[i++]);
    },
  });
}

const chunk = (n: number) => new Uint8Array(n).fill(7);

describe('a download that stops delivering', () => {
  it('fails instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new StageTracker('buildings', 3, () => {});
      tracker.addExpected(1000);
      const promise = tracker.read(new Response(stallingBody([chunk(400)])));
      const assertion = expect(promise).rejects.toThrow(/stalled/i);
      await vi.advanceTimersByTimeAsync(21_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('says which stage died and how far it got, not just that something failed', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new StageTracker('buildings', 3, () => {});
      tracker.addExpected(18_900_000);
      const promise = tracker.read(new Response(stallingBody([chunk(1_000_000)])));
      const assertion = expect(promise).rejects.toThrow(/buildings.*1\.0 of 18\.9 MB/s);
      await vi.advanceTimersByTimeAsync(21_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('MIRROR: a slow but living download still completes', async () => {
    // The failure mode of the fix itself. A conference network delivers 18.9 MB in chunks seconds
    // apart; if the guard fired on slowness rather than silence it would break every real load.
    const tracker = new StageTracker('buildings', 3, () => {});
    tracker.addExpected(300);
    const buffer = await tracker.read(new Response(slowBody([chunk(100), chunk(100), chunk(100)], 30)));
    expect(buffer.byteLength).toBe(300);
  });

  it('reports progress against the metadata total, which is why a stall can look complete', () => {
    // Documents the trap rather than fixing it: the denominator is declared, not measured, so
    // "18,9 / 18,9" is a rounding of 18.87, not proof the body finished.
    const seen: { loadedBytes: number; totalBytes: number }[] = [];
    const tracker = new StageTracker('buildings', 3, (u) => seen.push(u));
    tracker.addExpected(18_900_000);
    expect(seen.at(-1)?.totalBytes).toBe(18_900_000);
    expect(seen.at(-1)?.loadedBytes).toBe(0);
  });
});
