// View and simulation state, mirrored into the URL hash so every view is a
// shareable link, and into localStorage as the last-used fallback.

import { EMPTY_SIM, type Mode, type SimParams } from './engine';
import type { Unit } from './format';

export interface ViewState {
  year: number | null;
  mode: Mode;
  unit: Unit;
  line: string; // selected top-level line for the trend chart
  sim: SimParams;
  /** P&L tile rendering: own table, or Michael's original P&L visual (statement and tree view). */
  pv: PnlView;
}

export type PnlView = 'table' | 'visual';

export const DEFAULT_VIEW: ViewState = {
  year: null,
  mode: 'fy',
  // Caldova (decision 2026-10-20): Tsd. € by default; the toggle still offers Mio.
  unit: 'tsd',
  line: 'N-REV',
  sim: EMPTY_SIM,
  pv: 'table',
};

const STORAGE_KEY = 'caldova-fc-pnl-view';

/** Compact sim encoding: only non-zero levers are written. */
function encodeSim(s: SimParams): string {
  const o: Record<string, unknown> = {};
  if (s.scope !== 'ytg') o.s = s.scope;
  const d = Object.fromEntries(
    Object.entries(s.divisions)
      .filter(([, v]) => v.price || v.volume)
      .map(([k, v]) => [k, [v.price, v.volume]])
  );
  if (Object.keys(d).length) o.d = d;
  if (s.material) o.m = s.material;
  const x = Object.fromEntries(Object.entries(s.opex).filter(([, v]) => v));
  if (Object.keys(x).length) o.o = x;
  if (s.interest) o.i = s.interest;
  if (s.taxPp) o.t = s.taxPp;
  return Object.keys(o).length ? JSON.stringify(o) : '';
}

function decodeSim(raw: string | null): SimParams {
  if (!raw) return EMPTY_SIM;
  try {
    const o = JSON.parse(raw) as {
      s?: string;
      d?: Record<string, [number, number]>;
      m?: number;
      o?: Record<string, number>;
      i?: number;
      t?: number;
    };
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      scope: o.s === 'fy' ? 'fy' : 'ytg',
      divisions: Object.fromEntries(
        Object.entries(o.d ?? {}).map(([k, v]) => [k, { price: n(v?.[0]), volume: n(v?.[1]) }])
      ),
      material: n(o.m),
      opex: Object.fromEntries(Object.entries(o.o ?? {}).map(([k, v]) => [k, n(v)])),
      interest: n(o.i),
      taxPp: n(o.t),
    };
  } catch {
    return EMPTY_SIM;
  }
}

export function toHash(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.year) p.set('j', String(v.year));
  if (v.mode !== 'fy') p.set('m', v.mode);
  if (v.unit !== DEFAULT_VIEW.unit) p.set('e', v.unit);
  if (v.line !== DEFAULT_VIEW.line) p.set('z', v.line);
  const s = encodeSim(v.sim);
  if (s) p.set('sim', s);
  if (v.pv === 'visual') p.set('pv', 'visual');
  if (v.pv === 'visual') p.set('pv', 'visual');
  const h = p.toString();
  return h ? '#' + h : '';
}

export function fromHash(hash: string): Partial<ViewState> | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const out: Partial<ViewState> = {};
  const j = Number(p.get('j'));
  if (j > 2000) out.year = j;
  if (p.get('m') === 'ytd') out.mode = 'ytd';
  if (p.get('e') === 'tsd') out.unit = 'tsd';
  if (p.get('e') === 'mio') out.unit = 'mio';
  if (p.get('z')) out.line = p.get('z')!;
  out.sim = decodeSim(p.get('sim'));
  if (p.get('pv') === 'visual') out.pv = 'visual';
  return out;
}

export function loadInitial(): ViewState {
  const fromUrl = fromHash(window.location.hash);
  if (fromUrl) return { ...DEFAULT_VIEW, ...fromUrl };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const s = fromHash(stored);
      if (s) return { ...DEFAULT_VIEW, ...s };
    }
  } catch {
    /* storage blocked */
  }
  return DEFAULT_VIEW;
}

export function persist(v: ViewState) {
  const h = toHash(v);
  if (h !== window.location.hash) window.history.replaceState(null, '', h || window.location.pathname);
  try {
    window.localStorage.setItem(STORAGE_KEY, h);
  } catch {
    /* storage blocked */
  }
}
