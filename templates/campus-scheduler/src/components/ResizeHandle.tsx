import { useCallback, useEffect, useRef, useState } from 'react';

import { clampSize, nextPresetSize } from './usePaneSize';

/**
 * A draggable separator between two panes.
 *
 * Extracted because the shell needs three of these and they were about to be three copies of the
 * same pointer-capture dance. Capture is the part that matters: without it a drag dies the moment
 * the cursor crosses the WebGL canvas, which swallows pointer events — and every pane in this app
 * borders that canvas.
 *
 * Dragging alone is not enough to size a pane *precisely*, so this also takes the keyboard (arrows
 * nudge, Shift jumps, Home/End go to the limits) and offers named stops on double click. A mouse
 * is good at "about half"; only a key or a stop is good at "exactly half".
 */

export interface ResizePreset {
  /** Size in px, or a function of the space available when the user asks for it. */
  size: number | ((available: number) => number);
  labelKey: string;
}

export interface ResizeHandleProps {
  /** 'x' resizes width and shows a column cursor; 'y' resizes height. */
  axis: 'x' | 'y';
  /** Current pane size in px. */
  value: number;
  min: number;
  /** Upper bound in px. A function is re-evaluated on every move, so it can track the window. */
  max: number | (() => number);
  onChange: (next: number) => void;
  /**
   * Turn a pointer position into the pane's size. Panes are anchored to different edges — the side
   * panel to the right, the calendar to the bottom — so only the caller knows which way is bigger.
   */
  measure: (event: React.PointerEvent<HTMLDivElement>) => number;
  /** Which arrow key should make the pane grow. */
  growKey: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
  /** Cycled on double click, so "half" and "full" are reachable exactly. */
  presets?: ResizePreset[];
  /** Rendered while dragging, e.g. "512 px · 43%". */
  format?: (value: number, available: number) => string;
  onDraggingChange?: (dragging: boolean) => void;
  label: string;
  testId: string;
  className?: string;
}

const STEP = 16;
const BIG_STEP = 64;

export function ResizeHandle({
  axis,
  value,
  min,
  max,
  onChange,
  measure,
  growKey,
  presets,
  format,
  onDraggingChange,
  label,
  testId,
  className = '',
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const [readout, setReadout] = useState<string | null>(null);
  const limit = useCallback(() => (typeof max === 'function' ? max() : max), [max]);
  const clamp = useCallback((n: number) => clampSize(n, min, limit()), [limit, min]);

  useEffect(() => onDraggingChange?.(dragging), [dragging, onDraggingChange]);

  const show = useCallback(
    (next: number) => {
      if (format) setReadout(format(next, limit()));
    },
    [format, limit]
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const next = clamp(measure(event));
      onChange(next);
      show(next);
    },
    [clamp, dragging, measure, onChange, show]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setReadout(null);
  }, []);

  // The readout should linger a moment after a keypress; a badge that vanishes instantly is
  // unreadable, which defeats the point of showing the number at all.
  const hideTimer = useRef<number | null>(null);
  const flash = useCallback(
    (next: number) => {
      show(next);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setReadout(null), 1100);
    },
    [show]
  );
  useEffect(() => () => void (hideTimer.current && window.clearTimeout(hideTimer.current)), []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const shrinkKey =
        growKey === 'ArrowLeft'
          ? 'ArrowRight'
          : growKey === 'ArrowRight'
            ? 'ArrowLeft'
            : growKey === 'ArrowUp'
              ? 'ArrowDown'
              : 'ArrowUp';
      const step = event.shiftKey ? BIG_STEP : STEP;
      let next: number | null = null;
      if (event.key === growKey) next = value + step;
      else if (event.key === shrinkKey) next = value - step;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = limit();
      if (next === null) return;
      event.preventDefault();
      const clamped = clamp(next);
      onChange(clamped);
      flash(clamped);
    },
    [clamp, flash, growKey, limit, min, onChange, value]
  );

  // Double click steps to the next named stop above the current size, wrapping at the top. That
  // makes "half" and "full" two predictable clicks rather than a careful drag.
  const onDoubleClick = useCallback(() => {
    if (!presets?.length) return;
    const available = limit();
    const sizes = presets.map((p) =>
      clamp(typeof p.size === 'function' ? p.size(available) : p.size)
    );
    const next = nextPresetSize(sizes, value);
    if (next === null) return;
    onChange(next);
    flash(next);
  }, [clamp, flash, limit, onChange, presets, value]);

  const vertical = axis === 'x';

  return (
    <div
      data-testid={testId}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(limit())}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className={`group relative shrink-0 transition-colors focus:outline-none ${
        vertical ? 'w-1 cursor-col-resize' : 'h-1 w-full cursor-row-resize'
      } ${dragging ? 'bg-amber-500/80' : 'bg-transparent hover:bg-amber-500/60'} focus-visible:bg-amber-400/70 ${className}`}
    >
      {/*
        The hit area is deliberately wider than the line. A 1 px target is precise to look at and
        miserable to grab, so the visible seam stays thin while the grabbable strip is 11 px.
      */}
      <span
        aria-hidden
        className={`absolute ${vertical ? '-inset-x-[5px] inset-y-0' : '-inset-y-[5px] inset-x-0'}`}
      />
      {readout && (
        <span
          data-testid={`${testId}-readout`}
          className={`pointer-events-none absolute z-40 whitespace-nowrap rounded bg-stone-950/90 px-2 py-1 text-[0.65rem] font-medium text-amber-200 shadow ${
            vertical ? 'right-2 top-4' : 'left-4 top-2'
          }`}
        >
          {readout}
        </span>
      )}
    </div>
  );
}
