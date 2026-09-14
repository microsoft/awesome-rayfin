import { describe, expect, it } from "vitest";
import {
  clockUtc,
  escapeHtml,
  renderReportHtml,
  REPORT_CAVEATS,
  type ReportModel,
} from "./report";

function model(overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    generatedUtc: "2026-08-02T09:00:00Z",
    aoiName: "Kieler Förde",
    scenario: "maritime",
    trackDate: "2026-07-01",
    targetM: 2,
    sites: [{
      index: 1, lat: 54.4, lon: 10.2, col: 400, row: 500, mastM: 25, groundM: 12.5, eyeM: 37.5,
      horizonKm: 28.1, observedPassages: 120, uniquePassages: 38,
    }],
    traffic: {
      passages: 226, observedPassages: 160, missedPassages: 66,
      passageShare: 160 / 226, positionShare: 0.44,
    },
    network: null,
    areaVisibleKm2: 36.5,
    areaShadowedKm2: 163.5,
    missed: [],
    missedShown: 40,
    excludedStationary: 0,
    stationaryBelowKm: 0.5,
    surface: {
      includesBuildings: true,
      includesVegetation: true,
      vegetationStats: { cellsRaised: 4_935_163, medianLiftM: 4.9, p90LiftM: 20.8 },
    },
    variants: [],
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("neutralises the characters that would break out of the document", () => {
    expect(escapeHtml(`<script>alert("x")</script>`))
      .toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    // Getting the order wrong turns "&" into "&amp;lt;" for the next replacement.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("clockUtc", () => {
  it("formats seconds since midnight as HH:MM", () => {
    expect(clockUtc(0)).toBe("00:00");
    expect(clockUtc(3600)).toBe("01:00");
    expect(clockUtc(19 * 3600 + 7 * 60)).toBe("19:07");
  });

  it("does not produce a negative or 25th hour", () => {
    expect(clockUtc(-10)).toBe("00:00");
    expect(clockUtc(25 * 3600)).toBe("01:00");
  });
});

describe("renderReportHtml", () => {
  it("puts the observed-traffic figure and its fraction in the document", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("71\u00a0%");           // 160/226
    expect(html).toContain("160 von 226");
    expect(html).toContain("66 verpasst");
  });

  it("always carries every caveat, because the annex outlives the conversation", () => {
    const html = renderReportHtml(model());
    // 🔴 A report that quotes a percentage without these is a number that cannot be checked
    // circulating under our name. If a caveat is ever dropped from the export, this fails.
    expect(REPORT_CAVEATS.length).toBeGreaterThan(4);
    for (const caveat of REPORT_CAVEATS) expect(html).toContain(caveat);
    expect(html).toContain("Bewuchs enthalten");
    expect(html).toContain("kein Radarmodell");
    expect(html).toContain("fiktiv");
  });

  /**
   * 🔴 The annex must describe the surface it was actually computed against. A hard-coded
   * vegetation sentence was exported unchanged by a second site whose surface had none — a
   * precise, confident, false claim in the document most likely to be forwarded.
   */
  it("states what the blocking surface contains, from the built descriptor", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("Bewuchs enthalten");
    expect(html).toContain("4,9\u00a0Mio.");
    expect(html).not.toContain("Obergrenze");
  });

  it("calls coverage an upper bound when the surface carries no vegetation", () => {
    const html = renderReportHtml(model({
      surface: { includesBuildings: true, includesVegetation: false, vegetationStats: null },
    }));
    expect(html).toContain("Kein Bewuchs im Modell");
    expect(html).toContain("Obergrenze");
    expect(html).not.toContain("Bewuchs enthalten");
  });

  it("refuses to claim vegetation when the stats are missing, whatever the flag says", () => {
    // A descriptor can be inconsistent; the document must fall back to the safer statement.
    const html = renderReportHtml(model({
      surface: { includesBuildings: true, includesVegetation: true, vegetationStats: null },
    }));
    expect(html).toContain("Obergrenze");
  });

  it("still produces a caveat when no surface descriptor was loaded at all", () => {
    const html = renderReportHtml(model({ surface: null }));
    expect(html).toContain("Obergrenze");
  });

  it("names the data sources and their licences", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("LVermGeo SH");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain("Copernicus DEM GLO-30");
    expect(html).toContain("Danish Maritime Authority");
  });

  it("states the definition of an observed passage rather than assuming it", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("Mindestens eine Position");
  });

  it("escapes untrusted vessel type text from the feed", () => {
    const html = renderReportHtml(model({
      missed: [{
        vessel: "a1b2", type: `<img src=x onerror="alert(1)">`, fromUtc: "08:00", toUtc: "08:30",
        minutesInArea: 30, distanceKm: 4.2, nearestSiteKm: 1.1,
      }],
    }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("says so plainly when nothing was missed", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("Alle Durchfahrten, die das Gebiet erreicht haben, wurden beobachtet.");
  });

  it("discloses that stationary passages are out of the denominator", () => {
    // 🔴 The figures changed when this rule came in. A document that moves a denominator without
    // saying so is not one anybody should trust, so the disclosure is asserted, not assumed.
    const html = renderReportHtml(model({ excludedStationary: 108 }));
    expect(html).toContain("<strong>108</strong>");
    expect(html).toContain("ausgenommen");
    expect(html).toContain("liegende Fahrzeuge");
    expect(html).toContain("zu schlecht darstellen");
  });

  it("states which passages count, in the definitions table", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("Welche Fahrten z\u00e4hlen");
    expect(html).toContain("mindestens 0,5 km");
  });

  it("leaves out the exclusion note when nothing was excluded", () => {
    const html = renderReportHtml(model({ excludedStationary: 0 }));
    expect(html).not.toContain("liegende Fahrzeuge");
  });

  it("reports network resilience only when there is more than one site", () => {
    const single = renderReportHtml(model());
    expect(single).not.toContain("Ausfallsicherheit");

    const networked = renderReportHtml(model({
      network: {
        siteCount: 3, passages: 226, observedPassages: 140, missedPassages: 86,
        passageShare: 140 / 226, redundantPassages: 96, redundantShare: 96 / 226,
        singleCoverPassages: 44, worstCaseLossPassages: 38, worstCaseLossShare: 38 / 226,
        perSite: [],
      },
    }));
    expect(networked).toContain("Ausfallsicherheit");
    expect(networked).toContain("Schlechtester Einzelausfall");
    expect(networked).toContain("38 Fahrten");
  });

  it("embeds the figures as JSON so the annex can be checked, not just read", () => {
    const html = renderReportHtml(model());
    expect(html).toContain("Rohdaten (JSON)");
    expect(html).toContain("&quot;areaVisibleKm2&quot;: 36.5");
  });

  it("is a self-contained document with no external requests", () => {
    const html = renderReportHtml(model());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No network dependency: an annex that needs a CDN is broken the moment it is forwarded.
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toMatch(/https?:\/\/[^"']*\.(?:js|css)/);
    expect(html).not.toContain("<link");
  });

  describe("variant comparison", () => {
    const twoVariants = [
      {
        id: "A",
        sites: [{ col: 1, row: 1, mastM: 25 }],
        targetM: 2, transits: 137, observedTransits: 99,
        redundantTransits: 0, worstCaseLossTransits: 99, visibleKm2: 55.5,
      },
      {
        id: "B",
        sites: [{ col: 1, row: 1, mastM: 25 }, { col: 2, row: 2, mastM: 40 }],
        targetM: 2, transits: 137, observedTransits: 123,
        redundantTransits: 40, worstCaseLossTransits: 55, visibleKm2: 132.2,
      },
    ];

    it("appears only once there is something to compare", () => {
      expect(renderReportHtml(model())).not.toContain("Variantenvergleich");
      expect(renderReportHtml(model({ variants: [twoVariants[0]] })))
        .not.toContain("Variantenvergleich");
      expect(renderReportHtml(model({ variants: twoVariants })))
        .toContain("Variantenvergleich");
    });

    it("states the difference in percentage points against the structure it costs", () => {
      const html = renderReportHtml(model({ variants: twoVariants }));
      // 99/137 = 72.3 %, 123/137 = 89.8 % -> +18 pp, for 40 m more mast.
      expect(html).toContain("+18&nbsp;pp bei +40&nbsp;m".replace(/&nbsp;/g, "\u00a0"));
    });

    it("🔴 never invents a price", () => {
      // Mast cost depends on civil works and frame agreements this app has no sight of. A
      // fabricated euro is the one kind of number a bid annex cannot survive, so its absence is
      // asserted rather than assumed.
      const html = renderReportHtml(model({ variants: twoVariants }));
      expect(html).not.toMatch(/€|EUR\b|\bUSD\b|\$\d/);
      expect(html).toContain("keine Preise");
      expect(html).toContain("Maststrecke");
    });

    it("spells out what pp means, where the reader will see it", () => {
      const html = renderReportHtml(model({ variants: twoVariants }));
      expect(html).toContain("Prozentpunkte, nicht Prozent");
    });
  });
});
