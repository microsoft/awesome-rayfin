/**
 * Light / dark presentation, as data.
 *
 * The app was built dark because a dark scene is where a coverage tint, a shadow and a track
 * colour all read at once. That is still the default, and every figure PLAN §13 publishes was
 * measured against it. But the sibling paraglider build is bright, several rooms are bright, and
 * a projector in a lit room is the worst case for a dark UI — so the palette had to stop being a
 * set of literals scattered through eleven shader strings and become a value that can be swapped.
 *
 * 🔴 **The dark values here are the shipped ones, copied verbatim.** That is the whole safety
 * property of this module: switching to `dark` must reproduce the build that the published
 * measurements came from, byte for byte, so the theme can never quietly restate a figure. A test
 * pins each dark value against the number it replaced.
 *
 * ⚠️ **Light is a legibility trade, and it is a real one.** On a bright scene the shadow tint has
 * less room to darken into and the mast markers lose contrast against pale terrain — the coverage
 * story is genuinely weaker. The light values below are chosen to lose as little as possible
 * (deeper, more saturated accents instead of the pale ones that work on dark), but they do not
 * make it equal, and the UI says so rather than pretending otherwise.
 *
 * Everything here is plain data with no three.js and no DOM import, so it is testable on its own
 * and cannot drag a WebGL context into a unit test.
 */

export type ThemeName = "dark" | "light";

export const THEME_ORDER: readonly ThemeName[] = ["dark", "light"] as const;

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: "Dunkel",
  light: "Hell",
};

/** Where the choice is remembered between visits. */
export const THEME_STORAGE_KEY = "maritime-insights.theme";

export function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

/**
 * Which theme to start in.
 *
 * Order of precedence, and the reason for each: an explicit `?theme=` wins because a link handed
 * to someone before a talk has to be able to force a look; then the stored choice, because a user
 * who switched once meant it; then the operating system preference, because guessing wrong when
 * the OS has already said is rude; then dark, which is what the app was designed and measured in.
 *
 * Pure on purpose — `window` is never touched here, the caller passes what it read.
 */
export function resolveInitialTheme(
  search: string,
  stored: string | null,
  prefersLight: boolean,
): ThemeName {
  const requested = new URLSearchParams(search).get("theme");
  if (isThemeName(requested)) return requested;
  if (isThemeName(stored)) return stored;
  return prefersLight ? "light" : "dark";
}

// ─────────────────────────────────────────────────────────────────── UI chrome

/**
 * Every colour the panels use, named by ROLE rather than by appearance.
 *
 * `line13` and friends keep their alpha in the name because that is the only thing that
 * distinguishes them — they are one hairline colour at eight weights, and naming them
 * "border"/"divider"/"faint" would have invented a hierarchy the layout does not have.
 *
 * 🔴 On dark these are white at low alpha; on light they are BLACK at low alpha. A white hairline
 * on a white panel is invisible, which is the failure mode that makes a naive theme swap look
 * broken while every colour is technically "themed".
 */
export interface UiPalette {
  /** Page background, behind everything including the canvas. */
  bg: string;
  /** The same background at 80 % and 0 %, for the top bar's fade. */
  bgFade: string;
  bgClear: string;
  /** Panel surfaces: opaque, near-opaque, and the lighter one used over the scene. */
  panel: string;
  panelStrong: string;
  panelSoft: string;
  /** An inset well, darker than a panel on dark and darker than white on light. */
  well: string;
  /** The one error surface (the "no relay" / failure notice). */
  panelError: string;

  text: string;
  textMuted: string;
  textFaint: string;

  line05: string;
  line07: string;
  line08: string;
  line10: string;
  line13: string;
  line17: string;
  line20: string;
  line53: string;

  /** Primary accent — controls, the assistant, anything interactive. */
  accent: string;
  accent06: string;
  accent08: string;
  accent12: string;
  accent13: string;
  accent20: string;
  accent27: string;
  accent33: string;
  /** Positive / measured-good: coverage shares, applied suggestions. */
  good: string;
  good09: string;
  good13: string;
  good27: string;
  good33: string;
  /** Caution / caveat: exclusions, missed passages, model limits. */
  warn: string;
  warn06: string;
  warn09: string;
  warn20: string;
  warn27: string;
  warnStrong: string;
}

