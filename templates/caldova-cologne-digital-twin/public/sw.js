/* Caldova Cologne: offline cache for stages without good WiFi.
 *
 * BUILD below is replaced at build time (vite.config.ts precacheManifest) with the hash of the
 * build, so EVERY build ships a different sw.js and the browser installs it.
 * (Without the token sw.js never changed, so a redeploy never installed.)
 *
 * ⚠️ ONE SOURCE PER PAGE. Terrain, mesh and the snapshots are not content-hashed, so a page must never
 * get its index.html from one build and its data from another. Every page (client) is given ONE mode
 * when it opens and keeps it for its whole life, also across a restart of this worker:
 *   - `{ cache: name }`: everything from that one COMPLETE build cache (the fast stage path);
 *   - `{ network: version }`: everything from the network (only content-hashed /assets/ may come from
 *     any cache when the network fails); `version` is the live build when the page opened, or null.
 * The page asks which build it is (`caldova-offline-status` answers with `page`), so the chip asks for
 * a reload only when a DIFFERENT build than the page's own is ready.
 *
 * ⚠️ A DEPLOY MUST SHOW ON THE NEXT OPEN, or a newly added tab stays invisible after a deploy.
 * The first version switched to a new build only after its ~67 MB had downloaded and then still served
 * the old cache until a later reload; a single failed file kept the old build for good while the chip
 * said "Offline bereit". Now every open asks the server which build is live (precache.json, no-store,
 * 3 s): a newer build than the newest complete cache opens from the network. Unreachable server: the
 * newest complete cache opens, as on stage. A redirect (session expired) opens from the network, so
 * the portal can sign the viewer in.
 *
 * The download does NOT run in `activate`: fetch events of claimed
 * pages wait for activation, so 67 MB there would freeze the page on stage WiFi. The page asks for it
 * (`caldova-offline-status`, repeated while pending, so the worker stays alive and resumes), and the
 * cache is marked complete only if the live build is still this one (finding 3).
 */
const BUILD = '__CALDOVA_BUILD__';
const PREFIX = 'caldova-offline-';
const CACHE = PREFIX + BUILD;
const COMPLETE = '/__caldova_complete__';
const MODES = 'caldova-sw-modes';
const MODES_KEY = '/__caldova_modes__';
// ⚠️ ignoreVary (measured 2026-10-18): the bundle loads with `crossorigin`, so the request carries
// an Origin header, the server answers `Vary: Origin`, and a plain match refused the stored entry.
const MATCH = { ignoreSearch: true, ignoreVary: true };
const LIVE_CHECK_MS = 3000;

let progress = { done: 0, total: 0 };
let downloading = null;
/** clientId → mode, mirrored in the MODES cache so a restarted worker keeps every page's source. */
let modes = null;

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(message);
}

async function isComplete(name = CACHE) {
  if (!(await caches.has(name))) return false;
  return Boolean(await (await caches.open(name)).match(COMPLETE));
}

/** The newest complete build cache (this worker's own first), or null. */
async function newestComplete() {
  if (await isComplete()) return CACHE;
  const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE);
  for (const key of keys.reverse()) if (await isComplete(key)) return key;
  return null;
}

/** Expected type per file, so a 200 sign-in page can never be stored as an asset (review finding 6). */
function typeOk(url, res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (url === './' || url.endsWith('.html')) return ct.includes('text/html');
  if (ct.includes('text/html')) return false;
  if (url.endsWith('.json')) return ct.includes('json');
  if (url.endsWith('.js')) return ct.includes('javascript');
  return true;
}

async function fetchOne(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
      if (!res.ok || res.redirected) throw new Error(`${url}: ${res.status}${res.redirected ? ' (redirected)' : ''}`);
      if (!typeOk(url, res)) throw new Error(`${url}: unexpected ${res.headers.get('content-type')}`);
      return res;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw last;
}

/** The live build: its version, 'redirect' (sign-in in the way), or 'offline' (no answer in time). */
async function askLive() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIVE_CHECK_MS);
    // ⚠️ redirect: 'manual' (review B): only a REDIRECT from the app host means "sign-in in the way, go
    // to the network". A 5xx, or a venue captive portal answering 200 text/html, is NOT a reason to
    // leave a complete cache on stage: that is 'offline'.
    const res = await fetch('precache.json', { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal, redirect: 'manual' });
    clearTimeout(timer);
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return 'redirect';
    if (!res.ok || !typeOk('precache.json', res)) return 'offline';
    const m = await res.json();
    return typeof m.version === 'string' ? m.version : 'offline';
  } catch {
    return 'offline';
  }
}

async function loadModes() {
  if (modes) return modes;
  try {
    const hit = await (await caches.open(MODES)).match(MODES_KEY);
    modes = hit ? await hit.json() : {};
  } catch {
    modes = {};
  }
  return modes;
}

