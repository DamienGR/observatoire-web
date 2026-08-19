import { describe, expect, it } from 'vitest';
import { CACHE_POLICIES } from './cache.js';
import {
  expectedStatus,
  matchRoute,
  ROUTE_POLICIES,
  routePatternFromPageFile,
  SHELL_ROUTES,
  UNMATCHED_ROUTE_POLICY,
} from './routes.js';

describe('routePatternFromPageFile', () => {
  it.each([
    ['index.astro', '/'],
    ['methodologie.astro', '/methodologie'],
    ['mentions-legales.astro', '/mentions-legales'],
    ['404.astro', '/404'],
    ['communes/index.astro', '/communes'],
    ['communes/[code_insee].astro', '/communes/[code_insee]'],
    ['api/scan.ts', '/api/scan'],
    ['data/export.csv.ts', '/data/export.csv'],
    ['classements/[...filtres].astro', '/classements/[...filtres]'],
  ])('maps %s to %s', (file, pattern) => {
    expect(routePatternFromPageFile(file)).toBe(pattern);
  });

  it('accepts a Windows-style separator, since the enumeration walks a filesystem', () => {
    expect(routePatternFromPageFile('communes\\index.astro')).toBe('/communes');
  });

  it.each([
    ['_draft.astro', 'a leading underscore excludes a file from routing'],
    ['communes/_partial.astro', 'the same rule applies in a subdirectory'],
    ['styles.css', 'only page and endpoint extensions produce a route'],
    ['components/Card.astro.snap', 'a nested extension is not an Astro file'],
  ])('returns null for %s — %s', (file) => {
    expect(routePatternFromPageFile(file)).toBeNull();
  });
});

describe('ROUTE_POLICIES', () => {
  it('names a known cache policy for every declared route', () => {
    for (const [pattern, policy] of Object.entries(ROUTE_POLICIES)) {
      expect(Object.keys(CACHE_POLICIES), pattern).toContain(policy.cache);
    }
  });

  it('gives every cacheable route at least one tag to be purged by', () => {
    for (const [pattern, policy] of Object.entries(ROUTE_POLICIES)) {
      if (policy.cache === 'uncached') continue;
      expect(policy.tags.length, pattern).toBeGreaterThan(0);
    }
  });

  it('declares patterns as absolute paths without a trailing slash', () => {
    // `trailingSlash: 'never'` in astro.config.mjs. A pattern written with one
    // would silently never match.
    for (const pattern of Object.keys(ROUTE_POLICIES)) {
      expect(pattern.startsWith('/'), pattern).toBe(true);
      expect(pattern === '/' || !pattern.endsWith('/'), pattern).toBe(true);
    }
  });

  it('keeps the error page out of every cache', () => {
    expect(ROUTE_POLICIES['/404']?.cache).toBe('uncached');
  });
});

describe('matchRoute', () => {
  it('matches a declared static route', () => {
    expect(matchRoute('/methodologie')?.pattern).toBe('/methodologie');
  });

  it('matches the home page', () => {
    expect(matchRoute('/')?.pattern).toBe('/');
  });

  it('ignores a trailing slash rather than falling through to the default', () => {
    expect(matchRoute('/methodologie/')?.pattern).toBe('/methodologie');
  });

  it('returns null for an unknown path', () => {
    expect(matchRoute('/inconnu')).toBeNull();
  });

  it('matches a dynamic segment against exactly one segment', () => {
    const policies = { '/communes/[code_insee]': { cache: 'editorial', tags: ['t'] } } as const;

    expect(matchRoute('/communes/35238', policies)?.pattern).toBe('/communes/[code_insee]');
    expect(matchRoute('/communes/35238/mesures', policies)).toBeNull();
    expect(matchRoute('/communes', policies)).toBeNull();
  });

  it('matches a rest segment against one segment or more', () => {
    const policies = { '/classements/[...filtres]': { cache: 'editorial', tags: ['t'] } } as const;

    expect(matchRoute('/classements/region/bretagne', policies)?.pattern).toBe(
      '/classements/[...filtres]',
    );
    expect(matchRoute('/classements/region', policies)?.pattern).toBe('/classements/[...filtres]');
    // A rest segment matches nothing at all under Astro too, but the route that
    // would answer `/classements` is a separate file with its own policy.
    expect(matchRoute('/classements', policies)).toBeNull();
  });

  it('prefers an exact pattern over a dynamic one that also matches', () => {
    const policies = {
      '/communes/[code_insee]': { cache: 'editorial', tags: ['dynamique'] },
      '/communes/mediane': { cache: 'editorial', tags: ['exact'] },
    } as const;

    expect(matchRoute('/communes/mediane', policies)?.policy.tags).toEqual(['exact']);
  });
});

describe('UNMATCHED_ROUTE_POLICY', () => {
  it('caches nothing', () => {
    // What answers a path no route declares is an error page or a redirect.
    // Storing it at the edge would outlive the reason it was produced.
    expect(UNMATCHED_ROUTE_POLICY.cache).toBe('uncached');
  });
});

describe('SHELL_ROUTES', () => {
  it('holds every static route of the registry, and only those', () => {
    // The list the E2E suite and the warm-up job both visit. Derived rather
    // than written, so a page added to the registry is covered without anyone
    // remembering either consumer.
    expect([...SHELL_ROUTES].sort()).toEqual(
      Object.keys(ROUTE_POLICIES)
        .filter((pattern) => !pattern.includes('['))
        .sort(),
    );
  });

  it('leaves out the dynamic routes, which have no address to visit', () => {
    // The bound §5 puts on this layer: a route that multiplies with the data
    // cannot enter here at all, because a pattern is not an address.
    expect(SHELL_ROUTES.some((route) => route.includes('['))).toBe(false);
  });
});

describe('expectedStatus', () => {
  it('expects 404 from the not-found page at its own address', () => {
    // Measured, not assumed: Astro matches the route and renders it with the
    // status it stands for. Expecting 200 here would make the one page whose
    // job is to fail the one page whose check proves nothing.
    expect(expectedStatus('/404')).toBe(404);
  });

  it('expects 200 from every other page of the shell', () => {
    for (const route of SHELL_ROUTES.filter((candidate) => candidate !== '/404')) {
      expect(expectedStatus(route)).toBe(200);
    }
  });
});
