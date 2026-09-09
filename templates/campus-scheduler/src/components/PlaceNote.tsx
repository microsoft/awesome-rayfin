import { useI18n } from '@/i18n';
import type { PickedPlace } from '@/twin3d/scene';

/**
 * What a map label names, when it names something this dataset cannot open.
 *
 * ⚠️ THE POINT IS TO SAY "REAL, BUT NOT MODELLED" WITHOUT SAYING "MISSING". Two different things
 * land here and they are not the same:
 *
 *   * a **campus outline** — "OTH Regensburg", "Campus Prüfeninger Straße". Not a building at all;
 *     there is nothing to open and nothing is wrong.
 *   * a **building with no teaching rooms** — the Mensa, the library, a faculty this dataset does
 *     not model. Real, rendered, deliberately carrying no room data (PLAN §16).
 *
 * Guessing a nearby building for either would open an empty shell and imply a floor plan that does
 * not exist, which is the failure this whole project keeps having to design against.
 */
export function PlaceNote({
  place,
  onDismiss,
}: {
  place: PickedPlace;
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  // "OSM way/29153707" → a link anyone can check. The id is the evidence that the place is real.
  const osm = /^OSM (way|relation|node)\/(\d+)$/.exec(place.source);

  return (
    <div
      data-testid="place-note"
      className="absolute left-1/2 top-4 z-20 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded border border-stone-600 bg-stone-900/92 p-3 text-stone-200 shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 data-testid="place-note-name" className="text-sm font-semibold leading-snug">
          {place.name}
        </h2>
        <button
          type="button"
          data-testid="place-note-close"
          onClick={onDismiss}
          title={t('place.close')}
          className="-mr-1 -mt-1 shrink-0 rounded px-1.5 py-0.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          <span aria-hidden>✕</span>
          <span className="sr-only">{t('place.close')}</span>
        </button>
      </div>

      <p data-testid="place-note-body" className="mt-1.5 text-xs leading-relaxed text-stone-300">
        {place.kind === 'campus' ? t('place.campus') : t('place.noRooms')}
      </p>

      {osm && (
        <p className="mt-2 text-[0.65rem] text-stone-500">
          {t('place.source')}{' '}
          <a
            href={`https://www.openstreetmap.org/${osm[1]}/${osm[2]}`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-dotted underline-offset-2 hover:text-stone-300"
          >
            {place.source.replace('OSM ', '')}
          </a>
        </p>
      )}
    </div>
  );
}
