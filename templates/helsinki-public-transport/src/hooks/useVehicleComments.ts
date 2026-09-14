import { useCallback, useEffect, useRef, useState } from 'react';

import type { VehicleComment } from '../../rayfin/data/VehicleComment';
import { getRayfinClient } from '@/services/rayfinClient';

/** What the list needs; the entity carries a couple of fields the panel never shows. */
export type CommentRow = Pick<
  VehicleComment,
  'id' | 'body' | 'author' | 'createdAt' | 'user_id'
>;

export interface UseVehicleComments {
  comments: CommentRow[];
  loading: boolean;
  /** Set when the data service is unreachable - usually "not signed in" rather than a real fault. */
  error: string | null;
  saving: boolean;
  add: (body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const FIELDS = ['id', 'body', 'author', 'createdAt', 'user_id'] as const;

/**
 * Operator notes for one vehicle.
 *
 * Deliberately *not* polled. The fleet position refreshes every few seconds because it is
 * genuinely changing; comments change when a human types one, so re-reading them on a timer would
 * be a request per second per user for data that is almost always identical. The list refetches
 * when the selection changes and after a write.
 */
export function useVehicleComments(vehicleId: string | null): UseVehicleComments {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow response for a previously selected vehicle overwriting the current one.
  const requestId = useRef(0);

  const load = useCallback(async (id: string) => {
    const ticket = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const rows = await getRayfinClient()
        .data.VehicleComment.select([...FIELDS])
        .where({ vehicle_id: { eq: id } })
        .orderBy({ createdAt: 'desc' })
        .execute();
      if (ticket !== requestId.current) return;
      setComments((rows ?? []) as CommentRow[]);
    } catch (e) {
      if (ticket !== requestId.current) return;
      setComments([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!vehicleId) {
      requestId.current += 1;
      setComments([]);
      setError(null);
      setLoading(false);
      return;
    }
    void load(vehicleId);
  }, [vehicleId, load]);

  const add = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!vehicleId || !trimmed) return;
      setSaving(true);
      setError(null);
      try {
        const client = getRayfinClient();
        const session = client.auth.getSession();
        const user = session.user;
        if (!user) throw new Error('not signed in');
        await client.data.VehicleComment.create({
          vehicle_id: vehicleId,
          body: trimmed,
          author: user.email || 'unknown',
          createdAt: new Date(),
          // Written client-side, but the update/delete policy re-checks it against the JWT `sub`
          // claim server-side, so forging it here buys nothing.
          user_id: user.id,
        });
        await load(vehicleId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [vehicleId, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!vehicleId) return;
      setError(null);
      try {
        await getRayfinClient().data.VehicleComment.delete({ id });
        await load(vehicleId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [vehicleId, load],
  );

  return { comments, loading, error, saving, add, remove };
}
