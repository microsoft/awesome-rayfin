import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { bootstrap, tryResumeSession, type AppEnv } from '@/services/auth';
import { initPowerBiAuth } from '@/services/powerBiDirect';

import './main.css';

function Root({ env }: { env: AppEnv }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void tryResumeSession(env)
      .then((ok) => {
        if (!cancelled) setAuthenticated(ok);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [env]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] opacity-60">
        Connecting to Fabric...
      </div>
    );
  }

  return (
    <App env={env} authenticated={authenticated} onAuthenticated={() => setAuthenticated(true)} />
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found.');

document.documentElement.classList.add('dark');

// ⚠️ Before anything else, and unconditionally. When this page IS the sign-in popup, this is the
// call that publishes the result back to the opener; when it is a normal load after a redirect
// sign-in, it is what picks the token up. Delaying it hangs the popup flow.
initPowerBiAuth();

// Dev-only 3D harness: `vite` + `/?preview=cesium` renders the Helsinki layers with synthetic
// vehicles, so the scene can be checked without the Fabric sign-in round trip.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'cesium') {
  void import('@/dev/CesiumPreview').then(({ CesiumPreview }) => {
    createRoot(container).render(<CesiumPreview />);
  });
} else {
  try {
    const env = bootstrap();
    createRoot(container).render(
      <StrictMode>
        <Root env={env} />
      </StrictMode>,
    );
  } catch (error) {
    container.innerHTML = `<pre style="padding:24px;font:13px ui-monospace;color:#f87171">${
      error instanceof Error ? error.message : String(error)
    }</pre>`;
  }
}
