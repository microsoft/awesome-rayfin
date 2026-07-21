import { useEffect, useRef, useState } from "react";

export interface AnimatedNumberProps {
  value: number;
  /** Format the (fractional, mid-animation) value into display text. */
  format?: (v: number) => string;
  /** Tween duration in ms (default 500). */
  duration?: number;
}

/**
 * Value-morphing number. Tweens from its previous value to the next whenever `value`
 * changes, honoring `prefers-reduced-motion`. Feed it the raw number plus a formatter.
 */
export function AnimatedNumber({ value, format, duration = 500 }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const to = value;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <>{format ? format(display) : Math.round(display).toString()}</>;
}
