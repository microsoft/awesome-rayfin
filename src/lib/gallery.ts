import type { GalleryFilters, GalleryTemplate } from '../types';

export const ALL_FILTER = 'All';

export function filterTemplates(
  templates: GalleryTemplate[],
  { query, capability, stack }: GalleryFilters,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return templates.filter((template) => {
    const searchableText = [
      template.displayName,
      template.description,
      template.id,
      ...template.stacks,
      ...template.capabilities,
    ]
      .join(' ')
      .toLocaleLowerCase();

    const matchesQuery = !normalizedQuery || searchableText.includes(normalizedQuery);
    const matchesCapability =
      capability === ALL_FILTER || template.capabilities.includes(capability);
    const matchesStack = stack === ALL_FILTER || template.stacks.includes(stack);

    return matchesQuery && matchesCapability && matchesStack;
  });
}

export function uniqueSorted(values: string[][]) {
  return [...new Set(values.flat())].sort((left, right) => left.localeCompare(right));
}
