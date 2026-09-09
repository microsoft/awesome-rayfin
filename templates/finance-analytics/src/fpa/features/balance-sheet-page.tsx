import { useMemo, useState } from "react";
import {
  KpiCard,
  VisualFrame,
  Tooltip,
  MultiLineChart,
  WaterfallChart,
  visualSelectionStore,
  formatCompact,
} from "@/finance";
import type { PeriodValue, Insight } from "@/finance";
import { Printer, Landmark, Wallet, Scale, Info, Gauge } from "lucide-react";
import {
  STATEMENT_PRESETS,
  mapGlobalPreset,
  windowSummary,
  type StatementPreset,
} from "../lib/time-aggregation";
import {
  buildBalanceSheet,
  liquidityRatios,
  workingCapitalTrend,
  type LiquidityRatios,
} from "../lib/balance-sheet";
import { balanceLineSelection } from "../lib/statement-insights";
import type { StatementLine } from "../lib/statement-model";
import { VARIANCE_COLOR } from "../lib/ibcs";
import { FinancialStatement } from "./financial-statement";

const PREFIX = "$";

function asOfLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function fmtDays(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}d`;
}
function fmtRatio(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(2)}×`;
}

export interface BalanceSheetPageProps {
  /** The shell's global period scope. When present it drives the flow-ratio window. */
  globalPeriod?: PeriodValue;
}

/**
 * Balance Sheet & Liquidity — completes the three-statement story. The balance sheet
 * is articulated from the same reconciled facts as the P&L and cash flow (Assets =
 * Liabilities + Equity, always), presented point-in-time as of the latest actual
 * month; the liquidity ratios and cash-conversion-cycle bridge use the selected
 * window's flows. Every tile, bar and row drills into the shared intelligence rail.
 */
