import type { Snapshot } from '@/domain/types';

/**
 * The statements the app shows. Default: the snapshot baked from the semantic model at deploy time
 * (`tools/bake-snapshot.mjs`), shipped with the protected app files, so every signed-in user can open the app.
 * With `VITE_LIVE_MODEL=true` the same queries run live through the semantic-model connector instead
 * (see services/liveModel.ts and the README on the owner-only lock that comes with it).
 */
export async function loadSnapshot(): Promise<Snapshot> {
  if (import.meta.env.VITE_LIVE_MODEL === 'true') {
    const { loadLiveSnapshot } = await import('./liveModel');
    return loadLiveSnapshot();
  }
  const res = await fetch(`${import.meta.env.BASE_URL}data/statements.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`statements.json: HTTP ${res.status}`);
  return (await res.json()) as Snapshot;
}
