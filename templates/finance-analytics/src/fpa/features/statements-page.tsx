import { useMemo, useState } from "react";
import { KpiCard, VisualFrame, Tooltip, formatCompact, formatSignedCompact, visualSelectionStore } from "@/finance";
import type { PeriodValue } from "@/finance";
import { Printer, Landmark, Wallet, Info } from "lucide-react";
import {
  STATEMENT_PRESETS,
  mapGlobalPreset,
  resolveWindow,
  windowSummary,
  type StatementPreset,
} from "../lib/time-aggregation";
import { buildStatement, type CompareKey, type StatementLine } from "../lib/statement-model";
import { translationFactor, currencyPrefix, currencyLabel } from "../lib/currency";
import { decomposePvm } from "../lib/drivers";
import { buildCashflow, type CashflowLine } from "../lib/cashflow";
import { CURRENCIES, AS_OF, BASE_CURRENCY, type CurrencyCode } from "../data/statementFacts";
import { VARIANCE_COLOR } from "../lib/ibcs";
import { statementLineSelection } from "../lib/statement-insights";
import { ruleOf40, operatingLeverage } from "../lib/finance-math";
import { formatSignedPercent } from "@/finance";
import { FinancialStatement } from "./financial-statement";
import { IbcsScenarioChart } from "./ibcs-scenario-chart";
import { DriverBridge } from "./driver-bridge";
import { RollingForecast } from "./rolling-forecast";

const ALL_COMPARES: { key: CompareKey; label: string }[] = [
  { key: "BU", label: "Budget" },
  { key: "FC", label: "Forecast" },
  { key: "PY", label: "Prior year" },
];