/**
 * 🔴 Dark is the shipped palette, unchanged. Do not "tidy" these values.
 */
const DARK_UI: UiPalette = {
  bg: "#0d1b24",
  bgFade: "#0d1b24cc",
  bgClear: "#0d1b2400",
  panel: "#12242f",
  panelStrong: "#12242fee",
  panelSoft: "#12242fdd",
  well: "#08131a",
  panelError: "#2a1a1add",

  text: "#e8eef2",
  textMuted: "#cfe6f2",
  textFaint: "#9fb3bf",

  line05: "#ffffff0d",
  line07: "#ffffff11",
  line08: "#ffffff14",
  line10: "#ffffff1a",
  line13: "#ffffff22",
  line17: "#ffffff2b",
  line20: "#ffffff33",
  line53: "#ffffff88",

  accent: "#7fd0ff",
  accent06: "#7fd0ff10",
  accent08: "#7fd0ff14",
  accent12: "#7fd0ff1f",
  accent13: "#7fd0ff22",
  accent20: "#7fd0ff33",
  accent27: "#7fd0ff44",
  accent33: "#7fd0ff55",

  good: "#5ce8b0",
  good09: "#5ce8b016",
  good13: "#5ce8b022",
  good27: "#5ce8b044",
  good33: "#5ce8b055",

  warn: "#ffb066",
  warn06: "#ffb0660f",
  warn09: "#ffb06616",
  warn20: "#ffb06633",
  warn27: "#ffb06644",
  warnStrong: "#ffa05a",
};

/**
 * Light.
 *
 * ⚠️ The accents are NOT the dark ones lightened — they are **darkened**, because on a white panel
 * `#7fd0ff` is a 1.4:1 contrast ratio against the surface and simply cannot be read. The alpha
 * variants keep the same alpha byte so every tint and border keeps its relative weight; a dark
 * base at 13 % over white gives the same "faintly coloured surface" the dark theme gets from a
 * pale base at 13 % over near-black.
 */
const LIGHT_UI: UiPalette = {
  bg: "#eef4f8",
  bgFade: "#eef4f8cc",
  bgClear: "#eef4f800",
  panel: "#ffffff",
  panelStrong: "#fbfdfeee",
  panelSoft: "#fbfdfedd",
  well: "#dde8ef",
  panelError: "#ffe1d8dd",

  text: "#0f2431",
  textMuted: "#1b3d4f",
  textFaint: "#516a78",

  line05: "#0000000d",
  line07: "#00000011",
  line08: "#00000014",
  line10: "#0000001a",
  line13: "#00000022",
  line17: "#0000002b",
  line20: "#00000033",
  line53: "#00000088",

  accent: "#0a6699",
  accent06: "#0a669910",
  accent08: "#0a669914",
  accent12: "#0a66991f",
  accent13: "#0a669922",
  accent20: "#0a669933",
  accent27: "#0a669944",
  accent33: "#0a669955",

  good: "#0a7a52",
  good09: "#0a7a5216",
  good13: "#0a7a5222",
  good27: "#0a7a5244",
  good33: "#0a7a5255",

  warn: "#9a5406",
  warn06: "#9a54060f",
  warn09: "#9a540616",
  warn20: "#9a540633",
  warn27: "#9a540644",
  warnStrong: "#b4470b",
};

export const UI_THEMES: Record<ThemeName, UiPalette> = { dark: DARK_UI, light: LIGHT_UI };

/** Prefix for the custom properties. Namespaced so the app cannot collide with a host page. */
export const CSS_VAR_PREFIX = "--mi-";

/** camelCase token → `--mi-kebab-case`. */
export function cssVarName(token: keyof UiPalette): string {
  return CSS_VAR_PREFIX + String(token).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * The palette as custom properties.
 *
 * Custom properties rather than a React context threaded through every inline style: the panels
 * are ~155 inline colour usages across one large component, and a context would mean touching
 * every one of them at render time for a value that changes about once a session. A variable is
 * set once on the root and the browser does the rest — and it also reaches the `<option>` elements
 * and scrollbars that inline styles never touch.
 */
export function cssVariables(palette: UiPalette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(palette) as (keyof UiPalette)[]) {
    out[cssVarName(key)] = palette[key];
  }
  return out;
}

