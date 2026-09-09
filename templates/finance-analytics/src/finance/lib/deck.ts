import type { CellValue, DataTable } from "./types";

/** A KPI tile rendered on the executive-summary slide. */
export interface DeckKpi {
  label: string;
  value: string;
  /** Pre-formatted signed delta, e.g. "+6.2% YoY". */
  delta?: string;
  /** Direction for delta coloring (true = good/up). */
  up?: boolean;
  /** Marks the delta as an illustrative placeholder; disclosed on the slide via
   *  an asterisk on the delta plus a footnote, so an exported deck never presents
   *  a sample figure as a real prior-period number. */
  estimated?: boolean;
}

/** A single chart slide. Rendered as a NATIVE, editable PowerPoint chart — unless
 *  `image` is supplied (a captured Vega snapshot), in which case that exact bitmap
 *  is placed instead, so the slide matches the on-screen Fabric visual pixel-for-pixel. */
export interface DeckChartSpec {
  title: string;
  type: "bar" | "line" | "donut";
  data: { label: string; value: number }[];
  valuePrefix?: string;
  /** Optional pre-rendered image data URL (from `VegaVisualHandle.view.toImageURL()`).
   *  When present, the slide embeds this snapshot instead of a native chart. */
  image?: string;
}

export interface DeckInsight {
  title: string;
  body: string;
}

export type DeckTheme = "dark" | "light";

/** Which slides to emit — driven by the Deck Builder UI / a template preset. */
export interface DeckSections {
  cover: boolean;
  summary: boolean;
  kpis: boolean;
  chart: boolean;
  table: boolean;
  pageNumbers: boolean;
}

export interface DeckSpec {
  reportTitle: string;
  subtitle?: string;
  presenter?: string;
  source?: string;
  classification?: string;
  theme: DeckTheme;
  /** Brand accent hex (with or without leading #). Drives chart series + accents. */
  accent?: string;
  sections: DeckSections;
  kpis?: DeckKpi[];
  chart?: DeckChartSpec;
  insights?: DeckInsight[];
  table: DataTable;
  filename?: string;
}

interface Palette {
  bg: string;
  panel: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  good: string;
  bad: string;
  gridline: string;
}

const SERIES = ["4CC9FF", "7C8CFF", "3DDC97", "F5A524", "FF5C75", "9AA6C4"];

function hex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const h = v.replace(/^#/, "").trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback;
}

function palette(theme: DeckTheme, accent?: string): Palette {
  const a = hex(accent, theme === "dark" ? "4CC9FF" : "0F6CBD");
  return theme === "dark"
    ? { bg: "0B1220", panel: "121A2E", text: "EAF0FB", subtext: "9AA6C4", border: "1F2A44", accent: a, good: "3DDC97", bad: "FF5C75", gridline: "1F2A44" }
    : { bg: "FFFFFF", panel: "F4F6FB", text: "242424", subtext: "616161", border: "E0E0E0", accent: a, good: "0E700E", bad: "C50F1F", gridline: "E8E8E8" };
}

const W = 13.33;
const H = 7.5;
const MX = 0.6;

function fmt(v: CellValue): string {
  return v == null ? "" : String(v);
}

/** Build and download a branded, multi-slide PowerPoint deck with NATIVE
 *  (editable) charts. pptxgenjs is dynamically imported so it never ships until
 *  a deck is actually generated. */
