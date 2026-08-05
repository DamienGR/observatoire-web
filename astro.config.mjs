// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

/**
 * SSR on Netlify (CLAUDE.md §2). Pages are rendered on demand and cached at the
 * edge by header (§10) — a data refresh must never require a redeploy.
 */
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://observatoire-web.fr',
  output: 'server',
  adapter: netlify(),
  trailingSlash: 'never',
  build: {
    format: 'directory',
  },
  vite: {
    resolve: {
      alias: {
        '~': new URL('./src/', import.meta.url).pathname,
      },
    },
  },
});
