import { useMemo, useState } from 'react';

import index from '@config/campus-index.json';
import outline from '@config/germany-outline.json';
import { switchAoi } from '@/config/aoi';
import { shipsAoi } from '@/config/release';
import { useI18n } from '@/i18n';

/**
 * The national view — one dot per university, and picking one is what loads it.
 *
 * ⚠️ THIS EXISTS BECAUSE NEITHER THE MENU NOR THE TWINS SCALE. Fifty-one universities is too many
 * names to choose between in a dropdown, and fifty-one BUILT twins is tens of gigabytes of terrain,
 * orthophoto and building mesh — nobody is loading that to look at one campus. So the app gets a
 * level of detail below a twin: a country, dots where the universities are, and the expensive part
 * fetched only for the one that gets picked. The index and the outline together are a few dozen
 * kilobytes against ~20 MB for a single built twin.
 *
 * ⚠️ THE DOTS DO NOT ALL MEAN THE SAME THING, AND THE MAP SAYS SO. `centreFrom` records where each
 * position came from: `twin` is a built AOI's own verified box, `campus` a box resolved out of
 * OpenStreetMap evidence, `city` only the town centre because the matcher refused to guess. A map
 * that drew all three identically would be claiming a precision it has for 27 of 31 dots, so the
 * approximate ones are drawn hollow and say so when picked.
 */

type Dot = (typeof index.universities)[number];

/**
 * Equirectangular, with the longitude axis scaled by cos(mean latitude).
 *
 * ⚠️ WITHOUT THAT COSINE GERMANY IS VISIBLY FAT. A degree of longitude at 51°N is about 70 km
 * against 111 km for a degree of latitude, so plotting raw degrees on equal axes stretches the
 * country to roughly 1.6× its width and every distance read off the map is wrong. This is a
 * backdrop rather than survey data, but "backdrop" is not a licence to draw the wrong shape.
 */
const BOUNDS = { minLon: 5.6, maxLon: 15.2, minLat: 47.2, maxLat: 55.2 };
const K = Math.cos((((BOUNDS.minLat + BOUNDS.maxLat) / 2) * Math.PI) / 180);
const W = (BOUNDS.maxLon - BOUNDS.minLon) * K;
const H = BOUNDS.maxLat - BOUNDS.minLat;

function project(lat: number, lon: number): [number, number] {
  return [(lon - BOUNDS.minLon) * K, BOUNDS.maxLat - lat];
}

