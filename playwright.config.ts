import { defineConfig, devices } from '@playwright/test';

/**
 * E2E and accessibility run against the Netlify deploy preview, never against a
 * locally served build: the point is to test what was actually deployed
 * (CLAUDE.md §5). Budget < 6 min, one journey per page template.
 *
 * That is not a preference. `astro dev` inlines the stylesheet in a `<style>`
 * tag, which `style-src 'self'` blocks — measured in session, the dev server
 * serves the site with no CSS at all. Every assertion that reads a rendered
 * style (the focus ring, the off-screen skip link, and every colour-contrast
 * check axe-core makes) is therefore meaningless anywhere but on the build.
 */
const baseURL = process.env.BASE_URL;

if (baseURL === undefined || baseURL === '') {
  // Failing here, before any browser starts, rather than letting each test
  // report "Invalid URL" on its own: a missing address is a wiring mistake, and
  // it should read like one.
  throw new Error(
    'BASE_URL is required — this suite has no server of its own.\n' +
      'In CI it is the deploy preview URL, resolved from the Netlify commit status ' +
      'by scripts/resolve-netlify-url.mjs (.github/workflows/ci.yml).',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  // Artefacts are the only way to "see" the product from a cloud session
  // (CLAUDE.md §1), so they are always produced.
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report', open: 'never' }], ['github']]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
