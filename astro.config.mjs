// @ts-check
import netlify from '@astrojs/netlify';
import sentry from '@sentry/astro';
import { defineConfig } from 'astro/config';

/**
 * SSR on Netlify (CLAUDE.md §2). Pages are rendered on demand and cached at the
 * edge by header (§10) — a data refresh must never require a redeploy.
 */

/**
 * The canonical origin, when one is configured. Left undefined otherwise, and
 * that is the point: the previous fallback named `https://observatoire-web.fr`,
 * a domain with no DNS record, so every canonical URL of the site pointed at
 * nothing. A missing canonical says "I don't know"; a wrong one asserts an
 * address that does not answer.
 */
const site = process.env.SITE_URL;

/**
 * Sentry is enabled per side, by the presence of the DSN that side uses. A
 * build with no DSN therefore ships no Sentry code at all — which is what makes
 * `pnpm verify`, run without any secret, build the site the CI actually tests
 * rather than a stripped-down variant with a dead SDK inside.
 */
const clientDsn = process.env.PUBLIC_SENTRY_DSN;
const serverDsn = process.env.SENTRY_DSN;

export default defineConfig({
  ...(site === undefined ? {} : { site }),
  output: 'server',
  adapter: netlify(),
  trailingSlash: 'never',

  /**
   * `true`, not the Astro 7 default of `'jsx'`.
   *
   * Under `'jsx'`, a line break between an inline element and the text next to
   * it is removed rather than collapsed to a space — the JSX rule. Prettier
   * formats `.astro` files with HTML whitespace semantics, where that same
   * break *is* a space, and it reflows lines freely at `printWidth: 100`. The
   * two disagree, and the disagreement shows up as `méthodologiepour` in a
   * rendered sentence, produced by a formatting pass nobody reviewed.
   * `true` keeps Astro's lossless compression, which agrees with Prettier.
   */
  compressHTML: true,

  build: {
    format: 'directory',
    /**
     * §7 forbids `unsafe-inline`, and the default (`'auto'`) inlines any
     * stylesheet under 4 kB into a `<style>` tag — which the policy then
     * blocks. The failure would only appear in a browser, never in a build log.
     */
    inlineStylesheets: 'never',
  },

  integrations: [
    sentry({
      enabled: { client: clientDsn !== undefined, server: serverDsn !== undefined },
      // Source maps are uploaded only when a token is present. The build runs
      // on Netlify, so that token has to live there — see docs/roadmap.md.
      sourcemaps: { disable: process.env.SENTRY_AUTH_TOKEN === undefined },
      telemetry: false,
    }),
  ],

  vite: {
    resolve: {
      alias: {
        '~': new URL('./src/', import.meta.url).pathname,
      },
    },
  },
});
