//-----------------------------------------------------------------------
// Semantic Directory — data-dictionary export menu.
//
// A small header affordance that lets a steward download the whole catalog as
// a CSV or Markdown data dictionary. The menu is positioned with `fixed`
// coordinates measured from the trigger so it can never be clipped by an
// ancestor's overflow, and it closes on outside-click, Escape, scroll, or
// resize.
//-----------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, FileText, Sheet } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { exportDataDictionary, type DictionaryFormat } from "@/lib/export-actions";
import { Pressable } from "@/components/ui/pressable";

export function ExportMenu({
    catalog,
    modelName,
}: {
    catalog: CatalogModel;
    modelName: string;
}) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

    // Measure the trigger and anchor the menu just below its right edge.
    useLayoutEffect(() => {
        if (!open || !btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                btnRef.current?.focus();
            }
        };
        const onReflow = () => setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", onReflow, true);
        window.addEventListener("resize", onReflow);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("scroll", onReflow, true);
            window.removeEventListener("resize", onReflow);
        };
    }, [open]);

    const pick = (format: DictionaryFormat) => {
        exportDataDictionary(catalog, format, modelName);
        setOpen(false);
    };

    return (
        <>
            <Pressable
                ref={btnRef}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
            >
                <Download className="icon-size-100" strokeWidth={2} aria-hidden />
                Export
            </Pressable>

            {open && pos ? (
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Export data dictionary"
                    style={{ position: "fixed", top: pos.top, right: pos.right }}
                    className="z-50 w-64 overflow-hidden rounded-xl border border-border bg-card p-xs shadow-[var(--e2)]"
                >
                    <p className="px-m py-xs text-100 text-muted-foreground">
                        Download every table, field, and measure.
                    </p>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => pick("csv")}
                        className="flex w-full items-center gap-s rounded-lg px-m py-s text-left transition-colors hover:bg-accent"
                    >
                        <Sheet className="icon-size-200 text-primary" strokeWidth={2} aria-hidden />
                        <span className="min-w-0 flex-1">
                            <span className="block text-200 font-medium text-foreground">CSV</span>
                            <span className="block text-100 text-muted-foreground">
                                Open in Excel or a spreadsheet
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => pick("md")}
                        className="flex w-full items-center gap-s rounded-lg px-m py-s text-left transition-colors hover:bg-accent"
                    >
                        <FileText className="icon-size-200 text-primary" strokeWidth={2} aria-hidden />
                        <span className="min-w-0 flex-1">
                            <span className="block text-200 font-medium text-foreground">Markdown</span>
                            <span className="block text-100 text-muted-foreground">
                                Paste into a wiki or a README
                            </span>
                        </span>
                    </button>
                </div>
            ) : null}
        </>
    );
}
