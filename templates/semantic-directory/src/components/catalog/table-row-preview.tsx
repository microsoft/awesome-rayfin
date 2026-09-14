//-----------------------------------------------------------------------
// Semantic Directory — table row preview.
//
// A compact, horizontally-scrollable peek at real rows of a table so users can
// see what the data actually looks like (the pivot-source glance). Loads live;
// degrades to a quiet note offline. Column headers use friendly display names;
// values are shown verbatim from the model. Deterministic — no AI.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import type { ColumnMeta } from "@/catalog/model/types";
import { useTableSample } from "@/hooks/use-table-sample";

function cellText(v: unknown): string {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return new Intl.NumberFormat("en-US").format(v);
    return String(v);
}

export function TableRowPreview({
    tableName,
    columns,
}: {
    /** Technical table name to sample. */
    tableName: string;
    /** Visible columns of the table, in model order. */
    columns: ColumnMeta[];
}) {
    const names = useMemo(() => columns.map((c) => c.name), [columns]);
    const labels = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of columns) map.set(c.name, c.displayName);
        return map;
    }, [columns]);

    const sample = useTableSample(tableName, names, columns.length);

    if (sample.status === "idle" || sample.status === "error") {
        return (
            <p className="mt-s min-h-[6rem] text-100 text-muted-foreground sm:min-h-[13rem]">
                Sample rows appear here when the app is running live in Fabric.
            </p>
        );
    }

    if (sample.status === "empty") {
        return <p className="mt-s min-h-[13rem] text-100 text-muted-foreground">This table has no rows to preview.</p>;
    }

    const cols = sample.columns;

    return (
        <div className="mt-s min-h-[13rem]">
            <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-100">
                    <thead>
                        <tr className="bg-secondary/60 text-left text-muted-foreground">
                            {cols.map((c) => (
                                <th
                                    key={c}
                                    className="whitespace-nowrap border-b border-border px-m py-xs font-semibold"
                                >
                                    {labels.get(c) ?? c}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sample.status === "loading"
                            ? Array.from({ length: 4 }).map((_, r) => (
                                  <tr key={r} className="border-b border-border/60 last:border-0">
                                      {cols.map((c) => (
                                          <td key={c} className="px-m py-xs">
                                              <span className="inline-block h-3 w-16 animate-pulse rounded bg-secondary" />
                                          </td>
                                      ))}
                                  </tr>
                              ))
                            : sample.rows.map((row, r) => (
                                  <tr key={r} className="border-b border-border/60 last:border-0 hover:bg-secondary/30">
                                      {cols.map((c) => (
                                          <td
                                              key={c}
                                              className="max-w-[220px] truncate whitespace-nowrap px-m py-xs tabular-nums text-foreground"
                                              title={cellText(row[c])}
                                          >
                                              {cellText(row[c])}
                                          </td>
                                      ))}
                                  </tr>
                              ))}
                    </tbody>
                </table>
            </div>
            {sample.status === "ready" ? (
                <p className="mt-xs text-100 text-muted-foreground">
                    Sample of {sample.rows.length} live row{sample.rows.length === 1 ? "" : "s"}
                    {sample.truncatedColumns ? ` · first ${cols.length} columns` : ""}
                </p>
            ) : null}
        </div>
    );
}