export function BalanceSheetPage({ globalPeriod }: BalanceSheetPageProps = {}) {
  const globalPreset = mapGlobalPreset(globalPeriod);
  const [localPreset, setLocalPreset] = useState<StatementPreset>("ytd");
  const preset = globalPreset ?? localPreset;

  const model = useMemo(() => {
    const bs = buildBalanceSheet(preset);
    const ratios = liquidityRatios(preset);
    const wc = workingCapitalTrend(preset);
    return { bs, ratios, wc };
  }, [preset]);

  const { bs, ratios, wc } = model;
  const asOf = asOfLabel(bs.asOf);
  const lineById = (id: string) => bs.lines.find((l) => l.id === id);

  // Every BS row's drill payload, built once so a row click hands the rail the full
  // sibling set for prev/next. Scope key changes with the period so a new window
  // starts a fresh set instead of stepping through stale siblings.
  const scopeKey = `bs:${preset}`;
  const lineSelections = useMemo(
    () => bs.lines.map((l) => balanceLineSelection(l, { valuePrefix: PREFIX, asOfLabel: asOf, seriesLabels: wc.labels })),
    [bs.lines, asOf, wc.labels],
  );
  const selectLine = (l: StatementLine) => {
    const idx = bs.lines.indexOf(l);
    if (idx >= 0) visualSelectionStore.selectAt(lineSelections, idx, scopeKey);
    else visualSelectionStore.select(balanceLineSelection(l, { valuePrefix: PREFIX, asOfLabel: asOf, seriesLabels: wc.labels }));
  };

  // ── KPI + ratio tiles ──────────────────────────────────────────────────────
  const totalAssets = lineById("total_assets")?.actual ?? 0;
  const cash = lineById("cash")?.actual ?? 0;
  const cashPy = lineById("cash")?.compare.PY ?? null;
  const assetsPy = lineById("total_assets")?.compare.PY ?? null;

  const ratioTiles: { id: string; label: string; value: string; hint: string; good?: boolean; sel: () => void }[] = [
    {
      id: "current",
      label: "Current ratio",
      value: fmtRatio(ratios.currentRatio),
      hint: "Current assets ÷ current liabilities. ≥ 1.5× is comfortable short-term coverage.",
      good: ratios.currentRatio != null ? ratios.currentRatio >= 1.5 : undefined,
      sel: () => visualSelectionStore.select(liquiditySelection("Current ratio", ratios, "currentRatio")),
    },
    {
      id: "quick",
      label: "Quick ratio",
      value: fmtRatio(ratios.quickRatio),
      hint: "(Current assets − inventory) ÷ current liabilities. The acid test excludes inventory.",
      good: ratios.quickRatio != null ? ratios.quickRatio >= 1 : undefined,
      sel: () => visualSelectionStore.select(liquiditySelection("Quick ratio", ratios, "quickRatio")),
    },
    {
      id: "ccc",
      label: "Cash conversion cycle",
      value: fmtDays(ratios.ccc),
      hint: "DSO + DIO − DPO. Days between paying suppliers and collecting from customers — lower frees cash.",
      good: ratios.ccc != null ? ratios.ccc <= 90 : undefined,
      sel: () => visualSelectionStore.select(cccSelection(ratios)),
    },
    {
      id: "dso",
      label: "Days sales outstanding",
      value: fmtDays(ratios.dso),
      hint: "Accounts receivable ÷ window revenue × days. How long customers take to pay.",
      good: ratios.dso != null ? ratios.dso <= 60 : undefined,
      sel: () => visualSelectionStore.select(liquiditySelection("Days sales outstanding", ratios, "dso")),
    },
  ];

  // CCC bridge: DSO (start) → +DIO → −DPO → CCC (total). Values are in days.
  const cccSteps = [
    { label: "DSO", value: ratios.dso ?? 0, kind: "start" as const },
    { label: "+ DIO", value: ratios.dio ?? 0, kind: "delta" as const },
    { label: "− DPO", value: -(ratios.dpo ?? 0), kind: "delta" as const },
    { label: "CCC", value: ratios.ccc ?? 0, kind: "total" as const },
  ];

  const wcSeries = [
    { name: "Accounts receivable", values: wc.ar, area: true },
    { name: "Inventory", values: wc.inventory },
    { name: "Accounts payable", values: wc.ap, style: "dashed" as const },
  ];

  const print = () => window.print();

  return (
    <div className="fpa-board fpa-board-stack">
      {/* Print-only board cover */}
      <div className="fpa-print-only mb-3 hidden">
        <div className="flex items-baseline justify-between border-b-2 border-neutral-800 pb-1">
          <div>
            <div className="text-[15px] font-bold tracking-tight">Balance Sheet &amp; Liquidity</div>
            <div className="text-[10px] text-neutral-600">As of {asOf} · USD · Prior-year comparison</div>
          </div>
          <div className="text-right text-[10px] text-neutral-600">
            <div className="font-semibold">Contoso FP&amp;A</div>
            <div>Public — Sample Data</div>
          </div>
        </div>
      </div>

      {/* Local toolbar + scope note merged into one row — borderless inline controls
          (dropped from the printed board). The flow-window period is owned by the shell
          context header (global scope), so this row is usually just the info + board-pack. */}
      <div className="fpa-no-print flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-[240px] flex-1 items-start gap-2 text-[11px] text-muted-foreground">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>
            Balances are point-in-time <strong>as of {asOf}</strong> (reported in USD; balance-sheet closing-rate
            translation is out of scope). Liquidity day-ratios use the {windowSummary(preset).toLowerCase()} flow window.
            Assets tie to Liabilities + Equity by construction. Click any tile, bar or row to drill the intelligence rail.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!globalPreset ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Flow window</span>
              <select
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
          ) : null}
          <button
            type="button"
            onClick={print}
            className="inline-flex min-h-[36px] items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-secondary/60"
          >
            <Printer size={15} /> Board pack (PDF)
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          dense
          label="Total assets"
          value={formatCompact(totalAssets, PREFIX)}
          icon={Landmark}
          deltaRatio={assetsPy != null && assetsPy !== 0 ? (totalAssets - assetsPy) / Math.abs(assetsPy) : null}
          deltaSuffix="vs PY"
          priorYearLabel={assetsPy != null ? `vs PY ${formatCompact(assetsPy, PREFIX)}` : undefined}
          onDrill={() => {
            const l = lineById("total_assets");
            if (l) selectLine(l);
          }}
        />
        <KpiCard
          dense
          label="Cash & equivalents"
          value={formatCompact(cash, PREFIX)}
          icon={Wallet}
          deltaRatio={cashPy != null && cashPy !== 0 ? (cash - cashPy) / Math.abs(cashPy) : null}
          deltaSuffix="vs PY"
          priorYearLabel={cashPy != null ? `vs PY ${formatCompact(cashPy, PREFIX)}` : undefined}
          onDrill={() => {
            const l = lineById("cash");
            if (l) selectLine(l);
          }}
        />
        <KpiCard
          dense
          label="Net working capital"
          value={formatCompact(ratios.nwc ?? 0, PREFIX)}
          icon={Scale}
          priorYearLabel="Current assets − current liabilities"
          onDrill={() => visualSelectionStore.select(liquiditySelection("Net working capital", ratios, "nwc"))}
        />
      </div>

      {/* Liquidity ratio tiles */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {ratioTiles.map((t) => (
          <Tooltip key={t.id} content={<span className="block max-w-[220px]">{t.hint}</span>}>
            <button
              type="button"
              onClick={t.sel}
              className="rounded-lg border border-border bg-card px-3 py-2 text-left outline-none transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Gauge size={12} /> {t.label}
              </div>
              <div
                className="mt-0.5 text-lg font-semibold tabular-nums"
                style={{ color: t.good == null ? undefined : t.good ? VARIANCE_COLOR.favorable : VARIANCE_COLOR.unfavorable }}
              >
                {t.value}
              </div>
            </button>
          </Tooltip>
        ))}
      </div>

      {/* CCC bridge + working-capital trend */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VisualFrame title="Cash conversion cycle" hint="DSO + DIO − DPO, in days" icon={Gauge}>
          <p className="mb-2 text-xs text-muted-foreground">
            Lower is better — it means cash tied up in operations is released faster.
          </p>
          <WaterfallChart
            steps={cccSteps}
            height={220}
            valuePrefix=""
            onSelect={(s) => visualSelectionStore.select(cccStepSelection(s.label, s.value, ratios))}
          />
        </VisualFrame>

        <VisualFrame title="Working capital trend" hint="Closing AR, inventory & AP by month" icon={Wallet}>
          <p className="mb-2 text-xs text-muted-foreground">
            Receivables and payables scale with revenue; watch the gap between them.
          </p>
          <MultiLineChart
            labels={wc.labels}
            series={wcSeries}
            height={220}
            valuePrefix={PREFIX}
            onSelect={(label, i) => visualSelectionStore.select(wcPointSelection(label, i, wc))}
          />
        </VisualFrame>
      </div>

      {/* Balance sheet statement */}
      <FinancialStatement
        title="Balance sheet"
        hint={`As of ${asOf}`}
        note={`Point-in-time balances in USD. Prior year is the same month one year earlier. Assets reconcile to Liabilities + Equity${bs.balanced ? " (balanced)." : "."}`}
        lines={bs.lines}
        compares={["PY"]}
        valuePrefix={PREFIX}
        classification="Public — Sample Data"
        suppressHeat
        onSelectLine={selectLine}
      />
    </div>
  );
}

