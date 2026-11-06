import { useCallback, useEffect, useRef, useState } from 'react';

import {
  liveClient,
  readReorders,
  resetMine,
  sendReorder,
  signIn,
  type LiveReorder,
  type SignIn,
} from './live';

export interface LiveState {
  /** `null` while signing in. */
  signIn: SignIn | null;
  reorders: LiveReorder[];
  /** The last READ failure, in the words the API used (a failed write throws to its caller). */
  error: string | null;
  isLoading: boolean;
  /** Ids that appeared through a send from this page, for the original's arrival flash. */
  justSent: ReadonlySet<string>;
  /** When this page last sent a reorder (ms), for the tile's short-lived "just sent by you" cue. */
  lastSentAt: number | null;
  /** Throws on failure, so the row that sent it can say "not sent" and why. */
  send: (item: { storeId: string; sku: string }, units: number) => Promise<void>;
  /** Throws on failure; answers how many of the caller's reorders were deleted. */
  reset: () => Promise<number>;
}

/**
 * Sign in once when the tab first opens, then keep the reorder list current by re-reading after
 * every write. No mirror lag any more: the tab reads the database it writes to, not the model, so
 * the original app's pending/cleared reconciliation is not needed.
 */
export function useLive(active: boolean): LiveState {
  const [auth, setAuth] = useState<SignIn | null>(null);
  const [reorders, setReorders] = useState<LiveReorder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [justSent, setJustSent] = useState<ReadonlySet<string>>(new Set());
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const started = useRef(false);

  const reload = useCallback(async (): Promise<LiveReorder[]> => {
    const c = liveClient();
    if (!c) return [];
    setIsLoading(true);
    try {
      const rows = await readReorders(c);
      setReorders(rows);
      setError(null);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void signIn().then((result) => {
      setAuth(result);
      if (result.kind === 'signed-in') void reload();
    });
  }, [active, reload]);

  const send = useCallback<LiveState['send']>(
    async (item, units) => {
      const c = liveClient();
      if (!c || auth?.kind !== 'signed-in') throw new Error('read-only');
      const before = new Set(reorders.map((r) => r.id));
      const sent = await sendReorder(c, auth.user, item, units);
      const after = await reload();
      // Prefer the id the create answered (a diff would also catch a colleague's
      // reorder landing at the same moment). Only if the API answered no id, fall back to the diff,
      // narrowed to the caller's own rows for this pharmacy and product.
      const fresh = sent.id
        ? [sent.id]
        : after
            .filter((r) => !before.has(r.id) && r.requestedById === auth.user.id && r.storeId === item.storeId && r.sku === item.sku)
            .map((r) => r.id);
      setJustSent((prev) => new Set([...prev, ...fresh]));
      setLastSentAt(Date.now());
    },
    [auth, reload, reorders]
  );

  const reset = useCallback(async () => {
    const c = liveClient();
    if (!c || auth?.kind !== 'signed-in') throw new Error('read-only');
    // Re-read first: delete only what is the caller's NOW, not what a stale list remembered.
    const current = await readReorders(c);
    try {
      return await resetMine(c, auth.user.id, current);
    } finally {
      // Re-read even when one delete failed half-way, so rows that ARE gone leave.
      await reload();
    }
  }, [auth, reload]);

  return { signIn: auth, reorders, error, isLoading, justSent, lastSentAt, send, reset };
}
