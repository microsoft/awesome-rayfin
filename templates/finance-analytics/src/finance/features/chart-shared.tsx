import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { formatCompact } from "../lib/format";
import type { BarDatum } from "./bar-chart";

type Tip = { x: number; y: number; content: ReactNode };

/**
 * Cursor-following tooltip state shared by every chart. `show` is called on every
 * `mousemove`, so updates are coalesced to one per animation frame — fast pointer
 * movement over a chart no longer triggers a React re-render per pixel, which keeps
 * hovering smooth even with six charts mounted.
 */
export function useChartCursor() {
  const [tip, setTip] = useState<Tip | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<Tip | null>(null);

  const show = useCallback((x: number, y: number, content: ReactNode) => {
    pending.current = { x, y, content };
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (pending.current) setTip(pending.current);
    });
  }, []);

  const hide = useCallback(() => {
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = null;
    setTip(null);
  }, []);

  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  return { tip, show, hide };
}

/**
 * Roving-tabindex keyboard model for a linear series of data points. Arrow keys move
 * the active point, Home/End jump to the ends, Enter/Space drills. Returns the active
 * index plus a keydown handler to spread onto the focusable container.
 */
export function useRovingIndex(count: number, onSelect?: (index: number) => void) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const set = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    activeRef.current = clamped;
    setActive(clamped);
  }, [count]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          set(activeRef.current + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          set(activeRef.current - 1);
          break;
        case "Home":
          e.preventDefault();
          set(0);
          break;
        case "End":
          e.preventDefault();
          set(count - 1);
          break;
        case "Enter":
        case " ":
          if (onSelect) {
            e.preventDefault();
            onSelect(activeRef.current);
          }
          break;
      }
    },
    [count, onSelect, set],
  );

  return { active, setActive: set, onKeyDown };
}

interface NiceScale {
  ticks: number[];
  niceMin: number;
  niceMax: number;
  step: number;
}

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / Math.pow(10, exp);
  let nice: number;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

/**
 * "Nice" axis scale — rounds the domain to human-friendly tick values and returns them
 * top-to-bottom (descending) so they map directly onto a top-aligned axis column.
 */
export function niceTicks(min: number, max: number, maxTicks = 4): NiceScale {
  if (min === max) max = min + 1;
  const range = niceNum(max - min, false);
  const step = niceNum(range / maxTicks, true) || 1;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMax; v >= niceMin - step / 1000; v -= step) ticks.push(Number(v.toFixed(6)));
  return { ticks, niceMin, niceMax, step };
}

/**
 * Visually-hidden data table + summary rendered alongside each SVG chart so screen
 * readers get the exact figures the visual encodes.
 */
export function SrChartTable({
  caption,
  data,
  valuePrefix = "",
}: {
  caption: string;
  data: BarDatum[];
  valuePrefix?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Value</th>
          <th scope="col">Share</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <th scope="row">{d.label}</th>
            <td>{formatCompact(d.value, valuePrefix)}</td>
            <td>{Math.round((d.value / total) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function chartSummary(data: BarDatum[], valuePrefix = ""): string {
  if (data.length === 0) return "No data.";
  const max = data.reduce((a, b) => (b.value > a.value ? b : a));
  const min = data.reduce((a, b) => (b.value < a.value ? b : a));
  return `${data.length} categories. Highest ${max.label} at ${formatCompact(max.value, valuePrefix)}; lowest ${min.label} at ${formatCompact(min.value, valuePrefix)}.`;
}
