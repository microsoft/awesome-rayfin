// landingPage.ts — generate and inject an HTML landing page into a report.
//
// Mirrors the hand-crafted Hochschul-Insights landing page: a single full-bleed
// "HTML Content" custom visual on a new first page, bound to a report-level
// extension measure ("Landingpage") whose DAX expression is the page's HTML
// rendered as a string literal.
//
// The whole feature is REPORT-ONLY — no semantic-model write. One
// `saveDefinitionParts('report', …)` call lays down (or updates) five parts:
//   1. definition/reportExtensions.json      — the Landingpage measure
//   2. definition/pages/{pageId}/page.json   — a new 1920×1080 first page
//   3. …/visuals/{visualId}/visual.json      — the HTML Content visual
//   4. definition/pages/pages.json           — prepend page, make it active
//   5. definition/report.json                — register the public custom visual
//
// Two flavours build the HTML:
//   • template — deterministic, built from the report's pages + top measures
//   • AI       — a github_landing_html UDF authors a bespoke page
//
// CSS in the generated fragment is scoped under `.landing-root` so it cannot
// leak into the host page.

import { loadDefinitionParts, saveDefinitionParts, loadReportDefinition, executeDax } from './fabricRest';
import { loadMeasures } from './measureEditor';
import { udf } from './udfClient';
import { getGithubToken } from './githubAuth';
import { GithubAuthRequiredError } from './mCommenter';

/** Marketplace GUID of the "HTML Content" custom visual. */
const HTML_CONTENT_VISUAL = 'htmlContent443BE3AD55E043BF878BED274D3A6855';

const SCHEMA_PAGE = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json';
const SCHEMA_VISUAL = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.8.0/schema.json';
const SCHEMA_PAGES = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json';
const SCHEMA_EXT = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/reportExtension/1.0.0/schema.json';

const PAGE_W = 1920;
const PAGE_H = 1080;

type ObjMap = Record<string, unknown>;

export interface LandingKpi {
  label: string;
  value: string;
}

/** Everything the HTML builders (template + AI) need about the report. */
export interface LandingContext {
  title: string;
  subtitle: string;
  pages: string[];
  kpis: LandingKpi[];
  accent: string;
  ink: string;
}

export interface InjectResult {
  pageId: string;
  visualId: string;
  /** Number of parts written. */
  parts: number;
  detail: string;
}

/* ------------------------------------------------------------------ *
 * Context gathering
 * ------------------------------------------------------------------ */

function escDaxName(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

function formatKpiValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return String(v);
}

/**
 * Build a {@link LandingContext} from the report's visible pages, the bound
 * model's top measures (evaluated for current KPI values) and a best-effort
 * accent colour pulled from the report's registered theme. Every lookup is
 * resilient: missing data degrades gracefully rather than throwing.
 */
export async function gatherLandingContext(
  workspaceId: string,
  reportId: string,
  reportName: string | undefined,
  datasetId: string | undefined
): Promise<LandingContext> {
  const title = (reportName || 'Report').trim();

  // --- pages (visible, in display order) ---
  let pages: string[] = [];
  try {
    const def = await loadReportDefinition(workspaceId, reportId);
    pages = Object.values(def.pages)
      .filter((p) => !p.hidden)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((p) => p.displayName)
      .filter((n) => !!n)
      .slice(0, 8);
  } catch {
    /* no pages → headline-only hero */
  }

  // --- KPIs (up to 4 measures, evaluated in one query) ---
  const kpis: LandingKpi[] = [];
  if (datasetId) {
    try {
      const { measures } = await loadMeasures(workspaceId, datasetId);
      const picked = pickKpiMeasures(measures.map((m) => m.values.name));
      if (picked.length) {
        const projections = picked
          .map((name, i) => `"k${i}", ${escDaxName(name)}`)
          .join(', ');
        try {
          const rows = await executeDax(workspaceId, datasetId, `EVALUATE ROW(${projections})`);
          const row = rows[0] ?? {};
          picked.forEach((name, i) => {
            const cell = row[`[k${i}]`] ?? row[`k${i}`];
            kpis.push({ label: name, value: formatKpiValue(cell) });
          });
        } catch {
          // Evaluation failed (e.g. measures need filter context) — show the
          // measure names as tiles without live values.
          picked.forEach((name) => kpis.push({ label: name, value: '—' }));
        }
      }
    } catch {
      /* no measures → no KPI tiles */
    }
  }

  // --- accent colour (best effort from the report theme) ---
  let accent = '#2563eb';
  const ink = '#0b1d3a';
  try {
    const parts = await loadDefinitionParts('report', workspaceId, reportId);
    for (const part of parts) {
      if (part.binary) continue;
      if (!/RegisteredResources\/.*\.json$/i.test(part.path)) continue;
      try {
        const theme = JSON.parse(part.text) as ObjMap;
        const dc = theme.dataColors;
        if (Array.isArray(dc) && typeof dc[0] === 'string' && /^#[0-9a-f]{3,8}$/i.test(dc[0])) {
          accent = dc[0];
          break;
        }
      } catch {
        /* not a theme json */
      }
    }
  } catch {
    /* keep default accent */
  }

  return {
    title,
    subtitle: pages.length
      ? `Interactive insights across ${pages.length} report ${pages.length === 1 ? 'page' : 'pages'}.`
      : 'Interactive insights at a glance.',
    pages,
    kpis,
    accent,
    ink,
  };
}

