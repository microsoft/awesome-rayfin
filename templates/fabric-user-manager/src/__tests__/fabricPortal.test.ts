import { buildBrokerUrl } from '@microsoft/rayfin-auth-provider-fabric/dist/brokerUrl.js';
import { describe, expect, it } from 'vitest';

import { portalInTenant } from '@/services/fabricPortal';

const TENANT = 'aaaaaaaa-1111-4111-8111-' + '111111111111';

describe('the address of the sign-in window', () => {
  it('names the tenant the app lives in, so a guest does not land in their home tenant', () => {
    expect(portalInTenant('https://app.fabric.microsoft.com', TENANT)).toBe(`https://app.fabric.microsoft.com/?ctid=${TENANT}`);
    expect(portalInTenant('https://app.fabric.microsoft.com/', TENANT.toUpperCase())).toBe(`https://app.fabric.microsoft.com/?ctid=${TENANT}`);
  });

  it('leaves the address alone without a usable tenant, with a tenant already named, or when it is no address', () => {
    expect(portalInTenant('https://app.fabric.microsoft.com', undefined)).toBe('https://app.fabric.microsoft.com');
    expect(portalInTenant('https://app.fabric.microsoft.com', 'common&x=1')).toBe('https://app.fabric.microsoft.com');
    expect(portalInTenant('https://app.fabric.microsoft.com/?ctid=other', TENANT)).toBe('https://app.fabric.microsoft.com/?ctid=other');
    expect(portalInTenant('not a url', TENANT)).toBe('not a url');
  });

  it('survives into the address the sign-in library builds, on the same origin', () => {
    const broker = new URL(buildBrokerUrl({ fabricPortalUrl: portalInTenant('https://app.fabric.microsoft.com', TENANT), workspaceId: 'w', projectId: 'p', returnOrigin: 'https://x.example' }));
    expect(broker.origin).toBe('https://app.fabric.microsoft.com');
    expect(broker.pathname).toBe('/secureItemEmbed');
    expect(broker.searchParams.get('ctid')).toBe(TENANT);
    expect(broker.searchParams.get('itemId')).toBe('p');
  });
});
