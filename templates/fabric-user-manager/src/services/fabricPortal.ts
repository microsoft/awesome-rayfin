/**
 * The address the sign-in window opens.
 *
 * The Fabric portal opens in the signed-in person's home tenant unless the
 * address names another one. For a guest of this app's tenant the sign-in
 * window therefore landed in the wrong tenant, and the sign-in failed there
 * (seen live on 2026-10-10). `ctid` names the tenant the app lives in; for
 * people whose home tenant that is, it changes nothing.
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function portalInTenant(portalUrl: string, tenantId: string | undefined): string {
  if (!tenantId || !GUID.test(tenantId)) return portalUrl;
  try {
    const url = new URL(portalUrl);
    // An address that already names a tenant is left as configured.
    if (!url.searchParams.has('ctid')) url.searchParams.set('ctid', tenantId.toLowerCase());
    return url.toString();
  } catch {
    return portalUrl;
  }
}
