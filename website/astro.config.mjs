import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://esaditya1729.github.io',
  base: '/VizFlow',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
