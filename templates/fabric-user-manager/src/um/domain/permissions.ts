/**
 * What each permission set is for, and which of them an administrator has to
 * grant. Pure, and only descriptive: the sets themselves are requested in
 * `services/graphAuth.ts`, and a test keeps the two lists the same.
 *
 * "Needs an administrator" is Microsoft's default for these permissions. A
 * tenant can be stricter (no user may consent to anything), so the texts say
 * "normally".
 */
export type PermissionSet = 'base' | 'directory' | 'fabric' | 'fabricAdmin' | 'memberChange' | 'fabricWrite' | 'mail' | 'groupCreate';

export interface PermissionInfo {
  set: PermissionSet;
  /** Permission names as Entra shows them. */
  names: readonly string[];
  /** True when at least one of them needs an administrator's consent by default. */
  needsAdmin: boolean;
  /** True for the sets that change something. Shown only in a build that can change things. */
  writes: boolean;
}

export const PERMISSIONS: readonly PermissionInfo[] = [
  { set: 'base', names: ['User.Read'], needsAdmin: false, writes: false },
  { set: 'fabric', names: ['Workspace.Read.All'], needsAdmin: false, writes: false },
  { set: 'directory', names: ['GroupMember.Read.All', 'User.ReadBasic.All'], needsAdmin: true, writes: false },
  { set: 'fabricAdmin', names: ['Tenant.Read.All'], needsAdmin: true, writes: false },
  { set: 'memberChange', names: ['GroupMember.ReadWrite.All', 'User.Read.All'], needsAdmin: true, writes: true },
  { set: 'fabricWrite', names: ['Workspace.ReadWrite.All'], needsAdmin: false, writes: true },
  { set: 'mail', names: ['Mail.Send'], needsAdmin: false, writes: true },
  { set: 'groupCreate', names: ['Group.ReadWrite.All'], needsAdmin: true, writes: true },
];

export function permissionInfo(set: PermissionSet): PermissionInfo {
  return PERMISSIONS.find((p) => p.set === set)!;
}

export type PermissionState = 'checking' | 'granted' | 'missing' | 'admin' | 'onDemand' | 'unknown';

/**
 * What the checklist shows.
 *
 * - `held`: what this tab knows from having used or asked for the set.
 * - `probe`: the result of looking without a sign-in window. Only read sets
 *   are looked at: looking at a write set would fetch a token that can change
 *   things before anyone started a change.
 */
export function permissionState(info: PermissionInfo, held: boolean | undefined, probe?: 'held' | 'not-held' | 'unknown'): PermissionState {
  if (held === true || probe === 'held') return 'granted';
  if (held === false || probe === 'not-held') return info.needsAdmin ? 'admin' : 'missing';
  if (info.writes) return 'onDemand';
  return probe === 'unknown' ? 'unknown' : 'checking';
}

/** The sets the checklist may look at silently. */
export const PROBED_SETS: readonly PermissionSet[] = PERMISSIONS.filter((p) => !p.writes).map((p) => p.set);

export type RefusalKind = 'closed' | 'denied' | 'other';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page in Entra where an administrator grants consent for this app's
 * listed permissions. `null` when the build does not name tenant and app.
 */
export function consentPageUrl(tenantId: string | undefined, clientId: string | undefined): string | null {
  if (!tenantId || !clientId || !GUID.test(tenantId) || !GUID.test(clientId)) return null;
  return `https://entra.microsoft.com/${tenantId.toLowerCase()}/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/${clientId.toLowerCase()}`;
}
