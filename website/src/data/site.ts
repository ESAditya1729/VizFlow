export const SITE = {
  name: 'VizFlow Studio',
  tagline: 'Compare, query, profile and automate CSV data — right inside VS Code.',
  description:
    'VizFlow Studio is a VS Code extension for comparing CSV files, running RBQL queries, profiling data quality, and building visual data workflows. Everything runs locally.',
  extensionId: 'adoenixes-vizflow.vizflow-studio',
  installCommand: 'ext install adoenixes-vizflow.vizflow-studio',
  marketplaceUrl:
    'https://marketplace.visualstudio.com/items?itemName=adoenixes-vizflow.vizflow-studio',
  repoUrl: 'https://github.com/ESAditya1729/VizFlow',
  issuesUrl: 'https://github.com/ESAditya1729/VizFlow/issues',
  discussionsUrl: 'https://github.com/ESAditya1729/VizFlow/discussions',
  reviewsUrl:
    'https://marketplace.visualstudio.com/items?itemName=adoenixes-vizflow.vizflow-studio&ssr=false#review-details',
};

/** Build a URL that respects the Astro `base` (e.g. /VizFlow). */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export const NAV = [
  { label: 'Features', href: 'features/' },
];
