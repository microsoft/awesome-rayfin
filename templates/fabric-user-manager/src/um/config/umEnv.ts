/**
 * Build-time configuration of the Fabric User Manager.
 *
 * Ids only, never a credential. Tenant and client id are enough to sign in to
 * Graph, and a missing value is reported instead of thrown.
 */
import { isGuid } from '@/um/domain/types';

export interface UmEnv {
  tenantId?: string;
  /**
   * The registration the app signs in to Graph with: its own one when the build
   * names it (`VITE_UM_CLIENT_ID`), otherwise the Rayfin sign-in registration.
   */
  clientId?: string;
  /** Entra group whose members are app admins. Fixed at build time on purpose. */
  adminGroupId?: string;
  /**
   * Entra object ids of individual app admins, for a start without a group.
   * Like the group, this decides what the app offers, not what Entra or
   * Fabric allow.
   */
  adminUserIds: string[];
  /** Offline demo: fixture data, no tenant, no backend. */
  mock: boolean;
}

type RawEnv = Record<string, string | boolean | undefined>;

function guidOrUndefined(value: unknown): string | undefined {
  return isGuid(value) ? value.toLowerCase() : undefined;
}

export function readUmEnv(raw: RawEnv): UmEnv {
  return {
    tenantId: guidOrUndefined(raw.VITE_FABRIC_TENANT_ID),
    clientId: guidOrUndefined(raw.VITE_UM_CLIENT_ID) ?? guidOrUndefined(raw.VITE_FABRIC_SPA_CLIENT_ID),
    adminGroupId: guidOrUndefined(raw.VITE_UM_ADMIN_GROUP_ID),
    adminUserIds: String(raw.VITE_UM_ADMIN_USER_IDS ?? '')
      .split(/[,;\s]+/)
      .filter(isGuid)
      .map((id) => id.toLowerCase()),
    mock: raw.VITE_UM_MOCK === 'true',
  };
}

export function getUmEnv(): UmEnv {
  return readUmEnv(import.meta.env as RawEnv);
}

/** Names of the values a real sign-in still needs. Empty when complete. */
export function missingForGraph(env: UmEnv): string[] {
  const missing: string[] = [];
  if (!env.tenantId) missing.push('VITE_FABRIC_TENANT_ID');
  if (!env.clientId) missing.push('VITE_UM_CLIENT_ID');
  return missing;
}
