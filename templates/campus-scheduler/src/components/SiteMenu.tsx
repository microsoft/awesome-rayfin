import { Suspense, lazy, useEffect, useRef, useState } from 'react';

import index from '@config/campus-index.json';
import { AOIS, switchAoi } from '@/config/aoi';
import { NationalMap } from '@/components/NationalMap';
import { useI18n } from '@/i18n';
/*
  ⚠️ LAZY, BECAUSE PERFORMANCE IS THE STANDING PRIORITY HERE. The integration panel is opened by
  roughly nobody during a demo and pulls in a form, a fetch and its own strings. Imported eagerly it
  would land in the main bundle that every visitor downloads before the campus can render — paying
  for a settings screen on the critical path of a 3D scene. `lazy` keeps it in its own chunk that is
  fetched only when the menu item is chosen.
*/
const IntegrationPanel = lazy(() => import('@/components/IntegrationPanel'));
/**
 * The university switch, hidden behind the title — one app, one customer on screen.
 *
 * ⚠️ THE TITLE IS THE CONTROL, AND IT DELIBERATELY DOES NOT LOOK LIKE ONE. This app is shown to
 * one university at a time, and the other universities in the build are other people's campuses.
 * A visible switcher invites the question "what else is in here?" in the middle of a demo, so the
 * way in is knowing it is there: no chevron, no underline, no hover tint, default cursor.
 *
 * Hiding it VISUALLY is not the same as hiding it from assistive technology, and the second one
 * would be a bug rather than a feature. The heading is a real `button` with `aria-haspopup` and
 * `aria-expanded`, so a screen reader announces a menu exactly as it should; what is suppressed is
 * the styling, not the semantics.
 *
 * ⚠️ Switching RELOADS — see `switchAoi`. A site change replaces the heightmap, the land cover,
 * the buildings, the vegetation and the drape, so the honest implementation of "switch" is the one
 * that tears everything down. That is also why the menu does not animate closed: the page is going.
 */
export function SiteMenu({ aoiId }: { aoiId: string }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  // Close on Escape and on a click that lands anywhere else. Both are registered only while the
  // menu is open, so the shell carries no listeners for a control nobody has opened.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // `pointerdown`, not `click`: a click on another control would otherwise act on a menu that is
    // still open underneath it.
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const ids = Object.keys(AOIS);

  return (
    <div ref={wrapper} className="relative">
      {/*
        The heading stays an `h1` with the site name as its text — that is what the page IS, and
        `second-site.spec.ts` reads it to prove a switch actually happened. The button lives inside
        it so the accessible name of the heading is unchanged.
      */}
      <h1 className="text-sm font-semibold tracking-wide">
        <button
          type="button"
          data-testid="site-menu-toggle"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          // Inherit everything. A `button` brings its own font, colour and cursor, and any of them
          // showing through is the tell this control is meant not to have.
          className="cursor-default bg-transparent p-0 font-inherit text-inherit tracking-inherit"
        >
          {AOIS[aoiId].site.name[locale]}
        </button>
      </h1>

      {open && (
        <div
          role="menu"
          data-testid="site-menu"
          aria-label={t('site.switch')}
          className="absolute left-0 top-full z-30 mt-2 min-w-52 overflow-hidden rounded border border-stone-600 bg-stone-800 shadow-lg"
        >
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              // ⚠️ The test id is unchanged from the button row this menu replaced. It is the
              // handle `second-site.spec.ts` uses, and renaming it would have made a passing suite
              // depend on a detail of the markup rather than on the switch working.
              data-testid={`aoi-${id}`}
              aria-current={id === aoiId}
              onClick={() => {
                setOpen(false);
                switchAoi(id);
              }}
              className={`block w-full px-3 py-2 text-left text-xs transition ${
                id === aoiId
                  ? 'bg-stone-700 text-stone-50'
                  : 'text-stone-300 hover:bg-stone-700 hover:text-stone-50'
              }`}
            >
              {AOIS[id].site.name[locale]}
            </button>
          ))}

          {/*
            ⚠️ THE WAY OUT OF A LIST THAT DOES NOT SCALE. Four built twins fit in a menu; the
            thirty-one universities this app knows about do not, and reading them as names strips
            out the one thing that makes a national view worth having — where they are. So the
            menu stops being the index and becomes the shortcut to the sites already built, with
            the map behind it for everything else.

            It sits below a divider rather than among the sites because it is not one: picking it
            opens a chooser, it does not switch the university out from under you.
          */}
          <button
            type="button"
            role="menuitem"
            data-testid="open-national-map"
            onClick={() => {
              setOpen(false);
              setMapOpen(true);
            }}
            className="block w-full border-t border-stone-600 px-3 py-2 text-left text-xs text-stone-400 transition hover:bg-stone-700 hover:text-stone-50"
          >
            {t('national.all', { n: String(index.universities.length) })}
          </button>

          <button
            type="button"
            role="menuitem"
            data-testid="open-integration"
            onClick={() => {
              setOpen(false);
              setSourceOpen(true);
            }}
            className="block w-full px-3 py-2 text-left text-xs text-stone-400 transition hover:bg-stone-700 hover:text-stone-50"
          >
            {t('integration.menu')}
          </button>
        </div>
      )}

      {mapOpen && <NationalMap onClose={() => setMapOpen(false)} />}
      {/* No fallback UI: the chunk is a few kB and a flash of "loading" is worse than a beat of nothing. */}
      {sourceOpen && (
        <Suspense fallback={null}>
          <IntegrationPanel onClose={() => setSourceOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
