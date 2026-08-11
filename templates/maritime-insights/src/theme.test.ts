import { describe, expect, it } from "vitest";
import {
  cssVarName,
  cssVariables,
  isThemeName,
  LIGHT_THEME_CAVEAT,
  resolveInitialTheme,
  SCENE_THEMES,
  THEME_ORDER,
  UI_THEMES,
  type SceneTheme,
  type UiPalette,
} from "./theme";

/** Relative luminance, WCAG. Used to assert direction, never an exact colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex: ${hex}`);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme — the dark values are the SHIPPED values", () => {
  /**
   * 🔴 This is the point of the whole suite. Every number below was a literal in scene.ts before
   * the palette was extracted, and PLAN §13's published figures were measured against a build that
   * rendered exactly these. If one of them drifts, "dark" quietly stops being the build the
   * measurements describe.
   */
  const d = SCENE_THEMES.dark;

  it("keeps the sky, fog and clear colour at 0x9fb8c4", () => {
    expect(d.sky).toBe(0x9fb8c4);
  });

  it("keeps the terrain band at photo * (0.55 + 0.50 * lambert)", () => {
    expect(d.terrainRamp).toEqual([0.55, 0.50]);
  });

  it("keeps the shell ramp and its two ends", () => {
    expect(d.shellLow).toEqual([0.56, 0.60, 0.52]);
    expect(d.shellHigh).toEqual([0.70, 0.68, 0.62]);
    expect(d.shellRamp).toEqual([0.54, 0.48]);
  });

  it("keeps the measured sea colours and the tight glitter weight", () => {
    expect(d.seaDeep).toEqual([0.043, 0.105, 0.16]);
    expect(d.seaCoastal).toEqual([0.075, 0.185, 0.225]);
    expect(d.seaGlitter).toBe(0.30);
  });

  it("keeps the building base and its lighting band", () => {
    expect(d.buildingBase).toEqual([0.82, 0.79, 0.75]);
    expect(d.buildingRamp).toEqual([0.45, 0.55]);
  });

  it("keeps the three coverage tints and the shadow mix", () => {
    expect(d.coverVisible).toEqual([0.35, 0.92, 0.70]);
    expect(d.coverOverlap).toEqual([1.00, 0.72, 0.30]);
    expect(d.coverShadow).toEqual([0.05, 0.06, 0.10]);
    expect(d.coverShadowMix).toBe(0.55);
  });

  it("keeps the speed ramps for trails and heads, including Mode D", () => {
    expect(d.trailSlow).toEqual([0.45, 0.80, 0.95]);
    expect(d.trailFast).toEqual([1.00, 0.78, 0.35]);
    expect(d.trailMuted).toEqual([0.30, 0.40, 0.45]);
    expect(d.trailAlert).toEqual([1.00, 0.62, 0.35]);
    expect(d.headSlow).toEqual([0.75, 0.93, 1.00]);
    expect(d.headFast).toEqual([1.00, 0.90, 0.60]);
    expect(d.headMuted).toEqual([0.35, 0.45, 0.50]);
    expect(d.headAlert).toEqual([1.00, 0.70, 0.40]);
  });

  it("keeps the marker colours", () => {
    expect(d.mast).toEqual([1.00, 0.85, 0.35]);
    expect(d.mastSelected).toEqual([1.00, 0.98, 0.80]);
    expect(d.siteDisc).toEqual([1.00, 0.92, 0.55]);
    expect(d.assetMarker).toEqual([0.45, 0.82, 1.00]);
    expect(d.vesselRing).toEqual([1.00, 0.85, 0.35]);
  });

  it("keeps the shipped UI surfaces and text", () => {
    const u = UI_THEMES.dark;
    expect(u.bg).toBe("#0d1b24");
    expect(u.panel).toBe("#12242f");
    expect(u.panelStrong).toBe("#12242fee");
    expect(u.text).toBe("#e8eef2");
    expect(u.textMuted).toBe("#cfe6f2");
    expect(u.accent).toBe("#7fd0ff");
    expect(u.good).toBe("#5ce8b0");
    expect(u.warn).toBe("#ffb066");
  });
});

