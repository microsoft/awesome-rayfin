import { useCallback, useEffect, useState } from 'react';

import { apiBase, schedulerConfigured } from '@/api/scheduler';
import { useI18n } from '@/i18n';

/**
 * Where the timetable comes from, and whether WebUntis can actually be reached.
 *
 * ⚠️ THIS EXISTS TO MAKE A SENTENCE TRUE. "Only the configuration is missing" was being said about
 * the Untis API while nothing in the product could attempt to talk to it — so the claim could be
 * neither shown nor disproved. Pressing the button here performs a real login against a real
 * server and reports what actually came back.
 *
 * ⚠️ CONFIGURED IS NOT CONNECTED, and the two are drawn differently on purpose. A green tick that
 * means "the form is filled in" is worse than no tick, because it is the version somebody repeats
 * in a meeting. Only a state of `connected` — an authenticated session that also managed a read —
 * gets the confident colour.
 *
 * ⚠️ THE PASSWORD IS NEVER READ BACK. The backend returns `passwordSet` and nothing else, so a
 * stored login can be re-tested without this panel ever having seen it. What is typed here is used
 * for one request and not persisted anywhere.
 */

type SourceState = 'connected' | 'configured' | 'unconfigured' | 'blocked' | 'unreachable'
  | 'http-error' | 'rejected';

interface Source {
  id: string;
  label: string;
  active: boolean;
  state: SourceState;
  sessions?: number;
  rooms?: number;
  teachers?: number;
  timetableProvenance?: string | null;
  note?: string;
  config?: { server: string; school: string; username: string; passwordSet: boolean };
}

interface Status {
  site: string;
  sources: Source[];
  writeback: { implemented: boolean; mechanism: string; requires: string[] };
}

interface TestResult {
  ok: boolean;
  state: SourceState;
  message: string;
  endpoint?: string;
  elapsedMs?: number;
  rooms?: number | null;
  httpStatus?: number;
}

const TONE: Record<string, string> = {
  connected: 'text-emerald-300 border-emerald-500/50',
  configured: 'text-amber-300 border-amber-500/50',
  unconfigured: 'text-stone-400 border-stone-600',
  blocked: 'text-red-300 border-red-500/50',
  unreachable: 'text-red-300 border-red-500/50',
  'http-error': 'text-red-300 border-red-500/50',
  rejected: 'text-red-300 border-red-500/50',
};

function key(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_SCHEDULER_KEY ?? env.VITE_RAYFIN_SCHEDULER_KEY ?? '';
}

export default function IntegrationPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ server: '', school: '', username: '', password: '' });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!schedulerConfigured()) {
      setError(t('integration.noPlanner'));
      return;
    }
    let cancelled = false;
    const headers: HeadersInit = key() ? { 'X-App-Key': key() } : {};
    fetch(new URL('/api/integration/status', apiBase()).toString(), { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Status) => {
        if (cancelled) return;
        setStatus(data);
        const untis = data.sources.find((s) => s.id === 'webuntis');
        if (untis?.config) {
          setForm((f) => ({
            ...f,
            server: untis.config!.server,
            school: untis.config!.school,
            username: untis.config!.username,
          }));
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setResult(null);
    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(key() ? { 'X-App-Key': key() } : {}),
      };
      const response = await fetch(new URL('/api/integration/untis/test', apiBase()).toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(form),
      });
      setResult((await response.json()) as TestResult);
    } catch (e) {
      setResult({ ok: false, state: 'unreachable', message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }, [form]);

  const file = status?.sources.find((s) => s.id === 'file');

  return (
    <section
      data-testid="integration-panel"
      className="fixed inset-0 z-40 overflow-auto bg-stone-950/97 backdrop-blur"
    >
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xs uppercase tracking-[0.18em] text-stone-400">
              {t('integration.title')}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">
              {t('integration.intro')}
            </p>
          </div>
          <button
            type="button"
            data-testid="integration-close"
            onClick={onClose}
            className="rounded border border-stone-600 px-3 py-1.5 text-xs text-stone-300 transition hover:bg-stone-800 hover:text-stone-50"
          >
            {t('national.close')}
          </button>
        </div>

        {error && (
          <p data-testid="integration-error" className="mt-6 rounded border border-stone-700 bg-stone-900/70 p-4 text-xs text-stone-400">
            {error}
          </p>
        )}

        {file && (
          <div data-testid="source-file" className="mt-8 rounded border border-emerald-500/40 bg-stone-900/70 p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-stone-100">{file.label}</p>
              <span className="text-[0.65rem] uppercase tracking-wide text-emerald-300">
                {t('integration.inUse')}
              </span>
            </div>
            <p className="mt-2 text-xs text-stone-400">
              {file.sessions} {t('integration.sessions')} · {file.rooms} {t('integration.rooms')} ·{' '}
              {file.teachers} {t('integration.teachers')}
              {file.timetableProvenance ? ` · ${file.timetableProvenance}` : ''}
            </p>
            <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">{file.note}</p>
          </div>
        )}

        <div className="mt-4 rounded border border-stone-700 bg-stone-900/70 p-4">
          <p className="text-sm font-medium text-stone-100">WebUntis API</p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-stone-500">
            {t('integration.untisNote')}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {(['server', 'school', 'username', 'password'] as const).map((field) => (
              <label key={field} className="block">
                <span className="text-[0.65rem] uppercase tracking-wide text-stone-400">
                  {t(`integration.field.${field}`)}
                </span>
                <input
                  data-testid={`untis-${field}`}
                  type={field === 'password' ? 'password' : 'text'}
                  autoComplete={field === 'password' ? 'new-password' : 'off'}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'server' ? 'xyz.webuntis.com' : ''}
                  className="mt-1 w-full rounded border border-stone-600 bg-stone-950 px-2 py-1.5 text-xs text-stone-100 outline-none focus:border-amber-500"
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            data-testid="untis-test"
            onClick={runTest}
            disabled={testing}
            className="mt-4 rounded bg-amber-500 px-3 py-2 text-xs font-medium text-ink transition hover:bg-amber-400 disabled:opacity-50"
          >
            {testing ? t('integration.testing') : t('integration.test')}
          </button>

          {result && (
            <div
              data-testid="untis-result"
              data-state={result.state}
              className={`mt-4 rounded border p-3 text-xs leading-relaxed ${TONE[result.state] ?? TONE.rejected}`}
            >
              <p className="font-medium">{t(`integration.state.${result.state}`)}</p>
              <p className="mt-1 text-stone-300">{result.message}</p>
              {result.endpoint && (
                <p className="mt-1 text-[0.65rem] text-stone-500">
                  {result.endpoint}
                  {result.elapsedMs !== undefined ? ` · ${result.elapsedMs} ms` : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {status?.writeback && (
          <div data-testid="writeback-note" className="mt-4 rounded border border-stone-700 bg-stone-950/60 p-4">
            <p className="text-sm font-medium text-stone-100">{t('integration.writeback')}</p>
            {/*
              ⚠️ Stated as NOT built, with what it would take. This repo has a standing rule that
              write-back is a decision gate rather than a promise, and the surest way to break it
              is to leave a disabled "Write to Untis" button lying around for someone to point at.
              There is no button here on purpose.
            */}
            <p className="mt-1 text-[0.7rem] leading-relaxed text-stone-400">
              {t('integration.writebackNote')}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[0.7rem] text-stone-500">
              {status.writeback.requires.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
