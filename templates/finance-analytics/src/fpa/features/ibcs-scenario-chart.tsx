import { useId } from "react";
import { VisualFrame, visualSelectionStore } from "@/finance";
import { formatCompact } from "@/finance";
import { BarChart3 } from "lucide-react";
import {
  SCENARIO_FILL,
  SCENARIO_ORDER,
  SCENARIO_STYLES,
  hatchPatternId,
  type ScenarioKey,
} from "../lib/ibcs";
import { scenarioGroupSelection } from "../lib/statement-insights";

export interface ScenarioGroup {
  label: string;
  values: Partial<Record<ScenarioKey, number>>;
}

export interface IbcsScenarioChartProps {
  title?: string;
  hint?: string;
  groups: ScenarioGroup[];
  scenarios?: ScenarioKey[];
  valuePrefix?: string;
  height?: number;
}

/**
 * IBCS-inspired grouped scenario columns. Each metric group shows the selected
 * scenarios using notation fills (Actual solid, Prior-year grey, Budget outline,
 * Forecast hatched) so scenarios are distinguishable in grayscale and colour is
 * NOT used to encode scenario. A shared zero-baselined scale keeps magnitudes
 * comparable. Includes a screen-reader table.
 */
export function IbcsScenarioChart({
  title = "Scenario comparison",
  hint = "IBCS-inspired notation · click a column group to drill in",
  groups,
  scenarios = SCENARIO_ORDER,
  valuePrefix = "$",
  height = 260,
}: IbcsScenarioChartProps) {
  const uid = useId().replace(/[:]/g, "");
  const hatchId = hatchPatternId(uid);

  const W = 720;
  const H = height;
  const padTop = 16;
  const padBottom = 44;
  const padLeft = 8;
  const padRight = 8;
  const plotH = H - padTop - padBottom;
  const plotW = W - padLeft - padRight;

  const all = groups.flatMap((g) => scenarios.map((s) => g.values[s] ?? 0));
  const max = Math.max(1, ...all.map((v) => Math.abs(v)));
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const zeroY = y(0);

  const groupW = plotW / groups.length;
  const barGap = 6;
  const barW = Math.max(6, (groupW - barGap * (scenarios.length + 1)) / scenarios.length);

  const fillFor = (s: ScenarioKey): string => {
    const kind = SCENARIO_STYLES[s].fillKind;
    if (kind === "hatch") return `url(#${hatchId})`;
    return SCENARIO_FILL[kind];
  };

  return (
    <VisualFrame title={title} hint={hint} icon={BarChart3}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="font-numeric">
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--color-card, #fff)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-foreground, #1f2937)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* zero baseline */}
        <line x1={padLeft} y1={zeroY} x2={W - padRight} y2={zeroY} stroke="var(--color-border, #e5e7eb)" strokeWidth="1" />

        {groups.map((g, gi) => {
          const gx = padLeft + gi * groupW;
          const select = () => visualSelectionStore.select(scenarioGroupSelection(g, valuePrefix));
          return (
            <g key={g.label} onClick={select} style={{ cursor: "pointer" }}>
              <title>{`${g.label} — click to drill into scenario variances`}</title>
              {scenarios.map((s, si) => {
                const v = g.values[s] ?? 0;
                const x = gx + barGap + si * (barW + barGap);
                const top = Math.min(zeroY, y(v));
                const h = Math.abs(zeroY - y(v));
                const style = SCENARIO_STYLES[s];
                return (
                  <g key={s}>
                    <rect
                      x={x}
                      y={top}
                      width={barW}
                      height={Math.max(1, h)}
                      fill={fillFor(s)}
                      stroke={style.stroke}
                      strokeWidth={style.fillKind === "outline" ? 1.5 : 0.5}
                    >
                      <title>{`${g.label} · ${style.label}: ${formatCompact(v, valuePrefix)}`}</title>
                    </rect>
                    <text
                      x={x + barW / 2}
                      y={top - 3}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                      style={{ fontSize: 9 }}
                    >
                      {formatCompact(v, valuePrefix)}
                    </text>
                  </g>
                );
              })}
              <text
                x={gx + groupW / 2}
                y={H - padBottom + 16}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: 11, fontWeight: 600 }}
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
        {scenarios.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <svg width="14" height="12" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="13"
                height="11"
                fill={fillFor(s)}
                stroke={SCENARIO_STYLES[s].stroke}
                strokeWidth={SCENARIO_STYLES[s].fillKind === "outline" ? 1.5 : 0.5}
              />
            </svg>
            {SCENARIO_STYLES[s].label}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Metric</th>
            {scenarios.map((s) => (
              <th key={s}>{SCENARIO_STYLES[s].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.label}>
              <th scope="row">{g.label}</th>
              {scenarios.map((s) => (
                <td key={s}>{g.values[s] != null ? formatCompact(g.values[s] as number, valuePrefix) : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </VisualFrame>
  );
}
