//-----------------------------------------------------------------------
// Semantic Directory — result row + group used in browse and search views.
//-----------------------------------------------------------------------

import type { EntityKind } from "@/catalog/model/types";
import { highlightParts, type MatchEvidence } from "@/catalog/search/evidence";
import { KindBadge } from "./kind-badge";
import { Pressable } from "@/components/ui/pressable";

export type SignalTone = "trust" | "watch" | "info" | "danger";

export interface RowSignal {
    label: string;
    tone: SignalTone;
}

export interface RowStat {
    value: string | number;
    label: string;
}

export interface ResultRowData {
    key: string;
    kind: EntityKind;
    emoji?: string;
    title: string;
    subtitle?: string;
    description?: string;
    needsDescription?: boolean;
    signals?: RowSignal[];
    stats?: RowStat[];
    /** Query tokens to highlight in the title/subtitle/description (search only). */
    tokens?: string[];
    /** Provable reasons this row matched the query (search only). */
    evidence?: MatchEvidence[];
}

/** Render text with query-token spans wrapped in <mark> — no-op without tokens. */
function Highlight({ text, tokens }: { text: string; tokens?: string[] }) {
    if (!tokens || !tokens.length) return <>{text}</>;
    return (
        <>
            {highlightParts(text, tokens).map((p, i) =>
                p.hit ? (
                    <mark
                        key={`${i}:${p.text}`}
                        className="rounded-[3px] bg-primary/15 px-[1px] text-foreground"
                    >
                        {p.text}
                    </mark>
                ) : (
                    <span key={`${i}:${p.text}`}>{p.text}</span>
                ),
            )}
        </>
    );
}

const SIGNAL_CLASS: Record<SignalTone, string> = {
    trust: "bg-[color:var(--trust-high-bg)] text-[color:var(--trust-high-fg)]",
    watch: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    info: "bg-secondary text-muted-foreground",
    danger: "bg-destructive/15 text-destructive",
};

export function ResultRow({
    row,
    active,
    onSelect,
}: {
    row: ResultRowData;
    active: boolean;
    onSelect: (key: string) => void;
}) {
    const signals = row.signals ?? [];
    const stats = row.stats ?? [];
    const evidence = row.evidence ?? [];
    return (
        <Pressable
            variant="card"
            onClick={() => onSelect(row.key)}
            className={`flex w-full items-start gap-m rounded-xl border px-m py-s text-left transition-colors ${
                active
                    ? "border-primary bg-accent"
                    : "border-border bg-card hover:bg-accent"
            }`}
        >
            <span className="mt-xxs text-500" aria-hidden>
                {row.emoji ?? "•"}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-s">
                    <span className="truncate text-300 font-semibold text-foreground">
                        <Highlight text={row.title} tokens={row.tokens} />
                    </span>
                    <KindBadge kind={row.kind} />
                    {signals.map((s) => (
                        <span
                            key={s.label}
                            className={`rounded-full px-s py-xxs text-100 font-semibold ${SIGNAL_CLASS[s.tone]}`}
                        >
                            {s.label}
                        </span>
                    ))}
                    {row.needsDescription ? (
                        <span className="rounded-full bg-destructive/15 px-s py-xxs text-100 font-semibold text-destructive">
                            needs description
                        </span>
                    ) : null}
                </span>
                {evidence.length ? (
                    <span className="mt-xxs flex flex-wrap gap-xs">
                        {evidence.map((e) => (
                            <span
                                key={e.label}
                                className="inline-flex items-center rounded-md border border-border bg-secondary/50 px-s py-xxs text-100 font-medium text-muted-foreground"
                            >
                                {e.label}
                            </span>
                        ))}
                    </span>
                ) : null}
                {row.subtitle ? (
                    <span className="block truncate text-100 text-muted-foreground">
                        <Highlight text={row.subtitle} tokens={row.tokens} />
                    </span>
                ) : null}
                {row.description ? (
                    <span className="mt-xxs block line-clamp-2 text-200 text-muted-foreground">
                        <Highlight text={row.description} tokens={row.tokens} />
                    </span>
                ) : null}
                {stats.length ? (
                    <span className="mt-xs flex flex-wrap gap-xs">
                        {stats.map((st) => (
                            <span
                                key={st.label}
                                className="inline-flex items-baseline gap-xxs rounded-md bg-secondary/60 px-s py-xxs text-100 text-muted-foreground"
                            >
                                <span className="font-numeric font-semibold text-foreground">{st.value}</span>
                                {st.label}
                            </span>
                        ))}
                    </span>
                ) : null}
            </span>
        </Pressable>
    );
}

export function ResultGroup({
    title,
    count,
    children,
}: {
    title: string;
    count: number;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-s">
            <div className="flex items-center gap-s px-xs">
                <h3 className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">
                    {title}
                </h3>
                <span className="text-100 text-muted-foreground">{count}</span>
            </div>
            <div className="flex flex-col gap-xs">{children}</div>
        </div>
    );
}
