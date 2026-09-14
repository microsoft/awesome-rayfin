//-----------------------------------------------------------------------
// Semantic Directory — entity detail shell (glance ↔ deep coordinator).
//
// Owns the progressive-disclosure state: a compact glance card by default,
// expanding in place to the tabbed deep view when the user asks for more. The
// shared header (name, kind, trust) stays put while the body morphs, so the
// transition reads as "the same thing, told in more detail" rather than a page
// swap. Reduced-motion friendly; height animates via layout.
//-----------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import type { CatalogModel, TableMeta } from "@/catalog/model/types";
import { panelReveal, tap } from "@/lib/motion";
import type { CatalogEntity } from "./entity-detail";
import { KindBadge, OntologyBadge } from "./kind-badge";
import { GlanceCard } from "./glance-card";
import { DeepDetail } from "./deep-detail";
import { AnswerStrip } from "./answer-strip";
import { Pressable } from "@/components/ui/pressable";

const ONTOLOGY_LABEL: Record<string, string> = {
    fact: "Fact table",
    dimension: "Dimension",
    "measure-host": "Measure home",
    bridge: "Bridge",
    security: "Security / RLS",
    operational: "Operational",
};

interface EntityDetailShellProps {
    entity: CatalogEntity;
    catalog: CatalogModel;
    onClose: () => void;
    onNavigate: (key: string) => void;
    /** Hand off to the standalone Impact tool, seeded on an entity. */
    onOpenImpact?: (key: string) => void;
}

export function EntityDetailShell({ entity, catalog, onClose, onNavigate, onOpenImpact }: EntityDetailShellProps) {
    const [isDeep, setIsDeep] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    // Accessibility: move focus into the detail when it opens, and return focus
    // to whatever opened it (the result row) when it closes — so keyboard and
    // screen-reader users aren't dumped at the top of the document. Mount-only:
    // the shell persists across item-to-item navigation.
    useEffect(() => {
        const opener = document.activeElement;
        panelRef.current?.focus({ preventScroll: true });
        return () => {
            if (opener instanceof HTMLElement && document.contains(opener)) {
                opener.focus({ preventScroll: true });
            }
        };
    }, []);
    // Shell stays mounted across item-to-item navigation (no remount), so reset
    // item-scoped view state when the entity changes. Render-phase adjustment
    // (React's official pattern) avoids the one-frame flash a useEffect would cause.
    const [lastKey, setLastKey] = useState(entity.key);
    if (entity.key !== lastKey) {
        setLastKey(entity.key);
        setIsDeep(false);
    }
    const table = entity.kind === "table" ? (entity as TableMeta) : undefined;
    const subtitle =
        entity.kind === "column" ? entity.ref : entity.kind === "measure" ? `in ${entity.table}` : "Table";

    return (
        <m.div
            ref={panelRef}
            tabIndex={-1}
            role="region"
            aria-label={`${entity.displayName} details`}
            variants={panelReveal}
            initial="hidden"
            animate="show"
            exit="exit"
            className="flex flex-col gap-l overflow-y-auto rounded-2xl border border-border bg-card p-xl shadow-[var(--e2)] focus-visible:outline-none lg:h-full"
        >
            <header className="flex items-start justify-between gap-m">
                <div className="flex items-start gap-m">
                    {entity.emoji ? <span className="text-hero-700">{entity.emoji}</span> : null}
                    <div>
                        <div className="mb-xs flex flex-wrap items-center gap-s">
                            <KindBadge kind={entity.kind} />
                            {table?.ontology ? (
                                <OntologyBadge label={ONTOLOGY_LABEL[table.ontology] ?? table.ontology} />
                            ) : null}
                        </div>
                        <h2 className="text-hero-700 font-semibold leading-hero-700 text-foreground">
                            {entity.displayName}
                        </h2>
                        <p className="text-200 text-muted-foreground">{subtitle}</p>
                    </div>
                </div>
                <Pressable
                    variant="icon"
                    onClick={onClose}
                    aria-label="Close"
                    className="rounded-lg p-s text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X className="icon-size-300" strokeWidth={2} aria-hidden />
                </Pressable>
            </header>

            <AnswerStrip entity={entity} catalog={catalog} />

            <AnimatePresence mode="wait" initial={false}>
                {isDeep ? (
                    <m.div key="deep">
                        <DeepDetail entity={entity} catalog={catalog} onNavigate={onNavigate} onOpenImpact={onOpenImpact} />
                    </m.div>
                ) : (
                    <m.div key="glance">
                        <GlanceCard entity={entity} catalog={catalog} onNavigate={onNavigate} />
                    </m.div>
                )}
            </AnimatePresence>

            <div className="pt-s lg:mt-auto">
                <m.button
                    type="button"
                    onClick={() => setIsDeep((v) => !v)}
                    {...tap}
                    aria-expanded={isDeep}
                    className="inline-flex w-full items-center justify-center gap-xs rounded-full border border-border bg-secondary px-l py-s text-200 font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
                >
                    {isDeep ? (
                        <>
                            <ChevronUp className="icon-size-200" strokeWidth={2} aria-hidden /> Back to glance
                        </>
                    ) : (
                        <>
                            <ChevronDown className="icon-size-200" strokeWidth={2} aria-hidden /> Go deeper
                        </>
                    )}
                </m.button>
            </div>
        </m.div>
    );
}
