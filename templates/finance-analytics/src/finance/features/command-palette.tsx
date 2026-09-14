import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search, CornerDownLeft, Clock } from "lucide-react";
import { useFocusTrap } from "../hooks/use-focus-trap";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  run: () => void;
  /** Section header this command groups under (e.g. "Views", "Actions"). Default "Actions". */
  group?: string;
  /** Extra terms that should match this command in search (aliases/synonyms). */
  keywords?: string[];
  /** Display-only shortcut hint, e.g. "⌘K". */
  shortcut?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

const RECENTS_KEY = "fabric-standard-cmd-recents";
const RECENTS_MAX = 5;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string) {
  try {
    const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Subsequence fuzzy score: -1 = no match; higher = better. Rewards consecutive
 *  runs and word-boundary hits so "rev" ranks "Refresh" above "Server". */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let score = 0, ti = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) { found = j; break; }
    }
    if (found === -1) return -1;
    if (found === ti) streak++;
    else streak = 0;
    score += 1 + streak * 2;
    if (found === 0 || t[found - 1] === " " || t[found - 1] === "-") score += 3; // word boundary
    ti = found + 1;
  }
  return score;
}

interface Section { title: string | null; items: Command[] }

/** Standardized Ctrl/Cmd+K command palette — accessible combobox with fuzzy
 *  search, grouped results, recents, keyword aliases, arrow-key navigation,
 *  aria-activedescendant, dialog semantics, and focus trapping. */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setRecents(readRecents());
    }
  }, [open]);

  const sections = useMemo<Section[]>(() => {
    const query = q.trim();
    if (query) {
      const ranked = commands
        .map((c) => {
          const hay = [c.label, ...(c.keywords ?? []), c.group ?? ""].join(" ");
          return { c, score: fuzzyScore(query, hay) };
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
      return [{ title: null, items: ranked }];
    }
    const out: Section[] = [];
    if (recents.length) {
      const recentCmds = recents
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Command => Boolean(c));
      if (recentCmds.length) out.push({ title: "Recent", items: recentCmds });
    }
    const groups = new Map<string, Command[]>();
    for (const c of commands) {
      const g = c.group ?? "Actions";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(c);
    }
    for (const [title, items] of groups) out.push({ title, items });
    return out;
  }, [commands, q, recents]);

  // Flatten for keyboard navigation.
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const runCommand = (c: Command) => {
    pushRecent(c.id);
    c.run();
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = flat[active];
      if (cmd) runCommand(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const activeId = flat[active] ? `cmd-opt-${flat[active].id}` : undefined;
  let flatIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/40 pt-[18vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="panel-slide-in flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-e4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search size={16} className="text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-listbox"
            aria-activedescendant={activeId}
            aria-label="Search views and actions"
            placeholder="Search views and actions…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul ref={listRef} id="cmd-listbox" role="listbox" aria-label="Results" className="max-h-72 overflow-auto p-2">
          {flat.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>
          ) : (
            sections.map((section, si) => (
              <li key={si} role="presentation">
                {section.title ? (
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.title === "Recent" ? <Clock size={11} aria-hidden="true" /> : null}
                    {section.title}
                  </div>
                ) : null}
                <ul role="presentation">
                  {section.items.map((c) => {
                    flatIndex++;
                    const isActive = flatIndex === active;
                    return (
                      <li
                        key={c.id}
                        id={`cmd-opt-${c.id}`}
                        role="option"
                        aria-selected={isActive}
                        data-active={isActive}
                      >
                        <div
                          onMouseMove={((idx) => () => setActive(idx))(flatIndex)}
                          onClick={() => runCommand(c)}
                          className={
                            "group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
                            (isActive ? "bg-accent" : "hover:bg-accent")
                          }
                        >
                          {c.icon ? <c.icon size={16} className="text-primary" /> : null}
                          <span className="flex-1 text-left">{c.label}</span>
                          {c.shortcut ? (
                            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.shortcut}</kbd>
                          ) : c.hint ? (
                            <span className="text-xs text-muted-foreground">{c.hint}</span>
                          ) : null}
                          <CornerDownLeft
                            size={14}
                            className={"text-muted-foreground transition-opacity " + (isActive ? "opacity-100" : "opacity-0")}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-border bg-secondary/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 py-0.5 text-[10px]">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 py-0.5 text-[10px]">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 py-0.5 text-[10px]">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
