import type { en } from './en';

/**
 * German strings. Real umlauts and ß only — never ae/oe/ue/ss.
 *
 * Microsoft product and setting names stay English on purpose: the admin will
 * search for "Users can create Fabric items" in the portal, not for a
 * translation of it.
 */
import { umDe } from './um.de';

export const de: Record<keyof typeof en, string> = {
  'app.name': 'Fabric User Manager',

  'common.signOut': 'Abmelden',
  'common.loading': 'Wird geladen…',
  'common.language': 'Sprache',

  'auth.title': 'Fabric User Manager',
  'auth.subtitle': 'Melden Sie sich mit Ihrem Organisationskonto an, um fortzufahren.',
  'auth.signInWithMicrosoft': 'Mit Microsoft anmelden',
  'auth.openingFabric': 'Fabric wird geöffnet…',
  'auth.signingIn': 'Anmeldung läuft…',
  'auth.signInFailed': 'Die Anmeldung ist fehlgeschlagen.',

  ...umDe,
};
