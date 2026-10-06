import { describe, expect, it } from 'vitest';
import { deriveTemplateData, inferStacks } from './gallery-metadata.mjs';

describe('gallery metadata transformation', () => {
  it('infers stacks from package dependencies', () => {
    expect(
      inferStacks({
        dependencies: { react: '^19.0.0', graphein: '^0.16.0' },
        devDependencies: { vite: '^7.0.0', tailwindcss: '^4.0.0' },
      }),
    ).toEqual(['React', 'Vite', 'Tailwind', 'Graphein']);
  });

  it('derives capabilities and scaffold command from source metadata', () => {
    const template = deriveTemplateData({
      directoryName: 'analytics-starter',
      entry: {
        path: 'templates/analytics-starter',
        name: 'Analytics Starter',
        description: 'A Power BI dashboard for operations.',
      },
      pkg: {
        template: {
          name: 'analytics-starter',
          displayName: 'Analytics Starter',
          description: 'A Power BI dashboard for operations.',
        },
        dependencies: {
          react: '^19.0.0',
          '@microsoft/rayfin-auth-provider-fabric': '^1.33.2',
        },
      },
      manifest: {
        templateId: 'analytics-starter',
        services: { auth: true, data: false, storage: false, staticHosting: true },
        hasDabSchema: false,
        tokens: ['__FABRIC_WORKSPACE_ID__'],
      },
    });

    expect(template.capabilities).toEqual([
      'Authentication',
      'Static hosting',
      'Microsoft Fabric',
      'Power BI',
    ]);
    expect(template.scaffoldCommand).toContain('--template-name "Analytics Starter"');
    expect(template.sourceUrl.endsWith('/templates/analytics-starter')).toBe(true);
  });

  it('rejects mismatched package and manifest identifiers', () => {
    expect(() =>
      deriveTemplateData({
        directoryName: 'demo',
        entry: { path: 'templates/demo', name: 'Demo', description: 'Demo template' },
        pkg: {
          template: { name: 'demo', displayName: 'Demo', description: 'Demo template' },
        },
        manifest: { templateId: 'other', services: {} },
      }),
    ).toThrow('templateId must be "demo"');
  });
});
