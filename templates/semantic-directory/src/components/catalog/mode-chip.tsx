//-----------------------------------------------------------------------
// Semantic Directory — Demo / Live status chip.
//
// A small, honest status pill for the workspace header. It reflects the
// three real states the app can be in — purely from configuration and the
// live-introspection result, never a health probe:
//
//   • Live       — a configured model was introspected and is the source of
//                  truth right now (mode === "live").
//   • Demo (dot amber) — a real model IS wired into fabric.yaml, but the app
//                  is showing the bundled demo (running outside the Fabric
//                  embed, or the live model was briefly unreachable).
//   • Demo (dot primary) — no model configured yet; the bundled sample model.
//
// The visible label is just "Live" / "Demo"; the dot colour + tooltip carry
// the nuance so the pill stays calm. Deterministic — derived from configuration
// and the introspection result only.
//-----------------------------------------------------------------------

import type { CatalogMode } from "@/hooks/use-catalog-metadata";

interface ModeChipProps {
    /** "demo" until a live model has been introspected, then "live". */
    mode: CatalogMode;
    /** True when fabric.yaml points at a real workspace + semantic model. */
    modelConfigured: boolean;
    /** Display name of the connected model, when known (for the live tooltip). */
    modelName?: string;
}

type Tone = "live" | "configured" | "demo";

const DOT_TONE: Record<Tone, string> = {
    live: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]",
    configured: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.16)]",
    demo: "bg-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_16%,transparent)]",
};

export function ModeChip({ mode, modelConfigured, modelName }: ModeChipProps) {
    const tone: Tone = mode === "live" ? "live" : modelConfigured ? "configured" : "demo";
    const label = mode === "live" ? "Live" : "Demo";

    const name = modelName?.trim();
    const title =
        tone === "live"
            ? `Live — introspecting ${name || "your semantic model"} directly.`
            : tone === "configured"
              ? "Model configured — showing sample data until the live model is available here."
              : "Sample model — connect your Fabric workspace + semantic model to go live.";

    return (
        <span
            role="img"
            title={title}
            aria-label={`${label} mode. ${title}`}
            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)]"
        >
            <span
                aria-hidden
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${DOT_TONE[tone]} ${
                    tone === "live" ? "motion-safe:animate-pulse" : ""
                }`}
            />
            <span>{label}</span>
        </span>
    );
}
