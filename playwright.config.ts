import { defineConfig, devices } from '@playwright/test';

/**
 * E2E and accessibility run against the Netlify deploy preview, never against a
 * locally served build: the point is to test what was actually deployed
 * (CLAUDE.md §5). Budget < 6 min, one journey per page template.
 */
const baseURL = process.env.BASE_URL;

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
