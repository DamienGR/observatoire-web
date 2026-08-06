import { ROUTE_POLICIES } from '~/lib/http/routes.js';

/**
 * The pages this suite visits, read from the cache registry rather than listed
 * here.
 *
 * CLAUDE.md §5 wants "un parcours E2E par gabarit de page, pas un par commune"
 * — the E2E layer is the one that grows without anyone noticing. Deriving the
 * list from `ROUTE_POLICIES` keeps that bound honest in both directions: a new
 * shell page is covered without anyone remembering this file, and a page that
 * multiplies with data cannot appear here at all, because a dynamic route has
 * no single address to visit. The registry is itself compared to src/pages/ by
 * tests/unit/route-cache-policy.test.ts, so it cannot silently miss a page.
 */
export const SHELL_ROUTES: readonly string[] = Object.keys(ROUTE_POLICIES).filter(
  (pattern) => !pattern.includes('['),
);

/**
 * The status a route answers with.
 *
 * Everything answers 200 except `/404`, which answers 404 at its own address —
 * measured, not assumed: Astro matches the not-found route and renders it with
 * the status it stands for. Asserting 200 everywhere would have made the
 * not-found page the one page whose test proved nothing.
 */
export function expectedStatus(route: string): number {
  return route === '/404' ? 404 : 200;
}
