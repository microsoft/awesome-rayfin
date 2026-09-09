//-----------------------------------------------------------------------
// Semantic Directory — trust / confidence / freshness badges.
//
// Small, consistent chips that put the "can I trust this number" signal in
// front of users everywhere: on cards, in the DNA panel, and on the
// model-level banner. Backed by real evidence (source reconciliation pass
// rates + load freshness) from the catalog — see model/trust.ts.
//-----------------------------------------------------------------------

import { ShieldCheck, ShieldAlert, ShieldQuestion, Clock } from "lucide-react";
import type { Confidence, TrustSignal } from "@/catalog/model/types";

const LEVEL = {
    high: {
        label: "Trusted",
        cls: "border-[color:var(--trust-high-border)] bg-[color:var(--trust-high-bg)] text-[color:var(--trust-high-fg)]",
        Icon: ShieldCheck,
    },
    watch: {
        label: "Watch",
        cls: "border-[color:var(--trust-watch-border)] bg-[color:var(--trust-watch-bg)] text-[color:var(--trust-watch-fg)]",
        Icon: ShieldAlert,
    },
    low: {
        label: "Verify at source",
        cls: "border-[color:var(--trust-low-border)] bg-[color:var(--trust-low-bg)] text-[color:var(--trust-low-fg)]",
        Icon: ShieldAlert,
    },
    unknown: {
        label: "No signal",
        cls: "border-border bg-secondary text-muted-foreground",
        Icon: ShieldQuestion,
    },
} as const;

function relativeDays(iso?: string): string | undefined {
    if (!iso) return undefined;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return undefined;
    const days = Math.round((Date.now() - then) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    return `${months}mo ago`;
}

export function TrustBadge({
    trust,
    size = "sm",
    showNote = false,
}: {
    trust: TrustSignal | undefined;
    size?: "sm" | "md";
    showNote?: boolean;
}) {
    const level = trust?.level ?? "unknown";
    const { label, cls, Icon } = LEVEL[level];
    const pad = size === "md" ? "px-m py-xs text-200" : "px-s py-xxs text-100";
    const qa = trust?.qaPassRate != null ? ` · ${Math.round(trust.qaPassRate * 100)}%` : "";
    return (
        <span
            title={trust?.note ?? label}
            className={`inline-flex items-center gap-xs rounded-full border font-semibold ${pad} ${cls}`}
        >
            <Icon className="icon-size-100" strokeWidth={2} aria-hidden />
            {label}
            {showNote ? qa : null}
        </span>
    );
}

export function FreshnessChip({ iso }: { iso?: string }) {
    const rel = relativeDays(iso);
    if (!rel) return null;
    return (
        <span className="inline-flex items-center gap-xs rounded-full border border-border bg-secondary px-s py-xxs text-100 text-muted-foreground">
            <Clock className="icon-size-100" strokeWidth={2} aria-hidden />
            Loaded {rel}
        </span>
    );
}

const CONFIDENCE_CLS: Record<Confidence, string> = {
    confirmed: "border-[color:var(--trust-high-border)] bg-[color:var(--trust-high-bg)] text-[color:var(--trust-high-fg)]",
    standard: "border-primary/30 bg-primary/10 text-primary",
    inferred: "border-[color:var(--trust-watch-border)] bg-[color:var(--trust-watch-bg)] text-[color:var(--trust-watch-fg)]",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
    confirmed: "Confirmed",
    standard: "Industry-standard",
    inferred: "Inferred · SME-pending",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-s py-xxs text-100 font-semibold ${CONFIDENCE_CLS[confidence]}`}
        >
            {CONFIDENCE_LABEL[confidence]}
        </span>
    );
}
