import { useMemo } from "react";
import { MultiLineChart, VisualFrame, forecastAccuracy, confidenceBand, visualSelectionStore } from "@/finance";
import type { LineSeries } from "@/finance";
import { formatSignedPercent } from "@/finance";
import { TrendingUp } from "lucide-react";
import { PERIODS, AS_OF, isActualPeriod } from "../data/statementFacts";
import { monthlySeries } from "../lib/statement-model";
import { VARIANCE_COLOR } from "../lib/ibcs";
import { forecastPointSelection } from "../lib/statement-insights";

function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

export interface RollingForecastProps {
  title?: string;
  /** Statement row to project, e.g. "revenue" or "ebit". */
  rowId?: string;
  rowLabel?: string;
  valuePrefix?: string;
  scale?: number;
}

/**
 * Rolling forecast: actuals run to the reporting anchor, then the latest forecast
 * carries forward with a confidence envelope whose width is sized from the
 * forecast's own historical accuracy (WAPE over the actualised months). Reuses the
 * shared MultiLineChart (solid actuals + dashed forecast + shaded band) and the
 * `forecastAccuracy`/`confidenceBand` primitives — no bespoke error math.
 */
export function RollingForecast({
  title = "Rolling forecast",
  rowId = "revenue",
  rowLabel = "Revenue",
  valuePrefix = "$",
  scale = 1,
}: RollingForecastProps) {
  const { series, accuracy, actual, forward } = useMemo(() => {
    const actual = monthlySeries(rowId, "AC", scale);
    const forecastAll = monthlySeries(rowId, "FC", scale);

    // Accuracy: score the forecast against actuals on the overlapping (closed) months.
    const acc = forecastAccuracy(actual, forecastAll);

    // Forward forecast: only the months after AS_OF (join at the anchor for continuity).
    const forward: (number | null)[] = PERIODS.map((p, i) =>
      isActualPeriod(p) ? (p === AS_OF ? actual[i] : null) : forecastAll[i],
    );
    const band = confidenceBand(forward, acc.wape || 0.05);

    const lines: LineSeries[] = [
      { name: "Actual", values: actual, style: "solid", area: true, color: "var(--color-chart-1)" },
      { name: "Forecast", values: forward, style: "dashed", color: "var(--color-chart-3)", band },
    ];
    return { series: lines, accuracy: acc, actual, forward };
  }, [rowId, scale]);

  const labels = PERIODS.map(monthLabel);
  // Bias in either direction is a forecasting concern; only a near-zero bias is "clean".
  const biasColor = Math.abs(accuracy.bias) > 0.01 ? VARIANCE_COLOR.unfavorable : VARIANCE_COLOR.neutral;
  const biasHint = accuracy.bias > 0.01 ? "running high" : accuracy.bias < -0.01 ? "running low" : "well-centered";

  return (
    <VisualFrame
      title={title}
      hint={`${rowLabel} · actuals through ${monthLabel(AS_OF)}, forecast forward with confidence band`}
      icon={TrendingUp}
    >
      <div className="mb-2 flex flex-wrap gap-4 px-1 text-xs">
        <span className="text-muted-foreground">
          Forecast accuracy (WAPE): <span className="font-semibold text-foreground">{formatSignedPercent(accuracy.wape).replace("+", "")}</span>
        </span>
        <span className="text-muted-foreground">
          Bias: <span className="font-semibold" style={{ color: biasColor }}>{formatSignedPercent(accuracy.bias)}</span>
          <span className="ml-1 opacity-70">({biasHint})</span>
        </span>
        <span className="text-muted-foreground">Scored months: <span className="font-semibold text-foreground">{accuracy.n}</span></span>
      </div>
      <MultiLineChart
        labels={labels}
        series={series}
        valuePrefix={valuePrefix}
        onSelect={(label, index) =>
          visualSelectionStore.select(
            forecastPointSelection(label, index, { actual, forward, wape: accuracy.wape, bias: accuracy.bias, labels }, valuePrefix),
          )
        }
      />
    </VisualFrame>
  );
}
