import { Fragment, useMemo, useState } from "react";
import { Sparkline, VisualFrame, TableActions, Tooltip } from "@/finance";
import type { DataTable } from "@/finance";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "@/finance";
import { Landmark } from "lucide-react";
import type { CompareKey, StatementLine, VarianceDelta } from "../lib/statement-model";
import { VARIANCE_COLOR } from "../lib/ibcs";

const COMPARE_LABEL: Record<CompareKey, string> = { BU: "Budget", FC: "Forecast", PY: "Prior Yr" };
const COMPARE_SHORT: Record<CompareKey, string> = { BU: "VTB", FC: "VTF", PY: "VTPY" };

function favColor(f: VarianceDelta["favorability"]): string {
  return VARIANCE_COLOR[f];
}

/** Variance cell with an in-cell heat bar so the eye reads magnitude without scanning digits. */
function DeltaCell({ delta, prefix, showHeat = true }: { delta: VarianceDelta | null; prefix: string; showHeat?: boolean }) {
  if (!delta) return <td className="px-2.5 py-1 text-right text-muted-foreground/40">—</td>;
  const color = favColor(delta.favorability);
  // Heat intensity: 25% variance saturates the bar; neutral rows stay quiet.
  const intensity = showHeat && delta.pct != null ? Math.min(1, Math.abs(delta.pct) / 0.25) : 0;
  return (
    <td className="relative px-2.5 py-1 text-right tabular-nums" style={{ color }}>
      {intensity > 0 ? (
        <span
          className="pointer-events-none absolute inset-y-1 right-0 rounded-sm"
          style={{ width: `${Math.max(6, intensity * 100)}%`, backgroundColor: color, opacity: 0.13 }}
          aria-hidden="true"
        />
      ) : null}
      <span className="relative inline-flex items-center justify-end gap-1.5 whitespace-nowrap font-medium">
        <span>{formatSignedCompact(delta.abs, prefix)}</span>
        {delta.pct != null ? <span className="text-[11px] opacity-70">{formatSignedPercent(delta.pct)}</span> : null}
      </span>
    </td>
  );
}

export interface FinancialStatementProps {
  title?: string;
  hint?: string;
  /** Note shown under the title (e.g. currency + as-of basis). */
  note?: string;
  lines: StatementLine[];
  compares: CompareKey[];
  valuePrefix?: string;
  /** Period labels aligning with each line's `trend` array (for a11y/tooltip). */
  trendLabels?: string[];
  classification?: string;
  frame?: boolean;
  /** Suppress the in-cell variance heat bar (e.g. balance-sheet balances aren't higher=better). */
  suppressHeat?: boolean;
  /** Raise a drill selection when a row is clicked (wires the intelligence rail). */
  onSelectLine?: (line: StatementLine) => void;
}

/**
 * Hierarchical financial statement: emphasised subtotals, indented leaf lines
 * with collapsible groups, an Actual column, a value + favourability-coloured
 * variance for each selected comparison, and a per-row trend sparkline. Reused
 * for both the P&L and (via matching props) the cash-flow presentation.
 */
