import { expect, test } from '@playwright/test';

/**
 * The one page of the site whose content comes from the database (J1-15).
 *
 * It has **two legal states** and this suite asserts both are legal, because
 * the environment decides which one the deployment under test renders: a
 * preview built without a database connection shows the "figures unreadable"
 * notice, one with a database shows the figures. Requiring the figures would
 * turn a missing environment variable into a red build on a diff that has
 * nothing to do with it — the CI everyone learns to ignore (CLAUDE.md §5).
 *
 * What is asserted unconditionally is everything the page owes whatever it can
 * read: it answers 200, it names itself, and it declares the cache policy its
 * state calls for. That last one is only observable here — a header the
 * platform strips still passes every unit test in src/lib/http/.
 *
 * Accessibility is covered without this file: `/stats` is in the cache registry,
 * so accessibility.spec.ts and shell.spec.ts pick it up on their own.
 */

const FIGURES = 'Périmètre ingéré';
const UNAVAILABLE = 'Les chiffres ne sont pas lisibles pour le moment';

/**
 * Whether the edge kept the response, read from `Cache-Status` (RFC 9211).
 *
 * Not from `Netlify-CDN-Cache-Control`, and that is the whole lesson of this
 * helper: Netlify **consumes** that header along with `Netlify-Cache-Tag` —
 * they are instructions to the CDN, and the CDN does not pass them on. A first
 * version of this suite asserted them and went red against a deployment whose
 * caching was perfectly correct (docs/journal.md 019). The dev server, which is
 * not the platform, forwards them untouched, so nothing in a session could have
 * shown it.
 *
 * What is left is better than what was lost: `Cache-Status` reports what the
 * edge *did* — `stored` on a miss it kept, `hit` when it served from store —
 * rather than what we asked it to do. The declaration side (the policy and its
 * purge tags) is asserted where it is visible, in src/lib/http/response.test.ts.
 */
function edgeKeptTheResponse(headers: Record<string, string>): boolean {
  return /stored|hit/.test(headers['cache-status'] ?? '');
}

test('answers 200 and shows either its figures or why it cannot', async ({ page }) => {
  const response = await page.goto('/stats');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('État des données');

  const figures = page.getByRole('heading', { name: FIGURES });
  const unavailable = page.getByRole('heading', { name: UNAVAILABLE });

  // Exactly one of the two, never both and never neither: a page showing the
  // notice *and* a table of zeros would present an outage as a measurement.
  expect(
    (await figures.count()) + (await unavailable.count()),
    'the page shows neither its figures nor a reason for their absence',
  ).toBe(1);
});

test('is held at the edge only when it has data to hold', async ({ page }) => {
  const response = await page.goto('/stats');
  const headers = response?.headers() ?? {};

  const degraded = (await page.getByRole('heading', { name: UNAVAILABLE }).count()) > 0;

  if (degraded) {
    // §10 by way of honesty: an answer that says "unreadable" must not be kept
    // at the edge, or the outage outlives itself. This is the one assertion of
    // the suite that proves the downgrade of src/lib/http/cache.ts reaches the
    // platform at all — the browser directive alone would not.
    expect(headers['cache-control']).toContain('no-store');
    expect(
      edgeKeptTheResponse(headers),
      `the edge stored a degraded answer: ${headers['cache-status'] ?? 'no Cache-Status'}`,
    ).toBe(false);
    return;
  }

  // The browser revalidates, the edge holds: that asymmetry is what makes a
  // purge take effect at once (§10).
  expect(headers['cache-control']).toContain('must-revalidate');
  expect(
    edgeKeptTheResponse(headers),
    `the edge kept nothing: ${headers['cache-status'] ?? 'no Cache-Status'}`,
  ).toBe(true);
});

test('presents the resolution states as a data table, captioned and scoped', async ({ page }) => {
  await page.goto('/stats');

  const table = page.getByRole('table');
  test.skip((await table.count()) === 0, 'no figures on this deployment');

  // §4: "Tableaux de données avec `<caption>`, `<th scope>`". axe-core does not
  // require a caption, so nothing else in the suite would notice its loss.
  await expect(table.locator('caption')).toHaveCount(1);
  await expect(table.locator('thead th[scope="col"]')).toHaveCount(3);

  // One row per resolution state of the schema, including the empty ones: a
  // state that no URL currently holds still has to be shown, or "0 à revoir"
  // and "we do not track that" look the same to a reader.
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(4);
  await expect(table.getByRole('rowheader', { name: 'À revoir' })).toBeVisible();
});
