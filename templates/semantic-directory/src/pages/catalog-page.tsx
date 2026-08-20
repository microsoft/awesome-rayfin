//-----------------------------------------------------------------------
// Semantic Directory — catalog page (app shell).
//
// A calm front door that goes deep on demand. Level 0 is a centered landing
// (hero search + verified starters + a menu of areas). Typing (or
// picking a starter / area) drops into a slim, viewport-locked workspace: a
// compact top bar with instant typeahead, a browsable result list, and a
// trust-first detail that expands from a glance to the full story. Built from
// the bundled catalog brain (works everywhere) with a live drift overlay when
// embedded in Fabric. Dark / light accent-green, animated, deterministic — no AI.
//-----------------------------------------------------------------------

import { lazy, Suspense, useEffect, useMemo, useState, useDeferredValue } from "react";
import { m, AnimatePresence } from "framer-motion";
import {
    Compass,
    MousePointerClick,
    SearchX,
    ArrowLeft,
    Command,
    ShieldCheck,
    Route,
    Sheet,
    FileText,
    Link2,
    SunMoon,
    Home,
    Waypoints,
} from "lucide-react";
import { useCatalogMetadata } from "@/hooks/use-catalog-metadata";
import { appConfig } from "@/app.config";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import { useCatalogUrlState, type KindFilter, type ToolId } from "@/hooks/use-catalog-url-state";
import { useAppTheme } from "@/hooks/use-theme";
import { exportDataDictionary } from "@/lib/export-actions";
import type { CatalogModel, EntityKind, MeasureMeta } from "@/catalog/model/types";
import { findValueMatches } from "@/catalog/search/value-matches";
import { deriveMatchEvidence, queryTokens } from "@/catalog/search/evidence";
import { groupFamilies, type FamilyGroup } from "@/catalog/browse/area-insights";
import { deriveThemes, findTheme } from "@/catalog/browse/theme-registry";
import { themeFields, themeMeasures, themeTopField } from "@/catalog/browse/theme-cards";
import { fadeUp, listContainer, viewFade } from "@/lib/motion";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Pressable } from "@/components/ui/pressable";
import { SearchField } from "@/components/catalog/search-field";
import { CalmLanding } from "@/components/catalog/calm-landing";
import { DemoBanner } from "@/components/catalog/demo-banner";
import { ResultGroup, ResultRow, type ResultRowData } from "@/components/catalog/result-list";
import { FamilyResultRow } from "@/components/catalog/family-result-row";
import { ValueMatchCard } from "@/components/catalog/value-match-card";
import { AreaOverview } from "@/components/catalog/area-overview";
import { ThemeOverview } from "@/components/catalog/theme-overview";
import { CommandPalette, type PaletteAction } from "@/components/catalog/command-palette";
import { ExportMenu } from "@/components/catalog/export-menu";
import { CopyLinkButton } from "@/components/catalog/copy-link-button";
import { ModeChip } from "@/components/catalog/mode-chip";
// The detail shell pulls in the deep-detail tabs and the entity constellation
// (the app's heaviest render surface). It's only needed after the user opens an
// entity, so load it on demand to keep the initial catalog payload lean.
const EntityDetailShell = lazy(() =>
    import("@/components/catalog/entity-detail-shell").then((mod) => ({
        default: mod.EntityDetailShell,
    })),
);
// Analysis tools (health scorecard, relationship path finder) are opened on
// demand from the palette or landing, so they're split out of the initial bundle.
const HealthView = lazy(() =>
    import("@/components/catalog/health-view").then((mod) => ({ default: mod.HealthView })),
);
const PathFinderView = lazy(() =>
    import("@/components/catalog/path-finder-view").then((mod) => ({ default: mod.PathFinderView })),
);
const ImpactView = lazy(() =>
    import("@/components/catalog/impact-view").then((mod) => ({ default: mod.ImpactView })),
);
import type { CatalogEntity } from "@/components/catalog/entity-detail";

const FILTERS: { id: KindFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "measure", label: "Measures" },
    { id: "column", label: "Dimensions" },
    { id: "table", label: "Tables" },
];

// Platform-correct palette shortcut hint (⌘K on Apple, Ctrl K elsewhere).
const MOD_KEY =
    typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** Header button that opens the command palette, with a keyboard-shortcut hint. */