export function FinancialStatement({
  title = "Income statement",
  hint,
  note,
  lines,
  compares,
  valuePrefix = "$",
  classification,
  frame = true,
  suppressHeat = false,
  onSelectLine,
}: FinancialStatementProps) {
  // A subtotal row is a collapsible group header when a level-1 line follows it.
  const groupOf = useMemo(() => {
    const map = new Map<string, string>(); // childId -> headerId
    let currentHeader: string | null = null;
    for (const l of lines) {
      if (l.kind === "subtotal" && l.level === 0) {
        currentHeader = l.id;
      } else if (l.level >= 1 && currentHeader) {
        map.set(l.id, currentHeader);
      }
    }
    return map;
  }, [lines]);

  const collapsibleHeaders = useMemo(() => new Set(groupOf.values()), [groupOf]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible = lines.filter((l) => {
    const header = groupOf.get(l.id);
    return !(header && collapsed.has(header));
  });

  const getTable = (): DataTable => ({
    columns: [
      { key: "line", label: "Line" },
      { key: "actual", label: "Actual", numeric: true },
      ...compares.flatMap((c) => [
        { key: `c_${c}`, label: COMPARE_LABEL[c], numeric: true },
        { key: `v_${c}`, label: COMPARE_SHORT[c], numeric: true },
      ]),
    ],
    rows: lines.map((l) => {
      const row: Record<string, string | number | null> = {
        line: l.label,
        actual: l.actual,
      };
      for (const c of compares) {
        row[`c_${c}`] = l.compare[c];
        row[`v_${c}`] = l.variance[c]?.abs ?? null;
      }
      return row;
    }),
  });

  const th = "sticky top-0 z-10 bg-secondary px-2.5 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
  const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

  const rowTip = (l: StatementLine) => (
    <div className="space-y-0.5">
      <div className="font-semibold">{l.label}</div>
      <div>Actual {l.actual != null ? formatCompact(l.actual, valuePrefix) : "—"}</div>
      {compares.map((c) => {
        const v = l.variance[c];
        return (
          <div key={c} className="opacity-90">
            vs {COMPARE_LABEL[c]}: {l.compare[c] != null ? formatCompact(l.compare[c] as number, valuePrefix) : "—"}
            {v ? ` (${formatSignedCompact(v.abs, valuePrefix)}${v.pct != null ? ", " + formatSignedPercent(v.pct) : ""})` : ""}
          </div>
        );
      })}
      {onSelectLine ? <div className="pt-0.5 text-[10px] opacity-70">Click to drill into the intelligence rail →</div> : null}
    </div>
  );

  const table = (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "70vh" }}>
      <table className="w-full border-collapse whitespace-nowrap text-[13px]">
        <thead>
          <tr>
            <th className={thLeft}>Line item</th>
            <th className={th}>Actual</th>
            {compares.map((c) => (
              <th key={c} className={th} colSpan={2}>
                vs {COMPARE_LABEL[c]}
              </th>
            ))}
            <th className={th}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((l, idx) => {
            const isHeader = collapsibleHeaders.has(l.id);
            const isCollapsed = collapsed.has(l.id);
            const finiteTrend = l.trend.filter((v) => Number.isFinite(v));
            const selectable = Boolean(onSelectLine);
            const rowClass = l.emphasis
              ? "border-t-2 border-border bg-secondary/40 font-semibold"
              : (idx % 2 === 1 ? "border-t border-border/40 bg-secondary/[0.04]" : "border-t border-border/40") +
                " hover:bg-primary/[0.06]";
            return (
              <tr
                key={l.id}
                className={rowClass + (selectable ? " cursor-pointer" : "")}
                onClick={selectable ? () => onSelectLine?.(l) : undefined}
                tabIndex={selectable ? 0 : undefined}
                onKeyDown={
                  selectable
                    ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectLine?.(l);
                        }
                      }
                    : undefined
                }
              >
                <td
                  className={
                    "sticky left-0 z-10 px-2.5 py-1 text-left text-foreground " +
                    (l.emphasis ? "bg-secondary/40" : "bg-card")
                  }
                  style={{ paddingLeft: 10 + l.level * 14, boxShadow: l.emphasis ? "inset 2px 0 0 var(--color-primary)" : undefined }}
                >
                  {isHeader ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(l.id);
                      }}
                      className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `Expand ${l.label}` : `Collapse ${l.label}`}
                    >
                      {isCollapsed ? "▸" : "▾"}
                    </button>
                  ) : null}
                  <Tooltip content={rowTip(l)} side="right">
                    <span className={l.emphasis ? "font-semibold" : ""}>{l.label}</span>
                  </Tooltip>
                </td>
                <td className="px-2.5 py-1 text-right tabular-nums text-foreground">
                  {l.actual != null ? formatCompact(l.actual, valuePrefix) : "—"}
                </td>
                {compares.map((c) => (
                  <Fragment key={c}>
                    <td className="px-2.5 py-1 text-right tabular-nums text-muted-foreground">
                      {l.compare[c] != null ? formatCompact(l.compare[c] as number, valuePrefix) : "—"}
                    </td>
                    <DeltaCell delta={l.variance[c]} prefix={valuePrefix} showHeat={!suppressHeat} />
                  </Fragment>
                ))}
                <td className="px-2.5 py-1 text-right">
                  {finiteTrend.length > 1 ? (
                    <span className="inline-block align-middle">
                      <Sparkline data={finiteTrend} />
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!frame) return table;
  return (
    <VisualFrame
      title={title}
      hint={hint}
      icon={Landmark}
      actions={<TableActions title={title} getTable={getTable} classification={classification} />}
    >
      {note ? <p className="mb-2 text-xs text-muted-foreground">{note}</p> : null}
      {table}
    </VisualFrame>
  );
}
