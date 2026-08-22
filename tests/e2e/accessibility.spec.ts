import AxeBuilder from '@axe-core/playwright';
import { expect, test, type TestInfo } from '@playwright/test';
import { gotoReady } from './preview.js';
import { SHELL_ROUTES } from './routes.js';

/**
 * axe-core on every page of the shell, in both colour schemes.
 *
 * CLAUDE.md §5 lists accessibility among the priorities — "axe-core sur un
 * exemplaire de chaque gabarit" — and §4 makes it non-negotiable for a site
 * that measures other people's. This suite is what turns that from something
 * measured once in a session into something CI refuses to merge without.
 *
 * Both schemes, because half the palette only exists under
 * `prefers-color-scheme: dark` (src/styles/global.css) and contrast is the rule
 * that breaks when a colour is changed for the theme nobody was looking at.
 *
 * No rule is disabled and no tag filter is applied: the default set includes
 * axe's best-practice rules, the pages pass them today, and starting from the
 * stricter side means a relaxation has to be argued for in a pull request
 * instead of being the state we happened to start in.
 */

interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null | undefined;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly unknown[] }[];
}

/**
 * Violations as lines a reader can act on.
 *
 * `expect(violations).toEqual([])` on the raw axe output prints a page of JSON
 * per finding, which is how a real failure becomes something people scroll
 * past. The full report is attached to the test instead, so the artefact keeps
 * the detail (§1: artefacts are the only way to see anything from here).
 */
function summarise(violations: readonly AxeViolation[]): string[] {
  return violations.map(
    (violation) =>
      `${violation.id} [${violation.impact ?? 'impact inconnu'}] ${violation.help} — ` +
      `${String(violation.nodes.length)} nœud(s): ` +
      violation.nodes.map((node) => node.target.join(' ')).join(' | '),
  );
}

async function attachReport(testInfo: TestInfo, results: unknown): Promise<void> {
  await testInfo.attach('axe-results.json', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`palette ${colorScheme}`, () => {
    test.use({ colorScheme });

    for (const route of SHELL_ROUTES) {
      test(`${route} raises no axe-core violation`, async ({ page }, testInfo) => {
        // A page that never arrived produces zero violations, and zero
        // violations on nothing is the reassuring green §5 calls the worst
        // possible CI failure. `gotoReady` refuses to return such a page — and,
        // just as importantly, it fails saying the preview did not answer
        // rather than leaving this test's name to describe the failure
        // (issue #46). The status claim itself lives in availability.spec.ts.
        await gotoReady(page, route);

        const results = await new AxeBuilder({ page }).analyze();

        if (results.violations.length > 0) await attachReport(testInfo, results);

        expect(summarise(results.violations)).toEqual([]);
      });
    }
  });
}
