/**
 * Text helpers shared by the Fabric User Manager views. Kept out of the
 * component files so those export components only.
 */
import type { Translate, TranslationKey } from '@/i18n';
import type { ActivationError } from '@/um/domain/activation';
import { permissionInfo, type PermissionSet, type RefusalKind } from '@/um/domain/permissions';
import type { NotReadableReason } from '@/um/domain/types';
import { RefusedError } from '@/um/services/operations';
import { AlreadyActivatedError, VersionConflictError } from '@/um/services/store';

export function reasonKey(reason: NotReadableReason): TranslationKey {
  return `um.reason.${reason}`;
}

/**
 * What to add when a permission was asked for and not granted. Entra's answer
 * does not say why, so this goes by what the permission normally needs.
 */
export function grantHint(t: Translate, set: PermissionSet, why?: RefusalKind): string {
  const info = permissionInfo(set);
  const permissions = info.names.join(', ');
  // A closed window says nothing about who may grant it.
  if (why === 'closed') return t('um.grant.hint.closed', { permissions });
  return t(info.needsAdmin ? 'um.grant.hint.admin' : 'um.grant.hint.user', { permissions });
}

export function errorText(t: Translate, error: ActivationError): string {
  if (typeof error === 'string') return t(`um.err.${error}`);
  return t('um.err.ineligible', { reasons: error.ineligible.map((r) => t(`um.inelig.${r}`)).join(', ') });
}

export function failureText(t: Translate, error: unknown): string {
  if (error instanceof RefusedError) return error.errors.map((e) => errorText(t, e)).join(' ');
  if (error instanceof VersionConflictError) return t('um.err.conflict');
  if (error instanceof AlreadyActivatedError) return t('um.err.already-activated');
  return t('um.err.generic');
}
