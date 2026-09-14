import { useI18n } from '@/i18n';

/**
 * The left navigation rail — one home for surfaces that were reached through buttons scattered
 * around three different edges of the screen.
 *
 * ⚠️ THESE ARE TOGGLES, NOT EXCLUSIVE TABS, AND THAT DISTINCTION IS THE WHOLE POINT. The app is a
 * campus with things layered over it: the week grid is a bottom drawer, the lenses and the
 * assistant share a right-hand aside, and the value of the thing is that you can watch a lecture
 * move in the calendar while the room lights up on the map. A tab bar would make those mutually
 * exclusive and quietly destroy the split screen that makes the argument. Every item here turns
 * its own surface on or off and leaves the others alone.
 *
 * `Campus` is the exception and is deliberately not a toggle of its own: it collapses the
 * overlays, because "show me just the map" is a real request and hunting for two close buttons to
 * do it is not an answer.
 *
 * ⚠️ THE RAIL ITSELF COLLAPSES, because it is furniture. Expanded it names each surface, which is
 * what a first-time viewer needs; collapsed it is icons only and gives ~7 rem back to the campus,
 * which is what someone presenting on a laptop needs. The choice persists, like every other pane
 * size in this app — a layout decision that dies on reload is friction.
 */

export type RailItemId =
  | 'campus'
  | 'week'
  | 'analysis'
  | 'assistant'
  | 'changes'
  | 'walks'
  | 'availability'
  | 'help';

export interface RailItem {
  id: RailItemId;
  /** Whether the surface this item controls is currently on screen. */
  active: boolean;
  /** Absent for items whose surface this site cannot offer — see `available` below. */
  onToggle: () => void;
  /**
   * A number worth shouting about. Only `changes` carries one: how many sessions differ from the
   * published plan is the one count a planner wants to see without asking for it.
   */
  badge?: number;
  /**
   * ⚠️ A SITE WITHOUT A TIMETABLE HAS NO WEEK, NO WALKS AND NO CHANGES. Garching and Tübingen are
   * campus twins with no solver behind them, and an item that is visible but does nothing is its
   * own bug — this repo has shipped that exact fault twice, once with `Kalender öffnen` under a
   * notice saying the site has no timetable. Unavailable items are not rendered at all.
   */
  available: boolean;
}

/** 20 px line icons, drawn here rather than pulled from a package. */
const ICONS: Record<RailItemId | 'collapse' | 'expand', React.ReactNode> = {
  // A campus seen from above: two blocks and a path between them.
  campus: (
    <>
      <path d="M3 20h18" />
      <path d="M5 20V9l5-3 5 3v11" />
      <path d="M15 20v-7h4v7" />
      <path d="M9 20v-4h2v4" />
    </>
  ),
  // A week: the grid this app is actually about.
  week: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M9 14h2M13 14h2M9 17h2M13 17h2" />
    </>
  ),
  // Analysis: three bars of different heights, the shape every lens in here draws.
  analysis: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  // The assistant: a speech bubble, because you type a question into it.
  assistant: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8Z" />
      <path d="M9 11h6M9 14h4" />
    </>
  ),
  // Changes: two arrows trading places — a session leaving one slot and arriving in another.
  changes: (
    <>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </>
  ),
  // Wege: a route with a start and an end, not a footprint — what is measured is the path.
  walks: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8 16.5C10 13 8 11 10.5 9.5S16 9 16.5 8" />
    </>
  ),
  // Verfügbarkeit: a person beside a clock — when somebody can teach, not where.
  availability: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3 2.9-4.5 5.5-4.5" />
      <circle cx="17" cy="16" r="4.5" />
      <path d="M17 14v2.2l1.4.9" />
    </>
  ),
  // Help: the question a first-time viewer has.
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.5" />
      <path d="M12 17.5h.01" />
    </>
  ),
  collapse: <path d="M15 6l-6 6 6 6" />,
  expand: <path d="M9 6l6 6-6 6" />,
};

function Icon({ id }: { id: RailItemId | 'collapse' | 'expand' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {ICONS[id]}
    </svg>
  );
}

export function NavRail({
  items,
  collapsed,
  onCollapsedChange,
}: {
  items: RailItem[];
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
}) {
  const { t } = useI18n();

  // `help` sits at the bottom, away from the surfaces you switch between while working. It is the
  // one item you look for when you are lost rather than when you are busy.
  const main = items.filter((item) => item.id !== 'help' && item.available);
  const foot = items.filter((item) => item.id === 'help' && item.available);

  const renderItem = (item: RailItem) => {
    const label = t(`rail.${item.id}`);
    return (
      <button
        key={item.id}
        type="button"
        data-testid={`rail-${item.id}`}
        aria-pressed={item.active}
        // Collapsed, the icon is all there is, so the name has to reach a screen reader and a
        // hover some other way.
        title={collapsed ? label : undefined}
        onClick={item.onToggle}
        className={`group relative flex w-full items-center gap-3 rounded px-2 py-2 text-left text-xs transition ${
          item.active
            ? 'bg-stone-800 font-semibold text-amber-400'
            : 'text-stone-400 hover:bg-stone-800/70 hover:text-stone-100'
        }`}
      >
        <span className="relative flex items-center">
          <Icon id={item.id} />
          {/*
            The badge rides the ICON, not the label, so it survives the rail collapsing — the
            count is the reason this item is worth glancing at, and hiding it in the narrow state
            would remove the only thing that makes the narrow state safe.
          */}
          {item.badge ? (
            <span
              data-testid={`rail-badge-${item.id}`}
              className="absolute -right-2 -top-1.5 min-w-[1.05rem] rounded-full bg-amber-500 px-1 text-center text-[0.6rem] font-bold leading-[1.05rem] text-ink"
            >
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          ) : null}
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
        {collapsed && <span className="sr-only">{label}</span>}
      </button>
    );
  };

  return (
    <nav
      data-testid="nav-rail"
      aria-label={t('rail.heading')}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`flex shrink-0 flex-col gap-1 border-r border-stone-700 bg-stone-900/40 p-2 ${
        collapsed ? 'w-14' : 'w-40'
      }`}
    >
      {main.map(renderItem)}

      <div className="mt-auto flex flex-col gap-1 border-t border-stone-700/70 pt-1">
        {foot.map(renderItem)}
        <button
          type="button"
          data-testid="rail-collapse"
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? t('rail.expand') : t('rail.collapse')}
          className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-xs text-stone-500 transition hover:bg-stone-800/70 hover:text-stone-200"
        >
          <Icon id={collapsed ? 'expand' : 'collapse'} />
          {!collapsed && <span className="truncate">{t('rail.collapse')}</span>}
          <span className="sr-only">{collapsed ? t('rail.expand') : t('rail.collapse')}</span>
        </button>
      </div>
    </nav>
  );
}
