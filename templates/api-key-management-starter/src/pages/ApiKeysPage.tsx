import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import {
  createApiKey,
  getApiKeys,
  revokeApiKey,
  type ApiKeyRecord,
} from '@/services/apiKeys';
import { formatDateTime } from '@/utils/date';

const MAX_LABEL_LENGTH = 100;

type CreatedKey = {
  rawKey: string;
  label: string;
  prefix: string | null;
  createdAt: Date;
};

export function ApiKeysPage() {
  const { signOut, user } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getApiKeys();
      setKeys(data);
    } catch (err) {
      console.error('Error fetching API keys:', err);
      setError('Failed to fetch API keys. Please check your session.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Label is required.');
      return;
    }
    if (trimmed.length > MAX_LABEL_LENGTH) {
      setError(`Label must be ${MAX_LABEL_LENGTH} characters or less.`);
      return;
    }

    setCreating(true);
    setError(null);
    setCopyState('idle');

    try {
      const result = await createApiKey(trimmed);
      setCreatedKey({
        rawKey: result.rawKey,
        label: result.record.label,
        prefix: result.record.prefix ?? null,
        createdAt: result.record.createdAt,
      });
      setLabel('');
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create key.';
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.rawKey);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const handleDismissCreatedKey = () => {
    setCreatedKey(null);
    setCopyState('idle');
  };

  const handleRevoke = async (id: string) => {
    const confirmed = window.confirm(
      'Revoke this key? It will no longer authenticate requests.'
    );
    if (!confirmed) return;

    setError(null);
    try {
      await revokeApiKey(id);
      await fetchKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revoke key.';
      setError(message);
    }
  };

  const activeCount = useMemo(
    () => keys.filter((key) => key.status === 'active').length,
    [keys]
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-amber-50 text-slate-900">
      <div className="pointer-events-none absolute -top-28 right-0 h-96 w-96 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-[-120px] h-[520px] w-[520px] rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_60%)]" />

      <header className="relative z-10 border-b border-emerald-100/70 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">
              API Key Management
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">API Keys</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {user?.email && (
              <span className="hidden text-slate-500 sm:inline" title={user.email}>
                {user.email}
              </span>
            )}
            <button
              onClick={() => void signOut()}
              className="rounded-full border border-slate-200 px-4 py-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-emerald-100/70 bg-white/80 p-6 shadow-xl shadow-emerald-100/60 backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900">Create a key</h2>
            <p className="mt-1 text-sm text-slate-500">
              Issue API keys for integrations, scripts, and automation.
            </p>

            <form onSubmit={(event) => void handleCreate(event)} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="label"
                  className="block text-sm font-medium text-slate-700"
                >
                  Label
                </label>
                <div className="mt-2">
                  <input
                    id="label"
                    type="text"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={MAX_LABEL_LENGTH}
                    placeholder="CI integration"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {creating ? 'Creating...' : 'Create API key'}
                </button>
                <span className="text-xs text-slate-500">
                  {activeCount} active key{activeCount === 1 ? '' : 's'}
                </span>
              </div>
            </form>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {createdKey && (
              <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">
                      API key created
                    </p>
                    <p className="text-xs text-emerald-700/80">
                      Copy this key now. For security reasons it will not be shown again.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDismissCreatedKey}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                  >
                    Done
                  </button>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-3 py-2">
                  <code className="block break-all text-xs text-slate-700">
                    {createdKey.rawKey}
                  </code>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="rounded-full border border-emerald-200 px-3 py-1 font-semibold text-emerald-700 hover:border-emerald-300"
                  >
                    Copy key
                  </button>
                  {copyState === 'copied' && (
                    <span className="text-emerald-700">Copied.</span>
                  )}
                  {copyState === 'failed' && (
                    <span className="text-red-600">Copy failed.</span>
                  )}
                  <span className="text-slate-500">
                    Label: {createdKey.label} {createdKey.prefix ? `- ${createdKey.prefix}` : ''}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-amber-100/70 bg-white/80 p-6 shadow-xl shadow-amber-100/60 backdrop-blur">
            <h2 className="text-lg font-semibold text-slate-900">How keys work</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li>Keys are generated with a unique prefix and a secret suffix.</li>
              <li>Only a SHA-256 hash is stored in the database.</li>
              <li>Revoked keys stop authenticating immediately.</li>
              <li>Share keys only with trusted integrations.</li>
            </ul>
          </section>
        </div>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Your keys</h2>
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {keys.length} total
            </span>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-slate-500">Loading...</p>
          ) : keys.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-white/70 p-8 text-center">
              <p className="text-sm text-slate-500">
                No API keys yet. Create one to enable integrations or automation.
              </p>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white/80 shadow-lg shadow-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Label</th>
                    <th className="px-5 py-3 font-semibold">Prefix</th>
                    <th className="px-5 py-3 font-semibold">Owner</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} className="border-t border-slate-100">
                      <td className="px-5 py-4 text-slate-800">{key.label}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {key.prefix ?? 'rk_live_******'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {key.ownerUserId}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={key.status} />
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {formatDateTime(key.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => void handleRevoke(key.id)}
                          disabled={key.status === 'revoked'}
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300"
                        >
                          {key.status === 'revoked' ? 'Revoked' : 'Revoke'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: ApiKeyRecord['status'] }) {
  const badgeStyles =
    status === 'active'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-rose-100 text-rose-700';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${badgeStyles}`}
    >
      {status}
    </span>
  );
}
