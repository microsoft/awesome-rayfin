//-----------------------------------------------------------------------
// Semantic Directory — Level 0 landing (search + browse by business area).
//
// The front door, in three honest paths: (1) the hero search for "I know what
// I want", (2) a live "constellation" orbit of the model's top business areas
// (labels curated for a calm first impression; counts, fields, and example
// values populated LIVE from the model), and (3) an "All areas" overflow tray
// for the remaining areas on larger models. A compact row of verified metrics
// keeps it grounded — every count derived live from the model.
//-----------------------------------------------------------------------

import { useMemo, useState, type ReactNode } from "react";
import { m } from "framer-motion";
import { Compass, ChevronDown } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { appConfig } from "@/app.config";
import { fadeUp, listContainer, chipPop } from "@/lib/motion";
import { useExampleChips } from "@/hooks/use-example-chips";
import { buildThemeCards, type ThemeCard } from "@/catalog/browse/theme-cards";
import { deriveThemes } from "@/catalog/browse/theme-registry";
import { SearchField } from "./search-field";
import { StarterChipButton } from "./landing-suggestions";
import { ModelConstellation, ORBIT_CAP } from "./model-constellation";
import { LandingAurora } from "./landing-aurora";

// Foreground → green gradient for the hero wordmark (clipped to the text).
const HERO_TITLE_STYLE = {
    backgroundImage:
        "linear-gradient(180deg, var(--color-foreground) 28%, color-mix(in oklab, var(--color-primary) 62%, var(--color-foreground)))",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
} as const;

const SEARCH_GLOW_STYLE = {
    background:
        "radial-gradient(58% 70% at 50% 50%, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 72%)",
} as const;

/**
 * Trim a model name for the hero title so long Power BI model names stay crisp.
 * Cuts on a word boundary when one is reasonably close to the cap, otherwise a
 * hard cut, dropping trailing punctuation before the ellipsis. The full name is
 * still shown in the tagline.
 */
function truncateModelName(name: string, max = 28): string {
    if (name.length <= max) return name;
    const cut = name.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    const stripped = base.replace(/[\s.,;:–—-]+$/, "");
    return `${stripped || cut.trim()}…`;
}

interface CalmLandingProps {
    catalog: CatalogModel | undefined;
    query: string;
    onQueryChange: (value: string) => void;
    onSelect: (key: string) => void;
    onSubmit: () => void;
    onOpenTheme: (themeId: string) => void;
    /** Optional footer affordances (e.g. analysis-tool entry points). */
    tools?: ReactNode;
}

