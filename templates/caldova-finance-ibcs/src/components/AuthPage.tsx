import { useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';

export function AuthPage() {
  const { signIn, fabricAuthEnabled, error } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid h-full place-items-center">
      <div className="w-[340px] border-t-2 border-ink pt-4">
        <h1 className="text-[20px] font-bold">Caldova Finance</h1>
        <p className="mt-1 text-[13px] text-muted">Income statement, balance sheet and cash flow in IBCS notation.</p>
        <button
          type="button"
          disabled={busy}
          className="mt-4 w-full rounded bg-ink py-2 text-[13px] text-paper disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            void signIn()
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          {busy ? (fabricAuthEnabled ? 'Opening Fabric…' : 'Signing in…') : 'Sign in with Microsoft'}
        </button>
        {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      </div>
    </div>
  );
}
