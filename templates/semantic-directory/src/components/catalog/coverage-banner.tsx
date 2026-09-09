//-----------------------------------------------------------------------
// Semantic Directory — coverage / health banner.
//
// Surfaces the live vs. curated picture: how many measures/tables the model
// exposes, how much of it has friendly descriptions, and a refresh control so
// users always know the catalog reflects the live model.
//-----------------------------------------------------------------------

import type { Coverage } from "@/catalog/model/types";
import { Pressable } from "@/components/ui/pressable";

interface CoverageBannerProps {
    coverage: Coverage;
    snapshotAt: string;
    onRefresh: () => void;
    isRefreshing: boolean;
}

function pct(part: number, whole: number): number {
    return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="flex flex-col">
            <span className="font-numeric text-500 leading-500 text-foreground">
                {value}
            </span>
            <span className="text-200 text-muted-foreground">{label}</span>
            {hint ? <span className="text-100 text-muted-foreground">{hint}</span> : null}
        </div>
    );
}

export function CoverageBanner({
    coverage,
    snapshotAt,
    onRefresh,
    isRefreshing,
}: CoverageBannerProps) {
    const describedPct = pct(coverage.measureEnriched, coverage.measureVisible);
    const snapshot = new Date(snapshotAt).toLocaleString();

    return (
        <div className="rounded-2xl border border-border bg-card p-l">
            <div className="flex flex-wrap items-center justify-between gap-l">
                <div className="flex flex-wrap gap-xxl">
                    <Stat label="Measures" value={String(coverage.measureVisible)} hint="visible" />
                    <Stat label="Tables" value={String(coverage.tableVisible)} hint="visible" />
                    <Stat label="Relationships" value={String(coverage.relationshipCount)} />
                    <Stat
                        label="Described"
                        value={`${describedPct}%`}
                        hint={`${coverage.measureEnriched} of ${coverage.measureVisible}`}
                    />
                </div>
                <div className="flex flex-col items-end gap-xs">
                    <Pressable
                        variant="control"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="rounded-lg bg-primary px-l py-s text-300 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-[var(--disabled-opacity)]"
                    >
                        {isRefreshing ? "Refreshing…" : "Refresh from model"}
                    </Pressable>
                    <span className="text-100 text-muted-foreground">
                        Live snapshot · {snapshot}
                    </span>
                </div>
            </div>
            {coverage.measureVisible - coverage.measureEnriched > 0 ? (
                <p className="mt-m text-200 text-muted-foreground">
                    {coverage.measureVisible - coverage.measureEnriched} measures don&apos;t yet have a
                    plain-English description — they still appear in search, flagged so we can fill
                    them in.
                </p>
            ) : null}
        </div>
    );
}
