import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, Check } from "lucide-react";
import { Portal } from "./portal";
import { computePosition } from "./position";
import { cn } from "../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

/**
 * Headless, fully-keyboardable single-select built on the ARIA listbox pattern.
 * Portaled popup with collision-aware positioning. Replaces native `<select>` so every
 * app shares one accessible, token-styled control.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const baseId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const typeahead = useRef({ query: "", ts: 0 });

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const reposition = useCallback(() => {
    const btn = buttonRef.current;
    const list = listRef.current;
    if (!btn || !list) return;
    const r = btn.getBoundingClientRect();
    const { left, top } = computePosition(
      { top: r.top, left: r.left, width: r.width, height: r.height },
      { width: r.width, height: list.offsetHeight },
      { side: "bottom", align: "start", gap: 4, padding: 8 },
    );
    setPos({ left, top, width: r.width });
  }, []);

  // Callback ref: the SSR-safe Portal mounts its children a tick after `open`
  // flips, so an `[open]` layout effect would run while `listRef` is still null.
  // Repositioning the moment the listbox node actually attaches avoids the
  // dropdown getting stuck off-screen on first open.
  const setListNode = useCallback(
    (node: HTMLUListElement | null) => {
      listRef.current = node;
      if (node) reposition();
    },
    [reposition],
  );

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

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

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const openList = useCallback(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const commit = useCallback(
    (index: number) => {
      const opt = options[index];
      if (opt) onChange(opt.value);
      setOpen(false);
      buttonRef.current?.focus();
    },
    [options, onChange],
  );

  useEffect(() => {
    if (open && activeIndex >= 0) {
      const node = document.getElementById(`${baseId}-opt-${activeIndex}`);
      node?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex, baseId]);

  const onButtonKeyDown = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1) {
          const now = Date.now();
          const t = typeahead.current;
          t.query = now - t.ts > 600 ? e.key : t.query + e.key;
          t.ts = now;
          const q = t.query.toLowerCase();
          const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
          if (idx >= 0) setActiveIndex(idx);
        }
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/60 px-2 py-1 text-sm text-secondary-foreground",
          "transition-colors hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <Portal>
          <ul
            ref={setListNode}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={
              activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined
            }
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              minWidth: pos?.width,
              zIndex: "var(--z-popover)",
              visibility: pos ? "visible" : "hidden",
            }}
            className="max-h-64 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-e3"
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              const isActive = i === activeIndex;
              return (
                <li
                  key={o.value}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(i)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm",
                    isActive ? "bg-secondary text-secondary-foreground" : "text-foreground",
                  )}
                >
                  <span>{o.label}</span>
                  {isSelected && <Check size={14} className="text-primary" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </Portal>
      )}
    </>
  );
}