async function setMode(clientId, mode) {
  const all = await loadModes();
  all[clientId] = { ...mode, at: Date.now() };
  // Forget pages that are gone, so the table does not grow forever. ⚠️ Only entries older than
  // 10 minutes (review A): a navigation's resultingClientId is not a client until its response
  // commits, so a second navigation right after it would otherwise delete the first page's mode and
  // that page's data would come from another build.
  const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id));
  const old = Date.now() - 10 * 60_000;
  for (const id of Object.keys(all)) if (id !== clientId && !alive.has(id) && (all[id]?.at ?? 0) < old) delete all[id];
  await (await caches.open(MODES)).put(MODES_KEY, new Response(JSON.stringify(all), { headers: { 'content-type': 'application/json' } }));
}

/** How a page that is opening now is served. */
async function decide() {
  const live = await askLive();
  if (live === 'redirect') return { network: null };
  const newest = await newestComplete();
  if (live === 'offline') return newest ? { cache: newest } : { network: null };
  // Online: the live build from its own complete cache when there is one, else from the network.
  return (await isComplete(PREFIX + live)) ? { cache: PREFIX + live } : { network: live };
}

/** The build a page is served from, or null when unknown. */
function buildOf(mode) {
  if (!mode) return null;
  if (mode.cache) return mode.cache.slice(PREFIX.length);
  return mode.network ?? null;
}

/** Download THIS build into its own cache (resumable); complete only if it is still the live one. */
function download() {
  downloading ??= (async () => {
    try {
      if (await isComplete()) return;
      const res = await fetch('precache.json', { cache: 'no-store', credentials: 'same-origin' });
      const m = await res.json();
      // A newer deploy is already live: its own worker downloads that one, not this.
      if (m.version !== BUILD) return;
      const cache = await caches.open(CACHE);
      const urls = ['./', ...m.files];
      progress = { done: 0, total: urls.length };
      for (let i = 0; i < urls.length; i += 6) {
        await Promise.all(
          urls.slice(i, i + 6).map(async (url) => {
            // Resume: a file already stored by an interrupted download is not fetched again.
            if (!(await cache.match(url, MATCH))) await cache.put(url, await fetchOne(url));
            progress.done += 1;
          })
        );
        await broadcast({ type: 'caldova-offline-progress', ...progress });
      }
      // A deploy during the download put the NEXT build's unhashed files into this cache: drop it.
      if ((await askLive()) !== BUILD) {
        await caches.delete(CACHE);
        return;
      }
      await cache.put(COMPLETE, new Response(BUILD));
      // Older builds go once this one is complete, except one a still-open page is served from.
      const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id));
      const all = await loadModes();
      const inUse = new Set(Object.keys(all).flatMap((id) => (alive.has(id) && all[id]?.cache ? [all[id].cache] : [])));
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE && !inUse.has(key)) await caches.delete(key);
      }
      await broadcast({ type: 'caldova-offline-ready', version: BUILD });
    } catch (err) {
      await broadcast({ type: 'caldova-offline-failed', reason: String(err) });
    } finally {
      downloading = null; // the partial cache stays and is resumed by the next request
    }
  })();
  return downloading;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Only the claim: no download here (header, finding 1).
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'caldova-offline-status') {
    event.waitUntil(
      (async () => {
        // Answered from the local cache: offline on stage the chip must still say "ready".
        const ready = await isComplete();
        const page = event.source && 'id' in event.source ? buildOf((await loadModes())[event.source.id]) : null;
        event.source?.postMessage(
          ready ? { type: 'caldova-offline-ready', version: BUILD, page } : { type: 'caldova-offline-progress', ...progress, page }
        );
        if (!ready) await download();
      })()
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // sign-in, Fabric and Rayfin APIs, fonts
  if (url.pathname.includes('/api/') || url.pathname.includes('auth')) return;
  if (url.pathname.endsWith('/precache.json') || url.pathname.endsWith('/sw.js')) return;

  event.respondWith(
    (async () => {
      let mode;
      if (req.mode === 'navigate') {
        mode = await decide();
        if (event.resultingClientId) await setMode(event.resultingClientId, mode);
      } else {
        // A page this worker never opened (the previous worker did): the newest complete cache,
        // which is the one that page came from as long as no newer build has completed since.
        mode = (await loadModes())[event.clientId];
        if (!mode) {
          const newest = await newestComplete();
          mode = newest ? { cache: newest } : { network: null };
          if (event.clientId) await setMode(event.clientId, mode);
        }
      }
      if (mode.cache) {
        const cache = await caches.open(mode.cache);
        const hit = req.mode === 'navigate' ? await cache.match('./', MATCH) : await cache.match(req, MATCH);
        if (hit) return hit;
        return fetch(req); // a file this build does not list (e.g. a late-loaded optional asset)
      }
      try {
        return await fetch(req);
      } catch (err) {
        // No network: content-hashed bundles are the same in every build, so any cache may answer;
        // unhashed data is NOT taken from another build (it would not match this page's code).
        if (url.pathname.includes('/assets/')) {
          const hit = await caches.match(req, MATCH);
          if (hit) return hit;
        }
        throw err;
      }
    })()
  );
});
