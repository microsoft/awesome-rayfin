import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Download, FileText, Sheet, Presentation, ChevronDown } from "lucide-react";
import type { DataTable } from "../lib/types";
import { exportCsv, exportExcel, exportPptx } from "../lib/export";
import { btn } from "../lib/recipes";
import { Portal, computePosition } from "../primitives";

export interface ExportMenuProps {
  table: DataTable;
  title?: string;
  filename?: string;
  /** Audit hook — fired after a successful export (governance/telemetry). */
  onExport?: (evt: { format: "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  /** Optional classification stamped onto generated files. */
  classification?: string;
  /** When provided, the PowerPoint item opens the Deck Builder instead of a
   *  one-shot single-slide export. */
  onBuildDeck?: () => void;
}

/** Standardized export chrome with menu semantics + keyboard nav.
 *  PowerPoint path lazy-loads pptxgenjs on click. */
export function ExportMenu({ table, title = "Export", filename = "export", onExport, classification, onBuildDeck }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const MENU_WIDTH = 176;

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const { left, top } = computePosition(
      { top: r.top, left: r.left, width: r.width, height: r.height },
      { width: MENU_WIDTH, height: menu?.offsetHeight ?? 0 },
      { side: "bottom", align: "end", gap: 4, padding: 8 },
    );
    setPos({ left, top });
  }, []);

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

  const items: { label: string; format: "csv" | "excel" | "pptx"; icon: typeof FileText; run: () => void | Promise<void> }[] = [
    { label: "CSV", format: "csv", icon: FileText, run: () => exportCsv(table, `${filename}.csv`, { classification }) },
    { label: "Excel", format: "excel", icon: Sheet, run: () => exportExcel(table, `${filename}.xlsx`, { classification }) },
    {
      label: onBuildDeck ? "PowerPoint deck…" : "PowerPoint",
      format: "pptx",
      icon: Presentation,
      run: async () => {
        if (onBuildDeck) {
          onBuildDeck();
          return;
        }
        setBusy(true);
        try {
          await exportPptx(table, { title, classification });
        } finally {
          setBusy(false);
        }
      },
    },
  ];

  useEffect(() => {
    if (open) {
      setActive(0);
      requestAnimationFrame(() => itemRefs.current[0]?.focus());
    }
  }, [open]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  };

  const runItem = async (i: number) => {
    close(false);
    const item = items[i];
    await item.run();
    // The deck builder reports its own completion via onGenerated — don't log a
    // phantom export here when we only opened the modal.
    if (!(item.format === "pptx" && onBuildDeck)) {
      onExport?.({ format: item.format, rows: table.rows.length, filename });
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(active + 1, items.length - 1);
      setActive(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(active - 1, 0);
      setActive(prev);
      itemRefs.current[prev]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={btn({ variant: "secondary", size: "sm" })}
      >
        <Download size={16} aria-hidden="true" />
        {busy ? "Building…" : "Export"}
        <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden="true" />
      </button>
      {open ? (
        <Portal>
          <div className="fixed inset-0 z-[var(--z-overlay)]" onClick={() => close(false)} />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Export format"
            onKeyDown={onMenuKeyDown}
            style={{
              position: "fixed",
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: MENU_WIDTH,
              zIndex: "var(--z-popover)",
              visibility: pos ? "visible" : "hidden",
            }}
            className="panel-slide-in overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-e3"
          >
            {items.map((it, i) => (
              <button
                key={it.label}
                ref={(el) => { itemRefs.current[i] = el; }}
                role="menuitem"
                tabIndex={i === active ? 0 : -1}
                onClick={() => runItem(i)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <it.icon size={16} className="text-primary" aria-hidden="true" />
                {it.label}
              </button>
            ))}
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
