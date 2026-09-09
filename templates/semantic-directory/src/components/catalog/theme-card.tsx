//-----------------------------------------------------------------------
// Semantic Directory — landing theme card (curated label, live content).
//
// A "browse by business area" card. The label/emoji/blurb are curated; the
// field count, representative fields, and live example values are populated
// from the model so the card is always current. Fixed section heights keep
// every card aligned in the grid. Clicking opens the theme in the workspace
// (drops onto its most-used field with the model graph + hierarchy).
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { ThemeCard } from "@/catalog/browse/theme-cards";
import { tapCard } from "@/lib/motion";

export function ThemeCardButton({
    card,
    onOpen,
}: {
    card: ThemeCard;
    onOpen: (themeId: string) => void;
}) {
    const { def } = card;
    const chips = (card.exampleValues.length ? card.exampleValues : card.sampleFields).slice(0, 3);

    return (
        <m.button
            type="button"
            onClick={() => onOpen(def.id)}
            {...tapCard}
            className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-l text-left shadow-[var(--e1)] transition-[border-color,box-shadow] duration-300 hover:border-primary/50 hover:shadow-[var(--glow)]"
        >
            {/* Top accent line + soft top wash — both bloom in on hover. */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                    background:
                        "radial-gradient(90% 60% at 50% 0%, color-mix(in oklab, var(--color-primary) 10%, transparent), transparent 70%)",
                }}
            />

            {/* Header — icon + label + a 2-line-reserved blurb so titles align
                without leaving a tall void on one-line blurbs. */}
            <div className="relative flex items-start gap-m">
                <span
                    aria-hidden
                    className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/15 bg-gradient-to-br from-secondary to-card text-500 shadow-inner transition-transform duration-300 group-hover:scale-105"
                >
                    {def.emoji}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-xs">
                        <span className="text-300 font-semibold leading-snug text-foreground">{def.label}</span>
                        <ArrowUpRight
                            className="icon-size-200 ml-auto mt-[2px] shrink-0 text-muted-foreground transition-all duration-200 group-hover:translate-x-[2px] group-hover:-translate-y-[2px] group-hover:text-primary"
                            strokeWidth={2}
                            aria-hidden
                        />
                    </span>
                    <span className="mt-xxs line-clamp-2 block min-h-[2.4rem] text-100 leading-snug text-muted-foreground">
                        {def.blurb}
                    </span>
                </span>
            </div>

            {/* Stats + chips pinned to the bottom so cards never hollow out. */}
            <div className="relative mt-auto">
                <div className="my-m h-px w-full bg-border" aria-hidden />

                <div className="flex items-center gap-xs text-100 text-muted-foreground">
                    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-s py-[2px] font-numeric text-200 font-semibold text-primary">
                        {card.fieldCount}
                    </span>
                    fields to slice by
                </div>

                <div className="mt-s flex h-[1.75rem] flex-wrap gap-xxs overflow-hidden">
                    {chips.map((v) => (
                        <span
                            key={v}
                            title={v}
                            className="max-w-[10.5rem] truncate rounded-full border border-border bg-secondary px-s py-[2px] text-100 text-foreground transition-colors group-hover:border-primary/25"
                        >
                            {v}
                        </span>
                    ))}
                </div>
            </div>
        </m.button>
    );
}
