/**
 * The annex.
 *
 * 🔴 PLAN §13 tier 1 #3, and the value is in the timing rather than the technology: **the demo ends
 * when the meeting ends.** Everything the app can say is on screen for as long as the tab is open
 * and then gone, while the people who actually decide were usually not in the room. This produces
 * the artefact that gets forwarded to them.
 *
 * That places one hard constraint on what goes in it. An annex that quotes a percentage without
 * the configuration that produced it, the definitions behind it and the caveats around it is
 * **worse than nothing** — it is a number that cannot be checked, circulating under our name.
 * So the report carries, in this order:
 *
 *   * what was configured (every site, every height, the AOI, the day);
 *   * what was measured (traffic, network resilience, area);
 *   * **what was missed**, passage by passage, because "we did not see these" is the honest half
 *     of "we saw those";
 *   * how the figures are defined, in the same words the app uses;
 *   * what the model does not contain, and where the data came from.
 *
 * It is deliberately a **single self-contained HTML file** rather than a PDF: no dependency, no
 * bundle cost, opens anywhere, and prints to PDF from any browser. The same numbers are embedded
 * as JSON at the end so the annex is machine-checkable rather than merely readable.
 */

import type { NetworkCoverage } from "./network";
import { compareVariants, observedShare, redundantShare, variantCost, worstCaseLossShare,
         type Variant } from "./variants";

export interface ReportSite {
  /** 1-based, matching the panel the reader saw. */
  index: number;
  lat: number;
  lon: number;
  /**
   * The LOS grid cell this site occupies.
   *
   * 🔴 Carried so a committed plan can be restored **exactly**. The solver addresses cells, not
   * coordinates; re-deriving a cell from the rounded lat/lon above would move the mast by up to
   * half a cell, and every figure in the report follows from where the mast stands.
   */
  col: number;
  row: number;
  mastM: number;
  groundM: number;
  eyeM: number;
  horizonKm: number;
  observedPassages: number;
  uniquePassages: number;
}

export interface ReportMissedPassage {
  /** MMSI when the day carries identity, otherwise a salted pseudonym. */
  vessel: string;
  /** As transmitted. Absent when no static report was received for this passage. */
  name?: string;
  type: string;
  fromUtc: string;
  toUtc: string;
  minutesInArea: number;
  distanceKm: number;
  /** Closest this passage came to any site, in km. The difference between a near miss and a gap. */
  nearestSiteKm: number | null;
}

export interface ReportModel {
  generatedUtc: string;
  aoiName: string;
  scenario: "maritime" | "counterUas";
  trackDate: string;
  targetM: number;
  sites: ReportSite[];
  traffic: {
    passages: number;
    observedPassages: number;
    missedPassages: number;
    passageShare: number;
    positionShare: number;
  } | null;
  network: NetworkCoverage | null;
  areaVisibleKm2: number;
  areaShadowedKm2: number;
  missed: ReportMissedPassage[];
  /** Cap applied to the missed table, so a 200-row annex does not bury its own summary. */
  missedShown: number;
  /**
   * Passages excluded from every figure in this report because they never went anywhere.
   *
   * 🔴 Disclosed rather than silent. A moored vessel transmits all day and the 20-minute gap rule
   * splits that into several counted "passages" — one tug tied up in the harbour produced eight.
   * Counting them made the app report 46 missed passages on a day when about four transits were
   * actually missed, which understates a real system. They are now out of the denominator, and a
   * document that changes a denominator without saying so is not a document anyone should trust.
   */
  excludedStationary: number;
  /** Distance a passage must travel to count, in km. */
  stationaryBelowKm: number;
  /**
   * What this site's blocking surface is made of, straight from the built descriptor.
   *
   * 🔴 Carried rather than assumed, because it differs per site and the annex must say which. A
   * surface without the measured top makes every figure in the document an upper bound, and that
   * is the difference between a defensible number and a misleading one.
   */
  surface: {
    includesBuildings: boolean;
    includesVegetation: boolean;
    vegetationStats?: {
      cellsRaised: number;
      medianLiftM: number;
      p90LiftM: number;
    } | null;
  } | null;
  /**
   * Saved configurations to compare, if any.
   *
   * This is what turns the annex from a report into a decision document: one configuration says
   * whether a design works, two say which to buy.
   */
  variants: Variant[];
}

