import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { UM_PATHS } from '@/um/domain/profile';
import { UmProvider } from '@/um/hooks/UmContext';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices, type UmServices } from '@/um/services/services';
import { umRouteElements } from '@/um/UmRoutes';

// The Excel worker cannot run in jsdom; the codec itself is tested in umServices.test.ts.
vi.mock('@/um/services/excelClient', () => ({
  readSheet: vi.fn(),
  writeSheet: vi.fn(async () => new Blob()),
  downloadBlob: vi.fn(),
}));

type Persona = 'admin' | 'owner' | 'user';

function renderApp(persona: Persona, path: string = UM_PATHS.workspaces, locale: 'en' | 'de' = 'en', change: (services: UmServices) => UmServices = (services) => services) {
  const search = `?as=${persona}`;
  const services = change(createUmServices({ mock: true, adminUserIds: [] }, search));
  return render(
    <I18nProvider initialLocale={locale}>
      <AuthProvider authService={new OfflineAuthService(search)}>
        <MemoryRouter initialEntries={[path]}>
          <UmProvider services={services}>
            <Routes>
              <Route element={<UmLayout />}>{umRouteElements()}</Route>
              <Route path="*" element={<Navigate to={UM_PATHS.workspaces} replace />} />
            </Routes>
          </UmProvider>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>
  );
}

/**
 * Plan phases 1 to 4: three tabs, read views per relation, discovery and
 * activation for app admins. All against the offline fixtures.
 */
