import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MonitorPlay, X, Loader2, Check, TriangleAlert } from "lucide-react";
import type { DataTable } from "../lib/types";
import { buildDeck, type DeckKpi, type DeckChartSpec, type DeckInsight, type DeckSections, type DeckTheme } from "../lib/deck";
import { DECK_TEMPLATES, estimateDeckSlides } from "../lib/deck-templates";
import { useFocusTrap } from "../hooks/use-focus-trap";

export interface DeckBuilderProps {
  open: boolean;
  onClose: () => void;
  /** Cover title (defaults to the app name). */
  reportTitle: string;
  /** Page being exported — used for the default cover subtitle + slide caption. */
  pageLabel: string;
  source?: string;
  classification?: string;
  /** Brand accent hex — drives chart series + slide accents. */
  accent?: string;
  kpis?: DeckKpi[];
  chart?: DeckChartSpec;
  insights?: DeckInsight[];
  table: DataTable;
  filename?: string;
  /** Optional: capture a pixel-perfect snapshot of the on-screen chart (from a
   *  Fabric/Vega visual) to embed instead of a native chart. Returns null if no
   *  capturable visual is mounted, in which case the deck uses a native chart. */
  captureChartImage?: () => Promise<string | null>;
  /** Audit/telemetry hook fired after a deck is generated. */
  onGenerated?: (slides: number) => void;
}

type ThemeChoice = "match" | "dark" | "light";
type Status = "idle" | "working" | "error" | "done";

const THEME_OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: "match", label: "Match app" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

const SECTION_ROWS: { key: keyof DeckSections; label: string; hint: string }[] = [
  { key: "cover", label: "Cover slide", hint: "Title, presenter, source, date" },
  { key: "summary", label: "Key takeaways", hint: "Cited bullets from the intelligence rail" },
  { key: "kpis", label: "KPI summary", hint: "Headline metrics as tiles" },
  { key: "chart", label: "Chart slide", hint: "Snapshot of the Fabric visual, or a native editable chart" },
  { key: "table", label: "Data table", hint: "Underlying rows" },
  { key: "pageNumbers", label: "Page numbers", hint: "Footer slide numbers" },
];

/**
 * The Deck Builder — a report-builder modal for the PowerPoint export. Pick a
 * template, fine-tune which slides are included, set the cover identity and
 * palette, then generate a branded deck with NATIVE, editable charts. Standard
 * across every org app, so every exported deck looks the same.
 */
