import { useCallback, useEffect, useState } from "react";
import {
  authConfigured,
  authRequired,
  signIn,
  trySilentSignIn,
  type SignedInUser,
} from "./fabricAuth";

/**
 * Renders its children only once a Microsoft Entra identity has signed in.
 *
 * 🔴 The gate is placed **above** the scene on purpose. Everything expensive in this app —
 * ninety megabytes of terrain, the buildings, the AIS day — is fetched by the scene, so gating
 * inside it would mean an anonymous visitor still pulled the whole payload before being told no.
 * Nothing is requested until `user` is set.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const required = authRequired();
  const configured = authConfigured();

  useEffect(() => {
    let cancelled = false;
    if (!required) { setChecking(false); return; }
    trySilentSignIn()
      .then((found) => { if (!cancelled) setUser(found); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [required]);

  const onSignIn = useCallback(() => {
    // ⚠️ No await before `signIn()`: it opens a tab, and a browser only allows that straight out
    // of the gesture that asked for it.
    setBusy(true);
    setError(null);
    signIn()
      .then(setUser)
      .catch((exception: unknown) => {
        setError(exception instanceof Error ? exception.message : String(exception));
      })
      .finally(() => setBusy(false));
  }, []);

  if (!required || user) return <>{children}</>;

  /**
   * 🔴 Deployed, but with no Fabric configuration to check an identity against. The safe answer
   * is to refuse: a gate that silently opens when its configuration goes missing protects nothing
   * on precisely the day it matters.
   */
  if (!configured) {
    return (
      <Shell title="Anmeldung nicht möglich" testId="twin3d-auth-misconfigured">
        <p style={TEXT}>
          Diese Instanz ist ohne Fabric-Konfiguration ausgeliefert worden, daher kann keine
          Identität geprüft werden. Der Zugang bleibt deshalb geschlossen.
        </p>
        <p style={{ ...TEXT, opacity: 0.55 }}>
          Beheben mit <code>rayfin env --framework vite</code> und einem erneuten Build.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Maritime-Insights" testId="twin3d-auth-gate">
      <p style={TEXT}>
        Diese Anwendung ist <strong>nicht öffentlich zugänglich</strong>. Bitte melden Sie sich
        mit Ihrem Microsoft-Konto an.
      </p>
      <button
        data-testid="twin3d-auth-signin"
        onClick={onSignIn}
        disabled={busy || checking}
        style={{
          background: "var(--mi-accent13)", color: "var(--mi-text)", border: "1px solid var(--mi-accent33)",
          borderRadius: 6, padding: "9px 14px", fontSize: 13,
          cursor: busy || checking ? "default" : "pointer", opacity: busy || checking ? 0.6 : 1,
        }}
      >
        {checking ? "Sitzung wird geprüft …" : busy ? "Anmeldung läuft …" : "Mit Microsoft anmelden"}
      </button>
      {busy && (
        <p style={{ ...TEXT, opacity: 0.55 }}>
          Die Anmeldung öffnet sich in einem neuen Tab. Falls nichts passiert, erlauben Sie
          Pop-ups für diese Seite.
        </p>
      )}
      {error && (
        <p data-testid="twin3d-auth-error" style={{ ...TEXT, color: "var(--mi-warn)" }}>{error}</p>
      )}
      <p style={{ ...TEXT, opacity: 0.45, fontSize: 11, lineHeight: 1.5 }}>
        Demonstrations- und Anschauungszweck. Alle Daten stammen aus offenen Quellen.
      </p>
    </Shell>
  );
}

const TEXT: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, opacity: 0.85 };

function Shell({ title, testId, children }: {
  title: string; testId: string; children: React.ReactNode;
}) {
  return (
    <div data-testid={testId}
         style={{ position: "fixed", inset: 0, background: "var(--mi-bg)", color: "var(--mi-text)",
                  fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center",
                  padding: 24 }}>
      <div style={{ background: "var(--mi-panel-strong)", border: "1px solid var(--mi-line10)", borderRadius: 10,
                    padding: "26px 28px", maxWidth: 420, display: "flex",
                    flexDirection: "column", gap: 14 }}>
        <strong style={{ fontSize: 16 }}>{title}</strong>
        {children}
      </div>
    </div>
  );
}
