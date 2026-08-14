import { memo, useId } from "react";

export interface SparklineProps {
  /** Ordered series values (oldest → newest). */
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Dependency-free sparkline. Draws a smoothed area + line in the current text
 * color (set via Tailwind `text-*`) with a highlighted latest point. Used inside
 * KPI cards to give each metric a trend shape at a glance — zero chart-library weight.
 */
function SparklineImpl({ data, width = 96, height = 28, className }: SparklineProps) {
  const gradientId = useId();
  if (data.length < 2) return <div style={{ width, height }} className={className} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const usableH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" />
    </svg>
  );
}

export const Sparkline = memo(SparklineImpl);
