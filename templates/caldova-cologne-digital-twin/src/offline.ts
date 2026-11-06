import { useEffect, useState } from 'react';

/**
 * The offline cache (public/sw.js) from the app's side: register it, check for a newer build, and
 * say whether this device can open the twin without a network. Made for stages without good WiFi.
 *
 * Registered only in a production build: in `vite dev` a service worker would cache files that are
 * rebuilt on every save and serve yesterday's twin during development.
 */
export type OfflineState =
  | { kind: 'unsupported' }
  | { kind: 'pending'; done: number; total: number }
  | { kind: 'ready' }
  /** A newer build finished downloading while this page was open: a reload shows it. */
  | { kind: 'updated' }
  | { kind: 'failed' };

let registration: Promise<ServiceWorkerRegistration | null> = Promise.resolve(null);

function supported(): boolean {
  return import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function registerOfflineCache(): void {
  if (!supported()) return;
  registration = navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      // A stage laptop can keep the tab open for days; ask for a newer build on every load.
      reg.update().catch(() => undefined);
      return reg;
    })
    .catch((err: unknown) => {
      // Reported, not swallowed: without it the twin still works online, but not offline.
      console.warn('offline cache could not be registered', err);
      return null;
    });
  // Ask the browser not to evict the ~60 MB under disk pressure (review finding 10).
  navigator.storage?.persist?.().catch(() => undefined);
}

export function useOfflineState(): OfflineState {
  const [state, setState] = useState<OfflineState>(
    supported() ? { kind: 'pending', done: 0, total: 0 } : { kind: 'unsupported' }
  );

  useEffect(() => {
    if (!supported()) return;
    // The build THIS page is, as the worker served it (`page` in its answers, public/sw.js): only a
    // ready message for a DIFFERENT build asks for a reload. Before, the first ready message was the
    // reference, which after a deploy is the old worker's build, so a page that already was the new
    // build was told to reload. Without `page` (a worker from before 2026-10-21) the first version is
    // still the reference.
    let pageBuild: string | null = null;
    let firstVersion: string | null = null;
    let ready = false;
    const onMessage = (event: MessageEvent) => {
      const m = event.data ?? {};
      if (typeof m.page === 'string') pageBuild = m.page;
      if (m.type === 'caldova-offline-progress') setState({ kind: 'pending', done: m.done ?? 0, total: m.total ?? 0 });
      if (m.type === 'caldova-offline-failed') setState({ kind: 'failed' });
      if (m.type === 'caldova-offline-ready') {
        ready = true;
        const reference = pageBuild ?? firstVersion;
        if (reference && m.version && m.version !== reference) setState({ kind: 'updated' });
        else {
          firstVersion = firstVersion ?? m.version ?? null;
          setState({ kind: 'ready' });
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    const ask = () => navigator.serviceWorker.controller?.postMessage({ type: 'caldova-offline-status' });
    ask();
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    // The worker downloads while this page keeps asking (a worker without events is stopped after
    // ~30 s and resumes the download on the next question).
    // While not ready also ask the browser for a newer worker (review C): a page open across a deploy
    // otherwise waits on a worker that will never download the build that is now live.
    const poll = window.setInterval(() => {
      if (ready) return;
      ask();
      registration.then((reg) => reg?.update()).catch(() => undefined);
    }, 20_000);
    registration.then((reg) => {
      if (!reg) {
        setState({ kind: 'failed' });
        return;
      }
      reg.active?.postMessage({ type: 'caldova-offline-status' });
      const watch = (w: ServiceWorker | null) =>
        w?.addEventListener('statechange', () => {
          // A first install that dies leaves no active worker: say so instead of freezing at N %.
          if (w.state === 'redundant' && !reg.active) setState({ kind: 'failed' });
        });
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    });
    return () => {
      window.clearInterval(poll);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', ask);
    };
  }, []);

  return state;
}
