import { useEffect, useRef } from 'react';

import type { FlyTelemetry } from '@/cesium/flyControls';

/**
 * Flight readout, shown only while the latch is engaged.
 *
 * ⚠️ THE HUD APPEARING *IS* THE STATEMENT. There is no drone button to light up — the keys are the
 * whole control — so something has to say (a) that flying exists and (b) which behaviour the mouse
 * currently has. Idle shows the hint; flying shows this. Same shape as the Campus twins.
 *
 * ⚠️ READ THROUGH REFS, NOT REACT STATE. Telemetry changes every frame; re-rendering the shell 60
 * times a second costs more than the scene does.
 */
export function DroneHud({ read }: { read: () => FlyTelemetry | null }) {
  const root = useRef<HTMLDivElement>(null);
  const alt = useRef<HTMLSpanElement>(null);
  const agl = useRef<HTMLSpanElement>(null);
  const spd = useRef<HTMLSpanElement>(null);
  const hdg = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const cruise = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = read();
      const el = root.current;
      if (el) {
        const on = Boolean(t?.engaged);
        // `data-flying` rather than `aria-pressed`, which would be a lie about something
        // unpressable — nothing here is a button.
        el.dataset.flying = String(on);
        el.style.opacity = on ? '1' : '0';
        el.style.pointerEvents = 'none';
      }
      if (t && el) {
        if (alt.current) alt.current.textContent = `${Math.round(t.altitudeM)} m`;
        if (agl.current) agl.current.textContent = t.aglM === null ? '—' : `${Math.round(t.aglM)} m`;
        if (spd.current) spd.current.textContent = `${Math.round(t.speedMs)} m/s`;
        if (hdg.current) hdg.current.textContent = `${Math.round(t.headingDeg)}°`;
        if (cruise.current) cruise.current.textContent = `${Math.round(t.cruiseMs)} m/s`;
        if (bar.current) bar.current.style.width = `${Math.round(t.cruise * 100)}%`;
        // e2e needs a number that is exactly zero when the camera has stopped: with inertia,
        // "keys are up" and "camera has stopped" are ~1.2 s apart, and sampling the camera for two
        // equal values is unsound because equal samples can mean no frame was drawn.
        el.dataset.speedMs = t.speedMs.toFixed(2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read]);

  const cell = 'flex flex-col gap-0.5';
  const label = 'text-[9px] uppercase tracking-wider text-white/40';
  const value = 'text-[13px] font-medium tabular-nums text-white';

  return (
    <div
      ref={root}
      data-testid="drone-hud"
      data-flying="false"
      style={{ opacity: 0 }}
      className="absolute left-1/2 top-4 z-30 -translate-x-1/2 select-none rounded-xl bg-slate-950/80 px-4 py-3 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md transition-opacity duration-200"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_6px] shadow-sky-400" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-200">
          Free flight
        </span>
      </div>
      <div className="grid grid-cols-4 gap-x-5">
        <div className={cell}>
          <span className={label}>Alt</span>
          <span ref={alt} className={value} />
        </div>
        <div className={cell}>
          <span className={label}>AGL</span>
          <span ref={agl} className={value} />
        </div>
        <div className={cell}>
          <span className={label}>Speed</span>
          <span ref={spd} className={value} />
        </div>
        <div className={cell}>
          <span className={label}>Hdg</span>
          <span ref={hdg} className={value} />
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className={label}>Cruise</span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-white/15">
          <div ref={bar} className="h-full rounded-full bg-sky-400" style={{ width: '0%' }} />
        </div>
        <span ref={cruise} className="text-[10px] tabular-nums text-white/60" />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/45">
        W A S D fly · Q/E up-down · R/F circle the view centre · drag or arrows look · wheel speed ·
        Shift boost · Esc exit
      </p>
    </div>
  );
}