export async function buildDeck(spec: DeckSpec): Promise<{ slides: number; fileName: string }> {
  const { default: Pptx } = await import("pptxgenjs");
  const deck = new Pptx();
  deck.defineLayout({ name: "WIDE", width: W, height: H });
  deck.layout = "WIDE";

  const p = palette(spec.theme, spec.accent);
  let pageNo = 0;
  let slides = 0;

  const newSlide = () => {
    const s = deck.addSlide();
    s.background = { color: p.bg };
    slides += 1;
    pageNo += 1;
    return s;
  };

  const footer = (s: ReturnType<typeof deck.addSlide>) => {
    if (spec.classification) {
      s.addText(spec.classification, { x: MX, y: H - 0.42, w: W - 2 * MX, h: 0.3, fontSize: 9, color: p.subtext, align: "center" } as never);
    }
    if (spec.sections.pageNumbers && pageNo > 1) {
      s.addText(String(pageNo), { x: W - 1.1, y: H - 0.42, w: 0.6, h: 0.3, fontSize: 9, color: p.subtext, align: "right" } as never);
    }
  };

  const heading = (s: ReturnType<typeof deck.addSlide>, title: string, kicker?: string) => {
    s.addShape("rect" as never, { x: 0, y: 0, w: 0.18, h: H, fill: { color: p.accent } } as never);
    if (kicker) {
      s.addText(kicker.toUpperCase(), { x: MX, y: 0.4, w: W - 2 * MX, h: 0.3, fontSize: 11, bold: true, color: p.accent, charSpacing: 2 } as never);
    }
    s.addText(title, { x: MX, y: kicker ? 0.7 : 0.5, w: W - 2 * MX, h: 0.7, fontSize: 26, bold: true, color: p.text } as never);
  };

  // ---- Cover --------------------------------------------------------------
  if (spec.sections.cover) {
    const s = newSlide();
    s.addShape("rect" as never, { x: 0, y: 0, w: W, h: 2.2, fill: { color: p.panel } } as never);
    s.addShape("rect" as never, { x: 0, y: 2.2, w: W, h: 0.06, fill: { color: p.accent } } as never);
    s.addText(spec.reportTitle, { x: MX, y: 2.7, w: W - 2 * MX, h: 1, fontSize: 40, bold: true, color: p.text } as never);
    if (spec.subtitle) {
      s.addText(spec.subtitle, { x: MX, y: 3.8, w: W - 2 * MX, h: 0.6, fontSize: 18, color: p.subtext } as never);
    }
    const meta = [
      spec.presenter ? `Presenter: ${spec.presenter}` : "",
      spec.source ? `Source: ${spec.source}` : "",
      `Generated ${new Date().toLocaleString()}`,
    ].filter(Boolean).join("    ·    ");
    s.addText(meta, { x: MX, y: H - 1.0, w: W - 2 * MX, h: 0.4, fontSize: 11, color: p.subtext } as never);
    footer(s);
  }

  // ---- Key takeaways ------------------------------------------------------
  if (spec.sections.summary && spec.insights && spec.insights.length) {
    const s = newSlide();
    heading(s, "Key takeaways", "Executive summary");
    const bullets = spec.insights.slice(0, 5).map((i) => ({
      text: `${i.title} — ${i.body}`,
      options: { bullet: { code: "2022" }, color: p.text, fontSize: 15, paraSpaceAfter: 12 },
    }));
    s.addText(bullets as never, { x: MX, y: 1.7, w: W - 2 * MX, h: H - 2.4, valign: "top" } as never);
    footer(s);
  }

  // ---- KPI summary --------------------------------------------------------
  if (spec.sections.kpis && spec.kpis && spec.kpis.length) {
    const s = newSlide();
    heading(s, "Performance at a glance", "Headline metrics");
    const kpis = spec.kpis.slice(0, 4);
    const gap = 0.3;
    const tileW = (W - 2 * MX - gap * (kpis.length - 1)) / kpis.length;
    const tileH = 1.9;
    const top = 2.0;
    kpis.forEach((k, i) => {
      const x = MX + i * (tileW + gap);
      s.addShape("roundRect" as never, { x, y: top, w: tileW, h: tileH, rectRadius: 0.12, fill: { color: p.panel }, line: { color: p.border, width: 1 } } as never);
      s.addText(k.label.toUpperCase(), { x: x + 0.2, y: top + 0.2, w: tileW - 0.4, h: 0.3, fontSize: 10, bold: true, color: p.subtext, charSpacing: 1 } as never);
      s.addText(k.value, { x: x + 0.2, y: top + 0.55, w: tileW - 0.4, h: 0.7, fontSize: 30, bold: true, color: p.text } as never);
      if (k.delta) {
        s.addText(`${k.delta}${k.estimated ? " *" : ""}`, { x: x + 0.2, y: top + 1.35, w: tileW - 0.4, h: 0.35, fontSize: 13, bold: true, color: k.up === false ? p.bad : p.good } as never);
      }
    });
    if (kpis.some((k) => k.estimated)) {
      s.addText(
        "* Illustrative comparison — the sample has no time dimension. Connect a live semantic model for real prior-period figures.",
        { x: MX, y: top + tileH + 0.3, w: W - 2 * MX, h: 0.3, fontSize: 9, italic: true, color: p.subtext } as never,
      );
    }
    footer(s);
  }

  // ---- Chart (captured snapshot, else native editable) -------------------
  if (spec.sections.chart && spec.chart && spec.chart.data.length) {
    const s = newSlide();
    heading(s, spec.chart.title, "Visual");
    const box = { x: MX, y: 1.7, w: W - 2 * MX, h: H - 2.6 };
    if (spec.chart.image) {
      // Pixel-perfect snapshot of the on-screen Fabric (Vega) visual — sized to
      // fit the content box while preserving aspect ratio.
      s.addImage({ data: spec.chart.image, ...box, sizing: { type: "contain", ...box } } as never);
    } else {
      const labels = spec.chart.data.map((d) => d.label);
      const values = spec.chart.data.map((d) => d.value);
      const chartData = [{ name: spec.chart.title, labels, values }];
      const common = {
        ...box,
        showLegend: spec.chart.type === "donut",
        legendPos: "r", legendColor: p.text,
        catAxisLabelColor: p.subtext, valAxisLabelColor: p.subtext,
        catGridLine: { color: p.gridline, style: "none" },
        valGridLine: { color: p.gridline },
        chartColors: spec.chart.type === "donut" ? SERIES : [p.accent],
        dataLabelColor: p.text, showValue: false,
      };
      const type = spec.chart.type === "donut" ? "doughnut" : spec.chart.type;
      if (type === "doughnut") {
        s.addChart(type as never, chartData as never, { ...common, holeSize: 60, showPercent: true, dataLabelColor: "FFFFFF" } as never);
      } else {
        s.addChart(type as never, chartData as never, { ...common, barDir: "col" } as never);
      }
    }
    footer(s);
  }

  // ---- Data table (paged across slides — no truncation) -------------------
  if (spec.sections.table && spec.table.columns.length) {
    const ROWS_PER_SLIDE = 14;
    const head = spec.table.columns.map((c) => ({
      text: c.label,
      options: { bold: true, color: "FFFFFF", fill: { color: p.accent } },
    }));
    const totalRows = spec.table.rows.length;
    const pageCount = Math.max(1, Math.ceil(totalRows / ROWS_PER_SLIDE));
    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
      const s = newSlide();
      const kicker = pageCount > 1 ? `Underlying data · ${pageIdx + 1} of ${pageCount}` : "Underlying data";
      heading(s, "Detail", kicker);
      const start = pageIdx * ROWS_PER_SLIDE;
      const slsce = spec.table.rows.slice(start, start + ROWS_PER_SLIDE);
      const body = slsce.map((r) =>
        spec.table.columns.map((c) => ({
          text: fmt(r[c.key]),
          options: { color: p.text, fill: { color: p.bg } },
        })),
      );
      s.addTable([head, ...body] as never, {
        x: MX, y: 1.7, w: W - 2 * MX, fontSize: 11, color: p.text,
        border: { type: "solid", color: p.border, pt: 1 }, valign: "middle",
      } as never);
      const from = start + 1;
      const to = Math.min(start + ROWS_PER_SLIDE, totalRows);
      s.addText(`Rows ${from}–${to} of ${totalRows}`, { x: MX, y: H - 0.75, w: W - 2 * MX, h: 0.3, fontSize: 10, italic: true, color: p.subtext } as never);
      footer(s);
    }
  }

  const name = (spec.filename ?? spec.reportTitle).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "deck";
  const fileName = `${name}.pptx`;
  await deck.writeFile({ fileName });
  return { slides, fileName };
}
