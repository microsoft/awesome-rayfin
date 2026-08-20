//-----------------------------------------------------------------------
// Semantic Directory — landing suggestion controls.
//
// Two calm, clickable entry points shown on the Level 0 landing so a user who
// doesn't know the vocabulary is never stuck at a blank box:
//   • StarterChip — a high-value, close-verified measure to open directly.
//   • DomainCard  — a business area to browse like a menu.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { StarterChip, DomainCard } from "@/hooks/use-example-chips";
import { tap, tapCard } from "@/lib/motion";

export function StarterChipButton({
    chip,
    onSelect,
}: {
    chip: StarterChip;
    onSelect: (key: string) => void;
}) {
    return (
        <m.button
            type="button"
            onClick={() => onSelect(chip.key)}
            {...tap}
            className="inline-flex items-center gap-xs rounded-full border border-primary/25 bg-primary/10 px-m py-xs text-200 font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/15"
        >
            {chip.emoji ? <span aria-hidden>{chip.emoji}</span> : null}
            {chip.label}
        </m.button>
    );
}

export function DomainCardButton({
    card,
    onSelect,
}: {
    card: DomainCard;
    onSelect: (topic: string) => void;
}) {
    return (
        <m.button
            type="button"
            onClick={() => onSelect(card.topic)}
            {...tapCard}
            className="group flex h-full min-w-0 items-center gap-m rounded-xl border border-border bg-card px-l py-m text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
        >
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-400">
                {card.emoji || "📂"}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-300 font-medium text-foreground">{card.topic}</span>
                <span className="text-100 text-muted-foreground">{card.count} measures</span>
            </span>
            <ArrowUpRight
                className="icon-size-200 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-[1px] group-hover:-translate-y-[1px]"
                strokeWidth={2}
                aria-hidden
            />
        </m.button>
    );
}