export function CalmLanding({
    catalog,
    query,
    onQueryChange,
    onSelect,
    onSubmit,
    onOpenTheme,
    tools,
}: CalmLandingProps) {
    const { starters } = useExampleChips(catalog);

    const themes = useMemo(() => (catalog ? deriveThemes(catalog) : []), [catalog]);
    // ONE importance-ranked card list (deriveThemes is already ranked). The orbit
    // renders the top ORBIT_CAP so a large model stays legible; the rest stay
    // reachable through the "All areas" tray below. On a small model everything
    // fits, the tray never appears, and the landing is unchanged.
    const allCards = useMemo(
        () => (catalog ? buildThemeCards(catalog, themes) : []),
        [catalog, themes],
    );
    const orbitCards = useMemo(() => allCards.slice(0, ORBIT_CAP), [allCards]);
    const restCards = useMemo(() => allCards.slice(ORBIT_CAP), [allCards]);

    const measureCount = useMemo(
        () => catalog?.measures.filter((meas) => !meas.isHidden).length ?? 0,
        [catalog],
    );
    const tableCount = useMemo(
        () => catalog?.tables.filter((t) => !t.isHidden).length ?? 0,
        [catalog],
    );

    // Resolve the connected model's display name once — shared by the hero
    // title and tagline so they always agree. The demo bundle names itself
    // (brainSource.model === "Contoso Sales"); a live model uses the adopter's
    // configured `modelName`. Empty string when neither is available.
    const modelName = useMemo(() => {
        const raw =
            catalog?.origin === "live"
                ? appConfig.modelName.trim()
                : catalog?.brainSource?.model?.trim();
        return raw ?? "";
    }, [catalog]);

    // Hero title: swap the app-name qualifier for the connected model's name
    // ("Contoso Sales Directory"), falling back to the static app name when no
    // model name is known. The demo bundle self-labels as "… (Demo)" to flag
    // sample data inline in the tagline; that marker is dropped here so the
    // title reads cleanly (the Demo chip + banner already signal demo mode).
    // Real parentheticals in live model names are preserved. Long names are
    // trimmed so the hero stays crisp.
    const heroTitle = useMemo(() => {
        if (!modelName) return appConfig.name;
        // The demo bundle self-labels "… (Demo)" to flag sample data inline in
        // the tagline; drop that marker in the title for demo/bundled catalogs
        // only — a live model legitimately named "… (Demo)" keeps it. Real
        // parentheticals in live names are preserved.
        const clean =
            catalog?.origin !== "live"
                ? modelName.replace(/\s*\(demo\)\s*$/i, "").trim() || modelName
                : modelName;
        return appConfig.nameTemplate.replaceAll("{model}", truncateModelName(clean));
    }, [modelName, catalog]);

    const tagline = useMemo(
        () =>
            appConfig.tagline.replace(
                "{model}",
                modelName || "your Power BI semantic model",
            ),
        [modelName],
    );

    return (
        <div className="relative h-full overflow-hidden">
            <LandingAurora />
            <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col items-center gap-m overflow-y-auto overflow-x-hidden px-l pb-l pt-[4.5rem] lg:pt-l">
            <m.div variants={fadeUp} initial="hidden" animate="show" className="flex shrink-0 flex-col items-center gap-s text-center">
                <span
                    className="relative grid h-[56px] w-[56px] place-items-center rounded-2xl bg-primary/12 text-primary shadow-[var(--glow)]"
                    aria-hidden
                >
                    <span className="live-dot absolute inset-0 rounded-2xl" />
                    <Compass className="icon-size-500 relative" strokeWidth={1.75} />
                </span>
                <h1
                    style={HERO_TITLE_STYLE}
                    className="text-hero-800 font-semibold leading-hero-800"
                >
                    {heroTitle}
                </h1>
                <p className="max-w-lg text-300 text-muted-foreground">
                    {tagline}
                </p>
            </m.div>

            <m.div
                variants={fadeUp}
                initial="hidden"
                animate="show"
                transition={{ delay: 0.1 }}
                className="relative w-full max-w-2xl shrink-0"
            >
                <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-x-8 -inset-y-5 rounded-[2rem] opacity-80 blur-2xl"
                    style={SEARCH_GLOW_STYLE}
                />
                <div className="relative">
                    <SearchField
                        catalog={catalog}
                        query={query}
                        onQueryChange={onQueryChange}
                        onSelect={onSelect}
                        onSubmit={onSubmit}
                        size="lg"
                        autoFocus
                        placeholder="Search a measure, field, or value — e.g. a product or region"
                    />
                </div>
            </m.div>

            {starters.length ? (
                <m.div
                    variants={listContainer}
                    initial="hidden"
                    animate="show"
                    className="flex max-w-2xl shrink-0 flex-wrap items-center justify-center gap-s"
                >
                    <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                        Top metrics
                    </span>
                    {starters.map((chip) => (
                        <m.div key={chip.key} variants={chipPop}>
                            <StarterChipButton chip={chip} onSelect={onSelect} />
                        </m.div>
                    ))}
                </m.div>
            ) : null}

            {orbitCards.length ? (
                <m.div
                    variants={fadeUp}
                    initial="hidden"
                    animate="show"
                    transition={{ delay: 0.12 }}
                    className="constellation-stage constellation-stage--hero grid min-h-[21rem] w-full flex-1 place-items-center overflow-hidden p-l"
                >
                    <ModelConstellation
                        cards={orbitCards}
                        measureCount={measureCount}
                        tableCount={tableCount}
                        onOpenTheme={onOpenTheme}
                    />
                </m.div>
            ) : null}

            {orbitCards.length ? (
                <div className="flex shrink-0 flex-col items-center gap-s">
                    <p className="text-100 text-muted-foreground">
                        {restCards.length
                            ? `Top ${orbitCards.length} of ${allCards.length} business areas orbit the model · open More areas for the rest`
                            : `${orbitCards.length} business areas orbit the model · hover to preview, click to explore`}
                    </p>
                    {restCards.length ? (
                        <AllAreasTray cards={restCards} onOpenTheme={onOpenTheme} />
                    ) : null}
                </div>
            ) : null}

            <m.p
                variants={fadeUp}
                initial="hidden"
                animate="show"
                transition={{ delay: 0.14 }}
                className="flex shrink-0 items-center gap-s text-200 text-muted-foreground"
            >
                <span className="font-numeric">{measureCount}</span> measures ·{" "}
                <span className="font-numeric">{tableCount}</span> tables
            </m.p>

            {tools ? <div className="shrink-0 pt-xs">{tools}</div> : null}
            </div>
        </div>
    );
}

/**
 * Overflow disclosure for the business areas that don't fit the orbit. Keeps the
 * landing calm by default (collapsed) while guaranteeing every area stays one
 * click away — each chip flies into that area exactly like an orbit node.
 */
function AllAreasTray({
    cards,
    onOpenTheme,
}: {
    cards: ThemeCard[];
    onOpenTheme: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="flex w-full max-w-3xl flex-col items-center gap-s">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-xs rounded-full border border-dashed border-border px-m py-[5px] text-100 font-medium text-muted-foreground transition-colors hover:border-primary/45 hover:bg-accent hover:text-foreground"
            >
                {open ? "Hide areas" : "More areas"}
                <span className="font-numeric text-muted-foreground/80">{cards.length} more</span>
                <ChevronDown
                    className={`icon-size-100 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    aria-hidden
                />
            </button>
            {open ? (
                <m.div
                    variants={listContainer}
                    initial="hidden"
                    animate="show"
                    className="flex flex-wrap justify-center gap-xs"
                >
                    {cards.map((c) => (
                        <m.button
                            key={c.def.id}
                            type="button"
                            variants={chipPop}
                            onClick={() => onOpenTheme(c.def.id)}
                            aria-label={`${c.def.label} — ${c.fieldCount} fields`}
                            className="group inline-flex items-center gap-xs rounded-full border border-border bg-card/70 px-s py-[3px] text-100 text-foreground backdrop-blur transition-colors hover:border-primary/50 hover:bg-accent"
                        >
                            <span className="text-200" aria-hidden>{c.def.emoji}</span>
                            <span className="max-w-[9rem] truncate">{c.def.label}</span>
                            <span className="font-numeric text-muted-foreground/80">{c.fieldCount}</span>
                        </m.button>
                    ))}
                </m.div>
            ) : null}
        </div>
    );
}
