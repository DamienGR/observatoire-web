import { expect, test } from '@playwright/test';
import { SHELL_ROUTES, expectedStatus } from './routes.js';

/**
 * The page template, as served.
 *
 * These are the guarantees CLAUDE.md §4 calls non-negotiable and that axe-core
 * does not decide for us: a single `<h1>` per page (axe only requires at least
 * one), a heading hierarchy with no skipped level, a working skip link, and a
 * focus ring that is actually drawn. All of it lives in one template
 * (src/layouts/BaseLayout.astro), so a regression here breaks every page at
 * once — which is exactly why it is worth asserting on the deployed site rather
 * than trusting the component.
 */

/**
 * Netlify injects a deploy-preview banner into every preview it builds: a
 * `<div data-netlify-deploy-id … style="position:fixed">` and an iframe of
 * app.netlify.com. Our own CSP blocks both, and says so on the console.
 *
 * That is the CSP doing its job, on markup nobody here wrote and that
 * production never receives. Failing on it would make this suite red forever
 * for a reason foreign to every diff — the one failure mode CLAUDE.md §5 calls
 * the worst available.
 *
 * The second pattern is broad enough to hide an inline style of our own, which
 * is why the test below asserts separately that the document declares none
 * outside that injected banner. An exclusion is only safe when something else
 * checks what it excludes.
 */
const PREVIEW_BANNER_NOISE = [
  /Framing 'https:\/\/app\.netlify\.com/,
  /Applying inline style violates/,
];

/** The 404 page answers 404, and Chromium logs its own navigation failure. */
const OWN_STATUS_NOISE = 'Failed to load resource: the server responded with a status of 404';

/**
 * A site that ships no JavaScript should have nothing to say on the console.
 *
 * This exists because the first Lighthouse budget scored best-practices 0.92 on
 * every page, with `errors-in-console` among the audits paying for it — on
 * pages that run no script at all. The supposed cause was an undeclared
 * favicon; the test was written to settle that rather than to confirm it, and
 * it did: the favicon was one cause and the rest was Netlify's banner
 * (docs/journal.md 026).
 *
 * It keeps its value now that the question is answered. Milestone 4 brings the
 * first interactive island, and this is what will notice the day it throws.
 */
test.describe('the console stays quiet', () => {
  for (const route of SHELL_ROUTES) {
    test(`${route} logs no browser error of its own`, async ({ page }) => {
      const errors: string[] = [];
      const ignored = (text: string): boolean =>
        PREVIEW_BANNER_NOISE.some((pattern) => pattern.test(text)) ||
        (route === '/404' && text.includes(OWN_STATUS_NOISE));

      page.on('console', (message) => {
        if (message.type() === 'error' && !ignored(message.text())) {
          errors.push(`console: ${message.text()}`);
        }
      });
      // An exception that escaped to the window. Impossible today with no
      // script on the page, which is exactly why it is worth pinning.
      page.on('pageerror', (error) => {
        errors.push(`pageerror: ${error.message}`);
      });

      await page.goto(route);
      await page.waitForLoadState('networkidle');

      expect(errors, `${route} logged ${String(errors.length)} error(s)`).toEqual([]);
    });

    test(`${route} declares no inline style of its own`, async ({ page }) => {
      // What makes the exclusion above honest. §7 bans `unsafe-inline`, so an
      // inline style we shipped would be silently dropped by the browser: the
      // page would render differently from the template and nothing would say
      // so — the console message being the only trace, and now filtered.
      await page.goto(route);

      const ours = await page.locator('[style]:not([data-netlify-deploy-id])').all();

      expect(ours, `${route} carries an inline style the CSP will drop`).toHaveLength(0);
    });
  }
});

test.describe('every page of the shell', () => {
  for (const route of SHELL_ROUTES) {
    test(`${route} is one document with an unbroken heading hierarchy`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response, `no response for ${route}`).not.toBeNull();
      expect(response?.status(), `unexpected status for ${route}`).toBe(expectedStatus(route));

      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page).toHaveTitle(/\S+ — observatoire-web\.fr$/);

      // §4: "un seul `<h1>` par page". axe's page-has-heading-one only asks for
      // at least one, and is as happy with five, so the count is asserted here.
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      // §4: "hiérarchie de titres sans saut". Read from the rendered document,
      // in document order, because that is the order a screen reader announces.
      const levels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));

      expect(levels.length, `${route} renders no heading at all`).toBeGreaterThan(0);
      expect(levels[0], `${route} does not start at level 1`).toBe(1);

      const skips = levels
        .map((level, index) => ({ level, previous: levels[index - 1] ?? level }))
        .filter((step) => step.level > step.previous + 1)
        .map((step) => `h${String(step.previous)} → h${String(step.level)}`);

      expect(skips, `${route} skips a heading level`).toEqual([]);

      // The landmark structure the template promises. Named roles rather than
      // tag names: what matters is what assistive technology is handed.
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
    });
  }

  // A title is the first thing a screen reader announces and the only label a
  // tab or a bookmark carries. Two pages sharing one is a template that forgot
  // to be given a title, and it looks perfectly fine on any single page.
  test('gives each page a title of its own', async ({ page }) => {
    const routeByTitle = new Map<string, string>();

    for (const route of SHELL_ROUTES) {
      await page.goto(route);
      const title = await page.title();
      const owner = routeByTitle.get(title);

      expect(owner, `${route} and ${owner ?? ''} share the title "${title}"`).toBeUndefined();
      routeByTitle.set(title, route);
    }
  });
});

test.describe('keyboard', () => {
  /**
   * The skip link is the one control on the site that only exists for keyboard
   * users, so it is also the one nobody notices breaking. Its whole point is
   * the last assertion: that the Tab *after* it lands inside the content rather
   * than back in the navigation the visitor just asked to leave — which is what
   * `tabindex="-1"` on `<main>` buys, and what silently stops working if that
   * attribute is dropped.
   */
  test('the skip link is the first stop and moves focus into the content', async ({ page }) => {
    await page.goto('/');

    const skipLink = page.getByRole('link', { name: 'Aller au contenu principal' });

    // Off-screen until focused, rather than removed from the accessibility
    // tree: `display: none` would make it unreachable by the only people it is
    // there for.
    await expect(skipLink).toBeAttached();
    await expect(skipLink).not.toBeInViewport();

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    // §4: "focus visible". Read off the element as rendered — a stylesheet that
    // drops the outline passes every other check on this page.
    const outline = await skipLink.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style, 'the focused skip link draws no outline').not.toBe('none');
    expect(outline.width, 'the focus outline has no width').toBeGreaterThan(0);

    await page.keyboard.press('Enter');
    await expect(page.locator('main#contenu')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('main#contenu :focus')).toHaveCount(1);
  });

  test('marks the current page in the main navigation', async ({ page }) => {
    await page.goto('/methodologie');

    const navigation = page.getByRole('navigation', { name: 'Navigation principale' });

    await expect(navigation.getByRole('link', { name: 'Méthodologie' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(navigation.getByRole('link', { name: 'Droit de réponse' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test('an unknown address answers 404 with the not-found page', async ({ page }) => {
  const response = await page.goto('/cette-adresse-nexiste-pas-e2e');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page introuvable');
  await expect(page.getByRole('main').getByRole('link', { name: 'Accueil' })).toBeVisible();
});
