import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./auth/AuthGate";
import { handleCallbackTab } from "./auth/fabricAuth";
import { applyUiTheme, readInitialTheme } from "./theme";

/**
 * 🔴 The palette is applied at MODULE SCOPE, before React renders anything.
 *
 * The chrome is styled with `--mi-*` custom properties, and an undefined custom property resolves
 * to nothing at all — no colour, no fallback, no warning. Applying the palette inside a component
 * effect would therefore let `AuthGate` (which renders before `App`) paint one frame with every
 * colour missing, on the very first screen an unauthenticated visitor sees.
 */
const initialTheme = readInitialTheme();
applyUiTheme(initialTheme, document.documentElement, document.body);

/**
 * 🔴 The broker's callback tab is handled **before React starts**.
 *
 * Static hosting answers every path with `index.html`, so the callback URL boots this same
 * application. Without this short-circuit that throwaway tab — whose entire job is to hand a token
 * back to the opener and close itself — would mount the scene and download the terrain.
 */
if (handleCallbackTab()) {
  document.body.style.cssText =
    "margin:0;padding:24px;background:#0d1b24;color:#e8eef2;font:14px system-ui,sans-serif";
  document.body.textContent = "Anmeldung wird abgeschlossen …";
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AuthGate>
        <App initialTheme={initialTheme} />
      </AuthGate>
    </StrictMode>,
  );
}
