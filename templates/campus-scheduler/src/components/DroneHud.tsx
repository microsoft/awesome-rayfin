import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n';
import type { FlyTelemetry } from '@/twin3d/flyControls';
import type { Campus3DHandle } from '@/twin3d/scene';

/**
 * The drone-mode instruments.
 *
 * ⚠️ **These are also the mode indicator now that the toggle button is gone.** W A S D takes the
 * camera and a second of stillness gives it back, and while the camera is theirs the wheel is a
 * throttle rather than the map zoom and a drag looks rather than orbits. A mode nothing on screen
 * mentions is a mode the viewer discovers by being confused, so this appearing IS the statement
 * that the mouse changed meaning.
 *
 * The rest is not decoration either. Speed scales with height above ground — that is what makes
 * one camera work for both a 2 km campus and a 19 km shell — and without instruments that scaling
 * feels like the controls changing under you. Showing altitude, AGL and the cruise setting turns a
 * surprise into a reading.
 *
 * Telemetry is read on an animation frame rather than held in React state per update: it changes
 * every frame while flying, and re-rendering the shell sixty times a second to move five numbers
 * would cost more than the scene it is describing. The values are written straight into DOM refs.
 */
export function DroneHud({ handle }: { handle: Campus3DHandle }) {
  const { t } = useI18n();
  const rows = useRef<Record<string, HTMLSpanElement | null>>({});
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const telemetry: FlyTelemetry | null = handle.droneTelemetry();
      if (telemetry) {
        const set = (key: string, value: string) => {
          const node = rows.current[key];
          if (node && node.textContent !== value) node.textContent = value;
        };
        set('altitude', `${Math.round(telemetry.altitudeM)} m`);
        set('agl', telemetry.aglM === null ? t('drone.offMap') : `${Math.round(telemetry.aglM)} m`);
        set('speed', `${Math.round(telemetry.speedMs)} m/s`);
        set('heading', `${Math.round(telemetry.headingDeg).toString().padStart(3, '0')}°`);
        set('cruise', `${Math.round(telemetry.cruise * 100)} %`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [handle, t]);

  // ⚠️ Escape used to be handled here. It belongs to `flyControls.ts` now, along with every other
  // key that means something to the camera — the mode is the controls' to own, and two owners is
  // how a mode ends up disagreeing with itself.

  // The controls hint earns its space for about ten seconds and then is in the way.
  useEffect(() => {
    const timer = window.setTimeout(() => setHintVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  const fields: { key: string; label: string }[] = [
    { key: 'altitude', label: t('drone.altitude') },
    { key: 'agl', label: t('drone.agl') },
    { key: 'speed', label: t('drone.speed') },
    { key: 'heading', label: t('drone.heading') },
    { key: 'cruise', label: t('drone.cruise') },
  ];

  return (
    <>
      <div
        data-testid="drone-hud"
        className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-5 rounded border border-stone-600/70 bg-stone-900/80 px-4 py-2 font-mono text-[0.7rem] backdrop-blur"
      >
        {fields.map((field) => (
          <div key={field.key} className="text-center">
            <div className="uppercase tracking-[0.14em] text-stone-400">{field.label}</div>
            <span
              data-testid={`drone-${field.key}`}
              ref={(node) => {
                rows.current[field.key] = node;
              }}
              className="tabular-nums text-stone-50"
            >
              —
            </span>
          </div>
        ))}
      </div>

      {hintVisible && (
        <p className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded bg-stone-900/80 px-3 py-1.5 text-[0.68rem] text-stone-300 backdrop-blur">
          {t('drone.hint')}
        </p>
      )}
    </>
  );
}