/** Prefer measures whose name reads like a headline metric; fall back to the
 *  first few. Returns at most four names. */
function pickKpiMeasures(names: string[]): string[] {
  const re = /total|sum|count|avg|average|amount|revenue|sales|umsatz|anzahl|summe|durchschnitt|#/i;
  const preferred = names.filter((n) => re.test(n));
  const ordered = [...preferred, ...names.filter((n) => !preferred.includes(n))];
  return ordered.slice(0, 4);
}

/* ------------------------------------------------------------------ *
 * HTML builders
 * ------------------------------------------------------------------ */

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deterministic landing page built from the report context — a full-bleed hero
 * headline, optional KPI tiles and a card grid of the report's pages. Output is
 * a single `<div class="landing-root">…</div>` fragment with scoped CSS.
 */
export function buildTemplateHtml(ctx: LandingContext): string {
  const kpiTiles = ctx.kpis.length
    ? `<div class="lp-kpis">${ctx.kpis
        .map(
          (k) =>
            `<div class="lp-kpi"><div class="lp-kpi-val">${escHtml(k.value)}</div><div class="lp-kpi-lbl">${escHtml(
              k.label
            )}</div></div>`
        )
        .join('')}</div>`
    : '';

  const pageCards = ctx.pages.length
    ? `<div class="lp-cards">${ctx.pages
        .map(
          (p, i) =>
            `<div class="lp-card"><div class="lp-card-no">${String(i + 1).padStart(
              2,
              '0'
            )}</div><div class="lp-card-name">${escHtml(p)}</div></div>`
        )
        .join('')}</div>`
    : '';

  return `<div class="landing-root">
<style>
.landing-root *{box-sizing:border-box;margin:0;padding:0;}
.landing-root{--ink:${ctx.ink};--accent:${ctx.accent};font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#fff;}
.landing-root .lp-stage{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:7% 8%;background:radial-gradient(120% 120% at 12% 0%,color-mix(in srgb,var(--accent) 26%,var(--ink)) 0%,var(--ink) 60%);overflow:hidden;}
.landing-root .lp-stage::after{content:"";position:absolute;right:-12%;top:-18%;width:46%;height:80%;background:radial-gradient(circle at center,color-mix(in srgb,var(--accent) 55%,transparent) 0%,transparent 70%);opacity:.55;}
.landing-root .lp-eyebrow{display:inline-flex;align-items:center;gap:.6em;font-size:1.1rem;letter-spacing:.28em;text-transform:uppercase;color:color-mix(in srgb,var(--accent) 70%,#fff);font-weight:600;margin-bottom:1.4rem;}
.landing-root .lp-eyebrow::before{content:"";width:2.4em;height:3px;background:var(--accent);border-radius:2px;}
.landing-root .lp-title{font-size:5.2rem;line-height:1.04;font-weight:800;max-width:18ch;letter-spacing:-.01em;}
.landing-root .lp-sub{margin-top:1.4rem;font-size:1.7rem;color:rgba(255,255,255,.78);max-width:42ch;font-weight:400;}
.landing-root .lp-kpis{display:flex;gap:1.4rem;margin-top:3rem;flex-wrap:wrap;}
.landing-root .lp-kpi{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:1.5rem 2rem;min-width:200px;backdrop-filter:blur(6px);}
.landing-root .lp-kpi-val{font-size:2.9rem;font-weight:800;color:var(--accent);}
.landing-root .lp-kpi-lbl{margin-top:.4rem;font-size:1.05rem;color:rgba(255,255,255,.72);}
.landing-root .lp-cards{display:flex;gap:1.2rem;margin-top:3.4rem;flex-wrap:wrap;}
.landing-root .lp-card{position:relative;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-left:4px solid var(--accent);border-radius:14px;padding:1.3rem 1.6rem;min-width:230px;}
.landing-root .lp-card-no{font-size:.95rem;color:var(--accent);font-weight:700;letter-spacing:.1em;}
.landing-root .lp-card-name{margin-top:.5rem;font-size:1.45rem;font-weight:600;}
</style>
<div class="lp-stage">
  <div class="lp-eyebrow">Power BI</div>
  <div class="lp-title">${escHtml(ctx.title)}</div>
  <div class="lp-sub">${escHtml(ctx.subtitle)}</div>
  ${kpiTiles}
  ${pageCards}
</div>
</div>`;
}

