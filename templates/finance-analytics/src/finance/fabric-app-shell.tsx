import { useCallback, useEffect, useMemo, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Layers, Sun, Moon, Monitor, Rows2, Rows3, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Menu, X, Search, ChevronDown } from "lucide-react";
import { Tooltip } from "./primitives";
import { useFocusTrap } from "./hooks/use-focus-trap";
import { type ThemeMode, readThemeMode, applyThemeMode, watchSystemTheme } from "./lib/theme";
import { type Density, readDensity, applyDensity } from "./lib/density";
import { btn } from "./lib/recipes";
import { useVisualSelection } from "./lib/visual-selection";

/** Icons are tree-shakeable named imports — only the icons actually used ship. */
type IconType = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  id: string;
  label: string;
  icon?: IconType;
  /** Optional section header — consecutive items sharing a group render under it. */
  group?: string;
  /** Optional count/label pill rendered on the right (e.g. an unread count, "New"). */
  badge?: number | string;
}

export interface FabricAppShellProps {
  /** Per-app config — the chrome stays identical across every org app. */
  appName: string;
  subtitle?: string;
  /** e.g. the semantic model name; shown in the header badge + footer. */
  dataSourceLabel?: string;
  version?: string;
  navItems: NavItem[];
  activeNavId: string;
  onNavChange: (id: string) => void;
  children: ReactNode;
  /** App-specific actions rendered in the header (e.g. export menu, palette trigger). */
  headerActions?: ReactNode;
  /** Optional app-specific pane (e.g. an intelligence rail). */
  rightRail?: ReactNode;
  /** Optional label shown at the top of the right rail. */
  rightRailLabel?: string;
  /** Optional brand mark rendered in the header badge (defaults to the standard logo). */
  brandMark?: ReactNode;
  /** Fired when the user shows intent to open a view (hover/focus) — lets the
   *  runtime prefetch that view's lazy chunk so navigation feels instant. */
  onNavIntent?: (id: string) => void;
  /** Optional working Help link for the footer. When omitted, no Help link renders. */
  helpHref?: string;
  /** Left-hand footer label. Defaults to `appName` so it stays vendor-neutral. */
  footerLabel?: string;
  /** Optional content pinned to the bottom of the sidebar (e.g. account/status/settings). */
  sidebarFooter?: ReactNode;
  /** Show the in-nav filter box once the nav has at least this many items. Default 8. */
  navFilterThreshold?: number;
}

const NAV_KEY = "fabric-standard-nav-collapsed";
const RAIL_KEY = "fabric-standard-rail-collapsed";
const GROUPS_KEY = "fabric-standard-nav-groups-collapsed";

const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"];
const THEME_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  system: { label: "System", icon: Monitor },
  light: { label: "Light", icon: Sun },
  dark: { label: "Dark", icon: Moon },
};

function DensityToggle() {
  const [density, setDensity] = useState<Density>(() => readDensity());

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const compact = density === "compact";
  return (
    <Tooltip content={compact ? "Comfortable spacing" : "Compact spacing"}>
      <button
        onClick={() => setDensity(compact ? "comfortable" : "compact")}
        aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
        aria-pressed={compact}
        className={btn({ variant: "secondary", size: "sm" })}
      >
        {compact ? <Rows3 size={16} aria-hidden="true" /> : <Rows2 size={16} aria-hidden="true" />}
        <span className="hidden sm:inline">{compact ? "Compact" : "Cozy"}</span>
      </button>
    </Tooltip>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());

  useEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  // Follow the OS live while in "system" mode.
  useEffect(() => watchSystemTheme(() => mode, (dark) => {
    document.documentElement.classList.toggle("dark", dark);
  }), [mode]);

  const meta = THEME_META[mode];
  const Icon = meta.icon;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(mode) + 1) % THEME_CYCLE.length];

  return (
    <Tooltip content={`Theme: ${meta.label} · click for ${THEME_META[next].label}`}>
      <button
        onClick={() => setMode(next)}
        aria-label={`Color theme: ${meta.label}. Activate to switch to ${THEME_META[next].label}.`}
        className={btn({ variant: "secondary", size: "sm" })}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="hidden sm:inline">{meta.label}</span>
      </button>
    </Tooltip>
  );
}

