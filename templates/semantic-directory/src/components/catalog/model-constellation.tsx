//-----------------------------------------------------------------------
// Semantic Directory — Model Constellation (the landing centerpiece).
//
// Renders the semantic model as a navigable star-map: a central Compass hub
// (the whole model) with the business areas fanned out in two wide rows above
// and below it — a horizontal galaxy that spreads across the available width
// instead of a tight ring, so nothing crowds the hub. Node size reflects how
// much of the model an area covers (its sliceable field count); hover previews
// live counts + examples; click flies into that area. Everything is derived
// from the live model. No AI, no invented structure.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { Compass } from "lucide-react";
import type { ThemeCard } from "@/catalog/browse/theme-cards";
import { pressSpring } from "@/lib/motion";

interface ConstNode extends ThemeCard {
    x: number;
    y: number;
    size: number;
    place: "top" | "bottom";
}

interface Props {
    cards: ThemeCard[];
    measureCount: number;
    tableCount: number;
    onOpenTheme: (id: string) => void;
}

/**
 * Max business-area nodes the landing orbit renders. On a large model the full
 * area list would crowd the hub into an unreadable tangle, so the orbit shows
 * the top-ranked areas (deriveThemes is importance-ranked) and the rest are
 * reachable through the landing's "More areas" tray. Small models are unaffected.
 */
export const ORBIT_CAP = 12;

const TOP_Y = 17;
const BOTTOM_Y = 83;

/** Fan a set of cards evenly across the width at a fixed row height. */
function placeRow(cards: ThemeCard[], y: number, place: "top" | "bottom", sizeOf: (c: ThemeCard) => number): ConstNode[] {
    const n = cards.length;
    return cards.map((c, i) => ({
        ...c,
        x: n <= 1 ? 50 : 7 + (i / (n - 1)) * 86,
        y,
        size: sizeOf(c),
        place,
    }));
}

