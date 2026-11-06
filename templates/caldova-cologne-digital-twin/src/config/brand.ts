import active from '@brand-active';
import neutralBrand from '@brand-neutral';

/**
 * Which name the same solution goes out under.
 *
 * ⚠️ A BRAND IS A LABEL, NOT A VARIANT. Everything measured or modelled — the terrain, the 5 538
 * buildings, the 202 pharmacies, the road network, the operating day, every figure in the semantic
 * model — is identical whichever name is applied. Only display names differ, which is what makes
 * "the two solutions cannot drift" a property of the build rather than a promise somebody has to
 * remember: there is one codebase, one dataset and one set of Fabric artefacts.
 *
 * ⚠️ ONE BUILD, SWITCHED AT RUN TIME. There was briefly a second, NEUTRAL build in which the
 * customer's name did not appear in any shipped byte, guarded by a grep over the bundle. It was
 * removed once this switch existed, deliberately and on request.
 *
 * What that gave up, stated plainly rather than left to be discovered: the name is now in the
 * JavaScript even with the switch off, so anyone who opens the developer tools can find it. This
 * controls what is DISPLAYED, not what is shipped. For showing the same demo to the customer and
 * then to somebody else an hour later that is exactly right; for a room where the name must not
 * exist at all, it is not sufficient, and the honest answer there is to remove
 * `config/brand/caldova.json` and rebuild.
 */
export interface Brand {
  id: string;
  operator: DisplayText;
  site: DisplayText;
  tagline: DisplayText;
  /** Display-name overrides for AOI focus places, keyed by place id. Never coordinates. */
  placeNames: Record<string, DisplayText>;
}

/** A display string per UI locale. The template ships English only (`Locale = 'en'`). */
export interface DisplayText {
  en: string;
}

/**
 * The brand this build carries, resolved by the `@brand-active` alias in `vite.config.ts`.
 *
 * ⚠️ RESOLVED BY THE BUNDLER, NOT BY A LOOKUP TABLE, AND THE FIRST VERSION GOT THAT WRONG. It kept
 * `BRANDS = { neutral }` and selected from it with an environment variable, while the comment
 * above it claimed overlays were "resolved at build time and only when asked for". The customer
 * overlay was never in the map, so asking for it silently produced an unbranded build — and
 * nothing said so.
 */
export const BRAND: Brand = active as Brand;

/** The unbranded labels — what the switch falls back to. */
export const NEUTRAL: Brand = neutralBrand as Brand;

/*
 * The live state. Deliberately a two-line store rather than React state: the 3D scene needs the
 * same value, and the scene is not a component. Both sides read `brandOn()` and subscribe.
 *
 * ⚠️ NOT PERSISTED. A demo that remembers it was left unbranded three days ago, and so opens
 * without the customer's name in front of the customer, is a worse failure than re-pressing a
 * button. It starts ON every load, which is also what "this is their solution" should mean.
 */
let on = true;
const listeners = new Set<() => void>();

/** Whether the customer's names are currently shown. */
export function brandOn(): boolean {
  return on;
}

export function setBrandOn(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const listener of listeners) listener();
}

/** Subscribe to the switch. Returns the unsubscribe, which callers must actually call. */
export function subscribeBrand(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The labels in force right now: the customer's if the switch is on, otherwise the neutral set. */
export function currentBrand(): Brand {
  return on ? BRAND : NEUTRAL;
}

/**
 * The display name for a focus place: the active brand's override if it has one, else the AOI's
 * own name from OpenStreetMap.
 *
 * ⚠️ THE FALLBACK IS THE AOI'S NAME, NOT THE NEUTRAL BRAND'S. The neutral overlay deliberately
 * carries no place names at all, so switching the brand off does not blank the map — it drops back
 * to what OpenStreetMap actually calls those buildings, which is a real answer rather than an
 * absence.
 */
export function placeName(placeId: string, fallback: DisplayText): DisplayText {
  return currentBrand().placeNames?.[placeId] ?? fallback;
}
