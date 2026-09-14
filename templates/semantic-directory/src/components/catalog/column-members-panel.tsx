//-----------------------------------------------------------------------
// Semantic Directory — "What's inside this field" members panel.
//
// The pivot-table-field experience for users: open a dimension and see
// its actual members (Weekday → Mon…Sun) in the model's business order. Honesty
// is the whole point — a capped list is always labelled "first N of M", blanks
// are counted separately, and the sort basis is stated, so nobody mistakes a
// truncated view for the complete set. Reads its verdict from useColumnMembers.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ColumnMeta } from "@/catalog/model/types";
import { useColumnMembers } from "@/hooks/use-column-members";
import { Pill } from "./panel-ui";

function Label({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex items-center text-100 font-semibold uppercase tracking-wide text-muted-foreground">
            {children}
        </p>
    );
}

function LiveBadge() {
    return (
        <span className="ml-s inline-flex items-center gap-[3px] rounded-full border border-[color:var(--hue-column)]/30 bg-[var(--hue-column-soft)] px-s py-[1px] text-100 font-medium text-foreground">
            <span className="size-[6px] rounded-full bg-[color:var(--hue-column)]" aria-hidden />
            live
        </span>
    );
}

const nf = new Intl.NumberFormat();

/**
 * Never mount the full 500-member set at once — flex-wrapped variable-width
 * chips can't be windowed cleanly, so cap the live DOM and steer users to the
 * filter. Honest by design: the overflow count is always shown.
 */
const RENDER_CAP = 150;

export function ColumnMembersPanel({ column }: { column: ColumnMeta }) {
    const state = useColumnMembers(column);
    const [filter, setFilter] = useState("");

    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return state.values;
        return state.values.filter((m) => m.value.toLowerCase().includes(q));
    }, [state.values, filter]);

    const visible = shown.length > RENDER_CAP ? shown.slice(0, RENDER_CAP) : shown;
    const overflow = shown.length - visible.length;

    if (state.mode === "suppressed" || state.mode === "empty") {
        return (
            <div className="mt-s flex flex-col gap-xs">
                <Label>What&rsquo;s inside</Label>
                <p className="text-200 text-muted-foreground">
                    {state.reason ?? "No members to show."}
                </p>
            </div>
        );
    }

    const sortBasis = state.ordered
        ? "in model order"
        : state.ranged
            ? "in numeric order"
            : "A\u2013Z";

    const countLine =
        state.mode === "range"
            ? `${nf.format(state.distinctCount ?? 0)} distinct values`
            : state.complete
                ? `${nf.format(state.distinctCount ?? state.values.length)} member${(state.distinctCount ?? state.values.length) === 1 ? "" : "s"} \u00b7 complete list`
                : `Showing first ${nf.format(state.values.length)} of ${nf.format(state.distinctCount ?? 0)}`;

    return (
        <div className="mt-s flex flex-col gap-s">
            <Label>
                What&rsquo;s inside this field
                <LiveBadge />
            </Label>

            <p className="text-100 text-muted-foreground">
                {countLine}
                {state.mode !== "range" ? <> &middot; {sortBasis}</> : null}
                {state.blankCount ? <> &middot; {nf.format(state.blankCount)} blank</> : null}
            </p>

            {state.rowCount ? (
                <p className="text-100 text-muted-foreground">
                    {nf.format(state.rowCount)} rows
                    {typeof state.blankRows === "number" ? (
                        <>
                            {" "}&middot;{" "}
                            {Math.round(
                                ((state.rowCount - state.blankRows) / state.rowCount) * 100,
                            )}
                            % populated
                        </>
                    ) : null}
                </p>
            ) : null}

            {state.mode === "loading" ? (
                state.values.length ? (
                    <div className="flex flex-wrap gap-s opacity-60">
                        {state.values.slice(0, 24).map((m) => (
                            <Pill key={m.value} tone="column">{m.value}</Pill>
                        ))}
                    </div>
                ) : (
                    <p className="text-200 text-muted-foreground">Loading members&hellip;</p>
                )
            ) : null}

            {state.mode === "range" ? (
                <div className="flex flex-wrap items-center gap-s">
                    {state.minText && state.maxText ? (
                        <Pill tone="column" title="Range of values">
                            {state.minText} &rarr; {state.maxText}
                        </Pill>
                    ) : null}
                    <span className="text-100 text-muted-foreground">
                        Too many to list individually.
                    </span>
                </div>
            ) : null}

            {state.mode === "list" ? (
                <>
                    {state.values.length > 24 ? (
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-s top-1/2 size-[14px] -translate-y-1/2 text-muted-foreground"
                                strokeWidth={2}
                                aria-hidden
                            />
                            <input
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder={
                                    state.complete ? "Filter members" : "Filter shown values"
                                }
                                aria-label="Filter members"
                                className="w-full rounded-lg border border-border bg-secondary py-s pl-[28px] pr-m text-200 text-foreground placeholder:text-muted-foreground transition-shadow focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring)] focus:outline-none"
                            />
                        </div>
                    ) : null}

                    <div className="relative">
                        <div className="flex max-h-[220px] flex-wrap gap-s overflow-y-auto pr-xs pb-s">
                            {visible.map((m) => (
                                <Pill
                                    key={m.value}
                                    tone="column"
                                    title={m.isBlank ? "Rows with no value in this field" : m.value}
                                >
                                    {m.isBlank ? (
                                        <span className="italic text-muted-foreground">(Blank)</span>
                                    ) : (
                                        m.value
                                    )}
                                </Pill>
                            ))}
                            {overflow > 0 ? (
                                <span className="inline-flex items-center rounded-full border border-dashed border-border px-m py-xxs text-100 text-muted-foreground">
                                    +{nf.format(overflow)} more &middot; filter to narrow
                                </span>
                            ) : null}
                            {shown.length === 0 ? (
                                <span className="text-200 text-muted-foreground">
                                    No members match &ldquo;{filter}&rdquo;.
                                </span>
                            ) : null}
                        </div>
                        {shown.length > 16 ? (
                            <div
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent"
                                aria-hidden
                            />
                        ) : null}
                    </div>

                    {!state.complete ? (
                        <p className="text-100 text-muted-foreground">
                            This is a partial list &mdash; the field has more values than shown, and
                            the filter only searches what&rsquo;s displayed.
                        </p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
