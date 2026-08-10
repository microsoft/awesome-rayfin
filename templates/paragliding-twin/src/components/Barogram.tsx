import { useMemo } from 'react';

import { useI18n } from '@/i18n';
import type { FlightTrack } from '@/flight/track';

/**
 * The barogram — height against time, with the scrubber on the same axis.
 *
 * Deliberately one control, not two. The barogram *is* the timeline: dragging anywhere on it moves
 * the replay, so the shape of the climb and the thing you use to navigate it are the same object.
 * A separate slider underneath would have made the chart decorative.
 *
 * Drawn as an SVG rather than on a canvas because it is a few hundred points and needs to be
 * selectable, inspectable and legible at any zoom — and because a chart that appears in the DOM
 * can be asserted on in a test.
 */

const WIDTH = 1000;
const HEIGHT = 150;

export interface BarogramProps {
  track: FlightTrack;
  /** Replay head, seconds from the first fix. */
  headS: number;
  onScrub: (seconds: number) => void;
}

export function Barogram({ track, headS, onScrub }: BarogramProps) {
  const { t, locale } = useI18n();

  // The hero flight has 12 586 fixes and the chart is 1000 px wide, so most of them would land on
  // a pixel that already has ink. Reducing to roughly two points per pixel keeps every peak and
  // trough while cutting the path data by an order of magnitude.
  const { areaPath, linePath, altMin, altMax } = useMemo(() => {
    const target = WIDTH * 2;
    const stride = Math.max(1, Math.floor(track.points.length / target));
    const sampled = track.points.filter((_, index) => index % stride === 0);
    if (sampled[sampled.length - 1] !== track.points[track.points.length - 1]) {
      sampled.push(track.points[track.points.length - 1]);
    }

    // Round the vertical range outward to whole hundreds so the gridlines are readable numbers.
    const lo = Math.floor(track.altMinM / 100) * 100;
    const hi = Math.ceil(track.altMaxM / 100) * 100;

    const x = (seconds: number) => (seconds / Math.max(track.durationS, 1)) * WIDTH;
    const y = (altM: number) => HEIGHT - ((altM - lo) / Math.max(hi - lo, 1)) * HEIGHT;

    const line = sampled
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.t).toFixed(1)},${y(point.altM).toFixed(1)}`)
      .join('');

    return {
      linePath: line,
      areaPath: `${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z`,
      altMin: lo,
      altMax: hi,
    };
  }, [track]);

  const headX = (headS / Math.max(track.durationS, 1)) * WIDTH;
  const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');

  const scrubFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    onScrub(Math.max(0, Math.min(1, fraction)) * track.durationS);
  };

  return (
    <div data-testid="barogram" className="select-none">
      <div className="mb-1 flex items-baseline justify-between text-xs text-stone-500">
        <span>{t('flight.barogram')}</span>
        <span className="tabular-nums">
          {nf.format(altMin)}–{nf.format(altMax)} m
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="block h-24 w-full cursor-ew-resize touch-none"
        role="slider"
        aria-label={t('flight.scrub')}
        aria-valuemin={0}
        aria-valuemax={Math.round(track.durationS)}
        aria-valuenow={Math.round(headS)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubFromEvent(event);
        }}
        onKeyDown={(event) => {
          // A chart that can only be dragged is unusable without a mouse, and the arrow keys are
          // also the most precise way to step through a climb.
          const step = event.shiftKey ? 60 : 10;
          if (event.key === 'ArrowLeft') onScrub(Math.max(0, headS - step));
          if (event.key === 'ArrowRight') onScrub(Math.min(track.durationS, headS + step));
          if (event.key === 'Home') onScrub(0);
          if (event.key === 'End') onScrub(track.durationS);
        }}
      >
        {/* Whole-hundred gridlines, so a height can be read off without a legend. */}
        {Array.from({ length: 5 }, (_, index) => {
          const y = (index / 4) * HEIGHT;
          return <line key={index} x1={0} y1={y} x2={WIDTH} y2={y} stroke="#d6d3d1" strokeWidth={1} />;
        })}

        <path d={areaPath} fill="#e7e5e4" />
        <path d={linePath} fill="none" stroke="#78716c" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

        {/* The flown part, over the top, so the barogram carries the same "so far" reading as the
            track in the scene. */}
        <clipPath id="barogram-flown">
          <rect x={0} y={0} width={Math.max(headX, 0)} height={HEIGHT} />
        </clipPath>
        <path d={areaPath} fill="#d97706" opacity={0.18} clipPath="url(#barogram-flown)" />
        <path
          d={linePath}
          fill="none"
          stroke="#b45309"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          clipPath="url(#barogram-flown)"
        />

        <line
          data-testid="barogram-head"
          x1={headX}
          y1={0}
          x2={headX}
          y2={HEIGHT}
          stroke="#1c1917"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