/**
 * Put a palette on an element.
 *
 * Takes the element rather than reaching for `document`, so it stays testable and so the callback
 * tab — which never mounts React — can call it on `document.documentElement` just as the app does.
 *
 * ⚠️ `color-scheme` is not decoration. Without it the native `<select>` popup for the site
 * switcher, the scrollbars and the focus rings all keep the user agent's dark styling, and a light
 * theme ends up with a black dropdown hanging off a white panel. It is the one part of the UI that
 * inline styles cannot reach.
 */
export function applyUiTheme(
  name: ThemeName,
  root: HTMLElement,
  body?: HTMLElement | null,
): void {
  const palette = UI_THEMES[name];
  const vars = cssVariables(palette);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.theme = name;
  root.style.colorScheme = name;
  if (body) body.style.background = palette.bg;
}

/**
 * The same decision as `resolveInitialTheme`, with the browser reads attached.
 *
 * Split in two so the precedence rule can be tested without a DOM and without stubbing storage.
 * ⚠️ `localStorage` **throws** in a sandboxed iframe and with cookies blocked — not returns null,
 * throws — so both accessors are guarded. A missing preference is a fine state; a boot that dies
 * reading one is not, and this app is embedded in a Fabric shell.
 */
export function readInitialTheme(): ThemeName {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  return resolveInitialTheme(
    window.location.search,
    stored,
    window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false,
  );
}

export function storeTheme(name: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, name);
  } catch {
    // Nothing to do and nothing worth telling the user: the theme still applies for this visit.
  }
}

// ──────────────────────────────────────────────────────────────── the 3D scene

/** An RGB triple in the shader's own space — the numbers that were GLSL literals. */
export type Rgb = readonly [number, number, number];
/** `[ambient, gain]` for a `base * (ambient + gain * lambert)` term. */
export type LightRamp = readonly [number, number];

export interface SceneTheme {
  /**
   * Clear colour, fog colour and the sea's sky-reflection colour — one value, because the water
   * has to meet the horizon rather than stop at it. Stored as a hex integer because that is what
   * `setClearColor`/`THREE.Fog` take, and because it goes through three's colour management the
   * same way the shipped value did.
   */
  sky: number;
  /** Multiplied onto the orthophoto. Dark widened this band to make 1° slopes visible at all. */
  terrainRamp: LightRamp;

  shellLow: Rgb;
  shellHigh: Rgb;
  shellRamp: LightRamp;

  seaDeep: Rgb;
  seaCoastal: Rgb;
  /** Sun-glitter weight. Bright water needs less of it before it reads as haze. */
  seaGlitter: number;

  buildingBase: Rgb;
  buildingRamp: LightRamp;

  coverVisible: Rgb;
  coverOverlap: Rgb;
  coverShadow: Rgb;
  /** How hard the shadow tint is mixed in. See the caveat at the top: this is the trade. */
  coverShadowMix: number;

  trailSlow: Rgb;
  trailFast: Rgb;
  trailMuted: Rgb;
  trailAlert: Rgb;
  headSlow: Rgb;
  headFast: Rgb;
  headMuted: Rgb;
  headAlert: Rgb;

  mast: Rgb;
  mastSelected: Rgb;
  siteDisc: Rgb;
  assetMarker: Rgb;
  vesselRing: Rgb;
}

/**
 * 🔴 Every number here was a literal in `scene.ts` and is reproduced exactly. The dark theme is
 * not a "dark preset" — it is the build the deployed figures were measured on.
 */
