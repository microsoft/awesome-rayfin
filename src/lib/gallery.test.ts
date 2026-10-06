import { describe, expect, it } from 'vitest';
import type { GalleryTemplate } from '../types';
import { ALL_FILTER, filterTemplates, uniqueSorted } from './gallery';

const template = (overrides: Partial<GalleryTemplate>): GalleryTemplate => ({
  id: 'starter',
  displayName: 'Starter',
  description: 'A starter application',
  path: 'templates/starter',
  sourceUrl: 'https://example.test/starter',
  scaffoldCommand: 'rayfin init',
  stacks: ['React', 'Vite'],
  capabilities: ['Authentication'],
  services: { auth: true, data: false, storage: false, staticHosting: true },
  experimental: false,
  ...overrides,
});

const templates = [
  template({ id: 'react-app' }),
  template({
    id: 'angular-data',
    displayName: 'Angular Data',
    description: 'Manage field records',
    stacks: ['Angular', 'Material'],
    capabilities: ['Authentication', 'Data API'],
  }),
];

describe('gallery filters', () => {
  it('searches names, descriptions, stacks, and capabilities case-insensitively', () => {
    expect(
      filterTemplates(templates, {
        query: 'FIELD',
        capability: ALL_FILTER,
        stack: ALL_FILTER,
      }),
    ).toHaveLength(1);
  });

  it('combines capability and stack filters', () => {
    expect(
      filterTemplates(templates, {
        query: '',
        capability: 'Data API',
        stack: 'Angular',
      }).map(({ id }) => id),
    ).toEqual(['angular-data']);
  });

  it('returns an empty result when filters do not intersect', () => {
    expect(
      filterTemplates(templates, {
        query: '',
        capability: 'Data API',
        stack: 'React',
      }),
    ).toEqual([]);
  });

  it('deduplicates and sorts filter options', () => {
    expect(uniqueSorted([['Vite', 'React'], ['Angular', 'Vite']])).toEqual([
      'Angular',
      'React',
      'Vite',
    ]);
  });
});
