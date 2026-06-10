import { Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'dashboard.theme';
const ATTR = 'data-theme';

/**
 * Signal-based theme store.
 *
 * Resolution order:
 *   1. Manual override stored in `localStorage[dashboard.theme]`
 *   2. `prefers-color-scheme` media query (system default)
 *   3. Dark as a final fallback
 *
 * The matching attribute is also set on `<html>` by an inline script in
 * `index.html` before Angular boots, so the first paint already uses the
 * right palette (no flash). When no manual choice is stored, the service
 * subscribes to OS theme changes and updates live.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(readInitial());
  readonly theme = this._theme.asReadonly();

  private mql: MediaQueryList | null = null;

  constructor() {
    this.startWatchingSystem();
  }

  /** Flip dark ↔ light. Marks the choice as "manual" — system changes
   * are ignored from then on until the user clears `localStorage`. */
  toggle(): void {
    this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this._theme.set(theme);
    applyAttr(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore — private mode, full storage, etc.
    }
  }

  /** Forget the manual preference and snap back to the system theme. */
  resetToSystem(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
    const next = systemTheme();
    this._theme.set(next);
    applyAttr(next);
  }

  /** Listen to OS theme changes, but only honor them if the user
   * hasn't picked one manually. */
  private startWatchingSystem(): void {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    this.mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => {
      if (hasManualOverride()) return;
      const next: Theme = e.matches ? 'light' : 'dark';
      this._theme.set(next);
      applyAttr(next);
    };
    // Modern browsers — addEventListener; fall back to deprecated API.
    if (typeof this.mql.addEventListener === 'function') {
      this.mql.addEventListener('change', onChange);
    } else if (typeof this.mql.addListener === 'function') {
      this.mql.addListener(onChange);
    }
  }
}

function readInitial(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute(ATTR);
    if (attr === 'light' || attr === 'dark') return attr;
  }
  const stored = manualOverride();
  if (stored) return stored;
  return systemTheme();
}

function manualOverride(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Ignore.
  }
  return null;
}

function hasManualOverride(): boolean {
  return manualOverride() !== null;
}

function systemTheme(): Theme {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

function applyAttr(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(ATTR, theme);
}
