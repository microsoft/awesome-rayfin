//-----------------------------------------------------------------------
// Semantic Directory — value-match card (search "answer-first" payoff).
//
// When a query matches real dimension member values (game titles, brands…),
// this card is the first thing a user sees: proof the model knows the thing,
// the matching values inline, and how many metrics can break it down — so the
// answer lands before any click. Clicking opens the field for the full story.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";
import type { ValueMatch } from "@/catalog/search/value-matches";
import { fadeUp, tapCard } from "@/lib/motion";
import { Pill } from "./panel-ui";

const MAX_CHIPS = 14;

/** Highlight the matched query span inside a value label. */
function Highlight({ text, query }: { text: string; query: string }) {
    const i = text.toLowerCase().indexOf(query.toLowerCase());
    if (query.length < 2 || i < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, i)}
            <span className="font-semibold text-primary">{text.slice(i, i + query.length)}</span>
            {text.slice(i + query.length)}
        </>
    );
}

export function ValueMatchCard({
    match,
    query,
    onOpen,
}: {
    match: ValueMatch;
    query: string;
    onOpen: (columnKey: string) => void;
}) {
    const shown = match.matches.slice(0, MAX_CHIPS);
    const more = match.matches.length - shown.length;

    return (
        <m.button
            type="button"
            variants={fadeUp}
            onClick={() => onOpen(match.columnKey)}
            {...tapCard}
            className="group flex w-full flex-col gap-m rounded-2xl border border-primary/40 bg-[var(--hue-column-soft)] p-l text-left shadow-[var(--glow)] transition-colors hover:border-primary"
        >
            <div className="flex items-center gap-s">
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-xl bg-primary/15 text-primary" aria-hidden>
                    <Sparkles className="icon-size-200" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-s">
                        <span className="truncate text-300 font-semibold text-foreground">
                            &ldquo;{query.trim()}&rdquo; is in {match.field}
                        </span>
                        {match.live ? (
                            <span className="inline-flex items-center gap-[3px] rounded-full border border-[color:var(--hue-column)]/40 bg-card px-s py-[1px] text-100 font-medium text-foreground">
                                <span className="size-[6px] rounded-full bg-[color:var(--hue-column)]" aria-hidden />
                                live
                            </span>
                        ) : null}
                    </div>
                    <span className="block truncate text-100 text-muted-foreground">
                        {match.matches.length}
                        {match.totalValues ? ` of ${match.totalValues}` : ""} matching
                        {match.matches.length === 1 ? " value" : " values"} · {match.ref}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap gap-s">
                {shown.map((v) => (
                    <Pill key={v} tone="column">
                        <Highlight text={v} query={query} />
                    </Pill>
                ))}
                {more > 0 ? <Pill>+{more} more</Pill> : null}
            </div>

            <div className="flex items-center justify-between gap-s">
                <span className="text-200 text-muted-foreground">
                    <span className="font-numeric font-semibold text-foreground">{match.metricCount}</span>{" "}
                    {match.metricCount === 1 ? "metric" : "metrics"} can break down by {match.field}
                </span>
                <span className="inline-flex items-center gap-xs text-200 font-semibold text-primary">
                    Open field
                    <ArrowRight className="icon-size-100 transition-transform group-hover:translate-x-[2px]" strokeWidth={2} aria-hidden />
                </span>
            </div>
        </m.button>
    );
}
