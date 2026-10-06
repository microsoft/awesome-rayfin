const REPOSITORY_URL = 'https://github.com/mksuni/awesome-rayfin';

const serviceLabels = {
  auth: 'Authentication',
  data: 'Data API',
  storage: 'Storage',
  staticHosting: 'Static hosting',
};

export function inferStacks(pkg) {
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const stacks = [];

  if (dependencies['@angular/core']) stacks.push('Angular');
  else if (dependencies.react) stacks.push('React');
  else stacks.push('TypeScript');

  if (dependencies['@angular/material']) stacks.push('Material');
  if (dependencies.vite || dependencies['@vitejs/plugin-react-swc']) stacks.push('Vite');
  if (dependencies.tailwindcss || dependencies['@tailwindcss/vite']) stacks.push('Tailwind');
  if (dependencies.graphein) stacks.push('Graphein');

  return stacks;
}

export function deriveTemplateData({
  directoryName,
  entry,
  pkg,
  manifest,
  hasFabricAssets = false,
}) {
  const id = pkg.template?.name;
  if (!id || !pkg.template?.displayName || !pkg.template?.description) {
    throw new Error(`templates/${directoryName}/package.json has incomplete template metadata`);
  }
  if (manifest.templateId !== id) {
    throw new Error(`templates/${directoryName}/manifest.json templateId must be "${id}"`);
  }

  const enabledServices = Object.entries(manifest.services ?? {})
    .filter(([, enabled]) => enabled)
    .map(([service]) => service);
  const capabilities = enabledServices.map((service) => serviceLabels[service] ?? service);
  const allDependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const tokens = Array.isArray(manifest.tokens) ? manifest.tokens : [];
  const usesFabric =
    hasFabricAssets ||
    Boolean(allDependencies['@microsoft/rayfin-auth-provider-fabric']) ||
    tokens.some((token) => token.includes('FABRIC'));

  if (usesFabric) capabilities.push('Microsoft Fabric');
  if (manifest.hasDabSchema) capabilities.push('DAB schema');
  if (/power bi/i.test(entry.description)) capabilities.push('Power BI');

  return {
    id,
    displayName: entry.name,
    description: entry.description,
    path: entry.path,
    sourceUrl: `${REPOSITORY_URL}/tree/main/${entry.path}`,
    scaffoldCommand:
      `rayfin init my-app -t ${REPOSITORY_URL} --template-name "${entry.name}"`,
    stacks: inferStacks(pkg),
    capabilities: [...new Set(capabilities)],
    services: Object.fromEntries(
      Object.keys(serviceLabels).map((service) => [
        service,
        Boolean(manifest.services?.[service]),
      ]),
    ),
    experimental: /^\[experimental\]/i.test(entry.name),
  };
}
