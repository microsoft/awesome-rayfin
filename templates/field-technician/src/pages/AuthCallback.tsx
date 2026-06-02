import { bridgeFabricCallback } from '@microsoft/rayfin-auth-provider-fabric';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Auth callback page.
 *
 * With the postMessage-based Fabric auth flow, there is normally no redirect.
 * However, old Fabric Portal deployments still redirect the popup here with
 * handoff params. {@link bridgeFabricCallback} detects that case, forwards
 * the handoff code to the opener via postMessage, and closes the popup.
 *
 * If no Fabric bridge was triggered, this page redirects to home.
 */
export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Backward compat: old Fabric Portal redirects the popup here.
    // Bridge the handoff code to the opener via postMessage and close.
    if (bridgeFabricCallback()) {
      return; // popup is closing itself
    }
    navigate('/', { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-muted-foreground">Redirecting...</div>
    </div>
  );
}
