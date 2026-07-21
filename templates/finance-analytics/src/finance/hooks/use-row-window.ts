import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface RowWindow {
  /** First row index to render (inclusive). */
  start: number;
  /** Last row index to render (exclusive). */
  end: number;
  /** Spacer height (px) standing in for the rows above `start`. */
  topPad: number;
  /** Spacer height (px) standing in for the rows below `end`. */
  bottomPad: number;
  /** Whether windowing is active (row count exceeded the threshold). */
  active: boolean;
  /** Attach to the scroll container. */
  onScroll: (e: { currentTarget: HTMLElement }) => void;
}

export interface RowWindowOptions {
  /** Total number of rows in the full data set. */
  rowCount: number;
  /** Uniform row height in px (these tables use fixed row padding). */
  rowHeight: number;
  /** Extra rows rendered above/below the viewport to avoid blank flashes. Default 8. */
  overscan?: number;
  /** Below this row count, windowing is inert (renders everything). Default 120. */
  threshold?: number;
}

/**
 * Fixed-height row windowing for uniform-height tables. Only mounts the rows
 * visible in the scroll container (plus overscan), standing in for the rest with
 * two spacer rows — so a 50k-row table keeps a tiny DOM while remaining a real,
 * semantic `<table>` (pair with `aria-rowcount` / `aria-rowindex` for AT).
 *
 * Inert below `threshold`: small tables render in full, so behavior (and the
 * a11y/visual snapshots) is unchanged until the data is actually large.
 */
export function useRowWindow(
  containerRef: React.RefObject<HTMLElement | null>,
  { rowCount, rowHeight, overscan = 8, threshold = 120 }: RowWindowOptions,
): RowWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const raf = useRef(0);

  // Measure the scroll container height (and keep it current on resize).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const onScroll = useCallback((e: { currentTarget: HTMLElement }) => {
    const top = e.currentTarget.scrollTop;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setScrollTop(top);
    });
  }, []);

  const active = rowCount > threshold && rowHeight > 0;
  if (!active) {
    return { start: 0, end: rowCount, topPad: 0, bottomPad: 0, active: false, onScroll };
  }

  const height = viewport || rowHeight * 20;
  const visible = Math.ceil(height / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rowCount, start + visible + overscan * 2);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (rowCount - end) * rowHeight),
    active: true,
    onScroll,
  };
}