function ringPath(ring: number[][]): string {
  return (
    ring
      .map(([lon, lat], i) => {
        const [x, y] = project(lat, lon);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`;
      })
      .join('') + 'Z'
  );
}

export function NationalMap({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const [picked, setPicked] = useState<Dot | null>(null);

  const paths = useMemo(() => {
    const g = outline.geometry as { type: string; coordinates: number[][][] | number[][][][] };
    const polys =
      g.type === 'MultiPolygon'
        ? (g.coordinates as number[][][][])
        : [g.coordinates as number[][][]];
    // Only the outer ring of each polygon. Germany's enclaves and lakes are holes we do not need,
    // and drawing them as separate filled shapes would put grey blobs on the map.
    return polys.map((poly) => ringPath(poly[0]));
  }, []);

  /**
   * ⚠️ A DOT IS "ENTERABLE" ONLY IF THE TWIN ACTUALLY SHIPS. `config/release.json` can withhold a
   * site (TUM, for the NavigaTUM redistribution question) and this index is a different file from
   * the AOI registry, so the dot would otherwise survive its own twin and offer to open it.
   * Blanking `aoi` demotes it to a plain located university, which is exactly what it has become.
   */
  const dots = (index.universities as Dot[]).map((u) =>
    shipsAoi(u.aoi) ? u : ({ ...u, aoi: null } as Dot),
  );
  const builtCount = dots.filter((d) => d.aoi).length;
  const number = (v: number) => new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB').format(v);

  /**
   * Label positions for the enterable dots, nudged apart where they would collide.
   *
   * ⚠️ THE CITY IS NOT A LABEL HERE. Labelling by city put "München" on the map twice, overlapping,
   * for LMU and for TUM Garching — two different universities 12 km apart reading as one smudge
   * that named neither. The institution name is what distinguishes them, so that is what is drawn,
   * capped because "Ostbayerische Technische Hochschule Regensburg" is a paragraph at this scale.
   *
   * The dodge is only needed because Munich has two; with four labels a sequential pass is enough
   * and a real label-placement solver would be machinery for a problem this map does not have.
   */
  const labels = useMemo(() => {
    const placed: { x: number; y: number; text: string }[] = [];
    for (const u of dots) {
      if (!u.aoi) continue;
      const [x, y] = project(u.lat, u.lon);
      let ly = y + 0.06;
      while (placed.some((p) => Math.abs(p.y - ly) < 0.22 && Math.abs(p.x - x) < 1.6)) ly += 0.24;
      const text = u.name.length > 26 ? `${u.name.slice(0, 25)}…` : u.name;
      placed.push({ x: x + 0.16, y: ly, text });
    }
    return placed;
  }, [dots]);

  return (
    /*
      ⚠️ `fixed`, NOT `absolute`. This is opened from `SiteMenu`, which lives in the header inside
      its own `relative` wrapper — so `absolute inset-0` resolves against that wrapper and shrinks
      the whole country into a box the size of the site title. It still rendered, still reported
      itself visible, and every dot sat outside the viewport; the first Playwright pass failed on
      clicking one, which is the only reason it was caught rather than shipped.

      A chooser that covers the app has to be positioned against the viewport, not against whatever
      happened to launch it.
    */
    <section
      data-testid="national-map"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-stone-950/97 backdrop-blur"
    >
      <header className="flex items-start justify-between px-8 pt-8">
        <div>
          <h2 className="text-xs uppercase tracking-[0.18em] text-stone-400">
            {t('national.title')}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">
            {t('national.intro', { n: number(dots.length), built: number(builtCount) })}
          </p>
        </div>
        <button
          type="button"
          data-testid="national-close"
          onClick={onClose}
          className="rounded border border-stone-600 px-3 py-1.5 text-xs text-stone-300 transition hover:bg-stone-800 hover:text-stone-50"
        >
          {t('national.close')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 px-8 pb-8 pt-4">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 h-full w-full"
            role="group"
            aria-label={t('national.title')}
          >
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                // Solid rather than /50: the ramp inverts in light mode, and a half-transparent
                // stone-800 there left the country a barely-there smudge the dots floated on.
                className="fill-stone-800 stroke-stone-500"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {dots.map((u) => {
              const [x, y] = project(u.lat, u.lon);
              const built = Boolean(u.aoi);
              const exact = u.centreFrom !== 'city';
              return (
                <g key={u.id}>
                  <circle
                    data-testid={`national-dot-${u.id}`}
                    cx={x}
                    cy={y}
                    r={built ? 0.1 : 0.062}
                    className={
                      built
                        ? 'cursor-pointer fill-amber-500 stroke-stone-950'
                        : exact
                          ? 'cursor-pointer fill-stone-300 stroke-stone-950'
                          : 'cursor-pointer fill-stone-700 stroke-stone-400'
                    }
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    onClick={() => setPicked(u)}
                  >
                    <title>{u.name}</title>
                  </circle>
                </g>
              );
            })}

            {/*
              Only the enterable ones are labelled. Thirty-one labels at this scale overlap into an
              unreadable mat, and the label is there to answer "which of these can I open" — which
              is a question the others cannot answer yes to.
            */}
            {labels.map((l) => (
              <text
                key={l.text}
                x={l.x}
                y={l.y}
                className="pointer-events-none fill-stone-200"
                style={{ fontSize: 0.19 }}
              >
                {l.text}
              </text>
            ))}
          </svg>
        </div>

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded border border-stone-700 bg-stone-900/70">
          {picked ? (
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <p className="text-sm font-semibold text-stone-100">{picked.name}</p>
              <p className="mt-0.5 text-xs text-stone-400">
                {picked.city} · {picked.state}
              </p>
              {/*
                ⚠️ SAY THAT THE OFFICIAL SOURCE DISAGREES, rather than quietly winning the argument.
                DESTATIS puts Universität Hohenheim in Ostfildern; the campus is in Stuttgart, and
                the dot follows the campus. Showing only the corrected city would replace one
                confident label with another and leave a reader who checks the register thinking
                the map is wrong.
              */}
              {picked.cityPerRegistry ? (
                <p data-testid="city-disagreement" className="mt-1 text-[0.65rem] text-stone-500">
                  {t('national.cityPerRegistry', { city: picked.cityPerRegistry })}
                </p>
              ) : null}
              {picked.students ? (
                <p className="mt-3 text-xs text-stone-400">
                  {t('national.students', { n: number(picked.students) })}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-stone-500">
                {t(`national.precision.${picked.centreFrom}`)}
              </p>

              <div className="mt-auto pt-4">
                {picked.aoi ? (
                  <button
                    type="button"
                    data-testid="national-enter"
                    onClick={() => switchAoi(picked.aoi as string)}
                    // ⚠️ `amber`, not `accent`. There is no `accent-*` colour in this project —
                    // no Tailwind config, and `@theme` in main.css declares only `--color-ink`
                    // and the stone ramp. `bg-accent-500` therefore generates NOTHING, and the
                    // primary action of this view rendered as unstyled text on the panel. The
                    // screenshot is the only reason that was caught; it type-checks and passes
                    // every test either way, because a class name that does not exist is not an
                    // error anywhere except on screen.
                    className="w-full rounded bg-amber-500 px-3 py-2 text-xs font-medium text-ink transition hover:bg-amber-400"
                  >
                    {t('national.enter')}
                  </button>
                ) : (
                  /*
                    ⚠️ NO BUTTON HERE, DELIBERATELY. A dot without a twin has nothing to open, and
                    an "open" control that explains itself in a toast after the click is the
                    dead-button bug this repo has shipped twice. The dot is still worth showing —
                    its campus really was located — so it says what exists and what does not.
                  */
                  <p
                    data-testid="national-unbuilt"
                    className="rounded border border-stone-700 bg-stone-950/60 p-3 text-[0.7rem] leading-relaxed text-stone-400"
                  >
                    {t('national.notBuilt')}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="p-4 text-xs leading-relaxed text-stone-500">{t('national.pick')}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