/**
 * AI-authored landing page. Calls the `github_landing_html` UDF with the report
 * context. Requires a GitHub sign-in (throws {@link GithubAuthRequiredError}
 * when no token is held).
 */
export async function buildAiHtml(ctx: LandingContext): Promise<string> {
  const token = getGithubToken();
  if (!token) throw new GithubAuthRequiredError();
  const { html } = await udf.githubLandingHtml(token, {
    title: ctx.title,
    subtitle: ctx.subtitle,
    pages: ctx.pages,
    kpis: ctx.kpis,
    accent: ctx.accent,
    ink: ctx.ink,
  });
  const trimmed = (html || '').trim();
  if (!trimmed) throw new Error('The AI returned an empty landing page.');
  // Ensure the AI fragment is scoped so its CSS cannot leak.
  return /class\s*=\s*["']landing-root/.test(trimmed)
    ? trimmed
    : `<div class="landing-root">${trimmed}</div>`;
}

/* ------------------------------------------------------------------ *
 * HTML → DAX measure expression
 * ------------------------------------------------------------------ */

/** Convert an HTML fragment into the DAX string-literal expression used by the
 *  Landingpage measure: a leading newline, then the HTML wrapped in double
 *  quotes with every `"` doubled (DAX escaping). */
export function htmlToDaxExpression(html: string): string {
  return `\n"${html.replace(/"/g, '""')}"`;
}

/* ------------------------------------------------------------------ *
 * Injection
 * ------------------------------------------------------------------ */

function randomId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parse(text: string): ObjMap | null {
  try {
    return JSON.parse(text) as ObjMap;
  } catch {
    return null;
  }
}

/** Upsert the Landingpage extension measure into a reportExtensions document
 *  (creating the document/entity/measure as needed). */
function buildReportExtensions(existing: ObjMap | null, daxExpression: string): ObjMap {
  const doc: ObjMap = existing
    ? (JSON.parse(JSON.stringify(existing)) as ObjMap)
    : { $schema: SCHEMA_EXT, name: 'extension', entities: [] };
  if (!doc.$schema) doc.$schema = SCHEMA_EXT;
  if (!doc.name) doc.name = 'extension';

  const entities = Array.isArray(doc.entities) ? (doc.entities as ObjMap[]) : [];
  let entity = entities.find((e) => e.name === 'Measure');
  if (!entity) {
    entity = { name: 'Measure', measures: [] };
    entities.push(entity);
  }
  const measures = Array.isArray(entity.measures) ? (entity.measures as ObjMap[]) : [];
  const measure: ObjMap = {
    name: 'Landingpage',
    dataType: 'Double',
    expression: daxExpression,
    formatString: 'General Number',
    displayFolder: 'Meta',
  };
  const idx = measures.findIndex((m) => m.name === 'Landingpage');
  if (idx >= 0) measures[idx] = measure;
  else measures.push(measure);
  entity.measures = measures;
  doc.entities = entities;
  return doc;
}

function buildPageJson(pageId: string, displayName: string): ObjMap {
  return {
    $schema: SCHEMA_PAGE,
    name: pageId,
    displayName,
    displayOption: 'FitToPage',
    height: PAGE_H,
    width: PAGE_W,
  };
}

function buildVisualJson(visualId: string): ObjMap {
  const measureField = {
    Measure: {
      Expression: { SourceRef: { Schema: 'extension', Entity: 'Measure' } },
      Property: 'Landingpage',
    },
  };
  return {
    $schema: SCHEMA_VISUAL,
    name: visualId,
    position: { x: 0, y: 0, z: 0, height: PAGE_H, width: PAGE_W, tabOrder: 0 },
    visual: {
      visualType: HTML_CONTENT_VISUAL,
      query: {
        queryState: {
          content: {
            projections: [
              {
                field: { ...measureField },
                queryRef: 'Measure.Landingpage',
                nativeQueryRef: 'Landingpage',
              },
            ],
          },
        },
        sortDefinition: {
          sort: [{ field: { ...measureField }, direction: 'Descending' }],
          isDefaultSort: true,
        },
      },
      visualContainerObjects: {
        border: [{ properties: { show: { expr: { Literal: { Value: 'false' } } } } }],
        background: [{ properties: { show: { expr: { Literal: { Value: 'true' } } } } }],
      },
      drillFilterOtherVisuals: true,
    },
  };
}

/**
 * Inject the landing page into the report: write/patch the five definition
 * parts in a single `saveDefinitionParts` call. Existing reportExtensions.json,
 * pages.json and report.json are merged (not clobbered); the page + visual are
 * brand-new parts. The new page becomes the active first page.
 */
export async function injectLandingPage(
  workspaceId: string,
  reportId: string,
  html: string,
  pageDisplayName = 'Home'
): Promise<InjectResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);

  const extPart = parts.find((p) => !p.binary && /definition\/reportExtensions\.json$/.test(p.path));
  const pagesPart = parts.find((p) => !p.binary && /definition\/pages\/pages\.json$/.test(p.path));
  const reportPart = parts.find((p) => !p.binary && /definition\/report\.json$/.test(p.path));
  if (!pagesPart) throw new Error('Could not locate definition/pages/pages.json in the report.');
  if (!reportPart) throw new Error('Could not locate definition/report.json in the report.');

  const pageId = randomId();
  const visualId = randomId();
  const edits: Record<string, string> = {};

  // 1. reportExtensions.json (the Landingpage measure)
  const extPath = extPart?.path ?? 'definition/reportExtensions.json';
  const extDoc = buildReportExtensions(
    extPart ? parse(extPart.text) : null,
    htmlToDaxExpression(html)
  );
  edits[extPath] = JSON.stringify(extDoc, null, 2);

  // 2. new page.json
  edits[`definition/pages/${pageId}/page.json`] = JSON.stringify(
    buildPageJson(pageId, pageDisplayName),
    null,
    2
  );

  // 3. new visual.json
  edits[`definition/pages/${pageId}/visuals/${visualId}/visual.json`] = JSON.stringify(
    buildVisualJson(visualId),
    null,
    2
  );

  // 4. pages.json — prepend the new page and make it active
  const pagesDoc = parse(pagesPart.text) ?? { $schema: SCHEMA_PAGES };
  const order = Array.isArray(pagesDoc.pageOrder) ? (pagesDoc.pageOrder as string[]) : [];
  pagesDoc.pageOrder = [pageId, ...order.filter((id) => id !== pageId)];
  pagesDoc.activePageName = pageId;
  if (!pagesDoc.$schema) pagesDoc.$schema = SCHEMA_PAGES;
  edits[pagesPart.path] = JSON.stringify(pagesDoc, null, 2);

  // 5. report.json — register the HTML Content public custom visual
  const reportDoc = parse(reportPart.text);
  if (!reportDoc) throw new Error('definition/report.json is not valid JSON.');
  const pcv = Array.isArray(reportDoc.publicCustomVisuals)
    ? (reportDoc.publicCustomVisuals as string[])
    : [];
  if (!pcv.includes(HTML_CONTENT_VISUAL)) pcv.push(HTML_CONTENT_VISUAL);
  reportDoc.publicCustomVisuals = pcv;
  edits[reportPart.path] = JSON.stringify(reportDoc, null, 2);

  await saveDefinitionParts('report', workspaceId, reportId, edits);

  return {
    pageId,
    visualId,
    parts: Object.keys(edits).length,
    detail: `Added landing page "${pageDisplayName}" as the first page (${Object.keys(edits).length} parts written).`,
  };
}