export function DeckBuilder({
  open, onClose, reportTitle, pageLabel, source, classification, accent,
  kpis = [], chart, insights = [], table, filename, captureChartImage, onGenerated,
}: DeckBuilderProps) {
  const ref = useFocusTrap<HTMLDivElement>(open);
  const [templateId, setTemplateId] = useState(DECK_TEMPLATES[0].id);
  const [sections, setSections] = useState<DeckSections>(DECK_TEMPLATES[0].sections);
  const [theme, setTheme] = useState<ThemeChoice>("match");
  const [coverTitle, setCoverTitle] = useState(reportTitle);
  const [coverSubtitle, setCoverSubtitle] = useState(pageLabel);
  const [presenter, setPresenter] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [hint, setHint] = useState("");
  const [receipt, setReceipt] = useState<{ file: string; slides: number } | null>(null);

  const has = useMemo(
    () => ({ summary: insights.length > 0, kpis: kpis.length > 0, chart: Boolean(chart && chart.data.length), table: table.columns.length > 0 }),
    [insights.length, kpis.length, chart, table.columns.length],
  );

  useEffect(() => {
    if (!open) return;
    setCoverTitle(reportTitle);
    setCoverSubtitle(pageLabel);
    setStatus("idle");
    setHint("");
    setReceipt(null);
  }, [open, reportTitle, pageLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const slideCount = useMemo(() => estimateDeckSlides(sections, has, table.rows.length), [sections, has, table.rows.length]);

  if (!open) return null;

  const applyTemplate = (id: string) => {
    const tpl = DECK_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setSections(tpl.sections);
  };

  const toggle = (key: keyof DeckSections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
    setTemplateId("custom");
  };

  const resolvedTheme = (): DeckTheme =>
    theme === "match" ? (document.documentElement.classList.contains("dark") ? "dark" : "light") : theme;

  const handleGenerate = async () => {
    if (status === "working") return;
    setStatus("working");
    setHint("");
    try {
      // If a Fabric/Vega visual is on screen, embed a pixel-perfect snapshot of it;
      // otherwise buildDeck falls back to a native, editable PowerPoint chart.
      let chartSpec = has.chart ? chart : undefined;
      if (chartSpec && sections.chart && captureChartImage) {
        const image = await captureChartImage();
        if (image) chartSpec = { ...chartSpec, image };
      }
      const result = await buildDeck({
        reportTitle: coverTitle,
        subtitle: coverSubtitle,
        presenter,
        source,
        classification,
        theme: resolvedTheme(),
        accent,
        sections,
        kpis: has.kpis ? kpis : undefined,
        chart: chartSpec,
        insights: has.summary ? insights : undefined,
        table,
        filename: filename ?? coverTitle,
      });
      setStatus("done");
      setReceipt({ file: result.fileName, slides: result.slides });
      onGenerated?.(result.slides);
    } catch {
      setStatus("error");
      setHint("Couldn't build the deck. Check the console for details.");
    }
  };

  return createPortal(
    <div
      className="panel-slide-in fixed inset-0 z-50 flex h-[100dvh] items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="PowerPoint deck builder"
      onClick={onClose}
    >
      <div
        ref={ref}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-l py-m">
          <div className="flex items-center gap-s">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-primary">
              <MonitorPlay size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-300 font-semibold text-foreground">Deck builder</h2>
              <p className="text-100 text-muted-foreground">
                {pageLabel} · {slideCount} slide{slideCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-l overflow-y-auto px-l py-m">
          <section className="flex flex-col gap-s">
            <h3 className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Template</h3>
            <div className="grid grid-cols-2 gap-s">
              {DECK_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className={
                    "rounded-xl border px-m py-s text-left transition-colors " +
                    (templateId === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-foreground hover:bg-accent")
                  }
                >
                  <span className="block text-200 font-medium">{t.label}</span>
                  <span className="mt-xxs block text-100 leading-snug text-muted-foreground">{t.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-s">
            <h3 className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Slides</h3>
            <ul className="flex flex-col gap-xs">
              {SECTION_ROWS.map((row) => {
                const available = row.key === "cover" || row.key === "pageNumbers" || has[row.key as "summary" | "kpis" | "chart" | "table"];
                return (
                  <li key={row.key}>
                    <label
                      className={
                        "flex items-center justify-between gap-s rounded-xl border border-border bg-background px-m py-s " +
                        (available ? "cursor-pointer" : "cursor-not-allowed opacity-50")
                      }
                    >
                      <span className="flex flex-col">
                        <span className="text-200 text-foreground">{row.label}</span>
                        <span className="text-100 text-muted-foreground">
                          {available ? row.hint : "Not available on this page"}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        disabled={!available}
                        checked={available && sections[row.key]}
                        onChange={() => toggle(row.key)}
                        className="size-4 accent-primary"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid grid-cols-1 gap-m sm:grid-cols-2">
            <label className="flex flex-col gap-xxs">
              <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Cover title</span>
              <input
                value={coverTitle}
                onChange={(e) => setCoverTitle(e.target.value)}
                className="rounded-lg border border-border bg-background px-m py-s text-200 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-xxs">
              <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Subtitle</span>
              <input
                value={coverSubtitle}
                onChange={(e) => setCoverSubtitle(e.target.value)}
                className="rounded-lg border border-border bg-background px-m py-s text-200 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-xxs">
              <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Presenter</span>
              <input
                value={presenter}
                onChange={(e) => setPresenter(e.target.value)}
                placeholder="Optional"
                className="rounded-lg border border-border bg-background px-m py-s text-200 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-col gap-xxs">
              <span className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Theme</span>
              <div className="flex gap-xs">
                {THEME_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setTheme(o.id)}
                    className={
                      "flex-1 rounded-lg border px-s py-s text-100 transition-colors " +
                      (theme === o.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent")
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-m border-t border-border px-l py-m">
          <span className={"flex items-center gap-xs text-100 " + (status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {status === "error" ? <TriangleAlert size={14} aria-hidden="true" /> : null}
            {status === "done" ? <Check size={14} className="text-success" aria-hidden="true" /> : null}
            {status === "done" && receipt ? (
              <span className="text-foreground">
                Saved <span className="font-medium">{receipt.file}</span> · {receipt.slides} slide{receipt.slides === 1 ? "" : "s"} to your Downloads
              </span>
            ) : (
              hint || `${slideCount} slide${slideCount === 1 ? "" : "s"} · native charts`
            )}
          </span>
          <div className="flex items-center gap-s">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-background px-l py-s text-200 text-foreground transition-colors hover:bg-accent"
            >
              {status === "done" ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={status === "working" || slideCount === 0}
              className="flex items-center gap-xs rounded-lg bg-primary px-l py-s text-200 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "working" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <MonitorPlay size={15} aria-hidden="true" />}
              {status === "working" ? "Building…" : status === "done" ? "Regenerate" : "Generate deck"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
