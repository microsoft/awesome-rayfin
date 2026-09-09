import { useMemo, useState } from 'react';

import type { PathPoint } from '@/data/model';
import { areaPath, buildSpeedSeries, linePath, nearestSample } from '@/data/speedSeries';

interface SpeedChartProps {
  path: PathPoint[];
  loading: boolean;
}

function clockLabel(at: number | null): string {
  if (at === null) return '';
  return new Date(at).toLocaleTimeString();
}

/**
 * Speed over the selected vehicle's recent track.
 *
 * The line is drawn in a stretched 100x100 viewBox so it fills whatever width the panel has;
 * `vector-effect="non-scaling-stroke"` keeps the stroke from being stretched with it. The hover
 * guide, dot and tooltip are plain HTML positioned in percent, which avoids the same distortion
 * and lets the tooltip overflow the chart.
 */
export function SpeedChart({ path, loading }: SpeedChartProps) {
  const series = useMemo(() => buildSpeedSeries(path), [path]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (loading) {
    return <p className="mt-3 text-[11px] opacity-40">Loading track...</p>;
  }
  if (!series) {
    return <p className="mt-3 text-[11px] opacity-40">Not enough track for a speed history yet.</p>;
  }

  const hovered = hoverIndex === null ? null : series.samples[hoverIndex];

  return (
    <div className="mt-3" data-testid="speed-chart">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] opacity-50">Speed over the last 2 h</span>
        <span className="text-[11px] tabular-nums opacity-70">
          {hovered
            ? `${hovered.kmh.toFixed(1)} km/h${hovered.at !== null ? ` · ${clockLabel(hovered.at)}` : ''}`
            : `ø ${series.avgKmh.toFixed(1)} · max ${series.maxKmh.toFixed(1)} km/h`}
        </span>
      </div>

      <div
        className="relative mt-1 h-16 cursor-crosshair select-none"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          setHoverIndex(nearestSample(series, (event.clientX - rect.left) / rect.width));
        }}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg
          className="h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label={`Speed history, average ${series.avgKmh.toFixed(1)} km/h, peak ${series.maxKmh.toFixed(1)} km/h`}
          role="img"
        >
          <path d={areaPath(series)} className="fill-sky-400/15" />
          <path
            d={linePath(series)}
            className="stroke-sky-300"
            fill="none"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Axis ceiling and baseline, so the shape has a scale to read against. */}
        <span className="pointer-events-none absolute right-0 top-0 text-[9px] leading-none opacity-35">
          {series.ceilingKmh}
        </span>
        <span className="pointer-events-none absolute bottom-0 right-0 text-[9px] leading-none opacity-35">
          0
        </span>

        {hovered ? (
          <>
            <span
              className="pointer-events-none absolute top-0 h-full w-px bg-white/25"
              style={{ left: `${hovered.x * 100}%` }}
            />
            <span
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200 ring-2 ring-sky-500/40"
              style={{ left: `${hovered.x * 100}%`, top: `${(1 - hovered.y) * 100}%` }}
            />
          </>
        ) : null}
      </div>

      {series.timeScaled ? (
        <div className="mt-0.5 flex justify-between text-[9px] opacity-35">
          <span>{clockLabel(series.samples[0].at)}</span>
          <span>{clockLabel(series.samples[series.samples.length - 1].at)}</span>
        </div>
      ) : null}
    </div>
  );
}
