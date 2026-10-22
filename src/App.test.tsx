import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState(null, '', window.location.pathname);
  delete document.documentElement.dataset.theme;
});

describe('gallery application', () => {
  it('filters cards and exposes a useful empty state', () => {
    const { container } = render(<App />);

    const total = screen.getByText(/\d+ of \d+ templates/);
    expect(total).toHaveTextContent('10 of 10 templates');
    expect(container.querySelector('.card-visual')).not.toBeInTheDocument();
    expect(container.querySelector('img[src*="generated/previews"]')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search templates' }), {
      target: { value: 'no-such-template' },
    });

    expect(screen.getByRole('heading', { name: 'No templates match yet' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset all filters' })).toBeEnabled();
  });

  it('filters by a generated Rayfin capability', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Power BI' }));

    expect(screen.getByText('1 of 10 templates')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Power BI Fixer' })).toBeVisible();
  });

  it('switches themes and persists the preference', () => {
    window.localStorage.setItem('awesome-rayfin-theme', 'dark');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('awesome-rayfin-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  });

  it('routes proposal and submission actions to the correct GitHub destinations', () => {
    render(<App />);

    expect(
      screen.queryByRole('heading', { name: 'Built something great with Rayfin?' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Propose a template' })).toHaveAttribute(
      'href',
      'https://github.com/microsoft/awesome-rayfin/issues/new?template=new-template-proposal.yml&labels=template',
    );
    expect(screen.getByRole('link', { name: 'Submit your template' })).toHaveAttribute(
      'href',
      'https://github.com/mksuni/awesome-rayfin/blob/main/CONTRIBUTING.md',
    );
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'href',
      'https://learn.microsoft.com/en-us/fabric/apps/author-templates',
    );
  });

  it('shows architecture and cross-platform Fabric deployment guidance for templates', async () => {
    render(<App />);

    const detailButtons = screen.getAllByRole('button', { name: 'View details' });
    expect(detailButtons).toHaveLength(10);
    fireEvent.click(detailButtons[0]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Angular Blank App', level: 1 })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /build enterprise apps/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Architecture' })).toBeVisible();
    expect(screen.getByRole('img', { name: /architecture:/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /start a free trial/i })).toHaveAttribute(
      'href',
      'https://learn.microsoft.com/fabric/fundamentals/fabric-trial',
    );

    const bashScript = screen.getByLabelText('bash deployment script');
    expect(bashScript).toHaveTextContent('FABRIC_CAPACITY_ID');
    expect(bashScript).toHaveTextContent('fab api workspaces -X post');
    expect(bashScript).toHaveTextContent('rayfin up --workspace-id');

    fireEvent.click(screen.getByRole('tab', { name: 'PowerShell' }));
    expect(screen.getByLabelText('powershell deployment script')).toHaveTextContent(
      '$FabricWorkspaceId',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to gallery' }));
    expect(await screen.findAllByRole('button', { name: 'View details' })).toHaveLength(10);
    expect(
      screen.queryByRole('heading', { name: 'Angular Blank App', level: 1 }),
    ).not.toBeInTheDocument();
  });
});
