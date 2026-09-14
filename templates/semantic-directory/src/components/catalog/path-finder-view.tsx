//-----------------------------------------------------------------------
// Semantic Directory — Path Finder tool (full workspace view).
//
// Answers "how do these two tables relate?" Pick a source and a target table;
// the tool traces the SHORTEST active-relationship join path and shows every
// hop as a tight, scannable chain — the join columns, the cardinality as
// travelled, and whether the filter runs both ways. When more than one
// equal-length path exists it says so. Built entirely from
// INFO.VIEW.RELATIONSHIPS metadata (no AI), so it works against any model.
//
// The selection is deep-linked (pf/pt hash params) so a traced path is a
// shareable link, and it can be reversed with one control.
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import { m } from "framer-motion";
import { ArrowLeftRight, ArrowRight, Route, TriangleAlert, Unplug } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import { listContainer, sectionReveal } from "@/lib/motion";
import {
    findRelationshipPath,
    pathTableOptions,
    type PathHop,
} from "@/catalog/lineage/path-finder";
import { pathSummary } from "@/lib/copy";
import { ToolShell } from "./tool-shell";
import { Pressable } from "@/components/ui/pressable";

function TablePicker({
    id,
    label,
    value,
    options,
    onChange,
}: {
    id: string;
    label: string;
    value: string;
    options: { name: string; connected: boolean }[];
    onChange: (name: string) => void;
}) {
    return (
        <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-xs">
            <span className="text-100 font-semibold text-muted-foreground">{label}</span>
            <select
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-m py-s text-200 font-medium text-foreground shadow-[var(--e1)] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
            >
                {options.map((o) => (
                    <option key={o.name} value={o.name}>
                        {o.name}
                        {o.connected ? "" : "  · no joins"}
                    </option>
                ))}
            </select>
        </label>
    );
}

/** A table stop in the chain. */
function ChainNode({ name }: { name: string }) {
    return (
        <div className="flex items-center gap-s">
            <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full border-[color:var(--hue-table)]/40 border bg-[var(--hue-table-soft)]"
            />
            <span className="rounded-lg border-[color:var(--hue-table)]/30 border bg-[var(--hue-table-soft)] px-m py-xs text-200 font-semibold text-foreground">
                {name}
            </span>
        </div>
    );
}

/** The labelled connector between two stops: join equation + cardinality. */
function ChainEdge({ hop }: { hop: PathHop }) {
    return (
        <div className="ml-[4px] flex items-stretch gap-m border-l border-border pl-l">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-s gap-y-xs py-s">
                <span className="font-numeric text-100 tabular-nums text-muted-foreground">
                    <span className="text-foreground">{hop.fromTable}</span>[{hop.fromColumn}]
                    <span className="px-xs">=</span>
                    <span className="text-foreground">{hop.toTable}</span>[{hop.toColumn}]
                </span>
                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-s py-[1px] font-numeric text-100 tabular-nums text-foreground">
                    {hop.fromCardinality} → {hop.toCardinality}
                </span>
                {hop.bidirectional ? (
                    <span className="inline-flex items-center gap-xs rounded-full border border-primary/40 bg-primary/10 px-s py-[1px] text-100 font-medium text-primary">
                        <TriangleAlert className="icon-size-100" strokeWidth={2} aria-hidden />
                        Filters both ways
                    </span>
                ) : null}
            </div>
        </div>
    );
}