function PaletteTriggerButton({ onClick }: { onClick: () => void }) {
    return (
        <Pressable
            onClick={onClick}
            aria-label="Open command palette"
            aria-keyshortcuts={MOD_KEY === "⌘" ? "Meta+K" : "Control+K"}
            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
        >
            <Command className="icon-size-100" strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded-md border border-border bg-secondary px-xs py-xxs text-100 text-muted-foreground sm:inline">
                {MOD_KEY} K
            </kbd>
        </Pressable>
    );
}

/** Build a fast key -> entity lookup across all kinds. */
function useEntityIndex(catalog: CatalogModel | undefined) {
    return useMemo(() => {
        const map = new Map<string, CatalogEntity>();
        if (!catalog) return map;
        for (const m of catalog.measures) map.set(m.key, m);
        for (const c of catalog.columns) map.set(c.key, c);
        for (const t of catalog.tables) map.set(t.key, t);
        return map;
    }, [catalog]);
}

const ONTOLOGY_ROW_LABEL: Partial<Record<string, string>> = {
    fact: "Fact",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge",
    security: "Security",
    operational: "Operational",
};

function toRow(entity: CatalogEntity, query = ""): ResultRowData {
    const signals: ResultRowData["signals"] = [];
    const stats: ResultRowData["stats"] = [];

    if (entity.kind === "measure") {
        const feeds = entity.usedByMeasures?.length ?? 0;
        const built = entity.dependsOnMeasures?.length ?? 0;
        if (built) stats.push({ value: built, label: "built from" });
        if (feeds) stats.push({ value: feeds, label: "feeds" });
    } else if (entity.kind === "column") {
        const used = entity.usedByMeasures?.length ?? 0;
        const vals = entity.liveValues?.length ?? 0;
        if (used) stats.push({ value: used, label: used === 1 ? "measure uses it" : "measures use it" });
        if (vals) stats.push({ value: vals, label: "live values" });
    } else {
        if (entity.directLake) signals.push({ label: "Direct Lake", tone: "trust" });
        if (entity.ontology && ONTOLOGY_ROW_LABEL[entity.ontology])
            signals.push({ label: ONTOLOGY_ROW_LABEL[entity.ontology]!, tone: "info" });
        stats.push({ value: entity.columnCount, label: "columns" });
        if (entity.measureCount) stats.push({ value: entity.measureCount, label: "measures" });
    }

    return {
        key: entity.key,
        kind: entity.kind,
        emoji: entity.emoji,
        title: entity.displayName,
        subtitle:
            entity.kind === "column"
                ? entity.ref
                : entity.kind === "measure"
                    ? entity.topic
                    : `${(entity as { columnCount?: number }).columnCount ?? 0} columns`,
        description: entity.description,
        needsDescription: entity.kind === "measure" && !entity.description,
        signals: signals.length ? signals : undefined,
        stats: stats.length ? stats : undefined,
        tokens: query ? queryTokens(query) : undefined,
        evidence: query ? deriveMatchEvidence(query, entity) : undefined,
    };
}

