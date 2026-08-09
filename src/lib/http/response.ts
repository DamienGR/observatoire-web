import { cacheHeaders, type CacheDowngrade } from './cache.js';
import { matchRoute, UNMATCHED_ROUTE_POLICY } from './routes.js';
import { securityHeaders } from './security.js';

/**
 * Where the two policies meet: what a response carries is a function of the
 * path it answers and the environment it runs in, and nothing else.
 *
 * The middleware (src/middleware.ts) is four lines long because everything it
 * decides is decided here, where it can be tested without a server.
 */

export interface HttpPolicyOptions {
  /** The path of the request, as `URL.pathname` gives it. */
  readonly pathname: string;
  /** The Sentry DSN in force, when there is one (see security.ts). */
  readonly sentryDsn?: string | undefined;
  /**
   * A page giving up the caching its route declares, for this response only —
   * a data page that could not read its data (see `CacheDowngrade`). It can
   * never widen the policy, so the registry stays the ceiling.
   */
  readonly downgrade?: CacheDowngrade | undefined;
}

export function policyHeaders({
  pathname,
  sentryDsn,
  downgrade,
}: HttpPolicyOptions): Record<string, string> {
  const route = matchRoute(pathname)?.policy ?? UNMATCHED_ROUTE_POLICY;
  const cache = downgrade === undefined ? route : { cache: downgrade, tags: [] };

  return {
    ...securityHeaders({ sentryDsn }),
    ...cacheHeaders(cache),
  };
}

/**
 * Sets the policy on a response, overriding whatever it already declared.
 *
 * Overriding is the point: the registry in routes.ts is the single source of
 * truth for cache policy, so a route that sets its own `Cache-Control` is a
 * disagreement to be settled in the registry — and silently keeping the route's
 * value is how the two drift apart without anyone noticing.
 *
 * The response is mutated rather than rebuilt: Astro streams the rendered body,
 * and reconstructing a response around a stream is a risk taken for nothing
 * when only headers change.
 */
export function applyPolicyHeaders(response: Response, options: HttpPolicyOptions): Response {
  for (const [name, value] of Object.entries(policyHeaders(options))) {
    response.headers.set(name, value);
  }

  return response;
}
