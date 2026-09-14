//-----------------------------------------------------------------------
// Semantic Directory — family result row (collapses the "wall of measures").
//
// A area is really ~7 concepts, each with Actuals/Target/QTD/… spin-offs.
// This row shows the ONE base measure a user should read, with its variants
// tucked behind a quiet "+N variants" toggle — scan the area, don't drown in it.
//-----------------------------------------------------------------------

import { useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import type { MeasureMeta } from "@/catalog/model/types";
import type { FamilyGroup } from "@/catalog/browse/area-insights";
import { KindBadge } from "./kind-badge";
import { Pressable } from "@/components/ui/pressable";

/** The differentiating tail of a variant name vs. its family lead (e.g. "Target", "QTD"). */
function variantTag(lead: MeasureMeta, variant: MeasureMeta): string {
    const l = lead.displayName.trim();
    const v = variant.displayName.trim();
    if (v.toLowerCase().startsWith(l.toLowerCase()) && v.length > l.length) {
        return v.slice(l.length).replace(/^[\s·|:–-]+/, "").trim() || v;
    }
    const words = v.split(/\s+/);
    return words.slice(-2).join(" ");
}

function MeasureButton({
    measure,
    active,
    onSelect,
    dense,
}: {
    measure: MeasureMeta;
    active: boolean;
    onSelect: (key: string) => void;
    dense?: boolean;
}) {
    return (
        <Pressable
            variant="card"
            onClick={() => onSelect(measure.key)}
            className={`flex w-full items-start gap-m rounded-xl border px-m text-left transition-colors ${
                dense ? "py-xs" : "py-s"
            } ${active ? "border-primary bg-accent" : "border-border bg-card hover:bg-accent"}`}
        >
            <span className={`mt-xxs ${dense ? "text-300" : "text-500"}`} aria-hidden>
                {dense ? "↳" : measure.emoji ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-s">
                    <span className={`truncate font-semibold text-foreground ${dense ? "text-200" : "text-300"}`}>
                        {measure.displayName}
                    </span>
                    {!dense ? <KindBadge kind="measure" /> : null}
                    {measure.kind === "measure" && !measure.description ? (
                        <span className="rounded-full bg-destructive/15 px-s py-xxs text-100 font-semibold text-destructive">
                            needs description
                        </span>
                    ) : null}
                </span>
                {!dense && measure.description ? (
                    <span className="mt-xxs block line-clamp-2 text-200 text-muted-foreground">
                        {measure.description}
                    </span>
                ) : null}
            </span>
        </Pressable>
    );
}

export function FamilyResultRow({
    group,
    activeKey,
    onSelect,
}: {
    group: FamilyGroup;
    activeKey?: string;
    onSelect: (key: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const hasVariants = group.variants.length > 0;
    const activeInVariants = group.variants.some((v) => v.key === activeKey);
    const expanded = open || activeInVariants;

    const previewTags = hasVariants
        ? group.variants.slice(0, 4).map((v) => ({ key: v.key, tag: variantTag(group.lead, v) }))
        : [];
    const extraCount = group.variants.length - previewTags.length;

    return (
        <div className="flex flex-col gap-xs">
            <div className="relative">
                <MeasureButton measure={group.lead} active={group.lead.key === activeKey} onSelect={onSelect} />
                {hasVariants ? (
                    <Pressable
                        variant="control"
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={expanded}
                        className="absolute right-s top-s inline-flex items-center gap-xs rounded-full border border-border bg-secondary px-s py-xxs text-100 font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                        <Layers className="icon-size-100" strokeWidth={2} aria-hidden />
                        {group.variants.length} variant{group.variants.length === 1 ? "" : "s"}
                        <ChevronDown
                            className={`icon-size-100 transition-transform ${expanded ? "rotate-180" : ""}`}
                            strokeWidth={2}
                            aria-hidden
                        />
                    </Pressable>
                ) : null}
            </div>

            {hasVariants && !expanded ? (
                <div className="flex flex-wrap items-center gap-xs pl-[2.6rem]">
                    {previewTags.map((p) => (
                        <Pressable
                            key={p.key}
                            variant="control"
                            onClick={() => onSelect(p.key)}
                            className="rounded-md bg-secondary/60 px-s py-xxs text-100 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            {p.tag}
                        </Pressable>
                    ))}
                    {extraCount > 0 ? (
                        <span className="text-100 text-muted-foreground">+{extraCount} more</span>
                    ) : null}
                </div>
            ) : null}

            <AnimatePresence initial={false}>
                {expanded && hasVariants ? (
                    <m.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                    >
                        <div className="flex flex-col gap-xs border-l border-border pl-m">
                            {group.variants.map((v) => (
                                <MeasureButton key={v.key} measure={v} active={v.key === activeKey} onSelect={onSelect} dense />
                            ))}
                        </div>
                    </m.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
