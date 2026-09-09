//-----------------------------------------------------------------------
// Semantic Directory — EntityConstellation (the detail-view centerpiece).
//
// Replaces the old linear "where this sits" mini-graph. The focused item is a
// glowing beacon in the middle; its relationships fan out as CATEGORISED ORBITS
// — source tables, the measures it's built from, its family, the measures that
// read it, the dimensions it slices by. Each sector is a small pod of real,
// clickable nodes connected to the hub by a pulsing thread, so the map shows
// both breadth (every kind of relationship) and depth (expand a sector to see
// them all). All derived from the model's relationships + DAX lineage — no AI.
//-----------------------------------------------------------------------

import { memo, useCallback, useMemo, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "framer-motion";
import { Network, ChevronRight, Compass, Info } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { buildEntityHood, type HoodNode, type HoodSector, type NodeKind } from "@/catalog/lineage/entity-hood";
import type { CatalogEntity } from "./entity-detail";
import { tapNode } from "@/lib/motion";
import { Pressable } from "@/components/ui/pressable";

const RAD = Math.PI / 180;
const R = 38; // orbit radius, % of the box
const VISIBLE = 4; // chips shown before "+N more"

// Angle presets (deg; 0°=right, 90°=down) tuned so sparse maps spread across the
// WIDTH instead of collapsing into a thin vertical line. Falls back to an even
// ring for anything outside 1–5 sectors.
const ANGLES: Record<number, number[]> = {
    1: [0],
    2: [180, 0],
    3: [180, 0, 90],
    4: [150, 30, 210, 330],
    5: [150, 30, 198, 342, 90],
};

// A few fixed "stars" so even a 2-sector map still reads as a galaxy.
const STARS: { cx: number; cy: number; r: number; o: number }[] = [
    { cx: 18, cy: 22, r: 0.6, o: 0.5 },
    { cx: 82, cy: 18, r: 0.5, o: 0.4 },
    { cx: 26, cy: 74, r: 0.5, o: 0.45 },
    { cx: 74, cy: 78, r: 0.7, o: 0.5 },
    { cx: 60, cy: 30, r: 0.4, o: 0.35 },
    { cx: 40, cy: 70, r: 0.4, o: 0.35 },
    { cx: 88, cy: 52, r: 0.5, o: 0.4 },
    { cx: 12, cy: 50, r: 0.5, o: 0.4 },
];

const DOT: Record<NodeKind, string> = {
    measure: "bg-[color:var(--hue-measure)]",
    column: "bg-[color:var(--hue-column)]",
    table: "bg-[color:var(--hue-table)]",
};
const TONE: Record<NodeKind, string> = {
    measure: "border-[color:var(--hue-measure)]/35 bg-[var(--hue-measure-soft)]",
    column: "border-[color:var(--hue-column)]/35 bg-[var(--hue-column-soft)]",
    table: "border-[color:var(--hue-table)]/35 bg-[var(--hue-table-soft)]",
};

// Plain-English meaning of each orbital sector, so a non-engineer can read the
// map. Keyed by the sector's heading (unique across kinds).
const SECTOR_HELP: Record<string, string> = {
    "Source tables": "The tables this measure pulls its numbers from.",
    "Built from": "Other measures this one is calculated from.",
    Family: "Related measures in the same group.",
    "Feeds measures": "Measures that build on this one.",
    "Slice by": "Fields you can break this measure down by in a report.",
    "Lives in": "The table this field belongs to.",
    "Rolls up to": "Tables this field rolls up into.",
    "Used by measures": "Measures you can slice by this field.",
    "Sibling fields": "Other fields in the same table.",
    "Example values": "A few real values from inside this field.",
    "Joins to": "Tables this table links out to.",
    "Referenced by": "Tables that link into this one.",
    "Measures here": "Measures that live on this table.",
    "Key fields": "The main fields you can slice by in this table.",
};

const Chip = memo(function Chip({ node, onNavigate }: { node: HoodNode; onNavigate: (key: string) => void }) {
    const body = (
        <span className={`inline-flex max-w-[10rem] items-center gap-xs rounded-full border px-s py-[3px] text-100 shadow-sm ${TONE[node.kind]}`}>
            <span aria-hidden className={`size-[6px] shrink-0 rounded-full ${DOT[node.kind]}`} />
            {node.emoji ? <span aria-hidden>{node.emoji}</span> : null}
            <span className="truncate text-foreground">{node.label}</span>
        </span>
    );
    if (!node.navigable) return <span title={node.label}>{body}</span>;
    return (
        <m.button
            type="button"
            onClick={() => onNavigate(node.key)}
            {...tapNode}
            title={`Open ${node.label}`}
            style={{ willChange: "transform" }}
            className="rounded-full transition-[filter] hover:brightness-110"
        >
            {body}
        </m.button>
    );
});

const SectorPod = memo(function SectorPod({
    sector,
    alignRight,
    dimmed,
    emphasized,
    onNavigate,
    onHover,
}: {
    sector: HoodSector;
    alignRight: boolean;
    dimmed: boolean;
    emphasized: boolean;
    onNavigate: (key: string) => void;
    onHover: (id: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const visible = open ? sector.nodes : sector.nodes.slice(0, VISIBLE);
    const more = sector.nodes.length - VISIBLE;
    const beyond = sector.total - sector.nodes.length;

    return (
        <div
            className={`flex w-[13rem] flex-col gap-xs transition-[opacity,transform] duration-300 ${
                alignRight ? "items-start" : "items-end"
            } ${dimmed ? "opacity-35" : "opacity-100"} ${emphasized ? "scale-[1.04]" : ""}`}
            onMouseEnter={() => onHover(sector.id)}
            onMouseLeave={() => onHover(null)}
        >
            <div className={`flex items-center gap-xs ${alignRight ? "" : "flex-row-reverse"}`}>
                <span
                    title={SECTOR_HELP[sector.label]}
                    className="cursor-help text-100 font-semibold uppercase tracking-wide text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                >
                    {sector.label}
                </span>
                <span className="rounded-full bg-secondary px-xs py-[1px] font-numeric text-[10px] leading-none text-foreground">
                    {sector.total}
                </span>
            </div>
            <div className={`flex flex-wrap gap-xs ${alignRight ? "justify-start" : "justify-end"}`}>
                {visible.map((n) => (
                    <Chip key={n.key} node={n} onNavigate={onNavigate} />
                ))}
                {more > 0 ? (
                    <Pressable
                        variant="control"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="rounded-full border border-dashed border-border px-s py-[3px] text-100 text-muted-foreground transition-colors hover:border-primary/45 hover:bg-accent hover:text-foreground"
                    >
                        {open ? "show fewer" : `+${more} more`}
                    </Pressable>
                ) : null}
                {beyond > 0 ? (
                    <span className="self-center pl-xxs text-100 text-muted-foreground/80" title={`${beyond} more not shown on the map — search to open any of them.`}>
                        +{beyond} beyond the map
                    </span>
                ) : null}
            </div>
        </div>
    );
});

export function EntityConstellation({
    entity,
    catalog,
    onNavigate,
}: {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onNavigate: (key: string) => void;
}) {
    const reduce = useReducedMotion();
    const [hover, setHover] = useState<string | null>(null);
    const [beaconHover, setBeaconHover] = useState(false);

    // Breadcrumb trail so re-centering never loses the user. Clicking a node
    // re-roots the page (map re-centers); the trail records the path so they
    // can walk back. External navigation (e.g. from the results list) resets it.
    const [trail, setTrail] = useState<{ key: string; label: string }[]>(() => [
        { key: entity.key, label: entity.displayName },
    ]);
    const [prevKey, setPrevKey] = useState(entity.key);
    const [pendingInternal, setPendingInternal] = useState(false);
    if (entity.key !== prevKey) {
        setPrevKey(entity.key);
        setTrail((prev) => {
            if (!pendingInternal) return [{ key: entity.key, label: entity.displayName }];
            const idx = prev.findIndex((c) => c.key === entity.key);
            if (idx >= 0) return prev.slice(0, idx + 1); // backtracking
            return [...prev, { key: entity.key, label: entity.displayName }];
        });
        if (pendingInternal) setPendingInternal(false);
    }
    const focusOn = useCallback(
        (key: string) => {
            if (key === entity.key) return;
            setPendingInternal(true);
            onNavigate(key);
        },
        [entity.key, onNavigate],
    );

    const hood = useMemo(() => buildEntityHood(catalog, entity), [catalog, entity]);

    const placed = useMemo(() => {
        if (!hood) return [];
        const n = hood.sectors.length;
        const angles = ANGLES[n] ?? hood.sectors.map((_, i) => -90 + (i * 360) / n);
        return hood.sectors.map((sector, i) => {
            const a = angles[i] * RAD;
            const x = 50 + R * Math.cos(a);
            const y = 50 + R * Math.sin(a);
            return { sector, x, y, alignRight: Math.cos(a) >= -0.001 };
        });
    }, [hood]);

    if (!hood) return null;

    const centerTone = hood.center.kind === "measure" ? "measure" : hood.center.kind === "table" ? "table" : "column";
    // Shrink the stage for sparse maps so they don't float in a sea of dead space.
    const boxH = hood.sectors.length <= 2 ? "20rem" : hood.sectors.length === 3 ? "23rem" : "26rem";

    return (
        <div className="constellation-stage relative overflow-hidden rounded-2xl border border-border p-l">
            {/* Frontier backdrop. */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5]"
                style={{
                    backgroundImage:
                        "radial-gradient(circle at center, color-mix(in oklab, var(--color-primary) 22%, transparent) 1px, transparent 1.4px)",
                    backgroundSize: "20px 20px",
                    WebkitMaskImage: "radial-gradient(ellipse 72% 78% at 50% 50%, black, transparent 80%)",
                    maskImage: "radial-gradient(ellipse 72% 78% at 50% 50%, black, transparent 80%)",
                }}
            />

            <div className="mb-s flex items-center justify-between gap-s">
                <div className="flex items-center gap-xs text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                    <Network className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                    Where this sits in the model
                </div>
                <span className="hidden items-center gap-m text-100 text-muted-foreground sm:flex">
                    <span className="inline-flex items-center gap-xxs"><span aria-hidden className={`size-[7px] rounded-full ${DOT.column}`} /> field</span>
                    <span className="inline-flex items-center gap-xxs"><span aria-hidden className={`size-[7px] rounded-full ${DOT.measure}`} /> measure</span>
                    <span className="inline-flex items-center gap-xxs"><span aria-hidden className={`size-[7px] rounded-full ${DOT.table}`} /> table</span>
                    <span
                        className="inline-flex cursor-help"
                        tabIndex={0}
                        aria-label="How to read this map"
                        title={"Each cluster around the center is one kind of relationship — hover a cluster's label to see what it means, hover to trace its thread, and click any node to explore it."}
                    >
                        <Info className="icon-size-100 text-muted-foreground/70" strokeWidth={2} aria-hidden />
                    </span>
                </span>
            </div>

            {/* Breadcrumb trail — appears once you start exploring. */}
            <AnimatePresence initial={false}>
                {trail.length > 1 ? (
                    <m.div
                        initial={reduce ? undefined : { opacity: 0, height: 0 }}
                        animate={reduce ? undefined : { opacity: 1, height: "auto" }}
                        exit={reduce ? undefined : { opacity: 0, height: 0 }}
                        className="mb-s flex flex-wrap items-center gap-xxs overflow-hidden text-100"
                    >
                        <Compass className="icon-size-100 shrink-0 text-primary" strokeWidth={2} aria-hidden />
                        {trail.map((crumb, i) => {
                            const isLast = i === trail.length - 1;
                            return (
                                <span key={crumb.key} className="inline-flex items-center gap-xxs">
                                    {i > 0 ? <ChevronRight className="size-[12px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden /> : null}
                                    {isLast ? (
                                        <span className="max-w-[12rem] truncate rounded-full bg-primary/15 px-s py-[2px] font-semibold text-foreground">
                                            {crumb.label}
                                        </span>
                                    ) : (
                                        <Pressable
                                            variant="control"
                                            onClick={() => focusOn(crumb.key)}
                                            title={`Back to ${crumb.label}`}
                                            className="max-w-[10rem] truncate rounded-full px-s py-[2px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                        >
                                            {crumb.label}
                                        </Pressable>
                                    )}
                                </span>
                            );
                        })}
                    </m.div>
                ) : null}
            </AnimatePresence>

            {/* The orbital map (sm and up). Keyed by entity so it settles on each
                re-center. On narrow screens the orbit overlaps, so a stacked
                fallback renders instead (below). */}
            <div className="hidden sm:block">
            <AnimatePresence mode="wait">
                <m.div
                    key={entity.key}
                    initial={reduce ? undefined : { opacity: 0, scale: 0.985 }}
                    animate={reduce ? undefined : { opacity: 1, scale: 1 }}
                    transition={{ duration: 0.24, ease: "easeOut" }}
                    className="relative mx-auto w-full"
                    style={{ height: boxH }}
                >
                {/* Orbit rings + starfield + threads. */}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                    <ellipse cx="50" cy="50" rx={R * 0.58} ry={R * 0.58} fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="1 4" vectorEffect="non-scaling-stroke" style={{ opacity: "var(--const-ring-o-1)" }} />
                    <ellipse cx="50" cy="50" rx={R} ry={R} fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" style={{ opacity: "var(--const-ring-o-2)" }} />
                    <ellipse cx="50" cy="50" rx={R * 1.28} ry={R * 1.28} fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="1 5" vectorEffect="non-scaling-stroke" style={{ opacity: "var(--const-ring-o-3)" }} />
                    <g style={{ opacity: "var(--const-star-field, 1)" }}>
                    {STARS.map((s, i) => (
                        <circle
                            key={i}
                            className="const-star"
                            cx={s.cx}
                            cy={s.cy}
                            r={s.r}
                            fill="var(--color-primary)"
                            opacity={s.o}
                            vectorEffect="non-scaling-stroke"
                            style={{
                                ["--star-o" as string]: String(s.o),
                                ["--star-dim" as string]: String(s.o * 0.3),
                                ["--star-dur" as string]: `${3 + (i % 3)}s`,
                            } as React.CSSProperties}
                        />
                    ))}
                    </g>
                    {placed.map(({ sector, x, y }) => (
                        <line
                            key={sector.id}
                            x1="50"
                            y1="50"
                            x2={x}
                            y2={y}
                            stroke="var(--color-primary)"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                            className="transition-opacity duration-300"
                            style={{
                                willChange: "opacity",
                                opacity: hover
                                    ? hover === sector.id
                                        ? "var(--const-thread-active)"
                                        : "var(--const-thread-dim)"
                                    : beaconHover
                                        ? "var(--const-thread-beacon)"
                                        : "var(--const-thread-base)",
                            }}
                        />
                    ))}
                </svg>

                {/* Center beacon. */}
                <div
                    className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
                    onMouseEnter={() => setBeaconHover(true)}
                    onMouseLeave={() => setBeaconHover(false)}
                >
                    <span aria-hidden className="absolute inset-0 -z-10 rounded-2xl bg-primary/25 blur-2xl" />
                    <m.span
                        aria-hidden
                        className="absolute inset-0 -z-10 rounded-2xl border border-primary/40"
                        animate={reduce ? undefined : { scale: [1, 1.16, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <div className={`flex w-[9rem] flex-col items-center gap-xxs rounded-2xl border border-primary/50 px-m py-m text-center shadow-[var(--glow)] transition-transform duration-300 ${beaconHover ? "scale-[1.03]" : ""} ${TONE[centerTone]}`}>
                        {hood.center.emoji ? (
                            <div className="grid size-8 place-items-center rounded-full bg-background/50 text-400 leading-none">
                                <span aria-hidden>{hood.center.emoji}</span>
                            </div>
                        ) : null}
                        <div className="max-w-full truncate text-200 font-semibold text-foreground" title={hood.center.label}>
                            {hood.center.label}
                        </div>
                        <div className="text-100 font-medium text-primary">{hood.center.role}</div>
                    </div>
                </div>

                {/* Sector pods. Keyed by entity so expanded state resets per item;
                    each pops in on a stagger so the map feels alive as it settles. */}
                {placed.map(({ sector, x, y, alignRight }, i) => (
                    <div
                        key={`${entity.key}:${sector.id}`}
                        className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${x}%`, top: `${y}%` }}
                    >
                        <m.div
                            initial={reduce ? undefined : { opacity: 0, scale: 0.9 }}
                            animate={reduce ? undefined : { opacity: 1, scale: 1 }}
                            transition={{ delay: reduce ? 0 : 0.14 + i * 0.06, duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
                            style={{ willChange: "transform" }}
                        >
                            <SectorPod
                                sector={sector}
                                alignRight={alignRight}
                                dimmed={hover != null && hover !== sector.id}
                                emphasized={beaconHover && hover == null}
                                onNavigate={focusOn}
                                onHover={setHover}
                            />
                        </m.div>
                    </div>
                ))}
                </m.div>
            </AnimatePresence>
            </div>

            {/* Mobile stacked fallback (< 640px) — the orbit overlaps on narrow
                screens, so list the same center + sectors as readable rows. */}
            <div className="flex flex-col gap-m sm:hidden">
                <div className={`mx-auto flex w-full max-w-xs flex-col items-center gap-xxs rounded-2xl border border-primary/50 px-m py-m text-center shadow-[var(--glow)] ${TONE[centerTone]}`}>
                    {hood.center.emoji ? (
                        <div className="grid size-8 place-items-center rounded-full bg-background/50 text-400 leading-none">
                            <span aria-hidden>{hood.center.emoji}</span>
                        </div>
                    ) : null}
                    <div className="max-w-full truncate text-200 font-semibold text-foreground" title={hood.center.label}>
                        {hood.center.label}
                    </div>
                    <div className="text-100 font-medium text-primary">{hood.center.role}</div>
                </div>
                {hood.sectors.map((sector) => {
                    const beyond = sector.total - sector.nodes.length;
                    return (
                    <div key={sector.id} className="flex flex-col gap-xs">
                        <div className="flex items-center gap-xs">
                            <span
                                title={SECTOR_HELP[sector.label]}
                                className="text-100 font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                                {sector.label}
                            </span>
                            <span className="rounded-full bg-secondary px-xs py-[1px] font-numeric text-[10px] leading-none text-foreground">
                                {sector.total}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-xs">
                            {sector.nodes.map((n) => (
                                <Chip key={n.key} node={n} onNavigate={focusOn} />
                            ))}
                            {beyond > 0 ? (
                                <span className="self-center pl-xxs text-100 text-muted-foreground/80">
                                    +{beyond} beyond the map
                                </span>
                            ) : null}
                        </div>
                    </div>
                    );
                })}
            </div>

            <div className="mt-s flex items-center justify-between gap-s">
                <p className="text-100 text-muted-foreground">{hood.summary}</p>
                <span className="hidden shrink-0 text-100 text-muted-foreground/80 sm:block">
                    Click any node to explore · use the trail to go back
                </span>
            </div>
        </div>
    );
}
