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

test('caches its data at the edge, under a tag a purge can target', async ({ page }) => {
  const response = await page.goto('/stats');
  const headers = response?.headers() ?? {};

  const degraded = (await page.getByRole('heading', { name: UNAVAILABLE }).count()) > 0;

  if (degraded) {
    // §10 by way of honesty: an answer that says "unreadable" must not be held
    // at the edge, or the outage outlives itself.
    expect(headers['netlify-cdn-cache-control']).toBe('no-store');
    return;
  }

  // A cached response with no tag can only be evicted by a global purge, which
  // §10 forbids — so the tag is what makes the whole policy admissible.
  expect(headers['netlify-cdn-cache-control']).toContain('s-maxage=');
  expect(headers['netlify-cache-tag']).toContain('data:communes');
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
