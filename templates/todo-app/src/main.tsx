import { bridgeFabricCallback } from '@microsoft/rayfin-auth-provider-fabric';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App';
import { AuthProvider } from './hooks/AuthContext';
import { AuthSettingsProvider } from './hooks/AuthSettingsContext';
import { ServiceContainer } from './services/ServiceContainer';

// Backward compat: old Fabric Portal may redirect the popup to the bare origin
// (root page) with handoff params in the URL hash. Detect this early — before
// mounting React — and bridge the handoff code to the opener tab. If the bridge
// fires, the popup closes itself and there is nothing to render.
if (bridgeFabricCallback()) {
  // Popup is closing — skip the rest of the bootstrap.
} else {
  // Initialize the service container
  // Service mode is determined by VITE_SERVICE_MODE environment variable
  // Default: 'rayfin' - connects to the backend API
  // Alternative: 'mock' - uses mock data for testing without a backend
  const serviceMode =
    (import.meta.env.VITE_SERVICE_MODE as 'mock' | 'rayfin') || 'rayfin';
  console.log(`🚀 Initializing application in '${serviceMode}' mode`);

  ServiceContainer.create(serviceMode);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthSettingsProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AuthSettingsProvider>
    </StrictMode>
  );
}
