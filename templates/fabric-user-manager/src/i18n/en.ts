/**
 * English strings — the source of truth for translation keys.
 *
 * `de.ts` must define exactly the same key set; `src/__tests__/i18n.test.ts`
 * fails the build otherwise.
 *
 * Rules:
 * - **Never translate Microsoft product or setting names.** "Users can create
 *   Fabric items" stays English inside a German sentence, because that is the
 *   string the admin will search for in the portal.
 * - Placeholders use `{name}` and are substituted by `t(key, { name })`.
 */
import { umEn } from './um.en';

export const en = {
  'app.name': 'Fabric User Manager',

  'common.signOut': 'Sign out',
  'common.loading': 'Loading…',
  'common.language': 'Language',

  'auth.title': 'Fabric User Manager',
  'auth.subtitle': 'Sign in with your organizational account to continue.',
  'auth.signInWithMicrosoft': 'Sign in with Microsoft',
  'auth.openingFabric': 'Opening Fabric…',
  'auth.signingIn': 'Signing in…',
  'auth.signInFailed': 'Failed to sign in.',

  ...umEn,
} as const;

export type TranslationKey = keyof typeof en;