const DARK_SCENE: SceneTheme = {
  sky: 0x9fb8c4,
  terrainRamp: [0.55, 0.50],

  shellLow: [0.56, 0.60, 0.52],
  shellHigh: [0.70, 0.68, 0.62],
  shellRamp: [0.54, 0.48],

  seaDeep: [0.043, 0.105, 0.16],
  seaCoastal: [0.075, 0.185, 0.225],
  seaGlitter: 0.30,

  buildingBase: [0.82, 0.79, 0.75],
  buildingRamp: [0.45, 0.55],

  coverVisible: [0.35, 0.92, 0.70],
  coverOverlap: [1.00, 0.72, 0.30],
  coverShadow: [0.05, 0.06, 0.10],
  coverShadowMix: 0.55,

  trailSlow: [0.45, 0.80, 0.95],
  trailFast: [1.00, 0.78, 0.35],
  trailMuted: [0.30, 0.40, 0.45],
  trailAlert: [1.00, 0.62, 0.35],
  headSlow: [0.75, 0.93, 1.00],
  headFast: [1.00, 0.90, 0.60],
  headMuted: [0.35, 0.45, 0.50],
  headAlert: [1.00, 0.70, 0.40],

  mast: [1.00, 0.85, 0.35],
  mastSelected: [1.00, 0.98, 0.80],
  siteDisc: [1.00, 0.92, 0.55],
  assetMarker: [0.45, 0.82, 1.00],
  vesselRing: [1.00, 0.85, 0.35],
};

/**
 * Light.
 *
 * The two decisions worth recording, because both were wrong on the first attempt:
 *
 *  * **Raising the ambient is not enough — the sea has to move too.** Brightening only the terrain
 *    left a near-black fjord under a pale sky, which reads as a rendering fault rather than as a
 *    light theme. The water carries most of this scene's area.
 *  * **The shadow tint must get LIGHTER and mix LESS, not darker to compensate.** A near-black
 *    shadow at 55 % over bright terrain is a hole in the picture; it stops looking like "the
 *    terrain is in the way" and starts looking like missing data — the exact confusion the three
 *    coverage states exist to prevent.
 */
const LIGHT_SCENE: SceneTheme = {
  sky: 0xd7e6f2,
  terrainRamp: [0.86, 0.30],

  shellLow: [0.73, 0.78, 0.69],
  shellHigh: [0.87, 0.85, 0.79],
  shellRamp: [0.78, 0.30],

  seaDeep: [0.30, 0.50, 0.60],
  seaCoastal: [0.47, 0.66, 0.72],
  seaGlitter: 0.20,

  buildingBase: [0.94, 0.93, 0.91],
  buildingRamp: [0.70, 0.32],

  coverVisible: [0.02, 0.52, 0.34],
  coverOverlap: [0.82, 0.42, 0.02],
  coverShadow: [0.05, 0.09, 0.17],
  coverShadowMix: 0.50,

  trailSlow: [0.04, 0.33, 0.60],
  trailFast: [0.78, 0.34, 0.02],
  trailMuted: [0.52, 0.60, 0.64],
  trailAlert: [0.84, 0.26, 0.04],
  headSlow: [0.02, 0.24, 0.46],
  headFast: [0.66, 0.28, 0.02],
  headMuted: [0.56, 0.63, 0.67],
  headAlert: [0.86, 0.28, 0.04],

  mast: [0.78, 0.40, 0.02],
  mastSelected: [0.94, 0.60, 0.10],
  siteDisc: [0.86, 0.48, 0.04],
  assetMarker: [0.03, 0.40, 0.68],
  vesselRing: [0.78, 0.36, 0.02],
};

export const SCENE_THEMES: Record<ThemeName, SceneTheme> = {
  dark: DARK_SCENE,
  light: LIGHT_SCENE,
};

/**
 * What the UI has to admit when the bright theme is on.
 *
 * Kept here next to the values it describes rather than as a string in the panel, so that changing
 * the palette and changing the claim about the palette are the same edit. PLAN §3.2: a caveat that
 * lives far from the thing it qualifies is a caveat that goes stale.
 */
export const LIGHT_THEME_CAVEAT =
  "Helles Design: Abschattung und Mastmarker heben sich schwächer ab als im dunklen Design. "
  + "Die Zahlen ändern sich dadurch nicht — nur ihre Ablesbarkeit.";
