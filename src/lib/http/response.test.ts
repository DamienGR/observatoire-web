import { describe, expect, it } from 'vitest';
import { CACHE_POLICIES } from './cache.js';
import { applyPolicyHeaders, policyHeaders } from './response.js';
import { SECURITY_HEADER_NAMES } from './security.js';

describe('policyHeaders', () => {
  it('carries the security headers on every path, declared or not', () => {
    for (const pathname of ['/', '/methodologie', '/un-chemin-qui-nexiste-pas']) {
      const headers = policyHeaders({ pathname });

      for (const name of SECURITY_HEADER_NAMES) {
        expect(headers[name], `${name} on ${pathname}`).toBeDefined();
      }
    }
  });

  it('takes the cache policy the route declares', () => {
    const headers = policyHeaders({ pathname: '/methodologie' });

    expect(headers['cache-control']).toBe(CACHE_POLICIES.editorial.browser);
    expect(headers['netlify-cache-tag']).toContain('page:methodologie');
  });

  it('stores nothing for a path no route declares', () => {
    // The alternative is inheriting whatever default the CDN applies, which is
    // how a 404 ends up cached for an hour under someone else's URL.
    expect(policyHeaders({ pathname: '/un-chemin-qui-nexiste-pas' })['cache-control']).toBe(
      'no-store',
    );
  });

  it('caches a data page at the edge, under a tag the ingestion can purge', () => {
    const headers = policyHeaders({ pathname: '/stats' });

    expect(headers['netlify-cdn-cache-control']).toBe(CACHE_POLICIES.donnees.cdn);
    expect(headers['netlify-cache-tag']).toContain('data:communes');
  });

  it('stores nothing when a page gives its caching up', () => {
    // The degraded render of a data page: the figures could not be read, and
    // holding that answer at the edge would make the outage outlive itself.
    const headers = policyHeaders({ pathname: '/stats', downgrade: 'uncached' });

    expect(headers['cache-control']).toBe('no-store');
    expect(headers['netlify-cdn-cache-control']).toBe('no-store');
    expect(headers['netlify-cache-tag']).toBeUndefined();
  });

  it('keeps the security headers on a downgraded response', () => {
    const headers = policyHeaders({ pathname: '/stats', downgrade: 'uncached' });

    for (const name of SECURITY_HEADER_NAMES) {
      expect(headers[name], name).toBeDefined();
    }
  });

  it('leaves the declared policy in force when no downgrade is asked for', () => {
    // `undefined` has to mean "the registry decides", not "no cache": the
    // middleware passes the field on every request, set or not.
    expect(policyHeaders({ pathname: '/stats', downgrade: undefined })['cache-control']).toBe(
      CACHE_POLICIES.donnees.browser,
    );
  });

  it('passes the Sentry DSN through to the policy', () => {
    const headers = policyHeaders({
      pathname: '/',
      sentryDsn: 'https://abc@o42.ingest.sentry.io/1',
    });

    expect(headers['content-security-policy']).toContain('https://o42.ingest.sentry.io');
  });
});

describe('applyPolicyHeaders', () => {
  it('sets every policy header on the response it is given', () => {
    const response = applyPolicyHeaders(new Response('<!doctype html>'), { pathname: '/' });

    for (const [name, value] of Object.entries(policyHeaders({ pathname: '/' }))) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it('returns the same response rather than a copy', () => {
    // Astro streams the rendered body; rebuilding the response around it is a
    // risk taken for nothing when the headers are all that change.
    const response = new Response('<!doctype html>');

    expect(applyPolicyHeaders(response, { pathname: '/' })).toBe(response);
  });

  it('leaves headers it does not own alone', () => {
    const response = applyPolicyHeaders(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
      { pathname: '/' },
    );

    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('overrides a cache directive set upstream', () => {
    // The route registry is the single source of truth for cache policy
    // (CLAUDE.md §10): a route that disagrees with it is the bug, and silence
    // is how the two drift apart.
    const response = applyPolicyHeaders(
      new Response('', { headers: { 'cache-control': 'public, max-age=31536000' } }),
      { pathname: '/' },
    );

    expect(response.headers.get('cache-control')).toBe(CACHE_POLICIES.editorial.browser);
  });
});
