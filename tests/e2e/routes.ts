/**
 * The pages this suite visits, re-exported from the cache registry rather than
 * listed here.
 *
 * CLAUDE.md §5 wants "un parcours E2E par gabarit de page, pas un par commune"
 * — the E2E layer is the one that grows without anyone noticing. Deriving the
 * list from `ROUTE_POLICIES` keeps that bound honest in both directions: a new
 * shell page is covered without anyone remembering this file, and a page that
 * multiplies with data cannot appear here at all, because a dynamic route has
 * no single address to visit. The registry is itself compared to src/pages/ by
 * tests/unit/route-cache-policy.test.ts, so it cannot silently miss a page.
 *
 * The two moved into `src/lib/http/routes.ts` with issue #46: the warm-up job
 * of `src/jobs/warm-preview.ts` visits the same pages, and `tsconfig.jobs.json`
 * compiles `src/` alone. This file stays as the suite's own door onto them,
 * because every spec already knows it by this name.
 */

export { SHELL_ROUTES, expectedStatus } from '~/lib/http/routes.js';