function NavBadge({ badge, active }: { badge: number | string; active: boolean }) {
  return (
    <span
      className={
        "ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none " +
        (active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
      }
    >
      {badge}
    </span>
  );
}

function NavFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-2 px-1">
      <Search
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter views…"
        aria-label="Filter views"
        className="w-full rounded-md border border-border bg-background/60 py-1.5 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

type NavListProps = Pick<FabricAppShellProps, "navItems" | "activeNavId" | "onNavChange" | "onNavIntent"> & {
  collapsed: boolean;
  filter?: string;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (group: string) => void;
};

function NavList({
  navItems,
  activeNavId,
  collapsed,
  onNavChange,
  onNavIntent,
  filter = "",
  collapsedGroups,
  onToggleGroup,
}: NavListProps) {
  // Roving focus: Arrow Up/Down + Home/End move focus among the nav buttons
  // (the ARIA pattern for a vertical nav). Only the active item is in the tab
  // order, so Tab enters the list once and arrows walk it.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-nav-item="true"]'),
    );
    if (!buttons.length) return;
    e.preventDefault();
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % buttons.length;
    else next = idx <= 0 ? buttons.length - 1 : idx - 1;
    buttons[next]?.focus();
  };

  const q = filter.trim().toLowerCase();
  const filtering = q.length > 0 && !collapsed;
  const visible = navItems.filter((it) => !filtering || it.label.toLowerCase().includes(q));
  const isGroupCollapsed = (g?: string) => !!g && !collapsed && !filtering && !!collapsedGroups?.has(g);
  const rendered = visible.filter((it) => !isGroupCollapsed(it.group));
  // Single tabbable item (roving tabindex): the active item when rendered, else the first.
  const tabbableId = rendered.some((it) => it.id === activeNavId) ? activeNavId : rendered[0]?.id;

  if (filtering && rendered.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No views match &ldquo;{filter}&rdquo;.</p>;
  }

  let lastGroup: string | undefined;
  return (
    <ul className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
      {visible.map((item) => {
        const active = item.id === activeNavId;
        const Icon = item.icon;
        const intent = onNavIntent ? () => onNavIntent(item.id) : undefined;
        const showGroup = !collapsed && !filtering && !!item.group && item.group !== lastGroup;
        lastGroup = item.group;
        const groupCollapsed = isGroupCollapsed(item.group);
        const hasBadge = item.badge != null && item.badge !== "";
        return (
          <li key={item.id}>
            {showGroup ? (
              onToggleGroup ? (
                <button
                  type="button"
                  onClick={() => onToggleGroup(item.group!)}
                  aria-expanded={!collapsedGroups?.has(item.group!)}
                  className="mt-3 flex w-full items-center gap-1 rounded px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring first:mt-0 motion-reduce:transition-none"
                >
                  <ChevronDown
                    size={12}
                    aria-hidden="true"
                    className={
                      "transition-transform motion-reduce:transition-none " +
                      (collapsedGroups?.has(item.group!) ? "-rotate-90" : "")
                    }
                  />
                  {item.group}
                </button>
              ) : (
                <span className="mt-3 block px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
                  {item.group}
                </span>
              )
            ) : null}
            {groupCollapsed ? null : (
              <Tooltip content={collapsed ? item.label : null} side="right">
                <button
                  data-nav-item="true"
                  onClick={() => onNavChange(item.id)}
                  onMouseEnter={intent}
                  onFocus={intent}
                  aria-current={active ? "page" : undefined}
                  tabIndex={item.id === tabbableId ? 0 : -1}
                  className={
                    "group relative flex w-full items-center gap-3 rounded-lg py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none " +
                    (collapsed ? "justify-center px-0" : "px-3") + " " +
                    (active
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")
                  }
                >
                  {active ? (
                    <span className="nav-accent absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" />
                  ) : null}
                  {Icon ? (
                    <Icon
                      size={18}
                      className={active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}
                    />
                  ) : null}
                  {!collapsed ? <span className="nav-label-in truncate">{item.label}</span> : null}
                  {hasBadge ? (
                    collapsed ? (
                      <span
                        className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <NavBadge badge={item.badge!} active={active} />
                    )
                  ) : null}
                </button>
              </Tooltip>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Locked org chrome. Apps pass config only — they never own the header/footer/nav
 * markup. This becomes the published @finance/fabric-shell. Kept dependency-light
 * (react + tree-shakeable icons) so it stays in the always-loaded main chunk
 * without weighing it down.
 */
export function FabricAppShell({
  appName,
  subtitle,
  dataSourceLabel,
  version = "0.0.0",
  navItems,
  activeNavId,
  onNavChange,
  children,
  headerActions,
  rightRail,
  rightRailLabel = "Intelligence",
  brandMark,
  onNavIntent,
  helpHref,
  footerLabel,
  sidebarFooter,
  navFilterThreshold = 8,
}: FabricAppShellProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof document === "undefined") return false;
    try {
      return localStorage.getItem(NAV_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof document === "undefined") return false;
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [navFilter, setNavFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    if (typeof document === "undefined") return new Set();
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  }, []);

  // Drawer focus trap — inerts the background + cycles Tab while the drawer is open.
  const drawerRef = useFocusTrap<HTMLElement>(mobileNavOpen);
  const railSheetRef = useFocusTrap<HTMLElement>(mobileRailOpen);

  // On small screens the rail is hidden, so surface a drill selection in a bottom
  // sheet: whenever a new visual selection is raised, pop the mobile insights sheet.
  const { selection } = useVisualSelection();
  useEffect(() => {
    if (selection) setMobileRailOpen(true);
  }, [selection]);

  // Close the mobile insights sheet when navigating away.
  useEffect(() => {
    setMobileRailOpen(false);
  }, [activeNavId]);

  const hasGroups = useMemo(() => navItems.some((n) => n.group), [navItems]);
  const showNavFilter = navItems.length >= navFilterThreshold;

  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore persistence failures */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railCollapsed ? "1" : "0");
    } catch {
      /* ignore persistence failures */
    }
  }, [railCollapsed]);

  // Close the mobile drawer whenever the view changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeNavId]);

  // Alt+1..9 jumps to the Nth view — a fast keyboard path that mirrors the ⌘K
  // palette. Skipped when a modifier-free text field is focused so it never
  // hijacks typing.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (mobileNavOpen && e.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key < "1" || e.key > "9") return;
      const target = navItems[Number(e.key) - 1];
      if (target) {
        e.preventDefault();
        onNavChange(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navItems, onNavChange, mobileNavOpen]);


  return (
    <div className="app-canvas flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-e3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-[var(--z-header)] flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur-md shadow-[0_1px_0_0_rgba(255,255,255,0.04),0_4px_16px_-6px_rgba(0,0,0,0.5)] sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <Menu size={18} />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-brand-foreground text-primary-foreground shadow-sm">
            {brandMark ?? <Layers size={18} />}
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-base font-semibold tracking-tight">{appName}</span>
            {subtitle ? <span className="hidden truncate text-xs text-muted-foreground lg:block">{subtitle}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {dataSourceLabel ? (
            <span className="hidden items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs text-secondary-foreground lg:flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
              </span>
              {dataSourceLabel}
            </span>
          ) : null}
          {headerActions}
          <DensityToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1760px] flex-1">
        {/* Desktop sidebar */}
        <nav
          aria-label="Views"
          className={
            "hidden shrink-0 flex-col border-r border-border/70 bg-card/40 py-5 backdrop-blur-sm transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:sticky lg:top-[var(--fabric-header-h)] lg:max-h-[calc(100dvh-var(--fabric-header-h))] lg:self-start " +
            (collapsed ? "w-[68px] px-2" : "w-60 px-3")
          }
        >
          <div className="flex items-center justify-between px-2 pb-2">
            {!collapsed ? (
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Views</span>
            ) : null}
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-pressed={collapsed}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          {!collapsed && showNavFilter ? <NavFilter value={navFilter} onChange={setNavFilter} /> : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NavList
              navItems={navItems}
              activeNavId={activeNavId}
              collapsed={collapsed}
              onNavChange={onNavChange}
              onNavIntent={onNavIntent}
              filter={collapsed ? "" : navFilter}
              collapsedGroups={collapsedGroups}
              onToggleGroup={hasGroups ? toggleGroup : undefined}
            />
          </div>
          {sidebarFooter && !collapsed ? (
            <div className="mt-2 border-t border-border/60 px-1 pt-3">{sidebarFooter}</div>
          ) : null}
        </nav>

        {/* Mobile drawer */}
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-[var(--z-nav)] lg:hidden">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <nav
              ref={drawerRef}
              aria-label="Views"
              className="panel-slide-in absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card px-3 py-5 shadow-e4"
            >
              <div className="flex items-center justify-between px-2 pb-2">
                <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Views</span>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={16} />
                </button>
              </div>
              {showNavFilter ? <NavFilter value={navFilter} onChange={setNavFilter} /> : null}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavList
                  navItems={navItems}
                  activeNavId={activeNavId}
                  collapsed={false}
                  onNavChange={onNavChange}
                  onNavIntent={onNavIntent}
                  filter={navFilter}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={hasGroups ? toggleGroup : undefined}
                />
              </div>
              {sidebarFooter ? (
                <div className="mt-2 border-t border-border/60 px-1 pt-3">{sidebarFooter}</div>
              ) : null}
            </nav>
          </div>
        ) : null}

        <main id="main-content" key={activeNavId} className="page-enter min-w-0 flex-1 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
          {children}
        </main>

        {rightRail ? (
          <aside
            className={
              "hidden shrink-0 border-l border-border/70 bg-card/40 backdrop-blur-sm transition-[width] duration-200 motion-reduce:transition-none lg:flex lg:flex-col lg:sticky lg:top-[var(--fabric-header-h)] lg:max-h-[calc(100dvh-var(--fabric-header-h))] lg:self-start " +
              (railCollapsed ? "w-12 px-1 py-5" : "w-80 px-4 py-4")
            }
          >
            <div className={"flex shrink-0 items-center pb-3 " + (railCollapsed ? "justify-center" : "justify-between")}>
              {!railCollapsed ? (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{rightRailLabel}</span>
              ) : null}
              <button
                onClick={() => setRailCollapsed((c) => !c)}
                aria-label={railCollapsed ? "Expand intelligence rail" : "Collapse intelligence rail"}
                aria-pressed={railCollapsed}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {railCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
              </button>
            </div>
            {!railCollapsed ? <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">{rightRail}</div> : null}
          </aside>
        ) : null}

        {/* Mobile insights: the desktop rail is hidden below lg, so drill selections
            surface here in a bottom sheet, toggled by a floating button. */}
        {rightRail ? (
          <>
            <button
              type="button"
              onClick={() => setMobileRailOpen(true)}
              aria-label={`Open ${rightRailLabel}`}
              className="fixed bottom-4 right-4 z-[var(--z-nav)] flex h-12 w-12 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-e4 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <PanelRightOpen size={20} />
            </button>
            {mobileRailOpen ? (
              <div className="fixed inset-0 z-[var(--z-nav)] lg:hidden">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setMobileRailOpen(false)}
                  aria-hidden="true"
                />
                <aside
                  ref={railSheetRef}
                  aria-label={rightRailLabel}
                  className="panel-slide-in absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-6 pt-4 shadow-e4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{rightRailLabel}</span>
                    <button
                      type="button"
                      onClick={() => setMobileRailOpen(false)}
                      aria-label="Close insights"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {rightRail}
                </aside>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-card/60 px-4 py-2.5 text-xs text-muted-foreground backdrop-blur sm:px-6">
        <span className="truncate font-medium">{footerLabel ?? appName}</span>
        <span className="hidden text-muted-foreground sm:inline">
          v{version}
          {dataSourceLabel ? ` · ${dataSourceLabel}` : ""}
        </span>
        {helpHref ? (
          <a className="shrink-0 text-primary hover:underline" href={helpHref} target="_blank" rel="noreferrer">
            Help
          </a>
        ) : (
          <span className="shrink-0" />
        )}
      </footer>
    </div>
  );
}
