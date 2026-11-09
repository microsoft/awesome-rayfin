import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { LanguageToggle } from '@/components/LanguageToggle';
import { useAuth } from '@/hooks/AuthContext';
import { useT, type TranslationKey } from '@/i18n';
import { UM_PATHS } from '@/um/domain/profile';
import type { TargetKind } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';

import { Button, Notice, Pill } from './parts';

/** A tab without `kind` is not about access and never carries a count of waiting requests. */
const TABS: { to: string; labelKey: TranslationKey; kind?: TargetKind }[] = [
  { to: UM_PATHS.workspaces, labelKey: 'um.nav.workspaces', kind: 'Workspace' },
  { to: UM_PATHS.audiences, labelKey: 'um.nav.audiences', kind: 'Audience' },
  { to: UM_PATHS.modelRoles, labelKey: 'um.nav.modelRoles', kind: 'ModelRole' },
  { to: UM_PATHS.guidelines, labelKey: 'um.nav.guidelines' },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-t-lg px-4 py-2 text-sm font-medium ${
    isActive ? 'bg-white text-blue-700 shadow-[0_-1px_0_0_rgba(0,0,0,0.04)]' : 'text-gray-500 hover:text-gray-800'
  }`;

/** The standing notices: demo data, sign-in state, identity mismatch, database. */
export function UmNotices() {
  const t = useT();
  const { services, graphStatus, graphMissing, identity, sessionMatch, connect, storeReachable, adminUnknown, partsFailed } = useUm();
  const { user } = useAuth();

  return (
    <div className="space-y-3">
      {services.mock && <Notice tone="info">{t('um.mock.banner')}</Notice>}
      {partsFailed && (
        <Notice tone="alert" action={<Button onClick={() => window.location.reload()}>{t('um.shell.reload')}</Button>}>
          {t('um.shell.loadFailed')}
        </Notice>
      )}
      {graphStatus === 'connecting' && <p className="text-sm text-gray-500">{t('um.graph.connecting')}</p>}
      {graphStatus === 'not-configured' && <Notice tone="alert">{t('um.graph.notConfigured', { missing: graphMissing.join(', ') })}</Notice>}
      {(graphStatus === 'needs-sign-in' || graphStatus === 'error') && (
        <Notice
          tone={graphStatus === 'error' ? 'alert' : 'info'}
          action={
            <Button primary onClick={() => void connect()}>
              {t('um.graph.connect')}
            </Button>
          }
        >
          {t(graphStatus === 'error' ? 'um.graph.error' : 'um.graph.needsSignIn')}
        </Notice>
      )}
      {identity && sessionMatch === 'mismatch' && (
        <Notice tone="alert">{t('um.graph.mismatch', { session: user?.email ?? '', graph: identity.userPrincipalName })}</Notice>
      )}
      {adminUnknown && <Notice tone="warn">{t('um.admin.unknown')}</Notice>}
      {!storeReachable && <Notice tone="alert">{t('um.store.unreachable')}</Notice>}
    </div>
  );
}

/** Lookup field and the admin's gear. */
export function UmToolbar() {
  const t = useT();
  const navigate = useNavigate();
  const { isAppAdmin, graphStatus } = useUm();
  const [query, setQuery] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (q) navigate(`${UM_PATHS.person}?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {graphStatus === 'connected' && (
        <form onSubmit={submit} className="flex items-center gap-1" role="search">
          <label className="sr-only" htmlFor="um-person-search">
            {t('um.search.label')}
          </label>
          <input
            id="um-person-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('um.search.placeholder')}
            className="w-56 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800"
          />
          <Button type="submit">{t('um.search.go')}</Button>
        </form>
      )}
      {isAppAdmin && (
        <NavLink
          to={UM_PATHS.setup}
          end
          aria-label={t('um.nav.setup')}
          title={t('um.nav.setup')}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          <span aria-hidden="true">{'⚙ '}</span>
          {t('um.nav.setup')}
        </NavLink>
      )}
    </div>
  );
}

export function UmTabs() {
  const t = useT();
  const { rows, requests } = useUm();
  /** Pending requests for groups the viewer manages, per tab. */
  const waiting = (kind: TargetKind) =>
    requests.filter((r) => r.status === 'Pending' && rows.some((row) => row.access === 'manage' && row.group.groupId === r.groupId && row.bindings.some((b) => b.kind === kind))).length;
  return (
    <nav className="flex flex-wrap gap-1" aria-label={t('um.app.name')}>
      {TABS.map((tab) => {
        const count = tab.kind ? waiting(tab.kind) : 0;
        return (
          <NavLink key={tab.to} to={tab.to} className={tabClass}>
            {t(tab.labelKey)}
            {count > 0 && (
              <span className="ml-2 rounded-full bg-[#FF0000] px-1.5 py-0.5 text-xs font-semibold text-white" title={t('um.request.waiting', { count })}>
                {count}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** The shell: the three access tabs and the guidelines, nothing else in the navigation. */
export function UmLayout() {
  const t = useT();
  const { user, signOut } = useAuth();
  const { identity, isAppAdmin } = useUm();
  const appName = t('um.app.name');

  useEffect(() => {
    const previous = document.title;
    document.title = appName;
    return () => {
      document.title = previous;
    };
  }, [appName]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('um.app.name')}</h1>
            <p className="text-xs text-gray-500">{t('um.app.tagline')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <UmToolbar />
            {isAppAdmin && <Pill tone="info">{t('um.admin.badge')}</Pill>}
            <LanguageToggle />
            <span className="text-gray-600">{identity ? t('um.graph.actingAs', { name: identity.displayName }) : (user?.name ?? user?.email)}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              {t('common.signOut')}
            </button>
          </div>
        </div>
        <div className="px-4">
          <UmTabs />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <UmNotices />
        <Outlet />
      </main>
    </div>
  );
}
