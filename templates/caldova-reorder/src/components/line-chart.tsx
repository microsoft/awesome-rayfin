import type { SeriesPoint } from "./charts";

/**
 * Small line charts drawn as plain SVG.
 *
 * These used to be Vega views. Vega brings a view lifecycle, a resize observer
 * and an asynchronous rebuild in order to draw a dozen line segments, and the
 * rebuild is where they broke: any re-layout — switching tab, opening the detail
 * view, resizing the window — could leave a view collapsed to a flat line with
 * nothing to restore it. Reproduced deterministically, and it always took the
 * same rows.
 *
 * Plain SVG has no lifecycle to get stuck in. The markup is a pure function of
 * the data, so a re-layout simply re-renders it. Vega still draws the fifteen
 * faceted store panels, where it earns its keep.
 */

/** Baseline padding so a line never sits exactly on an edge. */
const PAD = 0.12;

interface Scaled {
    line: string;
    area: string;
}

/**
 * Project a series into a `0..width` × `0..height` box.
 *
 * A constant series is drawn through the middle rather than along an edge: flat
 * is the honest shape for unchanging demand, but it should read as a steady line
 * rather than as a chart that failed to draw.
 */
function project(series: SeriesPoint[], width: number, height: number): Scaled {
    const values = series.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;

    const stepX = series.length > 1 ? width / (series.length - 1) : 0;
    const top = height * PAD;
    const usable = height * (1 - PAD * 2);

    const y = (value: number) =>
        span === 0 ? height / 2 : top + usable - ((value - min) / span) * usable;

    const points = series.map((point, i) => [i * stepX, y(point.value)] as const);

    const line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ");
    const area = `${line} L${(points.at(-1)?.[0] ?? 0).toFixed(2)} ${height} L0 ${height} Z`;

    return { line, area };
}

export interface SparklineSvgProps {
    series: SeriesPoint[];
    height: number;
    label: string;
    colour: string;
}

/**
 * Width-agnostic sparkline.
 *
 * Drawn in a nominal coordinate box and stretched by the viewBox, so it needs no
 * measurement at all — the container's width is whatever CSS says it is.
 * `non-scaling-stroke` keeps the line an even thickness despite the
 * non-uniform stretch.
 */
export function SparklineSvg({ series, height, label, colour }: SparklineSvgProps) {
    const { line, area } = project(series, 100, height);

    return (
        <svg
            role="img"
            aria-label={label}
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            width="100%"
            height={height}
            style={{ display: "block" }}
        >
            <path d={area} fill={colour} opacity={0.09} />
            <path
                d={line}
                fill="none"
                stroke={colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}

export interface TrendSvgProps {
    series: SeriesPoint[];
    width: number;
    height: number;
    label: string;
    colour: string;
}

const AXIS_LEFT = 46;
const AXIS_BOTTOM = 24;
// Room for the last date label, which is centred on the final point and would
// otherwise be cut in half by the right edge.
const AXIS_RIGHT = 26;

/**
 * The regional demand chart: one line, a value axis and a date axis.
 *
 * Takes a real pixel width because its tick labels have to sit at real
 * positions — text cannot be stretched by a viewBox without distorting.
 */
export function TrendSvg({ series, width, height, label, colour }: TrendSvgProps) {
    const plotWidth = Math.max(1, width - AXIS_LEFT - AXIS_RIGHT);
    const plotHeight = Math.max(1, height - AXIS_BOTTOM);
    const { line, area } = project(series, plotWidth, plotHeight);

    const values = series.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const ticks = valueTicks(min, max);
    const top = plotHeight * PAD;
    const usable = plotHeight * (1 - PAD * 2);
    const yOf = (value: number) =>
        max === min ? plotHeight / 2 : top + usable - ((value - min) / (max - min)) * usable;

    const dateIndexes = spread(series.length, 4);

    return (
        <svg
            role="img"
            aria-label={label}
            width={width}
            height={height}
            style={{ display: "block" }}
        >
            {ticks.map((tick) => (
                <g key={tick}>
                    <line
                        x1={AXIS_LEFT}
                        x2={AXIS_LEFT + plotWidth}
                        y1={yOf(tick)}
                        y2={yOf(tick)}
                        stroke="var(--color-muted)"
                        strokeWidth={1}
                    />
                    <text
                        x={AXIS_LEFT - 8}
                        y={yOf(tick) + 5}
                        textAnchor="end"
                        fontSize={14}
                        fill="var(--color-muted-foreground)"
                    >
                        {tick.toLocaleString()}
                    </text>
                </g>
            ))}

            <g transform={`translate(${AXIS_LEFT} 0)`}>
                <path d={area} fill={colour} opacity={0.12} />
                <path
                    d={line}
                    fill="none"
                    stroke={colour}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </g>

            {dateIndexes.map((i) => {
                const x = AXIS_LEFT + (series.length > 1 ? (plotWidth / (series.length - 1)) * i : 0);
                return (
                    <text
                        key={i}
                        x={x}
                        y={height - 6}
                        textAnchor="middle"
                        fontSize={14}
                        fill="var(--color-muted-foreground)"
                    >
                        {shortDate(series[i].date)}
                    </text>
                );
            })}
        </svg>
    );
}

/** Three or four round numbers spanning the data, for the value axis. */
function valueTicks(min: number, max: number): number[] {
    if (max === min) return [min];

    const step = niceStep((max - min) / 3);
    const first = Math.ceil(min / step) * step;
    const out: number[] = [];

    for (let value = first; value <= max; value += step) {
        out.push(Math.round(value * 100) / 100);
    }

    return out.length > 0 ? out : [min, max];
}

function niceStep(raw: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalised = raw / magnitude;
    const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;

    return step * magnitude;
}

/** Evenly spaced indexes, always including the last point. */
function spread(length: number, count: number): number[] {
    if (length <= count) return Array.from({ length }, (_, i) => i);

    const step = (length - 1) / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

function shortDate(iso: string): string {
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return iso;

    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}
