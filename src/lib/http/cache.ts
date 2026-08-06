/**
 * Cache policies, as data (CLAUDE.md §10).
 *
 * Two headers rather than one, because they address two different audiences:
 * `Cache-Control` is read by the browser, `Netlify-CDN-Cache-Control` by the
 * edge. The browser holds nothing it cannot re-check; the edge holds the page.
 * That asymmetry is what makes a purge take effect at once — a visitor whose
 * browser cached a page for an hour would not see the purge either way.
 *
 * `Netlify-Cache-Tag` is what a purge targets. It is emitted here, ahead of the
 * purge itself (milestone 4): a tag added later would leave every response
 * cached before it untargetable.
 */

export type CachePolicyName = 'editorial' | 'uncached';

export interface CachePolicy {
  /** `Cache-Control` — what the visitor's browser may hold. */
  readonly browser: string;
  /** `Netlify-CDN-Cache-Control` — what the edge may hold. */
  readonly cdn: string;
}

export const CACHE_POLICIES: Readonly<Record<CachePolicyName, CachePolicy>> = {
  /**
   * Pages whose content changes only when the code does: the shell, the
   * methodology, the legal pages.
   *
   * An hour at the edge, not the "very long" duration §10 anticipates, and the
   * reason is worth writing down: the tag-based purge does not exist yet
   * (milestone 4). Until it does, expiry is the only thing that can correct a
   * page — so the duration has to stay within what we would accept as the delay
   * for fixing a legal notice. `stale-while-revalidate` keeps the edge serving
   * during the refresh, so the ceiling costs no latency.
   */
  editorial: {
    browser: 'public, max-age=0, must-revalidate',
    cdn: 'public, s-maxage=3600, stale-while-revalidate=86400',
  },

  /** Responses that must outlive nothing: errors, and anything unrouted. */
  uncached: {
    browser: 'no-store',
    cdn: 'no-store',
  },
};

/** What a route declares: which policy applies, and under which purge tags. */
export interface RoutePolicy {
  readonly cache: CachePolicyName;
  readonly tags: readonly string[];
}

/**
 * A cacheable response with no tag can only be evicted by a global purge, and
 * §10 forbids one: a global purge masks the tagging mistake instead of
 * surfacing it, and collapses performance while it is at it.
 */
export class UntaggedCacheableRouteError extends Error {
  override readonly name = 'UntaggedCacheableRouteError';

  constructor(cache: CachePolicyName) {
    super(
      `A route using the "${cache}" cache policy declares no cache tag.\n` +
        'Add at least one tag in src/lib/http/routes.ts: without one, the only ' +
        'way to evict this page is a global purge, which CLAUDE.md §10 forbids.',
    );
  }
}

/** The cache headers for a route, ready to be set on a response. */
export function cacheHeaders({ cache, tags }: RoutePolicy): Record<string, string> {
  const policy = CACHE_POLICIES[cache];
  const headers: Record<string, string> = {
    'cache-control': policy.browser,
    'netlify-cdn-cache-control': policy.cdn,
  };

  // Nothing is stored, so there is nothing to purge: a tag here would announce
  // a capability that does not exist.
  if (cache === 'uncached') return headers;

  if (tags.length === 0) throw new UntaggedCacheableRouteError(cache);

  headers['netlify-cache-tag'] = tags.join(',');
  return headers;
}