describe("theme — both themes are complete", () => {
  /**
   * A half-themed palette is worse than none: the missing token silently keeps the other theme's
   * colour, which on a swap means an unreadable control that looks deliberate.
   */
  it("defines every UI token in every theme", () => {
    const keys = Object.keys(UI_THEMES.dark) as (keyof UiPalette)[];
    expect(keys.length).toBeGreaterThan(30);
    for (const name of THEME_ORDER) {
      for (const key of keys) {
        expect(UI_THEMES[name][key], `${name}.${key}`).toMatch(/^#[0-9a-f]{6,8}$/i);
      }
      expect(Object.keys(UI_THEMES[name]).sort()).toEqual([...keys].sort());
    }
  });

  it("defines every scene token in every theme, with the same shape", () => {
    const keys = Object.keys(SCENE_THEMES.dark) as (keyof SceneTheme)[];
    for (const name of THEME_ORDER) {
      expect(Object.keys(SCENE_THEMES[name]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const dark = SCENE_THEMES.dark[key];
        const value = SCENE_THEMES[name][key];
        expect(typeof value, `${name}.${key}`).toBe(typeof dark);
        if (Array.isArray(dark)) {
          expect((value as readonly number[]).length, `${name}.${key}`).toBe(dark.length);
        }
      }
    }
  });

  it("keeps every scene colour channel inside 0..1", () => {
    for (const name of THEME_ORDER) {
      for (const [key, value] of Object.entries(SCENE_THEMES[name])) {
        if (!Array.isArray(value)) continue;
        for (const channel of value as number[]) {
          expect(channel, `${name}.${key}`).toBeGreaterThanOrEqual(0);
          expect(channel, `${name}.${key}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("theme — light actually inverts, rather than merely differing", () => {
  it("puts the page background on the other side of mid grey", () => {
    expect(luminance(UI_THEMES.dark.bg)).toBeLessThan(0.15);
    expect(luminance(UI_THEMES.light.bg)).toBeGreaterThan(0.7);
  });

  it("flips the text so it is readable on its own panel", () => {
    // 4.5:1 is the WCAG AA threshold for body text. Both themes must clear it, or the toggle
    // ships a state nobody can read.
    for (const name of THEME_ORDER) {
      const u = UI_THEMES[name];
      expect(contrast(u.text, u.panel), `${name} text on panel`).toBeGreaterThan(4.5);
      expect(contrast(u.textMuted, u.panel), `${name} muted on panel`).toBeGreaterThan(4.5);
    }
  });

  it("darkens the accents for light instead of lightening them", () => {
    // 🔴 The mistake this pins: a "light theme" that keeps #7fd0ff renders a 1.4:1 control on a
    // white panel. Accents must move TOWARD the dark end as the surface moves toward white.
    for (const key of ["accent", "good", "warn", "warnStrong"] as const) {
      expect(luminance(UI_THEMES.light[key]), key)
        .toBeLessThan(luminance(UI_THEMES.dark[key]));
      expect(contrast(UI_THEMES.light[key], UI_THEMES.light.panel), `light ${key} on panel`)
        .toBeGreaterThan(4.5);
      expect(contrast(UI_THEMES.dark[key], UI_THEMES.dark.panel), `dark ${key} on panel`)
        .toBeGreaterThan(4.5);
    }
  });

  it("bases the hairlines on white for dark and on black for light", () => {
    // A white hairline on a white panel is invisible — the failure mode where every colour is
    // "themed" and the result still looks broken.
    for (const key of ["line05", "line08", "line13", "line20", "line53"] as const) {
      expect(UI_THEMES.dark[key].startsWith("#ffffff"), `dark ${key}`).toBe(true);
      expect(UI_THEMES.light[key].startsWith("#000000"), `light ${key}`).toBe(true);
      // Same alpha byte in both, so the weight of every border survives the swap.
      expect(UI_THEMES.light[key].slice(7)).toBe(UI_THEMES.dark[key].slice(7));
    }
  });

  it("brightens the scene: sky, terrain ambient, sea and buildings all move up", () => {
    const dark = SCENE_THEMES.dark;
    const light = SCENE_THEMES.light;
    const mean = (c: readonly number[]) => c.reduce((a, b) => a + b, 0) / c.length;
    expect(light.terrainRamp[0]).toBeGreaterThan(dark.terrainRamp[0]);
    expect(mean(light.seaDeep)).toBeGreaterThan(mean(dark.seaDeep));
    expect(mean(light.seaCoastal)).toBeGreaterThan(mean(dark.seaCoastal));
    expect(mean(light.buildingBase)).toBeGreaterThan(mean(dark.buildingBase));
    expect(mean(light.shellLow)).toBeGreaterThan(mean(dark.shellLow));
  });

  it("darkens the scene ACCENTS as the ground brightens", () => {
    // Same rule as the UI accents, for the same reason: a pale mast marker on pale terrain is a
    // marker nobody can find. The user accepted a legibility trade here — this keeps it small.
    const mean = (c: readonly number[]) => c.reduce((a, b) => a + b, 0) / c.length;
    for (const key of ["mast", "siteDisc", "vesselRing", "trailSlow", "headSlow",
                       "coverVisible", "assetMarker"] as const) {
      expect(mean(SCENE_THEMES.light[key]), key)
        .toBeLessThan(mean(SCENE_THEMES.dark[key]));
    }
  });

  it("lightens the shadow tint and mixes it less, rather than compensating with more black", () => {
    // 🔴 A near-black shadow at 55 % over bright terrain reads as missing data, which is exactly
    // the confusion the separate unknown/shadowed/visible states exist to prevent.
    const mean = (c: readonly number[]) => c.reduce((a, b) => a + b, 0) / c.length;
    expect(mean(SCENE_THEMES.light.coverShadow))
      .toBeGreaterThan(mean(SCENE_THEMES.dark.coverShadow));
    expect(SCENE_THEMES.light.coverShadowMix)
      .toBeLessThan(SCENE_THEMES.dark.coverShadowMix);
  });

  it("still separates visible from shadowed in the light theme", () => {
    // The two coverage states must not converge just because the palette moved.
    const l = SCENE_THEMES.light;
    const distance = Math.hypot(
      l.coverVisible[0] - l.coverShadow[0],
      l.coverVisible[1] - l.coverShadow[1],
      l.coverVisible[2] - l.coverShadow[2],
    );
    expect(distance).toBeGreaterThan(0.35);
  });
});

describe("theme — CSS custom properties", () => {
  it("maps camelCase tokens onto namespaced kebab-case variables", () => {
    expect(cssVarName("bg")).toBe("--mi-bg");
    expect(cssVarName("panelStrong")).toBe("--mi-panel-strong");
    expect(cssVarName("line13")).toBe("--mi-line13");
    expect(cssVarName("warnStrong")).toBe("--mi-warn-strong");
  });

  it("emits one variable per token, and the same set for both themes", () => {
    const dark = cssVariables(UI_THEMES.dark);
    const light = cssVariables(UI_THEMES.light);
    expect(Object.keys(dark)).toEqual(Object.keys(light));
    expect(Object.keys(dark).every((k) => k.startsWith("--mi-"))).toBe(true);
    expect(dark["--mi-bg"]).toBe("#0d1b24");
    expect(light["--mi-bg"]).toBe("#eef4f8");
  });
});

describe("theme — initial choice", () => {
  it("lets an explicit ?theme= win, because a shared link has to force a look", () => {
    expect(resolveInitialTheme("?theme=light", "dark", false)).toBe("light");
    expect(resolveInitialTheme("?theme=dark", "light", true)).toBe("dark");
  });

  it("falls back to the stored choice, then the OS, then dark", () => {
    expect(resolveInitialTheme("", "light", false)).toBe("light");
    expect(resolveInitialTheme("", null, true)).toBe("light");
    expect(resolveInitialTheme("", null, false)).toBe("dark");
  });

  it("ignores rubbish in the URL and in storage rather than rendering an empty palette", () => {
    expect(resolveInitialTheme("?theme=constructor", null, false)).toBe("dark");
    expect(resolveInitialTheme("?theme=", "__proto__", false)).toBe("dark");
    expect(isThemeName("bright")).toBe(false);
    expect(isThemeName("light")).toBe(true);
  });
});

describe("theme — the light theme states its own cost", () => {
  it("carries a caveat that names what gets harder to read", () => {
    // The caveat lives with the palette so that changing the colours and changing the claim about
    // them is one edit.
    expect(LIGHT_THEME_CAVEAT).toMatch(/Abschattung/);
    expect(LIGHT_THEME_CAVEAT).toMatch(/Mastmarker/);
    // …and it must not imply the measurements moved, because they did not.
    expect(LIGHT_THEME_CAVEAT).toMatch(/Zahlen ändern sich dadurch nicht/);
  });
});
