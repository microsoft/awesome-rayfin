// One URL scheme for the merged app: #/<page>?<page state>. Each page owns its
// state string (the former hash of the Finance Cockpit, PnL App and DWG P&L),
// so old links keep working after migration.

export type PageId = 'cockpit' | 'guv';

export const PAGES: { id: PageId; label: string; short: string }[] = [
  { id: 'cockpit', label: 'KPI Cockpit', short: 'Cockpit' },
  { id: 'guv', label: 'P&L & Simulation', short: 'P&L' },
];

export interface Route {
  page: PageId;
  /** Page state as URLSearchParams string, without leading '?'. */
  qs: string;
}

export const DEFAULT_ROUTE: Route = { page: 'cockpit', qs: '' };

const isPage = (p: string): p is PageId => PAGES.some((x) => x.id === p);

// The former P&L statement and P&L tree pages are now the original visual inside P&L & Simulation
// (its own statement and tree view); their old links open it there.
const ORIGINAL_VISUAL: Route = { page: 'guv', qs: 'pv=visual' };
const isFormerDwgPage = (p: string) => p === 'statement' || p === 'baum';

// Keys that identify a legacy hash of the former apps.
const COCKPIT_KEYS = ['period', 'month', 'ref', 'plan', 'fc', 'kpi', 'timeVariant', 'structDim', 'structSort', 'm', 'p'];
const PNL_KEYS = ['j', 'e', 'z', 'sim'];

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  if (!raw) return DEFAULT_ROUTE;
  if (raw.startsWith('/')) {
    const [path, ...rest] = raw.slice(1).split('?');
    const page = path.split('/')[0];
    if (isFormerDwgPage(page)) return ORIGINAL_VISUAL;
    return isPage(page) ? { page, qs: rest.join('?') } : DEFAULT_ROUTE;
  }
  // Legacy DWG P&L: #statement / #baum
  if (isFormerDwgPage(raw)) return ORIGINAL_VISUAL;
  if (isPage(raw)) return { page: raw, qs: '' };
  // Legacy query-string hashes. 'm' is ambiguous: PnL uses m=ytd (mode), the cockpit m=<markets>.
  const p = new URLSearchParams(raw);
  const keys = [...p.keys()];
  const pnl = keys.some((k) => PNL_KEYS.includes(k)) || (p.get('m') === 'ytd' && keys.length === 1);
  if (pnl) return { page: 'guv', qs: raw };
  if (keys.some((k) => COCKPIT_KEYS.includes(k))) return { page: 'cockpit', qs: raw };
  return DEFAULT_ROUTE;
}

export function formatRoute(r: Route): string {
  return `#/${r.page}${r.qs ? `?${r.qs}` : ''}`;
}

export const pageLabel = (id: PageId) => PAGES.find((p) => p.id === id)?.label ?? id;

/**
 * Undo/redo history of routes. Rapid successive changes (slider drags, typing)
 * within `coalesceMs` replace the newest entry instead of adding one.
 */
export interface History {
  past: string[];
  present: string;
  future: string[];
  at: number;
}

export function historyInit(present: string, now = 0): History {
  return { past: [], present, future: [], at: now };
}

export function historyPush(h: History, next: string, now: number, opts: { coalesce?: boolean; coalesceMs?: number; limit?: number } = {}): History {
  const { coalesceMs = 700, limit = 100 } = opts;
  if (next === h.present) return h;
  // Page switches and pasted links never coalesce; rapid edits on one page do.
  const coalesce = (opts.coalesce ?? true) && h.at > 0 && now - h.at >= 0 && now - h.at < coalesceMs && h.past.length > 0;
  const past = coalesce ? h.past : [...h.past, h.present].slice(-limit);
  return { past, present: next, future: [], at: now };
}

/** Replaces the current entry without adding history (defaults, migrations). */
export function historyReplace(h: History, next: string): History {
  return next === h.present ? h : { ...h, present: next };
}

export function historyUndo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0 };
}

export function historyRedo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0 };
}