export function PathFinderView({
    catalog,
    onExit,
    initialFrom,
    initialTo,
    onSelectPath,
}: {
    catalog: CatalogModel;
    onExit: () => void;
    initialFrom?: string;
    initialTo?: string;
    onSelectPath?: (from: string, to: string) => void;
}) {
    const options = useMemo(() => pathTableOptions(catalog), [catalog]);
    const connected = useMemo(() => options.filter((o) => o.connected), [options]);

    // Selection is seeded from the deep-link and resolved to valid option names
    // at render, so a model swap (demo → live) can never leave a stale name
    // selected — no state-sync effect required.
    const [from, setFrom] = useState(initialFrom ?? "");
    const [to, setTo] = useState(initialTo ?? "");

    const has = (name: string) => options.some((o) => o.name === name);
    const resolvedFrom = has(from) ? from : connected[0]?.name ?? options[0]?.name ?? "";
    const resolvedTo = has(to)
        ? to
        : connected[1]?.name ?? connected[0]?.name ?? options[1]?.name ?? options[0]?.name ?? "";

    const selectFrom = (name: string) => {
        setFrom(name);
        onSelectPath?.(name, resolvedTo);
    };
    const selectTo = (name: string) => {
        setTo(name);
        onSelectPath?.(resolvedFrom, name);
    };
    const swap = () => {
        setFrom(resolvedTo);
        setTo(resolvedFrom);
        onSelectPath?.(resolvedTo, resolvedFrom);
    };

    const path = useMemo(
        () =>
            resolvedFrom && resolvedTo
                ? findRelationshipPath(catalog, resolvedFrom, resolvedTo)
                : null,
        [catalog, resolvedFrom, resolvedTo],
    );

    const sameTable = resolvedFrom === resolvedTo;

    // Unambiguous summary at every hop count, with alternate awareness.
    const summary = (() => {
        if (!path || path.length === 0) return "";
        const base =
            path.length === 1
                ? `Directly related · ${pathSummary(1, path.tables.length)}`
                : pathSummary(path.length, path.tables.length);
        if (path.pathCount > 1) {
            const n = path.pathCount >= 99 ? "99+" : String(path.pathCount);
            return `${base} · showing 1 of ${n} equal-length paths`;
        }
        return base;
    })();

    return (
        <ToolShell
            icon={<Route className="icon-size-300" strokeWidth={1.75} />}
            title="Path finder"
            subtitle="Trace the shortest join path between any two tables."
            onExit={onExit}
            maxWidthClass="max-w-3xl"
            headerActions={
                <Pressable
                    onClick={swap}
                    aria-label="Swap the From and To tables"
                    className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground hover:bg-accent"
                >
                    <ArrowLeftRight className="icon-size-100" strokeWidth={2} aria-hidden /> Swap
                </Pressable>
            }
            toolbar={
                <div className="flex flex-col items-stretch gap-m rounded-2xl border border-border bg-card p-l shadow-[var(--e1)] sm:flex-row sm:items-end">
                    <TablePicker id="pf-from" label="From table" value={resolvedFrom} options={options} onChange={selectFrom} />
                    <span aria-hidden className="hidden shrink-0 pb-s text-primary sm:block">
                        <ArrowRight className="icon-size-300" strokeWidth={2} />
                    </span>
                    <TablePicker id="pf-to" label="To table" value={resolvedTo} options={options} onChange={selectTo} />
                </div>
            }
        >
            <div aria-live="polite">
                {sameTable ? (
                    <EmptyState
                        icon={<Route className="icon-size-500 text-muted-foreground" strokeWidth={1.5} />}
                        title="Pick two different tables"
                        body="Choose a source and a target to see how they connect."
                    />
                ) : path && path.length > 0 ? (
                    <div className="flex flex-col gap-m">
                        <p className="text-200 text-muted-foreground">{summary}</p>
                        <m.ol
                            variants={listContainer}
                            initial="hidden"
                            animate="show"
                            className="flex flex-col"
                        >
                            {path.tables.map((table, i) => (
                                <m.li key={`${table}-${i}`} variants={sectionReveal} className="flex flex-col">
                                    <ChainNode name={table} />
                                    {i < path.hops.length ? <ChainEdge hop={path.hops[i]} /> : null}
                                </m.li>
                            ))}
                        </m.ol>
                    </div>
                ) : (
                    <EmptyState
                        icon={<Unplug className="icon-size-500 text-muted-foreground" strokeWidth={1.5} />}
                        title="No join path"
                        body="These tables aren't connected through active relationships. They may live in separate parts of the model, or join only through inactive relationships."
                    />
                )}
            </div>
        </ToolShell>
    );
}

function EmptyState({
    icon,
    title,
    body,
}: {
    icon: React.ReactNode;
    title: string;
    body: string;
}) {
    return (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card p-xl text-center">
            <span aria-hidden>{icon}</span>
            <p className="mt-s text-400 font-semibold text-foreground">{title}</p>
            <p className="mt-xs max-w-md text-200 text-muted-foreground">{body}</p>
        </div>
    );
}
