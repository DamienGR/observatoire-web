import { describe, expect, it } from 'vitest';
import { CACHE_POLICIES, cacheHeaders, UntaggedCacheableRouteError } from './cache.js';

describe('CACHE_POLICIES', () => {
  it('lets the CDN cache what the browser must revalidate', () => {
    // §10: the browser holds nothing it cannot re-check, the edge holds the
    // page. That is what makes a purge effective the moment it runs.
    expect(CACHE_POLICIES.editorial.browser).toBe('public, max-age=0, must-revalidate');
    expect(CACHE_POLICIES.editorial.cdn).toContain('s-maxage=');
  });

  it('keeps the uncached policy out of every store', () => {
    expect(CACHE_POLICIES.uncached.browser).toBe('no-store');
    expect(CACHE_POLICIES.uncached.cdn).toBe('no-store');
  });

  it.each(Object.entries(CACHE_POLICIES))('declares both audiences for %s', (_name, policy) => {
    // A response that names one audience and forgets the other inherits a
    // default nobody chose — §10 calls that an oversight, not an acceptable
    // default.
    expect(policy.browser).not.toBe('');
    expect(policy.cdn).not.toBe('');
  });
});

describe('cacheHeaders', () => {
  it('separates the browser directive from the CDN one', () => {
    const headers = cacheHeaders({ cache: 'editorial', tags: ['page:accueil'] });

    expect(headers['cache-control']).toBe(CACHE_POLICIES.editorial.browser);
    expect(headers['netlify-cdn-cache-control']).toBe(CACHE_POLICIES.editorial.cdn);
  });

  it('joins the tags a purge will target', () => {
    const headers = cacheHeaders({ cache: 'editorial', tags: ['page:accueil', 'shell'] });

    expect(headers['netlify-cache-tag']).toBe('page:accueil,shell');
  });

  it('refuses a cacheable route with no tag', () => {
    // Such a page can only be evicted by a global purge, and §10 forbids one:
    // a global purge hides exactly the tagging mistake this error names.
    expect(() => cacheHeaders({ cache: 'editorial', tags: [] })).toThrow(
      UntaggedCacheableRouteError,
    );
  });

  it('emits no tag for a response the edge never stores', () => {
    const headers = cacheHeaders({ cache: 'uncached', tags: [] });

    expect(headers['netlify-cache-tag']).toBeUndefined();
    expect(headers['cache-control']).toBe('no-store');
  });

  it('ignores tags declared on an uncached route rather than promising a purge', () => {
    expect(cacheHeaders({ cache: 'uncached', tags: ['page:404'] })['netlify-cache-tag']).toBe(
      undefined,
    );
  });

  it('names every header in lowercase, as the Headers API stores them', () => {
    for (const name of Object.keys(cacheHeaders({ cache: 'editorial', tags: ['page:accueil'] }))) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});