/**
 * ⚠️ Everything interpolated into the HTML goes through here.
 *
 * Vessel type strings come from a public AIS feed, which makes them untrusted input by definition.
 * A report is a file people open and forward, so an unescaped `<` in a type string would be an
 * injection into a document carrying our name on it.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const pct = (value: number) => `${(value * 100).toFixed(0)}\u00a0%`;
const num = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");

/** Seconds since 00:00 UTC → HH:MM. The tracks are stored against that origin. */
export function clockUtc(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The caveats, verbatim from what the app shows on screen.
 *
 * Kept in one place and repeated into the annex rather than summarised for it: a caveat that is
 * softened on the way into the document that outlives the meeting is the one that will be quoted
 * back later.
 *
 * 🔴 Everything here is true of **every** site, which is why it can be a constant. The one caveat
 * that is not — what the blocking surface contains — is built per report by `vegetationCaveat`
 * below. It used to live in this array as a literal quoting one AOI's figures, and a second site
 * whose surface had no vegetation at all exported that claim unchanged, into the document most
 * likely to be forwarded and least likely to be checked.
 */
export const REPORT_CAVEATS: string[] = [
  "<strong>Geometrie, kein Radarmodell.</strong> Sichtlinie gegen ein gemessenes Geländemodell "
  + "bei Standardrefraktion (4/3-Erdradius). Ohne Rückstreuquerschnitt, Seegangsclutter, "
  + "Mehrwegeausbreitung, Ducting oder Entdeckungswahrscheinlichkeit.",
  "<strong>Standorte sind frei gesetzt und fiktiv.</strong> Es wird keine reale Anlage "
  + "dargestellt, und aus der Platzierung folgt keine Aussage über bestehende Installationen.",
  "<strong>Gelände unverzerrt.</strong> Keine Überhöhung; die Höhen sind echte Meter über NHN "
  + "(DHHN2016).",
  "<strong>Nenner.</strong> Fahrten, die das Modellgebiet nie erreichen, werden ausgeschlossen und "
  + "nicht als verpasst gezählt — ein Standort kann für Verkehr, der nie vor ihm lag, nicht "
  + "verantwortlich gemacht werden.",
  "<strong>Kennungen wie veröffentlicht.</strong> MMSI, Schiffsname, Rufzeichen, IMO-Nummer und "
  + "Ziel werden von jedem Schiff offen ausgestrahlt und vom dänischen Seeamt frei "
  + "veröffentlicht; dieser Bericht gibt sie unverändert wieder. Fahrten ohne Namen sind nicht "
  + "anonymisiert — für sie wurde im Modellgebiet keine AIS-Statusmeldung empfangen.",
  "<strong>Demonstrations- und Anschauungszweck.</strong> Keine Navigationsgrundlage und keine "
  + "verbindliche Verkehrs- oder Seeraumauskunft.",
];

/** What this site's blocking surface actually contains — measured, never assumed. */
export function vegetationCaveat(surface: ReportModel["surface"]): string {
  if (!surface?.includesVegetation || !surface.vegetationStats) {
    return "<strong>Kein Bewuchs im Modell.</strong> Blockierend sind nur Gelände und Gebäude. "
      + "Die ausgewiesene Sicht ist deshalb eine <strong>Obergrenze</strong> — Bewuchs kann "
      + "Sichtlinien ausschließlich zusätzlich blockieren, nie freigeben.";
  }
  const { cellsRaised, medianLiftM, p90LiftM } = surface.vegetationStats;
  const millions = (cellsRaised / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  return "<strong>Bewuchs enthalten.</strong> Blockierend sind Gelände, Gebäude und die gemessene "
    + `Oberfläche (bDOM 20\u00a0cm). Der Bewuchs hebt ${millions}\u00a0Mio. Zellen über die `
    + `Gebäudehöhe hinaus an, im Median um ${medianLiftM.toLocaleString("de-DE")}\u00a0m, im `
    + `90.\u00a0Perzentil um ${p90LiftM.toLocaleString("de-DE")}\u00a0m. Über Wasser wird die `
    + "gemessene Oberfläche verworfen, weil Bildmatching dort Wellentextur liefert.";
}

export const REPORT_SOURCES: { label: string; detail: string }[] = [
  {
    label: "Gelände und Gebäude",
    detail: "DGM1 und LoD2, Landesamt für Vermessung und Geoinformation Schleswig-Holstein "
      + "(LVermGeo SH), CC BY 4.0 [Daten bearbeitet]",
  },
  {
    label: "Horizont",
    detail: "Copernicus DEM GLO-30 — © DLR e.V. 2010–2014 und © Airbus Defence and Space GmbH "
      + "2014–2018, bereitgestellt unter COPERNICUS durch die Europäische Union und die ESA",
  },
  {
    label: "Schiffsverkehr",
    detail: "Danish Maritime Authority, historisches AIS-Archiv (aisdata.ais.dk), frei verfügbar",
  },
  {
    label: "Schutzobjekte",
    detail: "© OpenStreetMap-Mitwirkende, ODbL 1.0",
  },
];

/** How each headline figure is defined. Stated so the annex can be argued with, not just read. */
export const REPORT_DEFINITIONS: { term: string; meaning: string }[] = [
  {
    term: "Fahrt beobachtet",
    meaning: "Mindestens eine Position der Fahrt liegt in einer Zelle, die das Modell als "
      + "einsehbar ausweist.",
  },
  {
    term: "Welche Fahrten zählen",
    meaning: "Nur Fahrten, die mindestens 0,5 km zurückgelegt haben. Liegende Fahrzeuge senden "
      + "den ganzen Tag und würden sonst als verpasster Verkehr erscheinen.",
  },
  {
    term: "Meldungen beobachtet",
    meaning: "Anteil aller Einzelpositionen in einsehbaren Zellen — also wie durchgehend eine "
      + "Fahrt gehalten wird, nicht nur ob sie einmal gesehen wurde.",
  },
  {
    term: "Doppelt abgedeckt",
    meaning: "Fahrten, die von zwei oder mehr Standorten gesehen werden. Sie bleiben beobachtet, "
      + "wenn ein Standort ausfällt.",
  },
  {
    term: "Exklusiv",
    meaning: "Fahrten, die nur ein einziger Standort sieht. Entfällt dieser Standort, werden sie "
      + "von nichts mehr beobachtet.",
  },
  {
    term: "Schlechtester Einzelausfall",
    meaning: "Der größte Verlust an beobachteten Fahrten, den der Ausfall eines einzelnen "
      + "Standorts verursachen würde.",
  },
];

/** Build the annex as one self-contained HTML document. */
export function renderReportHtml(model: ReportModel): string {
  const t = model.traffic;
  const n = model.network;

  const siteRows = model.sites.map((s) => `
      <tr>
        <td>Standort ${s.index}</td>
        <td class="n">${num(s.lat, 5)}, ${num(s.lon, 5)}</td>
        <td class="n">${s.mastM}\u00a0m</td>
        <td class="n">${num(s.groundM)}\u00a0m</td>
        <td class="n">${num(s.eyeM)}\u00a0m</td>
        <td class="n">${num(s.horizonKm)}\u00a0km</td>
        <td class="n">${s.observedPassages}</td>
        <td class="n ${s.uniquePassages ? "good" : "warn"}">${s.uniquePassages}</td>
      </tr>`).join("");

  const missedRows = model.missed.map((m) => `
      <tr>
        <td>${m.name ? escapeHtml(m.name) : "<span class=\"muted\">ohne Namen</span>"}
            <span class="mono muted">${escapeHtml(m.vessel)}</span></td>
        <td>${escapeHtml(m.type)}</td>
        <td class="n">${escapeHtml(m.fromUtc)}–${escapeHtml(m.toUtc)}</td>
        <td class="n">${m.minutesInArea}\u00a0min</td>
        <td class="n">${num(m.distanceKm)}\u00a0km</td>
        <td class="n">${m.nearestSiteKm === null ? "—" : `${num(m.nearestSiteKm)}\u00a0km`}</td>
      </tr>`).join("");

  const headline = t
    ? `<div class="headline">
         <div class="big">${pct(t.passageShare)}</div>
         <div>der Fahrten beobachtet<br><span class="sub">${t.observedPassages} von ${t.passages}
           · ${t.missedPassages} verpasst</span></div>
       </div>`
    : `<p class="warn">Kein Standort gesetzt — es liegt keine Messung vor.</p>`;

  const resilience = n && n.siteCount > 1    ? `<h2>Ausfallsicherheit</h2>
       <table class="kv">
         <tr><th>Doppelt abgedeckt</th><td>${pct(n.redundantShare)} der Fahrten
           (${n.redundantPassages})</td></tr>
         <tr><th>Nur von einem Standort gehalten</th><td>${n.singleCoverPassages} Fahrten</td></tr>
         <tr><th>Schlechtester Einzelausfall</th><td class="warn">−${pct(n.worstCaseLossShare)}
           (${n.worstCaseLossPassages} Fahrten)</td></tr>
       </table>`
    : "";

  const json = JSON.stringify({
    generatedUtc: model.generatedUtc,
    aoi: model.aoiName,
    scenario: model.scenario,
    trackDate: model.trackDate,
    targetM: model.targetM,
    sites: model.sites,
    traffic: model.traffic,
    network: model.network,
    areaVisibleKm2: model.areaVisibleKm2,
    areaShadowedKm2: model.areaShadowedKm2,
    missedPassages: model.missed,
  }, null, 2);

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Sichtbarkeitsanalyse ${escapeHtml(model.aoiName)} — ${escapeHtml(model.generatedUtc)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #16242c;
         max-width: 940px; margin: 0 auto; padding: 32px 24px 64px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom: 4px;
       border-bottom: 1px solid #cdd8de; }
  .meta { color: #5b6f7a; font-size: 13px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e2e9ee;
           vertical-align: top; }
  th { color: #47606d; font-weight: 600; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  .muted { opacity: 0.55; }
  .headline { display: flex; align-items: center; gap: 16px; background: #eef7f3;
              border: 1px solid #b9dfd0; border-radius: 8px; padding: 14px 18px; margin: 4px 0; }
  .big { font-size: 40px; font-weight: 700; color: #10795a; line-height: 1; }
  .sub { color: #5b6f7a; font-size: 13px; }
  .good { color: #10795a; } .warn { color: #a2560d; }
  table.kv th { width: 42%; }
  ul { margin: 6px 0; padding-left: 20px; } li { margin-bottom: 6px; font-size: 13px; }
  .note { background: #fbf4e9; border: 1px solid #e8d5b0; border-radius: 6px;
          padding: 10px 14px; font-size: 12.5px; }
  details { margin-top: 22px; } pre { font-size: 10.5px; overflow-x: auto; color: #47606d; }
  @media print {
    body { padding: 0; max-width: none; }
    h2 { break-after: avoid; } tr { break-inside: avoid; } details { display: none; }
  }
</style>
</head>
<body>
<h1>Sichtbarkeitsanalyse — ${escapeHtml(model.aoiName)}</h1>
<div class="meta">
  Erstellt ${escapeHtml(model.generatedUtc)} · Szenario
  ${model.scenario === "counterUas" ? "Drohnenabwehr" : "Seeverkehr"} ·
  Verkehrstag ${escapeHtml(model.trackDate)} · Zielhöhe ${model.targetM}\u00a0m
</div>

${headline}

<h2>Konfiguration</h2>
<table>
  <thead><tr>
    <th>Standort</th><th class="n">Lat, Lon</th><th class="n">Mast</th><th class="n">Grund</th>
    <th class="n">Auge</th><th class="n">Horizont</th><th class="n">gesehen</th>
    <th class="n">exklusiv</th>
  </tr></thead>
  <tbody>${siteRows || `<tr><td colspan="8">—</td></tr>`}</tbody>
</table>
<p class="meta">Einsehbar ${num(model.areaVisibleKm2)}\u00a0km² · abgeschattet
  ${num(model.areaShadowedKm2)}\u00a0km²${t
    ? ` · Meldungen beobachtet ${pct(t.positionShare)}` : ""}</p>

${resilience}

${model.variants.length > 1 ? `<h2>Variantenvergleich</h2>
<table>
  <thead><tr>
    <th>Variante</th><th class="n">Standorte</th><th class="n">Maststrecke</th>
    <th class="n">höchster Mast</th><th class="n">Zielhöhe</th>
    <th class="n">Durchfahrten</th><th class="n">doppelt</th>
    <th class="n">schlecht. Ausfall</th><th class="n">gegen ${escapeHtml(model.variants[0].id)}</th>
  </tr></thead>
  <tbody>${model.variants.map((v, i) => {
    const cost = variantCost(v);
    const delta = i > 0 ? compareVariants(model.variants[0], v) : null;
    return `
      <tr>
        <td><strong>${escapeHtml(v.id)}</strong></td>
        <td class="n">${cost.siteCount}</td>
        <td class="n">${cost.totalMastM}\u00a0m</td>
        <td class="n">${cost.tallestMastM}\u00a0m</td>
        <td class="n">${v.targetM}\u00a0m</td>
        <td class="n">${pct(observedShare(v))} <span class="sub">(${v.observedTransits}/${v.transits})</span></td>
        <td class="n">${pct(redundantShare(v))}</td>
        <td class="n warn">\u2212${pct(worstCaseLossShare(v))}</td>
        <td class="n ${delta ? (delta.observedPp > 0.5 ? "good" : delta.observedPp < -0.5 ? "warn" : "") : ""}">${
          delta
            ? `${delta.observedPp >= 0 ? "+" : ""}${delta.observedPp.toFixed(0)}\u00a0pp bei ${
              delta.totalMastM >= 0 ? "+" : ""}${delta.totalMastM}\u00a0m`
            : "\u2014"}</td>
      </tr>`;
  }).join("")}
  </tbody>
</table>
<div class="note">
  <strong>pp</strong> bedeutet Prozentpunkte, nicht Prozent: von 72\u00a0% auf 90\u00a0% sind
  +18\u00a0pp und +25\u00a0%.
  <br><br>
  <strong>Es stehen bewusst keine Preise in dieser Tabelle.</strong> Die Kosten eines Mastes hängen
  von Tiefbau, Standortzugang und Rahmenverträgen ab — nichts davon liegt diesem Modell vor, und
  eine erfundene Zahl wäre genau die Art von Angabe, die ein Anhang nicht überlebt. Angegeben ist
  die <strong>Maststrecke</strong>, also die Größe, auf die eine Preisliste angewandt wird und die
  nachrechenbar ist.
</div>` : ""}

<h2>Nicht beobachtete Fahrten${model.missed.length < model.missedShown
    ? "" : ` (${model.missed.length} von ${model.missedShown} gezeigt)`}</h2>
${model.missed.length
    ? `<table>
  <thead><tr>
    <th>Schiff</th><th>Typ</th><th class="n">im Gebiet</th><th class="n">Dauer</th>
    <th class="n">Strecke</th><th class="n">nächster Standort</th>
  </tr></thead>
  <tbody>${missedRows}</tbody>
</table>
<p class="meta">Nach zurückgelegter Strecke sortiert — die längsten Durchfahrten zuerst.
  „Nächster Standort" ist die geringste Entfernung, die diese Fahrt zu einem der gesetzten
  Standorte hatte: eine knapp verpasste Fahrt ist ein anderes Problem als eine, die nie in die
  Nähe kam.</p>`
    : `<p>Alle Durchfahrten, die das Gebiet erreicht haben, wurden beobachtet.</p>`}
${model.excludedStationary
    ? `<div class="note"><strong>${model.excludedStationary}</strong> Fahrten sind aus <strong>allen
  Zahlen dieses Berichts ausgenommen</strong>, weil sie weniger als
  ${num(model.stationaryBelowKm)}\u00a0km zurückgelegt haben. Das sind liegende Fahrzeuge: ein
  festgemachtes Schiff sendet den ganzen Tag, und eine Meldelücke von über 20\u00a0Minuten trennt
  diese Meldungen in mehrere gezählte „Fahrten". Sie als verpassten Verkehr zu führen würde die
  Leistung eines realen Systems deutlich zu schlecht darstellen. Gezählt wird, was gefahren
  ist.</div>`
    : ""}

<h2>Wie die Zahlen definiert sind</h2>
<table>
  <tbody>${REPORT_DEFINITIONS.map((d) => `
    <tr><th>${escapeHtml(d.term)}</th><td>${escapeHtml(d.meaning)}</td></tr>`).join("")}
  </tbody>
</table>

<h2>Was dieses Modell nicht enthält</h2>
<div class="note"><ul>${[REPORT_CAVEATS[0], vegetationCaveat(model.surface), ...REPORT_CAVEATS.slice(1)]
    .map((c) => `<li>${c}</li>`).join("")}</ul></div>

<h2>Datengrundlage</h2>
<table><tbody>${REPORT_SOURCES.map((s) => `
  <tr><th>${escapeHtml(s.label)}</th><td>${escapeHtml(s.detail)}</td></tr>`).join("")}
</tbody></table>

<details>
  <summary>Rohdaten (JSON)</summary>
  <pre>${escapeHtml(json)}</pre>
</details>
</body>
</html>`;
}