export function CatalogPage() {
    const { catalog, error, mode, modelConfigured } = useCatalogMetadata();
    const [urlState, patch, resetUrl] = useCatalogUrlState();
    const { query, filter, selectedKey, browseTopic, browseThemeId, tool, pfFrom, pfTo, impactKey } = urlState;
    const { toggleTheme } = useAppTheme();
    const [paletteOpen, setPaletteOpen] = useState(false);

    // Setters mirror the old useState API but merge-patch the URL state. Opening
    // an entity always clears any active tool (the detail replaces the tool view).
    const setQuery = (v: string) => patch({ query: v });
    const setFilter = (v: KindFilter) => patch({ filter: v });
    const setSelectedKey = (v: string | undefined) => patch({ selectedKey: v, tool: undefined });

    const openTool = (t: ToolId) =>
        patch({ tool: t, selectedKey: undefined, browseTopic: undefined, browseThemeId: undefined, query: "" });
    const closeTool = () => patch({ tool: undefined });
    // Open the Impact tool seeded on a specific entity (from a detail hand-off),
    // or with no key to let the tool auto-resolve the highest-impact default.
    const openImpact = (key?: string) =>
        patch({
            tool: "impact",
            impactKey: key,
            selectedKey: undefined,
            browseTopic: undefined,
            browseThemeId: undefined,
            query: "",
        });

    const entityIndex = useEntityIndex(catalog);
    const { hits, effectiveQuery } = useCatalogSearch(catalog, query);
    const themes = useMemo(() => (catalog ? deriveThemes(catalog) : []), [catalog]);
    const resolveTheme = (id: string | undefined) => (id ? findTheme(themes, id) : undefined);
    const selected = selectedKey ? entityIndex.get(selectedKey) : undefined;
    // Defer the entity fed to the heavy detail pane: the clicked row highlights
    // instantly (urgent state) while the detail tree re-renders in a
    // non-blocking pass, so item-to-item clicks feel immediate.
    const deferredKey = useDeferredValue(selectedKey);
    const deferredSelected = deferredKey ? entityIndex.get(deferredKey) : undefined;
    const isSearching = query.trim().length > 0;
    const isLanding = !isSearching && !selectedKey && !browseTopic && !browseThemeId && !tool;

    // Global ⌘K / Ctrl+K toggles the command palette from anywhere.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen((v) => !v);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const goHome = () => resetUrl();

    const exitBrowse = () =>
        patch({ browseTopic: undefined, browseThemeId: undefined, selectedKey: undefined });

    // Search input in the workspace header: clear any browse context and any
    // open tool as soon as the user starts typing, in a single state update, so
    // results replace the tool/browse view.
    const handleSearchInput = (v: string) =>
        patch(
            v.trim()
                ? { query: v, browseTopic: undefined, browseThemeId: undefined, tool: undefined }
                : { query: v },
        );

    // Flat result groups: search hits (by kind) + column/table browse. Measures
    // in browse are rendered as collapsible families instead (see familySections).
    const groups = useMemo(() => {
        if (!catalog) return [] as { title: string; rows: ResultRowData[] }[];

        if (isSearching) {
            const order: EntityKind[] = ["measure", "column", "table"];
            const labels: Record<EntityKind, string> = {
                measure: "Measures",
                column: "Dimensions",
                table: "Tables",
            };
            return order
                .filter((k) => filter === "all" || filter === k)
                .map((kind) => ({
                    title: labels[kind],
                    rows: hits
                        .filter((h) => h.kind === kind)
                        .map((h) => {
                            const e = entityIndex.get(h.id);
                            return e ? toRow(e, effectiveQuery) : undefined;
                        })
                        .filter((r): r is ResultRowData => Boolean(r)),
                }))
                .filter((g) => g.rows.length > 0);
        }

        if (browseThemeId) {
            const def = findTheme(themes, browseThemeId);
            if (!def) return [];
            const rows = themeFields(catalog, def).map((e) => toRow(e));
            return rows.length ? [{ title: `Fields in ${def.label}`, rows }] : [];
        }

        if (browseTopic) return []; // measures handled by familySections

        const out: { title: string; rows: ResultRowData[] }[] = [];
        if (filter === "column") {
            out.push({
                title: "Dimensions you can slice by",
                rows: catalog.columns
                    .filter((c) => !c.isHidden && c.isDimensionLike)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((e) => toRow(e)),
            });
        }
        if (filter === "table") {
            out.push({
                title: "Tables",
                rows: catalog.tables
                    .filter((t) => !t.isHidden)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((e) => toRow(e)),
            });
        }
        return out;
    }, [catalog, isSearching, browseTopic, browseThemeId, filter, hits, entityIndex, themes, effectiveQuery]);

    // Measure browse, collapsed into families (one lead + variants) per area.
    const familySections = useMemo(() => {
        if (!catalog || isSearching) return [] as { title: string; families: FamilyGroup[] }[];

        if (browseThemeId) {
            const def = findTheme(themes, browseThemeId);
            if (!def) return [];
            const ms = themeMeasures(catalog, def);
            return ms.length
                ? [{ title: `Metrics you can break down by ${def.label}`, families: groupFamilies(ms) }]
                : [];
        }

        if (browseTopic) {
            const ms = catalog.measures.filter((meas) => !meas.isHidden && (meas.topic ?? "") === browseTopic);
            return [{ title: browseTopic, families: groupFamilies(ms) }];
        }
        if (filter === "all" || filter === "measure") {
            const byTopic = new Map<string, MeasureMeta[]>();
            for (const meas of catalog.measures) {
                if (meas.isHidden) continue;
                const topic = meas.topic ?? "Other measures";
                if (!byTopic.has(topic)) byTopic.set(topic, []);
                byTopic.get(topic)!.push(meas);
            }
            return [...byTopic.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([title, ms]) => ({ title, families: groupFamilies(ms) }));
        }
        return [];
    }, [catalog, isSearching, browseTopic, browseThemeId, filter, themes]);

    // Dimension-value matches (e.g. a product name → the matching values), shown
    // first in search so the payoff lands before any click.
    const valueMatches = useMemo(
        () => (catalog && isSearching ? findValueMatches(catalog, query) : []),
        [catalog, isSearching, query],
    );

    const familyRowCount = (families: FamilyGroup[]) =>
        families.reduce((n, f) => n + 1 + f.variants.length, 0);
    const totalRows =
        groups.reduce((n, g) => n + g.rows.length, 0) +
        familySections.reduce((n, s) => n + familyRowCount(s.families), 0);
    const hasResults = totalRows > 0 || valueMatches.length > 0;

    // Header count: in search, break the total down by kind so the reader sees
    // the shape of the result set at a glance; in browse, a plain item count.
    const resultSummary = isSearching
        ? `${totalRows} ${totalRows === 1 ? "result" : "results"}${
              valueMatches.length ? ` · ${valueMatches.length} value ${valueMatches.length === 1 ? "match" : "matches"}` : ""
          }${
              groups.length > 1
                  ? " · " + groups.map((g) => `${g.rows.length} ${g.title.toLowerCase()}`).join(" · ")
                  : ""
          }`
        : `${totalRows} items`;

    // Enter an area from the landing: drop in on its flagship so the pane is
    // never blank, with the area overview as the fallback.
    // Enter a business-area theme from the landing: drop onto its most-used
    // field so the right pane shows a real dimension + its model position, with
    // the theme overview as the never-blank fallback.
    const enterTheme = (themeId: string) => {
        const def = resolveTheme(themeId);
        const top = catalog && def ? themeTopField(catalog, def) : undefined;
        patch({ browseThemeId: themeId, browseTopic: undefined, selectedKey: top?.key, tool: undefined });
    };

    // Command-palette actions: tools + exports + link + theme + home. Entity
    // jumps are handled by the palette's own fuzzy search (onOpenEntity).
    const paletteActions = useMemo<PaletteAction[]>(() => {
        const acts: PaletteAction[] = [];
        if (catalog) {
            acts.push(
                {
                    id: "tool-health",
                    label: "Model health",
                    hint: "Scorecard of naming, descriptions, and design",
                    keywords: "score grade quality lint audit rules",
                    icon: <ShieldCheck className="icon-size-100" strokeWidth={2} />,
                    run: () => openTool("health"),
                },
                {
                    id: "tool-pathfinder",
                    label: "Path finder",
                    hint: "How two tables join across relationships",
                    keywords: "join relationship path lineage connect between",
                    icon: <Route className="icon-size-100" strokeWidth={2} />,
                    run: () => openTool("pathfinder"),
                },
                {
                    id: "tool-impact",
                    label: "Impact analysis",
                    hint: "What breaks downstream if you change a measure or field",
                    keywords: "impact downstream blast radius dependents affected change breaking lineage",
                    icon: <Waypoints className="icon-size-100" strokeWidth={2} />,
                    run: () => openImpact(),
                },
                {
                    id: "export-csv",
                    label: "Export dictionary — CSV",
                    hint: "Every table, field, and measure",
                    keywords: "download spreadsheet excel data dictionary",
                    icon: <Sheet className="icon-size-100" strokeWidth={2} />,
                    run: () => exportDataDictionary(catalog, "csv", appConfig.modelName),
                },
                {
                    id: "export-md",
                    label: "Export dictionary — Markdown",
                    hint: "Paste into a wiki or README",
                    keywords: "download markdown docs data dictionary",
                    icon: <FileText className="icon-size-100" strokeWidth={2} />,
                    run: () => exportDataDictionary(catalog, "md", appConfig.modelName),
                },
            );
        }
        acts.push(
            {
                id: "copy-link",
                label: "Copy link to this view",
                hint: "Shareable deep-link",
                keywords: "share url bookmark",
                icon: <Link2 className="icon-size-100" strokeWidth={2} />,
                run: () => {
                    void navigator.clipboard?.writeText(window.location.href).catch(() => {});
                },
            },
            {
                id: "toggle-theme",
                label: "Toggle light / dark",
                hint: "Switch appearance",
                keywords: "theme dark light mode appearance",
                icon: <SunMoon className="icon-size-100" strokeWidth={2} />,
                run: toggleTheme,
            },
            {
                id: "go-home",
                label: "Go home",
                hint: "Back to the landing",
                keywords: "reset clear start over",
                icon: <Home className="icon-size-100" strokeWidth={2} />,
                run: resetUrl,
            },
        );
        return acts;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog, toggleTheme]);

    // ---- Landing ↔ workspace (single return so the two crossfade) --------
    return (
        <div className="relative flex h-full flex-col">
            {mode === "demo" ? <DemoBanner /> : null}
            {/*
              popLayout (not "wait") keeps the outgoing view mounted while the
              incoming one takes its place, so the focused search input is never
              torn out of the DOM mid-transition — otherwise the ~120ms exit
              animation swallows the first keystrokes typed on the landing hero.
              The exiting view is popped out of flow (no layout jump); domMax is
              loaded in root.tsx so the projection this needs is available.
            */}
            <AnimatePresence mode="popLayout" initial={false}>
            {isLanding ? (
                <m.div
                    key="landing"
                    variants={viewFade}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="relative flex-1 min-h-0"
                >
                    <div className="absolute right-xl top-l z-10 flex items-center gap-s">
                        <ModeChip
                            mode={mode}
                            modelConfigured={modelConfigured}
                            modelName={appConfig.modelName}
                        />
                        <PaletteTriggerButton onClick={() => setPaletteOpen(true)} />
                        <ThemeToggle />
                    </div>
                    {error ? (
                        <div className="mx-auto mt-xl max-w-md rounded-2xl border border-destructive/40 bg-destructive/10 p-l text-300">
                            <p className="font-semibold text-destructive">Couldn&apos;t load the model.</p>
                            <p className="mt-xs text-muted-foreground">{error.message}</p>
                        </div>
                    ) : (
                        <CalmLanding
                            catalog={catalog}
                            query={query}
                            onQueryChange={setQuery}
                            onSelect={setSelectedKey}
                            onSubmit={() => setSelectedKey(undefined)}
                            onOpenTheme={enterTheme}
                            tools={
                                catalog ? (
                                    <div className="flex flex-wrap items-center justify-center gap-s">
                                        <span className="text-100 text-muted-foreground">Explore the model:</span>
                                        <Pressable
                                            onClick={() => openTool("health")}
                                            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
                                        >
                                            <ShieldCheck className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                                            Model health
                                        </Pressable>
                                        <Pressable
                                            onClick={() => openTool("pathfinder")}
                                            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
                                        >
                                            <Route className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                                            Path finder
                                        </Pressable>
                                        <Pressable
                                            onClick={() => openImpact()}
                                            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
                                        >
                                            <Waypoints className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                                            Impact analysis
                                        </Pressable>
                                    </div>
                                ) : undefined
                            }
                        />
                    )}
                </m.div>
            ) : (
                <m.div
                    key="workspace"
                    variants={viewFade}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <m.header
                        variants={fadeUp}
                        initial="hidden"
                        animate="show"
                        // Below lg: two rows — chrome on row 1, full-width search on row 2 (search stays
                        // the hero on phones + tablets). lg+ restores the original single-row grid exactly.
                        className="divider-fade-b grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-m gap-y-s px-l py-m lg:grid-cols-[auto_1fr_auto] lg:grid-rows-1 lg:gap-y-0 lg:px-xl"
                    >
                        <Pressable
                            onClick={goHome}
                            className="col-start-1 row-start-1 flex shrink-0 items-center gap-s rounded-lg py-xs pr-s text-left hover:opacity-80"
                            aria-label="Back to home"
                        >
                            <span className="grid h-[34px] w-[34px] place-items-center rounded-xl bg-primary/12 text-primary shadow-[var(--glow)]" aria-hidden>
                                <Compass className="icon-size-300" strokeWidth={1.75} />
                            </span>
                            <span className="hidden text-300 font-semibold text-foreground sm:block">{appConfig.shortName}</span>
                        </Pressable>

                        <div className="relative col-span-2 row-start-2 w-full min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mx-auto lg:max-w-[44rem]">
                            <SearchField
                                catalog={catalog}
                                query={query}
                                size="lg"
                                autoFocus={isSearching && !selectedKey}
                                onQueryChange={handleSearchInput}
                                onSelect={setSelectedKey}
                                onSubmit={() => setSelectedKey(undefined)}
                                placeholder={"Search a measure, dimension, or value \u2014 e.g. a product name"}
                            />
                        </div>

                        <div className="col-start-2 row-start-1 flex shrink-0 items-center justify-self-end gap-s lg:col-start-3">
                            {/* Two-row header until lg means the chrome row has room: show the compact
                                ModeChip from sm, and Export/Copy-link from md. Below those, they live in the ⌘ palette. */}
                            <div className="hidden items-center gap-s sm:flex">
                                <ModeChip
                                    mode={mode}
                                    modelConfigured={modelConfigured}
                                    modelName={appConfig.modelName}
                                />
                            </div>
                            <div className="hidden items-center gap-s md:flex">
                                {catalog ? <ExportMenu catalog={catalog} modelName={appConfig.modelName} /> : null}
                                <CopyLinkButton />
                            </div>
                            <PaletteTriggerButton onClick={() => setPaletteOpen(true)} />
                            <ThemeToggle />
                        </div>
                    </m.header>

                    <AnimatePresence mode="wait" initial={false}>
                    {tool && catalog ? (
                        <m.div
                            key={`tool:${tool}`}
                            variants={viewFade}
                            initial="hidden"
                            animate="show"
                            exit="exit"
                            className="flex min-h-0 flex-1 flex-col"
                        >
                        <Suspense
                            fallback={
                                <div
                                    className="grid min-h-0 flex-1 place-items-center py-2xl text-200 text-muted-foreground"
                                    role="status"
                                    aria-live="polite"
                                >
                                    <span className="animate-pulse">Loading…</span>
                                </div>
                            }
                        >
                            {tool === "health" ? <HealthView catalog={catalog} onExit={closeTool} /> : null}
                            {tool === "pathfinder" ? (
                                <PathFinderView
                                    catalog={catalog}
                                    onExit={closeTool}
                                    initialFrom={pfFrom}
                                    initialTo={pfTo}
                                    onSelectPath={(f, t) => patch({ pfFrom: f, pfTo: t })}
                                />
                            ) : null}
                            {tool === "impact" ? (
                                <ImpactView
                                    catalog={catalog}
                                    onExit={closeTool}
                                    initialKey={impactKey}
                                    onSelectRoot={(k) => patch({ impactKey: k })}
                                    onNavigate={setSelectedKey}
                                />
                            ) : null}
                        </Suspense>
                        </m.div>
                    ) : (
                    <m.div
                        key="content"
                        variants={viewFade}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="grid min-h-0 flex-1 grid-cols-1 gap-l p-xl lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
                    >
                        {/* Results / browse — hidden on phones when a detail is open (master→detail).
                            Keyed on the resolved `selected`, not raw `selectedKey`, so a stale/unresolved
                            deep-link keeps the list visible on phones instead of stranding the user. */}
                        <div className={`min-h-0 flex-col gap-m ${selected ? "hidden lg:flex" : "flex"}`}>
                            <div className="flex flex-wrap items-center gap-s">
                                {browseTopic || browseThemeId ? (
                                    <Pressable
                                        onClick={exitBrowse}
                                        className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground hover:bg-accent"
                                    >
                                        <ArrowLeft className="icon-size-100" strokeWidth={2} aria-hidden /> All areas
                                    </Pressable>
                                ) : (
                                    FILTERS.map((f) => (
                                        <Pressable
                                            key={f.id}
                                            onClick={() => setFilter(f.id)}
                                            className={`rounded-full border px-l py-xs text-200 font-medium transition-colors ${
                                                filter === f.id
                                                    ? "border-primary bg-primary text-primary-foreground shadow-[var(--glow)]"
                                                    : "border-border bg-card text-foreground hover:bg-accent"
                                            }`}
                                        >
                                            {f.label}
                                        </Pressable>
                                    ))
                                )}
                                <span className="ml-auto text-100 text-muted-foreground">{resultSummary}</span>
                            </div>

                            <div className="flex min-h-0 flex-col gap-l overflow-y-auto pr-xs">
                                {!hasResults ? (
                                    <div className="flex flex-col items-center rounded-2xl border border-border bg-card p-xl text-center">
                                        <SearchX className="icon-size-500 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                                        <p className="mt-s text-400 text-foreground">No matches — try a different term.</p>
                                        <p className="mt-xs text-200 text-muted-foreground">
                                            Try business words like &quot;revenue&quot;, &quot;units&quot;, or a product name.
                                        </p>
                                    </div>
                                ) : null}

                                {valueMatches.length ? (
                                    <m.div variants={listContainer} initial="hidden" animate="show" className="flex flex-col gap-s">
                                        {valueMatches.map((vm) => (
                                            <ValueMatchCard key={vm.columnKey} match={vm} query={query} onOpen={setSelectedKey} />
                                        ))}
                                    </m.div>
                                ) : null}

                                {groups.map((g) => (
                                    <m.div key={g.title} variants={listContainer} initial="hidden" animate="show">
                                        <ResultGroup title={g.title} count={g.rows.length}>
                                            {g.rows.map((row) => (
                                                <ResultRow
                                                    key={row.key}
                                                    row={row}
                                                    active={row.key === selectedKey}
                                                    onSelect={setSelectedKey}
                                                />
                                            ))}
                                        </ResultGroup>
                                    </m.div>
                                ))}

                                {familySections.map((s) => (
                                    <m.div key={s.title} variants={listContainer} initial="hidden" animate="show">
                                        <ResultGroup title={s.title} count={familyRowCount(s.families)}>
                                            {s.families.map((fam) => (
                                                <FamilyResultRow
                                                    key={fam.key}
                                                    group={fam}
                                                    activeKey={selectedKey}
                                                    onSelect={setSelectedKey}
                                                />
                                            ))}
                                        </ResultGroup>
                                    </m.div>
                                ))}
                            </div>
                        </div>

                        {/* Detail — on phones, only shown when something actually resolves (no empty placeholder). */}
                        <div className={`min-h-0 ${selected || browseThemeId || browseTopic ? "block" : "hidden lg:block"}`}>
                            <AnimatePresence mode="wait">
                                {selected && catalog ? (
                                    <Suspense
                                        key="detail"
                                        fallback={
                                            <div
                                                className="grid h-full place-items-center py-2xl text-200 text-muted-foreground"
                                                role="status"
                                                aria-live="polite"
                                            >
                                                <span className="animate-pulse">Opening…</span>
                                            </div>
                                        }
                                    >
                                        <EntityDetailShell
                                            entity={deferredSelected ?? selected}
                                            catalog={catalog}
                                            onClose={() => setSelectedKey(undefined)}
                                            onNavigate={setSelectedKey}
                                            onOpenImpact={openImpact}
                                        />
                                    </Suspense>
                                ) : browseThemeId && resolveTheme(browseThemeId) && catalog ? (
                                    <ThemeOverview
                                        key={`theme:${browseThemeId}`}
                                        catalog={catalog}
                                        def={resolveTheme(browseThemeId)!}
                                        onSelect={setSelectedKey}
                                    />
                                ) : browseTopic && catalog ? (
                                    <AreaOverview
                                        key={`area:${browseTopic}`}
                                        catalog={catalog}
                                        topic={browseTopic}
                                        onSelect={setSelectedKey}
                                        onNavigate={setSelectedKey}
                                    />
                                ) : (
                                    <m.div
                                        key="empty"
                                        variants={fadeUp}
                                        initial="hidden"
                                        animate="show"
                                        className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-xl text-center"
                                    >
                                        <MousePointerClick className="icon-size-700 text-primary/70" strokeWidth={1.25} aria-hidden />
                                        <p className="mt-m text-400 font-semibold text-foreground">Pick something from the list</p>
                                        <p className="mt-xs max-w-md text-200 text-muted-foreground">
                                            Select a measure to see what it means, what it&apos;s built from, how to slice it,
                                            and the questions it can answer — no DAX required.
                                        </p>
                                    </m.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </m.div>
                    )}
                    </AnimatePresence>
                </m.div>
            )}
            </AnimatePresence>
            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                catalog={catalog}
                actions={paletteActions}
                onOpenEntity={setSelectedKey}
            />
        </div>
    );
}
