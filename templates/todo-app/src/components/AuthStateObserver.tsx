import { useEffect } from 'react';

import { getRayfinClient } from '../services/rayfin/RayfinClientService';

interface AuthStateObserverProps {
  onAuthStateChange: (isAuthenticated: boolean) => void;
}

export function AuthStateObserver({
  onAuthStateChange,
}: AuthStateObserverProps) {
  useEffect(() => {
    // Only run in Rayfin mode
    const serviceMode = import.meta.env.VITE_SERVICE_MODE || 'rayfin';
    if (serviceMode === 'mock') {
      console.log('AuthStateObserver: Skipping in mock mode');
      return () => {};
    }

    try {
      const rayfinClient = getRayfinClient();

      // Subscribe to session changes from RayfinClient
      const unsubscribe = rayfinClient.auth.onSessionChange((session) => {
        console.log('AuthStateObserver: Session changed:', !!session);
        onAuthStateChange(!!session);
      });

      // Clean up subscription on unmount
      return () => {
        unsubscribe();
      };
    } catch (error) {
      console.warn('AuthStateObserver: RayfinClient not initialized', error);
      return () => {};
    }
  }, [onAuthStateChange]);

  // This component doesn't render anything
  return null;
}