// ── Rail selection builders (kept local; balance-sheet specific) ──────────────

function liquiditySelection(label: string, r: LiquidityRatios, key: keyof LiquidityRatios): VisualSelectionArg {
  const value = r[key];
  const isDays = key === "dso" || key === "dio" || key === "dpo" || key === "ccc";
  const shown = typeof value === "number" ? (isDays ? `${value.toFixed(0)}d` : `${value.toFixed(2)}×`) : "—";
  const insights: Insight[] = [
    {
      title: label,
      metric: shown,
      tone: "neutral",
      source: "Liquidity",
      confidence: 0.85,
      body: liquidityBody(key, r),
    },
  ];
  return { visual: "Liquidity", label, value: shown, insights };
}

function liquidityBody(key: keyof LiquidityRatios, r: LiquidityRatios): string {
  switch (key) {
    case "currentRatio":
      return `Current assets cover current liabilities ${r.currentRatio?.toFixed(2)}×. Above 1.0× means short-term obligations are covered by short-term assets.`;
    case "quickRatio":
      return `Excluding inventory, liquid assets cover current liabilities ${r.quickRatio?.toFixed(2)}×. The acid test of near-term solvency.`;
    case "dso":
      return `Customers take about ${r.dso?.toFixed(0)} days to pay. Faster collection releases cash trapped in receivables.`;
    default:
      return `Liquidity metric as of ${r.asOf}.`;
  }
}

