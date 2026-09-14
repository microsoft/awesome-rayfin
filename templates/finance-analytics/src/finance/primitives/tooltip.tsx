import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Portal } from "./portal";
import { computePosition, type Align, type Side } from "./position";
import { cn } from "../lib/cn";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  align?: Align;
  delay?: number;
  className?: string;
}

/**
 * Accessible hover/focus tooltip. Portals into the body, flips on overflow, and wires
 * `aria-describedby` onto the trigger element. Replaces native `title=` attributes.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 250,
  className,
}: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const a = anchorRef.current;
    const f = floatingRef.current;
    if (!a || !f) return;
    const r = a.getBoundingClientRect();
    const { left, top } = computePosition(
      { top: r.top, left: r.left, width: r.width, height: r.height },
      { width: f.offsetWidth, height: f.offsetHeight },
      { side, align, gap: 6, padding: 8 },
    );
    setPos({ left, top });
  }, [side, align]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, content, reposition]);

  useEffect(() => {
    if (!open) return;
    const handler = () => reposition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, reposition]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  if (!isValidElement(children)) return children;

  const childProps = children.props as Record<string, unknown> & {
    "aria-describedby"?: string;
  };

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const cRef = (children as unknown as { ref?: unknown }).ref;
      if (typeof cRef === "function") (cRef as (n: HTMLElement | null) => void)(node);
      else if (cRef && typeof cRef === "object")
        (cRef as { current: HTMLElement | null }).current = node;
    },
    onMouseEnter: (e: unknown) => {
      (childProps.onMouseEnter as ((e: unknown) => void) | undefined)?.(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      (childProps.onMouseLeave as ((e: unknown) => void) | undefined)?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      (childProps.onFocus as ((e: unknown) => void) | undefined)?.(e);
      show();
    },
    onBlur: (e: unknown) => {
      (childProps.onBlur as ((e: unknown) => void) | undefined)?.(e);
      hide();
    },
    "aria-describedby": open ? id : childProps["aria-describedby"],
  });

  return (
    <>
      {trigger}
      {open && content != null && (
        <Portal>
          <div
            ref={floatingRef}
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              zIndex: "var(--z-tooltip)",
              visibility: pos ? "visible" : "hidden",
            }}
            className={cn(
              "pointer-events-none max-w-xs rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white shadow-e3",
              "dark:bg-neutral-700",
              className,
            )}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}

interface CursorTooltipProps {
  content: ReactNode;
  x: number;
  y: number;
  visible: boolean;
  className?: string;
}

/**
 * Cursor-following tooltip for charts. Rendered by a chart when a data point is hovered;
 * positioned at viewport coords (x, y) and portaled above everything.
 */
export function CursorTooltip({ content, x, y, visible, className }: CursorTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ dx: 12, dy: 12 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setOffset({
      dx: x + 12 + w > vw - 8 ? -(w + 12) : 12,
      dy: y + 12 + h > vh - 8 ? -(h + 12) : 12,
    });
  }, [x, y, visible, content]);

  if (!visible || content == null) return null;

  return (
    <Portal>
      <div
        ref={ref}
        role="tooltip"
        style={{
          position: "fixed",
          left: x + offset.dx,
          top: y + offset.dy,
          zIndex: "var(--z-tooltip)",
        }}
        className={cn(
          "pointer-events-none rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-e3",
          className,
        )}
      >
        {content}
      </div>
    </Portal>
  );
}

