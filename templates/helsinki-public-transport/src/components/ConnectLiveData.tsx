import { useState } from 'react';

import { connectPowerBi } from '@/services/daxGateway';
import { isEmbedded } from '@/services/powerBiDirect';

/**
 * Shown when the Rayfin semantic-model connector is unavailable and the app has fallen back to
 * querying Power BI directly, which needs its own delegated token.
 *
 * ⚠️ Embedded in the Fabric portal there is no way to acquire that token: the portal frame is
 * sandboxed with `allow-popups-to-escape-sandbox`, so a sign-in popup lands in a different storage
 * partition and MSAL's response never reaches the framed app, while a redirect is refused outright
 * (`redirect_in_iframe`). The honest answer there is to open the app in its own tab - which is
 * what the portal's own "Open" button does - rather than to spin on a doomed popup.
 */
export function ConnectLiveData({ onConnected }: { onConnected: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const embedded = isEmbedded();

  const connect = async (switchAccount = false) => {
    setBusy(true);
    setError(null);
    try {
      await connectPowerBi({ switchAccount });
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2"
      role="status"
      data-testid="connect-live-data"
    >
      <span className="text-[12px] text-amber-300">
        {embedded ? (
          <>
            Live data needs one more sign-in, and that cannot be done inside the Fabric portal
            frame. Open the app in its own tab to sign in.
          </>
        ) : (
          <>
            Live data needs one more sign-in: this workspace does not have the Fabric App
            semantic-model connector enabled, so the app queries Power BI directly.
          </>
        )}
      </span>

      {embedded ? (
        <a
          href={window.location.origin}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-amber-500/90 px-3 py-1 text-[12px] font-medium text-black no-underline"
          data-testid="open-standalone"
        >
          Open in a new tab
        </a>
      ) : (
        <>
          <button
            type="button"
            onClick={() => connect(false)}
            disabled={busy}
            className="rounded-md bg-amber-500/90 px-3 py-1 text-[12px] font-medium text-black disabled:opacity-40"
          >
            {busy ? 'Connecting...' : 'Connect live data'}
          </button>
          {/* Escape hatch for when the session lands on the wrong account - only this path is
              worth a full re-authentication. */}
          <button
            type="button"
            onClick={() => connect(true)}
            disabled={busy}
            className="text-[11px] text-amber-300/80 underline disabled:opacity-40"
          >
            Use a different account
          </button>
        </>
      )}

      {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
    </div>
  );
}
