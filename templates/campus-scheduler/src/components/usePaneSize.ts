import { useEffect, useState } from 'react';

/**
 * A pane size that survives a reload.
 *
 * Re-choosing a layout on every load is the kind of small friction that makes a demo feel
 * unfinished, so every resizable pane persists its size. Stored values are re-clamped on read
 * rather than trusted: a width saved on a wide monitor must not leave a pane off-screen on a
 * laptop, and a height saved before the window shrank must not outlive the space for it.
 *
 * Lives apart from `ResizeHandle` only because a file that exports both a hook and a component
 * breaks fast refresh.
 */
export function usePaneSize(
  storageKey: string,
  fallback: number,
  bounds: { min: number; max: () => number }
) {
  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    const raw = Number.isFinite(stored) && stored > 0 ? stored : fallback;
    return Math.min(bounds.max(), Math.max(bounds.min, raw));
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(Math.round(size)));
  }, [storageKey, size]);

  // A window that shrinks can strand a pane wider or taller than the screen; re-clamp when it does.
  useEffect(() => {
    const onResize = () =>
      setSize((current) => Math.min(bounds.max(), Math.max(bounds.min, current)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.min]);

  return [size, setSize] as const;
}

/** Clamp helper shared with the handle, kept here so the bounds logic has one home. */
export function clampSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * The next named stop above the current size, wrapping back to the smallest at the top.
 *
 * Pure, and separate from the component, because this is the part with a rule in it: "go to the
 * next one up, and start again once you run out" is what makes repeated double-clicks cycle rather
 * than stick at the largest stop. The tolerance stops a size that is already a stop (give or take a
 * rounding pixel) from selecting itself and appearing to do nothing.
 */
export function nextPresetSize(sizes: number[], current: number, tolerance = 4): number | null {
  const sorted = [...sizes].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted.find((size) => size > current + tolerance) ?? sorted[0];
}
