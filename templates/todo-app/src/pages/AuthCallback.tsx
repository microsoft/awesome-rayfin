import { bridgeFabricCallback } from '@microsoft/rayfin-auth-provider-fabric';

import { MagicLinkCallback } from './MagicLinkCallback';

/**
 * Unified auth callback dispatcher for /auth/callback.
 *
 * With the postMessage-based Fabric auth flow, there is normally no Fabric
 * redirect. However, old Fabric Portal deployments still redirect the popup
 * here with handoff params. {@link bridgeFabricCallback} detects that case,
 * forwards the handoff code to the opener via postMessage, and closes the
 * popup — so {@link initiateFabricLogin}'s listener handles both paths.
 *
 * If no Fabric bridge was triggered, this page handles magic-link callbacks.
 */
export function AuthCallback() {
  // Backward compat: old Fabric Portal redirects the popup here.
  // Bridge the handoff code to the opener via postMessage and close.
  if (bridgeFabricCallback()) {
    return null;
  }

  return <MagicLinkCallback />;
}
