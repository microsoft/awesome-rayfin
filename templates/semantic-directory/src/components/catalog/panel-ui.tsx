//-----------------------------------------------------------------------
// Semantic Directory — shared detail-panel primitives.
//
// Small building blocks (animated sections, pills, chips) used across the
// Measure DNA / lineage / family surfaces so every panel feels like one
// product. Motion comes from the shared vocabulary in lib/motion.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { sectionReveal, tap } from "@/lib/motion";

export function Section({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <m.section variants={sectionReveal} className="border-t border-border pt-l">
            <div className="mb-s flex items-baseline gap-s">
                <h3 className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">
                    {title}
                </h3>
                {hint ? <span className="text-100 text-muted-foreground">{hint}</span> : null}
            </div>
            {children}
        </m.section>
    );
}

export function Pill({
    children,
    onClick,
    tone = "neutral",
    title,
}: {
    children: React.ReactNode;
    onClick?: () => void;
    tone?: "neutral" | "measure" | "column" | "table";
    title?: string;
}) {
    const toneCls =
        tone === "measure"
            ? "border-[color:var(--hue-measure)]/30 bg-[var(--hue-measure-soft)] text-foreground"
            : tone === "column"
                ? "border-[color:var(--hue-column)]/30 bg-[var(--hue-column-soft)] text-foreground"
                : tone === "table"
                    ? "border-[color:var(--hue-table)]/30 bg-[var(--hue-table-soft)] text-foreground"
                    : "border-border bg-secondary text-foreground";
    const base = `inline-flex items-center gap-xs rounded-full border px-m py-xs text-200 ${toneCls}`;
    if (!onClick) return <span className={base} title={title}>{children}</span>;
    return (
        <m.button
            type="button"
            onClick={onClick}
            title={title}
            {...tap}
            className={`${base} transition-colors hover:border-primary/50 hover:bg-accent`}
        >
            {children}
        </m.button>
    );
}

export function StatChip({ value, label }: { value: string | number; label: string }) {
    return (
        <div className="rounded-xl border border-border bg-secondary px-m py-s">
            <div className="font-numeric tabular-nums text-500 leading-500 text-foreground">{value}</div>
            <div className="text-100 text-muted-foreground">{label}</div>
        </div>
    );
}
