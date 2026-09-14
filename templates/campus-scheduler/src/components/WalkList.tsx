import { useI18n } from '@/i18n';
import type { TransferVerdict, Walk, WalkRoutes } from '@/planner/walkRoutes';

/**
 * The walks one person makes across their teaching week — the professor's own question.
 *
 * A planner reads a week grid to see whether a room is free. The person *in* that plan reads it to
 * find out whether they can physically get from one room to the next, and the grid alone cannot
 * answer that: two adjacent blocks look identical whether the rooms are next door or on the far
 * campus. This is the gap between them, measured on the real path network.
 *
 * ⚠️ The verdict is stated even when the answer is UNKNOWN. A building with no route (an outlying
 * site, a room that never resolved) must not quietly render as a comfortable transfer — the same
 * failure the site guard was fixed for.
 */

const TONE: Record<TransferVerdict, string> = {
  'same-building': 'border-stone-700 text-stone-400',
  comfortable: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200',
  tight: 'border-amber-400/60 bg-amber-500/10 text-amber-200',
  impossible: 'border-red-400/70 bg-red-500/15 text-red-200',
  unknown: 'border-stone-600 bg-stone-800/60 text-stone-300',
};

export function WalkList({
  walks,
  routes,
  openWalk,
  onToggle,
}: {
  walks: Walk[];
  routes: WalkRoutes | null;
  openWalk: string | null;
  onToggle: (walk: Walk) => void;
}) {
  const { t } = useI18n();

  // Nothing to say is said by saying nothing: a week spent entirely in one building has no walks,
  // and an empty list with a heading over it would read as a failure to load.
  if (!walks.length) return null;

  const problems = walks.filter((w) => w.verdict === 'impossible' || w.verdict === 'tight').length;

  return (
    <section data-testid="walk-list" className="mt-4 border-t border-stone-700 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-400">
          {t('walk.heading')}
        </h3>
        <span data-testid="walk-summary" className="text-[0.65rem] text-stone-500">
          {problems > 0
            ? t('walk.problems', { n: problems, total: walks.length })
            : t('walk.allFine', { total: walks.length })}
        </span>
      </div>

      {!routes && (
        <p data-testid="walk-missing" className="mt-1.5 text-[0.65rem] leading-relaxed text-stone-500">
          {t('walk.noRoutes')}
        </p>
      )}

      <ul className="mt-2 space-y-1.5">
        {walks.map((walk) => {
          const id = `${walk.from.sessionId}->${walk.to.sessionId}`;
          const drawn = openWalk === id;
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`walk-${id}`}
                data-verdict={walk.verdict}
                aria-pressed={drawn}
                disabled={!walk.route}
                onClick={() => onToggle(walk)}
                className={`w-full rounded border px-2 py-1.5 text-left text-[0.68rem] leading-relaxed transition ${
                  TONE[walk.verdict]
                } ${drawn ? 'ring-1 ring-sky-300' : ''} ${
                  walk.route ? 'hover:brightness-110' : 'cursor-default opacity-80'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {walk.day} {walk.leaveAt}–{walk.arriveBy} · {walk.from.roomId} →{' '}
                    {walk.to.roomId}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {walk.route
                      ? t('walk.minutesOf', { walk: walk.travelMin, gap: walk.breakMin })
                      : t('walk.unknownShort')}
                  </span>
                </span>

                <span className="mt-0.5 block opacity-90">
                  {walk.verdict === 'impossible' &&
                    t('walk.impossible', { short: Math.abs(walk.spareMin) })}
                  {walk.verdict === 'tight' && t('walk.tight', { spare: walk.spareMin })}
                  {walk.verdict === 'comfortable' &&
                    t('walk.comfortable', {
                      spare: walk.spareMin,
                      metres: walk.route?.distanceM ?? 0,
                    })}
                  {walk.verdict === 'unknown' && t('walk.unknown')}
                  {/*
                    ⚠️ Between campuses the verdict is about the BUS, and saying so is the whole
                    point: the same gap judged by the 44-minute walk would read as impossible, when
                    the plan has assumed a bus from the start. The walk is still quoted, because it
                    is the reason the bus matters.
                  */}
                  {walk.mode === 'transit' && (
                    <span className="ml-1 font-medium">
                      {t('walk.byBus', { walk: walk.walkMin })}
                    </span>
                  )}
                  {walk.mode === 'walk' && walk.route && !walk.route.sameCampus && (
                    <span className="ml-1 font-medium">{t('walk.crossCampus')}</span>
                  )}
                </span>

                {/*
                  ⚠️ THE STAND-IN IS NAMED WHEREVER IT IS USED. OTH numbers the whole Prüfeninger
                  Straße complex `P …` and no outline carries that letter, so the journey is
                  measured between the two SITES. That is a real answer and a weaker one than the
                  rows above it, and a reader cannot tell the two apart unless the row says so.
                */}
                {walk.precision === 'campus' && (
                  <span
                    data-testid={`walk-campus-level-${id}`}
                    className="mt-0.5 block text-[0.62rem] leading-relaxed opacity-80"
                  >
                    {t('walk.campusLevel')}
                  </span>
                )}

                {walk.route && (
                  <span className="mt-0.5 block text-[0.6rem] uppercase tracking-wider opacity-70">
                    {drawn ? t('walk.hide') : t('walk.show')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        The assumption, on screen rather than in a commit message. The path and its length are
        surveyed; the pace and the door are not, and a planner deciding whether fifteen minutes is
        enough deserves to know which part of the answer is measured.
      */}
      <p className="mt-2 text-[0.6rem] leading-relaxed text-stone-500">{t('walk.provenance')}</p>
    </section>
  );
}
