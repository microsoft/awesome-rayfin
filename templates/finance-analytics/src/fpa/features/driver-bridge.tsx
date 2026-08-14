import { WaterfallChart, VisualFrame, Tooltip, visualSelectionStore } from "@/finance";
import type { WaterfallStep } from "@/finance";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "@/finance";
import { GitCompareArrows } from "lucide-react";
import { VARIANCE_COLOR } from "../lib/ibcs";
import type { PvmResult } from "../lib/drivers";
import { pvmStepSelection, driverSelection } from "../lib/statement-insights";

export interface DriverBridgeProps {
  title?: string;
  hint?: string;
  result: PvmResult;
  /** What the actual is being bridged from, e.g. "Budget" or "Prior year". */
  baseLabel?: string;
  valuePrefix?: string;
}

/**
 * Price/Volume/Mix bridge: a waterfall from the base revenue to actual revenue
 * through the Volume, Mix and Price effects (which reconcile exactly to ΔRevenue),
 * plus a ranked per-product contribution list so the largest movers read at a
 * glance. Reuses the shared WaterfallChart.
 */
export function DriverBridge({
  title = "Revenue bridge",
  hint,
  result,
  baseLabel = "Budget",
  valuePrefix = "$",
}: DriverBridgeProps) {
  const steps: WaterfallStep[] = result.steps.map((s) => ({
    label: s.label === "Base" ? baseLabel : s.label === "Actual" ? "Actual" : s.label,
    value: s.value,
    kind: s.kind === "base" ? "start" : s.kind === "total" ? "total" : "delta",
  }));

  const maxAbs = Math.max(1, ...result.drivers.map((d) => Math.abs(d.delta)));
  const netDelta = result.actual - result.base;

  return (
    <VisualFrame title={title} hint={hint ?? `Actual vs ${baseLabel} · Volume · Mix · Price`} icon={GitCompareArrows}>
      <WaterfallChart
        steps={steps}
        valuePrefix={valuePrefix}
        onSelect={(step) => visualSelectionStore.select(pvmStepSelection(step.label, step.value, result, valuePrefix, baseLabel))}
      />

      <div className="mt-3">
        <div className="mb-1 px-1 text-xs font-semibold text-muted-foreground">Top movers by product</div>
        <ul className="space-y-1">
          {result.drivers.map((d) => {
            const favorable = d.delta >= 0;
            const color = favorable ? VARIANCE_COLOR.favorable : VARIANCE_COLOR.unfavorable;
            const pct = Math.abs(d.delta) / maxAbs;
            const share = netDelta !== 0 ? d.delta / netDelta : 0;
            return (
              <li key={d.product}>
                <Tooltip
                  content={
                    <div className="space-y-0.5">
                      <div className="font-semibold">{d.product}</div>
                      <div>Δ Revenue {formatSignedCompact(d.delta, valuePrefix)} · {formatSignedPercent(share)} of net</div>
                      <div className="opacity-80">
                        Vol {formatSignedCompact(d.volume, valuePrefix)} · Mix {formatSignedCompact(d.mix, valuePrefix)} · Price{" "}
                        {formatSignedCompact(d.price, valuePrefix)}
                      </div>
                    </div>
                  }
                >
                  <button
                    type="button"
                    onClick={() => visualSelectionStore.select(driverSelection(d, result, valuePrefix))}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-40 shrink-0 truncate text-foreground">{d.product}</span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded bg-secondary/60">
                      <span
                        className="absolute inset-y-0 rounded"
                        style={{
                          width: `${Math.max(1.5, pct * 50)}%`,
                          left: favorable ? "50%" : undefined,
                          right: favorable ? undefined : "50%",
                          backgroundColor: color,
                        }}
                      />
                      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums" style={{ color }}>
                      {formatSignedCompact(d.delta, valuePrefix)}
                    </span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          Reconciles: Volume {formatSignedCompact(result.volume, valuePrefix)} + Mix{" "}
          {formatSignedCompact(result.mix, valuePrefix)} + Price {formatSignedCompact(result.price, valuePrefix)} ={" "}
          {formatSignedCompact(result.actual - result.base, valuePrefix)} (Δ vs {baseLabel}, base{" "}
          {formatCompact(result.base, valuePrefix)}).
        </p>
      </div>
    </VisualFrame>
  );
}
