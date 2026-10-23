/**
 * Paged, bounded Graph reads.
 *
 * Read-only by construction: the only HTTP method in this file is GET. A
 * follow-up link is followed only when it stays on the Graph v1.0 origin, and
 * a list that hits a bound is reported as "not readable", never returned
 * truncated: a short member list would look like a complete one.
 */
import { notReadable, ok, type Readable } from '@/um/domain/types';

export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
export const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`;
export const GRAPH_LIMITS = { pages: 50, items: 20_000 } as const;

export type GraphFetch = (url: string, init: RequestInit) => Promise<Response>;

function sameGraphEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === GRAPH_ORIGIN && parsed.pathname.startsWith('/v1.0/');
  } catch {
    return false;
  }
}

function reasonFor(status: number): Readable<never> {
  if (status === 401 || status === 403) return notReadable('access-denied', String(status));
  return notReadable('failed', String(status));
}

/** GET one object. */
export async function graphGetOne(
  path: string,
  token: string,
  fetcher: GraphFetch = fetch
): Promise<Readable<Record<string, unknown>>> {
  try {
    const response = await fetcher(`${GRAPH_BASE}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return reasonFor(response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return notReadable('failed', 'shape');
    return ok(body as Record<string, unknown>);
  } catch {
    return notReadable('failed');
  }
}

/** GET a whole collection, following `@odata.nextLink` to the end. */
export async function graphGetAll(
  path: string,
  token: string,
  fetcher: GraphFetch = fetch,
  headers: Record<string, string> = {}
): Promise<Readable<Record<string, unknown>[]>> {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let url = `${GRAPH_BASE}${path}`;

  try {
    for (let page = 0; page < GRAPH_LIMITS.pages; page++) {
      const response = await fetcher(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, ...headers },
      });
      if (!response.ok) return reasonFor(response.status);
      const body = (await response.json()) as { value?: unknown; '@odata.nextLink'?: unknown };
      if (!Array.isArray(body.value)) return notReadable('failed', 'shape');
      for (const entry of body.value) {
        if (entry && typeof entry === 'object') items.push(entry as Record<string, unknown>);
      }
      if (items.length > GRAPH_LIMITS.items) return notReadable('limit');

      const next = body['@odata.nextLink'];
      if (next === undefined || next === null || next === '') return ok(items);
      if (typeof next !== 'string' || !sameGraphEndpoint(next) || seen.has(next)) {
        return notReadable('failed', 'next-link');
      }
      seen.add(next);
      url = next;
    }
    return notReadable('limit');
  } catch {
    return notReadable('failed');
  }
}