export function ModelConstellation({ cards, measureCount, tableCount, onOpenTheme }: Props) {
    const reduce = useReducedMotion();
    const [hover, setHover] = useState<string | null>(null);

    const nodes = useMemo<ConstNode[]>(() => {
        const counts = cards.map((c) => c.fieldCount);
        const min = Math.min(...counts, 0);
        const max = Math.max(...counts, 1);
        const sizeOf = (c: ThemeCard) => 46 + (max > min ? (c.fieldCount - min) / (max - min) : 0) * 30;
        // Split into two balanced rows; larger areas alternate so each row mixes.
        const sorted = [...cards].sort((a, b) => b.fieldCount - a.fieldCount);
        const top = sorted.filter((_, i) => i % 2 === 0);
        const bottom = sorted.filter((_, i) => i % 2 === 1);
        return [...placeRow(top, TOP_Y, "top", sizeOf), ...placeRow(bottom, BOTTOM_Y, "bottom", sizeOf)];
    }, [cards]);

    const active = nodes.find((n) => n.def.id === hover) ?? null;

    return (
        <div className="relative h-full w-full">
            {/* Decorative concentric ellipses + hub→node threads. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                <ellipse cx="50" cy="50" rx="47" ry="38" fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" style={{ opacity: "var(--const-ring-o-2)" }} />
                <ellipse cx="50" cy="50" rx="30" ry="24" fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" style={{ opacity: "var(--const-ring-o-3)" }} />
                {nodes.map((n) => (
                    <line
                        key={n.def.id}
                        x1="50"
                        y1="50"
                        x2={n.x}
                        y2={n.y}
                        stroke="var(--color-primary)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        className="transition-opacity duration-300"
                        style={{ opacity: active ? (active.def.id === n.def.id ? "var(--const-thread-active)" : "var(--const-thread-dim)") : "var(--const-thread-base)" }}
                    />
                ))}
            </svg>

            {/* Center hub — the whole model. */}
            <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
                <div className="relative grid size-[104px] place-items-center rounded-full border border-primary/25 bg-card/85 text-center shadow-[var(--glow)] backdrop-blur">
                    <span className="live-dot absolute inset-0 rounded-full" aria-hidden />
                    <span className="relative flex flex-col items-center gap-xxs px-s">
                        <Compass className="icon-size-500 text-primary" strokeWidth={1.75} aria-hidden />
                        <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">The model</span>
                        <span className="font-numeric text-100 text-foreground">
                            {measureCount} · {tableCount}
                        </span>
                    </span>
                </div>
            </div>

            {/* Orbiting business-area nodes, fanned in two rows. */}
            {nodes.map((n, i) => (
                <m.button
                    key={n.def.id}
                    type="button"
                    onClick={() => onOpenTheme(n.def.id)}
                    onHoverStart={() => setHover(n.def.id)}
                    onHoverEnd={() => setHover((h) => (h === n.def.id ? null : h))}
                    onFocus={() => setHover(n.def.id)}
                    onBlur={() => setHover((h) => (h === n.def.id ? null : h))}
                    aria-label={`${n.def.label} — ${n.fieldCount} fields`}
                    className={`group absolute z-10 flex w-[8rem] -translate-x-1/2 -translate-y-1/2 items-center gap-xxs focus:outline-none ${
                        n.place === "top" ? "flex-col" : "flex-col-reverse"
                    }`}
                    style={{ left: `${n.x}%`, top: `${n.y}%` }}
                    animate={reduce ? undefined : { y: [0, -4, 0] }}
                    transition={{ duration: 5 + (i % 4), delay: i * 0.25, repeat: Infinity, ease: "easeInOut" }}
                    whileHover={{ scale: 1.06, transition: pressSpring }}
                    whileTap={{ scale: 0.94, transition: pressSpring }}
                >
                    <span className="max-w-[8rem] truncate rounded-full bg-background/70 px-xs text-100 font-medium text-foreground backdrop-blur">
                        {n.def.label}
                    </span>
                    <span
                        className="grid shrink-0 place-items-center rounded-full border border-primary/30 bg-card shadow-[var(--e2)] transition-colors group-hover:border-primary/60"
                        style={{ width: n.size, height: n.size }}
                    >
                        <span className="text-600" aria-hidden>{n.def.emoji}</span>
                    </span>
                </m.button>
            ))}

            {/* Hover preview — floats just outside the active node. */}
            {active ? (
                <m.div
                    initial={{ opacity: 0, y: active.place === "top" ? 6 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`pointer-events-none absolute z-30 w-[13rem] -translate-x-1/2 rounded-xl border border-primary/25 bg-popover/95 p-m text-left shadow-[var(--e3)] backdrop-blur ${
                        active.place === "top" ? "translate-y-[20%]" : "-translate-y-[120%]"
                    }`}
                    style={{ left: `${Math.min(Math.max(active.x, 12), 88)}%`, top: `${active.y}%` }}
                >
                    <div className="flex items-center gap-xs">
                        <span className="text-400" aria-hidden>{active.def.emoji}</span>
                        <span className="text-200 font-semibold text-foreground">{active.def.label}</span>
                    </div>
                    <div className="mt-xxs text-100 text-muted-foreground">
                        <span className="font-numeric font-semibold text-primary">{active.fieldCount}</span> fields ·{" "}
                        <span className="font-numeric font-semibold text-foreground">{active.metricCount}</span> measures
                    </div>
                    <div className="mt-xs flex flex-wrap gap-xxs">
                        {(active.exampleValues.length ? active.exampleValues : active.sampleFields).slice(0, 3).map((v) => (
                            <span key={v} className="max-w-[6rem] truncate rounded-full border border-border bg-secondary px-xs py-[1px] text-100 text-foreground">
                                {v}
                            </span>
                        ))}
                    </div>
                </m.div>
            ) : null}
        </div>
    );
}