function monthShort(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function lineById(lines: StatementLine[], id: string): StatementLine | undefined {
  return lines.find((l) => l.id === id);
}

function CashflowStatement({ lines, valuePrefix, note }: { lines: CashflowLine[]; valuePrefix: string; note: string }) {
  return (
    <VisualFrame title="Cash flow (indirect)" hint="Free cash flow from operating income + non-cash + working capital" icon={Wallet}>
      <p className="mb-2 text-xs text-muted-foreground">{note}</p>
      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {lines.map((l) => (
              <tr
                key={l.id}
                className={l.emphasis ? "border-t border-border bg-secondary/30 font-semibold" : "border-t border-border/50"}
              >
                <td className="px-3 py-1.5 text-left text-foreground">{l.label}</td>
                <td
                  className="px-3 py-1.5 text-right tabular-nums"
                  style={{ color: l.value < 0 ? VARIANCE_COLOR.unfavorable : undefined }}
                >
                  {formatSignedCompact(l.value, valuePrefix)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </VisualFrame>
  );
}

/**
 * Self-contained FP&A "Financial Statements" workspace. Its period, comparison
 * and reporting-currency controls are LOCAL to this page (labelled as such) — the
 * page owns the bundled multi-scenario statement fixture rather than the shell's
 * snapshot table, so there is no misleading claim that global filters apply here.
 * Everything is print-ready: the "Board pack (PDF)" button prints just this board.
 */
export interface StatementsPageProps {
  /** The shell's global period scope. When present it drives the statement window. */
  globalPeriod?: PeriodValue;
}

export function StatementsPage({ globalPeriod }: StatementsPageProps = {}) {
  const globalPreset = mapGlobalPreset(globalPeriod);
  const [localPreset, setLocalPreset] = useState<StatementPreset>("ytd");
  const preset = globalPreset ?? localPreset;
  const [compares, setCompares] = useState<CompareKey[]>(["BU", "PY"]);
  const [currency, setCurrency] = useState<CurrencyCode>(BASE_CURRENCY);

  const model = useMemo(() => {
    const window = resolveWindow(preset);
    const factor = translationFactor(window, currency);
    const prefix = currencyPrefix(currency);
    const orderedCompares = ALL_COMPARES.filter((c) => compares.includes(c.key)).map((c) => c.key);

    const lines = buildStatement({ preset, compares: orderedCompares, scale: factor });
    // Always compute all scenarios for the IBCS chart regardless of table selection.
    const fullLines = buildStatement({ preset, compares: ["BU", "FC", "PY"], scale: factor });
    const pvm = decomposePvm(window, window, "BU", "AC", factor);
    const cashflow = buildCashflow(preset, factor);
    const seriesLabels = window.map(monthShort);

    return { window, factor, prefix, orderedCompares, lines, fullLines, pvm, cashflow, seriesLabels };
  }, [preset, compares, currency]);

  const { prefix, orderedCompares, lines, fullLines, pvm, cashflow, seriesLabels } = model;

  const presetLabel = STATEMENT_PRESETS.find((p) => p.id === preset)?.label ?? preset;
  const kpiRows = ["revenue", "gross_profit", "ebit"] as const;
  const kpiIcon = Landmark;

  const activeCompares = useMemo<CompareKey[]>(
    () => (orderedCompares.length ? orderedCompares : (["BU"] as CompareKey[])),
    [orderedCompares],
  );

  // Build every P&L row's drill payload once so clicking any row hands the rail the
  // full sibling set (for prev/next) without recomputing on each click. The scope key
  // changes with period/currency/comparison so a filter change starts a fresh set
  // rather than stepping through stale siblings.
  const scopeKey = `pnl:${preset}:${currency}:${activeCompares.join(",")}`;
  const lineSelections = useMemo(
    () => lines.map((l) => statementLineSelection(l, { valuePrefix: prefix, periodLabel: presetLabel, compares: activeCompares, seriesLabels })),
    [lines, prefix, presetLabel, activeCompares, seriesLabels],
  );
  const selectLine = (l: StatementLine) => {
    const idx = lines.indexOf(l);
    if (idx >= 0) visualSelectionStore.selectAt(lineSelections, idx, scopeKey);
    else visualSelectionStore.select(statementLineSelection(l, { valuePrefix: prefix, periodLabel: presetLabel, compares: activeCompares, seriesLabels }));
  };

  const currencyNote =
    currency === BASE_CURRENCY
      ? "Reported in USD."
      : `Translated from USD to ${currencyLabel(currency)} at period-average rates (P&L convention).`;

  const scenarioGroups = kpiRows.map((id) => {
    const l = lineById(fullLines, id);
    return {
      label: l?.label ?? id,
      values: {
        AC: l?.actual ?? 0,
        BU: l?.compare.BU ?? 0,
        FC: l?.compare.FC ?? 0,
        PY: l?.compare.PY ?? 0,
      },
    };
  });

  const print = () => window.print();

  // Efficiency ratios derived from the SAME reconciling model (no extra fixture):
  // growth vs prior year, free-cash-flow margin, Rule of 40 and operating leverage.
  const ratios = useMemo(() => {
    const rev = lineById(fullLines, "revenue");
    const ebit = lineById(fullLines, "ebit");
    const fcf = cashflow.find((l) => l.id === "fcf")?.value ?? null;
    const revenue = rev?.actual ?? null;
    const revGrowth = rev?.variance.PY?.pct ?? null;
    const ebitGrowth = ebit?.variance.PY?.pct ?? null;
    const fcfMargin = revenue && fcf != null ? fcf / revenue : null;
    return {
      revGrowth,
      fcfMargin,
      rule40: revGrowth != null && fcfMargin != null ? ruleOf40(revGrowth, fcfMargin) : null,
      opLev: revGrowth != null && ebitGrowth != null ? operatingLeverage(ebitGrowth, revGrowth) : null,
    };
  }, [fullLines, cashflow]);

  const ratioTiles: { label: string; value: string; hint: string; good?: boolean }[] = [
    {
      label: "Revenue growth (YoY)",
      value: ratios.revGrowth != null ? formatSignedPercent(ratios.revGrowth) : "—",
      hint: "Actual revenue vs the same window one fiscal year earlier.",
      good: ratios.revGrowth != null ? ratios.revGrowth >= 0 : undefined,
    },
    {
      label: "FCF margin",
      value: ratios.fcfMargin != null ? formatSignedPercent(ratios.fcfMargin).replace("+", "") : "—",
      hint: "Free cash flow ÷ revenue (indirect method: CFO − capex).",
      good: ratios.fcfMargin != null ? ratios.fcfMargin >= 0 : undefined,
    },
    {
      label: "Rule of 40",
      value: ratios.rule40 != null ? formatSignedPercent(ratios.rule40).replace("+", "") : "—",
      hint: "Revenue growth % + FCF margin %. ≥ 40% signals a healthy growth/profit balance.",
      good: ratios.rule40 != null ? ratios.rule40 >= 0.4 : undefined,
    },
    {
      label: "Operating leverage",
      value: ratios.opLev != null ? `${ratios.opLev.toFixed(2)}×` : "—",
      hint: "%Δ EBIT ÷ %Δ revenue (YoY). > 1× means earnings grow faster than the top line.",
      good: ratios.opLev != null ? ratios.opLev >= 1 : undefined,
    },
  ];

  return (
    <div className="fpa-board fpa-board-stack">
      {/* Print-only board cover header — dense, professional, dropped on screen. */}
      <div className="fpa-print-only mb-3 hidden">
        <div className="flex items-baseline justify-between border-b-2 border-neutral-800 pb-1">
          <div>
            <div className="text-[15px] font-bold tracking-tight">Financial Statements — Board Pack</div>
            <div className="text-[10px] text-neutral-600">
              {presetLabel} · Actuals close {AS_OF} · {currencyLabel(currency)} ({currencyPrefix(currency)}) · Compares:{" "}
              {activeCompares.map((c) => ALL_COMPARES.find((a) => a.key === c)?.label).join(", ")}
            </div>
          </div>
          <div className="text-right text-[10px] text-neutral-600">
            <div className="font-semibold">Contoso FP&amp;A</div>
            <div>Public — Sample Data</div>
          </div>
        </div>
      </div>

      {/* Local toolbar — borderless inline controls (dropped from the printed board).
          Period is owned by the shell context header (global scope); this toolbar
          carries only the genuinely page-local controls. */}
      <div className="fpa-no-print flex flex-wrap items-center gap-x-4 gap-y-2">
        {!globalPreset ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Period</span>
              <select
                id="fpa-period"
                className="min-h-[36px] rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={localPreset}
                onChange={(e) => setLocalPreset(e.target.value as StatementPreset)}
              >
                {STATEMENT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="h-6 w-px self-center bg-border" aria-hidden="true" />
          </>
        ) : null}

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Compare</span>
          <div className="flex gap-1">
            {ALL_COMPARES.map((c) => {
              const on = compares.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    setCompares((prev) => (prev.includes(c.key) ? prev.filter((k) => k !== c.key) : [...prev, c.key]))
                  }
                  aria-pressed={on}
                  className={
                    "min-h-[36px] rounded-md border px-2.5 py-1 text-xs font-medium " +
                    (on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground")
                  }
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <span className="h-6 w-px self-center bg-border" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="fpa-ccy">
            Currency
          </label>
          <select
            id="fpa-ccy"
            className="min-h-[36px] rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)} ({currencyPrefix(c)})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={print}
          className="ml-auto inline-flex min-h-[36px] items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-secondary/60"
        >
          <Printer size={15} /> Board pack (PDF)
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground fpa-no-print">
        <Info size={12} className="shrink-0" />
        <span>
          {windowSummary(preset)} · {currencyNote} Click any line, column or bar to drill the intelligence rail.
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpiRows.map((id) => {
          const l = lineById(lines, id) ?? lineById(fullLines, id);
          const v = l?.actual ?? 0;
          const varBU = l?.variance.BU;
          return (
            <KpiCard
              key={id}
              dense
              label={l?.label ?? id}
              value={formatCompact(v, prefix)}
              periodTag={STATEMENT_PRESETS.find((p) => p.id === preset)?.short}
              icon={kpiIcon}
              deltaRatio={varBU?.pct ?? null}
              deltaSuffix="vs BU"
              priorYearLabel={varBU ? `vs Budget ${formatCompact(l?.compare.BU ?? 0, prefix)}` : undefined}
            />
          );
        })}
      </div>

      {/* Efficiency ratios — derived from the same reconciling model */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {ratioTiles.map((t) => (
          <Tooltip key={t.label} content={<span className="max-w-[220px] block">{t.hint}</span>}>
            <div
              tabIndex={0}
              className="rounded-lg border border-border bg-card px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div
                className="mt-0.5 text-lg font-semibold tabular-nums"
                style={{ color: t.good == null ? undefined : t.good ? VARIANCE_COLOR.favorable : VARIANCE_COLOR.unfavorable }}
              >
                {t.value}
              </div>
            </div>
          </Tooltip>
        ))}
      </div>

      <IbcsScenarioChart groups={scenarioGroups} valuePrefix={prefix} />

      <FinancialStatement
        title="Income statement (P&L)"
        hint={windowSummary(preset)}
        note={`${currencyNote} Actuals close at ${AS_OF}. Prior year is the same window one fiscal year earlier.`}
        lines={lines}
        compares={activeCompares}
        valuePrefix={prefix}
        classification="Public — Sample Data"
        onSelectLine={selectLine}
      />

      <div className="fpa-page-break grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DriverBridge result={pvm} baseLabel="Budget" valuePrefix={prefix} />
        <CashflowStatement lines={cashflow} valuePrefix={prefix} note={currencyNote} />
      </div>

      <div className="fpa-page-break">
        <RollingForecast rowId="revenue" rowLabel="Revenue" valuePrefix={prefix} scale={model.factor} />
      </div>
    </div>
  );
}
