import { expect, test } from '@playwright/test';
import { gotoReady } from './preview.js';
import { SHELL_ROUTES, expectedStatus } from './routes.js';

/**
 * That the deployment answers at all, asserted where it says so.
 *
 * This file exists because of a title. On 18/8 the CI went red announcing
 * axe-core violations in the dark palette, on a diff that touched neither a
 * template nor a stylesheet; the detail said `Expected: 200, Received: 500`.
 * The suite had failed on the status assertion at the top of an accessibility
 * test — before axe-core ran at all — and a hurried reader concluded there was
 * a contrast regression (docs/journal.md 028, issue #46).
 *
 * So the status claim is given a test of its own, whose name is what it checks.
 * Everything else in the suite still navigates through `gotoReady`, which
 * refuses to measure a page that never arrived; what changes is that when the
 * deployment is the problem, the line a reader meets first says so.
 *
 * It is cheap in the terms §5 cares about: one navigation per shell page, on
 * routes `src/jobs/warm-preview.ts` woke before the suite started.
 */
test.describe('the deployment answers', () => {
  for (const route of SHELL_ROUTES) {
    test(`${route} answers HTTP ${String(expectedStatus(route))}`, async ({ page }) => {
      const response = await gotoReady(page, route);

      expect(response.status(), `unexpected status for ${route}`).toBe(expectedStatus(route));
    });
  }
});
