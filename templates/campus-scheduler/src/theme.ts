import { useCallback, useSyncExternalStore } from 'react';

/**
 * Light or dark, chosen by the person looking at it.
 *
 * A module-level store rather than a context, for one reason: the theme has to be applied BEFORE
 * React renders, or a visitor who chose dark gets a white flash on every load. Importing this
 * module applies it as a side effect, so `main.tsx` importing it first is the whole mechanism —
 * no provider to thread through the tree and no ordering to get wrong inside it.
 *
 * The switching itself is CSS: `main.css` remaps the stone scale per `data-theme`, so nothing here
 * knows any colours.
 */

export type Theme = 'light' | 'dark';

const KEY = 'campus.theme';

/**
 * ⚠️ Light regardless of `prefers-color-scheme`.
 *
 * The OS preference is the usual default and it is deliberately ignored: this app is a documentary
 * view of a campus, meant to read as paper, and it was asked for as a light interface. Following
 * the system would hand a dark shell to anyone whose laptop happens to be set that way, which is
 * exactly the complaint this exists to answer. The switch is there for anyone who disagrees, and
 * their choice persists.
 */
function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'light';
  } catch {
    // Private-mode Safari and friends throw on localStorage. A theme is not worth failing over.
    return 'light';
  }
}

let current: Theme = initial();
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(next: Theme) {
  if (next === current) return;
  current = next;
  apply(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* see initial() */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  const toggle = useCallback(() => setTheme(getTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, setTheme, toggle };
}
