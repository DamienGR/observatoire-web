import type { RoutePolicy } from './cache.js';

/**
 * The cache policy of every route, in one place (CLAUDE.md §10: "Tout endpoint
 * est explicite sur sa politique de cache. Une réponse sans en-tête de cache
 * décidé est un oubli, pas un défaut acceptable.").
 *
 * A registry rather than a per-page declaration, for one reason: a page that
 * forgets to declare its policy is invisible, whereas a registry can be
 * compared against the pages on disk. tests/unit/route-cache-policy.test.ts
 * does exactly that, in both directions.
 *
 * Patterns are Astro route patterns — `[param]` for one segment, `[...rest]`
 * for the tail — written without a trailing slash, as `trailingSlash: 'never'`
 * in astro.config.mjs requires.
 */

/** Purge tag carried by every page of the shell: one purge repaints the lot. */
const SHELL_TAG = 'shell';

/**
 * Carried by every page whose content is read from the commune referential.
 * The ingestion job is what will purge it (milestone 4), which is why it is a
 * tag about the *data* and not about the page.
 */
const COMMUNE_DATA_TAG = 'data:communes';

export const ROUTE_POLICIES: Readonly<Record<string, RoutePolicy>> = {
  '/': { cache: 'editorial', tags: ['page:accueil', SHELL_TAG] },
  '/stats': { cache: 'donnees', tags: ['page:stats', COMMUNE_DATA_TAG, SHELL_TAG] },
  '/methodologie': { cache: 'editorial', tags: ['page:methodologie', SHELL_TAG] },
  '/mentions-legales': { cache: 'editorial', tags: ['page:mentions-legales', SHELL_TAG] },
  '/accessibilite': { cache: 'editorial', tags: ['page:accessibilite', SHELL_TAG] },
  '/droit-de-reponse': { cache: 'editorial', tags: ['page:droit-de-reponse', SHELL_TAG] },
  '/404': { cache: 'uncached', tags: [] },
};

/**
 * The addresses a deployment check can actually visit.
 *
 * Derived from the registry rather than listed, in both directions on purpose.
 * CLAUDE.md §5 wants "un parcours E2E par gabarit de page, pas un par commune"
 * — this is the layer that grows without anyone noticing — so a page added to
 * the registry is covered without anyone remembering a second file, and a
 * dynamic route, the one that would multiply the layer by the number of
 * communes, has no single address and cannot enter here at all.
 *
 * It lives beside the registry rather than in `tests/e2e/` because the warm-up
 * job of `src/jobs/warm-preview.ts` needs the same list, and `tsconfig.jobs.json`
 * compiles `src/` alone. Two copies of "every page of the shell" is exactly the
 * drift the registry exists to prevent.
 */
export const SHELL_ROUTES: readonly string[] = Object.keys(ROUTE_POLICIES).filter(
  (pattern) => !pattern.includes('['),
);

/**
 * The status a route answers with.
 *
 * Everything answers 200 except `/404`, which answers 404 at its own address —
 * measured, not assumed: Astro matches the not-found route and renders it with
 * the status it stands for. Asserting 200 everywhere would make the not-found
 * page the one page whose check proved nothing.
 */
export function expectedStatus(route: string): number {
  return route === '/404' ? 404 : 200;
}

/**
 * What answers a path no route declares: an error page, a redirect, an asset
 * the CDN did not intercept. None of it should outlive the request that caused
 * it, and inheriting whatever default the edge applies is how a 404 ends up
 * cached for an hour under someone else's URL.
 */
export const UNMATCHED_ROUTE_POLICY: RoutePolicy = { cache: 'uncached', tags: [] };

/** Extensions Astro turns into a route. `.ts`/`.js` are endpoints, not pages. */
const ROUTE_EXTENSIONS = ['.astro', '.md', '.mdx', '.ts', '.js'] as const;

/**
 * The route pattern a file under src/pages/ answers, or null when the file is
 * not a route at all.
 *
 * Kept in this module rather than in the test that uses it because it is the
 * rule that ties the registry to the filesystem: state it once, test it as a
 * table, and the enumeration test stays a comparison of two sets.
 */
export function routePatternFromPageFile(file: string): string | null {
  const segments = file.replace(/\\/g, '/').split('/');

  // A leading underscore excludes a file — and its whole directory — from
  // routing. It is how a page keeps its partials next to itself.
  if (segments.some((segment) => segment.startsWith('_'))) return null;

  const filename = segments.at(-1) ?? '';
  const extension = ROUTE_EXTENSIONS.find((candidate) => filename.endsWith(candidate));
  if (extension === undefined) return null;

  const name = filename.slice(0, -extension.length);
  if (name === '') return null;

  const parents = segments.slice(0, -1);
  const parts = name === 'index' ? parents : [...parents, name];

  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A route pattern as a matcher. Built on demand rather than cached: every route
 * declared today is static, so the exact lookup answers first and this is only
 * reached once dynamic routes exist — at which point the cost is a handful of
 * regular expressions per request, measurable if it ever matters.
 */
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith('[...') && segment.endsWith(']')) return '(?:/[^/]+)+';
      if (segment.startsWith('[') && segment.endsWith(']')) return '/[^/]+';
      return `/${escapeRegExp(segment)}`;
    })
    .join('');

  return new RegExp(`^${source === '' ? '/' : source}$`);
}

export interface RouteMatch {
  readonly pattern: string;
  readonly policy: RoutePolicy;
}

/**
 * The route a request path belongs to, or null when none declares it.
 *
 * Exact patterns win over dynamic ones: `/communes/mediane` is its own page
 * even once `/communes/[code_insee]` exists, and the alternative — first match
 * wins, in declaration order — makes the answer depend on the order of an
 * object literal.
 */
export function matchRoute(
  pathname: string,
  policies: Readonly<Record<string, RoutePolicy>> = ROUTE_POLICIES,
): RouteMatch | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  const exact = policies[normalized];
  if (exact !== undefined) return { pattern: normalized, policy: exact };

  for (const [pattern, policy] of Object.entries(policies)) {
    if (!pattern.includes('[')) continue;
    if (patternToRegExp(pattern).test(normalized)) return { pattern, policy };
  }

  return null;
}
