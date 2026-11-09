import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { GrantRefusedNote } from '@/um/components/Permissions';
import { UmLayout } from '@/um/components/UmLayout';
import { PERMISSIONS, PROBED_SETS, consentPageUrl, permissionInfo, permissionState } from '@/um/domain/permissions';
import { UM_PATHS } from '@/um/domain/profile';
import { UmProvider } from '@/um/hooks/UmContext';
import { SCOPE_SETS, grantFailureOf } from '@/um/services/graphAuth';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { within as soon } from '@/um/services/configStore';
import { createUmServices } from '@/um/services/services';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

describe('what each permission is for', () => {
  it('describes exactly the sets the app can ask for, with the same permission names', () => {
    expect(PERMISSIONS.map((p) => p.set).sort()).toEqual(Object.keys(SCOPE_SETS).sort());
    for (const p of PERMISSIONS) {
      const asked = SCOPE_SETS[p.set].map((scope) => scope.split('/').pop());
      expect([...p.names].sort()).toEqual([...asked].sort());
    }
  });

  it('marks the ones an administrator has to grant, and the ones that change something', () => {
    expect(PERMISSIONS.filter((p) => p.needsAdmin).map((p) => p.set)).toEqual(['directory', 'fabricAdmin', 'memberChange', 'groupCreate']);
    expect(PERMISSIONS.filter((p) => p.writes).map((p) => p.set)).toEqual(['memberChange', 'fabricWrite', 'mail', 'groupCreate']);
  });

  it('tells not looked at, granted, missing, "needs an administrator" and "could not tell" apart', () => {
    expect(permissionState(permissionInfo('directory'), undefined)).toBe('checking');
    expect(permissionState(permissionInfo('directory'), true)).toBe('granted');
    expect(permissionState(permissionInfo('directory'), undefined, 'held')).toBe('granted');
    expect(permissionState(permissionInfo('directory'), false)).toBe('admin');
    expect(permissionState(permissionInfo('directory'), undefined, 'not-held')).toBe('admin');
    expect(permissionState(permissionInfo('fabric'), false)).toBe('missing');
    // A look that failed for another reason is not a missing permission.
    expect(permissionState(permissionInfo('fabric'), undefined, 'unknown')).toBe('unknown');
  });

  it('never looks at a permission that changes something', () => {
    expect([...PROBED_SETS].sort()).toEqual(['base', 'directory', 'fabric', 'fabricAdmin']);
    // Such a set shows what the tab learned from really asking, and nothing before that.
    expect(permissionState(permissionInfo('memberChange'), undefined)).toBe('onDemand');
    expect(permissionState(permissionInfo('memberChange'), true)).toBe('granted');
    expect(permissionState(permissionInfo('memberChange'), false)).toBe('admin');
  });

  it('tells a closed sign-in window from a refusal by Entra', () => {
    expect(grantFailureOf({ errorCode: 'user_cancelled' })).toBe('closed');
    expect(grantFailureOf({ errorCode: 'popup_window_error' })).toBe('closed');
    expect(grantFailureOf({ errorCode: 'access_denied' })).toBe('denied');
    expect(grantFailureOf(new Error('offline'))).toBe('other');
    expect(grantFailureOf(undefined)).toBe('other');
  });

  it('links to the app in Entra only when tenant and app are known', () => {
    const tenant = 'aaaaaaaa-1111-4111-8111-' + '111111111111';
    const client = 'BBBBBBBB-2222-4222-8222-' + '222222222222';
    expect(consentPageUrl(tenant, client)).toBe(
      `https://entra.microsoft.com/${tenant}/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/${client.toLowerCase()}`
    );
    expect(consentPageUrl(undefined, client)).toBeNull();
    expect(consentPageUrl(tenant, 'x"><script>')).toBeNull();
  });
});

describe('waiting for a stored setting at the start', () => {
  it('goes on without it when it does not arrive in time, and takes it when it does', async () => {
    vi.useFakeTimers();
    try {
      const never = soon(new Promise<string>(() => undefined), 5000);
      const fast = soon(Promise.resolve('full'), 5000);
      const broken = soon(Promise.reject(new Error('unreachable')), 5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await never).toBeUndefined();
      expect(await fast).toBe('full');
      expect(await broken).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

function renderAt(path: string, extra?: React.ReactNode) {
  const search = '?as=admin';
  const services = createUmServices({ mock: true, adminUserIds: [] }, search);
  render(
    <I18nProvider initialLocale="en">
      <AuthProvider authService={new OfflineAuthService(search)}>
        <MemoryRouter initialEntries={[path]}>
          <UmProvider services={services}>
            {extra}
            <Routes>
              <Route element={<UmLayout />}>{umRouteElements()}</Route>
            </Routes>
          </UmProvider>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>
  );
}

describe('permissions on the Setup page', () => {
  it('lists every permission with what it is for and its state', async () => {
    renderAt(UM_PATHS.setup);
    const heading = await screen.findByRole('heading', { name: 'Permissions' });
    const section = heading.closest('section')!;
    expect(within(section).getByText('Read groups, their owners and their members')).toBeInTheDocument();
    expect(within(section).getByText('GroupMember.Read.All, User.ReadBasic.All')).toBeInTheDocument();
    expect(within(section).getByText('Change which group holds which workspace role')).toBeInTheDocument();
    // The demo holds every read permission: nothing to allow there.
    expect(await within(section).findAllByText('Granted')).toHaveLength(PROBED_SETS.length);
    expect(within(section).queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    // The ones that change something are not looked at, and say so.
    expect(within(section).getAllByText('Asked for when a change starts')).toHaveLength(PERMISSIONS.length - PROBED_SETS.length);
    expect(within(section).getByText(/normally need an administrator/)).toBeInTheDocument();
  }, 20_000);

  it('says that an administrator has to approve when such a permission was refused', async () => {
    renderAt(UM_PATHS.setup, <GrantRefusedNote set="directory" />);
    expect(await screen.findByText(/GroupMember\.Read\.All, User\.ReadBasic\.All normally needs the approval of an administrator/)).toBeInTheDocument();
  }, 20_000);

  it('says something else for a permission a person can give themselves', async () => {
    renderAt(UM_PATHS.setup, <GrantRefusedNote set="fabric" />);
    expect(await screen.findByText(/Entra did not grant Workspace\.Read\.All, or the sign-in window was closed/)).toBeInTheDocument();
  }, 20_000);
});