function cccSelection(r: LiquidityRatios): VisualSelectionArg {
  const insights: Insight[] = [
    {
      title: "Cash conversion cycle",
      metric: fmtDays(r.ccc),
      tone: r.ccc != null && r.ccc <= 90 ? "positive" : "watch",
      source: "Liquidity",
      confidence: 0.85,
      body: `It takes ${r.ccc?.toFixed(0)} days to turn operating investment into cash: ${r.dso?.toFixed(0)}d to collect (DSO) + ${r.dio?.toFixed(0)}d of inventory (DIO) − ${r.dpo?.toFixed(0)}d of supplier financing (DPO).`,
    },
  ];
  return { visual: "Liquidity", label: "Cash conversion cycle", value: fmtDays(r.ccc), insights };
}

function cccStepSelection(label: string, value: number, r: LiquidityRatios): VisualSelectionArg {
  const map: Record<string, string> = {
    DSO: `Days sales outstanding: receivables represent ${r.dso?.toFixed(0)} days of revenue.`,
    "+ DIO": `Days inventory outstanding: stock on hand equals ${r.dio?.toFixed(0)} days of cost of revenue.`,
    "− DPO": `Days payables outstanding: suppliers finance ${r.dpo?.toFixed(0)} days of purchases — this shortens the cycle.`,
    CCC: `The net cash conversion cycle is ${r.ccc?.toFixed(0)} days.`,
  };
  const insights: Insight[] = [
    {
      title: label,
      metric: `${Math.abs(value).toFixed(0)}d`,
      tone: "neutral",
      source: "Cash conversion cycle",
      confidence: 0.8,
      body: map[label] ?? `${label}: ${value.toFixed(0)} days.`,
    },
  ];
  return { visual: "Cash conversion cycle", label, value: `${value.toFixed(0)}d`, insights };
}

function wcPointSelection(
  label: string,
  i: number,
  wc: { ar: number[]; inventory: number[]; ap: number[] },
): VisualSelectionArg {
  const ar = wc.ar[i] ?? 0;
  const inv = wc.inventory[i] ?? 0;
  const ap = wc.ap[i] ?? 0;
  const nwc = ar + inv - ap;
  const insights: Insight[] = [
    {
      title: `Working capital · ${label}`,
      metric: formatCompact(nwc, PREFIX),
      tone: "neutral",
      source: "Working capital",
      confidence: 0.8,
      body: `AR ${formatCompact(ar, PREFIX)} + Inventory ${formatCompact(inv, PREFIX)} − AP ${formatCompact(ap, PREFIX)} = ${formatCompact(nwc, PREFIX)} of net operating working capital.`,
    },
  ];
  return { visual: "Working capital", label, value: formatCompact(nwc, PREFIX), insights };
}

interface VisualSelectionArg {
  visual: string;
  label: string;
  value?: string;
  insights: Insight[];
}
