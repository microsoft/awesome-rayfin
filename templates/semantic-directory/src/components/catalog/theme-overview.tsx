//-----------------------------------------------------------------------
// Semantic Directory — theme overview (right pane, never blank).
//
// The populated fallback shown when a business-area theme is open but nothing
// is selected. Orients the user in the area: what it's for, the fields you can
// slice by (click to inspect), and the metrics that break down by them — so a
// theme is a starting point, never a dead end. All derived from the model.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import { m } from "framer-motion";
import { Layers } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { fadeUp } from "@/lib/motion";
import { themeFields, themeMeasures } from "@/catalog/browse/theme-cards";
import type { ThemeDef } from "@/catalog/browse/theme-registry";
import { Pill } from "./panel-ui";
import { Pressable } from "@/components/ui/pressable";

export function ThemeOverview({
    catalog,
    def,
    onSelect,
}: {
    catalog: CatalogModel;
    def: ThemeDef;
    onSelect: (key: string) => void;
}) {
    const { fields, measures } = useMemo(
        () => ({
            fields: themeFields(catalog, def).slice(0, 10),
            measures: themeMeasures(catalog, def).slice(0, 6),
        }),
        [catalog, def],
    );

    return (
        <m.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="flex h-full flex-col gap-l overflow-y-auto rounded-2xl border border-border bg-card p-xl shadow-[var(--e2)]"
        >
            <div className="flex items-start gap-m">
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/12 text-500 shadow-[var(--glow)]">
                    {def.emoji}
                </span>
                <div>
                    <h2 className="text-hero-700 font-semibold leading-hero-700 text-foreground">{def.label}</h2>
                    <p className="text-200 text-muted-foreground">{def.blurb}</p>
                </div>
            </div>

            <div className="flex flex-col gap-xs">
                <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Slice by these fields</p>
                <div className="flex flex-wrap gap-s">
                    {fields.map((f) => (
                        <Pill key={f.key} tone="column" onClick={() => onSelect(f.key)}>
                            {f.emoji ? <span aria-hidden>{f.emoji}</span> : null}
                            {f.displayName}
                        </Pill>
                    ))}
                </div>
            </div>

            {measures.length ? (
                <div className="flex flex-col gap-xs">
                    <p className="flex items-center gap-xs text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                        <Layers className="icon-size-100 text-primary" strokeWidth={2} aria-hidden />
                        Metrics you can break down here
                    </p>
                    <ul className="flex flex-col gap-s">
                        {measures.map((mm) => (
                            <li key={mm.key}>
                                <Pressable
                                    variant="card"
                                    onClick={() => onSelect(mm.key)}
                                    className="flex w-full items-center gap-s rounded-xl border border-border bg-secondary px-m py-s text-left transition-colors hover:border-primary/40 hover:bg-accent"
                                >
                                    {mm.emoji ? <span aria-hidden>{mm.emoji}</span> : null}
                                    <span className="min-w-0 flex-1 truncate text-200 font-medium text-foreground">
                                        {mm.displayName}
                                    </span>
                                </Pressable>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </m.div>
    );
}