describe('Fabric User Manager shell', () => {
  it('asks for a reload when the page is older than the deployed version and cannot load its parts', async () => {
    // What a page opened before a deployment runs into: the files it asks for are gone.
    renderApp('owner', UM_PATHS.workspaces, 'en', (services) => ({ ...services, loadWriter: () => Promise.reject(new Error('Failed to fetch dynamically imported module')) }));
    const notice = await screen.findByText('The app was updated and this page could not load its new parts. Please reload the page.');
    expect(notice.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });

  it('does not ask for a reload when everything loaded', async () => {
    renderApp('owner');
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    expect(screen.queryByRole('button', { name: 'Reload the page' })).not.toBeInTheDocument();
  });

  it('has exactly four tabs in the navigation: three about access, and the guidelines', async () => {
    renderApp('user');
    const nav = await screen.findByRole('navigation', { name: 'Fabric User Manager' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Workspaces', 'Audiences', 'RLS / OLS', 'Power BI Guidelines']);
    // No Hub area and, for a non-admin, no Setup entry.
    expect(screen.queryByText('Can-Do Explorer')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Setup' })).not.toBeInTheDocument();
  });

  it('shows an owner their groups and lets them read the members', async () => {
    renderApp('owner');
    const heading = await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    expect(screen.getByText('You are an owner')).toBeInTheDocument();
    // Both workspaces the group opens are shown, so the owner sees its full reach.
    expect(screen.getByText(/Sales Reporting \/ Viewer/)).toBeInTheDocument();
    expect(screen.getByText(/Finance Reporting \/ Viewer/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show members' }));
    await waitFor(() => expect(screen.getByText('Anna Analyst')).toBeInTheDocument());
    expect(screen.getByText('2 users, 1 guests, 0 nested groups, 0 other')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(heading).toBeInTheDocument();
    // An owner is not an app admin: no discovery, no activation.
    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
  });

  it('shows a plain user only requestable groups, without member lists', async () => {
    renderApp('user');
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    expect(screen.getByText('You are not a member')).toBeInTheDocument();
    expect(screen.getByText('You do not manage an activated group on this tab.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show members' })).not.toBeInTheDocument();
  });

  it('marks recorded access as not verified on the Audiences and RLS / OLS tabs', async () => {
    renderApp('owner', UM_PATHS.audiences);
    await screen.findByRole('heading', { name: 'APP-Sales-Management' });
    expect(screen.getByText(/recorded, not verified/)).toBeInTheDocument();
  });

  it('gives an app admin discovery with honest gaps, and activation of an eligible group', async () => {
    renderApp('admin');
    await screen.findByText('Discovered');
    await waitFor(() => expect(screen.getByText(/roles readable in 2 of 3 workspaces/)).toBeInTheDocument());
    // The unreadable workspace is listed as such, not as empty.
    expect(screen.getByText(/Roles not readable: no permission/)).toBeInTheDocument();
    expect(screen.getAllByText('Direct, not through a group').length).toBeGreaterThan(0);
    expect(screen.getByText(/Cannot be activated: mail-enabled/)).toBeInTheDocument();

    // FAB-Sales-Contributor is eligible and not yet activated.
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('FAB-Sales-Contributor'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'Activate' }));
    expect(screen.getByText(/Owners in Entra: olivia.owner@contoso.example/)).toBeInTheDocument();
    const form = screen.getByText('Activate FAB-Sales-Contributor').parentElement!;
    await userEvent.click(within(form).getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'FAB-Sales-Contributor' })).toBeInTheDocument());
  });

  it('never offers a Member or Admin group for requests', async () => {
    renderApp('admin');
    await screen.findByText('Discovered');
    const row = await waitFor(() => screen.getAllByRole('row').find((r) => within(r).queryByText('FAB-Sales-Admin'))!);
    await userEvent.click(within(row).getByRole('button', { name: 'Activate' }));
    const form = screen.getByText('Activate FAB-Sales-Admin').parentElement!;
    expect(within(form).getByRole('checkbox', { name: 'Open for requests' })).toBeDisabled();
  });

  it('keeps Setup for app admins and shows findings there', async () => {
    renderApp('owner', UM_PATHS.setup);
    expect(await screen.findByText('Setup is for app admins.')).toBeInTheDocument();

    renderApp('admin', UM_PATHS.setup);
    await waitFor(() => expect(screen.getByText(/FAB-Finance-Member carries Member in Finance Reporting and is owned by/)).toBeInTheDocument());
    // Member changes exist in the demo build and are switched off until an admin switches them on.
    expect(screen.getAllByText('Switched off').length).toBeGreaterThan(0);
  });

  it('lets an app admin activate a group by its ID and records its purpose as not verified', async () => {
    renderApp('admin', UM_PATHS.setup);
    const input = await screen.findByLabelText('Group object ID');
    await userEvent.type(input, 'not-an-id');
    const section = input.closest('section')!;
    await userEvent.click(within(section).getByRole('button', { name: 'Look up' }));
    expect(within(section).getByText('This is not a valid object ID.')).toBeInTheDocument();

    await userEvent.clear(input);
    // FAB-Finance-Member from the fixtures: eligible, not yet activated.
    await userEvent.type(input, '33333333-0000-4000-8000-' + '000000000004');
    await userEvent.click(within(section).getByRole('button', { name: 'Look up' }));
    await within(section).findByText('FAB-Finance-Member');
    await userEvent.type(within(section).getByLabelText('Workspace, Org App or semantic model name'), 'Finance Reporting');
    // A role below Member needs the explicit confirmation.
    await userEvent.click(within(section).getByRole('button', { name: 'Activate' }));
    expect(within(section).getByText('Please confirm that the group holds no Member or Admin role.')).toBeInTheDocument();
    await userEvent.selectOptions(within(section).getByLabelText('Workspace role'), 'Member');
    // A stated Member role closes the group for requests, exactly like a read one.
    expect(within(section).getByRole('checkbox', { name: 'Open for requests' })).toBeDisabled();
    await userEvent.click(within(section).getByRole('button', { name: 'Activate' }));
    await within(section).findByText('FAB-Finance-Member is activated.');
    await screen.findByRole('heading', { name: 'FAB-Finance-Member' });
    expect(screen.getByText(/Workspace: Finance Reporting \/ Member · recorded, not verified/)).toBeInTheDocument();
  });

  it('looks a person up only across groups the viewer manages', async () => {
    renderApp('owner', `${UM_PATHS.person}?q=anna.analyst@contoso.example`);
    await waitFor(() => expect(screen.getByText('Anna Analyst')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1);
    // The owner manages three activated groups; the Admin and Member groups never appear.
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['APP-Sales-Management', 'FAB-Sales-Viewer', 'RLS-Sales-DACH']);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['Not a direct member', 'Direct member', 'Direct member']);
  });

  it('renders in German without falling back to English', async () => {
    renderApp('owner', UM_PATHS.workspaces, 'de');
    expect(await screen.findByText('Gruppen, die Sie verwalten')).toBeInTheDocument();
    expect(screen.getByText('Sie sind Besitzer')).toBeInTheDocument();
    expect(screen.getByText(/Demodaten/)).toBeInTheDocument();
  });
});
