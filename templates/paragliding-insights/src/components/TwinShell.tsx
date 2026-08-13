import { useEffect, useState } from 'react';

import { AOIS, activeAoiId } from '@/config/aoi';
import { WORLD, inWorld } from '@/config/world';
import { useI18n } from '@/i18n';

import { LanguageToggle } from './LanguageToggle';
import { Twin3DView } from './Twin3DView';

export function TwinShell() {
  const { t, locale } = useI18n();

  /**
   * The site being shown — PLAN §8.
   *
   * State rather than a URL read, because choosing another site is now a camera flight across one
   * continuous world instead of a page load into a different one. `?aoi=` still decides where the
   * flight starts, so every existing deep link keeps working.
   */
  const [site, setSite] = useState(() => activeAoiId());
  const aoi = AOIS[site];
  const places = aoi.focusPlaces.map((p) => p.name).join(' · ');

  // Keep the address bar honest without reloading: someone who flies to the Tegelberg and then
  // copies the URL should hand over the Tegelberg.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (site === activeAoiId() && url.searchParams.get('aoi') === site) return;
    if (site === WORLD.sites[0]) url.searchParams.delete('aoi');
    else url.searchParams.set('aoi', site);
    window.history.replaceState(null, '', url);
  }, [site]);

  // The tab title names the site. `index.html` ships a neutral one because the AOI is not known
  // until the URL is read, and a title that says Oberstdorf while the map shows the Tegelberg is
  // the same class of mistake as the tour that pointed at the wrong mountain — small, and wrong in
  // a way that survives review because nobody looks at the tab.
  useEffect(() => {
    document.title = `${t('app.title')} — ${aoi.site.name[locale]}`;
    document.documentElement.lang = locale;
  }, [t, aoi, locale]);

  // Every layer in this app comes from openly licensed data, and every licence here requires naming
  // its source. The two geobasis entries are quoted verbatim from the AOI config rather than
  // retyped, because both licences prescribe the exact wording of the notice — and because the
  // second site could in principle carry different ones.
  //
  // ⚠️ This lists what is actually USED, not what is planned. DWD was in here while the weather
  // ingestion was still a phase-5 intention — crediting a source the app does not read is its own
  // kind of inaccuracy, and it quietly makes the footer worthless as a statement of provenance.
  const attribution = [
    aoi.geobasis.attribution,
    aoi.shellGeobasis.attribution,
    '© OpenStreetMap contributors (ODbL)',
  ];

  return (
    <main
      data-testid="twin-shell"
      data-aoi={aoi.id}
      className="flex h-screen w-full flex-col overflow-hidden bg-stone-100 text-stone-700"
    >
      <header className="flex flex-wrap items-baseline gap-3 border-b border-stone-300 bg-stone-50 px-6 py-4">
        <h1 className="text-sm font-semibold tracking-wide text-stone-900">{t('app.title')}</h1>
        <span className="text-xs text-stone-500">{aoi.site.name[locale]}</span>
        <AoiSwitcher site={site} onChange={setSite} />
        <span className="ml-auto text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {aoi.site.region[locale]} · {places}
        </span>
        <LanguageToggle className="-my-1" />
      </header>

      <Twin3DView site={site} />

      <footer
        data-testid="attribution"
        className="border-t border-stone-300 bg-stone-50 px-6 py-3 text-[0.65rem] leading-relaxed text-stone-500"
      >
        <span className="mr-3 text-stone-600">{t('disclaimer.short')}</span>
        {attribution.join(' · ')}
      </footer>
    </main>
  );
}

/**
 * The site switch — the thing decision 21 asked to be demonstrable on stage.
 *
 * A plain `<select>`: it is one control, it is keyboard-accessible for free, and it makes the list
 * of shipped sites self-evident.
 *
 * ⚠️ **It used to reload the page.** Since phase 8 the sites share one continuous world, so this
 * flies the camera across the 24 km between them instead — which is the point: a reload asserts
 * two separate maps, and a flight shows the ground that connects them. `?aoi=` still chooses where
 * a fresh load starts, and the address bar is kept in step, so links behave exactly as before.
 */
function AoiSwitcher({ site, onChange }: { site: string; onChange: (id: string) => void }) {
  const { t, locale } = useI18n();
  const ids = inWorld(site) ? WORLD.sites : Object.keys(AOIS);
  if (ids.length < 2) return null;

  return (
    <label className="flex items-baseline gap-1 text-xs text-stone-500">
      <span className="sr-only">{t('app.site')}</span>
      <select
        data-testid="aoi-switcher"
        value={site}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700"
        aria-label={t('app.site')}
      >
        {ids.map((id) => (
          <option key={id} value={id}>
            {AOIS[id].site.name[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
